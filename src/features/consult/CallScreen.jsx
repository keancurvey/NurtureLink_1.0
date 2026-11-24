import { Link, Navigate, useParams } from 'react-router-dom';
import { PhoneOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Avatar from '../../components/ui/Avatar.jsx';
import Card from '../../components/ui/Card.jsx';
import { joinState } from '../../lib/consult.js';
import { useStoreState, useViewer } from '../../store/hooks.js';
import { appointmentsOf, providerOf } from '../../store/selectors.js';
import { useNow } from '../home/useNow.js';

// TEMP (replaced in Prompt 10): the call room Join video opens. It holds the waiting screen and the way out; Prompt 10 builds
// the room with its tiles, audio-only fallback, consent and expiry.
export default function CallScreen() {
  const { appointmentId } = useParams();
  const { t } = useTranslation('consult');
  const state = useStoreState();
  const viewer = useViewer();
  const now = useNow(5000);
  const appointment = viewer ? appointmentsOf(state, viewer, { patientId: viewer.id }).find((a) => a.id === appointmentId) : null;
  if (!appointment || joinState(appointment, now).state !== 'open') return <Navigate to="/patient/consult" replace />;
  const provider = providerOf(state, viewer, appointment.provider_id);
  return (
    <section className="page">
      <h1 className="page__title">{t('call.title')}</h1>
      <Card className="stack call-wait">
        <Avatar name={provider?.full_name ?? ''} size="lg" />
        <h2 className="card__title">{t('call.waiting', { name: provider?.full_name ?? '' })}</h2>
        <p>{t('call.waitingHint')}</p>
        <Link className="btn btn--ghost btn--block" to="/patient/consult">
          <PhoneOff size={24} aria-hidden="true" />
          {t('call.leave')}
        </Link>
      </Card>
    </section>
  );
}
