import { Link, Navigate, useParams } from 'react-router-dom';
import { PhoneOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Avatar from '../../components/ui/Avatar.jsx';
import Card from '../../components/ui/Card.jsx';
import { joinState } from '../../lib/consult.js';
import { useStoreState, useViewer } from '../../store/hooks.js';
import { appointmentsOf, profileOf, providerOf } from '../../store/selectors.js';
import { useNow } from '../home/useNow.js';

// TEMP (replaced in Prompt 10): the call room Join video opens. It holds the waiting screen and the way out; Prompt 10 builds
// the room with its tiles, audio-only fallback, consent and expiry.
export default function CallScreen() {
  const { appointmentId } = useParams();
  const { t } = useTranslation('consult');
  const state = useStoreState();
  const viewer = useViewer();
  const now = useNow(5000);
  const { t: ts } = useTranslation('tracker');
  const isSuper = viewer?.role === 'super';
  const home = isSuper ? '/super/consult' : '/patient/consult';
  const appointment = viewer ? appointmentsOf(state, viewer, isSuper ? {} : { patientId: viewer.id }).find((a) => a.id === appointmentId) : null;
  // Only the assigned midwife joins a visit as a super account (ACC-05).
  if (!appointment || joinState(appointment, now).state !== 'open' || (isSuper && appointment.provider_id !== viewer.id)) return <Navigate to={home} replace />;
  const provider = isSuper ? profileOf(state, appointment.patient_id) : providerOf(state, viewer, appointment.provider_id);
  return (
    <section className="page">
      <h1 className="page__title">{t('call.title')}</h1>
      <Card className="stack call-wait">
        <Avatar name={provider?.full_name ?? ''} size="lg" />
        <h2 className="card__title">{isSuper ? ts('call.waiting', { name: provider?.full_name ?? '' }) : t('call.waiting', { name: provider?.full_name ?? '' })}</h2>
        <p>{isSuper ? ts('call.hint') : t('call.waitingHint')}</p>
        <Link className="btn btn--ghost btn--block" to={home}>
          <PhoneOff size={24} aria-hidden="true" />
          {t('call.leave')}
        </Link>
      </Card>
    </section>
  );
}
