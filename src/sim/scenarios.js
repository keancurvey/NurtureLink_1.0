// The scenarios of PLAN.md Section 6, as data plus steps. Each step writes records, status changes and notifications
// through the same paths the live product uses (the device link, the check bridge, the server core), so the screens
// react exactly as they would to real events. Not here, because they act on screens that come later:
// attaching a photo (fills the chat composer) and the video call events (the call room, Prompt 10). Expiring a provider
// session is a gear action of the provider shell (features/auth/ProviderSession.jsx), not a scenario.
import { DEVICE_DEFAULTS, THRESHOLDS } from '../config/thresholds.js';
import { followUpEnd, isConfirmed } from '../lib/consult.js';
import { MS_HOUR, MS_MINUTE, addDays, manilaDate, manilaTime } from '../lib/dates.js';
import * as data from './seedData.js';

const SECOND = 1000;
const CHECK_SECONDS = DEVICE_DEFAULTS.belt.checkDurationS;
const activeSupers = (ctx) => ctx.state().db.profiles.filter((p) => p.role === 'super' && p.active);
const activeBarangayAccounts = (ctx, barangayId) =>
  ctx.state().db.profiles.filter((p) => p.role === 'barangay' && p.barangay_id === barangayId && p.active);
const nameOf = (ctx) => ctx.profile(ctx.patientId)?.full_name ?? '';
const newestFirst = (rows, key) => [...rows].sort((a, b) => b[key] - a[key]);
const providersTold = (ctx, alertId) =>
  ctx.state().db.notifications.filter((n) => n.type === 'alert' && n.payload.alert_id === alertId).length;
const alertsSince = (ctx) =>
  ctx.state().db.alerts.filter((a) => a.patient_id === ctx.patientId && a.created_at >= ctx.startedAt);
const sessionsSince = (ctx) =>
  newestFirst(ctx.state().db.check_sessions.filter((s) => s.patient_id === ctx.patientId && (s.queued_at ?? 0) >= ctx.startedAt), 'started_at');

// ---------- Checks ----------

const SIGNALS = {
  normal: {},
  rest: { events: [{ from: 6, to: 9, kind: 'motion' }] },
  maternal: { maternalHr: 84, events: [{ from: 6, to: 9, kind: 'maternal' }] },
  fhrLow: { events: [{ from: 9, to: 24, kind: 'fhr', base: 98, jitter: 4 }] },
  adjustBelt: { contact: 'poor', contactDelayS: 6 },
  noSignal: { lowSignalAll: true },
};
/** The band reading of the "maternal vitals" check: SpO2 92, or heart rate 118, or temperature 38.4 (params.variant). */
const VITALS = { spo2: { spo2: 92 }, heart_rate: { hr: 118 }, temperature: { tempC: 38.4 } };

function startCheckStep({ beltSignal = SIGNALS.normal, bandSignal = {}, useBand = true, durationS = CHECK_SECONDS } = {}) {
  return {
    run(ctx) {
      if (ctx.result.refused) return;
      const { belt, band } = ctx.devices();
      ctx.control.setSignal(belt.serial, beltSignal);
      if (band && useBand) ctx.control.setSignal(band.serial, bandSignal);
      const outcome = ctx.bridge.startCheck(ctx.patientId, { useBand, durationS });
      ctx.result.started = outcome.started;
      ctx.result.durationS = durationS;
      if (!outcome.started) ctx.result.refused = outcome.reason;
    },
  };
}
/** Wait until the check is over (a refused check is over at once), then a moment for it to reach the server. */
const waitForCheck = { until: (ctx) => !ctx.bridge.isChecking(ctx.patientId), limit: 300 * SECOND };
const settle = { after: (ctx) => (ctx.result.started ? 1 * SECOND : 0), run() {} };

function checkSummary(ctx) {
  const name = nameOf(ctx);
  if (ctx.result.refused) return { key: 'presenter:done.checkRefused', values: { name, reason: `t:presenter:reason.${ctx.result.refused}` } };
  const session = sessionsSince(ctx)[0];
  if (!session) return { key: 'presenter:done.checkNoReading', values: { name, reason: 't:presenter:reason.no_contact' } };
  const alert = alertsSince(ctx).find((a) => a.type !== 'missed_check');
  if (alert) {
    return {
      key: 'presenter:done.checkAlert',
      values: { name, type: `t:presenter:alertType.${alert.type}`, count: providersTold(ctx, alert.id) },
    };
  }
  const { summary } = session;
  return {
    key: summary.unverified ? 'presenter:done.checkUnverified' : 'presenter:done.check',
    values: { name, fhr: summary.fhr_bpm, valid: summary.valid_windows, total: summary.total_windows },
  };
}

const check = (id, labelKey, options) => ({
  id,
  group: 'checks',
  labelKey,
  steps: () => [startCheckStep(options), waitForCheck, settle],
  summary: checkSummary,
});

// ---------- Alerts and SOS ----------

function sosSummary(ctx) {
  const alert = alertsSince(ctx).find((a) => a.type === 'sos');
  if (!alert) return { key: 'presenter:done.sosUndelivered', values: { name: nameOf(ctx) } };
  return { key: 'presenter:done.sos', values: { name: nameOf(ctx), count: providersTold(ctx, alert.id) } };
}
const bandOf = (ctx) => {
  const { band } = ctx.devices();
  return band;
};
/** Bring a device's link up, starting from a dropped one so the connection steps (time sync, replay) always happen. */
const reconnect = (ctx, serial) => {
  if (ctx.link.isConnected(serial)) ctx.link.disconnect(serial);
  ctx.link.connect(serial);
};
const connectBand = (ctx) => {
  const band = bandOf(ctx);
  if (!ctx.link.isConnected(band.serial)) ctx.link.connect(band.serial);
  return band;
};

/** Move the patient's recent checks back so that her last completed check is over a day old. Safe to run twice. */
function ageChecks(ctx) {
  const db = ctx.state().db;
  const limit = THRESHOLDS.missedCheck.hours * MS_HOUR;
  const mine = db.check_sessions.filter((s) => s.patient_id === ctx.patientId);
  const newest = Math.max(...mine.map((s) => s.ended_at));
  const target = ctx.now() - limit - MS_HOUR;
  if (newest <= target) return;
  const delta = newest - target;
  const moved = mine.filter((s) => s.ended_at > target);
  const ids = new Set(moved.map((s) => s.id));
  ctx.commit([
    { op: 'updateMany', table: 'check_sessions', patches: moved.map((s) => ({ id: s.id, patch: { started_at: s.started_at - delta, ended_at: s.ended_at - delta } })) },
    {
      op: 'updateMany',
      table: 'fetal_readings',
      patches: db.fetal_readings.filter((r) => ids.has(r.session_id)).map((r) => ({ id: r.id, patch: { taken_at: r.taken_at - delta } })),
    },
    {
      op: 'updateMany',
      table: 'maternal_readings',
      patches: db.maternal_readings.filter((r) => ids.has(r.session_id)).map((r) => ({ id: r.id, patch: { taken_at: r.taken_at - delta } })),
    },
  ]);
}

// ---------- Schedule and consult ----------

const midwifeThread = (ctx) => ctx.state().db.conversations.find((c) => c.patient_id === ctx.patientId && c.kind === 'midwife') ?? null;
/** The teleconsultation the patient asked for that no super account has decided yet, oldest first (PLAN.md Environment State, P2-2). */
const waitingTeleconsult = (ctx) =>
  ctx.state()
    .db.appointments.filter((a) => a.patient_id === ctx.patientId && a.type === 'teleconsult' && a.status === 'pending')
    .sort((a, b) => a.requested_at - b.requested_at)[0] ?? null;
const nextApprovedTeleconsult = (ctx) =>
  ctx.state()
    .db.appointments.filter((a) => a.patient_id === ctx.patientId && a.type === 'teleconsult' && isConfirmed(a) && a.scheduled_at !== null)
    .sort((a, b) => a.scheduled_at - b.scheduled_at)[0] ?? null;

function incomingMessage(ctx) {
  const patient = ctx.profile(ctx.patientId);
  const db = ctx.state().db;
  const actor = ctx.profile(ctx.actorId);
  const role = ctx.actorRole ?? actor?.role ?? 'patient';
  const barangay = db.conversations.find((c) => c.patient_id === ctx.patientId && c.kind === 'barangay');
  const midwife = midwifeThread(ctx);
  let conversation = barangay;
  let sender;
  let recipient;
  let pool;
  let language;
  const chosen = ctx.params.conversationId ? db.conversations.find((c) => c.id === ctx.params.conversationId && c.patient_id === ctx.patientId) : null;
  if (role === 'patient' && chosen?.kind === 'midwife') {
    // the midwife thread she has open: the assigned midwife answers while the thread is open
    if (!(chosen.unlocked_until > ctx.now())) return;
    conversation = chosen;
    sender = ctx.profile(chosen.assigned_provider_id) ?? activeSupers(ctx)[0];
    recipient = patient;
    pool = data.CHAT_MIDWIFE_REPLIES;
    language = sender.language;
  } else if (role === 'patient') {
    // the patient's own chat: her barangay's account answers
    const accounts = activeBarangayAccounts(ctx, patient.barangay_id);
    const count = db.messages.filter((m) => m.conversation_id === barangay.id).length;
    sender = accounts[count % accounts.length] ?? activeSupers(ctx)[0];
    recipient = patient;
    pool = data.CHAT_BHW;
    language = sender.language;
  } else {
    conversation = role === 'super' && midwife?.unlocked_until > ctx.now() ? midwife : barangay;
    sender = patient;
    recipient = actor ?? activeBarangayAccounts(ctx, patient.barangay_id)[0];
    pool = data.CHAT_PATIENT;
    language = patient.language;
  }
  const lines = pool[language] ?? pool.en;
  const count = db.messages.filter((m) => m.conversation_id === conversation.id).length;
  const at = ctx.now();
  const message = {
    id: ctx.id('msg'),
    conversation_id: conversation.id,
    sender_id: sender.id,
    body: lines[count % lines.length],
    attachment_art: null,
    sent_at: at,
    delivered_at: at,
    seen_at: null,
    client_id: null,
    syncState: 'synced',
  };
  // The other side has now seen what the viewer sent earlier in this thread. In a barangay's shared inbox the patient has
  // seen what any account of the barangay wrote (ACC-03).
  const team = new Set(db.profiles.filter((p) => p.role === 'barangay' && p.barangay_id === patient.barangay_id).map((p) => p.id));
  const fromViewerSide = (m) => (role === 'barangay' && conversation.kind === 'barangay' ? team.has(m.sender_id) : m.sender_id === recipient?.id);
  const seen = db.messages.filter((m) => m.conversation_id === conversation.id && fromViewerSide(m) && !m.seen_at);
  ctx.commit([
    { op: 'insert', table: 'messages', row: message },
    { op: 'updateMany', table: 'messages', patches: seen.map((m) => ({ id: m.id, patch: { seen_at: at } })) },
  ]);
  if (recipient) ctx.sendPush([recipient.id], 'message', { conversation_id: conversation.id, patient_id: ctx.patientId });
  ctx.result.sender = sender.full_name;
}

function referral(ctx) {
  const patient = ctx.profile(ctx.patientId);
  const db = ctx.state().db;
  const actor = ctx.profile(ctx.actorId);
  const from = actor?.role === 'barangay' ? actor : activeBarangayAccounts(ctx, patient.barangay_id)[0];
  const last = newestFirst(db.check_sessions.filter((s) => s.patient_id === ctx.patientId && s.syncState === 'synced'), 'started_at')[0];
  const reasonLanguage = from?.language ?? 'en';
  const told = ctx.sendPush(activeSupers(ctx).map((p) => p.id), 'referral', {
    patient_id: ctx.patientId,
    reason: data.REFERRAL_REASON[reasonLanguage] ?? data.REFERRAL_REASON.en,
    vitals: last
      ? { fhr_bpm: last.summary.fhr_bpm, hr_bpm: last.summary.hr_bpm, spo2_pct: last.summary.spo2_pct, skin_temp_c: last.summary.skin_temp_c, at: last.ended_at }
      : null,
    from_profile_id: from?.id ?? null,
  });
  ctx.result.told = told.length;
}

// ---------- The catalog ----------

export const SCENARIOS = [
  // Checks
  check('check-normal', 'presenter:scenario.checkNormal'),
  check('check-adjust-belt', 'presenter:scenario.checkAdjustBelt', { beltSignal: SIGNALS.adjustBelt }),
  check('check-rest', 'presenter:scenario.checkRest', { beltSignal: SIGNALS.rest }),
  check('check-no-band', 'presenter:scenario.checkNoBand', { useBand: false }),
  check('check-maternal-signal', 'presenter:scenario.checkMaternalSignal', { beltSignal: SIGNALS.maternal }),
  check('check-fhr-out-of-range', 'presenter:scenario.checkFhrOutOfRange', { beltSignal: SIGNALS.fhrLow }),
  {
    id: 'check-maternal-vitals',
    group: 'checks',
    labelKey: 'presenter:scenario.checkMaternalVitals',
    steps: (ctx) => [startCheckStep({ bandSignal: VITALS[ctx.params.variant ?? 'spo2'] ?? VITALS.spo2 }), waitForCheck, settle],
    summary: checkSummary,
  },
  {
    // Three checks in a row with no usable signal, each shortened to 40 seconds so the run stays short.
    id: 'check-signal-loss',
    group: 'checks',
    labelKey: 'presenter:scenario.checkSignalLoss',
    steps: () => [1, 2, 3].flatMap(() => [startCheckStep({ beltSignal: SIGNALS.noSignal, durationS: 40 }), waitForCheck, settle]),
    summary: checkSummary,
  },

  // Alerts and SOS
  {
    id: 'sos-pressed',
    group: 'alerts',
    labelKey: 'presenter:scenario.sosPressed',
    steps: () => [{ run: (ctx) => ctx.control.pressSos(connectBand(ctx).serial) }],
    summary: sosSummary,
  },
  {
    id: 'sos-cancelled',
    group: 'alerts',
    labelKey: 'presenter:scenario.sosCancelled',
    steps: () => [
      { run: (ctx) => ctx.control.pressSos(connectBand(ctx).serial) },
      { after: 3 * SECOND, run: (ctx) => ctx.control.cancelSos(bandOf(ctx).serial) },
    ],
    summary: (ctx) => ({ key: 'presenter:done.sosCancelled', values: { name: nameOf(ctx) } }),
  },
  {
    // The band is out of range: it stores the SOS and keeps its own indication; the app relays it when the band returns.
    id: 'sos-band-out-of-range',
    group: 'alerts',
    labelKey: 'presenter:scenario.sosBandOutOfRange',
    steps: () => [
      { run: (ctx) => ctx.link.disconnect(bandOf(ctx).serial) },
      {
        after: 1 * SECOND,
        run(ctx) {
          ctx.control.pressSos(bandOf(ctx).serial);
          ctx.bridge.markSosUndelivered(ctx.patientId); // the app tells her it could not be delivered
        },
      },
      { after: 8 * SECOND, run: (ctx) => reconnect(ctx, bandOf(ctx).serial) },
      { until: (ctx) => alertsSince(ctx).some((a) => a.type === 'sos'), limit: 30 * SECOND },
    ],
    summary: sosSummary,
  },
  {
    // An open alert nobody acknowledges reaches all super accounts at the escalation time (5 minutes, 60 seconds in Quick).
    id: 'alert-unacknowledged',
    group: 'alerts',
    labelKey: 'presenter:scenario.alertUnacknowledged',
    steps: () => [
      {
        run(ctx) {
          const open = newestFirst(ctx.state().db.alerts.filter((a) => a.patient_id === ctx.patientId && a.status === 'new'), 'created_at')[0];
          const alert =
            open ??
            ctx.core.raiseAlert(ctx.patientId, {
              type: 'fhr_out_of_range',
              severity: 'critical',
              payload: { direction: 'low', sustained_seconds: 36, extreme_bpm: 101 },
            }).alert;
          ctx.result.alertId = alert.id;
        },
      },
      {
        after: (ctx) => ctx.escalationMs(),
        scale: false,
        run(ctx) {
          // The sweep may have escalated it a moment before this step: either way it reached the super accounts.
          ctx.core.escalateAlert(ctx.result.alertId);
          ctx.result.escalated = Boolean(ctx.state().db.alerts.find((a) => a.id === ctx.result.alertId)?.escalated_at);
        },
      },
    ],
    summary: (ctx) => ({
      key: ctx.result.escalated ? 'presenter:done.escalated' : 'presenter:done.notEscalated',
      values: { name: nameOf(ctx), count: activeSupers(ctx).length },
    }),
  },
  {
    // No completed check in 24 hours: her last check is moved back past a day, then the rule runs.
    id: 'missed-check',
    group: 'alerts',
    labelKey: 'presenter:scenario.missedCheck',
    steps: () => [
      { run: (ctx) => ageChecks(ctx) },
      {
        after: 2 * SECOND,
        run(ctx) {
          ctx.result.alert = ctx.core.checkMissed(ctx.patientId)?.alert ?? null;
        },
      },
    ],
    summary: (ctx) => ({
      key: ctx.result.alert ? 'presenter:done.missedCheck' : 'presenter:done.nothingRaised',
      values: { name: nameOf(ctx), count: ctx.result.alert ? providersTold(ctx, ctx.result.alert.id) : 0 },
    }),
  },

  // Devices (the gear's Devices section passes { device, ... })
  {
    id: 'device-connection',
    group: 'devices',
    labelKey: 'presenter:scenario.deviceConnection',
    steps: () => [
      {
        run(ctx) {
          const device = ctx.devices()[ctx.params.device];
          if (ctx.params.connected) ctx.link.connect(device.serial);
          else ctx.link.disconnect(device.serial);
        },
      },
    ],
    summary: (ctx) => ({
      key: ctx.params.connected ? 'presenter:done.deviceConnected' : 'presenter:done.deviceDisconnected',
      values: { device: `t:presenter:devices.${ctx.params.device}` },
    }),
  },
  {
    id: 'device-battery',
    group: 'devices',
    labelKey: 'presenter:scenario.deviceBattery',
    steps: () => [{ run: (ctx) => ctx.control.setBattery(ctx.devices()[ctx.params.device].serial, ctx.params.pct) }],
    summary: (ctx) => ({ key: 'presenter:done.battery', values: { device: `t:presenter:devices.${ctx.params.device}`, pct: ctx.params.pct } }),
  },
  {
    id: 'device-charging',
    group: 'devices',
    labelKey: 'presenter:scenario.deviceCharging',
    steps: () => [{ run: (ctx) => ctx.control.setCharging(ctx.devices()[ctx.params.device].serial, ctx.params.on) }],
    summary: (ctx) => ({
      key: ctx.params.on ? 'presenter:done.chargingOn' : 'presenter:done.chargingOff',
      values: { device: `t:presenter:devices.${ctx.params.device}` },
    }),
  },
  {
    id: 'exposure-cap',
    group: 'devices',
    labelKey: 'presenter:scenario.exposureCap',
    steps: () => [{ run: (ctx) => ctx.control.fillExposure(ctx.devices().belt.serial) }],
    summary: (ctx) => ({ key: 'presenter:done.exposureCap', values: { name: nameOf(ctx) } }),
  },
  {
    // The belt runs three scheduled checks while apart; on reconnection the three records sync with no duplicates.
    id: 'checks-while-apart',
    group: 'devices',
    labelKey: 'presenter:scenario.checksWhileApart',
    steps: () => [
      {
        run(ctx) {
          const { belt, band } = ctx.devices();
          ctx.link.disconnect(belt.serial);
          ctx.link.disconnect(band.serial);
        },
      },
      {
        after: 1 * SECOND,
        run(ctx) {
          const { belt, band } = ctx.devices();
          if (ctx.state().hardware[belt.serial].ring.length > 0) return; // already stored (the step ran before a reload)
          for (const minutesAgo of [170, 110, 50]) {
            ctx.control.storeCheck({ beltSerial: belt.serial, bandSerial: band.serial, atMs: ctx.now() - minutesAgo * MS_MINUTE });
          }
        },
      },
      {
        after: 2 * SECOND,
        run(ctx) {
          const { belt, band } = ctx.devices();
          reconnect(ctx, belt.serial);
          reconnect(ctx, band.serial);
        },
      },
      {
        until: (ctx) => ctx.state().db.check_sessions.filter((s) => s.patient_id === ctx.patientId && s.source === 'stored' && s.syncState === 'synced' && (s.queued_at ?? 0) >= ctx.startedAt).length >= 3,
        limit: 60 * SECOND,
      },
    ],
    summary: (ctx) => ({
      key: 'presenter:done.apart',
      values: {
        name: nameOf(ctx),
        count: ctx.state().db.check_sessions.filter((s) => s.patient_id === ctx.patientId && s.source === 'stored' && (s.queued_at ?? 0) >= ctx.startedAt).length,
      },
    }),
  },

  // Schedule and consult
  {
    id: 'booking-request',
    group: 'consult',
    labelKey: 'presenter:scenario.bookingRequest',
    steps: () => [
      {
        run(ctx) {
          const patient = ctx.profile(ctx.patientId);
          const date = addDays(manilaDate(ctx.now()), 1);
          const appointment = {
            id: ctx.id('apt'),
            patient_id: ctx.patientId,
            provider_id: null,
            type: 'teleconsult',
            requested_at: ctx.now(),
            scheduled_at: null,
            preferred_start: manilaTime(date, 13),
            preferred_end: manilaTime(date, 17),
            location: 'Teleconsultation',
            status: 'pending',
            reason: data.BOOKING_REASONS[patient.language][1],
            notes: null,
            handled_by: null,
            handled_at: null,
            decline_reason: null,
            ended_at: null,
          };
          ctx.commit([{ op: 'insert', table: 'appointments', row: appointment }]);
          ctx.result.told = ctx.sendPush(activeSupers(ctx).map((p) => p.id), 'booking_request', { appointment_id: appointment.id, patient_id: ctx.patientId }).length;
        },
      },
    ],
    summary: (ctx) => ({ key: 'presenter:done.bookingRequest', values: { name: nameOf(ctx), count: ctx.result.told } }),
  },
  {
    // The next approved teleconsultation starts now: the midwife thread opens and Join becomes active (PAT-C-03).
    id: 'appointment-now',
    group: 'consult',
    labelKey: 'presenter:scenario.appointmentNow',
    steps: () => [
      {
        run(ctx) {
          const thread = midwifeThread(ctx);
          let appointment = nextApprovedTeleconsult(ctx);
          if (!appointment) {
            // No approved teleconsultation yet: the office approves the one she asked for, then it starts (P2-2; the approvals
            // screen of the super account is Prompt 9). The first super account approves and the second is the assigned midwife.
            const waiting = waitingTeleconsult(ctx);
            if (!waiting || !thread) return;
            const [approver, assigned = approver] = activeSupers(ctx);
            if (!approver) return;
            const at = ctx.now();
            const approval = { status: 'approved', provider_id: assigned.id, handled_by: approver.id, handled_at: at, scheduled_at: at };
            ctx.commit([{ op: 'update', table: 'appointments', id: waiting.id, patch: approval }]);
            ctx.sendPush([ctx.patientId], 'appointment_approved', { appointment_id: waiting.id });
            ctx.sendPush(activeBarangayAccounts(ctx, ctx.profile(ctx.patientId).barangay_id).map((p) => p.id), 'appointment_approved', { appointment_id: waiting.id, patient_id: ctx.patientId });
            appointment = { ...waiting, ...approval };
          }
          if (!thread) return;
          const started = { ...appointment, scheduled_at: ctx.now() };
          ctx.commit([
            { op: 'update', table: 'appointments', id: appointment.id, patch: { scheduled_at: started.scheduled_at } },
            {
              op: 'update',
              table: 'conversations',
              id: thread.id,
              patch: { appointment_id: appointment.id, assigned_provider_id: appointment.provider_id, unlocked_until: followUpEnd(started) },
            },
          ]);
          const told = [ctx.patientId, appointment.provider_id].filter(Boolean);
          ctx.sendPush(told, 'appointment_started', { appointment_id: appointment.id, patient_id: ctx.patientId });
          ctx.result.started = true;
        },
      },
    ],
    summary: (ctx) => ({ key: ctx.result.started ? 'presenter:done.appointmentNow' : 'presenter:done.noAppointment', values: { name: nameOf(ctx) } }),
  },
  {
    // The appointment ends: notes for the midwife, and the 24-hour follow-up chat window opens (PAT-C-03).
    id: 'appointment-end',
    group: 'consult',
    labelKey: 'presenter:scenario.appointmentEnd',
    steps: () => [
      {
        run(ctx) {
          const at = ctx.now();
          const running = ctx.state().db.appointments
            .filter((a) => a.patient_id === ctx.patientId && a.type === 'teleconsult' && isConfirmed(a) && a.scheduled_at !== null && a.scheduled_at <= at)
            .sort((a, b) => b.scheduled_at - a.scheduled_at)[0];
          const thread = midwifeThread(ctx);
          if (!running || !thread) return;
          ctx.commit([
            { op: 'update', table: 'appointments', id: running.id, patch: { status: 'attended', ended_at: at } },
            { op: 'update', table: 'conversations', id: thread.id, patch: { unlocked_until: at + THRESHOLDS.followUpChatHours * MS_HOUR } },
          ]);
          ctx.sendPush([ctx.patientId], 'follow_up_open', { appointment_id: running.id });
          ctx.result.ended = true;
        },
      },
    ],
    summary: (ctx) => ({ key: ctx.result.ended ? 'presenter:done.appointmentEnd' : 'presenter:done.noAppointment', values: { name: nameOf(ctx) } }),
  },
  {
    // The follow-up window has run out: the midwife thread locks again.
    id: 'followup-close',
    group: 'consult',
    labelKey: 'presenter:scenario.followupClose',
    steps: () => [
      {
        run(ctx) {
          const thread = midwifeThread(ctx);
          if (!thread || !thread.unlocked_until || thread.unlocked_until <= ctx.now()) return;
          ctx.commit([{ op: 'update', table: 'conversations', id: thread.id, patch: { unlocked_until: ctx.now() } }]);
          ctx.result.closed = true;
        },
      },
    ],
    summary: (ctx) => ({ key: ctx.result.closed ? 'presenter:done.followupClose' : 'presenter:done.nothingToClose', values: { name: nameOf(ctx) } }),
  },
  {
    // The next event is close: the reminder reaches the patient and the accounts of her barangay.
    id: 'event-reminder',
    group: 'consult',
    labelKey: 'presenter:scenario.eventReminder',
    steps: () => [
      {
        run(ctx) {
          const patient = ctx.profile(ctx.patientId);
          const event = ctx.state().db.events
            .filter((e) => e.starts_at > ctx.now() && (e.scope === 'all' || e.barangay_id === patient.barangay_id))
            .sort((a, b) => a.starts_at - b.starts_at)[0];
          if (!event) return;
          const audience = [ctx.patientId, ...activeBarangayAccounts(ctx, patient.barangay_id).map((p) => p.id)];
          ctx.result.told = ctx.sendPush(audience, 'event_reminder', { event_id: event.id }).length;
          ctx.result.title = event.title;
        },
      },
    ],
    summary: (ctx) => ({
      key: ctx.result.title ? 'presenter:done.eventReminder' : 'presenter:done.noEvent',
      values: { title: ctx.result.title ?? '', count: ctx.result.told ?? 0 },
    }),
  },
  {
    id: 'incoming-message',
    group: 'consult',
    labelKey: 'presenter:scenario.incomingMessage',
    steps: () => [{ run: incomingMessage }],
    summary: (ctx) => ({ key: 'presenter:done.incomingMessage', values: { name: ctx.result.sender ?? '' } }),
  },
  {
    id: 'referral',
    group: 'consult',
    labelKey: 'presenter:scenario.referral',
    steps: () => [{ run: referral }],
    summary: (ctx) => ({ key: 'presenter:done.referral', values: { name: nameOf(ctx), count: ctx.result.told } }),
  },
  {
    id: 'video-usage-80',
    group: 'consult',
    labelKey: 'presenter:scenario.videoUsage80',
    steps: () => [
      {
        run(ctx) {
          const { used, limit } = ctx.state().meta.video_usage;
          const target = Math.ceil(limit * 0.8);
          if (used >= target) return;
          ctx.commit([{ op: 'meta', patch: { video_usage: { used: target, limit } } }]);
          ctx.sendPush(activeSupers(ctx).map((p) => p.id), 'video_usage_warning', { used: target, limit });
          ctx.result.raised = true;
        },
      },
    ],
    summary: (ctx) => ({ key: ctx.result.raised ? 'presenter:done.videoUsage' : 'presenter:done.videoUsageAlready', values: {} }),
  },
];

export const SCENARIO_IDS = SCENARIOS.map((scenario) => scenario.id);
