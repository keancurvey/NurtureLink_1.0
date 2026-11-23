import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import Sheet from '../../components/ui/Sheet.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { addDays, manilaDate } from '../../lib/dates.js';
import { REASON_MAX } from '../../lib/profileRules.js';
import { useActions } from '../../store/hooks.js';
import { useForm } from '../auth/useForm.js';

/** PAT-S-05: ask for a new time. A reason is needed; the date she would like is optional. The provider is notified. */
export default function RescheduleSheet({ appointment, kindText, onClose, onSent }) {
  const { t } = useTranslation('schedule');
  const { t: tp } = useTranslation('profile');
  const actions = useActions();
  const toast = useToast();
  const form = useForm({ reason: '', preferred_date: '' });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const sent = useRef(onSent);
  sent.current = onSent;

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const result = await actions.request_reschedule({ appointment_id: appointment.id, reason: form.values.reason, preferred_date: form.values.preferred_date });
    setBusy(false);
    if (result.ok) {
      toast.show({ message: t(result.queued ? 'reschedule.queued' : 'reschedule.sent'), status: result.queued ? 'info' : 'normal' });
      sent.current();
    } else if (result.errors) form.setErrors(result.errors);
    else setFailure(result.error);
  }

  const error = (name) => (form.errors[name] ? tp(`error.${form.errors[name]}`, { max: REASON_MAX }) : undefined);
  return (
    <Sheet open onClose={onClose} title={t('reschedule.title')}>
      <form className="stack" onSubmit={submit} noValidate>
        <p>{t('reschedule.intro', { what: kindText })}</p>
        <Field label={t('reschedule.reason')} multiline rows={3} maxLength={REASON_MAX} value={form.values.reason} error={error('reason')} onChange={(event) => form.setValue('reason', event.target.value)} />
        <Field label={t('reschedule.preferred')} hint={t('reschedule.preferredHint')} type="date" min={addDays(manilaDate(Date.now()), 1)} value={form.values.preferred_date} error={error('preferred_date')} onChange={(event) => form.setValue('preferred_date', event.target.value)} />
        {failure ? <p className="field__error">{t(`reschedule.error.${failure}`)}</p> : null}
        <Button block type="submit" loading={busy}>
          {t('reschedule.submit')}
        </Button>
        <Button block variant="ghost" onClick={onClose} disabled={busy}>
          {t('reschedule.cancel')}
        </Button>
      </form>
    </Sheet>
  );
}
