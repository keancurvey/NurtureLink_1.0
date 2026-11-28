import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Tabs from '../../components/ui/Tabs.jsx';
import { useStoreState, useViewer } from '../../store/hooks.js';
import { approvalsOf, officeThreadsOf, referralInboxOf } from '../../store/selectors.js';
import Approvals from './Approvals.jsx';
import OfficeChatList from './OfficeChatList.jsx';
import ReferralInbox from './ReferralInbox.jsx';

const VIEWS = ['approvals', 'chats', 'referrals'];

/**
 * The Consult tab of a super account (SUP-C-01, SUP-C-02): the shared approvals queue, the chats with patients, and the referral inbox.
 * The section is part of the address (?view=), so Back from a chat or a profile returns to the same one.
 */
export default function OfficeConsult() {
  const { t } = useTranslation('tracker');
  const [params, setParams] = useSearchParams();
  const state = useStoreState();
  const viewer = useViewer();
  const view = VIEWS.includes(params.get('view')) ? params.get('view') : 'approvals';
  const waiting = approvalsOf(state, viewer).pending.length;
  const unreadChats = officeThreadsOf(state, viewer).reduce((sum, row) => sum + row.unread, 0);
  const newReferrals = referralInboxOf(state, viewer).filter((r) => !r.read).length;
  const count = { approvals: waiting, chats: unreadChats, referrals: newReferrals };
  const items = VIEWS.map((id) => ({ id, label: count[id] > 0 ? `${t(`consult.views.${id}`)} (${count[id]})` : t(`consult.views.${id}`) }));

  return (
    <section className="page page--wide">
      <h1 className="page__title">{t('consult.title')}</h1>
      <Tabs items={items} value={view} label={t('consult.views.label')} onChange={(id) => setParams(id === 'approvals' ? {} : { view: id }, { replace: true })} />
      <div role="tabpanel" aria-labelledby={`tab-${view}`} className="stack">
        {view === 'approvals' ? <Approvals /> : view === 'chats' ? <OfficeChatList /> : <ReferralInbox />}
      </div>
    </section>
  );
}
