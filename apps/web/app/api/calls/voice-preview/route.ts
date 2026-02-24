import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getApiBaseUrl } from '@/lib/server-env';

const API = getApiBaseUrl();

async function token() {
  const store = await cookies();
  return store.get('access_token')?.value ?? '';
}

export async function GET(req: NextRequest) {
  if (!API) {
    return NextResponse.json({ message: 'API not configured' }, { status: 500 });
  }

  const voice = req.nextUrl.searchParams.get('voice') ?? 'marin';
  const t = await token();

  const res = await fetch(`${API}/calls/voice-preview?voice=${encodeURIComponent(voice)}`, {
    headers: { Authorization: `Bearer ${t}` },
  });

  if (!res.ok) {
    return NextResponse.json({ message: 'Voice preview failed' }, { status: res.status });
  }

  const arrayBuffer = await res.arrayBuffer();
  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
