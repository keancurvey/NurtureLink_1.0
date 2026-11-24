// Turning consult codes into words for the Consult screens (useTranslation('consult')).

/** A booking status as a badge: [status for the Badge, text key]. Never colour alone: the Badge has an icon and the label. */
export const BOOKING_BADGE = {
  pending: ['info', 'bookings.status.pending'],
  approved: ['normal', 'bookings.status.approved'],
  declined: ['attention', 'bookings.status.declined'],
  rescheduled: ['info', 'bookings.status.rescheduled'],
};

/** Why a midwife thread is locked, as a short line (the list) or in full (the thread). */
export const lockText = (t, reason, full = false) =>
  t(`${full ? 'chat' : 'threads'}.locked${reason === 'follow_up_over' ? 'FollowUpOver' : 'NoAppointment'}`);

/** The name a thread shows: the barangay health team, or the midwife's own name when she is assigned. */
export const threadName = (t, conversation, people) =>
  conversation.kind === 'barangay' ? t('threads.barangay') : people[0]?.name ?? t('threads.midwife');
