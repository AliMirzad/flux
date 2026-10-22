import { companionReloadMessage } from '../../application/companion';

export function CompanionError({ message }: { message: string }) {
  return (
    <div role="alert">
      <p className="error-message">{message}</p>
      {message === companionReloadMessage && (
        <button type="button" className="button secondary" onClick={() => location.reload()}>
          Reload Flux
        </button>
      )}
    </div>
  );
}
