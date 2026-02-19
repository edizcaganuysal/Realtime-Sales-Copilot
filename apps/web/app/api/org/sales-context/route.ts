import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getApiBaseUrl, getFriendlyConfigMessage } from '@/lib/server-env';

const API = getApiBaseUrl();

async function token() {
  const store = await cookies();
  return store.get('access_token')?.value ?? '';
}

function missingConfigResponse() {
  return NextResponse.json({ message: getFriendlyConfigMessage() }, { status: 500 });
}

export async function GET() {
  if (!API) {
    return missingConfigResponse();
  }

  const res = await fetch(`${API}/org/sales-context`, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({ message: 'Unexpected response from API' }));
  return NextResponse.json(data, { status: res.status });
}

export async function PATCH(request: Request) {
  if (!API) {
    return missingConfigResponse();
  }

  const body = await request.json();
  const res = await fetch(`${API}/org/sales-context`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({ message: 'Unexpected response from API' }));
  return NextResponse.json(data, { status: res.status });
}
