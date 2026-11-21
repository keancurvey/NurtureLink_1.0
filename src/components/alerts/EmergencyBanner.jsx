import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { alertTypeText } from '../../features/alerts/text.js';
import Button from '../ui/Button.jsx';
import { STATUS_ICONS } from '../ui/statusIcons.js';

/**
 * The emergency banner (BRG-M-03, ALR-04): pinned at the top of a provider screen until the alert is acknowledged, with a
 * pulsing ring (stopped under reduced motion). Prompt 8 mounts it on the Monitor tab for each new critical alert.
 * `onRespond` opens the shared AlertActions sheet.
 */
export default function EmergencyBanner({ alert, patientName, onRespond }) {
  const { t } = useTranslation('alerts');
  const Icon = STATUS_ICONS.alert;
  return (
    <div className="emergency" role="alert">
      <span className="emergency__ring" aria-hidden="true">
        <Icon size={24} />
      </span>
      <div className="emergency__text">
        <p className="emergency__title">{t('emergency.title', { patient: patientName })}</p>
        <p>
          <Link className="emergency__link" to={`/alerts/${alert.id}`}>
            {alertTypeText(t, alert.type, 'provider')}
          </Link>
        </p>
      </div>
      <Button onClick={onRespond}>{t('emergency.respond')}</Button>
    </div>
  );
}
