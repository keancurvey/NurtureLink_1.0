import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import LineChart from '../../components/ui/LineChart.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import { MONITOR } from '../../config/thresholds.js';
import { MS_DAY } from '../../lib/dates.js';
import { formatDateTime } from '../../lib/format.js';
import { measureRange, readingSeries, seriesFacts } from '../../lib/monitor.js';
import { checkStatuses } from '../../lib/vitalStatus.js';
import { useNow } from '../home/useNow.js';

const MEASURE_KEYS = ['fhr', 'hr', 'spo2', 'temp'];
const PERIODS = ['short', 'long'];
const STEP = 5;

/**
 * The readings history of a patient (BRG-M-04): one chart for each reading over the last 7 or 21 days, its lowest, highest and
 * latest value, and the list of recent checks with the numbers behind the chart. Points outside the normal range are marked
 * with a triangle and counted in words.
 */
export default function ReadingsHistory({ sessions, thresholds }) {
  const { t, i18n } = useTranslation('monitor');
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const now = useNow(60000);
  const [measure, setMeasure] = useState('fhr');
  const [period, setPeriod] = useState('long');
  const [shown, setShown] = useState(STEP);
  const days = MONITOR.chartDays[period];
  const unit = t(`vitals.unit.${measure === 'spo2' ? 'spo2' : measure === 'temp' ? 'temp' : 'bpm'}`);

  const points = useMemo(() => readingSeries(sessions, measure, { days, now, thresholds }), [sessions, measure, days, now, thresholds]);
  const facts = seriesFacts(points);
  const range = measureRange(measure, thresholds);
  const name = t(`vitals.${measure}`);
  const label = facts
    ? t('history.chartLabel', { name, days, count: facts.count, min: facts.min, max: facts.max, latest: facts.latest, unit, outside: facts.outOfRange })
    : t('history.chartNone', { name, days });
  const recent = sessions.filter((s) => s.status === 'completed' && s.summary).slice(0, shown);
  const more = sessions.filter((s) => s.status === 'completed' && s.summary).length > shown;

  return (
    <div className="stack">
      <div className="tabs--compact">
        <Tabs label={t('history.measure')} value={measure} onChange={setMeasure} items={MEASURE_KEYS.map((key) => ({ id: key, label: t(`history.tab.${key}`) }))} />
      </div>
      <div className="tabs--compact">
        <Tabs label={t('history.period')} value={period} onChange={setPeriod} items={PERIODS.map((key) => ({ id: key, label: t(`history.days.${key}`, { count: MONITOR.chartDays[key] }) }))} />
      </div>
      {facts ? (
        <>
          <LineChart points={points} range={range} from={now - days * MS_DAY} to={now} label={label} lang={lang} legend={{ normal: t('history.normalRange'), outside: t('history.outside') }} />
          <p className="card__meta" role="status">
            {t('history.facts', { count: facts.count, min: facts.min, max: facts.max, latest: facts.latest, unit })}
          </p>
          {facts.outOfRange > 0 ? <Badge status="alert">{t('history.outsideCount', { count: facts.outOfRange })}</Badge> : null}
        </>
      ) : (
        <p className="card__meta">{label}</p>
      )}

      <h3 className="card__title">{t('history.recent')}</h3>
      {recent.length === 0 ? (
        <p className="card__meta">{t('history.noChecks')}</p>
      ) : (
        <ul className="checks">
          {recent.map((session) => {
            const s = session.summary;
            const statuses = checkStatuses(s, thresholds);
            const dash = t('vitals.none');
            return (
              <li className="checks__item" key={session.id}>
                <div className="card__head">
                  <p className="checks__when">{formatDateTime(session.ended_at, lang)}</p>
                  {statuses.overall ? <StatusBadge status={statuses.overall} /> : null}
                </div>
                <p className="card__meta">
                  {t('history.row', {
                    fhr: s.fhr_bpm > 0 ? s.fhr_bpm : dash,
                    hr: s.hr_bpm > 0 ? s.hr_bpm : dash,
                    spo2: s.spo2_pct > 0 ? s.spo2_pct : dash,
                    temp: s.skin_temp_c != null ? s.skin_temp_c.toFixed(1) : dash,
                  })}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {more ? (
        <Button variant="ghost" onClick={() => setShown((n) => n + STEP)}>
          {t('history.more')}
        </Button>
      ) : null}
    </div>
  );
}
