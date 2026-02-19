import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getApiBaseUrl } from '@/lib/server-env';

type OAuthMode = 'login' | 'signup';

function getMode(value: string | undefined): OAuthMode {
  return value === 'login' ? 'login' : 'signup';
}

function getBaseUrl(request: Request): string {
  const raw = process.env['APP_BASE_URL']?.trim();
  if (raw && raw.length > 0) {
    return raw.replace(/\/$/, '');
  }
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function getRedirectUri(request: Request): string {
  const explicit = process.env['GOOGLE_OAUTH_REDIRECT_URI']?.trim();
  if (explicit && explicit.length > 0) return explicit;
  return `${getBaseUrl(request)}/api/auth/google/callback`;
}

function clearOAuthCookies(response: NextResponse) {
  response.cookies.set('google_oauth_state', '', { maxAge: 0, path: '/' });
  response.cookies.set('google_oauth_mode', '', { maxAge: 0, path: '/' });
  response.cookies.set('google_oauth_org_name', '', { maxAge: 0, path: '/' });
}

function mapApiErrorToCode(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('organization name is required')) return 'google_signup_requires_org';
  if (normalized.includes('no account found')) return 'google_login_not_found';
  return 'google_oauth_failed';
}

function errorRedirect(requestUrl: URL, mode: OAuthMode, code: string) {
  const path = mode === 'login' ? '/login' : '/signup';
  const response = NextResponse.redirect(new URL(`${path}?error=${code}`, requestUrl));
  clearOAuthCookies(response);
  return response;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const store = await cookies();
  const mode = getMode(store.get('google_oauth_mode')?.value);
  const code = requestUrl.searchParams.get('code')?.trim();
  const state = requestUrl.searchParams.get('state')?.trim();
  const stateCookie = store.get('google_oauth_state')?.value ?? '';
  const clientId = process.env['GOOGLE_CLIENT_ID']?.trim();
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET']?.trim();

  if (!clientId || !clientSecret) {
    console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in web environment');
    return errorRedirect(requestUrl, mode, 'google_config_missing');
  }

  if (!code || !state || !stateCookie || state !== stateCookie) {
    return errorRedirect(requestUrl, mode, 'google_oauth_failed');
  }

  const redirectUri = getRedirectUri(request);
  const tokenBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    return errorRedirect(requestUrl, mode, 'google_oauth_failed');
  }

  const accessToken =
    typeof tokenData?.access_token === 'string' ? tokenData.access_token : '';
  if (!accessToken) {
    return errorRedirect(requestUrl, mode, 'google_oauth_failed');
  }

  const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = await profileRes.json().catch(() => ({}));
  if (!profileRes.ok) {
    return errorRedirect(requestUrl, mode, 'google_oauth_failed');
  }

  const email = typeof profile?.email === 'string' ? profile.email.trim() : '';
  const name = typeof profile?.name === 'string' ? profile.name.trim() : '';
  const googleSub = typeof profile?.sub === 'string' ? profile.sub.trim() : '';
  const emailVerified = profile?.email_verified === true;
  if (!email || !googleSub || !emailVerified) {
    return errorRedirect(requestUrl, mode, 'google_oauth_failed');
  }

  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) {
    return errorRedirect(requestUrl, mode, 'google_config_missing');
  }

  const orgName = store.get('google_oauth_org_name')?.value?.trim() ?? '';
  const payload =
    mode === 'signup'
      ? { email, name, googleSub, mode, orgName }
      : { email, name, googleSub, mode };

  const authRes = await fetch(`${apiBaseUrl}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const authData = await authRes.json().catch(() => ({}));
  if (!authRes.ok) {
    const message = typeof authData?.message === 'string' ? authData.message : '';
    return errorRedirect(requestUrl, mode, mapApiErrorToCode(message));
  }

  const token = typeof authData?.token === 'string' ? authData.token : '';
  if (!token) {
    return errorRedirect(requestUrl, mode, 'google_oauth_failed');
  }

  const response = NextResponse.redirect(new URL('/app/home', requestUrl));
  response.cookies.set('access_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60,
    path: '/',
  });
  clearOAuthCookies(response);
  return response;
}
