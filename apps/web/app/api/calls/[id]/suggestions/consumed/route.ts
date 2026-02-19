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

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!API) {
    return missingConfigResponse();
  }

  const { id } = await params;
  const res = await fetch(`${API}/calls/${id}/suggestions/consumed`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  const data = await res.json().catch(() => ({ message: 'Unexpected response from API' }));
  return NextResponse.json(data, { status: res.status });
}
