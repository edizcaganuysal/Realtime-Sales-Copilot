import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getApiBaseUrl, getFriendlyConfigMessage } from '@/lib/server-env';

const API = getApiBaseUrl();

async function token() {
  const store = await cookies();
  return store.get('access_token')?.value ?? '';
}

export async function POST(request: Request) {
  if (!API) {
    return NextResponse.json({ message: getFriendlyConfigMessage() }, { status: 500 });
  }

  const body = await request.json();
  const res = await fetch(`${API}/requests/fine-tune`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ message: 'Unexpected response from API' }));
  return NextResponse.json(data, { status: res.status });
}
