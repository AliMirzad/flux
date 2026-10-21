export type StartMode = 'now' | 'later' | 'paused';

/** "When should this start?" as one plain choice instead of a bare date field and a checkbox. */
export function StartChoice({
  mode,
  onChange,
  defaultTime = '',
  allowPaused = true,
}: {
  mode: StartMode;
  onChange: (mode: StartMode) => void;
  defaultTime?: string;
  allowPaused?: boolean;
}) {
  const soon = () => {
    const at = new Date(Date.now() + 3600000);
    at.setMinutes(0, 0, 0);
    return new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  return (
    <div className="start-choice">
      <label>
        When to start
        <select value={mode} onChange={(event) => onChange(event.target.value as StartMode)}>
          <option value="now">As soon as possible</option>
          <option value="later">At a specific time</option>
          {allowPaused && <option value="paused">Don’t start yet (I’ll start it)</option>}
        </select>
      </label>
      {mode === 'later' && (
        <label>
          Start time
          <input
            name="schedule"
            type="datetime-local"
            required
            defaultValue={defaultTime || soon()}
          />
        </label>
      )}
    </div>
  );
}
