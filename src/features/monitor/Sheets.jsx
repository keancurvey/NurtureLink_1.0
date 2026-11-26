import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Banner from '../../components/ui/Banner.jsx';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import Select from '../../components/ui/Select.jsx';
import Sheet from '../../components/ui/Sheet.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { MONITOR } from '../../config/thresholds.js';
import { REASON_MAX } from '../../lib/alertView.js';
import { BOOKING_TYPES, BOOKING_WINDOWS, latestBookingDate } from '../../lib/consult.js';
import { manilaDate } from '../../lib/dates.js';
import { calcEdd } from '../../lib/pregnancy.js';
import { useActions } from '../../store/hooks.js';
import { useForm } from '../auth/useForm.js';
import LatestVitals from './LatestVitals.jsx';

/** The text of a failed action: its error code under monitor:error.*. */
function useFailure() {
  const { t } = useTranslation('monitor');
  return (code) => t(`error.${code}`, { defaultValue: t('error.generic') });
}

/** Edit LMP, EDD and risk notes (BRG-M-05). The EDD follows the LMP (LMP + 280 days) until it is typed over, and then it is marked as the provider's own. */
export function ClinicalSheet({ patientId, pregnancy, onClose }) {
  const { t } = useTranslation('monitor');
  const failure = useFailure();
  const actions = useActions();
  const toast = useToast();
  const form = useForm({ lmp: pregnancy.lmp, edd: pregnancy.edd, risk_notes: pregnancy.risk_notes ?? '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const { setValue } = form;
  const [typedOver, setTypedOver] = useState(pregnancy.edd !== calcEdd(pregnancy.lmp));
  const error = (name) => (form.errors[name] ? t(`clinical.error.${form.errors[name]}`, { max: MONITOR.noteMax }) : undefined);

  function changeLmp(value) {
    setValue('lmp', value);
    if (!typedOver && /^\d{4}-\d{2}-\d{2}$/.test(value)) setValue('edd', calcEdd(value));
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await actions.save_clinical(patientId, form.values);
    setBusy(false);
    if (result.ok) {
      toast.show({ message: t('clinical.saved'), status: 'normal' });
      onClose();
    } else if (result.errors) form.setErrors(result.errors);
    else setProblem(result.error);
  }

  return (
    <Sheet open onClose={onClose} title={t('clinical.title')}>
      <form className="stack" onSubmit={submit} noValidate>
        <Field label={t('clinical.lmp')} type="date" max={manilaDate(Date.now())} value={form.values.lmp} error={error('lmp')} onChange={(event) => changeLmp(event.target.value)} />
        <Field
          label={t('clinical.edd')}
          hint={t('clinical.eddHint')}
          type="date"
          value={form.values.edd}
          error={error('edd')}
          onChange={(event) => {
            setTypedOver(true);
            setValue('edd', event.target.value);
          }}
        />
        <Field label={t('clinical.risk')} hint={t('clinical.riskHint')} multiline rows={3} maxLength={MONITOR.noteMax} value={form.values.risk_notes} error={error('risk_notes')} onChange={(event) => setValue('risk_notes', event.target.value)} />
        {problem ? <Banner status="attention">{failure(problem)}</Banner> : null}
        <Button block type="submit" loading={busy}>
          {t('clinical.save')}
        </Button>
        <Button block variant="ghost" onClick={onClose} disabled={busy}>
          {t('cancel')}
        </Button>
      </form>
    </Sheet>
  );
}

/** Refer to the midwife with a reason; the latest vitals go with it and are shown here (BRG-M-06). */
export function ReferSheet({ patientId, latest, thresholds, onClose }) {
  const { t } = useTranslation('monitor');
  const failure = useFailure();
  const actions = useActions();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await actions.refer_patient(patientId, { reason });
    setBusy(false);
    if (result.ok) {
      toast.show({ message: t('refer.sent'), status: 'normal' });
      onClose();
    } else setProblem(result.error);
  }

  return (
    <Sheet open onClose={onClose} title={t('refer.title')}>
      <form className="stack" onSubmit={submit} noValidate>
        <p>{t('refer.intro')}</p>
        <Field label={t('refer.reason')} hint={t('refer.reasonHint')} multiline rows={3} maxLength={REASON_MAX} value={reason} onChange={(event) => setReason(event.target.value)} error={problem === 'reason_required' || problem === 'reason_too_long' ? failure(problem) : undefined} />
        <h3 className="card__title">{t('refer.vitals')}</h3>
        <LatestVitals session={latest} thresholds={thresholds} />
        {problem && problem !== 'reason_required' && problem !== 'reason_too_long' ? <Banner status="attention">{failure(problem)}</Banner> : null}
        <Button block type="submit" loading={busy}>
          {t('refer.send')}
        </Button>
        <Button block variant="ghost" onClick={onClose} disabled={busy}>
          {t('cancel')}
        </Button>
      </form>
    </Sheet>
  );
}

/** Propose an appointment time for a patient (spec 6.2): the visit, the date and time range, and why. A super account decides. */
export function ProposeSheet({ patientId, onClose }) {
  const { t } = useTranslation('monitor');
  const failure = useFailure();
  const actions = useActions();
  const toast = useToast();
  const today = manilaDate(Date.now());
  const form = useForm({ type: BOOKING_TYPES[0], preferred_date: '', window: 'any', reason: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const { setValue } = form;
  const error = (name) => (form.errors[name] ? t(`propose.error.${form.errors[name]}`, { max: REASON_MAX }) : undefined);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await actions.propose_appointment(patientId, form.values);
    setBusy(false);
    if (result.ok) {
      toast.show({ message: t('propose.sent'), status: 'normal' });
      onClose();
    } else if (result.errors) form.setErrors(result.errors);
    else setProblem(result.error);
  }

  return (
    <Sheet open onClose={onClose} title={t('propose.title')}>
      <form className="stack" onSubmit={submit} noValidate>
        <p>{t('propose.intro')}</p>
        <Select label={t('propose.type')} value={form.values.type} onChange={(event) => setValue('type', event.target.value)} options={BOOKING_TYPES.map((type) => ({ value: type, label: t(`propose.type_${type}`) }))} />
        <Field label={t('propose.date')} type="date" min={today} max={latestBookingDate(today)} value={form.values.preferred_date} error={error('preferred_date')} onChange={(event) => setValue('preferred_date', event.target.value)} />
        <Select label={t('propose.window')} value={form.values.window} onChange={(event) => setValue('window', event.target.value)} options={Object.keys(BOOKING_WINDOWS).map((key) => ({ value: key, label: t(`propose.window_${key}`) }))} />
        <Field label={t('propose.reason')} multiline rows={3} maxLength={REASON_MAX} value={form.values.reason} error={error('reason')} onChange={(event) => setValue('reason', event.target.value)} />
        {problem ? <Banner status="attention">{problem === 'pending_exists' ? t('propose.pending') : failure(problem)}</Banner> : null}
        <Button block type="submit" loading={busy}>
          {t('propose.send')}
        </Button>
        <Button block variant="ghost" onClick={onClose} disabled={busy}>
          {t('cancel')}
        </Button>
      </form>
    </Sheet>
  );
}
