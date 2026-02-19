import { NextResponse } from 'next/server';
import { getApiBaseUrl, getFriendlyConfigMessage } from '@/lib/server-env';

const API = getApiBaseUrl();

export async function GET() {
  if (!API) {
    return NextResponse.json({ message: getFriendlyConfigMessage() }, { status: 500 });
  }

  const res = await fetch(`${API}/plans`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({ message: 'Unexpected response from API' }));
  return NextResponse.json(data, { status: res.status });
}
