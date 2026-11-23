// Reminders before an appointment or an event (PAT-S-04): one day and two hours before, each sent once. Pure: the
// server core (core.sweepReminders) sends what this finds and remembers it on the row (`reminded`).
import { MS_HOUR } from './dates.js';

/** The reminders in the order they come; the last one due wins when several are due at once. */
export const LEADS = ['day', 'hours'];

export const leadMs = (thresholds) => ({ day: thresholds.reminders.dayBeforeHours * MS_HOUR, hours: thresholds.reminders.hoursBefore * MS_HOUR });

/**
 * What is due now: [{ source: 'appointment' | 'event', id, lead, mark }]. `lead` is the reminder to send and `mark` every
 * lead to remember as done (an earlier one that is also due is not sent after the later one). A reminder whose time came
 * before `since` (the moment the records were built) belongs to history and is left alone, like the escalation sweep.
 */
export function dueReminders({ appointments = [], events = [], now, since = 0, thresholds }) {
  const lead = leadMs(thresholds);
  const due = [];
  const consider = (source, id, startsAt, reminded = []) => {
    if (startsAt == null || startsAt <= now) return;
    const ready = LEADS.filter((name) => now >= startsAt - lead[name] && startsAt - lead[name] >= since && !reminded.includes(name));
    if (ready.length > 0) due.push({ source, id, lead: ready[ready.length - 1], mark: ready });
  };
  for (const row of appointments) if (row.status === 'approved') consider('appointment', row.id, row.scheduled_at, row.reminded);
  for (const row of events) consider('event', row.id, row.starts_at, row.reminded);
  return due;
}
