import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const LOJA_HOST = process.env.LOJA_PUBLIC_HOST || 'loja.edicoes19deabril.com';
const GIFT_PREFIX = '/loja/storefronts/gift';

function isLojaHost(host: string | null): boolean {
  if (!host) return false;
  return host.split(':')[0] === LOJA_HOST;
}

function shouldPassthrough(pathname: string): boolean {
  return (
    pathname.startsWith('/api') ||
    pathname.startsWith('/health') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/loja/themes') ||
    pathname.startsWith('/loja/core') ||
    pathname.startsWith('/cms/loja')
  );
}

export function middleware(request: NextRequest) {
  const host = request.headers.get('host');
  if (!isLojaHost(host)) return NextResponse.next();

  const { pathname } = request.nextUrl;

  if (shouldPassthrough(pathname)) {
    return NextResponse.next();
  }

  if (pathname === GIFT_PREFIX || pathname === `${GIFT_PREFIX}/`) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  if (pathname.startsWith(`${GIFT_PREFIX}/`)) {
    const rest = pathname.slice(GIFT_PREFIX.length) || '/';
    return NextResponse.redirect(new URL(rest, request.url));
  }

  // JS em URLs limpas (/home.js) importa ../../core → /core/… — servir de /loja/core
  if (pathname.startsWith('/core/')) {
    return NextResponse.rewrite(new URL(`/loja${pathname}`, request.url));
  }

  if (pathname.startsWith('/themes/')) {
    return NextResponse.rewrite(new URL(`/loja${pathname}`, request.url));
  }

  if (pathname === '/') {
    return NextResponse.rewrite(new URL(`${GIFT_PREFIX}/index.html`, request.url));
  }

  if (/^\/[\w.-]+\.(html|js)$/.test(pathname)) {
    return NextResponse.rewrite(new URL(`${GIFT_PREFIX}${pathname}`, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
