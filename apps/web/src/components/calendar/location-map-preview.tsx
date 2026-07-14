'use client';

import { useEffect, useState } from 'react';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { calendarMapPreviewUrl } from '@/lib/calendar-map-preview-url';
import { parseLocation } from '@/components/calendar/calendar-location';

interface MapPreview {
  mapsUrl: string;
  previewImageUrl: string;
}

export function LocationMapPreview({ location }: { location: string }) {
  const parsed = parseLocation(location);
  const [map, setMap] = useState<MapPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageError(false);

    if (parsed.kind === 'empty' || parsed.kind === 'url') {
      setMap(null);
      setLoading(false);
      return;
    }

    if (parsed.kind === 'coordinates') {
      const m = parsed.raw.match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
      if (!m) {
        setMap(null);
        return;
      }
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      setMap({
        mapsUrl: parsed.mapsUrl!,
        previewImageUrl: calendarMapPreviewUrl(lat, lng),
      });
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = window.setTimeout(() => {
      apiFetch<{
        lat: number;
        lng: number;
        mapsUrl: string;
      } | null>(
        `${API_PATHS.calendar.geocode}?${new URLSearchParams({ address: parsed.raw })}`,
        {},
        getStoredToken()
      )
        .then((res) => {
          if (res.data) {
            setMap({
              mapsUrl: res.data.mapsUrl,
              previewImageUrl: calendarMapPreviewUrl(res.data.lat, res.data.lng),
            });
          } else {
            setMap(null);
          }
        })
        .finally(() => setLoading(false));
    }, 500);

    return () => window.clearTimeout(timer);
  }, [location, parsed.kind, parsed.raw, parsed.mapsUrl]);

  if (loading) {
    return <p className="mt-2 text-xs text-slate-500">A carregar mapa…</p>;
  }

  if (!map) return null;

  if (imageError) {
    return (
      <a
        href={map.mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block text-xs font-medium text-[var(--color-primary)] hover:underline"
      >
        Abrir morada no mapa
      </a>
    );
  }

  return (
    <a
      href={map.mapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 block overflow-hidden rounded-lg border border-slate-200"
      title="Abrir no mapa"
    >
      <img
        src={map.previewImageUrl}
        alt="Pré-visualização do mapa"
        className="block h-32 w-full object-cover"
        loading="lazy"
        onError={() => setImageError(true)}
      />
    </a>
  );
}
