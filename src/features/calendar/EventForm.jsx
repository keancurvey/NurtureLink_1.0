import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Banner from '../../components/ui/Banner.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import Field from '../../components/ui/Field.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { EVENT_FILL } from '../../components/presenter/fillData.js';
import { usePresenterActions } from '../../components/presenter/presenterRegistry.jsx';
import { useTypingFill } from '../../components/presenter/useTypingFill.js';
import { MONITOR } from '../../config/thresholds.js';
import { latestEventDate } from '../../lib/clinicalRules.js';
import { addDays, manilaDate } from '../../lib/dates.js';
import { useActions, useStoreState, useViewer } from '../../store/hooks.js';
import { useForm } from '../auth/useForm.js';

/** A new event for the account's own barangay (BRG-K-01): its patients and the other accounts of the barangay are told. Route: /barangay/calendar/new. */
export default function EventForm() {
  const { t, i18n } = useTranslation('monitor');
  const actions = useActions();
  const state = useStoreState();
  const viewer = useViewer();
  const toast = useToast();
  const navigate = useNavigate();
  const fill = useTypingFill();
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const today = manilaDate(Date.now());
  const form = useForm({ title: '', date: '', start: '', end: '' });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const { setValue } = form;
  const barangay = state.db.barangays.find((b) => b.id === viewer?.barangay_id);

  const fillForm = useCallback(() => {
    const set = (name) => (value) => setValue(name, value);
    fill([
      { set: set('title'), value: EVENT_FILL.title[lang] },
      { set: set('date'), value: addDays(manilaDate(Date.now()), EVENT_FILL.daysAhead), instant: true },
      { set: set('start'), value: EVENT_FILL.start, instant: true },
      { set: set('end'), value: EVENT_FILL.end, instant: true },
    ]);
  }, [fill, lang, setValue]);
  usePresenterActions([{ id: 'fill-event', labelKey: 'presenter:fill.event', onSelect: fillForm }]);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const result = await actions.create_event(form.values);
    setBusy(false);
    if (result.ok) {
      toast.show({ message: t('event.saved'), status: 'normal' });
      navigate('/barangay/calendar', { replace: true });
    } else if (result.errors) form.setErrors(result.errors);
    else setFailure(result.error);
  }

  const error = (name) => (form.errors[name] ? t(`event.error.${form.errors[name]}`, { max: MONITOR.eventTitleMax }) : undefined);
  const text = (name) => ({ value: form.values[name], error: error(name), onChange: (event) => setValue(name, event.target.value) });
  return (
    <section className="page">
      <header className="chat__header">
        <Link className="icon-btn icon-btn--fixed" to="/barangay/calendar" aria-label={t('event.cancel')}>
          <ArrowLeft size={24} aria-hidden="true" />
        </Link>
        <h1 className="chat__title">{t('event.title')}</h1>
      </header>
      <Card>
        <form className="stack" onSubmit={submit} noValidate>
          <p>{t('event.intro', { barangay: barangay?.name ?? '' })}</p>
          <Field label={t('event.name')} maxLength={MONITOR.eventTitleMax} autoComplete="off" {...text('title')} />
          <Field label={t('event.date')} type="date" min={today} max={latestEventDate(today)} {...text('date')} />
          <div className="form-pair">
            <Field label={t('event.start')} type="time" {...text('start')} />
            <Field label={t('event.end')} type="time" {...text('end')} />
          </div>
          {failure ? <Banner status="attention">{t(`error.${failure}`, { defaultValue: t('error.generic') })}</Banner> : null}
          <Button block type="submit" loading={busy}>
            {t('event.save')}
          </Button>
          <Link className="btn btn--ghost btn--block" to="/barangay/calendar">
            {t('event.cancel')}
          </Link>
        </form>
      </Card>
    </section>
  );
}
