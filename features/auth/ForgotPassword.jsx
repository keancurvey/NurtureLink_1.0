import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Banner from '../../components/ui/Banner.jsx';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import { usePresenterActions } from '../../components/presenter/presenterRegistry.jsx';
import { useTypingFill } from '../../components/presenter/useTypingFill.js';
import { FILL_PASSWORD } from '../../components/presenter/fillData.js';
import { validateNewPassword, validateSignIn } from '../../lib/authRules.js';
import { pendingResetCode, signInFillFor } from '../../store/selectors.js';
import { useActions, useRuntime } from '../../store/hooks.js';
import AuthLayout from './AuthLayout.jsx';
import PasswordField from './PasswordField.jsx';
import { useForm } from './useForm.js';

const FILL_PATIENT = 'maricel-dimaculangan';

/**
 * AUTH-08: a patient resets her own password (contact number, the code she receives, a new password). A health worker
 * or midwife account is told to contact the Municipal Health Office, who reset those accounts.
 */
export default function ForgotPassword() {
  const { t } = useTranslation('auth');
  const actions = useActions();
  const runtime = useRuntime();
  const navigate = useNavigate();
  const form = useForm({ identifier: '', code: '', password: '' });
  const type = useTypingFill();
  const [step, setStep] = useState('contact'); // contact | code | password | provider
  const [busy, setBusy] = useState(false);
  const [sentAgain, setSentAgain] = useState(false);
  const [codeWrong, setCodeWrong] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const error = (name) => (form.errors[name] ? t(`error.${form.errors[name]}`) : undefined);

  async function run(call) {
    setBusy(true);
    const result = await call();
    if (mounted.current) setBusy(false);
    return mounted.current ? result : null;
  }

  async function sendCode(event) {
    event?.preventDefault();
    if (busy) return;
    const errors = validateSignIn({ identifier: form.values.identifier, password: 'x' });
    if (errors.identifier) {
      form.setErrors({ identifier: errors.identifier });
      return;
    }
    const result = await run(() => actions.request_password_reset({ identifier: form.values.identifier }));
    if (!result) return;
    if (!result.ok) return form.setErrors(result.errors ?? {});
    setSentAgain(false);
    setStep(result.outcome === 'provider' ? 'provider' : 'code');
  }

  async function resend() {
    if (busy) return;
    const result = await run(() => actions.request_password_reset({ identifier: form.values.identifier }));
    if (result?.ok) {
      setSentAgain(true);
      setCodeWrong(false);
    }
  }

  async function checkCode(event) {
    event?.preventDefault();
    if (busy) return;
    if (!form.values.code.trim()) {
      form.setErrors({ code: 'required' });
      return;
    }
    const result = await run(() => actions.verify_reset_code({ identifier: form.values.identifier, code: form.values.code }));
    if (!result) return;
    if (result.ok) {
      setCodeWrong(false);
      setStep('password');
    } else setCodeWrong(true);
  }

  async function save(event) {
    event?.preventDefault();
    if (busy) return;
    const errors = validateNewPassword({ password: form.values.password });
    if (Object.keys(errors).length > 0) {
      form.setErrors(errors);
      return;
    }
    const result = await run(() => actions.reset_password(form.values));
    if (!result) return;
    if (result.ok) navigate('/sign-in', { replace: true, state: { passwordChanged: true } });
    else if (result.errors) form.setErrors(result.errors);
    else {
      setCodeWrong(true);
      setStep('code');
    }
  }

  function fillThisStep() {
    const state = runtime.store.getState();
    form.clearErrors();
    if (step === 'contact') {
      const fill = signInFillFor(state, FILL_PATIENT);
      type([{ set: (value) => form.setValue('identifier', value), value: fill.identifier }]);
    } else if (step === 'code') {
      const code = pendingResetCode(state, form.values.identifier);
      if (code) type([{ set: (value) => form.setValue('code', value), value: code }]);
    } else if (step === 'password') {
      type([{ set: (value) => form.setValue('password', value), value: FILL_PASSWORD }]);
    }
  }

  usePresenterActions(step === 'provider' ? [] : [{ id: 'fill-step', labelKey: step === 'contact' ? 'presenter:fill.forgotContact' : step === 'code' ? 'presenter:fill.forgotCode' : 'presenter:fill.password', onSelect: fillThisStep }]);

  const back = (
    <div className="auth__links">
      <Link className="link" to="/sign-in">
        {t('forgot.back')}
      </Link>
    </div>
  );

  if (step === 'provider') {
    return (
      <AuthLayout title={t('forgot.title')}>
        <Banner status="info" title={t('forgot.providerTitle')}>
          {t('forgot.providerBody')}
        </Banner>
        {back}
      </AuthLayout>
    );
  }

  if (step === 'contact') {
    return (
      <AuthLayout title={t('forgot.title')} intro={t('forgot.contactIntro')}>
        <form className="auth__form" onSubmit={sendCode} noValidate>
          <Field
            label={t('signIn.identifier')}
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck="false"
            value={form.values.identifier}
            error={error('identifier')}
            onChange={(event) => form.setValue('identifier', event.target.value)}
          />
          <Button block type="submit" loading={busy}>
            {t('forgot.sendCode')}
          </Button>
        </form>
        {back}
      </AuthLayout>
    );
  }

  if (step === 'code') {
    return (
      <AuthLayout title={t('forgot.title')} intro={t('forgot.codeIntro')}>
        <form className="auth__form" onSubmit={checkCode} noValidate>
          {sentAgain ? <Banner status="normal">{t('forgot.sentAgain')}</Banner> : null}
          {codeWrong ? <Banner status="alert">{t('forgot.codeWrong')}</Banner> : null}
          <Field
            label={t('forgot.code')}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={form.values.code}
            error={error('code')}
            onChange={(event) => form.setValue('code', event.target.value.replace(/\D/g, ''))}
          />
          <Button block type="submit" loading={busy}>
            {t('forgot.continue')}
          </Button>
          <Button block variant="ghost" onClick={resend} disabled={busy}>
            {t('forgot.resend')}
          </Button>
        </form>
        {back}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('forgot.newPasswordTitle')} intro={t('forgot.newPasswordIntro')}>
      <form className="auth__form" onSubmit={save} noValidate>
        <PasswordField
          label={t('forgot.newPassword')}
          autoComplete="new-password"
          showRules
          value={form.values.password}
          error={error('password')}
          onChange={(event) => form.setValue('password', event.target.value)}
        />
        <Button block type="submit" loading={busy}>
          {t('forgot.save')}
        </Button>
      </form>
      {back}
    </AuthLayout>
  );
}
