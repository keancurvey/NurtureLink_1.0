import { useId } from 'react';
import { TriangleAlert } from 'lucide-react';

/** A tick box with a visible label; the whole row is the tap target. Controlled: pass checked and onChange(nextChecked). */
export default function Checkbox({ label, checked, onChange, error, id, disabled = false }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={['check', error ? 'check--error' : ''].filter(Boolean).join(' ')}>
      <label className="check__row" htmlFor={inputId}>
        <input
          id={inputId}
          className="check__input"
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      {error ? (
        <p className="field__error" id={errorId}>
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
