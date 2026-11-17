import { useCallback, useState } from 'react';

/** Values and errors of one form. Changing a field clears that field's error. The functions keep their identity. */
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const setValue = useCallback((name, value) => {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }, []);
  const clearErrors = useCallback(() => setErrors({}), []);
  return { values, errors, setValue, setErrors, clearErrors };
}
