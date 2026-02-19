import { NextResponse } from 'next/server';
import { getApiBaseUrl, getFriendlyConfigMessage } from '@/lib/server-env';

const API = getApiBaseUrl();

export async function POST(request: Request) {
  if (!API) {
    return NextResponse.json({ message: getFriendlyConfigMessage() }, { status: 500 });
  }

  const body = await request.json();
  const res = await fetch(`${API}/sales-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({ message: 'Unexpected response from server' }));
  return NextResponse.json(data, { status: res.status });
}
