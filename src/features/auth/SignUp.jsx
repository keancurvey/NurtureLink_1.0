import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import Select from '../../components/ui/Select.jsx';
import { usePresenterActions } from '../../components/presenter/presenterRegistry.jsx';
import { useTypingFill } from '../../components/presenter/useTypingFill.js';
import { FILL_PASSWORD, SIGN_UP_FILLS, birthdateForAge } from '../../components/presenter/fillData.js';
import { setLanguage } from '../../i18n/index.js';
import { validateSignUp } from '../../lib/authRules.js';
import { manilaDate } from '../../lib/dates.js';
import { useActions, useStoreValue } from '../../store/hooks.js';
import AuthLayout from './AuthLayout.jsx';
import PasswordField from './PasswordField.jsx';
import { useForm } from './useForm.js';

/** AUTH-02: a patient registers with name, birthdate, contact number, one of the 15 barangays, a password and her language. */
export default function SignUp() {
  const { t, i18n } = useTranslation('auth');
  const actions = useActions();
  const barangays = useStoreValue((state) => state.db.barangays);
  const form = useForm({ full_name: '', birthdate: '', contact_no: '', barangay_id: '', password: '' });
  const type = useTypingFill();
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const language = i18n.language === 'fil' ? 'fil' : 'en';
  const today = manilaDate(Date.now());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const error = (name) => (form.errors[name] ? t(`error.${form.errors[name]}`) : undefined);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const values = { ...form.values, language };
    const errors = validateSignUp(values, { today, barangayIds: barangays.map((b) => b.id) });
    if (Object.keys(errors).length > 0) {
      form.setErrors(errors);
      return;
    }
    setBusy(true);
    const result = await actions.sign_up(values);
    if (!mounted.current) return; // the account exists and she is signed in: the route takes her to the terms
    setBusy(false);
    if (!result.ok) form.setErrors(result.errors);
  }

  function fillWith(fill) {
    form.clearErrors();
    type([
      { set: (value) => form.setValue('full_name', value), value: fill.full_name },
      { set: (value) => form.setValue('birthdate', value), value: birthdateForAge(fill.age), instant: true },
      { set: (value) => form.setValue('contact_no', value), value: fill.contact_no },
      { set: (value) => form.setValue('barangay_id', value), value: fill.barangay_id, instant: true },
      { set: (value) => form.setValue('password', value), value: FILL_PASSWORD },
    ]);
  }

  usePresenterActions([
    { id: 'fill-adult', labelKey: SIGN_UP_FILLS.adult.labelKey, onSelect: () => fillWith(SIGN_UP_FILLS.adult) },
    { id: 'fill-minor', labelKey: SIGN_UP_FILLS.minor.labelKey, onSelect: () => fillWith(SIGN_UP_FILLS.minor) },
  ]);

  return (
    <AuthLayout title={t('signUp.title')} intro={t('signUp.intro')}>
      <form className="auth__form" onSubmit={submit} noValidate>
        <Field
          label={t('signUp.fullName')}
          autoComplete="name"
          value={form.values.full_name}
          error={error('full_name')}
          onChange={(event) => form.setValue('full_name', event.target.value)}
        />
        <Field
          label={t('signUp.birthdate')}
          type="date"
          max={today}
          autoComplete="bday"
          value={form.values.birthdate}
          error={error('birthdate')}
          onChange={(event) => form.setValue('birthdate', event.target.value)}
        />
        <Field
          label={t('signUp.contact')}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={form.values.contact_no}
          error={error('contact_no')}
          onChange={(event) => form.setValue('contact_no', event.target.value)}
        />
        <Select
          label={t('signUp.barangay')}
          value={form.values.barangay_id}
          error={error('barangay_id')}
          onChange={(event) => form.setValue('barangay_id', event.target.value)}
          options={[{ value: '', label: t('signUp.chooseBarangay') }, ...barangays.map((b) => ({ value: b.id, label: b.name }))]}
        />
        <PasswordField
          label={t('signUp.password')}
          autoComplete="new-password"
          showRules
          value={form.values.password}
          error={error('password')}
          onChange={(event) => form.setValue('password', event.target.value)}
        />
        <Select
          label={t('signUp.language')}
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          options={[
            { value: 'en', label: t('language.en', { ns: 'common' }) },
            { value: 'fil', label: t('language.fil', { ns: 'common' }) },
          ]}
        />
        <Button block type="submit" loading={busy}>
          {t('signUp.submit')}
        </Button>
      </form>
      <div className="auth__links">
        <p>
          {t('signUp.haveAccount')}{' '}
          <Link className="link" to="/sign-in">
            {t('signUp.signIn')}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
