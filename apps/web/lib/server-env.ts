const FRIENDLY_CONFIG_MESSAGE =
  'Service configuration is incomplete. Please contact support and try again.';

let loggedApiBaseUrlError = false;

export function getApiBaseUrl(): string | null {
  const value = process.env['API_BASE_URL'] ?? process.env['NEXT_PUBLIC_API_URL'];
  const trimmed = value?.trim();
  if (trimmed) return trimmed.replace(/\/$/, '');

  if (!loggedApiBaseUrlError) {
    loggedApiBaseUrlError = true;
    console.error('Missing API_BASE_URL in web service environment');
  }

  return null;
}

export function getFriendlyConfigMessage(): string {
  return FRIENDLY_CONFIG_MESSAGE;
}

