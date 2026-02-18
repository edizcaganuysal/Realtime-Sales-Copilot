import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

async function token() {
  const store = await cookies();
  return store.get('access_token')?.value ?? '';
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${API}/playbooks/${id}`, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: 'no-store',
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const res = await fetch(`${API}/playbooks/${id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
