import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import SoftArt from '../../components/ui/SoftArt.jsx';
import Vital from '../../components/ui/Vital.jsx';
import { batteryLevel } from '../../lib/battery.js';
import { formatRelative } from '../../lib/format.js';
import { useNow } from './useNow.js';

const LEVEL_STATUS = { low: 'attention', critical: 'alert', cutoff: 'alert' };

function DeviceRow({ type, device, thresholds, connecting, onConnect, onPair }) {
  const { t, i18n } = useTranslation('devices');
  const now = useNow(30000);
  const label = t(`row.${type}`);
  if (!device) {
    return (
      <li className="device">
        <SoftArt name={type} size="sm" />
        <div className="device__body">
          <h3 className="device__name">{label}</h3>
          <Badge status="neutral">{t('state.notPaired')}</Badge>
        </div>
        <Button variant="ghost" onClick={onPair}>
          {t('pair')}
        </Button>
      </li>
    );
  }
  const connected = device.link_state === 'connected';
  const level = batteryLevel(device.battery_pct, null, thresholds);
  return (
    <li className="device">
      <SoftArt name={type} size="sm" />
      <div className="device__body">
        <h3 className="device__name">{label}</h3>
        <p className="device__id">{device.name}</p>
        {connecting ? <Badge status="info">{t('state.connecting')}</Badge> : connected ? <Badge status="normal">{t('state.connected')}</Badge> : <Badge status="neutral">{t('state.notConnected')}</Badge>}
        <Vital label={t('battery')} value={device.battery_pct} unit="%" />
        {device.charging ? (
          <p className="device__charging">
            <Zap size={16} aria-hidden="true" />
            <span>{t('charging')}</span>
          </p>
        ) : level !== 'normal' ? (
          <Badge status={LEVEL_STATUS[level]}>{t(`level.${level}`)}</Badge>
        ) : null}
        <p className="card__meta">{t('lastSeen', { time: formatRelative(device.last_seen_at, now, i18n.language) })}</p>
      </div>
      {!connected ? (
        <Button variant="ghost" loading={connecting} onClick={onConnect}>
          {t('connect')}
        </Button>
      ) : null}
    </li>
  );
}

/** PAT-H-02: one row per device with its connection state, a Connect button when not connected, battery, charging and the low-battery label. */
export default function DevicesCard({ belt, band, thresholds, connecting, onConnect, onPair }) {
  const { t } = useTranslation('devices');
  return (
    <Card className="stack">
      <h2 className="card__title">{t('title')}</h2>
      <ul className="devices">
        {[
          ['belt', belt],
          ['band', band],
        ].map(([type, device]) => (
          <DeviceRow key={type} type={type} device={device} thresholds={thresholds} connecting={device ? connecting.has(device.serial) : false} onConnect={() => onConnect(device.serial)} onPair={onPair} />
        ))}
      </ul>
    </Card>
  );
}
