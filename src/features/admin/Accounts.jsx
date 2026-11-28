import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Select from '../../components/ui/Select.jsx';
import { canDeactivate, hasOpenItems } from '../../lib/accountRules.js';
import { useStoreState, useViewer } from '../../store/hooks.js';
import { accountsOf, openItemsFor } from '../../store/selectors.js';
import { ContactSheet, DeactivateSheet, HandOverSheet, ResetSheet } from './AccountSheets.jsx';

/** Why the Deactivate button is not there, or null when it is. The last active super account cannot be deactivated (ACC-06), and an account does not deactivate itself. */
function blockedReason(account, viewer, profiles) {
  const check = canDeactivate(account, viewer.id, profiles);
  return check.ok ? null : check.error;
}

/** The accounts a super account manages (SUP-P-01, ACC-06): create, reset password, update contact, deactivate, and hand over what a deactivated account left open (ACC-08). Route: /super/profile/accounts. */
export default function Accounts() {
  const { t } = useTranslation('tracker');
  const state = useStoreState();
  const viewer = useViewer();
  const [params, setParams] = useSearchParams();
  const [sheet, setSheet] = useState(null); // { kind: 'reset' | 'contact' | 'deactivate' | 'hand', account }
  const close = useCallback(() => setSheet(null), []);
  const filter = params.get('show') ?? '';
  const all = accountsOf(state, viewer);
  const rows = all.filter((a) => (filter === 'super' ? a.role === 'super' : filter ? a.barangay_id === filter : true));
  const options = [{ value: '', label: t('accounts.filterAll') }, { value: 'super', label: t('accounts.filterSuper') }, ...state.db.barangays.map((b) => ({ value: b.id, label: b.name }))];
  const barangayName = (account) => state.db.barangays.find((b) => b.id === account.barangay_id)?.name ?? '';

  return (
    <section className="page page--wide">
      <header className="chat__header">
        <Link className="icon-btn icon-btn--fixed" to="/super/profile" aria-label={t('accounts.back')}>
          <ArrowLeft size={24} aria-hidden="true" />
        </Link>
        <h1 className="chat__title">{t('accounts.title')}</h1>
      </header>
      <Link className="btn btn--primary btn--block" to="/super/profile/accounts/new">
        <Plus size={24} aria-hidden="true" />
        {t('accounts.create')}
      </Link>
      <Card>
        <Select label={t('accounts.filter')} value={filter} options={options} onChange={(event) => setParams(event.target.value ? { show: event.target.value } : {}, { replace: true })} />
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState illustration="heart" title={t('accounts.empty')} />
        </Card>
      ) : (
        <ul className="bookings office-grid" aria-label={t('accounts.list')}>
          {rows.map((account) => {
            const blocked = account.active ? blockedReason(account, viewer, state.db.profiles) : null;
            const hasOpen = !account.active && hasOpenItems(openItemsFor(state, viewer, account.id));
            return (
              <li key={account.id} className="booking">
                <div className="booking__head">
                  <h2 className="booking__title">{account.full_name}</h2>
                  <Badge status={account.active ? 'normal' : 'neutral'}>{t(`accounts.status.${account.active ? 'active' : 'inactive'}`)}</Badge>
                </div>
                <p className="card__meta">{[t(`accounts.role.${account.role}`), account.role === 'barangay' ? barangayName(account) : null].filter(Boolean).join(' · ')}</p>
                <p className="card__meta">{[account.contact_no, account.email].filter(Boolean).join(' · ')}</p>
                {account.id === viewer.id ? <p className="card__meta">{t('accounts.you')}</p> : null}
                {blocked === 'last_super' ? <p className="card__meta">{t('accounts.lastSuper')}</p> : null}
                {blocked === 'self' ? <p className="card__meta">{t('accounts.self')}</p> : null}
                <div className="alert-actions">
                  <Button variant="ghost" onClick={() => setSheet({ kind: 'reset', account })}>
                    {t('accounts.reset')}
                  </Button>
                  <Button variant="ghost" onClick={() => setSheet({ kind: 'contact', account })}>
                    {t('accounts.contact')}
                  </Button>
                  {account.active && !blocked ? (
                    <Button variant="ghost" onClick={() => setSheet({ kind: 'deactivate', account })}>
                      {t('accounts.deactivate')}
                    </Button>
                  ) : null}
                  {hasOpen ? (
                    <Button variant="ghost" onClick={() => setSheet({ kind: 'hand', account })}>
                      {t('accounts.handOver')}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {sheet?.kind === 'reset' ? <ResetSheet account={sheet.account} onClose={close} /> : null}
      {sheet?.kind === 'contact' ? <ContactSheet account={sheet.account} onClose={close} /> : null}
      {sheet?.kind === 'deactivate' ? <DeactivateSheet account={sheet.account} barangayName={barangayName(sheet.account)} onClose={close} onHandOver={(account) => setSheet({ kind: 'hand', account })} /> : null}
      {sheet?.kind === 'hand' ? <HandOverSheet account={sheet.account} onClose={close} /> : null}
    </section>
  );
}
