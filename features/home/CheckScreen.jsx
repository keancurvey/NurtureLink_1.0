import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Banner from '../../components/ui/Banner.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import SoftArt from '../../components/ui/SoftArt.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import { formatDateTime } from '../../lib/format.js';
import { useActions, useStoreValue, useViewer } from '../../store/hooks.js';
import { liveCheckOf } from '../../store/selectors.js';
import CheckStatus from './CheckStatus.jsx';
import ReadingsGrid from './ReadingsGrid.jsx';
import { reasonText } from './reasons.js';
import { RUNNING_PHASES, useCheckResult } from './useHomeData.js';
import { useWakeLock } from './useWakeLock.js';

/** PAT-H-04 and PAT-H-05: the progress of a check, the prompts, a retry when it did not finish, and the result when it did. */
export default function CheckScreen() {
  const { t, i18n } = useTranslation('home');
  const navigate = useNavigate();
  const actions = useActions();
  const viewer = useViewer();
  const live = useStoreValue((state) => liveCheckOf(state, viewer));
  const result = useCheckResult(live?.phase === 'complete' ? live.session_id : null);
  const [refusal, setRefusal] = useState(null);
  const running = Boolean(live) && RUNNING_PHASES.includes(live.phase);
  useWakeLock(running);

  if (!live) return <Navigate to="/patient/home" replace />;

  const leave = () => {
    actions.dismiss_check();
    navigate('/patient/home', { replace: true });
  };
  function retry() {
    const outcome = actions.start_check();
    setRefusal(outcome.started ? null : outcome);
  }

  return (
    <section className="page">
      <h1 className="page__title">{t('check.title')}</h1>
      {running ? (
        <Card className="stack">
          <div className="check-art">
            <SoftArt name="belt" size="md" float />
          </div>
          <CheckStatus live={live} />
          <p className="card__meta">{t('check.keepOpen')}</p>
          <Button variant="ghost" block onClick={() => actions.stop_check()}>
            {t('check.stop')}
          </Button>
        </Card>
      ) : null}

      {live.phase === 'failed' ? (
        <Card className="stack">
          <Banner status="alert" title={t('check.failedTitle')}>
            {refusal ? reasonText(t, refusal.reason, refusal.device) : reasonText(t, live.reason ?? 'no_reading')}
          </Banner>
          <Button block onClick={retry}>
            {t('check.retry')}
          </Button>
          <Button variant="ghost" block onClick={leave}>
            {t('check.back')}
          </Button>
        </Card>
      ) : null}

      {live.phase === 'complete' ? (
        <Card className="stack">
          <div className="card__head">
            <h2 className="card__title">{t('check.result')}</h2>
            {result?.statuses.overall ? <StatusBadge status={result.statuses.overall} /> : null}
          </div>
          {result ? (
            <>
              <p className="card__meta">{formatDateTime(result.session.ended_at, i18n.language)}</p>
              <ReadingsGrid summary={result.session.summary} statuses={result.statuses} />
              {result.statuses.overall && result.statuses.overall !== 'normal' ? <p className="card__note">{t('last.worried')}</p> : null}
            </>
          ) : null}
          <Button block onClick={leave}>
            {t('check.done')}
          </Button>
        </Card>
      ) : null}
    </section>
  );
}
