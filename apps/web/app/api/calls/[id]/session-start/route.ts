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

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!API) {
    return missingConfigResponse();
  }

  const { id } = await params;
  const res = await fetch(`${API}/calls/${id}/session-start`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
    },
  });
  const data = await res.json().catch(() => ({ ok: res.ok }));
  return NextResponse.json(data, { status: res.status });
}
