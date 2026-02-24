import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getApiBaseUrl, getFriendlyApiUnavailableMessage, getFriendlyConfigMessage } from '@/lib/server-env';

const API = getApiBaseUrl();
async function token() { const store = await cookies(); return store.get('access_token')?.value ?? ''; }

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!API) return NextResponse.json({ message: getFriendlyConfigMessage() }, { status: 500 });
  let res: Response;
  try {
    res = await fetch(`${API}/support/sessions/${id}/session-start`, { method: 'POST', headers: { Authorization: `Bearer ${await token()}` } });
  } catch { return NextResponse.json({ message: getFriendlyApiUnavailableMessage(API) }, { status: 503 }); }
  const data = await res.json().catch(() => ({ message: 'Unexpected response' }));
  return NextResponse.json(data, { status: res.status });
}
