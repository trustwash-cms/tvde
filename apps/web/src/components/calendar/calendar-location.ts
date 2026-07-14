export type LocationKind = 'empty' | 'address' | 'url' | 'coordinates';

export interface ParsedLocation {
  kind: LocationKind;
  raw: string;
  mapsUrl: string | null;
  displayLabel: string;
}

const URL_RE = /^https?:\/\//i;
const COORDS_RE = /^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/;

export function parseLocation(value: string): ParsedLocation {
  const raw = value.trim();
  if (!raw) {
    return { kind: 'empty', raw: '', mapsUrl: null, displayLabel: '' };
  }

  if (URL_RE.test(raw)) {
    return {
      kind: 'url',
      raw,
      mapsUrl: raw,
      displayLabel: 'Link de videochamada',
    };
  }

  const coordMatch = raw.match(COORDS_RE);
  if (coordMatch) {
    const lat = coordMatch[1];
    const lng = coordMatch[2];
    return {
      kind: 'coordinates',
      raw,
      mapsUrl: `https://www.google.com/maps?q=${lat},${lng}`,
      displayLabel: `Coordenadas: ${lat}, ${lng}`,
    };
  }

  return {
    kind: 'address',
    raw,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(raw)}`,
    displayLabel: 'Morada',
  };
}
