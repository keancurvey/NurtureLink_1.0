import { Video } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import { joinState } from '../../lib/consult.js';
import { formatDateLong, formatTime } from '../../lib/format.js';
import { manilaDate } from '../../lib/dates.js';

/** The Join video button for an appointment (PAT-C-05): active from 10 minutes before to 60 minutes after the time. */
export function JoinButton({ appointment, now, block = true }) {
  const { t, i18n } = useTranslation('consult');
  const join = joinState(appointment, now);
  const open = join.state === 'open';
  return (
    <>
      {open ? (
        <Link className={`btn btn--primary${block ? ' btn--block' : ''}`} to={`/patient/consult/call/${appointment.id}`}>
          <Video size={24} aria-hidden="true" />
          {t('join.button')}
        </Link>
      ) : (
        <Button block={block} disabled aria-describedby={`join-hint-${appointment.id}`}>
          <Video size={24} aria-hidden="true" />
          {t('join.button')}
        </Button>
      )}
      <p id={`join-hint-${appointment.id}`} className="card__meta">
        {open ? t('join.open') : join.state === 'early' ? t('join.early', { time: formatTime(join.opens, i18n.language) }) : ''}
      </p>
    </>
  );
}

/** The next approved teleconsultation, with its Join video button. */
export default function JoinCard({ appointment, provider, now, lang }) {
  const { t } = useTranslation('consult');
  const join = joinState(appointment, now);
  return (
    <Card className="stack">
      <div className="card__head">
        <h2 className="card__title">{t('join.title')}</h2>
        <Badge status={join.state === 'open' ? 'normal' : 'neutral'}>{t(join.state === 'open' ? 'join.badgeOpen' : 'join.badgeEarly')}</Badge>
      </div>
      <p>
        {provider ? `${t('join.with', { name: provider.full_name })}. ` : ''}
        {t('join.when', { date: formatDateLong(manilaDate(appointment.scheduled_at), lang), time: formatTime(appointment.scheduled_at, lang) })}
      </p>
      <JoinButton appointment={appointment} now={now} />
    </Card>
  );
}
