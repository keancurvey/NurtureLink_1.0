import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Banner from '../../components/ui/Banner.jsx';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import Select from '../../components/ui/Select.jsx';
import Sheet from '../../components/ui/Sheet.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { REASON_MAX, decisionDefaults } from '../../lib/approvals.js';
import { CHAT } from '../../config/thresholds.js';
import { addDays, manilaDate } from '../../lib/dates.js';
import { useActions, useStoreState, useViewer } from '../../store/hooks.js';
import { profileOf } from '../../store/selectors.js';

/**
 * Approve a request, or give it another time (SUP-C-01, ACC-05). A booking, and a time proposed by a barangay account, take a date, a
 * time and the super account who becomes the assigned midwife (the deciding account until another is chosen); a request for a new time
 * takes the new date and time; a change of barangay takes nothing but the confirmation. mode is 'approve' or 'reschedule'.
 */
export function DecisionSheet({ item, mode, onClose }) {
  const { t } = useTranslation('tracker');
  const actions = useActions();
  const state = useStoreState();
  const viewer = useViewer();
  const toast = useToast();
  const appointment = item.kind === 'reschedule' ? state.db.appointments.find((a) => a.id === item.row.appointment_id) ?? null : null;
  const patient = profileOf(state, item.patient_id);
  const [values, setValues] = useState(() => decisionDefaults(item, { viewerId: viewer.id, appointment, mode }));
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);
  const supers = state.db.profiles.filter((p) => p.role === 'super' && p.active);
  const today = manilaDate(Date.now());
  const needsTime = item.kind !== 'barangay_change';
  const needsMidwife = item.kind === 'booking' || item.kind === 'appointment_proposal';
  const change = (name) => (event) => {
    setValues((current) => ({ ...current, [name]: event.target.value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };
  const error = (name) => (errors[name] ? t(`decision.field.${errors[name]}`) : undefined);
  const title =
    item.kind === 'barangay_change' ? t('decision.barangayTitle') : item.kind === 'reschedule' ? t('decision.newTimeTitle') : item.kind === 'appointment_proposal' ? t('decision.proposalTitle') : mode === 'reschedule' ? t('decision.rescheduleTitle') : t('decision.approveTitle');
  const from = item.kind === 'barangay_change' ? state.db.barangays.find((b) => b.id === item.row.from_barangay_id)?.name ?? '' : '';
  const to = item.kind === 'barangay_change' ? state.db.barangays.find((b) => b.id === item.row.to_barangay_id)?.name ?? '' : '';

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    let result;
    if (item.kind === 'booking') result = await (mode === 'reschedule' ? actions.reschedule_booking : actions.approve_booking)(item.id, values);
    else result = await actions.approve_request(item.id, values);
    setBusy(false);
    if (result.ok) {
      toast.show({ message: t(`decision.done.${mode === 'reschedule' && item.kind === 'booking' ? 'rescheduled' : 'approved'}`, { name: patient?.full_name ?? '' }), status: 'normal' });
      onClose();
    } else if (result.errors) setErrors(result.errors);
    else setFailure(result.error);
  }

  return (
    <Sheet open onClose={onClose} title={title}>
      <form className="stack" onSubmit={submit} noValidate>
        <p className="card__meta">{t('decision.for', { name: patient?.full_name ?? '', kind: t(`approvals.kind.${item.kind}`) })}</p>
        {item.kind === 'barangay_change' ? <p>{t('decision.barangayBody', { name: patient?.full_name ?? '', from, to })}</p> : null}
        {needsTime ? (
          <div className="form-pair">
            <Field label={t('decision.date')} type="date" min={today} max={addDays(today, CHAT.bookingHorizonDays)} value={values.date} onChange={change('date')} error={error('date')} />
            <Field label={t('decision.time')} type="time" value={values.time} onChange={change('time')} error={error('time')} />
          </div>
        ) : null}
        {needsMidwife ? (
          <Select
            label={t('decision.midwife')}
            hint={t('decision.midwifeHint')}
            value={values.provider_id}
            onChange={change('provider_id')}
            error={error('provider_id')}
            options={supers.map((p) => ({ value: p.id, label: p.full_name }))}
          />
        ) : null}
        {failure ? <Banner status="attention">{t(`decision.error.${failure}`, { defaultValue: t('decision.error.generic') })}</Banner> : null}
        <Button block type="submit" loading={busy}>
          {item.kind === 'reschedule' || mode === 'reschedule' ? t('decision.confirmNewTime') : t('decision.confirmApprove')}
        </Button>
        <Button block variant="ghost" onClick={onClose}>
          {t('decision.cancel')}
        </Button>
      </form>
    </Sheet>
  );
}

/** Decline a request with a reason (SUP-C-01): whoever asked reads it. */
export function DeclineSheet({ item, onClose }) {
  const { t } = useTranslation('tracker');
  const actions = useActions();
  const state = useStoreState();
  const toast = useToast();
  const patient = profileOf(state, item.patient_id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const result = await (item.kind === 'booking' ? actions.decline_booking : actions.decline_request)(item.id, { reason });
    setBusy(false);
    if (result.ok) {
      toast.show({ message: t('decision.done.declined', { name: item.kind === 'appointment_proposal' ? profileOf(state, item.row.proposed_by)?.full_name ?? '' : patient?.full_name ?? '' }), status: 'normal' });
      onClose();
    } else if (result.errors) setError(result.errors.reason);
    else setFailure(result.error);
  }

  return (
    <Sheet open onClose={onClose} title={t('decision.declineTitle')}>
      <form className="stack" onSubmit={submit} noValidate>
        <p className="card__meta">{t('decision.for', { name: patient?.full_name ?? '', kind: t(`approvals.kind.${item.kind}`) })}</p>
        <Field
          label={t('decision.reasonLabel')}
          hint={t('decision.reasonHint')}
          multiline
          rows={3}
          maxLength={REASON_MAX}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setError(null);
          }}
          error={error ? t(`decision.field.${error}`) : undefined}
        />
        {failure ? <Banner status="attention">{t(`decision.error.${failure}`, { defaultValue: t('decision.error.generic') })}</Banner> : null}
        <Button block type="submit" loading={busy}>
          {t('decision.confirmDecline')}
        </Button>
        <Button block variant="ghost" onClick={onClose}>
          {t('decision.cancel')}
        </Button>
      </form>
    </Sheet>
  );
}
