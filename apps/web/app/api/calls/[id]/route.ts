import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env['API_BASE_URL'] ?? process.env['NEXT_PUBLIC_API_URL'];

async function token() {
  const store = await cookies();
  return store.get('access_token')?.value ?? '';
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${API}/calls/${id}`, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: 'no-store',
  });
  const text = await res.text();
  if (!text.trim()) {
    return new NextResponse(null, { status: res.status });
  }
  try {
    const data = JSON.parse(text);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Invalid upstream response' }, { status: res.status });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const res = await fetch(`${API}/calls/${id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!text.trim()) {
    return new NextResponse(null, { status: res.status });
  }
  try {
    const data = JSON.parse(text);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Invalid upstream response' }, { status: res.status });
  }
}
