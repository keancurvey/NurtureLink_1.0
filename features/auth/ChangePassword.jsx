import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../../components/ui/Button.jsx';
import { usePresenterActions } from '../../components/presenter/presenterRegistry.jsx';
import { useTypingFill } from '../../components/presenter/useTypingFill.js';
import { FILL_PASSWORD } from '../../components/presenter/fillData.js';
import { validateNewPassword } from '../../lib/authRules.js';
import { useActions } from '../../store/hooks.js';
import AuthLayout from './AuthLayout.jsx';
import PasswordField from './PasswordField.jsx';
import { useForm } from './useForm.js';

/** AUTH-03: a health worker or midwife account chooses her own password on the first sign-in, before anything else. */
export default function ChangePassword() {
  const { t } = useTranslation('auth');
  const actions = useActions();
  const form = useForm({ password: '' });
  const type = useTypingFill();
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const errors = validateNewPassword({ password: form.values.password });
    if (Object.keys(errors).length > 0) {
      form.setErrors(errors);
      return;
    }
    setBusy(true);
    const result = await actions.change_password({ password: form.values.password });
    if (!mounted.current) return; // changed: the route moves on to the terms
    setBusy(false);
    if (!result.ok) form.setErrors(result.errors);
  }

  usePresenterActions([
    { id: 'fill-password', labelKey: 'presenter:fill.password', onSelect: () => { form.clearErrors(); type([{ set: (value) => form.setValue('password', value), value: FILL_PASSWORD }]); } },
  ]);

  return (
    <AuthLayout title={t('changePassword.title')} intro={t('changePassword.intro')}>
      <form className="auth__form" onSubmit={submit} noValidate>
        <PasswordField
          label={t('changePassword.newPassword')}
          autoComplete="new-password"
          showRules
          value={form.values.password}
          error={form.errors.password ? t(`error.${form.errors.password}`) : undefined}
          onChange={(event) => form.setValue('password', event.target.value)}
        />
        <Button block type="submit" loading={busy}>
          {t('changePassword.save')}
        </Button>
        <Button block variant="ghost" onClick={() => actions.sign_out()} disabled={busy}>
          {t('changePassword.signOut')}
        </Button>
      </form>
    </AuthLayout>
  );
}
