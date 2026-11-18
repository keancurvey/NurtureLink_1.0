import { useTranslation } from 'react-i18next';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import Vital from '../../components/ui/Vital.jsx';

const present = (value) => value !== null && value !== undefined && value > 0;

/**
 * The four readings of a check (PAT-H-01), each with its status: baby's heart rate with confidence, the mother's heart
 * rate, SpO2 and skin temperature. A reading the band did not give shows a dash and says so. An FHR that could not be
 * compared with the band is marked unverified (PAT-H-05).
 */
export default function ReadingsGrid({ summary, statuses }) {
  const { t } = useTranslation('home');
  const dash = t('reading.none');
  const hasFhr = present(summary.fhr_bpm);
  const cells = [
    {
      key: 'fhr',
      value: hasFhr ? summary.fhr_bpm : dash,
      unit: hasFhr ? t('reading.unit.bpm') : null,
      notes: hasFhr
        ? [t('reading.confidence', { value: summary.confidence }), summary.unverified ? `${t('reading.unverified')}: ${t('reading.unverifiedBody')}` : null]
        : [t('reading.noReading')],
    },
    { key: 'hr', value: present(summary.hr_bpm) ? summary.hr_bpm : dash, unit: present(summary.hr_bpm) ? t('reading.unit.bpm') : null },
    { key: 'spo2', value: present(summary.spo2_pct) ? summary.spo2_pct : dash, unit: present(summary.spo2_pct) ? t('reading.unit.spo2') : null },
    { key: 'temp', value: summary.skin_temp_c !== null && summary.skin_temp_c !== undefined ? summary.skin_temp_c.toFixed(1) : dash, unit: summary.skin_temp_c !== null && summary.skin_temp_c !== undefined ? t('reading.unit.temp') : null },
  ];
  return (
    <ul className="readings">
      {cells.map(({ key, value, unit, notes = [] }) => {
        const status = statuses[key];
        const missing = value === dash;
        return (
          <li className="readings__cell" key={key}>
            <Vital label={t(`reading.${key}`)} value={value} unit={unit} />
            {status ? <StatusBadge status={status} /> : null}
            {missing && key !== 'fhr' ? <p className="readings__note">{t('reading.notMeasured')}</p> : null}
            {notes.filter(Boolean).map((note) => (
              <p className="readings__note" key={note}>
                {note}
              </p>
            ))}
          </li>
        );
      })}
    </ul>
  );
}
