import { useTranslation } from 'react-i18next';
import { useStoreValue } from '../../store/hooks.js';
import { profileOf } from '../../store/selectors.js';
import Banner from '../ui/Banner.jsx';

/**
 * What the patient is told about her help request (Section 6): "Help request sent" while the SOS alert is open, who has
 * seen it, or that it could not be delivered yet and will go out when she is connected again. Patient screens only.
 */
export default function SosStatus() {
  const { t } = useTranslation('alerts');
  const patientId = useStoreValue((state) => {
    const profile = state.session ? profileOf(state, state.session.profile_id) : null;
    return profile?.role === 'patient' ? profile.id : null;
  });
  const undelivered = useStoreValue((state) => state.live.sos?.state === 'undelivered' && state.live.sos.patient_id === state.session?.profile_id);
  const alert = useStoreValue((state) => {
    if (!state.session) return null;
    for (let i = state.db.alerts.length - 1; i >= 0; i -= 1) {
      const a = state.db.alerts[i];
      if (a.patient_id === state.session.profile_id && a.type === 'sos' && a.status !== 'resolved') return a;
    }
    return null;
  });
  const seenBy = useStoreValue((state) => (alert?.acknowledged_by ? (profileOf(state, alert.acknowledged_by)?.full_name ?? null) : null));
  if (!patientId) return null;
  if (undelivered) {
    return (
      <div className="sos-status">
        <Banner status="alert" title={t('sos.undeliveredTitle')}>
          {t('sos.undeliveredBody')}
        </Banner>
      </div>
    );
  }
  if (!alert) return null;
  return (
    <div className="sos-status">
      <Banner status="alert" title={t('sos.sentTitle')}>
        {seenBy ? t('sos.seenBody', { name: seenBy }) : t('sos.sentBody')}
      </Banner>
    </div>
  );
}
