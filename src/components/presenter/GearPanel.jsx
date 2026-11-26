import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Banner from '../ui/Banner.jsx';
import Button from '../ui/Button.jsx';
import Select from '../ui/Select.jsx';
import Sheet from '../ui/Sheet.jsx';
import Tabs from '../ui/Tabs.jsx';
import { useToast } from '../ui/Toast.jsx';
import Toggle from '../ui/Toggle.jsx';
import { PRESENTER_ACCOUNTS, gearConfigFor } from '../../lib/permissions.js';
import { accessTarget, focusCandidates, focusPatientId, profileOf } from '../../store/selectors.js';
import { useActions, useRuntime, useStoreState } from '../../store/hooks.js';
import { useRegisteredActions } from './presenterRegistry.jsx';

// Battery levels the gear sets, and the text for each (spec 9.5: normal, low, critical, cutoff).
const BATTERY_LEVELS = [
  { pct: 80, key: 'normal' },
  { pct: 18, key: 'low' },
  { pct: 8, key: 'critical' },
  { pct: 4, key: 'cutoff' },
];

function Section({ title, children }) {
  const id = useId();
  return (
    <section className="gear-section" aria-labelledby={id}>
      <h3 id={id} className="gear-section__title">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * What the gear offers for the role and the screen. Which actions appear lives in lib/permissions.js and in what screens
 * register through usePresenterActions; this component only draws them. It exists only while open, so a closed gear costs
 * nothing when the store changes (it changes many times a second during a check).
 */
export default function GearPanel({ open, ...props }) {
  return open ? <GearPanelBody {...props} /> : null;
}

function GearPanelBody({ onClose, viewer, role }) {
  const { t } = useTranslation('presenter');
  const runtime = useRuntime();
  const actions = useActions();
  const state = useStoreState();
  const toast = useToast();
  const navigate = useNavigate();
  const screenActions = useRegisteredActions();
  const [confirm, setConfirm] = useState(null); // { kind: 'start', id, params } | { kind: 'reset' }
  const [busy, setBusy] = useState(false);

  const config = gearConfigFor(role);
  const candidates = focusCandidates(state, viewer);
  const patientId = focusPatientId(state, viewer);
  const devices = patientId ? state.db.devices.filter((d) => d.patient_id === patientId) : [];
  const running = runtime.engine.describe();
  const labelOf = (id) => t(runtime.engine.scenarios.get(id).labelKey);
  const hasScenarios = Object.keys(config.groups).length > 0;

  function begin(id, params) {
    try {
      runtime.engine.start(id, params);
    } catch {
      toast.show({ message: t('toast.failed', { name: labelOf(id) }), status: 'alert' });
      return;
    }
    if (runtime.engine.isRunning()) toast.show({ message: t('toast.started', { name: labelOf(id) }) });
  }

  /** Run a scenario for the focus patient. A run that works over time asks first when another is still running. */
  function choose(id, extra = {}, { keepOpen = false } = {}) {
    const params = { patientId, actorId: viewer?.id ?? null, actorRole: role, ...extra };
    if (runtime.engine.isRunning() && !runtime.engine.isInstant(id, params)) {
      setConfirm({ kind: 'start', id, params });
      return;
    }
    begin(id, params);
    if (!keepOpen) onClose();
  }

  function confirmStart() {
    runtime.engine.finishNow();
    begin(confirm.id, confirm.params);
    setConfirm(null);
    onClose();
  }

  async function confirmReset() {
    setBusy(true);
    try {
      await actions.reset_data();
    } finally {
      setBusy(false);
    }
    setConfirm(null);
    onClose();
    if (role) navigate('/sign-in', { replace: true });
  }

  function renderConfirm() {
    const isReset = confirm.kind === 'reset';
    return (
      <div className="gear-confirm">
        <h3 className="gear-section__title">{isReset ? t('confirm.resetTitle') : t('confirm.startTitle')}</h3>
        <p>
          {isReset
            ? t('confirm.resetBody')
            : t('confirm.startBody', { current: t(running?.labelKey ?? confirm.id), next: labelOf(confirm.id) })}
        </p>
        <Button onClick={isReset ? confirmReset : confirmStart} loading={busy}>
          {t('confirm.confirm')}
        </Button>
        <Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy}>
          {t('confirm.cancel')}
        </Button>
      </div>
    );
  }

  function renderDevice(type) {
    const device = devices.find((d) => d.type === type);
    if (!device) return null;
    const name = t(`devices.${type}`);
    return (
      <div className="gear-device" key={type}>
        <Toggle
          label={`${name}: ${t('devices.connected')}`}
          checked={device.link_state === 'connected'}
          onChange={(next) => choose('device-connection', { device: type, connected: next }, { keepOpen: true })}
        />
        <Toggle
          label={`${name}: ${t('devices.charging')}`}
          checked={device.charging}
          onChange={(next) => choose('device-charging', { device: type, on: next }, { keepOpen: true })}
        />
        <Select
          label={`${name}: ${t('devices.battery')}`}
          value=""
          onChange={(event) => choose('device-battery', { device: type, pct: Number(event.target.value) }, { keepOpen: true })}
          options={[
            { value: '', label: `${device.battery_pct}%` },
            ...BATTERY_LEVELS.map(({ pct, key }) => ({ value: String(pct), label: t(`devices.level.${key}`) })),
          ]}
        />
        {type === 'belt' ? (
          <div className="gear-actions">
            <Button variant="ghost" className="gear-action" onClick={() => choose('exposure-cap', {}, { keepOpen: true })}>
              {labelOf('exposure-cap')}
            </Button>
            <Button variant="ghost" className="gear-action" onClick={() => choose('checks-while-apart')}>
              {labelOf('checks-while-apart')}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  /** Switch account: signs out and signs in as the chosen account; a run that is going carries on. */
  function switchTo(profileId) {
    if (!profileId || profileId === viewer?.id) return;
    if (!runtime.auth.signInAs(profileId).ok) return;
    onClose();
    navigate(accessTarget(runtime.store.getState()), { replace: true });
  }

  const groupTitles = { checks: t('group.checks'), alerts: t('group.alerts'), consult: t('group.consult') };
  const switchOptions = PRESENTER_ACCOUNTS.map(({ id, role: accountRole }) => ({
    value: id,
    label: `${t(`account.${accountRole}`)}: ${profileOf(state, id)?.full_name ?? id}`,
  }));

  return (
    <Sheet open onClose={onClose} title={t('gear.title')} variant="popover">
      {confirm ? (
        renderConfirm()
      ) : (
        <div className="gear-panel">
          {running ? <Banner status="info">{t('running', { name: t(running.labelKey) })}</Banner> : null}

          {screenActions.length > 0 ? (
            <Section title={t('section.screen')}>
              <div className="gear-actions">
                {screenActions.map((action) => (
                  <Button
                    key={action.id}
                    variant="ghost"
                    className="gear-action"
                    disabled={action.disabled}
                    onClick={() => {
                      action.onSelect();
                      onClose();
                    }}
                  >
                    {t(action.labelKey)}
                  </Button>
                ))}
              </div>
            </Section>
          ) : null}

          {config.patientChooser && candidates.length > 0 ? (
            <Select
              label={t('patient.label')}
              value={patientId ?? ''}
              onChange={(event) => runtime.setFocusPatient(event.target.value)}
              options={candidates.map((p) => ({ value: p.id, label: p.full_name }))}
            />
          ) : null}
          {!patientId && (hasScenarios || config.devices) ? <p className="gear-note">{t('patient.none')}</p> : null}

          {hasScenarios && patientId ? (
            <Section title={t('section.scenarios')}>
              {Object.entries(config.groups).map(([group, ids]) => (
                <div className="gear-group" key={group}>
                  <h4 className="gear-group__title">{groupTitles[group]}</h4>
                  <div className="gear-actions">
                    {ids.filter((id) => !screenActions.some((action) => action.id === id)).map((id) => (
                      <Button key={id} variant="ghost" className="gear-action" onClick={() => choose(id)}>
                        {labelOf(id)}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </Section>
          ) : null}

          {config.devices && patientId ? <Section title={t('section.devices')}>{['belt', 'band'].map(renderDevice)}</Section> : null}

          {config.sections.includes('timing') ? (
            <Section title={t('section.timing')}>
              <Tabs
                label={t('section.timing')}
                value={`timing-${state.meta.timing}`}
                onChange={(id) => runtime.setTiming(id.replace('timing-', ''))}
                items={[
                  { id: 'timing-quick', label: t('timing.quick') },
                  { id: 'timing-realistic', label: t('timing.realistic') },
                ]}
              />
            </Section>
          ) : null}

          {config.sections.includes('connection') ? (
            <Section title={t('section.connection')}>
              <Tabs
                label={t('section.connection')}
                value={`connection-${state.meta.connection}`}
                onChange={(id) => runtime.setConnection(id.replace('connection-', ''))}
                items={[
                  { id: 'connection-online', label: t('connection.online') },
                  { id: 'connection-offline', label: t('connection.offline') },
                ]}
              />
            </Section>
          ) : null}

          {config.sections.includes('switch') ? (
            <Section title={t('section.switchAccount')}>
              <Select
                label={t('account.label')}
                value={switchOptions.some((option) => option.value === viewer?.id) ? viewer.id : ''}
                options={switchOptions.some((option) => option.value === viewer?.id) ? switchOptions : [{ value: '', label: viewer?.full_name ?? '' }, ...switchOptions]}
                onChange={(event) => switchTo(event.target.value)}
              />
            </Section>
          ) : null}

          <Section title={t('section.reset')}>
            <Button variant="ghost" className="gear-action" onClick={() => setConfirm({ kind: 'reset' })}>
              {t('section.reset')}
            </Button>
          </Section>
        </div>
      )}
    </Sheet>
  );
}
