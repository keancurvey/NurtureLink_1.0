import { useTranslation } from 'react-i18next';
import { setLanguage } from '../../i18n/index.js';
import { useActions } from '../../store/hooks.js';

/** COM-01 / COM-02: English / Filipino. Applies at once, and is saved on the account when someone is signed in. */
export default function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const actions = useActions();
  const lang = i18n.language === 'fil' ? 'fil' : 'en';

  function choose(code) {
    setLanguage(code);
    actions.save_language(code);
  }

  return (
    <div className="lang" role="group" aria-label={t('language.label')}>
      {['en', 'fil'].map((code) => (
        <button key={code} type="button" className="lang__btn" lang={code} aria-pressed={lang === code} aria-label={t(`language.${code}`)} onClick={() => choose(code)}>
          {t(`language.${code}Short`)}
        </button>
      ))}
    </div>
  );
}
