import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const PROTECTED = ['/app', '/admin'];
const ADMIN_PATHS = ['/app/admin'];
const secretValue = process.env['JWT_SECRET'];
const secret = secretValue ? new TextEncoder().encode(secretValue) : null;
let missingJwtSecretLogged = false;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED.some((p) => pathname.startsWith(p));

  if (!isProtected) return NextResponse.next();

  if (!secret) {
    if (!missingJwtSecretLogged) {
      missingJwtSecretLogged = true;
      console.error('Missing JWT_SECRET in web service environment');
    }
    const loginUrl = new URL('/login?config=missing-jwt-secret', request.url);
    return NextResponse.redirect(loginUrl);
  }

  const token = request.cookies.get('access_token')?.value;

  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  try {
    const { payload } = await jwtVerify(token, secret);

    const isAdminPath = ADMIN_PATHS.some((p) => pathname.startsWith(p));
    if (isAdminPath && payload['role'] === 'REP') {
      return NextResponse.redirect(new URL('/app/home', request.url));
    }

    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL('/login', request.url));
  }
}

export const config = {
  matcher: ['/app/:path*', '/admin/:path*'],
};
