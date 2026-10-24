import { useEffect, useState } from 'react';
const fields = {
  metadata: 'Website and category',
  size: 'Transferred size',
  speed: 'Transfer speed',
  eta: 'Time remaining',
  connections: 'Connection count',
};
type Field = keyof typeof fields;
const defaults = {
  compact: false,
  ...Object.fromEntries(Object.keys(fields).map((key) => [key, true])),
} as Record<Field, boolean> & { compact: boolean };
export function useDisplayOptions() {
  const [value, setValue] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('flux-display') ?? '{}');
      return Object.fromEntries(
        Object.entries(defaults).map(([key, fallback]) => [
          key,
          typeof stored?.[key] === 'boolean' ? stored[key] : fallback,
        ]),
      ) as typeof defaults;
    } catch {
      return { ...defaults };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('flux-display', JSON.stringify(value));
    } catch {
      /* Display remains usable without persistence. */
    }
  }, [value]);
  return { value, setValue };
}
export function DisplayOptions({ value, setValue }: ReturnType<typeof useDisplayOptions>) {
  return (
    <details className="display-options">
      <summary className="button secondary tool">View options</summary>
      <fieldset>
        <legend>Download view</legend>
        {Object.entries({ compact: 'Compact rows', ...fields }).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={value[key as keyof typeof value]}
              onChange={(event) => setValue({ ...value, [key]: event.target.checked })}
            />
            {label}
          </label>
        ))}
        <button className="text-button" type="button" onClick={() => setValue({ ...defaults })}>
          Reset view
        </button>
      </fieldset>
    </details>
  );
}
