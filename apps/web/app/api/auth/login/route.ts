import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  getApiBaseUrl,
  getFriendlyApiUnavailableMessage,
  getFriendlyConfigMessage,
} from '@/lib/server-env';

const API = getApiBaseUrl();

export async function POST(request: Request) {
  const traceId = randomUUID();
  if (!API) {
    return NextResponse.json(
      { message: getFriendlyConfigMessage(), traceId },
      { status: 500 },
    );
  }

  const body = await request.json();
  const loginUrl = `${API}/auth/login`;
  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error(`[auth.login:${traceId}] Failed to reach API at ${loginUrl}`, error);
    return NextResponse.json(
      { message: getFriendlyApiUnavailableMessage(API), traceId },
      { status: 503 },
    );
  }

  if (!res.ok) {
    const contentType = res.headers.get('content-type') ?? '';
    let upstreamMessage = '';
    if (contentType.includes('application/json')) {
      const err = await res.json().catch(() => ({}));
      if (typeof err?.message === 'string') {
        upstreamMessage = err.message;
      }
    } else {
      upstreamMessage = (await res.text().catch(() => '')).slice(0, 220);
    }

    if (res.status >= 500) {
      console.error(
        `[auth.login:${traceId}] Upstream ${res.status} from ${loginUrl} in ${Date.now() - startedAt}ms` +
          ` contentType=${contentType} bodyPreview=${JSON.stringify(upstreamMessage)}`,
      );
      return NextResponse.json(
        {
          message: 'Login service is temporarily unavailable. Please try again shortly.',
          traceId,
          upstreamStatus: res.status,
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { message: upstreamMessage || 'Invalid credentials', traceId },
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
