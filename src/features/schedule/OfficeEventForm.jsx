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
import { EVENT_FILL } from '../../components/presenter/fillData.js';
import { usePresenterActions } from '../../components/presenter/presenterRegistry.jsx';
import { useTypingFill } from '../../components/presenter/useTypingFill.js';
import { MONITOR } from '../../config/thresholds.js';
import { latestEventDate } from '../../lib/clinicalRules.js';
import { addDays, manilaDate } from '../../lib/dates.js';
import { useActions, useStoreState } from '../../store/hooks.js';
import { useForm } from '../auth/useForm.js';

/** A new event for all barangays or for one (SUP-S-01): the patients and barangay accounts it is for are told. Route: /super/schedule/new. */
export default function OfficeEventForm() {
  const { t, i18n } = useTranslation('tracker');
  const actions = useActions();
  const state = useStoreState();
  const toast = useToast();
  const navigate = useNavigate();
  const fill = useTypingFill();
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const today = manilaDate(Date.now());
  const form = useForm({ title: '', scope: 'all', barangay_id: '', date: '', start: '', end: '' });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const { setValue } = form;

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
    const result = await actions.create_office_event({ ...form.values, barangay_id: form.values.scope === 'barangay' ? form.values.barangay_id : null });
    setBusy(false);
    if (result.ok) {
      toast.show({ message: t('event.saved', { count: result.told }), status: 'normal' });
      navigate('/super/schedule', { replace: true });
    } else if (result.errors) form.setErrors(result.errors);
    else setFailure(result.error);
  }

  const error = (name) => (form.errors[name] ? t(`event.error.${form.errors[name]}`, { max: MONITOR.eventTitleMax }) : undefined);
  const text = (name) => ({ value: form.values[name], error: error(name), onChange: (event) => setValue(name, event.target.value) });
  return (
    <section className="page">
      <header className="chat__header">
        <Link className="icon-btn icon-btn--fixed" to="/super/schedule" aria-label={t('event.cancel')}>
          <ArrowLeft size={24} aria-hidden="true" />
        </Link>
        <h1 className="chat__title">{t('event.title')}</h1>
      </header>
      <Card>
        <form className="stack" onSubmit={submit} noValidate>
          <p>{t('event.intro')}</p>
          <Field label={t('event.name')} maxLength={MONITOR.eventTitleMax} autoComplete="off" {...text('title')} />
          <Select label={t('event.scope')} {...text('scope')} options={[{ value: 'all', label: t('event.all') }, { value: 'barangay', label: t('event.one') }]} />
          {form.values.scope === 'barangay' ? (
            <Select label={t('event.barangay')} {...text('barangay_id')} options={[{ value: '', label: t('event.choose') }, ...state.db.barangays.map((b) => ({ value: b.id, label: b.name }))]} />
          ) : null}
          <Field label={t('event.date')} type="date" min={today} max={latestEventDate(today)} {...text('date')} />
          <div className="form-pair">
            <Field label={t('event.start')} type="time" {...text('start')} />
            <Field label={t('event.end')} type="time" {...text('end')} />
          </div>
          {failure ? <Banner status="attention">{t(`decision.error.${failure}`, { defaultValue: t('decision.error.generic') })}</Banner> : null}
          <Button block type="submit" loading={busy}>
            {t('event.save')}
          </Button>
          <Link className="btn btn--ghost btn--block" to="/super/schedule">
            {t('event.cancel')}
          </Link>
        </form>
      </Card>
    </section>
  );
}
