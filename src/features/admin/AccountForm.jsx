import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Banner from '../../components/ui/Banner.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import Field from '../../components/ui/Field.jsx';
import Select from '../../components/ui/Select.jsx';
import { ACCOUNT_FILL } from '../../components/presenter/fillData.js';
import { usePresenterActions } from '../../components/presenter/presenterRegistry.jsx';
import { useTypingFill } from '../../components/presenter/useTypingFill.js';
import { useActions, useStoreState } from '../../store/hooks.js';
import { useForm } from '../auth/useForm.js';
import { TempPasswordSheet } from './AccountSheets.jsx';

/** A new barangay or super account (SUP-P-01, ACC-06): the temporary password is shown once and must be changed at its first sign-in. Route: /super/profile/accounts/new. */
export default function AccountForm() {
  const { t } = useTranslation('tracker');
  const actions = useActions();
  const state = useStoreState();
  const navigate = useNavigate();
  const fill = useTypingFill();
  const form = useForm({ role: 'barangay', full_name: '', email: '', contact_no: '', barangay_id: '', language: 'fil' });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const [created, setCreated] = useState(null);
  const { setValue } = form;

  const fillForm = useCallback(() => {
    const set = (name) => (value) => setValue(name, value);
    setValue('role', ACCOUNT_FILL.role);
    setValue('barangay_id', ACCOUNT_FILL.barangay_id);
    setValue('language', ACCOUNT_FILL.language);
    fill([
      { set: set('full_name'), value: ACCOUNT_FILL.full_name },
      { set: set('email'), value: ACCOUNT_FILL.email },
      { set: set('contact_no'), value: ACCOUNT_FILL.contact_no },
    ]);
  }, [fill, setValue]);
  usePresenterActions([{ id: 'fill-account', labelKey: 'presenter:fill.account', onSelect: fillForm }]);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const result = await actions.create_provider({ ...form.values, barangay_id: form.values.role === 'barangay' ? form.values.barangay_id : null });
    setBusy(false);
    if (result.ok) setCreated(result);
    else if (result.errors) form.setErrors(result.errors);
    else setFailure(result.error);
  }

  const error = (name) => (form.errors[name] ? t(`accountForm.error.${form.errors[name]}`) : undefined);
  const text = (name) => ({ value: form.values[name], error: error(name), onChange: (event) => setValue(name, event.target.value) });
  const done = useCallback(() => navigate('/super/profile/accounts', { replace: true }), [navigate]);
  return (
    <section className="page">
      <header className="chat__header">
        <Link className="icon-btn icon-btn--fixed" to="/super/profile/accounts" aria-label={t('accountForm.back')}>
          <ArrowLeft size={24} aria-hidden="true" />
        </Link>
        <h1 className="chat__title">{t('accountForm.title')}</h1>
      </header>
      <Card>
        <form className="stack" onSubmit={submit} noValidate>
          <p>{t('accountForm.intro')}</p>
          <Select label={t('accountForm.role')} {...text('role')} options={[{ value: 'barangay', label: t('accounts.role.barangay') }, { value: 'super', label: t('accounts.role.super') }]} />
          <Field label={t('accountForm.name')} autoComplete="off" {...text('full_name')} />
          <Field label={t('accountForm.email')} type="email" inputMode="email" autoComplete="off" {...text('email')} />
          <Field label={t('accountForm.contact')} type="tel" inputMode="tel" autoComplete="off" {...text('contact_no')} />
          {form.values.role === 'barangay' ? (
            <Select label={t('accountForm.barangay')} {...text('barangay_id')} options={[{ value: '', label: t('accountForm.choose') }, ...state.db.barangays.map((b) => ({ value: b.id, label: b.name }))]} />
          ) : null}
          <Select label={t('accountForm.language')} {...text('language')} options={[{ value: 'en', label: t('profile.english') }, { value: 'fil', label: t('profile.filipino') }]} />
          {failure ? <Banner status="attention">{t(`accounts.error.${failure}`, { defaultValue: t('accounts.error.generic') })}</Banner> : null}
          <Button block type="submit" loading={busy}>
            {t('accountForm.save')}
          </Button>
          <Link className="btn btn--ghost btn--block" to="/super/profile/accounts">
            {t('accountForm.cancel')}
          </Link>
        </form>
      </Card>
      {created ? (
        <TempPasswordSheet
          title={t('accountForm.createdTitle')}
          body={t('accountForm.createdBody', { name: created.profile.full_name })}
          extra={<p className="card__meta">{t('accountForm.createdAccount', { email: created.profile.email })}</p>}
          password={created.temporary_password}
          onClose={done}
        />
      ) : null}
    </section>
  );
}
