import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PatientNotices from '../../components/alerts/PatientNotices.jsx';
import Banner from '../../components/ui/Banner.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { useActions } from '../../store/hooks.js';
import CheckStatus from './CheckStatus.jsx';
import DevicesCard from './DevicesCard.jsx';
import LastCheckCard from './LastCheckCard.jsx';
import { reasonText } from './reasons.js';
import { useHomeData } from './useHomeData.js';

const CHECK_PATH = '/patient/home/check';
const PAIR_PATH = '/patient/pair';

/** The patient's Home (spec 3.2, PAT-H-01 to PAT-H-06): last check, Check now, and one row per device. */
export default function Home() {
  const { t } = useTranslation('home');
  const navigate = useNavigate();
  const actions = useActions();
  const data = useHomeData();
  const [connecting, setConnecting] = useState(() => new Set());
  const [refusal, setRefusal] = useState(null);
  const { belt, band, live, running, verdict } = data;

  function checkNow() {
    const outcome = actions.start_check();
    setRefusal(outcome.started ? null : outcome);
    if (outcome.started) navigate(CHECK_PATH);
  }

  async function connect(serial) {
    setConnecting((current) => new Set(current).add(serial));
    try {
      await actions.connect_device(serial);
    } finally {
      setConnecting((current) => {
        const next = new Set(current);
        next.delete(serial);
        return next;
      });
    }
  }

  const reason = verdict.allowed ? null : verdict.reason;
  const reasonCode = refusal?.reason ?? reason?.code;
  const reasonDevice = refusal ? refusal.device : reason?.device;
  const reasonId = 'check-now-reason';

  if (!belt && !band) {
    return (
      <section className="page">
        <h1 className="page__title">{t('title')}</h1>
        <Card>
          <EmptyState
            illustration="belt"
            title={t('pairPrompt.title')}
            action={<Button onClick={() => navigate(PAIR_PATH)}>{t('pairPrompt.action')}</Button>}
          >
            {t('pairPrompt.body')}
          </EmptyState>
        </Card>
        <PatientNotices />
        <LastCheckCard session={data.session} statuses={data.statuses} waiting={data.waiting} syncedAt={data.syncedAt} />
      </section>
    );
  }

  return (
    <section className="page">
      <h1 className="page__title">{t('title')}</h1>

      {running ? (
        <Card className="stack">
          <div className="card__head">
            <h2 className="card__title">{t('check.running')}</h2>
          </div>
          <CheckStatus live={live} />
          <Button variant="ghost" block onClick={() => navigate(CHECK_PATH)}>
            {t('check.view')}
          </Button>
        </Card>
      ) : null}

      {live?.phase === 'failed' ? (
        <Banner
          status="alert"
          title={t('check.failedTitle')}
          action={
            <Button variant="ghost" onClick={() => actions.dismiss_check()}>
              {t('check.done')}
            </Button>
          }
        >
          {reasonText(t, live.reason ?? 'no_reading')}
        </Banner>
      ) : null}

      <PatientNotices />

      <LastCheckCard session={data.session} statuses={data.statuses} waiting={data.waiting} syncedAt={data.syncedAt} />

      <div className="stack">
        <Button block disabled={!verdict.allowed} aria-describedby={reasonCode ? reasonId : undefined} onClick={checkNow}>
          {t('checkNow.button')}
        </Button>
        {reasonCode ? (
          <p id={reasonId} className="card__note">
            {reasonText(t, reasonCode, reasonDevice)}
          </p>
        ) : (
          <p className="card__meta">{t('checkNow.hint')}</p>
        )}
      </div>

      <DevicesCard belt={belt} band={band} thresholds={data.thresholds} connecting={connecting} onConnect={connect} onPair={() => navigate(PAIR_PATH)} />
    </section>
  );
}
