export interface MoloniPdfLinkParams {
  h?: string;
  d?: string;
  e?: string;
}

/** Extrai parâmetros do link devolvido por documents/getPDFLink. */
export function parseMoloniPdfLinkParams(linkUrl: string): MoloniPdfLinkParams {
  const url = new URL(linkUrl);
  return {
    h: url.searchParams.get('h') ?? undefined,
    d: url.searchParams.get('d') ?? undefined,
    e: url.searchParams.get('e') ?? undefined,
  };
}

/** URL directa de download (evita a página intermédia «Documento para descarregar»). */
export function buildMoloniDirectPdfUrl(
  portalUrl: string,
  documentId: number,
  companyEmail?: string
): string | null {
  const { h, d, e } = parseMoloniPdfLinkParams(portalUrl);
  if (!h) return null;

  const qs = new URLSearchParams({
    action: 'getDownload',
    h,
    d: d ?? String(documentId),
    i: '1',
    t: 'n',
  });
  const email = e ?? companyEmail;
  if (email) qs.set('e', email);

  return `https://www.moloni.pt/downloads/index.php?${qs.toString()}`;
}

function isPdfBuffer(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).toString('utf8') === '%PDF-';
}

async function tryFetchPdf(url: string): Promise<Buffer | null> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'CMS-Billing/1.0' },
  });
  const contentType = res.headers.get('content-type') ?? '';
  const buf = Buffer.from(await res.arrayBuffer());
  if (contentType.includes('application/pdf') || isPdfBuffer(buf)) {
    return buf;
  }
  return null;
}

function findDownloadUrlInHtml(html: string, pageUrl: string): string | null {
  const patterns = [
    /href=["']([^"']*action=getDownload[^"']*)["']/i,
    /href=["']([^"']*downloads\/index\.php[^"']*)["']/i,
    /(?:window\.location|location\.href)\s*=\s*["']([^"']*getDownload[^"']*)["']/i,
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match?.[1]) {
      return new URL(match[1], pageUrl).toString();
    }
  }
  return null;
}

/**
 * Obtém bytes do PDF a partir do link Moloni (portal ou directo).
 * Tenta primeiro o endpoint getDownload; se falhar, analisa a página intermédia.
 */
export async function fetchMoloniDocumentPdf(
  portalUrl: string,
  documentId: number,
  companyEmail?: string
): Promise<Buffer> {
  const candidates = new Set<string>();

  if (portalUrl.includes('action=getDownload')) {
    candidates.add(portalUrl);
  }

  const direct = buildMoloniDirectPdfUrl(portalUrl, documentId, companyEmail);
  if (direct) candidates.add(direct);

  for (const url of candidates) {
    const pdf = await tryFetchPdf(url);
    if (pdf) return pdf;
  }

  const landingRes = await fetch(portalUrl, {
    redirect: 'follow',
    headers: { 'User-Agent': 'CMS-Billing/1.0' },
  });
  const landingPdf = await tryFetchPdf(landingRes.url);
  if (landingPdf) return landingPdf;

  const html = await landingRes.text();
  const scraped = findDownloadUrlInHtml(html, landingRes.url);
  if (scraped) {
    const pdf = await tryFetchPdf(scraped);
    if (pdf) return pdf;
  }

  throw new Error('O Moloni não devolveu um PDF válido para este documento');
}
