import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getApiBaseUrl, getFriendlyApiUnavailableMessage, getFriendlyConfigMessage } from '@/lib/server-env';

const API = getApiBaseUrl();
async function token() { const store = await cookies(); return store.get('access_token')?.value ?? ''; }

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!API) return NextResponse.json({ message: getFriendlyConfigMessage() }, { status: 500 });
  const body = await request.json();
  let res: Response;
  try {
    res = await fetch(`${API}/support/integrations/${id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch { return NextResponse.json({ message: getFriendlyApiUnavailableMessage(API) }, { status: 503 }); }
  const data = await res.json().catch(() => ({ message: 'Unexpected response' }));
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!API) return NextResponse.json({ message: getFriendlyConfigMessage() }, { status: 500 });
  let res: Response;
  try {
    res = await fetch(`${API}/support/integrations/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await token()}` } });
  } catch { return NextResponse.json({ message: getFriendlyApiUnavailableMessage(API) }, { status: 503 }); }
  const data = await res.json().catch(() => ({ message: 'Unexpected response' }));
  return NextResponse.json(data, { status: res.status });
}
