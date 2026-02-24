import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getApiBaseUrl, getFriendlyApiUnavailableMessage, getFriendlyConfigMessage } from '@/lib/server-env';

const API = getApiBaseUrl();

async function token() {
  const store = await cookies();
  return store.get('access_token')?.value ?? '';
}

export async function GET() {
  if (!API) return NextResponse.json({ message: getFriendlyConfigMessage() }, { status: 500 });
  let res: Response;
  try {
    res = await fetch(`${API}/support/sessions`, {
      headers: { Authorization: `Bearer ${await token()}` },
      cache: 'no-store',
    });
  } catch (error) {
    console.error('Failed to reach API for support sessions list', error);
    return NextResponse.json({ message: getFriendlyApiUnavailableMessage(API) }, { status: 503 });
  }
  const data = await res.json().catch(() => ({ message: 'Unexpected response' }));
  return NextResponse.json(data, { status: res.status });
}

export async function POST(request: Request) {
  if (!API) return NextResponse.json({ message: getFriendlyConfigMessage() }, { status: 500 });
  const body = await request.json();
  let res: Response;
  try {
    res = await fetch(`${API}/support/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error('Failed to reach API for support session creation', error);
    return NextResponse.json({ message: getFriendlyApiUnavailableMessage(API) }, { status: 503 });
  }
  const data = await res.json().catch(() => ({ message: 'Unexpected response' }));
  return NextResponse.json(data, { status: res.status });
}
