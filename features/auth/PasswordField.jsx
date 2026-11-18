import { useId, useState } from 'react';
import { Check, Circle, Eye, EyeOff, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { passwordChecks } from '../../lib/authRules.js';

/** A password field with show and hide, and (for a new password) the rules it must meet, each ticked as it is met. */
export default function PasswordField({ label, error, showRules = false, value, ...inputProps }) {
  const { t } = useTranslation('auth');
  const [shown, setShown] = useState(false);
  const id = useId();
  const rulesId = `${id}-rules`;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [showRules ? rulesId : null, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={['field', 'field--password', error ? 'field--error' : ''].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="field__control">
        <input
          id={id}
          className="field__input"
          type={shown ? 'text' : 'password'}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck="false"
          {...inputProps}
        />
        <button type="button" className="field__toggle" aria-label={shown ? t('password.hide') : t('password.show')} aria-pressed={shown} onClick={() => setShown((current) => !current)}>
          {shown ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
        </button>
      </div>
      {showRules ? (
        <ul className="pw-rules" id={rulesId} aria-label={t('password.rulesTitle')}>
          {passwordChecks(value).map(({ id: rule, ok }) => (
            <li key={rule} className={ok ? 'pw-rules__item pw-rules__item--met' : 'pw-rules__item'}>
              {ok ? <Check size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
              <span>{t(`password.rules.${rule}`)}</span>
              <span className="visually-hidden">{ok ? t('password.met') : t('password.notMet')}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p className="field__error" id={errorId}>
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
