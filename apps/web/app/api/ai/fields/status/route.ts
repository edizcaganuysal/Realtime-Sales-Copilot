import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getApiBaseUrl, getFriendlyConfigMessage } from '@/lib/server-env';

const API = getApiBaseUrl();

async function token() {
  const store = await cookies();
  return store.get('access_token')?.value ?? '';
}

function missingConfigResponse() {
  return NextResponse.json({ message: getFriendlyConfigMessage(), enabled: false }, { status: 500 });
}

export async function GET() {
  if (!API) {
    return missingConfigResponse();
  }

  const res = await fetch(`${API}/ai/fields/status`, {
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  const data = await res.json().catch(() => ({
    enabled: false,
    message: 'Could not read AI status from API',
  }));

  return NextResponse.json(data, { status: res.status });
}
