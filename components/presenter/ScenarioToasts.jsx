import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRuntime } from '../../store/hooks.js';
import { useToast } from '../ui/Toast.jsx';

// TEMP: a basic toast confirms each triggered scenario so the engine can be checked before the real screens exist.
// Removed in Prompt 5, when the screens show the effects themselves.
export default function ScenarioToasts() {
  const { t } = useTranslation('presenter');
  const runtime = useRuntime();
  const { show } = useToast();

  useEffect(
    () =>
      runtime.engine.subscribe((event) => {
        if (event.type === 'finished') {
          // A value written "t:presenter:..." is a name to translate, so the line reads in the current language.
          const values = Object.fromEntries(
            Object.entries(event.summary.values).map(([key, value]) => [key, typeof value === 'string' && value.startsWith('t:') ? t(value.slice(2)) : value]),
          );
          show({ message: t(event.summary.key, values) });
        } else if (event.type === 'failed') {
          show({ message: t('toast.failed', { name: t(runtime.engine.scenarios.get(event.scenarioId).labelKey) }), status: 'alert' });
        }
      }),
    [runtime, t, show],
  );
  return null;
}
