import { useTranslation } from 'react-i18next';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import Vital from '../../components/ui/Vital.jsx';

const present = (value) => value !== null && value !== undefined && value > 0;

/**
 * The four readings of a check as a provider reads them (BRG-M-04, BRG-C-01): the baby's heart rate with its confidence, the
 * mother's heart rate, SpO2 and skin temperature, each with its status (icon and text). A reading the band did not give
 * shows a dash.
 */
export default function VitalsGrid({ summary, statuses }) {
  const { t } = useTranslation('monitor');
  const dash = t('vitals.none');
  const temp = summary.skin_temp_c !== null && summary.skin_temp_c !== undefined;
  const cells = [
    { key: 'fhr', value: present(summary.fhr_bpm) ? summary.fhr_bpm : dash, unit: present(summary.fhr_bpm) ? t('vitals.unit.bpm') : null, notes: present(summary.fhr_bpm) ? [t('vitals.confidence', { value: summary.confidence }), summary.unverified ? t('vitals.unverified') : null] : [t('vitals.noReading')] },
    { key: 'hr', value: present(summary.hr_bpm) ? summary.hr_bpm : dash, unit: present(summary.hr_bpm) ? t('vitals.unit.bpm') : null },
    { key: 'spo2', value: present(summary.spo2_pct) ? summary.spo2_pct : dash, unit: present(summary.spo2_pct) ? t('vitals.unit.spo2') : null },
    { key: 'temp', value: temp ? summary.skin_temp_c.toFixed(1) : dash, unit: temp ? t('vitals.unit.temp') : null },
  ];
  return (
    <ul className="readings">
      {cells.map(({ key, value, unit, notes = [] }) => (
        <li className="readings__cell" key={key}>
          <Vital label={t(`vitals.${key}`)} value={value} unit={unit} />
          {statuses[key] ? <StatusBadge status={statuses[key]} /> : null}
          {value === dash && key !== 'fhr' ? <p className="readings__note">{t('vitals.notMeasured')}</p> : null}
          {notes.filter(Boolean).map((note) => (
            <p className="readings__note" key={note}>
              {note}
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}
