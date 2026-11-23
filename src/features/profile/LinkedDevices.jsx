import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import Sheet from '../../components/ui/Sheet.jsx';
import SoftArt from '../../components/ui/SoftArt.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import Vital from '../../components/ui/Vital.jsx';
import { batteryLevel } from '../../lib/battery.js';
import { formatRelative } from '../../lib/format.js';
import { useActions } from '../../store/hooks.js';
import { useNow } from '../home/useNow.js';

const LEVEL_STATUS = { low: 'attention', critical: 'alert', cutoff: 'alert' };

/** PAT-P-05: the belt and the band with state, battery and firmware; pair opens the wizard, unpair asks first. */
export default function LinkedDevices({ belt, band, thresholds, onPair }) {
  const { t, i18n } = useTranslation('devices');
  const { t: tp } = useTranslation('profile');
  const actions = useActions();
  const toast = useToast();
  const now = useNow(30000);
  const [asking, setAsking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  async function unpair() {
    setBusy(true);
    setProblem(null);
    const result = await actions.unpair_device(asking.serial);
    setBusy(false);
    if (result.ok) {
      toast.show({ message: tp('devices.unpaired', { name: asking.name }), status: 'normal' });
      setAsking(null);
    } else setProblem(result.error);
  }

  return (
    <Card className="stack">
      <h2 className="card__title">{tp('devices.title')}</h2>
      <ul className="devices">
        {[['belt', belt], ['band', band]].map(([type, device]) => {
          const level = device ? batteryLevel(device.battery_pct, null, thresholds) : 'normal';
          return (
            <li className="device" key={type}>
              <SoftArt name={type} size="sm" />
              <div className="device__body">
                <h3 className="device__name">{t(`row.${type}`)}</h3>
                {device ? (
                  <>
                    <p className="device__id">{device.name}</p>
                    {device.link_state === 'connected' ? <Badge status="normal">{t('state.connected')}</Badge> : <Badge status="neutral">{t('state.notConnected')}</Badge>}
                    <Vital label={t('battery')} value={device.battery_pct} unit="%" />
                    {device.charging ? (
                      <p className="device__charging">
                        <Zap size={16} aria-hidden="true" />
                        <span>{t('charging')}</span>
                      </p>
                    ) : level !== 'normal' ? (
                      <Badge status={LEVEL_STATUS[level]}>{t(`level.${level}`)}</Badge>
                    ) : null}
                    <p className="card__meta">{tp('devices.firmware', { version: device.fw_version })}</p>
                    <p className="card__meta">{t('lastSeen', { time: formatRelative(device.last_seen_at, now, i18n.language) })}</p>
                  </>
                ) : (
                  <Badge status="neutral">{t('state.notPaired')}</Badge>
                )}
              </div>
              {device ? (
                <Button variant="ghost" onClick={() => { setProblem(null); setAsking(device); }}>
                  {tp('devices.unpair')}
                </Button>
              ) : (
                <Button variant="ghost" onClick={onPair}>
                  {t('pair')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {asking ? (
        <Sheet open onClose={() => setAsking(null)} title={tp('devices.unpairTitle', { name: asking.name })}>
          <div className="stack">
            <p>{tp('devices.unpairBody')}</p>
            {problem ? (
              <p className="field__error" role="alert">
                {tp(`devices.error.${problem}`)}
              </p>
            ) : null}
            <Button block loading={busy} onClick={unpair}>
              {tp('devices.unpairConfirm')}
            </Button>
            <Button block variant="ghost" onClick={() => setAsking(null)} disabled={busy}>
              {tp('cancel')}
            </Button>
          </div>
        </Sheet>
      ) : null}
    </Card>
  );
}
