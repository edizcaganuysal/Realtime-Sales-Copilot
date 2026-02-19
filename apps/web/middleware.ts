import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PROTECTED = ['/app', '/admin'];
const LEGACY_ROUTE_REDIRECTS: Array<{ from: string; to: string }> = [
  { from: '/app/admin/context/offerings', to: '/app/context' },
  { from: '/app/admin/context', to: '/app/context' },
  { from: '/app/admin/company/import', to: '/app/context/import' },
  { from: '/app/admin/products/import', to: '/app/context/offerings-import' },
  { from: '/app/admin/ai', to: '/app/fine-tuning' },
  { from: '/app/settings/company', to: '/app/settings' },
  { from: '/app/training', to: '/app/home' },
  { from: '/app/admin', to: '/app/home' },
  { from: '/admin', to: '/app/home' },
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED.some((p) => pathname.startsWith(p));

  if (!isProtected) return NextResponse.next();

  const token = request.cookies.get('access_token')?.value;
  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  for (const rule of LEGACY_ROUTE_REDIRECTS) {
    if (pathname.startsWith(rule.from)) {
      return NextResponse.redirect(new URL(rule.to, request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/app/:path*', '/admin/:path*'],
};
