import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env['API_BASE_URL'] ?? process.env['NEXT_PUBLIC_API_URL'];

async function token() {
  const store = await cookies();
  return store.get('access_token')?.value ?? '';
}

export async function POST() {
  const res = await fetch(`${API}/agents/generate-strategy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}` },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
