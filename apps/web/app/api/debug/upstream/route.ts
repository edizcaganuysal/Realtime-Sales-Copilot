import { NextResponse } from 'next/server';
import {
  getApiBaseUrl,
  getFriendlyApiUnavailableMessage,
  getFriendlyConfigMessage,
} from '@/lib/server-env';

const API = getApiBaseUrl();

export async function GET() {
  if (!API) {
    return NextResponse.json(
      { ok: false, message: getFriendlyConfigMessage() },
      { status: 500 },
    );
  }

  const url = `${API}/health`;
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text().catch(() => '');
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      latencyMs: Date.now() - startedAt,
      apiBaseUrl: API,
      bodyPreview: text.slice(0, 220),
    });
  } catch (error) {
    console.error(`[debug.upstream] Failed to reach ${url}`, error);
    return NextResponse.json(
      {
        ok: false,
        status: 503,
        apiBaseUrl: API,
        message: getFriendlyApiUnavailableMessage(API),
      },
      { status: 503 },
    );
  }
}
