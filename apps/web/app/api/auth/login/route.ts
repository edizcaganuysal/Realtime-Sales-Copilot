import { NextResponse } from 'next/server';
import {
  getApiBaseUrl,
  getFriendlyApiUnavailableMessage,
  getFriendlyConfigMessage,
} from '@/lib/server-env';

const API = getApiBaseUrl();

export async function POST(request: Request) {
  if (!API) {
    return NextResponse.json({ message: getFriendlyConfigMessage() }, { status: 500 });
  }

  const body = await request.json();
  const loginUrl = `${API}/auth/login`;
  let res: Response;
  try {
    res = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error(`Failed to reach API for login at ${loginUrl}`, error);
    return NextResponse.json(
      { message: getFriendlyApiUnavailableMessage(API) },
      { status: 503 },
    );
  }

  if (!res.ok) {
    if (res.status >= 500) {
      console.error(`Upstream login API returned ${res.status} for ${loginUrl}`);
    }
    const err = await res.json().catch(() => ({}));
    return NextResponse.json(
      { message: err.message ?? 'Invalid credentials' },
      { status: res.status },
    );
  }

  const data = await res.json();
  const response = NextResponse.json(data);
  response.cookies.set('access_token', data.token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60,
    path: '/',
  });
  return response;
}
