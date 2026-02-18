import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

async function token() {
  const store = await cookies();
  return store.get('access_token')?.value ?? '';
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${API}/playbooks/${id}/set-default`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}` },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
