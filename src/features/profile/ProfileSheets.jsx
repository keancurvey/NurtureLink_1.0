import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Avatar from '../../components/ui/Avatar.jsx';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import Select from '../../components/ui/Select.jsx';
import Sheet from '../../components/ui/Sheet.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { formatDateTime } from '../../lib/format.js';
import { downscalePhoto, photoProblem } from '../../lib/photo.js';
import { AVATAR_CHOICES, EMERGENCY_RELATIONSHIPS, REASON_MAX, validateChangePassword, validatePersonal } from '../../lib/profileRules.js';
import { useActions, useStoreValue } from '../../store/hooks.js';
import { thresholdsOf } from '../../store/selectors.js';
import { SECTIONS } from '../auth/Consent.jsx';
import PasswordField from '../auth/PasswordField.jsx';
import { useForm } from '../auth/useForm.js';

/** The text of a form error code (profile:error.<code>). */
function useErrorText() {
  const { t } = useTranslation('profile');
  return (code) => (code ? t(`error.${code}`, { max: REASON_MAX }) : undefined);
}

/** PAT-P-01: a photo from her own phone (made small here), one of the drawn avatars, or her initials. */
export function PhotoSheet({ name, current, onClose }) {
  const { t } = useTranslation('profile');
  const actions = useActions();
  const toast = useToast();
  const input = useRef(null);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);

  function done(result) {
    if (result.ok) toast.show({ message: t(result.queued ? 'photo.queued' : 'photo.saved'), status: result.queued ? 'info' : 'normal' });
    else setProblem('invalid');
  }

  async function onFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const bad = photoProblem(file);
    if (bad) {
      setProblem(bad);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      done(actions.set_photo({ photo_url: await downscalePhoto(file) }));
    } catch {
      setProblem('unreadable');
    }
    setBusy(false);
  }

  return (
    <Sheet open onClose={onClose} title={t('photo.title')}>
      <div className="stack">
        <div className="photo__preview">
          <Avatar name={name} size="lg" photo={current.photo_url} illustration={current.avatar_art ?? undefined} />
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden" tabIndex={-1} aria-hidden="true" onChange={onFile} />
        <Button block loading={busy} onClick={() => input.current?.click()}>
          {t('photo.choose')}
        </Button>
        {problem ? (
          <p className="field__error" role="alert">
            {t(`photo.error.${problem}`)}
          </p>
        ) : null}
        <p className="card__meta">{t('photo.hint')}</p>
        <div className="avatars" role="group" aria-label={t('photo.drawn')}>
          {AVATAR_CHOICES.map((art) => (
            <button key={art} type="button" className="avatars__choice" aria-label={t(`photo.art.${art}`)} aria-pressed={current.avatar_art === art && !current.photo_url} onClick={() => done(actions.set_photo({ avatar_art: art }))}>
              <Avatar illustration={art} size="md" />
            </button>
          ))}
        </div>
        <Button block variant="ghost" onClick={() => done(actions.set_photo({}))}>
          {t('photo.initials')}
        </Button>
        <Button block variant="ghost" onClick={onClose}>
          {t('photo.done')}
        </Button>
      </div>
    </Sheet>
  );
}

/** PAT-P-01: her contact number and emergency contact. */
export function PersonalSheet({ values: start, onClose }) {
  const { t } = useTranslation('profile');
  const errorText = useErrorText();
  const actions = useActions();
  const toast = useToast();
  const form = useForm(start);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const errors = validatePersonal(form.values);
    if (Object.keys(errors).length > 0) {
      form.setErrors(errors);
      return;
    }
    setBusy(true);
    const result = await actions.save_personal(form.values);
    setBusy(false);
    if (result.ok) {
      toast.show({ message: t(result.queued ? 'personal.queued' : 'personal.saved'), status: result.queued ? 'info' : 'normal' });
      onClose();
    } else if (result.errors) form.setErrors(result.errors);
  }

  const field = (name) => ({ value: form.values[name], error: errorText(form.errors[name]), onChange: (event) => form.setValue(name, event.target.value) });
  return (
    <Sheet open onClose={onClose} title={t('personal.edit')}>
      <form className="stack" onSubmit={submit} noValidate>
        <Field label={t('personal.contact')} type="tel" inputMode="tel" autoComplete="tel" {...field('contact_no')} />
        <h3 className="card__title">{t('personal.emergency')}</h3>
        <Field label={t('personal.emergencyName')} autoComplete="off" {...field('emergency_name')} />
        <Select label={t('personal.emergencyRelationship')} options={[{ value: '', label: t('personal.choose') }, ...EMERGENCY_RELATIONSHIPS.map((key) => ({ value: key, label: t(`relationship.${key}`) }))]} {...field('emergency_relationship')} />
        <Field label={t('personal.emergencyNumber')} type="tel" inputMode="tel" autoComplete="off" {...field('emergency_no')} />
        <Button block type="submit" loading={busy}>
          {t('personal.save')}
        </Button>
        <Button block variant="ghost" onClick={onClose} disabled={busy}>
          {t('cancel')}
        </Button>
      </form>
    </Sheet>
  );
}

/** PAT-P-01: ask to move to another barangay. It stays as it is until the office approves. */
export function BarangayChangeSheet({ choices, onClose }) {
  const { t } = useTranslation('profile');
  const errorText = useErrorText();
  const actions = useActions();
  const toast = useToast();
  const form = useForm({ barangay_id: '', reason: '' });
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const result = await actions.request_barangay_change(form.values);
    setBusy(false);
    if (result.ok) {
      toast.show({ message: t(result.queued ? 'barangay.queued' : 'barangay.sent'), status: result.queued ? 'info' : 'normal' });
      onClose();
    } else if (result.errors) form.setErrors(result.errors);
  }

  return (
    <Sheet open onClose={onClose} title={t('barangay.title')}>
      <form className="stack" onSubmit={submit} noValidate>
        <p>{t('barangay.intro')}</p>
        <Select label={t('barangay.new')} value={form.values.barangay_id} error={errorText(form.errors.barangay_id)} onChange={(event) => form.setValue('barangay_id', event.target.value)} options={[{ value: '', label: t('personal.choose') }, ...choices.map((b) => ({ value: b.id, label: b.name }))]} />
        <Field label={t('barangay.reason')} multiline rows={3} maxLength={REASON_MAX} value={form.values.reason} error={errorText(form.errors.reason)} onChange={(event) => form.setValue('reason', event.target.value)} />
        <Button block type="submit" loading={busy}>
          {t('barangay.submit')}
        </Button>
        <Button block variant="ghost" onClick={onClose} disabled={busy}>
          {t('cancel')}
        </Button>
      </form>
    </Sheet>
  );
}

/** Settings → Password: the current password, a new strong one, and the same again. */
export function PasswordSheet({ onClose }) {
  const { t } = useTranslation('profile');
  const errorText = useErrorText();
  const actions = useActions();
  const toast = useToast();
  const form = useForm({ current: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setOffline(false);
    const errors = validateChangePassword(form.values);
    if (Object.keys(errors).length > 0) {
      form.setErrors(errors);
      return;
    }
    setBusy(true);
    const result = await actions.change_password({ current: form.values.current, password: form.values.password });
    setBusy(false);
    if (result.ok) {
      toast.show({ message: t('password.saved'), status: 'normal' });
      onClose();
    } else if (result.errors) form.setErrors(result.errors);
    else if (result.error === 'offline') setOffline(true);
  }

  return (
    <Sheet open onClose={onClose} title={t('password.title')}>
      <form className="stack" onSubmit={submit} noValidate>
        <PasswordField label={t('password.current')} autoComplete="current-password" value={form.values.current} error={errorText(form.errors.current)} onChange={(event) => form.setValue('current', event.target.value)} />
        <PasswordField label={t('password.new')} autoComplete="new-password" showRules value={form.values.password} error={errorText(form.errors.password)} onChange={(event) => form.setValue('password', event.target.value)} />
        <PasswordField label={t('password.confirm')} autoComplete="new-password" value={form.values.confirm} error={errorText(form.errors.confirm)} onChange={(event) => form.setValue('confirm', event.target.value)} />
        {offline ? (
          <p className="field__error" role="alert">
            {t('password.offline')}
          </p>
        ) : null}
        <Button block type="submit" loading={busy}>
          {t('password.save')}
        </Button>
        <Button block variant="ghost" onClick={onClose} disabled={busy}>
          {t('cancel')}
        </Button>
      </form>
    </Sheet>
  );
}

/** Settings → Consent review: each document she agreed to, its version and when, and the text of the terms. */
export function ConsentSheet({ records, onClose }) {
  const { t, i18n } = useTranslation('consent');
  const { t: tp } = useTranslation('profile');
  const minutes = useStoreValue((state) => thresholdsOf(state).providerSession.timeoutMinutes);
  const [reading, setReading] = useState(false);
  const lang = i18n.language;
  const { terms, guardian, hele } = records;
  return (
    <Sheet open onClose={onClose} title={tp('consent.title')}>
      <div className="stack">
        <ul className="consents">
          {terms ? (
            <li className="consents__item">
              <h3 className="consents__name">{t('title')}</h3>
              <p className="card__meta">{tp('consent.accepted', { version: terms.version, time: formatDateTime(terms.accepted_at, lang) })}</p>
            </li>
          ) : null}
          {guardian ? (
            <li className="consents__item">
              <h3 className="consents__name">{t('guardian.title')}</h3>
              <p className="card__meta">{tp('consent.guardian', { name: guardian.guardian_name, relationship: t(`guardian.relationships.${guardian.relationship}`).toLowerCase(), time: formatDateTime(guardian.signed_at, lang) })}</p>
            </li>
          ) : null}
          {hele ? (
            <li className="consents__item">
              <h3 className="consents__name">{tp('consent.hele')}</h3>
              <p className="card__meta">{hele.withdrawn_at ? tp('consent.withdrawn', { version: hele.version, time: formatDateTime(hele.withdrawn_at, lang) }) : tp('consent.accepted', { version: hele.version, time: formatDateTime(hele.accepted_at, lang) })}</p>
            </li>
          ) : null}
        </ul>
        <Button block variant="ghost" aria-expanded={reading} onClick={() => setReading((current) => !current)}>
          {tp(reading ? 'consent.hide' : 'consent.read')}
        </Button>
        {reading ? (
          <div className="consent">
            {SECTIONS.map((id) => (
              <section key={id} className="consent__section" aria-labelledby={`review-${id}`}>
                <h3 id={`review-${id}`} className="consent__title">
                  {t(`sections.${id}.title`)}
                </h3>
                {t(`sections.${id}.body`, { minutes }).split('\n\n').map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </section>
            ))}
          </div>
        ) : null}
        <Button block variant="ghost" onClick={onClose}>
          {tp('photo.done')}
        </Button>
      </div>
    </Sheet>
  );
}
