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

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  if (!API) {
    return missingConfigResponse();
  }

  const { jobId } = await params;
  const res = await fetch(`${API}/ingest/jobs/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({ message: 'Unexpected response from API' }));
  return NextResponse.json(data, { status: res.status });
}
