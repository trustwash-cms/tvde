import { API_PATHS } from '@tvde/shared';

function getBackendApiBase(): string {
  const base =
    process.env.API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3001/api/v1';
  return base.replace(/\/$/, '');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const z = searchParams.get('z');

  if (!lat || !lng) {
    return new Response('Coordenadas em falta', { status: 400 });
  }

  const params = new URLSearchParams({ lat, lng });
  if (z) params.set('z', z);

  const backendUrl = `${getBackendApiBase()}${API_PATHS.calendar.mapPreview}?${params}`;
  const headers: Record<string, string> = {};
  if (backendUrl.includes('ngrok')) {
    headers['ngrok-skip-browser-warning'] = '1';
  }

  const res = await fetch(backendUrl, { headers, cache: 'no-store' });
  if (!res.ok) {
    return new Response('Mapa indisponível', { status: res.status });
  }

  const body = await res.arrayBuffer();
  return new Response(body, {
    headers: {
      'Content-Type': res.headers.get('content-type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
