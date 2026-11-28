import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Banner from '../../components/ui/Banner.jsx';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import Select from '../../components/ui/Select.jsx';
import Sheet from '../../components/ui/Sheet.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { hasOpenItems } from '../../lib/accountRules.js';
import { useActions, useStoreState, useViewer } from '../../store/hooks.js';
import { openItemsFor } from '../../store/selectors.js';

const failureText = (t, error) => t(`accounts.error.${error}`, { defaultValue: t('accounts.error.generic') });

/** A temporary password, shown once (SUP-P-01): it is not kept anywhere on screen after this is closed. */
export function TempPasswordSheet({ title, body, password, extra = null, onClose }) {
  const { t } = useTranslation('tracker');
  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="stack">
        <p>{body}</p>
        {extra}
        <p className="card__meta">{t('accounts.tempLabel')}</p>
        <p className="temp-password" aria-live="polite">
          {password}
        </p>
        <Button block onClick={onClose}>
          {t('accounts.tempDone')}
        </Button>
      </div>
    </Sheet>
  );
}

/** Reset the password of an account (SUP-P-01): a new temporary password that must be changed at the next sign-in. */
export function ResetSheet({ account, onClose }) {
  const { t } = useTranslation('tracker');
  const actions = useActions();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const [password, setPassword] = useState(null);

  async function run() {
    setBusy(true);
    setFailure(null);
    const result = await actions.reset_provider_password(account.id);
    setBusy(false);
    if (result.ok) setPassword(result.temporary_password);
    else setFailure(result.error);
  }

  if (password) return <TempPasswordSheet title={t('accounts.tempTitle')} body={t('accounts.tempBody', { name: account.full_name })} password={password} onClose={onClose} />;
  return (
    <Sheet open onClose={onClose} title={t('accounts.resetTitle')}>
      <div className="stack">
        <p>{t('accounts.resetBody', { name: account.full_name })}</p>
        {failure ? <Banner status="attention">{failureText(t, failure)}</Banner> : null}
        <Button block loading={busy} onClick={run}>
          {t('accounts.resetAction')}
        </Button>
        <Button block variant="ghost" onClick={onClose}>
          {t('accounts.cancel')}
        </Button>
      </div>
    </Sheet>
  );
}

/** Update the contact number of an account (SUP-P-01). */
export function ContactSheet({ account, onClose }) {
  const { t } = useTranslation('tracker');
  const actions = useActions();
  const toast = useToast();
  const [contact, setContact] = useState(account.contact_no ?? '');
  const [error, setError] = useState(null);
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const result = await actions.update_provider_contact(account.id, { contact_no: contact });
    setBusy(false);
    if (result.ok) {
      toast.show({ message: t('accounts.contactSaved'), status: 'normal' });
      onClose();
    } else if (result.errors) setError(result.errors.contact_no);
    else setFailure(result.error);
  }

  return (
    <Sheet open onClose={onClose} title={t('accounts.contactTitle')}>
      <form className="stack" onSubmit={submit} noValidate>
        <p className="card__meta">{account.full_name}</p>
        <Field
          label={t('accounts.contactLabel')}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={contact}
          onChange={(event) => {
            setContact(event.target.value);
            setError(null);
          }}
          error={error ? t(`accountForm.error.${error}`) : undefined}
        />
        {failure ? <Banner status="attention">{failureText(t, failure)}</Banner> : null}
        <Button block type="submit" loading={busy}>
          {t('accounts.contactSave')}
        </Button>
        <Button block variant="ghost" onClick={onClose}>
          {t('accounts.cancel')}
        </Button>
      </form>
    </Sheet>
  );
}

/** Hand what a deactivated account left open to another active account at the same level (ACC-08). */
export function HandOverSheet({ account, onClose }) {
  const { t } = useTranslation('tracker');
  const actions = useActions();
  const state = useStoreState();
  const viewer = useViewer();
  const toast = useToast();
  const open = openItemsFor(state, viewer, account.id);
  const candidates = state.db.profiles.filter((p) => p.active && p.role === account.role && p.id !== account.id && (account.role === 'super' || p.barangay_id === account.barangay_id));
  const [to, setTo] = useState(candidates[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);

  async function run() {
    setBusy(true);
    setFailure(null);
    const result = await actions.reassign_provider(account.id, to);
    setBusy(false);
    if (result.ok) {
      toast.show({ message: t('accounts.handed', { count: result.moved, name: candidates.find((p) => p.id === to)?.full_name ?? '' }), status: 'normal' });
      onClose();
    } else setFailure(result.error);
  }

  return (
    <Sheet open onClose={onClose} title={t('accounts.handTitle')}>
      <div className="stack">
        <p>{t('accounts.handBody', { name: account.full_name })}</p>
        <ul className="plain-list">
          {open.appointments.length > 0 ? <li>{t('accounts.handAppointments', { count: open.appointments.length })}</li> : null}
          {open.threads.length > 0 ? <li>{t('accounts.handThreads', { count: open.threads.length })}</li> : null}
          {open.alerts.length > 0 ? <li>{t('accounts.handAlerts', { count: open.alerts.length })}</li> : null}
        </ul>
        {candidates.length === 0 ? (
          <Banner status="info">{t('accounts.handNobody')}</Banner>
        ) : (
          <Select label={t('accounts.handTo')} value={to} onChange={(event) => setTo(event.target.value)} options={candidates.map((p) => ({ value: p.id, label: p.full_name }))} />
        )}
        {failure ? <Banner status="attention">{failureText(t, failure)}</Banner> : null}
        <Button block loading={busy} disabled={candidates.length === 0 || !hasOpenItems(open)} onClick={run}>
          {t('accounts.handAction')}
        </Button>
        <Button block variant="ghost" onClick={onClose}>
          {t('accounts.handSkip')}
        </Button>
      </div>
    </Sheet>
  );
}

/**
 * Deactivate an account (ACC-06). Its open chats, alerts and appointments stay visible; when it left some open, the next step offers to hand
 * them over (ACC-08), and when its barangay is left with no active account the screen says where its alerts and chats go now (ACC-09).
 */
export function DeactivateSheet({ account, barangayName, onClose, onHandOver }) {
  const { t } = useTranslation('tracker');
  const actions = useActions();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);

  async function run() {
    setBusy(true);
    setFailure(null);
    const result = await actions.deactivate_provider(account.id);
    setBusy(false);
    if (!result.ok) return setFailure(result.error);
    toast.show({ message: [t('accounts.deactivated', { name: account.full_name }), result.barangay_uncovered ? t('accounts.uncovered', { barangay: barangayName }) : null].filter(Boolean).join(' '), status: 'normal' });
    if (result.has_open) onHandOver(account);
    else onClose();
    return undefined;
  }

  return (
    <Sheet open onClose={onClose} title={t('accounts.deactivateTitle', { name: account.full_name })}>
      <div className="stack">
        <p>{t('accounts.deactivateBody', { name: account.full_name })}</p>
        {failure ? <Banner status="attention">{failureText(t, failure)}</Banner> : null}
        <Button block loading={busy} onClick={run}>
          {t('accounts.deactivateAction')}
        </Button>
        <Button block variant="ghost" onClick={onClose}>
          {t('accounts.cancel')}
        </Button>
      </div>
    </Sheet>
  );
}
