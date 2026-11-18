import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { usePresenterActions } from '../../components/presenter/presenterRegistry.jsx';
import Banner from '../../components/ui/Banner.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import Checkbox from '../../components/ui/Checkbox.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import SoftArt from '../../components/ui/SoftArt.jsx';
import { latency } from '../../lib/latency.js';
import { useActions, useRuntime, useSelector, useViewer } from '../../store/hooks.js';
import { devicesOf, freeNearbyDevice } from '../../store/selectors.js';
import { nearbyDevices } from '../../store/devices.js';

const HOME_PATH = '/patient/home';
const STAGES = ['belt', 'band'];

/**
 * AUTH-07: the pairing wizard for the belt and then the wrist band. Choose a device by its advertised name, connect and
 * read its information, confirm, and the serial is bound to the patient. A device that belongs to someone else is
 * refused with a clear message. It can be skipped at any step; the pairing can be started again from Home.
 */
export default function PairingWizard() {
  const { t } = useTranslation('devices');
  const navigate = useNavigate();
  const actions = useActions();
  const runtime = useRuntime();
  const viewer = useViewer();
  const owned = useSelector((state) => devicesOf(state, viewer, viewer.id));
  const stage = !owned.some((d) => d.type === 'belt') ? 'belt' : !owned.some((d) => d.type === 'band') ? 'band' : 'done';
  const nearby = useSelector((state) => (stage === 'done' ? [] : nearbyDevices(state, viewer.id, stage)), [stage]);

  const [phase, setPhase] = useState('choose'); // 'choose' | 'confirm'
  const [selected, setSelected] = useState('');
  const [info, setInfo] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [matchError, setMatchError] = useState(false);
  const [busy, setBusy] = useState(null); // 'connect' | 'pair'
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null); // the type just paired
  const [scanning, setScanning] = useState(true);
  const [scanKey, setScanKey] = useState(0);
  const errorRef = useRef(null);
  const linked = useRef(null); // a device linked for pairing and not paired: let go of it when she leaves

  // She has now seen the wizard: the next sign-in goes to Home.
  useEffect(() => {
    actions.mark_pairing_seen();
  }, [actions]);

  useEffect(
    () => () => {
      if (linked.current) actions.release_device(linked.current);
    },
    [actions],
  );

  // A refusal must be seen even on a short screen.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  // A new step starts clean.
  useEffect(() => {
    setPhase('choose');
    setSelected('');
    setInfo(null);
    setConfirmed(false);
    setMatchError(false);
    setError(null);
  }, [stage]);

  // Looking for devices takes a moment, as it does over the air.
  useEffect(() => {
    let alive = true;
    setScanning(true);
    latency().then(() => {
      if (alive) setScanning(false);
    });
    return () => {
      alive = false;
    };
  }, [stage, scanKey]);

  const deviceLabel = stage === 'done' ? '' : t(`name.${stage}`);
  const finish = () => navigate(HOME_PATH, { replace: true });

  async function connect() {
    setBusy('connect');
    setError(null);
    const result = await actions.read_device(selected);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    linked.current = selected;
    setInfo(result.info);
    setConfirmed(false);
    setMatchError(false);
    setPhase('confirm');
  }

  async function pair() {
    if (!confirmed) {
      setMatchError(true);
      return;
    }
    setBusy('pair');
    setError(null);
    const result = await actions.pair_device(selected);
    setBusy(null);
    if (result.ok) {
      linked.current = null;
      setNotice(stage);
    } else {
      setError(result.error);
    }
  }

  function chooseAnother() {
    if (linked.current) actions.release_device(linked.current);
    linked.current = null;
    setPhase('choose');
    setSelected('');
    setInfo(null);
    setError(null);
    setScanKey((key) => key + 1);
  }

  // The gear's "Fill this step": choose the free device, confirm the name, or finish.
  usePresenterActions([
    {
      id: 'fill-step',
      labelKey: 'presenter:fill.pairingStep',
      onSelect() {
        if (stage === 'done') finish();
        else if (phase === 'choose') {
          const free = freeNearbyDevice(runtime.store.getState(), stage);
          if (free) setSelected(free.serial);
        } else setConfirmed(true);
      },
    },
  ]);

  const skip = (
    <div className="stack">
      <Button variant="ghost" block onClick={finish}>
        {t('pairing.skip')}
      </Button>
      <p className="card__meta">{t('pairing.skipNote')}</p>
    </div>
  );

  if (stage === 'done') {
    return (
      <section className="page">
        <h1 className="page__title">{t('pairing.title')}</h1>
        <Card className="stack">
          <EmptyState illustration="heart" title={t('pairing.done.title')}>
            {t('pairing.done.bothBody')}
          </EmptyState>
          <Button block onClick={finish}>
            {t('pairing.done.finish')}
          </Button>
        </Card>
      </section>
    );
  }

  return (
    <section className="page">
      <h1 className="page__title">{t('pairing.title')}</h1>
      <p>{t('pairing.intro')}</p>
      {notice ? <Banner status="normal">{t('pairing.justPaired', { device: t(`name.${notice}`) })}</Banner> : null}

      <Card className="stack">
        <p className="card__meta">
          {t('pairing.progress', { current: STAGES.indexOf(stage) + 1, total: STAGES.length })}: {t(`pairing.stage.${stage}`)}
        </p>

        {phase === 'choose' ? (
          <>
            <div className="wizard__art">
              <SoftArt name={stage} size="md" float />
            </div>
            <h2 className="card__title">{t('pairing.choose.title', { device: deviceLabel })}</h2>
            <p>{t('pairing.choose.body', { device: deviceLabel })}</p>
            {scanning ? (
              <div className="stack" role="status">
                <span className="visually-hidden">{t('pairing.choose.scanning')}</span>
                <Skeleton height="var(--space-7)" />
                <Skeleton height="var(--space-7)" />
              </div>
            ) : nearby.length > 0 ? (
              <div className="choices" role="radiogroup" aria-label={t('pairing.choose.list')}>
                {nearby.map((device) => {
                  const on = selected === device.serial;
                  return (
                    <button key={device.serial} type="button" role="radio" aria-checked={on} className="choice" onClick={() => setSelected(device.serial)}>
                      <SoftArt name={device.type} size="sm" />
                      <span className="choice__text">
                        <span className="choice__name">{device.name}</span>
                        <span className="card__meta">{t('pairing.choose.nearby')}</span>
                      </span>
                      {on ? <Check className="choice__tick" size={24} aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="stack">
                <p className="card__note">{t('pairing.choose.none', { device: deviceLabel })}</p>
                <Button variant="ghost" onClick={() => setScanKey((key) => key + 1)}>
                  {t('pairing.choose.again')}
                </Button>
              </div>
            )}
            {error ? (
              <div ref={errorRef} role="alert">
                <Banner status="alert">{t(`pairing.error.${error}`, { device: deviceLabel })}</Banner>
              </div>
            ) : null}
            <Button block disabled={!selected || scanning} loading={busy === 'connect'} onClick={connect}>
              {busy === 'connect' ? t('pairing.connecting') : t('pairing.choose.connect')}
            </Button>
          </>
        ) : (
          <>
            <h2 className="card__title">{t('pairing.confirm.title', { device: deviceLabel })}</h2>
            <p>{t('pairing.confirm.body', { device: deviceLabel })}</p>
            <dl className="info">
              {[
                ['name', info.name],
                ['serial', info.serial],
                ['model', info.model],
                ['firmware', info.fw_version],
                ['battery', `${info.battery_pct}%`],
              ].map(([key, value]) => (
                <div className="info__row" key={key}>
                  <dt>{t(`pairing.confirm.${key}`)}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <Checkbox
              label={t('pairing.confirm.match', { device: deviceLabel })}
              checked={confirmed}
              error={matchError && !confirmed ? t('pairing.error.match') : undefined}
              onChange={(next) => {
                setConfirmed(next);
                if (next) setMatchError(false);
              }}
            />
            {error ? (
              <div ref={errorRef} role="alert">
                <Banner status="alert">{t(`pairing.error.${error}`, { device: deviceLabel })}</Banner>
              </div>
            ) : null}
            <Button block loading={busy === 'pair'} onClick={pair}>
              {busy === 'pair' ? t('pairing.confirm.pairing') : t('pairing.confirm.pair', { device: deviceLabel })}
            </Button>
            <Button variant="ghost" block disabled={busy === 'pair'} onClick={chooseAnother}>
              {t('pairing.confirm.other')}
            </Button>
          </>
        )}
      </Card>
      {skip}
    </section>
  );
}
