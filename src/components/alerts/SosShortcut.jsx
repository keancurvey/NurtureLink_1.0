import { useEffect, useRef, useState } from 'react';
import { Siren } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DEVICE_DEFAULTS } from '../../config/thresholds.js';
import { useActions } from '../../store/hooks.js';

const HOLD_MS = DEVICE_DEFAULTS.band.sosHoldS * 1000;
const SENT_MS = 4000;

/**
 * The in-app SOS shortcut (PAT-C-06, PAT-A-04, assumption 9): the same alert as the band button, sent after the button has
 * been held for the band's hold time (2 seconds), so a stray tap never sends it. Works with a finger, a mouse or the
 * Space and Enter keys. Hosted by the Consult tab (Prompt 7) and by Hele AI's danger-sign reply (Prompt 11).
 */
export default function SosShortcut() {
  const { t } = useTranslation('alerts');
  const actions = useActions();
  const [phase, setPhase] = useState('idle'); // idle | holding | sending | sent
  const timer = useRef(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function begin() {
    if (phase !== 'idle') return;
    setPhase('holding');
    timer.current = window.setTimeout(async () => {
      setPhase('sending');
      await actions.send_sos();
      setPhase('sent');
      timer.current = window.setTimeout(() => setPhase('idle'), SENT_MS); // ready again if she needs it
    }, HOLD_MS);
  }
  function release() {
    if (phase !== 'holding') return;
    window.clearTimeout(timer.current);
    setPhase('idle');
  }

  const label = { idle: t('sosButton.label'), holding: t('sosButton.holding'), sending: t('sosButton.sending'), sent: t('sosButton.sent') }[phase];
  return (
    <section className="sos" aria-labelledby="sos-title">
      <h2 id="sos-title" className="card__title">
        {t('sosButton.title')}
      </h2>
      <button
        type="button"
        className={`sos__button sos__button--${phase}`}
        disabled={phase === 'sending' || phase === 'sent'}
        aria-describedby="sos-hint"
        onPointerDown={begin}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
            event.preventDefault();
            begin();
          }
        }}
        onKeyUp={(event) => {
          if (event.key === ' ' || event.key === 'Enter') release();
        }}
      >
        <span className="sos__fill" aria-hidden="true" />
        <Siren size={24} aria-hidden="true" />
        <span>{label}</span>
      </button>
      <p id="sos-hint" className="card__meta" aria-live="polite">
        {t('sosButton.hint')}
      </p>
    </section>
  );
}
