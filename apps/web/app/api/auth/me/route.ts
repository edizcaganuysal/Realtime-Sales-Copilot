import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getApiBaseUrl, getFriendlyConfigMessage } from '@/lib/server-env';

const API = getApiBaseUrl();

export async function GET() {
  if (!API) {
    return NextResponse.json({ message: getFriendlyConfigMessage() }, { status: 500 });
  }

  const store = await cookies();
  const token = store.get('access_token')?.value ?? '';
  const res = await fetch(`${API}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
