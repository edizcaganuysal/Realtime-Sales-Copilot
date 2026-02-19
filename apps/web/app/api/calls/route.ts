import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env['API_BASE_URL'] ?? process.env['NEXT_PUBLIC_API_URL'];

async function token() {
  const store = await cookies();
  return store.get('access_token')?.value ?? '';
}

export async function GET() {
  const res = await fetch(`${API}/calls`, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: 'no-store',
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(request: Request) {
  const body = await request.json();
  const res = await fetch(`${API}/calls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
