import { useTranslation } from 'react-i18next';
import Badge from './Badge.jsx';

/** A status with its icon and its text: normal, needs attention or alert. Never colour alone. */
export default function StatusBadge({ status }) {
  const { t } = useTranslation();
  return <Badge status={status}>{t(`status.${status}`)}</Badge>;
}
