import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import { OFFICE } from '../../config/thresholds.js';
import { formatDateTime } from '../../lib/format.js';
import { useStoreState, useViewer } from '../../store/hooks.js';
import { activityLogsOf } from '../../store/selectors.js';

/** What an export entry says it was filtered by: the seeded entries hold the text, newer ones the barangay chosen (null for all of them). */
const filterText = (t, row) => (row.barangay_id === null || row.filter === 'All barangays' ? t('logs.allBarangays') : row.filter);

/**
 * The activity logs a super account reads (SUP-X-02, SUP-T-03): which account opened which patient record, and which account exported the
 * list with what filter and how many rows. Newest first. Route: /super/profile/logs.
 */
export default function ActivityLogs() {
  const { t, i18n } = useTranslation('tracker');
  const state = useStoreState();
  const viewer = useViewer();
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const [tab, setTab] = useState('access');
  const [shown, setShown] = useState(OFFICE.logShown);
  const logs = activityLogsOf(state, viewer);
  const rows = logs[tab];

  return (
    <section className="page page--wide">
      <header className="chat__header">
        <Link className="icon-btn icon-btn--fixed" to="/super/profile" aria-label={t('logs.back')}>
          <ArrowLeft size={24} aria-hidden="true" />
        </Link>
        <h1 className="chat__title">{t('logs.title')}</h1>
      </header>
      <Tabs
        items={[
          { id: 'access', label: t('logs.tabs.access') },
          { id: 'exports', label: t('logs.tabs.exports') },
        ]}
        value={tab}
        label={t('logs.tabs.label')}
        onChange={(id) => {
          setTab(id);
          setShown(OFFICE.logShown);
        }}
      />
      <Card className="stack" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {rows.length === 0 ? (
          <p className="card__meta">{t(tab === 'access' ? 'logs.emptyAccess' : 'logs.emptyExports')}</p>
        ) : (
          <ul className="log-list">
            {rows.slice(0, shown).map((row) => (
              <li key={row.id} className="log-list__row">
                <span>
                  {tab === 'access'
                    ? t(`logs.${row.action}`, { actor: row.actor, patient: row.patient })
                    : t('logs.export', { actor: row.actor, count: row.row_count, filter: filterText(t, row) })}
                </span>
                {tab === 'exports' && row.contacts_omitted ? <span className="card__meta">{t('logs.omitted')}</span> : null}
                <span className="card__meta">{formatDateTime(row.at, lang)}</span>
              </li>
            ))}
          </ul>
        )}
        {rows.length > shown ? (
          <Button variant="ghost" onClick={() => setShown((n) => n + OFFICE.logShown)}>
            {t('logs.more')}
          </Button>
        ) : null}
      </Card>
    </section>
  );
}
