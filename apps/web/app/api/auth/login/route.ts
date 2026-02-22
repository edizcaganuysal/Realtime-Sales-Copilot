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
  let res: Response;
  try {
    res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error('Failed to reach API for login', error);
    return NextResponse.json(
      { message: getFriendlyApiUnavailableMessage(API) },
      { status: 503 },
    );
  }

  if (!res.ok) {
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
