// The server side of the showcase, in process and synchronous: the logic behind the edge functions of spec 7.4
// (ingest_readings, send_push) and the alert path (ALR-01 to ALR-05). Everything the simulated devices, the scenarios
// and the check flow write goes through here, so replacing this module with calls to a real backend is the only change
// needed to go live. Screens call the same functions through the latency wrapper in actions.js.
import { buildThresholds } from '../config/thresholds.js';
import {
  evaluateBattery,
  evaluateFhr,
  evaluateMaternalVitals,
  evaluateMissedCheck,
  evaluateSignalLoss,
  evaluateSos,
  findDuplicate,
  mergePatch,
} from '../lib/alertRules.js';
import { escalationMs, shouldEscalate } from '../lib/alertRules.js';
import { batteryLevel, voltageForPct } from '../lib/battery.js';
import { dueReminders } from '../lib/reminders.js';
import { dedupeKey, queuedInOrder, splitDuplicates } from '../lib/offlineQueue.js';
import { byId } from './ops.js';

export function createCore({ store, now = Date.now }) {
  let counter = 0;
  /** Ids of records made at run time use an underscore; the seed's ids use a hyphen, so the two never meet. */
  const id = (prefix) => `${prefix}_${now().toString(36)}${(counter++).toString(36)}`;
  const state = () => store.getState();
  const commit = (ops) => {
    if (ops.length > 0) store.dispatch({ type: 'ops', ops });
  };
  const isOnline = () => state().meta.connection === 'online';
  const thresholds = () => buildThresholds(state().db.thresholds);

  const activeBarangayAccounts = (db, barangayId) =>
    db.profiles.filter((p) => p.role === 'barangay' && p.barangay_id === barangayId && p.active);
  const activeSupers = (db) => db.profiles.filter((p) => p.role === 'super' && p.active);

  /**
   * Delivery (ALR-03): every active barangay account of the patient's barangay, and all active super accounts for an
   * SOS, an escalation or a barangay with no active account.
   */
  function alertRecipients(alert, { escalated = false } = {}) {
    const db = state().db;
    const patient = byId(db.profiles).get(alert.patient_id);
    const barangay = activeBarangayAccounts(db, patient.barangay_id).map((p) => p.id);
    const wantsSupers = alert.type === 'sos' || escalated || barangay.length === 0;
    return [...new Set([...barangay, ...(wantsSupers ? activeSupers(db).map((p) => p.id) : [])])];
  }

  /** send_push: one inbox record per recipient (Web Push itself is not simulated). */
  function sendPush(recipientIds, type, payload) {
    const at = now();
    const rows = [...new Set(recipientIds)].map((profileId) => ({
      id: id('ntf'),
      profile_id: profileId,
      type,
      payload,
      created_at: at,
      read_at: null,
    }));
    commit([{ op: 'insertMany', table: 'notifications', rows }]);
    return rows;
  }

  /** A notice the patient's phone showed from its own rules that no alert is attached to yet. */
  const phoneNotice = (patientId, type, sessionId = null) =>
    state().db.notifications.find(
      (n) =>
        n.profile_id === patientId &&
        n.type === 'alert_notice' &&
        n.payload.local === true &&
        !n.payload.alert_id &&
        n.payload.alert_type === type &&
        (sessionId === null || n.payload.session_id === sessionId),
    ) ?? null;

  /**
   * Create an alert from a rule's candidate, or merge it into the open alert of the same kind (ALR-04). A new alert
   * goes to the barangay accounts (and to the super accounts where ALR-03 says so) and the patient gets her own notice.
   */
  function raiseAlert(patientId, candidate, { readingRef = null } = {}) {
    const open = findDuplicate(state().db.alerts, patientId, candidate);
    const at = now();
    if (open) {
      const patch = mergePatch(open, at);
      commit([{ op: 'update', table: 'alerts', id: open.id, patch }]);
      return { alert: { ...open, ...patch }, created: false };
    }
    const alert = {
      id: id('alt'),
      patient_id: patientId,
      type: candidate.type,
      severity: candidate.severity,
      reading_ref: readingRef,
      created_at: at,
      last_seen_at: at,
      merged_count: 0,
      status: 'new',
      acknowledged_by: null,
      acknowledged_at: null,
      escalated_at: null,
      resolved_by: null,
      resolved_at: null,
      outcome: null,
      outcome_code: null,
      cancelled_at: null,
      payload: candidate.payload,
    };
    commit([{ op: 'insert', table: 'alerts', row: alert }]);
    sendPush(alertRecipients(alert), 'alert', { alert_id: alert.id, alert_type: alert.type, patient_id: patientId });
    // The phone may have shown her notice already (evaluateOnPhone): the alert is attached to it, so she gets one notice.
    const shown = readingRef ? phoneNotice(patientId, candidate.type, readingRef) : null;
    if (shown) commit([{ op: 'update', table: 'notifications', id: shown.id, patch: { payload: { ...shown.payload, alert_id: alert.id } } }]);
    else sendPush([patientId], 'alert_notice', { alert_id: alert.id, alert_type: alert.type });
    return { alert, created: true };
  }

  /** An alert nobody acknowledged reaches all super accounts (ALR-05). Does nothing once it has been acknowledged. */
  function escalateAlert(alertId) {
    const alert = byId(state().db.alerts).get(alertId);
    if (!alert || alert.status !== 'new' || alert.escalated_at) return false;
    commit([{ op: 'update', table: 'alerts', id: alertId, patch: { escalated_at: now() } }]);
    sendPush(activeSupers(state().db).map((p) => p.id), 'alert', {
      alert_id: alertId,
      alert_type: alert.type,
      patient_id: alert.patient_id,
      escalated: true,
    });
    return true;
  }

  /**
   * The escalation sweep (ALR-05): every alert nobody acknowledged within the escalation time (5 minutes, 60 seconds in
   * Quick timing) reaches all super accounts. It covers the alerts raised since the records were built: the ones the
   * seed made to look like history are not escalated when the app opens. Answers how many it escalated.
   */
  function sweepEscalations() {
    const { alerts } = state().db;
    const ms = escalationMs(thresholds(), state().meta.timing);
    const at = now();
    const since = state().seededAt ?? 0;
    const due = alerts.filter((alert) => alert.created_at >= since && shouldEscalate(alert, at, ms));
    return due.filter((alert) => escalateAlert(alert.id)).length;
  }

  /**
   * Reminders before appointments and events (PAT-S-04): one day and two hours before, each sent once and remembered on
   * the row. An appointment's reminder goes to its patient; an event's to the patients and barangay accounts it is for.
   * Like the escalation sweep, it covers what was set up after the records were built. Answers how many it sent.
   */
  function sweepReminders() {
    const db = state().db;
    const at = now();
    const due = dueReminders({ appointments: db.appointments, events: db.events, now: at, since: state().seededAt ?? 0, thresholds: thresholds() });
    for (const item of due) {
      if (item.source === 'appointment') {
        const row = byId(db.appointments).get(item.id);
        sendPush([row.patient_id], 'appointment_reminder', { appointment_id: row.id, lead: item.lead, kind: row.type });
        commit([{ op: 'update', table: 'appointments', id: row.id, patch: { reminded: [...(row.reminded ?? []), ...item.mark] } }]);
      } else {
        const row = byId(db.events).get(item.id);
        const audience = db.profiles.filter((p) => p.active && (p.role === 'patient' || p.role === 'barangay') && (row.scope === 'all' || p.barangay_id === row.barangay_id));
        sendPush(audience.map((p) => p.id), 'event_reminder', { event_id: row.id, lead: item.lead });
        commit([{ op: 'update', table: 'events', id: row.id, patch: { reminded: [...(row.reminded ?? []), ...item.mark] } }]);
      }
    }
    return due.length;
  }

  /**
   * Tell the accounts a patient's request is for (send_push). A reschedule request reaches every super account (the
   * shared approvals queue, PLAN.md assumption 8) and the appointment's own provider; a barangay change reaches the
   * super accounts.
   */
  function deliverRequest(request) {
    const db = state().db;
    const supers = activeSupers(db).map((p) => p.id);
    if (request.kind === 'reschedule') {
      const appointment = byId(db.appointments).get(request.appointment_id);
      const provider = appointment?.provider_id ? byId(db.profiles).get(appointment.provider_id) : null;
      return sendPush([...supers, ...(provider?.active ? [provider.id] : [])], 'reschedule_request', {
        request_id: request.id,
        appointment_id: request.appointment_id,
        patient_id: request.patient_id,
      });
    }
    return sendPush(supers, 'barangay_change_request', { request_id: request.id, patient_id: request.patient_id });
  }

  /** The operations that save a patient's own details: contact and photo live on her profile, emergency contact on her patient row. */
  function personalEditOps(patientId, edit) {
    const PROFILE_FIELDS = ['contact_no', 'photo_url', 'avatar_art'];
    const profilePatch = Object.fromEntries(Object.entries(edit).filter(([key]) => PROFILE_FIELDS.includes(key)));
    const patientPatch = Object.fromEntries(Object.entries(edit).filter(([key]) => !PROFILE_FIELDS.includes(key)));
    const ops = [];
    if (Object.keys(profilePatch).length > 0) ops.push({ op: 'update', table: 'profiles', id: patientId, patch: profilePatch });
    ops.push({ op: 'update', table: 'patients', id: patientId, patch: { ...patientPatch, queued_edit: null } });
    return ops;
  }

  /**
   * The phone runs the rules the moment a check is saved (ALR-02), so the patient has her notice at once, even offline.
   * Only her own notice is made here: the alert, the barangay's and the midwife's notifications come from the server
   * path (ingestReadings), which stays the authority and attaches the alert to this notice. A kind she already has open,
   * or already has a notice for, makes no second one.
   */
  function evaluateOnPhone(patientId, { session, fetal = [], maternal = [] }) {
    const th = thresholds();
    const db = state().db;
    const windows = [...fetal].sort((a, b) => a.taken_at - b.taken_at);
    const vitals = [...maternal].sort((a, b) => a.taken_at - b.taken_at);
    const summaries = db.check_sessions.filter((s) => s.patient_id === patientId).sort((a, b) => a.started_at - b.started_at).map((s) => s.summary);
    const candidates = [evaluateFhr(windows, th), vitals.length ? evaluateMaternalVitals(vitals[vitals.length - 1], th) : null, evaluateSignalLoss(summaries, th)];
    const made = [];
    for (const candidate of candidates.filter(Boolean)) {
      if (findDuplicate(db.alerts, patientId, candidate) || phoneNotice(patientId, candidate.type)) continue;
      made.push(...sendPush([patientId], 'alert_notice', { alert_type: candidate.type, session_id: session.id, local: true }));
    }
    return made;
  }

  /**
   * SOS relayed by the open app (spec 3.2). A pressed packet raises an alert, merged into one already open; a cancelled
   * packet closes the open one as cancelled by the patient.
   */
  function relaySos(patientId, packet) {
    if (packet.pressed) return raiseAlert(patientId, evaluateSos(packet));
    const open = [...state().db.alerts].reverse().find((a) => a.patient_id === patientId && a.type === 'sos' && a.status !== 'resolved');
    if (!open) return { alert: null, created: false };
    const at = now();
    const patch = { status: 'resolved', cancelled_at: at, resolved_by: patientId, resolved_at: at, outcome_code: 'cancelled_by_patient' };
    commit([{ op: 'update', table: 'alerts', id: open.id, patch }]);
    sendPush(alertRecipients(open), 'alert', { alert_id: open.id, alert_type: 'sos', patient_id: patientId, cancelled: true });
    return { alert: { ...open, ...patch }, created: false, cancelled: true };
  }

  /**
   * ingest_readings (spec 7.4): batch insert of check sessions and readings with duplicate removal and the server-side
   * rules. A batch is { patient_id, checks: [{ session, fetal, maternal }] }. Readings the phone already holds as queued
   * are marked synced; a device bound to another patient is rejected (spec 10).
   */
  function ingestReadings({ patient_id: patientId, checks }) {
    const result = { inserted: 0, duplicates: 0, rejected: 0, alerts: { created: [], merged: [] } };
    const th = thresholds();
    for (const { session, fetal = [], maternal = [] } of checks) {
      const db = state().db;
      const bound = new Set(db.devices.filter((d) => d.patient_id === patientId).map((d) => d.serial));
      if (session.patient_id !== patientId || !bound.has(session.belt_serial) || (session.band_serial && !bound.has(session.band_serial))) {
        result.rejected += 1;
        continue;
      }
      const existing = session.client_id ? db.check_sessions.find((s) => s.client_id === session.client_id) : null;
      if (existing && existing.syncState === 'synced') {
        result.duplicates += 1;
        continue;
      }

      const sessionId = existing ? existing.id : session.id;
      const ops = [];
      if (existing) {
        const synced = (rows) =>
          rows.filter((r) => r.session_id === existing.id && r.syncState === 'queued').map((r) => ({ id: r.id, patch: { syncState: 'synced' } }));
        ops.push({ op: 'update', table: 'check_sessions', id: existing.id, patch: { syncState: 'synced' } });
        ops.push({ op: 'updateMany', table: 'fetal_readings', patches: synced(db.fetal_readings) });
        ops.push({ op: 'updateMany', table: 'maternal_readings', patches: synced(db.maternal_readings) });
      } else {
        const beltOf = new Map(db.check_sessions.map((s) => [s.id, s.belt_serial]));
        const bandOf = new Map(db.check_sessions.map((s) => [s.id, s.band_serial]));
        const fetalKey = (row) => dedupeKey(row, beltOf.get(row.session_id) ?? session.belt_serial);
        const maternalKey = (row) => dedupeKey(row, bandOf.get(row.session_id) ?? session.band_serial);
        const freshFetal = splitDuplicates(db.fetal_readings, fetal, fetalKey);
        const freshMaternal = splitDuplicates(db.maternal_readings, maternal, maternalKey);
        result.duplicates += freshFetal.duplicates.length + freshMaternal.duplicates.length;
        ops.push({ op: 'insert', table: 'check_sessions', row: { ...session, syncState: 'synced' } });
        ops.push({ op: 'insertMany', table: 'fetal_readings', rows: freshFetal.fresh.map((r) => ({ ...r, syncState: 'synced' })) });
        ops.push({ op: 'insertMany', table: 'maternal_readings', rows: freshMaternal.fresh.map((r) => ({ ...r, syncState: 'synced' })) });
      }
      commit(ops);
      result.inserted += 1;

      // The server runs the rules the first time it sees a check.
      const after = state().db;
      const candidates = [];
      const windows = after.fetal_readings.filter((r) => r.session_id === sessionId).sort((a, b) => a.taken_at - b.taken_at);
      const vitals = after.maternal_readings.filter((r) => r.session_id === sessionId).sort((a, b) => a.taken_at - b.taken_at);
      candidates.push(evaluateFhr(windows, th));
      if (vitals.length) candidates.push(evaluateMaternalVitals(vitals[vitals.length - 1], th));
      const summaries = after.check_sessions
        .filter((s) => s.patient_id === patientId && s.syncState === 'synced')
        .sort((a, b) => a.started_at - b.started_at)
        .map((s) => s.summary);
      candidates.push(evaluateSignalLoss(summaries, th));
      for (const candidate of candidates.filter(Boolean)) {
        const raised = raiseAlert(patientId, candidate, { readingRef: sessionId });
        (raised.created ? result.alerts.created : result.alerts.merged).push(raised.alert);
      }
    }
    commit([{ op: 'meta', patch: { last_synced_at: now() } }]);
    return result;
  }

  /**
   * The app learned a device's battery and charging state from a status packet. Updates the device record, logs a
   * change, tells the patient at Low and raises the battery alert at Critical and Cutoff (spec 9.5). The messages go
   * out only while online.
   */
  function recordDeviceStatus(serial, { battery, charging, exposureLeft }) {
    const device = state().db.devices.find((d) => d.serial === serial);
    if (!device) return null;
    const th = thresholds();
    const at = now();
    const changed = battery !== device.battery_pct || charging !== device.charging;
    const patch = { last_seen_at: at, link_state: 'connected' };
    // The belt reports how many transmit seconds are left in the rolling hour; Check now reads it from the record.
    if (exposureLeft !== undefined) patch.exposure_left_s = exposureLeft;
    const ops = [];
    if (changed) {
      Object.assign(patch, { battery_pct: battery, charging, battery_updated_at: at });
      ops.push({
        op: 'insert',
        table: 'device_status_log',
        row: { id: id('dsl'), device_id: device.id, at, battery_pct: battery, vcell_mv: voltageForPct(battery), charging, state: device.type === 'belt' ? 'ACTIVE_IDLE' : 'CONNECTED_IDLE' },
      });
    }
    ops.push({ op: 'update', table: 'devices', id: device.id, patch });
    commit(ops);
    if (!changed || !isOnline()) return { device: { ...device, ...patch }, alert: null };

    const before = batteryLevel(device.battery_pct, null, th);
    const level = batteryLevel(battery, null, th);
    if (level === 'low' && before === 'normal' && !charging) {
      sendPush([device.patient_id], 'battery_low', { serial, device: device.type, pct: battery });
    }
    const candidate = evaluateBattery({ pct: battery, vcellMv: voltageForPct(battery), charging, serial, deviceType: device.type }, th);
    const alert = candidate ? raiseAlert(device.patient_id, candidate) : null;
    return { device: { ...device, ...patch }, alert };
  }

  /** The link to a device dropped or came back. */
  function recordLink(serial, connected) {
    const device = state().db.devices.find((d) => d.serial === serial);
    if (!device) return;
    commit([{ op: 'update', table: 'devices', id: device.id, patch: connected ? { link_state: 'connected', last_seen_at: now() } : { link_state: 'disconnected' } }]);
  }

  /** Missed check (ALR-01): no completed check in the configured hours since the last one, or since pairing. */
  function checkMissed(patientId) {
    const db = state().db;
    const devices = db.devices.filter((d) => d.patient_id === patientId);
    if (devices.length === 0) return null;
    const completed = db.check_sessions.filter((s) => s.patient_id === patientId && s.status === 'completed' && s.syncState === 'synced');
    const lastCompletedAt = completed.length ? Math.max(...completed.map((s) => s.ended_at)) : null;
    const candidate = evaluateMissedCheck(
      { lastCompletedAt, pairedAt: Math.min(...devices.map((d) => d.paired_at)), now: now() },
      thresholds(),
    );
    return candidate ? raiseAlert(patientId, candidate) : null;
  }

  /**
   * Upload what was made offline, oldest first (spec 3.2). Checks go through ingest_readings, which removes duplicates;
   * queued messages are marked delivered. Battery alerts are evaluated for devices whose status changed while offline.
   */
  function flushQueue() {
    const summary = { checks: 0, messages: 0, duplicates: 0, requests: 0, edits: 0 };
    const db = state().db;
    const queued = queuedInOrder(db.check_sessions);
    const patients = [...new Set(queued.map((s) => s.patient_id))];
    for (const patientId of patients) {
      const checks = queued
        .filter((s) => s.patient_id === patientId)
        .map((session) => ({
          session,
          fetal: db.fetal_readings.filter((r) => r.session_id === session.id),
          maternal: db.maternal_readings.filter((r) => r.session_id === session.id),
        }));
      const result = ingestReadings({ patient_id: patientId, checks });
      summary.checks += result.inserted;
      summary.duplicates += result.duplicates;
    }
    // What she asked of the office while offline reaches it now, oldest first; edits to her own details take effect (last write wins).
    const requests = queuedInOrder(state().db.requests);
    for (const request of requests) {
      commit([{ op: 'update', table: 'requests', id: request.id, patch: { syncState: 'synced' } }]);
      deliverRequest(request);
    }
    summary.requests = requests.length;
    const edits = state().db.patients.filter((row) => row.queued_edit);
    for (const row of edits) commit(personalEditOps(row.id, row.queued_edit.values));
    summary.edits = edits.length;
    const messages = queuedInOrder(state().db.messages);
    if (messages.length) {
      const at = now();
      commit([{ op: 'updateMany', table: 'messages', patches: messages.map((m) => ({ id: m.id, patch: { syncState: 'synced', delivered_at: at } })) }]);
      summary.messages = messages.length;
    }
    const devicePatients = [...new Set(state().db.devices.map((d) => d.patient_id))];
    for (const patientId of devicePatients) {
      for (const device of state().db.devices.filter((d) => d.patient_id === patientId)) {
        const candidate = evaluateBattery(
          { pct: device.battery_pct, vcellMv: voltageForPct(device.battery_pct), charging: device.charging, serial: device.serial, deviceType: device.type },
          thresholds(),
        );
        if (candidate) raiseAlert(patientId, candidate);
      }
    }
    commit([{ op: 'meta', patch: { last_synced_at: now() } }]);
    return summary;
  }

  /** Online brings the queue up to date; offline keeps new readings and messages on the phone. */
  function setConnection(connection) {
    commit([{ op: 'meta', patch: { connection } }]);
    return connection === 'online' ? flushQueue() : null;
  }

  return {
    id,
    state,
    commit,
    thresholds,
    isOnline,
    alertRecipients,
    sendPush,
    raiseAlert,
    escalateAlert,
    sweepEscalations,
    sweepReminders,
    deliverRequest,
    personalEditOps,
    evaluateOnPhone,
    relaySos,
    ingestReadings,
    recordDeviceStatus,
    recordLink,
    checkMissed,
    flushQueue,
    setConnection,
  };
}
