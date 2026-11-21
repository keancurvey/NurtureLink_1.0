import { useId } from 'react';
import { TriangleAlert } from 'lucide-react';

export default function Field({ label, hint, error, id, className = '', multiline = false, ...inputProps }) {
  const Control = multiline ? 'textarea' : 'input';
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={['field', error ? 'field--error' : '', className].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <Control
        id={inputId}
        className={multiline ? 'field__input field__input--multi' : 'field__input'}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...inputProps}
      />
      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
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
