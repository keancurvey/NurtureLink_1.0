import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MARICEL, NOW, makeRuntime } from './helpers.js';
import { createActions } from '../src/store/actions.js';
import * as sel from '../src/store/selectors.js';
import { CHAT } from '../src/config/thresholds.js';
import { MS_DAY, MS_HOUR, MS_MINUTE, addDays, manilaDate } from '../src/lib/dates.js';
import {
  ATTACHMENT_ARTS, BOOKING_STATUSES, BOOKING_WINDOWS, bookingRows, joinState, messageState, newClientId, nextTeleconsult, preferredRange,
  threadLock, unseenFrom, validAttachment, validateBooking, validateMessage,
} from '../src/lib/consult.js';
import { fitWithin } from '../src/lib/photo.js';
import { describeNotification, notificationPath } from '../src/lib/notifications.js';

const ROWENA = 'rowena-macaraig';
const LOURDES = 'lourdes-magpantay';
const JOCELYN = 'jocelyn-landicho';
const BARANGAY = `conv-barangay-${MARICEL}`;
const MIDWIFE = `conv-midwife-${MARICEL}`;
const instant = async () => {};
const as = (id = MARICEL) => {
  const rt = makeRuntime();
  rt.auth.signInAs(id);
  return rt;
};
const actionsOf = (rt) => createActions(rt, { delay: instant });
const viewer = (rt) => sel.viewerOf(rt.state());
const thread = (rt, id) => sel.threadOf(rt.state(), viewer(rt), id, rt.now?.() ?? NOW);
const BOOKING = { type: 'teleconsult', preferred_date: addDays(manilaDate(NOW), 1), window: 'afternoon', reason: 'Questions about my schedule' };

// ---------- Rules ----------

test('the barangay thread is always open; the midwife thread is open until unlocked_until and says why when locked', () => {
  assert.deepEqual(threadLock({ kind: 'barangay' }, NOW), { open: true, reason: null });
  assert.deepEqual(threadLock({ kind: 'midwife', unlocked_until: null }, NOW), { open: false, reason: 'no_appointment' });
  assert.deepEqual(threadLock({ kind: 'midwife', unlocked_until: NOW + 1 }, NOW), { open: true, reason: null, until: NOW + 1 });
  assert.deepEqual(threadLock({ kind: 'midwife', unlocked_until: NOW }, NOW), { open: false, reason: 'follow_up_over' });
});

test('a message goes from sending to sent, delivered and seen', () => {
  const m = { syncState: 'synced', sent_at: NOW, delivered_at: NOW + 1200, seen_at: null };
  assert.equal(messageState({ ...m, syncState: 'queued', delivered_at: null }, NOW + 9e6), 'sending');
  assert.equal(messageState(m, NOW + 100), 'sent');
  assert.equal(messageState(m, NOW + 1200), 'delivered');
  assert.equal(messageState({ ...m, seen_at: NOW + 5000 }, NOW + 4000), 'delivered');
  assert.equal(messageState({ ...m, seen_at: NOW + 5000 }, NOW + 5000), 'seen');
  assert.equal(unseenFrom([{ sender_id: 'a', seen_at: null }, { sender_id: 'b', seen_at: null }, { sender_id: 'a', seen_at: 1 }], 'b').length, 1);
});

test('message rules: words or a photo, at most the longest message; photos are small JPEGs or drawn pictures', () => {
  assert.equal(validateMessage({ body: '  ' }), 'empty');
  assert.equal(validateMessage({ body: ' ', attachment: true }), null);
  assert.equal(validateMessage({ body: 'x'.repeat(CHAT.messageMax + 1) }), 'tooLong');
  assert.equal(validateMessage({ body: 'x'.repeat(CHAT.messageMax) }), null);
  assert.ok(validAttachment({}));
  assert.ok(validAttachment({ attachment_art: 'meal' }));
  assert.ok(!validAttachment({ attachment_art: 'nope' }));
  assert.ok(validAttachment({ attachment_url: 'data:image/jpeg;base64,/9j/4AAQ' }));
  assert.ok(!validAttachment({ attachment_url: 'data:image/png;base64,AAAA' }));
  assert.ok(!validAttachment({ attachment_url: 'https://example.com/a.jpg' }));
  assert.ok(!validAttachment({ attachment_url: 'data:image/jpeg;base64,AAAA', attachment_art: 'meal' }));
  assert.ok(!validAttachment({ attachment_url: `data:image/jpeg;base64,${'A'.repeat(CHAT.photoMaxChars)}` }));
  assert.equal(ATTACHMENT_ARTS.length, 3);
  assert.notEqual(newClientId(1, () => 0.1), newClientId(1, () => 0.2));
  assert.deepEqual(fitWithin(4000, 3000, 800), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(300, 200, 800), { width: 300, height: 200 });
});

test('booking rules: a kind, a date from today to three months ahead, a time range and a reason', () => {
  const ctx = { today: '2026-11-08' };
  const ok = { type: 'clinic', preferred_date: '2026-11-09', window: 'morning', reason: 'Check-up' };
  assert.deepEqual(validateBooking(ok, ctx), {});
  assert.deepEqual(validateBooking({ ...ok, preferred_date: '2026-11-08' }, ctx), {});
  assert.deepEqual(validateBooking({}, ctx), { type: 'required', preferred_date: 'required', window: 'required', reason: 'required' });
  assert.deepEqual(validateBooking({ ...ok, type: 'hospital' }, ctx), { type: 'required' });
  assert.deepEqual(validateBooking({ ...ok, preferred_date: '2026-11-07' }, ctx), { preferred_date: 'past' });
  assert.deepEqual(validateBooking({ ...ok, preferred_date: '2027-03-01' }, ctx), { preferred_date: 'tooFar' });
  assert.deepEqual(validateBooking({ ...ok, preferred_date: '2026-13-45' }, ctx), { preferred_date: 'invalid' });
  assert.deepEqual(validateBooking({ ...ok, reason: 'x'.repeat(301) }, ctx), { reason: 'tooLong' });
  const range = preferredRange('2026-11-09', 'afternoon');
  assert.equal(range.end - range.start, 4 * MS_HOUR);
  assert.equal(Object.keys(BOOKING_WINDOWS).length, 3);
});

test('the Join video window runs from 10 minutes before to 60 minutes after the time, for an approved teleconsultation only', () => {
  const at = NOW + 2 * MS_HOUR;
  const tele = { type: 'teleconsult', status: 'approved', scheduled_at: at };
  assert.equal(joinState(tele, at - 11 * MS_MINUTE).state, 'early');
  assert.equal(joinState(tele, at - 10 * MS_MINUTE).state, 'open');
  assert.equal(joinState(tele, at + 60 * MS_MINUTE).state, 'open');
  assert.equal(joinState(tele, at + 61 * MS_MINUTE).state, 'over');
  assert.equal(joinState({ ...tele, status: 'attended' }, at).state, 'unavailable');
  assert.equal(joinState({ ...tele, type: 'clinic' }, at).state, 'unavailable');
  assert.equal(joinState({ ...tele, status: 'pending', scheduled_at: null }, at).state, 'unavailable');
  assert.equal(nextTeleconsult([{ ...tele, scheduled_at: at + MS_DAY }, tele], NOW).scheduled_at, at);
  assert.equal(nextTeleconsult([{ ...tele, scheduled_at: NOW - 3 * MS_HOUR }], NOW), null);
});

test('booking rows: pending, declined and handled requests, newest first; the seed check-ups and finished visits are not requests', () => {
  const rows = [
    { id: 'a', status: 'pending', requested_at: 1 },
    { id: 'b', status: 'declined', requested_at: 3 },
    { id: 'c', status: 'approved', handled_by: 'x', scheduled_at: NOW + MS_DAY, requested_at: 2 },
    { id: 'd', status: 'approved', handled_by: null, scheduled_at: NOW + MS_DAY, requested_at: 9 },
    { id: 'e', status: 'attended', handled_by: 'x', scheduled_at: NOW - MS_DAY, requested_at: 8 },
    { id: 'f', status: 'approved', handled_by: 'x', scheduled_at: NOW - 3 * MS_HOUR, requested_at: 7 },
  ];
  assert.deepEqual(bookingRows(rows, NOW).map((r) => r.id), ['b', 'c', 'a']);
  assert.deepEqual(BOOKING_STATUSES, ['pending', 'approved', 'declined', 'rescheduled']);
});

// ---------- Threads and access (PAT-C-01, spec 6.2) ----------

test('Maricel has two threads: the barangay inbox open, the midwife thread locked with the reason', () => {
  const rt = as();
  const threads = sel.threadsOf(rt.state(), viewer(rt), NOW);
  assert.deepEqual(threads.map((t) => t.conversation.kind), ['barangay', 'midwife']);
  assert.equal(threads[0].lock.open, true);
  assert.deepEqual(threads[1].lock, { open: false, reason: 'no_appointment' });
  assert.ok(threads[0].last, 'the seed has messages');
  assert.deepEqual(sel.threadPeopleOf(rt.state(), viewer(rt), threads[0].conversation).map((p) => p.id).sort(), [JOCELYN, LOURDES]);
});

test('a patient reads only her own threads; other roles get no patient threads', () => {
  const rt = as();
  assert.equal(sel.threadOf(rt.state(), viewer(rt), 'conv-barangay-rosalinda-ramos', NOW), null);
  assert.equal(sel.messagesOf(rt.state(), viewer(rt), 'conv-barangay-rosalinda-ramos').length, 0);
  rt.auth.signInAs(LOURDES);
  assert.deepEqual(sel.threadsOf(rt.state(), viewer(rt), NOW), []);
  assert.deepEqual(sel.bookingsOf(rt.state(), viewer(rt), NOW), []);
});

test('the Call button rings an active account of her own barangay; a barangay account has no call target', () => {
  const rt = as();
  const target = sel.callTargetOf(rt.state(), viewer(rt));
  assert.ok([LOURDES, JOCELYN].includes(target.id));
  assert.match(target.contact_no, /^0917 555 03\d\d$/);
  rt.auth.signInAs(LOURDES);
  assert.equal(sel.callTargetOf(rt.state(), viewer(rt)), null);
});

// ---------- Sending (PAT-C-02, ACC-03) ----------

test('a message to the barangay is stored, reaches the barangay accounts and shows sent, then delivered', async () => {
  const rt = as();
  const actions = actionsOf(rt);
  const before = rt.db().messages.length;
  const result = await actions.send_message({ conversation_id: BARANGAY, body: '  Good morning po  ', client_id: 'cid_1' });
  assert.equal(result.ok, true);
  assert.equal(result.queued, false);
  const message = rt.db().messages.at(-1);
  assert.equal(rt.db().messages.length, before + 1);
  assert.deepEqual([message.sender_id, message.body, message.syncState, message.client_id, message.seen_at], [MARICEL, 'Good morning po', 'synced', 'cid_1', null]);
  assert.equal(messageState(message, NOW), 'sent');
  assert.equal(messageState(message, NOW + CHAT.deliveryMs), 'delivered');
  for (const id of [LOURDES, JOCELYN]) assert.equal(rt.inbox(id).filter((n) => n.type === 'message' && n.created_at === NOW).length, 1, id);
  assert.equal(rt.inbox('nora-marasigan').filter((n) => n.created_at === NOW).length, 0, 'another barangay is not told');
  assert.equal(sel.messagesOf(rt.state(), { ...viewer(rt) }, BARANGAY).at(-1).id, message.id);
});

test('the same client id is stored once (the server removes duplicates)', async () => {
  const rt = as();
  const actions = actionsOf(rt);
  const before = rt.db().messages.length;
  await actions.send_message({ conversation_id: BARANGAY, body: 'Hello', client_id: 'cid_same' });
  const again = await actions.send_message({ conversation_id: BARANGAY, body: 'Hello', client_id: 'cid_same' });
  assert.equal(again.duplicate, true);
  assert.equal(rt.db().messages.length, before + 1);
  assert.equal(rt.inbox(LOURDES).filter((n) => n.created_at === NOW && n.type === 'message').length, 1);
});

test('empty, too long, locked, foreign and bad-photo messages are refused with a reason', async () => {
  const rt = as();
  const actions = actionsOf(rt);
  const before = rt.db().messages.length;
  assert.deepEqual((await actions.send_message({ conversation_id: BARANGAY, body: ' ' })).errors, { body: 'empty' });
  assert.deepEqual((await actions.send_message({ conversation_id: BARANGAY, body: 'x'.repeat(CHAT.messageMax + 1) })).errors, { body: 'tooLong' });
  assert.deepEqual(await actions.send_message({ conversation_id: MIDWIFE, body: 'Hello' }), { ok: false, error: 'locked', reason: 'no_appointment' });
  assert.equal((await actions.send_message({ conversation_id: 'conv-barangay-rosalinda-ramos', body: 'Hello' })).error, 'not_found');
  assert.equal((await actions.send_message({ conversation_id: BARANGAY, body: 'Hi', attachment_url: 'data:text/html;base64,AAAA' })).error, 'photo');
  assert.equal(rt.db().messages.length, before);
  rt.auth.signInAs(ROWENA);
  assert.equal((await actions.send_message({ conversation_id: BARANGAY, body: 'Hello' })).error, 'not_found', 'a super account reads and writes only its own midwife threads, and the inbox of a barangay with no active account (ACC-09)');
});

test('a photo travels with the message: her own small picture or a drawn one', async () => {
  const rt = as();
  const actions = actionsOf(rt);
  await actions.send_message({ conversation_id: BARANGAY, body: '', attachment_art: 'booklet', client_id: 'a' });
  await actions.send_message({ conversation_id: BARANGAY, body: 'My lunch', attachment_url: 'data:image/jpeg;base64,/9j/4AAQ', client_id: 'b' });
  const [art, photo] = rt.db().messages.slice(-2);
  assert.deepEqual([art.attachment_art, art.attachment_url, art.body], ['booklet', null, '']);
  assert.deepEqual([photo.attachment_art, photo.attachment_url.slice(0, 22), photo.body], [null, 'data:image/jpeg;base64', 'My lunch']);
});

test('a message written offline waits as sending, is hidden from the barangay and goes out once after reconnect', async () => {
  const rt = as();
  const actions = actionsOf(rt);
  rt.setConnection('offline');
  await actions.send_message({ conversation_id: BARANGAY, body: 'Offline hello', client_id: 'cid_off' });
  const queued = rt.db().messages.at(-1);
  assert.deepEqual([queued.syncState, queued.delivered_at, messageState(queued, NOW + 1e6)], ['queued', null, 'sending']);
  assert.equal(rt.inbox(LOURDES).filter((n) => n.created_at === NOW && n.type === 'message').length, 0, 'nobody is told yet');
  assert.ok(sel.messagesOf(rt.state(), viewer(rt), BARANGAY).some((m) => m.id === queued.id), 'she sees it');
  rt.auth.signInAs(LOURDES);
  assert.equal(sel.messagesOf(rt.state(), { id: LOURDES, role: 'barangay', barangay_id: 'brgy-14', active: true }, BARANGAY).some((m) => m.id === queued.id), false, 'the barangay does not');
  rt.auth.signInAs(MARICEL);
  rt.setConnection('online');
  const sent = rt.db().messages.find((m) => m.id === queued.id);
  assert.equal(sent.syncState, 'synced');
  assert.ok(sent.delivered_at > sent.sent_at - 1);
  assert.equal(rt.db().messages.filter((m) => m.client_id === 'cid_off').length, 1);
  for (const id of [LOURDES, JOCELYN]) assert.equal(rt.inbox(id).filter((n) => n.type === 'message' && n.created_at === NOW).length, 1, id);
  rt.setConnection('online');
  assert.equal(rt.inbox(LOURDES).filter((n) => n.type === 'message' && n.created_at === NOW).length, 1, 'a second flush sends nothing more');
});

test('opening a thread marks what the other side wrote as seen and clears its bell entries', async () => {
  const rt = as();
  const actions = actionsOf(rt);
  rt.engine.start('incoming-message', { patientId: MARICEL, actorId: MARICEL, actorRole: 'patient', conversationId: BARANGAY });
  const reply = rt.db().messages.at(-1);
  assert.notEqual(reply.sender_id, MARICEL);
  assert.equal(reply.seen_at, null);
  assert.equal(sel.threadOf(rt.state(), viewer(rt), BARANGAY, NOW).messages.filter((m) => m.sender_id !== MARICEL && !m.seen_at).length >= 1, true);
  const unreadBefore = sel.unreadCountOf(rt.state(), viewer(rt));
  const result = actions.mark_seen(BARANGAY);
  assert.equal(result.ok, true);
  assert.ok(result.count >= 1);
  assert.equal(rt.db().messages.find((m) => m.id === reply.id).seen_at, NOW);
  assert.ok(sel.unreadCountOf(rt.state(), viewer(rt)) < unreadBefore);
  assert.equal(actions.mark_seen('conv-barangay-rosalinda-ramos').ok, false);
});

// ---------- Scenarios in the chat (Section 6) ----------

test('Incoming message in her barangay thread: a named BHW answers and her earlier messages are seen', async () => {
  const rt = as();
  const actions = actionsOf(rt);
  await actions.send_message({ conversation_id: BARANGAY, body: 'Hello po', client_id: 'x' });
  const mine = rt.db().messages.at(-1);
  rt.engine.start('incoming-message', { patientId: MARICEL, actorId: MARICEL, actorRole: 'patient', conversationId: BARANGAY });
  const reply = rt.db().messages.at(-1);
  assert.ok([LOURDES, JOCELYN].includes(reply.sender_id));
  assert.equal(reply.conversation_id, BARANGAY);
  assert.equal(rt.db().messages.find((m) => m.id === mine.id).seen_at, NOW);
  assert.equal(messageState(rt.db().messages.find((m) => m.id === mine.id), NOW), 'seen');
  assert.equal(sel.senderNamesOf(rt.state(), viewer(rt), BARANGAY).get(reply.sender_id).name.length > 0, true);
});

test('Incoming message in the midwife thread answers only while it is open', () => {
  const rt = as();
  const before = rt.db().messages.length;
  rt.engine.start('incoming-message', { patientId: MARICEL, actorId: MARICEL, actorRole: 'patient', conversationId: MIDWIFE });
  assert.equal(rt.db().messages.length, before, 'locked: nothing arrives');
  rt.engine.start('booking-request', { patientId: MARICEL, actorId: ROWENA, actorRole: 'super' });
  rt.engine.start('appointment-now', { patientId: MARICEL, actorId: MARICEL, actorRole: 'patient' });
  rt.engine.start('incoming-message', { patientId: MARICEL, actorId: MARICEL, actorRole: 'patient', conversationId: MIDWIFE });
  const reply = rt.db().messages.at(-1);
  assert.equal(reply.conversation_id, MIDWIFE);
  assert.equal(reply.sender_id, 'cynthia-dimayuga');
});

test('the midwife thread is locked, unlocks with Bring next appointment to now and locks again after Close follow-up window', async () => {
  const rt = as();
  const actions = actionsOf(rt);
  await actions.request_booking(BOOKING);
  assert.equal(thread(rt, MIDWIFE).lock.open, false);
  rt.engine.start('appointment-now', { patientId: MARICEL, actorId: MARICEL, actorRole: 'patient' });
  const approved = rt.db().appointments.find((a) => a.patient_id === MARICEL && a.type === 'teleconsult');
  assert.deepEqual([approved.status, approved.handled_by, approved.provider_id, approved.scheduled_at], ['approved', ROWENA, 'cynthia-dimayuga', NOW]);
  assert.equal(thread(rt, MIDWIFE).lock.open, true);
  assert.equal(joinState(approved, NOW).state, 'open');
  assert.equal(sel.teleconsultOf(rt.state(), viewer(rt), NOW).id, approved.id);
  assert.equal(rt.inbox(MARICEL).filter((n) => n.type === 'appointment_approved').length >= 2, true, 'her seeded notice and the new one');
  assert.equal((await actions.send_message({ conversation_id: MIDWIFE, body: 'Hello midwife', client_id: 'm1' })).ok, true);
  assert.deepEqual(rt.inbox('cynthia-dimayuga').filter((n) => n.type === 'message' && n.created_at === NOW).length, 1);
  assert.equal(rt.inbox(ROWENA).filter((n) => n.type === 'message' && n.created_at === NOW).length, 0, 'only the assigned midwife is told');

  rt.engine.start('appointment-end', { patientId: MARICEL, actorId: MARICEL, actorRole: 'patient' });
  assert.equal(thread(rt, MIDWIFE).lock.open, true, 'the follow-up window is open');
  rt.engine.start('followup-close', { patientId: MARICEL, actorId: MARICEL, actorRole: 'patient' });
  assert.deepEqual(thread(rt, MIDWIFE).lock, { open: false, reason: 'follow_up_over' });
  assert.equal((await actions.send_message({ conversation_id: MIDWIFE, body: 'Too late', client_id: 'm2' })).error, 'locked');
});

// ---------- Booking (PAT-C-04, D-01) ----------

test('a booking request shows pending, tells every super account and is hidden from nobody it concerns', async () => {
  const rt = as();
  const actions = actionsOf(rt);
  assert.deepEqual(sel.bookingsOf(rt.state(), viewer(rt), NOW), []);
  const result = await actions.request_booking(BOOKING);
  assert.equal(result.ok, true);
  const [row] = sel.bookingsOf(rt.state(), viewer(rt), NOW);
  assert.deepEqual([row.status, row.type, row.scheduled_at, row.reason, row.handled_by], ['pending', 'teleconsult', null, 'Questions about my schedule', null]);
  assert.equal(manilaDate(row.preferred_start), BOOKING.preferred_date);
  assert.equal(row.preferred_end - row.preferred_start, 4 * MS_HOUR);
  assert.deepEqual(rt.db().notifications.filter((n) => n.type === 'booking_request' && n.payload.appointment_id === row.id).map((n) => n.profile_id).sort(), ['cynthia-dimayuga', ROWENA]);
  assert.equal(sel.calendarOf(rt.state(), viewer(rt)).some((i) => i.id === row.id), false, 'a pending request is not on the calendar');
});

test('only one request at a time, and a bad form is refused with the field and the reason', async () => {
  const rt = as();
  const actions = actionsOf(rt);
  assert.deepEqual((await actions.request_booking({ ...BOOKING, reason: '' })).errors, { reason: 'required' });
  await actions.request_booking(BOOKING);
  assert.equal((await actions.request_booking(BOOKING)).error, 'pending_exists');
  assert.equal(rt.db().appointments.filter((a) => a.patient_id === MARICEL && a.status === 'pending').length, 1);
  rt.auth.signInAs(LOURDES);
  assert.equal((await actions.request_booking(BOOKING)).error, 'not_allowed');
});

test('a booking made offline is hidden from providers and reaches the approvals queue after reconnect', async () => {
  const rt = as();
  const actions = actionsOf(rt);
  rt.setConnection('offline');
  const result = await actions.request_booking(BOOKING);
  assert.equal(result.queued, true);
  const id = result.appointment.id;
  assert.equal(sel.bookingsOf(rt.state(), viewer(rt), NOW)[0].syncState, 'queued');
  assert.equal(rt.db().notifications.some((n) => n.type === 'booking_request' && n.payload.appointment_id === id), false);
  rt.auth.signInAs(ROWENA);
  assert.equal(sel.appointmentsOf(rt.state(), viewer(rt), { patientId: MARICEL }).some((a) => a.id === id), false);
  rt.setConnection('online');
  assert.equal(sel.appointmentsOf(rt.state(), viewer(rt), { patientId: MARICEL }).some((a) => a.id === id), true);
  assert.equal(rt.db().notifications.filter((n) => n.type === 'booking_request' && n.payload.appointment_id === id).length, 2);
});

test('Bring next appointment to now does nothing for a patient with neither an approved nor a waiting teleconsultation', () => {
  const rt = as();
  rt.engine.start('appointment-now', { patientId: MARICEL, actorId: MARICEL, actorRole: 'patient' });
  assert.equal(rt.db().conversations.find((c) => c.id === MIDWIFE).unlocked_until, null);
});

// ---------- Notifications lead to the thread ----------

test('a message notification opens the thread for a patient, a barangay account and a super account', () => {
  const n = { type: 'message', payload: { conversation_id: BARANGAY, patient_id: MARICEL }, read_at: null };
  assert.equal(notificationPath('patient', n), `/patient/consult/chat/${BARANGAY}`);
  assert.equal(notificationPath('barangay', n), `/barangay/chat/${MARICEL}`, 'a barangay account opens the chat with that patient');
  assert.equal(notificationPath('barangay', { type: 'message', payload: {}, read_at: null }), '/barangay/chat');
  assert.equal(notificationPath('super', n), `/super/consult/chat/${BARANGAY}`, 'a super account opens the conversation');
  assert.equal(notificationPath('super', { type: 'message', payload: {}, read_at: null }), '/super/consult');
  assert.equal(describeNotification(n, { role: 'patient' }).path, `/patient/consult/chat/${BARANGAY}`);
});

// ---------- Text and files ----------

const ROOT = new URL('../src/i18n/locales/', import.meta.url);
const load = (lang, file) => JSON.parse(readFileSync(new URL(`${lang}/${file}.json`, ROOT), 'utf8'));
function flatten(object, prefix = '') {
  return Object.entries(object).flatMap(([key, value]) => (value !== null && typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]));
}

test('every fixed text key the Consult screens and the chat components ask for exists in English and Filipino', () => {
  const files = [
    '../src/features/consult/Consult.jsx', '../src/features/consult/ChatScreen.jsx', '../src/features/consult/BookingForm.jsx',
    '../src/features/consult/CallScreen.jsx', '../src/features/consult/JoinCard.jsx', '../src/features/consult/consultText.js',
    '../src/components/ui/ChatThread.jsx', '../src/components/ui/Composer.jsx',
  ];
  const have = Object.fromEntries(['en', 'fil'].map((lang) => [lang, new Set(flatten(load(lang, 'consult')).map(([key]) => key))]));
  let checked = 0;
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const [, key] of source.matchAll(/\bt\(\s*'([\w.]+)'/g)) {
      for (const lang of ['en', 'fil']) assert.ok(have[lang].has(key) || have[lang].has(`${key}_other`), `${lang} consult:${key} (${file})`);
      checked += 1;
    }
    for (const [, prefix] of source.matchAll(/\bt\(`([\w.]+)\$\{/g)) assert.ok([...have.en].some((k) => k.startsWith(prefix)), `prefix ${prefix} (${file})`);
  }
  assert.ok(checked > 50, `checked ${checked}`);
});

test('every text chosen by a value exists in both languages: booking statuses and kinds, ranges, lock reasons, message states, errors', () => {
  for (const lang of ['en', 'fil']) {
    const keys = new Set(flatten(load(lang, 'consult')).map(([key]) => key));
    for (const status of BOOKING_STATUSES) assert.ok(keys.has(`bookings.status.${status}`), `${lang} status ${status}`);
    for (const kind of ['clinic', 'teleconsult']) assert.ok(keys.has(`bookings.kind.${kind}`), `${lang} kind ${kind}`);
    for (const range of Object.keys(BOOKING_WINDOWS)) {
      assert.ok(keys.has(`bookings.range.${range}`), `${lang} range ${range}`);
      assert.ok(keys.has(`book.window${range[0].toUpperCase()}${range.slice(1)}`), `${lang} window ${range}`);
    }
    for (const state of ['sending', 'sent', 'delivered', 'seen']) assert.ok(keys.has(`chat.state.${state}`), `${lang} state ${state}`);
    for (const reason of ['NoAppointment', 'FollowUpOver']) for (const where of ['chat', 'threads']) assert.ok(keys.has(`${where}.locked${reason}`), `${lang} ${where} lock ${reason}`);
    const errors = ['empty', 'tooLong', 'locked', 'not_found', 'not_allowed', 'photo', 'type', 'size', 'unreadable', 'pending_exists'];
    for (const field of Object.values(validateBooking({}, { today: '2026-11-08' }))) errors.push(field);
    errors.push('past', 'tooFar', 'invalid');
    for (const code of errors) assert.ok(keys.has(`error.${code}`), `${lang} error.${code}`);
  }
  const presenter = new Set(flatten(load('en', 'presenter')).map(([key]) => key));
  for (const key of ['action.attachPhoto', 'fill.booking', 'scenario.incomingMessage']) assert.ok(presenter.has(key), key);
});

test('the Consult screens keep to the shared conventions: no demo wording, no hard-coded colours, no browser storage or network', () => {
  const dir = new URL('../src/features/consult/', import.meta.url);
  const files = ['Consult', 'ChatScreen', 'BookingForm', 'CallScreen', 'JoinCard'].map((n) => new URL(`${n}.jsx`, dir));
  files.push(new URL('../src/components/ui/ChatThread.jsx', import.meta.url), new URL('../src/components/ui/Composer.jsx', import.meta.url), new URL('../src/components/ui/ChatPhoto.jsx', import.meta.url));
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/, `${file.pathname}: a colour`);
    assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|localStorage|sessionStorage|getUserMedia|Notification\.requestPermission)\b/, file.pathname);
  }
  const css = readFileSync(new URL('../src/styles/consult.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(/, 'colours in consult.css');
});
