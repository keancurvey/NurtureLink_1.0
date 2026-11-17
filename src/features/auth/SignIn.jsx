import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Banner from '../../components/ui/Banner.jsx';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import Sheet from '../../components/ui/Sheet.jsx';
import { usePresenterActions } from '../../components/presenter/presenterRegistry.jsx';
import { useTypingFill } from '../../components/presenter/useTypingFill.js';
import { FILL_LABELS } from '../../components/presenter/fillData.js';
import { newestCreatedProvider, signInFillFor, thresholdsOf } from '../../store/selectors.js';
import { useActions, useRuntime, useStoreValue } from '../../store/hooks.js';
import { PRESENTER_ACCOUNTS } from '../../lib/permissions.js';
import { validateSignIn } from '../../lib/authRules.js';
import AuthLayout from './AuthLayout.jsx';
import PasswordField from './PasswordField.jsx';
import { useForm } from './useForm.js';

/** AUTH-02 to AUTH-04: one field for a contact number or an email, a password, a clear error, a short wait after repeated failures. */
export default function SignIn() {
  const { t } = useTranslation('auth');
  const actions = useActions();
  const runtime = useRuntime();
  const location = useLocation();
  const form = useForm({ identifier: '', password: '' });
  const type = useTypingFill();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null); // 'invalid' | 'inactive'
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);
  const notice = useStoreValue((state) => state.live.notice);
  const timeoutMinutes = useStoreValue((state) => thresholdsOf(state).providerSession.timeoutMinutes);
  const createdId = useStoreValue((state) => newestCreatedProvider(state)?.id ?? '');
  const passwordChanged = location.state?.passwordChanged === true;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // While the wait after repeated failures runs, count it down on screen.
  useEffect(() => {
    if (!lockedUntil) return undefined;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= lockedUntil) setLockedUntil(0);
    }, 500);
    return () => clearInterval(timer);
  }, [lockedUntil]);
  const waitSeconds = lockedUntil ? Math.max(1, Math.ceil((lockedUntil - now) / 1000)) : 0;

  const error = (name) => (form.errors[name] ? t(`error.${form.errors[name]}`) : undefined);

  async function submit(event) {
    event.preventDefault();
    if (busy || waitSeconds > 0) return;
    const errors = validateSignIn(form.values);
    if (Object.keys(errors).length > 0) {
      form.setErrors(errors);
      return;
    }
    setBusy(true);
    setFailure(null);
    const result = await actions.sign_in(form.values);
    if (!mounted.current) return; // she is in: the route has already taken her on
    setBusy(false);
    if (result.ok) return;
    if (result.error === 'form') form.setErrors(result.errors);
    else if (result.error === 'locked') {
      setNow(Date.now());
      setLockedUntil(Date.now() + result.retryAfterMs);
    } else setFailure(result.error);
    form.setValue('password', '');
  }

  function fillAccount(profileId) {
    const fill = signInFillFor(runtime.store.getState(), profileId);
    if (!fill) return;
    form.clearErrors();
    setFailure(null);
    type([
      { set: (value) => form.setValue('identifier', value), value: fill.identifier },
      { set: (value) => form.setValue('password', value), value: fill.password },
    ]);
  }

  usePresenterActions([
    ...PRESENTER_ACCOUNTS.map(({ id }) => ({ id: `fill-${id}`, labelKey: FILL_LABELS[id], onSelect: () => fillAccount(id) })),
    ...(createdId ? [{ id: 'fill-created', labelKey: 'presenter:fill.created', onSelect: () => fillAccount(createdId) }] : []),
  ]);

  const dismissNotice = () => runtime.auth.dismissNotice();

  return (
    <AuthLayout title={t('signIn.title')} intro={t('signIn.welcome')}>
      {passwordChanged ? <Banner status="normal">{t('signIn.passwordChanged')}</Banner> : null}
      <form className="auth__form" onSubmit={submit} noValidate>
        {failure === 'invalid' ? <Banner status="alert">{t('signIn.invalid')}</Banner> : null}
        {failure === 'inactive' ? <Banner status="alert">{t('signIn.inactive')}</Banner> : null}
        {waitSeconds > 0 ? <Banner status="attention">{t('signIn.locked', { count: waitSeconds })}</Banner> : null}
        <Field
          label={t('signIn.identifier')}
          type="text"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck="false"
          value={form.values.identifier}
          error={error('identifier')}
          onChange={(event) => form.setValue('identifier', event.target.value)}
        />
        <PasswordField
          label={t('signIn.password')}
          autoComplete="current-password"
          value={form.values.password}
          error={error('password')}
          onChange={(event) => form.setValue('password', event.target.value)}
        />
        <Button block type="submit" loading={busy} disabled={waitSeconds > 0}>
          {t('signIn.submit')}
        </Button>
      </form>
      <div className="auth__links">
        <Link className="link" to="/forgot-password">
          {t('signIn.forgot')}
        </Link>
        <p>
          {t('signIn.newHere')}{' '}
          <Link className="link" to="/sign-up">
            {t('signIn.createAccount')}
          </Link>
        </p>
      </div>
      <Sheet
        open={notice === 'session_expired'}
        onClose={dismissNotice}
        title={t('sessionEnded.title')}
        footer={
          <Button block onClick={dismissNotice}>
            {t('sessionEnded.action')}
          </Button>
        }
      >
        <p>{t('sessionEnded.body', { minutes: timeoutMinutes })}</p>
      </Sheet>
    </AuthLayout>
  );
}
