export class HostPermissionError extends Error {
  constructor(public origin: string) {
    super('Website access is needed for a redirected download. Grant access and retry.');
  }
}
export interface RedirectPolicy {
  /** Browser session use is restricted to one explicitly selected source origin. */
  credentialOrigin?: string;
  prepareRequest?(url: string, signal: AbortSignal): Promise<void>;
  resolveRedirect(from: string, location: string | null, signal: AbortSignal): Promise<string>;
}
