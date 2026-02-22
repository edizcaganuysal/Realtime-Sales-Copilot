import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getApiBaseUrl,
  getFriendlyApiUnavailableMessage,
  getFriendlyConfigMessage,
} from '@/lib/server-env';

const API = getApiBaseUrl();

async function token() {
  const store = await cookies();
  return store.get('access_token')?.value ?? '';
}

export async function GET() {
  if (!API) {
    return NextResponse.json({ message: getFriendlyConfigMessage() }, { status: 500 });
  }

  let res: Response;
  try {
    res = await fetch(`${API}/org/credits`, {
      headers: { Authorization: `Bearer ${await token()}` },
      cache: 'no-store',
    });
  } catch (error) {
    console.error('Failed to reach API for org credits', error);
    return NextResponse.json(
      { message: getFriendlyApiUnavailableMessage(API) },
      { status: 503 },
    );
  }

  const data = await res.json().catch(() => ({ message: 'Unexpected response from API' }));
  return NextResponse.json(data, { status: res.status });
}
