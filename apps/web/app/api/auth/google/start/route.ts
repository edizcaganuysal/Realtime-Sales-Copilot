import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';

type OAuthMode = 'login' | 'signup';

function getMode(value: string | null): OAuthMode {
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

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const mode = getMode(requestUrl.searchParams.get('mode'));
  const returnPath = mode === 'login' ? '/login' : '/signup';
  const clientId = process.env['GOOGLE_CLIENT_ID']?.trim();
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET']?.trim();

  if (!clientId || !clientSecret) {
    console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in web environment');
    const response = NextResponse.redirect(new URL(`${returnPath}?error=google_config_missing`, requestUrl));
    clearOAuthCookies(response);
    return response;
  }

  const orgName = requestUrl.searchParams.get('orgName')?.trim() ?? '';
  if (mode === 'signup' && orgName.length < 2) {
    const response = NextResponse.redirect(
      new URL('/signup?error=google_signup_requires_org', requestUrl),
    );
    clearOAuthCookies(response);
    return response;
  }

  const state = randomUUID();
  const redirectUri = getRedirectUri(request);
  const googleUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleUrl.searchParams.set('client_id', clientId);
  googleUrl.searchParams.set('redirect_uri', redirectUri);
  googleUrl.searchParams.set('response_type', 'code');
  googleUrl.searchParams.set('scope', 'openid email profile');
  googleUrl.searchParams.set('state', state);
  googleUrl.searchParams.set('prompt', 'select_account');

  const response = NextResponse.redirect(googleUrl);
  response.cookies.set('google_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 10 * 60,
    path: '/',
  });
  response.cookies.set('google_oauth_mode', mode, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 10 * 60,
    path: '/',
  });
  if (mode === 'signup') {
    response.cookies.set('google_oauth_org_name', orgName, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 10 * 60,
      path: '/',
    });
  } else {
    response.cookies.set('google_oauth_org_name', '', { maxAge: 0, path: '/' });
  }

  return response;
}
