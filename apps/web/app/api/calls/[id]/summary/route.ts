import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env['API_BASE_URL'] ?? process.env['NEXT_PUBLIC_API_URL'];

async function token() {
  const store = await cookies();
  return store.get('access_token')?.value ?? '';
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${API}/calls/${id}/summary`, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: 'no-store',
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
