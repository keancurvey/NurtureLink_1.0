import { useTranslation } from 'react-i18next';
import { Check, Circle, LoaderCircle } from 'lucide-react';
import Banner from '../../components/ui/Banner.jsx';

const STEPS = ['contact', 'measuring', 'saving'];
const CURRENT = { starting: 0, contact: 0, acquiring: 1, finishing: 2, complete: 3 };

/** PAT-H-04: where the check is (contact test, measuring, saving), the progress, and the prompt the belt needs a reply to. */
export default function CheckStatus({ live }) {
  const { t } = useTranslation('home');
  const current = CURRENT[live.phase] ?? 0;
  const percent = live.phase === 'complete' ? 100 : live.total ? Math.round((live.windows / live.total) * 100) : 0;
  return (
    <div className="stack">
      <p className="check-phase">{live.phase === 'acquiring' ? t('check.phase.acquiring', { done: live.windows, total: live.total }) : t(`check.phase.${live.phase}`)}</p>
      <div
        className="progress"
        role="progressbar"
        aria-label={t('check.progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="progress__fill" style={{ '--progress': `${percent}%` }} />
      </div>
      <ol className="steps" aria-label={t('check.steps.label')}>
        {STEPS.map((step, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'pending';
          const Icon = state === 'done' ? Check : state === 'current' ? LoaderCircle : Circle;
          return (
            <li key={step} className={`steps__item steps__item--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <Icon size={20} aria-hidden="true" className={state === 'current' ? 'steps__spin' : undefined} />
              <span>{t(`check.steps.${step}`)}</span>
            </li>
          );
        })}
      </ol>
      {live.prompt === 'adjust_belt' ? <Banner status="attention" title={t('check.prompt.adjustBeltTitle')}>{t('check.prompt.adjustBelt')}</Banner> : null}
      {live.prompt === 'rest' ? <Banner status="attention" title={t('check.prompt.restTitle')}>{t('check.prompt.rest')}</Banner> : null}
    </div>
  );
}
