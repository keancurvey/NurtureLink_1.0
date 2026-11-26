// Words for the barangay screens (useTranslation('monitor')).
import { formatDateShort, formatDaysAway } from '../../lib/format.js';

/** "31w 2d" style gestational age from the monitor namespace. */
export const ageText = (t, weeks, days) => t('pregnancy.ageValue', { weeks, days });

/** The due date and how far away it is, for example "Jan 6, 2027 (in 43 days)". */
export const dueText = (t, edd, daysToEdd, lang) =>
  t(daysToEdd < 0 ? 'pregnancy.duePassed' : 'pregnancy.dueIn', { date: formatDateShort(edd, lang), when: formatDaysAway(daysToEdd, lang) });

/** The badge of a patient's state: [tone, text key]. A patient with no check and no alert has no status. */
export const statusBadge = (status) => (status ? [status, `status.${status}`] : ['neutral', 'status.none']);
