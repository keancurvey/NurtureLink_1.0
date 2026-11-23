// Turning calendar items into words for the Schedule screens (useTranslation('schedule')).

const KNOWN_PLACES = { 'Barangay health station': 'place.clinic', 'Tingloy Municipal Health Office': 'place.office', 'Referral hospital, Batangas City': 'place.hospital' };

/** Where: a teleconsultation is a video call; other places are shown in the reader's language when they are the usual ones. */
export function placeText(t, item) {
  if (item.kind === 'teleconsult') return t('place.teleconsult');
  const place = item.row.location ?? item.row.place ?? null;
  if (!place) return t(item.kind === 'hospital' ? 'place.hospital' : 'place.clinic');
  return KNOWN_PLACES[place] ? t(KNOWN_PLACES[place]) : place;
}

/** Appointment status as a badge: [status for the Badge, text key]. */
export const STATUS_BADGE = {
  approved: ['normal', 'status.approved'],
  attended: ['normal', 'status.attended'],
  missed: ['attention', 'status.missed'],
  rescheduled: ['info', 'status.rescheduled'],
};

export const roleText = (t, role) => t(`provider.role.${role}`);
