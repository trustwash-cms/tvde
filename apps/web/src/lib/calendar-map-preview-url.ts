/** Proxy same-origin — funciona em dev, ngrok e produção sem expor localhost no browser. */
export function calendarMapPreviewUrl(lat: number, lng: number): string {
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  return `/api/calendar/map-preview?${params}`;
}
