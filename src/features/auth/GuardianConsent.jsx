import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../../components/ui/Button.jsx';
import Checkbox from '../../components/ui/Checkbox.jsx';
import Field from '../../components/ui/Field.jsx';
import Select from '../../components/ui/Select.jsx';
import { usePresenterActions } from '../../components/presenter/presenterRegistry.jsx';
import { useTypingFill } from '../../components/presenter/useTypingFill.js';
import { GUARDIAN_FILL } from '../../components/presenter/fillData.js';
import { AUTH } from '../../config/thresholds.js';
import { GUARDIAN_RELATIONSHIPS, validateGuardian } from '../../lib/authRules.js';
import { useActions, useViewer } from '../../store/hooks.js';
import AuthLayout from './AuthLayout.jsx';
import { useForm } from './useForm.js';

/** AUTH-06: a patient under 18 needs a parent or guardian to complete this form before she can use the app. */
export default function GuardianConsent() {
  const { t } = useTranslation('consent');
  const actions = useActions();
  const viewer = useViewer();
  const form = useForm({ guardian_name: '', relationship: '', contact: '', acknowledged: false });
  const type = useTypingFill();
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const error = (name) => (form.errors[name] ? t(`error.${form.errors[name]}`, { ns: 'auth' }) : undefined);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const errors = validateGuardian(form.values);
    if (Object.keys(errors).length > 0) {
      form.setErrors(errors);
      return;
    }
    setBusy(true);
    const result = await actions.save_guardian_consent(form.values);
    if (!mounted.current) return;
    setBusy(false);
    if (!result.ok) form.setErrors(result.errors);
  }

  usePresenterActions([
    {
      id: 'fill-guardian',
      labelKey: 'presenter:fill.guardian',
      onSelect: () => {
        form.clearErrors();
        type([
          { set: (value) => form.setValue('guardian_name', value), value: GUARDIAN_FILL.guardian_name },
          { set: (value) => form.setValue('relationship', value), value: GUARDIAN_FILL.relationship, instant: true },
          { set: (value) => form.setValue('contact', value), value: GUARDIAN_FILL.contact },
          { set: (value) => form.setValue('acknowledged', value), value: true, instant: true },
        ]);
      },
    },
  ]);

  return (
    <AuthLayout title={t('guardian.title')} intro={t('guardian.intro')}>
      <form className="auth__form" onSubmit={submit} noValidate>
        <Field
          label={t('guardian.name')}
          autoComplete="off"
          value={form.values.guardian_name}
          error={error('guardian_name')}
          onChange={(event) => form.setValue('guardian_name', event.target.value)}
        />
        <Select
          label={t('guardian.relationship')}
          value={form.values.relationship}
          error={error('relationship')}
          onChange={(event) => form.setValue('relationship', event.target.value)}
          options={[
            { value: '', label: t('guardian.chooseRelationship') },
            ...GUARDIAN_RELATIONSHIPS.map((key) => ({ value: key, label: t(`guardian.relationships.${key}`) })),
          ]}
        />
        <Field
          label={t('guardian.contact')}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={form.values.contact}
          error={error('contact')}
          onChange={(event) => form.setValue('contact', event.target.value)}
        />
        <Checkbox
          label={t('guardian.acknowledge', { name: viewer?.full_name ?? '', version: AUTH.termsVersion })}
          checked={form.values.acknowledged}
          error={error('acknowledged')}
          onChange={(next) => form.setValue('acknowledged', next)}
        />
        <Button block type="submit" loading={busy}>
          {t('guardian.submit')}
        </Button>
        <Button block variant="ghost" onClick={() => actions.sign_out()} disabled={busy}>
          {t('guardian.signOut')}
        </Button>
      </form>
    </AuthLayout>
  );
}
