const FRIENDLY_CONFIG_MESSAGE =
  'Service configuration is incomplete. Please contact support and try again.';
const FRIENDLY_UNAVAILABLE_MESSAGE = 'Service is temporarily unavailable. Please try again.';

let loggedApiBaseUrlError = false;
let loggedApiBaseUrlPathWarning = false;

export function getApiBaseUrl(): string | null {
  const value = process.env['API_BASE_URL'] ?? process.env['NEXT_PUBLIC_API_URL'];
  const trimmed = value?.trim();
  if (trimmed) {
    try {
      const parsed = new URL(trimmed);
      // Guard against accidental values like https://web.example.com/api causing proxy recursion.
      if (parsed.pathname && parsed.pathname !== '/' && !loggedApiBaseUrlPathWarning) {
        loggedApiBaseUrlPathWarning = true;
        console.warn(
          `API base URL contained a path (${parsed.pathname}); using origin only (${parsed.origin}).`,
        );
      }
      return parsed.origin;
    } catch {
      if (!loggedApiBaseUrlError) {
        loggedApiBaseUrlError = true;
        console.error(`Invalid API_BASE_URL format in web service environment: ${trimmed}`);
      }
      return null;
    }
  }

  if (!loggedApiBaseUrlError) {
    loggedApiBaseUrlError = true;
    console.error('Missing API_BASE_URL in web service environment');
  }

  return null;
}

export function getFriendlyConfigMessage(): string {
  return FRIENDLY_CONFIG_MESSAGE;
}

export function getFriendlyApiUnavailableMessage(apiBaseUrl: string): string {
  if (process.env['NODE_ENV'] === 'development') {
    return `Cannot reach API service at ${apiBaseUrl}. Start apps/api and retry.`;
  }
  return FRIENDLY_UNAVAILABLE_MESSAGE;
}
