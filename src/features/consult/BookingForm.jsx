import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Banner from '../../components/ui/Banner.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import Field from '../../components/ui/Field.jsx';
import Select from '../../components/ui/Select.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { BOOKING_FILL } from '../../components/presenter/fillData.js';
import { usePresenterActions } from '../../components/presenter/presenterRegistry.jsx';
import { useTypingFill } from '../../components/presenter/useTypingFill.js';
import { addDays, manilaDate } from '../../lib/dates.js';
import { BOOKING_TYPES, BOOKING_WINDOWS, latestBookingDate } from '../../lib/consult.js';
import { REASON_MAX } from '../../lib/profileRules.js';
import { useActions } from '../../store/hooks.js';
import { useForm } from '../auth/useForm.js';

/** The booking request form (PAT-C-04, D-01): kind of visit, preferred date and time range, and the reason. Route: /patient/consult/book. */
export default function BookingForm() {
  const { t, i18n } = useTranslation('consult');
  const actions = useActions();
  const toast = useToast();
  const navigate = useNavigate();
  const fill = useTypingFill();
  const today = manilaDate(Date.now());
  const form = useForm({ type: BOOKING_TYPES[0], preferred_date: '', window: 'any', reason: '' });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const { setValue } = form;

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const result = await actions.request_booking(form.values);
    setBusy(false);
    if (result.ok) {
      toast.show({ message: t(result.queued ? 'book.queued' : 'book.sent'), status: result.queued ? 'info' : 'normal' });
      navigate('/patient/consult', { replace: true });
    } else if (result.errors) form.setErrors(result.errors);
    else setFailure(result.error);
  }

  // The gear's fill: a teleconsultation tomorrow afternoon with a short reason, typed in; the button stays for her to press.
  const fillRequest = useCallback(() => {
    const set = (name) => (value) => setValue(name, value);
    fill([
      { set: set('type'), value: BOOKING_FILL.type, instant: true },
      { set: set('window'), value: BOOKING_FILL.window, instant: true },
      { set: set('preferred_date'), value: addDays(manilaDate(Date.now()), BOOKING_FILL.daysAhead), instant: true },
      { set: set('reason'), value: BOOKING_FILL.reason[lang] },
    ]);
  }, [fill, lang, setValue]);
  usePresenterActions([{ id: 'fill-booking', labelKey: 'presenter:fill.booking', onSelect: fillRequest }]);

  const error = (name) => (form.errors[name] ? t(`error.${form.errors[name]}`) : undefined);
  return (
    <section className="page">
      <header className="chat__header">
        <Link className="icon-btn" to="/patient/consult" aria-label={t('book.cancel')}>
          <ArrowLeft size={24} aria-hidden="true" />
        </Link>
        <h1 className="chat__title">{t('book.title')}</h1>
      </header>
      <Card>
        <form className="stack" onSubmit={submit} noValidate>
          <p>{t('book.intro')}</p>
          <Select
            label={t('book.type')}
            value={form.values.type}
            error={error('type')}
            onChange={(event) => setValue('type', event.target.value)}
            options={BOOKING_TYPES.map((type) => ({ value: type, label: t(type === 'clinic' ? 'book.typeClinic' : 'book.typeTeleconsult') }))}
          />
          <Field label={t('book.date')} type="date" min={today} max={latestBookingDate(today)} value={form.values.preferred_date} error={error('preferred_date')} onChange={(event) => setValue('preferred_date', event.target.value)} />
          <Select
            label={t('book.window')}
            value={form.values.window}
            error={error('window')}
            onChange={(event) => setValue('window', event.target.value)}
            options={Object.keys(BOOKING_WINDOWS).map((key) => ({ value: key, label: t(`book.window${key[0].toUpperCase()}${key.slice(1)}`) }))}
          />
          <Field label={t('book.reason')} hint={t('book.reasonHint')} multiline rows={3} maxLength={REASON_MAX} value={form.values.reason} error={error('reason')} onChange={(event) => setValue('reason', event.target.value)} />
          {failure ? <Banner status="attention">{failure === 'pending_exists' ? t('book.pendingBanner') : t(`error.${failure}`)}</Banner> : null}
          <Button block type="submit" loading={busy}>
            {t('book.submit')}
          </Button>
          <Link className="btn btn--ghost btn--block" to="/patient/consult">
            {t('book.cancel')}
          </Link>
        </form>
      </Card>
    </section>
  );
}
