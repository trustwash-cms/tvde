import { osmEmbedUrl } from '@tvde/shared';
import { env } from '../../config/env';
import {
  CALENDAR_MAP_CID,
  generateMapImageBuffer,
} from './calendar-map-image.service';

const URL_RE = /^https?:\/\//i;
const COORDS_RE = /^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function resolveMapsUrl(location: string): string | null {
  const raw = location.trim();
  if (!raw || URL_RE.test(raw)) return null;

  const coordMatch = raw.match(COORDS_RE);
  if (coordMatch) {
    return `https://www.google.com/maps?q=${coordMatch[1]},${coordMatch[2]}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(raw)}`;
}

async function geocodeAddress(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
      q: query,
      format: 'json',
      limit: '1',
    })}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'CMS-Calendar/1.0 (appointment-notifications)' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!data[0]) return null;
    return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
  } catch {
    return null;
  }
}

export async function resolveCoordinatesForMap(
  location: string
): Promise<{ lat: number; lng: number } | null> {
  const raw = location.trim();
  if (!raw || URL_RE.test(raw)) return null;

  const coordMatch = raw.match(COORDS_RE);
  if (coordMatch) {
    return { lat: Number(coordMatch[1]), lng: Number(coordMatch[2]) };
  }

  return geocodeAddress(raw);
}

export function buildOsmEmbedUrl(lat: number, lng: number): string {
  return osmEmbedUrl(lat, lng);
}

export function formatLocationForEmail(location: string | null | undefined): string {
  const raw = location?.trim() ?? '';
  if (!raw) return '—';

  if (URL_RE.test(raw)) {
    const linkStyle = 'color:#185FA5;text-decoration:underline';
    const safe = escapeHtml(raw);
    return `<a href="${safe}" style="${linkStyle}">${safe}</a>`;
  }

  return escapeHtml(raw);
}

export function buildLocationMapCardHtml(
  mapsUrl: string,
  options: { embeddedImage: boolean }
): string {
  const safeMapsUrl = escapeHtml(mapsUrl);
  const imgRow = options.embeddedImage
    ? `<tr>
<td align="center" style="padding:0;margin:0;font-size:0;line-height:0;background-color:#E5E7EB;">
<a href="${safeMapsUrl}" target="_blank" style="text-decoration:none;">
<img src="cid:${CALENDAR_MAP_CID}" alt="" width="520" height="200" border="0" style="display:block;width:100%;max-width:520px;height:auto;border:0;" />
</a>
</td>
</tr>`
    : '';

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;margin-top:12px;border:1px solid #E5E7EB;border-collapse:collapse;background-color:#F9FAFB;">
${imgRow}
<tr>
<td align="center" style="padding:14px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td align="center" bgcolor="#52BB7E" style="background-color:#52BB7E;border-radius:8px;">
<a href="${safeMapsUrl}" target="_blank" style="display:inline-block;padding:11px 22px;font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Ver no Google Maps</a>
</td>
</tr>
</table>
</td>
</tr>
</table>`;
}

export interface LocationMapEmailAssets {
  locationMap: string;
  mapAttachment: { filename: string; content: Buffer; cid: string } | null;
}

export async function buildLocationMapEmailAssets(
  location: string | null | undefined
): Promise<LocationMapEmailAssets> {
  const raw = location?.trim() ?? '';
  if (!raw || URL_RE.test(raw)) {
    return { locationMap: '', mapAttachment: null };
  }

  const coords = await resolveCoordinatesForMap(raw);
  if (!coords) {
    return { locationMap: '', mapAttachment: null };
  }

  const mapsUrl = `https://www.google.com/maps?q=${coords.lat},${coords.lng}`;
  const image = await generateMapImageBuffer(coords.lat, coords.lng);

  if (image) {
    return {
      locationMap: buildLocationMapCardHtml(mapsUrl, { embeddedImage: true }),
      mapAttachment: {
        filename: 'map.jpg',
        content: image,
        cid: CALENDAR_MAP_CID,
      },
    };
  }

  return {
    locationMap: buildLocationMapCardHtml(mapsUrl, { embeddedImage: false }),
    mapAttachment: null,
  };
}

/** @deprecated Use buildLocationMapEmailAssets — mantido para compatibilidade interna */
export async function buildLocationMapHtml(
  location: string | null | undefined
): Promise<string> {
  const assets = await buildLocationMapEmailAssets(location);
  return assets.locationMap;
}

export function buildMapPreviewImageUrl(lat: number, lng: number, zoom = 15): string {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    z: String(zoom),
  });
  return `${env.apiPublicUrl}/calendar/map-preview?${params}`;
}
