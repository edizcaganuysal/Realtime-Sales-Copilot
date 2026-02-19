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

export async function POST(request: Request) {
  if (!API) {
    return missingConfigResponse();
  }

  const formData = await request.formData();
  const res = await fetch(`${API}/ingest/company/pdfs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
    },
    body: formData,
  });
  const data = await res.json().catch(() => ({ message: 'Unexpected response from API' }));
  return NextResponse.json(data, { status: res.status });
}
