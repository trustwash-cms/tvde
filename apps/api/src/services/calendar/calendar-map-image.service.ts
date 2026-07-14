import sharp from 'sharp';
import { latLngToTile } from '@tvde/shared';
import { env } from '../../config/env';

const OSM_TILE_UA = 'CMS-Calendar/1.0 (appointment-notifications)';
const MAP_WIDTH = 520;
const MAP_HEIGHT = 200;
const TILE_SIZE = 256;

async function fetchOsmTile(x: number, y: number, zoom: number): Promise<Buffer | null> {
  try {
    const res = await fetch(`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`, {
      headers: { 'User-Agent': OSM_TILE_UA },
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function latLngToPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = ((lng + 180) / 360) * n * TILE_SIZE;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * TILE_SIZE;
  return { x, y };
}

async function generateGeoapifyMap(lat: number, lng: number): Promise<Buffer | null> {
  if (!env.geoapifyApiKey) return null;
  const params = new URLSearchParams({
    style: 'osm-bright',
    width: String(MAP_WIDTH),
    height: String(MAP_HEIGHT),
    center: `lonlat:${lng},${lat}`,
    zoom: '15',
    marker: `lonlat:${lng},${lat};color:%23dc2626;size:64`,
    apiKey: env.geoapifyApiKey,
  });
  try {
    const res = await fetch(`https://maps.geoapify.com/v1/staticmap?${params}`);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return sharp(buffer).jpeg({ quality: 90 }).toBuffer();
  } catch {
    return null;
  }
}

async function generateGoogleStaticMap(lat: number, lng: number): Promise<Buffer | null> {
  if (!env.googleMapsApiKey) return null;
  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: '15',
    size: `${MAP_WIDTH}x${MAP_HEIGHT}`,
    scale: '2',
    markers: `color:red|${lat},${lng}`,
    key: env.googleMapsApiKey,
  });
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${params}`);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function generateOsmCompositeMap(lat: number, lng: number): Promise<Buffer | null> {
  const zoom = 15;
  const grid = 3;
  const { x: centerX, y: centerY } = latLngToTile(lat, lng, zoom);

  const composites: sharp.OverlayOptions[] = [];
  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      const tile = await fetchOsmTile(centerX + col - 1, centerY + row - 1, zoom);
      if (!tile) return null;
      const normalized = await sharp(tile).resize(TILE_SIZE, TILE_SIZE).png().toBuffer();
      composites.push({
        input: normalized,
        left: col * TILE_SIZE,
        top: row * TILE_SIZE,
      });
    }
  }

  const fullWidth = grid * TILE_SIZE;
  const fullHeight = grid * TILE_SIZE;
  const pixel = latLngToPixel(lat, lng, zoom);
  const gridOriginX = (centerX - 1) * TILE_SIZE;
  const gridOriginY = (centerY - 1) * TILE_SIZE;
  const pinX = Math.round(pixel.x - gridOriginX - 20);
  const pinY = Math.round(pixel.y - gridOriginY - 48);
  const pinLeft = Math.max(0, Math.min(fullWidth - 40, pinX));
  const pinTop = Math.max(0, Math.min(fullHeight - 52, pinY));

  const pinSvg = Buffer.from(
    `<svg width="40" height="52" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="20" cy="48" rx="10" ry="4" fill="rgba(0,0,0,0.18)"/>
      <path d="M20 0C9.507 0 1 8.507 1 19c0 13.5 19 33 19 33s19-19.5 19-33C39 8.507 30.493 0 20 0z" fill="#DC2626"/>
      <circle cx="20" cy="19" r="7" fill="#ffffff"/>
    </svg>`
  );

  const cropLeft = Math.max(
    0,
    Math.min(fullWidth - MAP_WIDTH, Math.round(pixel.x - gridOriginX - MAP_WIDTH / 2))
  );
  const cropTop = Math.max(
    0,
    Math.min(fullHeight - MAP_HEIGHT, Math.round(pixel.y - gridOriginY - MAP_HEIGHT / 2))
  );
  const cropWidth = Math.min(MAP_WIDTH, fullWidth - cropLeft);
  const cropHeight = Math.min(MAP_HEIGHT, fullHeight - cropTop);

  const base = await sharp({
    create: {
      width: fullWidth,
      height: fullHeight,
      channels: 4,
      background: '#E5E7EB',
    },
  })
    .composite([...composites, { input: pinSvg, left: pinLeft, top: pinTop }])
    .png()
    .toBuffer();

  return sharp(base)
    .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
    .resize(MAP_WIDTH, MAP_HEIGHT, { fit: 'cover' })
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function generateMapImageBuffer(lat: number, lng: number): Promise<Buffer | null> {
  try {
    const geoapify = await generateGeoapifyMap(lat, lng);
    if (geoapify) return geoapify;

    const google = await generateGoogleStaticMap(lat, lng);
    if (google) return google;

    return await generateOsmCompositeMap(lat, lng);
  } catch {
    return null;
  }
}

export const CALENDAR_MAP_CID = 'calendar-map@cms';
