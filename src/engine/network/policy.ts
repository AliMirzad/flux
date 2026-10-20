export class HostPermissionError extends Error {
  constructor(public origin: string) {
    super('Website access is needed for a redirected download. Grant access and retry.');
  }
}
export interface RedirectPolicy {
  prepareRequest?(url: string, signal: AbortSignal): Promise<void>;
  resolveRedirect(from: string, location: string | null, signal: AbortSignal): Promise<string>;
}
