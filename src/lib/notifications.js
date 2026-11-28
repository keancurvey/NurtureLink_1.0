// What a notification says and where it leads (COM-03, ALR-03). Pure: the screens turn keys and values into text.
import { TABS } from './permissions.js';
import { toneOfType } from './alertView.js';

/** Notifications about alerts get the sound and vibration of ALR-03. */
export const isAlertClass = (notification) => notification.type === 'alert' || notification.type === 'alert_notice';

export const isUnread = (notification) => notification.read_at === null || notification.read_at === undefined;

export const unreadCount = (notifications, profileId) => notifications.filter((n) => n.profile_id === profileId && isUnread(n)).length;

/** SOS gets the longer pattern; every other alert the short one; everything else is a quiet banner. */
export const signalKind = (notification) => {
  if (!isAlertClass(notification)) return null;
  return notification.payload?.alert_type === 'sos' ? 'sos' : 'alert';
};

const tab = (role, name) => (TABS[role]?.includes(name) ? `/${role}/${name}` : `/${role}/${TABS[role]?.[0] ?? ''}`);

/**
 * The screen a notification opens (COM-03). An alert opens its permanent detail screen; the rest open the tab that
 * holds the thing they are about. A notice the phone made before the alert reached the server opens Home.
 */
export function notificationPath(role, notification) {
  const p = notification.payload ?? {};
  switch (notification.type) {
    case 'alert':
    case 'alert_notice':
      return p.alert_id ? `/alerts/${p.alert_id}` : tab(role, 'home');
    case 'battery_low':
      return tab(role, 'home');
    case 'message': // a message opens its thread: the patient's own, or a barangay account's chat with that patient
      if (role === 'patient' && p.conversation_id) return `/patient/consult/chat/${p.conversation_id}`;
      if (role === 'barangay' && p.patient_id) return `/barangay/chat/${p.patient_id}`;
      if (role === 'super' && p.conversation_id) return `/super/consult/chat/${p.conversation_id}`;
      return role === 'barangay' ? tab(role, 'chat') : tab(role, 'consult');
    case 'booking_request':
    case 'barangay_change_request':
    case 'appointment_proposal':
    case 'referral':
    case 'appointment_started':
    case 'follow_up_open':
      return role === 'barangay' ? tab(role, 'chat') : tab(role, 'consult');
    case 'reschedule_request': // the approvals queue for a super account; the calendar for the barangay account whose patient's visit is moving
      return role === 'barangay' ? tab(role, 'calendar') : tab(role, 'consult');
    case 'appointment_declined': // the patient sees the answer in her booking requests
    case 'request_decided':
      return role === 'patient' && (p.kind === 'reschedule') ? tab(role, 'schedule') : role === 'patient' && p.kind === 'barangay_change' ? tab(role, 'profile') : role === 'barangay' ? tab(role, 'calendar') : tab(role, 'consult');
    case 'appointment_rescheduled':
    case 'appointment_approved':
    case 'appointment_reminder':
    case 'event_created':
    case 'event_reminder':
      return role === 'barangay' ? tab(role, 'calendar') : tab(role, 'schedule');
    case 'video_usage_warning':
      return tab(role, 'profile');
    default:
      return tab(role, TABS[role][0]);
  }
}

const ICONS = { alert: 'alert', alert_notice: 'alert', battery_low: 'battery', booking_request: 'calendar', reschedule_request: 'calendar', barangay_change_request: 'chat', appointment_proposal: 'calendar', appointment_reminder: 'calendar', appointment_approved: 'calendar', appointment_rescheduled: 'calendar', appointment_declined: 'calendar', request_decided: 'calendar', appointment_started: 'video', follow_up_open: 'chat', event_created: 'calendar', event_reminder: 'calendar', message: 'chat', referral: 'chat', video_usage_warning: 'video' };

/**
 * What to show for a notification: texts are keys under alerts:notification.*, values may hold `...Key` entries that the
 * screen translates first (for example typeKey becomes type). context: { role, patientName, eventTitle }.
 */
export function describeNotification(notification, { role, patientName = null, eventTitle = null } = {}) {
  const p = notification.payload ?? {};
  const audience = role === 'patient' ? 'patient' : 'provider';
  const typeKey = p.alert_type ? `type.${p.alert_type}.${audience}` : null;
  const base = { icon: ICONS[notification.type] ?? 'bell', path: notificationPath(role, notification), unread: isUnread(notification) };
  switch (notification.type) {
    case 'alert': {
      const escalated = Boolean(p.escalated);
      const variant = p.cancelled ? 'cancelled' : escalated ? 'escalated' : 'new';
      return { ...base, tone: p.cancelled ? 'neutral' : toneOfType(p.alert_type, escalated), titleKey: `notification.alert.${variant}`, values: { patient: patientName ?? '', typeKey } };
    }
    case 'alert_notice':
      return { ...base, tone: toneOfType(p.alert_type), titleKey: 'notification.alert_notice', bodyKey: 'notification.alert_notice_body', values: { typeKey } };
    case 'battery_low':
      return { ...base, tone: 'attention', titleKey: `notification.battery_low.${p.device === 'band' ? 'band' : 'belt'}`, values: { pct: p.pct } };
    case 'booking_request':
      return { ...base, tone: 'info', titleKey: 'notification.booking_request', values: { patient: patientName ?? '' } };
    case 'reschedule_request':
      return { ...base, tone: 'info', titleKey: 'notification.reschedule_request', values: { patient: patientName ?? '' } };
    case 'barangay_change_request':
      return { ...base, tone: 'info', titleKey: 'notification.barangay_change_request', values: { patient: patientName ?? '' } };
    case 'appointment_proposal':
      return { ...base, tone: 'info', titleKey: 'notification.appointment_proposal', values: { patient: patientName ?? '' } };
    case 'appointment_reminder':
      return { ...base, tone: 'info', titleKey: `notification.appointment_reminder.${p.lead === 'hours' ? 'hours' : 'day'}`, values: { kindKey: `notification.kind.${p.kind ?? 'clinic'}` } };
    case 'appointment_approved':
      return { ...base, tone: 'info', titleKey: role === 'patient' ? 'notification.appointment_approved.patient' : 'notification.appointment_approved.provider', values: { patient: patientName ?? '' } };
    case 'appointment_rescheduled':
      return { ...base, tone: 'info', titleKey: 'notification.appointment_rescheduled', values: {} };
    case 'appointment_declined':
      return { ...base, tone: 'neutral', titleKey: 'notification.appointment_declined', values: {} };
    case 'request_decided': {
      const status = p.status === 'approved' ? 'approved' : 'declined';
      const kind = p.kind === 'barangay_change' || p.kind === 'appointment_proposal' ? p.kind : 'reschedule';
      return { ...base, tone: status === 'approved' ? 'info' : 'neutral', titleKey: `notification.request_decided.${kind}.${status}`, values: { patient: patientName ?? '' } };
    }
    case 'appointment_started':
      return { ...base, tone: 'info', titleKey: role === 'patient' ? 'notification.appointment_started.patient' : 'notification.appointment_started.provider', values: { patient: patientName ?? '' } };
    case 'follow_up_open':
      return { ...base, tone: 'info', titleKey: 'notification.follow_up_open', values: {} };
    case 'event_created':
      return { ...base, tone: 'info', titleKey: 'notification.event_created', values: { title: eventTitle ?? '' } };
    case 'event_reminder':
      return { ...base, tone: 'info', titleKey: p.lead ? `notification.event_reminder_lead.${p.lead === 'hours' ? 'hours' : 'day'}` : 'notification.event_reminder', values: { title: eventTitle ?? '' } };
    case 'message':
      return { ...base, tone: 'info', titleKey: role === 'patient' ? 'notification.message.patient' : 'notification.message.provider', values: { patient: patientName ?? '' } };
    case 'referral':
      return { ...base, tone: 'info', titleKey: 'notification.referral', bodyText: p.reason ?? null, values: { patient: patientName ?? '' } };
    case 'video_usage_warning':
      return { ...base, tone: 'attention', titleKey: 'notification.video_usage_warning', values: { percent: p.limit ? Math.round((p.used / p.limit) * 100) : 80 } };
    default:
      return { ...base, tone: 'neutral', titleKey: 'notification.other', values: {} };
  }
}

/**
 * Banners on screen (ALR-03): the newest first, and at most `max` of them. Older ones fold into one group banner that
 * counts them, so a burst of notifications never covers the screen. A banner is { id, ... } or { id, group: true, count }.
 */
export function stackBanners(banners, max = 3) {
  if (banners.length <= max) return banners;
  const keep = banners.slice(0, max - 1);
  const folded = banners.slice(max - 1);
  const count = folded.reduce((sum, b) => sum + (b.group ? b.count : 1), 0);
  return [...keep, { id: 'group', group: true, count, expiresAt: Math.max(...folded.map((b) => b.expiresAt)) }];
}

/** How long a banner stays: alerts a little longer than the rest (ALR-03: auto-dismiss). */
export const BANNER_MS = { alert: 10000, other: 6000 };
/** After a banner was pointed at or focused, it stays at least this long once the pointer or focus leaves. */
export const RESUME_MS = 2500;
