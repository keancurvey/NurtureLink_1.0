import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Badge from '../../components/ui/Badge.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { formatRelative } from '../../lib/format.js';
import { useStoreState, useViewer } from '../../store/hooks.js';
import { profileOf, referralInboxOf } from '../../store/selectors.js';
import { useNow } from '../home/useNow.js';

/** The referral inbox of a super account (SUP-C-02): what barangay accounts sent, newest first, each opening the patient's profile. */
export default function ReferralInbox() {
  const { t, i18n } = useTranslation('tracker');
  const state = useStoreState();
  const viewer = useViewer();
  const now = useNow(30000);
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const referrals = referralInboxOf(state, viewer);
  return (
    <Card className="stack">
      <h2 className="card__title">{t('referrals.title')}</h2>
      {referrals.length === 0 ? (
        <EmptyState illustration="chat" title={t('referrals.emptyTitle')}>
          {t('referrals.emptyBody')}
        </EmptyState>
      ) : (
        <ul className="bookings office-grid">
          {referrals.map((referral) => {
            const patient = profileOf(state, referral.patient_id);
            const barangay = state.db.barangays.find((b) => b.id === patient?.barangay_id)?.name ?? '';
            const v = referral.vitals;
            return (
              <li key={referral.id} className="booking">
                <div className="booking__head">
                  <h3 className="booking__title">{t('approvals.patient', { name: patient?.full_name ?? '', barangay })}</h3>
                  {!referral.read ? <Badge status="info">{t('referrals.new')}</Badge> : null}
                </div>
                <p className="card__meta">{[referral.from ? t('referrals.from', { name: referral.from }) : null, formatRelative(referral.at, now, lang)].filter(Boolean).join(' · ')}</p>
                <p>
                  <span className="booking__label">{t('referrals.reason')}: </span>
                  {referral.reason}
                </p>
                <p className="card__meta">{v ? t('referrals.vitals', { fhr: v.fhr_bpm ?? '–', hr: v.hr_bpm ?? '–', spo2: v.spo2_pct ?? '–', temp: v.skin_temp_c ?? '–' }) : t('referrals.noVitals')}</p>
                <Link className="btn btn--ghost" to={`/super/patient/${referral.patient_id}`}>
                  {t('referrals.open')}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
