import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env['API_BASE_URL'] ?? process.env['NEXT_PUBLIC_API_URL'];

async function token() {
  const store = await cookies();
  return store.get('access_token')?.value ?? '';
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${API}/calls/${id}/transcript`, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: 'no-store',
  });
  const text = await res.text();
  if (!text.trim()) {
    return NextResponse.json([], { status: res.status });
  }
  try {
    const data = JSON.parse(text);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json([], { status: res.status });
  }
}
