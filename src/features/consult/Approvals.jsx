import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { KIND_ICONS } from '../../components/ui/kindIcons.js';
import { OFFICE } from '../../config/thresholds.js';
import { manilaDate } from '../../lib/dates.js';
import { formatDateLong, formatRelative, formatTime } from '../../lib/format.js';
import { useStoreState, useViewer } from '../../store/hooks.js';
import { approvalsOf, profileOf } from '../../store/selectors.js';
import { useNow } from '../home/useNow.js';
import { DeclineSheet, DecisionSheet } from './DecisionSheets.jsx';

const STATUS_BADGE = { pending: 'neutral', approved: 'normal', declined: 'neutral', rescheduled: 'info' };

/** One request of the shared queue: who asked, what for, what she preferred, and (once decided) who handled it. */
function ApprovalCard({ item, now, lang, onApprove, onReschedule, onDecline }) {
  const { t } = useTranslation('tracker');
  const state = useStoreState();
  const patient = profileOf(state, item.patient_id);
  const barangays = state.db.barangays;
  const barangay = barangays.find((b) => b.id === patient?.barangay_id)?.name ?? '';
  const row = item.row;
  const handler = item.handled_by ? profileOf(state, item.handled_by)?.full_name : null;
  const midwife = row.provider_id && item.kind === 'booking' && item.status !== 'declined' ? profileOf(state, row.provider_id)?.full_name : null;
  const visitType = item.kind === 'booking' ? row.type : item.kind === 'appointment_proposal' ? row.appointment_type : null;
  const Icon = visitType ? KIND_ICONS[visitType] : null;
  const appointment = item.kind === 'reschedule' ? state.db.appointments.find((a) => a.id === row.appointment_id) : null;
  const range = (start, end) => (start ? `${formatTime(start, lang)} – ${formatTime(end, lang)}` : '');
  const pending = item.status === 'pending';
  const reason = row.reason ?? null;
  const declineReason = row.decline_reason ?? null;
  const barangayName = (id) => barangays.find((b) => b.id === id)?.name ?? '';

  return (
    <li className="booking approval">
      <div className="booking__head">
        <h3 className="booking__title">
          {Icon ? <Icon size={20} aria-hidden="true" /> : null} {t(`approvals.kind.${item.kind}`)}
        </h3>
        <Badge status={STATUS_BADGE[item.status]}>{t(`approvals.status.${item.status}`)}</Badge>
      </div>
      <p>
        <Link to={`/super/patient/${item.patient_id}`} aria-label={t('approvals.openProfile')}>
          {t('approvals.patient', { name: patient?.full_name ?? '', barangay })}
        </Link>
      </p>
      {visitType ? <p className="card__meta">{t(`approvals.visit.${visitType}`)}</p> : null}
      <p className="card__meta">{t('approvals.requested', { when: formatRelative(item.at, now, lang) })}</p>
      {item.kind === 'booking' || item.kind === 'appointment_proposal' ? (
        row.scheduled_at && !pending ? (
          <p>{t('approvals.scheduled', { date: formatDateLong(manilaDate(row.scheduled_at), lang), time: formatTime(row.scheduled_at, lang) })}</p>
        ) : row.preferred_start ? (
          <p>{t('approvals.preferred', { date: formatDateLong(manilaDate(row.preferred_start), lang), range: range(row.preferred_start, row.preferred_end) })}</p>
        ) : null
      ) : null}
      {item.kind === 'reschedule' && appointment?.scheduled_at ? <p>{t('approvals.current', { date: formatDateLong(manilaDate(appointment.scheduled_at), lang), time: formatTime(appointment.scheduled_at, lang) })}</p> : null}
      {item.kind === 'reschedule' && row.preferred_date ? <p>{t('approvals.wants', { date: formatDateLong(row.preferred_date, lang) })}</p> : null}
      {item.kind === 'barangay_change' ? <p>{t('approvals.change', { from: barangayName(row.from_barangay_id), to: barangayName(row.to_barangay_id) })}</p> : null}
      {item.kind === 'appointment_proposal' ? <p className="card__meta">{t('approvals.proposedBy', { name: profileOf(state, row.proposed_by)?.full_name ?? '' })}</p> : null}
      {reason ? (
        <p>
          <span className="booking__label">{t('approvals.reason')}: </span>
          {reason}
        </p>
      ) : null}
      {handler ? <p className="card__meta">{t('approvals.handledBy', { name: handler, when: formatRelative(item.handled_at ?? item.at, now, lang) })}</p> : null}
      {midwife ? <p className="card__meta">{t('approvals.assigned', { name: midwife })}</p> : null}
      {item.status === 'declined' && declineReason ? (
        <p>
          <span className="booking__label">{t('approvals.declineReason')}: </span>
          {declineReason}
        </p>
      ) : null}
      {pending ? (
        <div className="alert-actions">
          <Button onClick={() => onApprove(item)}>{t('approvals.approve')}</Button>
          {item.kind === 'booking' ? (
            <Button variant="ghost" onClick={() => onReschedule(item)}>
              {t('approvals.reschedule')}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => onDecline(item)}>
            {t('approvals.decline')}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** The approvals queue shared by all super accounts (SUP-C-01, ACC-05): waiting requests, oldest first, then the ones already handled with the name of the account that handled each. */
export default function Approvals() {
  const { t, i18n } = useTranslation('tracker');
  const state = useStoreState();
  const viewer = useViewer();
  const now = useNow(30000);
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const [sheet, setSheet] = useState(null); // { item, mode: 'approve' | 'reschedule' | 'decline' }
  const [shown, setShown] = useState(OFFICE.handledShown);
  const close = useCallback(() => setSheet(null), []);
  const { pending, handled } = approvalsOf(state, viewer);
  const open = (mode) => (item) => setSheet({ item, mode });

  return (
    <>
      <Card className="stack">
        <h2 className="card__title">{t('approvals.waiting')}</h2>
        {pending.length === 0 ? (
          <EmptyState illustration="calendar" title={t('approvals.emptyTitle')}>
            {t('approvals.emptyBody')}
          </EmptyState>
        ) : (
          <ul className="bookings office-grid" aria-label={t('approvals.list')}>
            {pending.map((item) => (
              <ApprovalCard key={item.key} item={item} now={now} lang={lang} onApprove={open('approve')} onReschedule={open('reschedule')} onDecline={open('decline')} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="stack">
        <h2 className="card__title">{t('approvals.handled')}</h2>
        {handled.length === 0 ? (
          <p className="card__meta">{t('approvals.noneHandled')}</p>
        ) : (
          <ul className="bookings office-grid">
            {handled.slice(0, shown).map((item) => (
              <ApprovalCard key={item.key} item={item} now={now} lang={lang} onApprove={open('approve')} onReschedule={open('reschedule')} onDecline={open('decline')} />
            ))}
          </ul>
        )}
        {handled.length > shown ? (
          <Button variant="ghost" onClick={() => setShown((n) => n + OFFICE.handledShown)}>
            {t('approvals.more')}
          </Button>
        ) : null}
      </Card>

      {sheet && sheet.mode !== 'decline' ? <DecisionSheet item={sheet.item} mode={sheet.mode} onClose={close} /> : null}
      {sheet && sheet.mode === 'decline' ? <DeclineSheet item={sheet.item} onClose={close} /> : null}
    </>
  );
}
