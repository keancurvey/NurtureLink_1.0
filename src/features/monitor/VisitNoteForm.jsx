import { useCallback, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Banner from '../../components/ui/Banner.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import Field from '../../components/ui/Field.jsx';
import Toggle from '../../components/ui/Toggle.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { VISIT_NOTE_FILL } from '../../components/presenter/fillData.js';
import { usePresenterActions } from '../../components/presenter/presenterRegistry.jsx';
import { useTypingFill } from '../../components/presenter/useTypingFill.js';
import { MONITOR } from '../../config/thresholds.js';
import { useActions, useStoreState, useViewer } from '../../store/hooks.js';
import { patientRecord } from '../../store/selectors.js';
import { useForm } from '../auth/useForm.js';

/** A visit note (BRG-M-05): blood pressure, weight and what she observed, shared with the patient or kept for providers. Route: /barangay/monitor/:patientId/note. */
export default function VisitNoteForm() {
  const { patientId } = useParams();
  const { t, i18n } = useTranslation('monitor');
  const state = useStoreState();
  const viewer = useViewer();
  const actions = useActions();
  const toast = useToast();
  const navigate = useNavigate();
  const fill = useTypingFill();
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const form = useForm({ bp_systolic: '', bp_diastolic: '', weight_kg: '', note: '' });
  const [shared, setShared] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const { setValue } = form;
  const record = patientRecord(state, viewer, patientId);
  const back = `/barangay/monitor/${patientId}`;

  const fillForm = useCallback(() => {
    const set = (name) => (value) => setValue(name, value);
    fill([
      { set: set('bp_systolic'), value: VISIT_NOTE_FILL.bp_systolic },
      { set: set('bp_diastolic'), value: VISIT_NOTE_FILL.bp_diastolic },
      { set: set('weight_kg'), value: VISIT_NOTE_FILL.weight_kg },
      { set: set('note'), value: VISIT_NOTE_FILL.note[lang] },
    ]);
  }, [fill, lang, setValue]);
  usePresenterActions([{ id: 'fill-visit-note', labelKey: 'presenter:fill.visitNote', onSelect: fillForm }]);

  if (!record) return <Navigate to="/barangay/monitor" replace />;

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const result = await actions.add_visit_note(patientId, { ...form.values, shared });
    setBusy(false);
    if (result.ok) {
      toast.show({ message: t('note.saved'), status: 'normal' });
      navigate(back, { replace: true });
    } else if (result.errors) form.setErrors(result.errors);
    else setFailure(result.error);
  }

  const error = (name) => (form.errors[name] ? t(`note.error.${form.errors[name]}`, { max: MONITOR.noteMax }) : undefined);
  const text = (name) => ({ value: form.values[name], error: error(name), onChange: (event) => setValue(name, event.target.value) });
  return (
    <section className="page">
      <header className="chat__header">
        <Link className="icon-btn icon-btn--fixed" to={back} aria-label={t('note.cancel')}>
          <ArrowLeft size={24} aria-hidden="true" />
        </Link>
        <div className="chat__heading">
          <h1 className="chat__title">{t('note.title')}</h1>
          <p className="card__meta">{record.profile.full_name}</p>
        </div>
      </header>
      <Card>
        <form className="stack" onSubmit={submit} noValidate>
          <div className="form-pair">
            <Field label={t('note.systolic')} inputMode="numeric" autoComplete="off" {...text('bp_systolic')} />
            <Field label={t('note.diastolic')} inputMode="numeric" autoComplete="off" {...text('bp_diastolic')} />
          </div>
          <Field label={t('note.weight')} inputMode="decimal" autoComplete="off" {...text('weight_kg')} />
          <Field label={t('note.observations')} hint={t('note.observationsHint')} multiline rows={4} maxLength={MONITOR.noteMax} {...text('note')} />
          <div className="setting">
            <Toggle label={t('note.share')} checked={shared} onChange={setShared} />
            <p className="card__meta">{t(shared ? 'note.shareOn' : 'note.shareOff')}</p>
          </div>
          {failure ? <Banner status="attention">{t(`error.${failure}`, { defaultValue: t('error.generic') })}</Banner> : null}
          <Button block type="submit" loading={busy}>
            {t('note.save')}
          </Button>
          <Link className="btn btn--ghost btn--block" to={back}>
            {t('note.cancel')}
          </Link>
        </form>
      </Card>
    </section>
  );
}
