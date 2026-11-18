import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../../components/ui/Button.jsx';
import Checkbox from '../../components/ui/Checkbox.jsx';
import { usePresenterActions } from '../../components/presenter/presenterRegistry.jsx';
import { AUTH } from '../../config/thresholds.js';
import { useActions, useStoreValue } from '../../store/hooks.js';
import { thresholdsOf } from '../../store/selectors.js';
import AuthLayout from './AuthLayout.jsx';

// The order of the document. Each section has a title and a body in the consent namespace; a body can run to paragraphs.
const SECTIONS = ['about', 'using', 'readings', 'hele', 'access', 'video', 'retention', 'rights', 'providers', 'contact'];
const GEAR_TICK_MS = 400;

/** AUTH-05: the Terms of Service and data privacy consent. Access stays closed until it is accepted; version and time are recorded. */
export default function Consent() {
  const { t } = useTranslation('consent');
  const actions = useActions();
  const minutes = useStoreValue((state) => thresholdsOf(state).providerSession.timeoutMinutes);
  const [agreed, setAgreed] = useState(false);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function accept({ ticked = agreed } = {}) {
    if (busy) return;
    if (!ticked) {
      setMissing(true);
      return;
    }
    setBusy(true);
    await actions.accept_consent();
    // Accepted: the route moves on by itself.
    if (mounted.current) setBusy(false);
  }

  usePresenterActions([
    {
      id: 'accept',
      labelKey: 'presenter:fill.accept',
      onSelect: () => {
        setAgreed(true);
        setMissing(false);
        setTimeout(() => accept({ ticked: true }), GEAR_TICK_MS);
      },
    },
  ]);

  return (
    <AuthLayout title={t('title')} intro={t('version', { version: AUTH.termsVersion })} wide>
      <div className="consent">
        <p>{t('intro')}</p>
        {SECTIONS.map((id) => (
          <section key={id} className="consent__section" aria-labelledby={`consent-${id}`}>
            <h2 id={`consent-${id}`} className="consent__title">
              {t(`sections.${id}.title`)}
            </h2>
            {t(`sections.${id}.body`, { minutes }).split('\n\n').map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
      </div>
      <form
        className="auth__form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          accept();
        }}
      >
        <Checkbox
          label={t('agree')}
          checked={agreed}
          error={missing && !agreed ? t('agreeRequired') : undefined}
          onChange={(next) => {
            setAgreed(next);
            if (next) setMissing(false);
          }}
        />
        <Button block type="submit" loading={busy}>
          {t('accept')}
        </Button>
        <Button block variant="ghost" onClick={() => actions.sign_out()} disabled={busy}>
          {t('decline')}
        </Button>
      </form>
    </AuthLayout>
  );
}
