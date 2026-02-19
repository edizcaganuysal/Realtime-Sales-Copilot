import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getApiBaseUrl, getFriendlyConfigMessage } from '@/lib/server-env';

const API = getApiBaseUrl();

async function token() {
  const store = await cookies();
  return store.get('access_token')?.value ?? '';
}

export async function GET(request: Request) {
  if (!API) {
    return NextResponse.json({ message: getFriendlyConfigMessage() }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.toString();
  const res = await fetch(`${API}/admin/requests${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({ message: 'Unexpected response from API' }));
  return NextResponse.json(data, { status: res.status });
}
