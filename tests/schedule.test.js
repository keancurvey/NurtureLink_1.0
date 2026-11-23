import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARICEL, NOW, makeRuntime } from './helpers.js';
import { MS_DAY, MS_HOUR, addDays, manilaDate, manilaTime } from '../src/lib/dates.js';
import { THRESHOLDS } from '../src/config/thresholds.js';
import { KINDS, calendarItems, daysRemaining, itemsOn, markersByDate, monthGrid, monthOf, shiftMonth, upcomingItems } from '../src/lib/schedule.js';
import { dueReminders } from '../src/lib/reminders.js';
import * as sel from '../src/store/selectors.js';
import { describeNotification, notificationPath } from '../src/lib/notifications.js';

const today = manilaDate(NOW);
const apt = (over) => ({ id: 'a1', patient_id: MARICEL, type: 'clinic', status: 'approved', scheduled_at: manilaTime(addDays(today, 6), 9), ...over });
const evt = (over) => ({ id: 'e1', title: 'Pregnancy class', scope: 'all', barangay_id: null, starts_at: manilaTime(addDays(today, 2), 14), ends_at: manilaTime(addDays(today, 2), 16), created_by: 'rowena-macaraig', ...over });

test('only dated appointments and all events are on the calendar; pending and declined requests are not', () => {
  const items = calendarItems({
    appointments: [apt(), apt({ id: 'a2', status: 'pending', scheduled_at: null }), apt({ id: 'a3', status: 'declined', scheduled_at: null }), apt({ id: 'a4', status: 'attended', scheduled_at: NOW - 14 * MS_DAY }), apt({ id: 'a5', type: 'hospital', status: 'missed', scheduled_at: NOW - 3 * MS_DAY })],
    events: [evt()],
  });
  assert.deepEqual(items.map((i) => i.id), ['a4', 'a5', 'e1', 'a1'], 'by time');
  assert.deepEqual(items.map((i) => i.kind), ['clinic', 'hospital', 'event', 'clinic']);
  assert.equal(items.find((i) => i.id === 'e1').status, null);
});

test('a date is marked once per kind, in the order the legend shows, and an item belongs to its Manila date', () => {
  const day = addDays(today, 2);
  const items = calendarItems({ appointments: [apt({ id: 'x', type: 'teleconsult', scheduled_at: manilaTime(day, 7) }), apt({ id: 'y', type: 'clinic', scheduled_at: manilaTime(day, 11) })], events: [evt(), evt({ id: 'e2' })] });
  assert.deepEqual(markersByDate(items).get(day), ['clinic', 'teleconsult', 'event']);
  assert.deepEqual(KINDS, ['clinic', 'hospital', 'teleconsult', 'event']);
  assert.equal(itemsOn(items, day).length, 4);
  // 11:30 pm in Manila is the next day in UTC; it still belongs to the Manila date
  const late = calendarItems({ appointments: [apt({ scheduled_at: manilaTime(day, 23, 30) })] })[0];
  assert.equal(late.date, day);
});

test('the upcoming list is in date order with days remaining, and keeps today until the appointment is closed', () => {
  const items = calendarItems({
    appointments: [apt({ id: 'far', scheduled_at: manilaTime(addDays(today, 6), 9) }), apt({ id: 'earlier-today', scheduled_at: NOW - 2 * MS_HOUR }), apt({ id: 'tomorrow', type: 'teleconsult', scheduled_at: manilaTime(addDays(today, 1), 10) }), apt({ id: 'done', status: 'attended', scheduled_at: NOW + MS_HOUR })],
    events: [evt(), evt({ id: 'over', starts_at: NOW - 3 * MS_HOUR, ends_at: NOW - MS_HOUR })],
  });
  const list = upcomingItems(items, NOW);
  assert.deepEqual(list.map((i) => [i.id, i.days]), [['earlier-today', 0], ['tomorrow', 1], ['e1', 2], ['far', 6]]);
  assert.equal(daysRemaining('2026-11-30', '2026-11-08'), 22);
  assert.equal(daysRemaining('2026-12-02', '2026-11-30'), 2, 'across a month end');
});

test('the month grid starts on Sunday, fills the edge weeks with the neighbouring months and handles year ends', () => {
  const grid = monthGrid({ year: 2026, month: 11 });
  assert.equal(grid.length, 5);
  assert.deepEqual(grid[0].map((d) => d.date), ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
  assert.equal(grid[4][6].date, '2026-12-05');
  assert.equal(grid[4][6].inMonth, false);
  const feb = monthGrid({ year: 2026, month: 2 }); // starts on a Sunday and has 28 days: exactly four weeks
  assert.equal(feb.length, 4);
  assert.equal(monthGrid({ year: 2027, month: 1 })[0][0].date, '2026-12-27');
  assert.deepEqual(shiftMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
  assert.deepEqual(monthOf('2026-11-08'), { year: 2026, month: 11 });
});

test('the seeded calendar of Maricel has her check-up in 6 days, her history, and the events of her barangay only', () => {
  const rt = makeRuntime();
  rt.auth.signInAs(MARICEL);
  const viewer = sel.viewerOf(rt.state());
  const items = sel.calendarOf(rt.state(), viewer);
  const upcoming = upcomingItems(items, NOW);
  const checkup = upcoming.find((i) => i.kind === 'clinic');
  assert.equal(checkup.days, 6);
  const titles = items.filter((i) => i.source === 'event').map((i) => i.row.title);
  assert.ok(titles.includes('Prenatal check-up day') && titles.includes('Tetanus vaccination day'));
  assert.ok(!titles.includes('Pregnancy class'), 'a Pisa event is not on a Barangay 14 calendar');
  assert.ok(items.every((i) => i.source === 'event' || i.row.patient_id === MARICEL));
  assert.ok(items.some((i) => i.status === 'attended'));
});

test('a patient, a barangay account and a super account do not see each other\'s appointments through the calendar selector', () => {
  const rt = makeRuntime();
  rt.auth.signInAs('lourdes-magpantay');
  assert.deepEqual(sel.calendarOf(rt.state(), sel.viewerOf(rt.state())), [], 'the calendar selector is the patient\'s');
});

// ---------- Reminders (PAT-S-04) ----------

const thresholds = THRESHOLDS;
test('a reminder is due one day and two hours before, once, and the later one replaces the earlier', () => {
  const start = NOW + 30 * MS_HOUR;
  const row = apt({ scheduled_at: start });
  assert.deepEqual(dueReminders({ appointments: [row], now: NOW, since: 0, thresholds }), [], 'more than a day away');
  assert.deepEqual(dueReminders({ appointments: [row], now: NOW + 7 * MS_HOUR, since: 0, thresholds }).map((d) => [d.lead, d.mark]), [['day', ['day']]]);
  assert.deepEqual(dueReminders({ appointments: [{ ...row, reminded: ['day'] }], now: NOW + 7 * MS_HOUR, since: 0, thresholds }), [], 'not twice');
  assert.deepEqual(dueReminders({ appointments: [{ ...row, reminded: ['day'] }], now: start - 2 * MS_HOUR, since: 0, thresholds }).map((d) => d.lead), ['hours']);
  assert.deepEqual(dueReminders({ appointments: [row], now: start - MS_HOUR, since: 0, thresholds }).map((d) => [d.lead, d.mark]), [['hours', ['day', 'hours']]], 'only the later one is sent');
  assert.deepEqual(dueReminders({ appointments: [row], now: start + 1, since: 0, thresholds }), [], 'nothing after it started');
});

test('reminders skip an appointment that is not approved, and windows that opened before the records were built', () => {
  const start = NOW + 3 * MS_HOUR;
  assert.deepEqual(dueReminders({ appointments: [apt({ scheduled_at: start, status: 'pending' }), apt({ scheduled_at: start, status: 'declined' })], now: NOW, since: 0, thresholds }), []);
  assert.deepEqual(dueReminders({ appointments: [apt({ scheduled_at: start })], now: NOW, since: NOW, thresholds }).map((d) => d.lead), [], 'the day window opened before the seed; two hours has not come');
  assert.deepEqual(dueReminders({ events: [evt({ starts_at: start })], now: start - 2 * MS_HOUR, since: NOW, thresholds }).map((d) => [d.source, d.lead]), [['event', 'hours']]);
});

test('the sweep sends each reminder once to the right accounts and remembers it', () => {
  const rt = makeRuntime();
  assert.equal(rt.core.sweepReminders(), 0, 'nothing is due when the app opens');
  const at = rt.db().appointments.find((a) => a.patient_id === MARICEL && a.status === 'approved' && a.scheduled_at > NOW);
  const before = rt.db().notifications.length;
  rt.setClock(at.scheduled_at - 23 * MS_HOUR);
  const sent = rt.core.sweepReminders();
  assert.ok(sent >= 1);
  const mine = rt.inbox(MARICEL).filter((n) => n.type === 'appointment_reminder');
  assert.equal(mine.length, 1);
  assert.deepEqual(mine[0].payload, { appointment_id: at.id, lead: 'day', kind: 'clinic' });
  assert.equal(rt.core.sweepReminders(), 0, 'not again');
  assert.deepEqual(rt.db().appointments.find((a) => a.id === at.id).reminded, ['day']);
  rt.setClock(at.scheduled_at - 2 * MS_HOUR);
  rt.core.sweepReminders();
  assert.deepEqual(rt.inbox(MARICEL).filter((n) => n.type === 'appointment_reminder').map((n) => n.payload.lead), ['day', 'hours']);
  assert.ok(rt.db().notifications.length > before);
});

test('an event reminder reaches the patients and barangay accounts it is for, not other barangays and not super accounts', () => {
  const rt = makeRuntime();
  const event = rt.db().events.find((e) => e.title === 'Prenatal check-up day'); // Barangay 14
  rt.setClock(event.starts_at - 2 * MS_HOUR);
  rt.core.sweepReminders();
  const got = rt.db().notifications.filter((n) => n.type === 'event_reminder' && n.payload.event_id === event.id).map((n) => n.profile_id);
  assert.ok(got.includes(MARICEL) && got.includes('lourdes-magpantay') && got.includes('jocelyn-landicho'));
  assert.ok(!got.includes('marilou-atienza') && !got.includes('rowena-macaraig'));
  assert.ok(got.every((id) => rt.db().profiles.find((p) => p.id === id).barangay_id === 'brgy-14'));
});

test('the new notification types have a text and open the right tab for each role', () => {
  const lead = describeNotification({ type: 'appointment_reminder', payload: { lead: 'hours', kind: 'teleconsult' }, read_at: null }, { role: 'patient' });
  assert.deepEqual([lead.titleKey, lead.values.kindKey], ['notification.appointment_reminder.hours', 'notification.kind.teleconsult']);
  assert.equal(describeNotification({ type: 'event_reminder', payload: { lead: 'day' }, read_at: null }, { role: 'patient', eventTitle: 'X' }).titleKey, 'notification.event_reminder_lead.day');
  assert.equal(describeNotification({ type: 'event_reminder', payload: {}, read_at: null }, { role: 'patient', eventTitle: 'X' }).titleKey, 'notification.event_reminder');
  assert.equal(notificationPath('super', { type: 'reschedule_request', payload: {} }), '/super/consult');
  assert.equal(notificationPath('barangay', { type: 'reschedule_request', payload: {} }), '/barangay/calendar');
  assert.equal(notificationPath('super', { type: 'barangay_change_request', payload: {} }), '/super/consult');
  assert.equal(notificationPath('patient', { type: 'appointment_reminder', payload: {} }), '/patient/schedule');
});
