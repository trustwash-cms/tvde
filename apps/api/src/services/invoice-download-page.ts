/** Página HTML de download — o PDF só é pedido ao clicar (refresh não conta). */
export function renderInvoiceDownloadPage(input: {
  token: string;
  apiPrefix: string;
  remainingDownloads: number;
  maxDownloads: number;
  /** Se definido, usa este path em vez de /invoices/public/download */
  downloadPathOverride?: string;
  /** Esconde o contador de downloads (ex. links admin-mgmt sem limite). */
  hideDownloadLimits?: boolean;
}): string {
  const safeToken = input.token.replace(/[^a-f0-9]/gi, '');
  const prefix = input.apiPrefix.replace(/\/$/, '');
  const downloadPath =
    input.downloadPathOverride ??
    `${prefix}/invoices/public/download?token=${encodeURIComponent(safeToken)}`;
  const remaining = Math.max(0, input.remainingDownloads);
  const max = Math.max(1, input.maxDownloads);
  const canDownload = remaining > 0;
  const hideLimits = Boolean(input.hideDownloadLimits);

  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${canDownload ? 'Descarregar fatura' : 'Limite de downloads atingido'}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f1f5f9; color: #0f172a; margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1rem; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 2rem; max-width: 420px; text-align: center; width: 100%; box-sizing: border-box; }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: #534AB7; color: #fff; font-size: 14px; font-weight: 500; padding: 12px 28px; border-radius: 8px; text-decoration: none; border: none; cursor: pointer; }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn-secondary { background: #fff; color: #534AB7; border: 1px solid #c4b5fd; margin-top: 0.75rem; }
    .spinner { width: 28px; height: 28px; border: 3px solid #e2e8f0; border-top-color: #534AB7; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error { color: #b91c1c; font-size: 14px; line-height: 1.5; }
    .muted { color: #64748b; font-size: 13px; margin-top: 0.75rem; line-height: 1.5; }
    .limit { color: #92400e; font-size: 14px; line-height: 1.5; }
    h1 { font-size: 1.15rem; font-weight: 600; margin: 0 0 0.75rem; }
  </style>
</head>
<body>
  <div class="card">
    <div id="ready" ${canDownload ? '' : 'hidden'}>
      <h1>Descarregar fatura</h1>
      <p class="muted" style="margin-top:0">Clique no botão para obter o PDF. Recarregar esta página <strong>não</strong> inicia o download.</p>
      ${hideLimits ? '' : `<p class="muted">Downloads restantes: <strong id="remaining">${remaining}</strong> de ${max}</p>`}
      <button type="button" class="btn" id="download-btn">↓ Descarregar fatura</button>
    </div>
    <div id="loading" hidden>
      <div class="spinner" aria-hidden="true"></div>
      <p>A preparar o download da fatura…</p>
    </div>
    <div id="done" hidden>
      <p>Download iniciado.</p>
      <p class="muted">${
        hideLimits
          ? 'Pode fechar esta página.'
          : `Pode fechar esta página. Downloads restantes: <strong id="remaining-after">—</strong> de ${max}`
      }</p>
      <button type="button" class="btn btn-secondary" id="download-again" hidden>Descarregar novamente</button>
    </div>
    <div id="limit" ${canDownload ? 'hidden' : ''}>
      <h1>Limite de downloads atingido</h1>
      <p class="limit">Este link já foi utilizado o número máximo de vezes (${max} downloads). Por segurança, o PDF deixou de estar disponível neste endereço.</p>
      <p class="muted">Peça uma nova cópia à empresa emissora.</p>
    </div>
    <div id="error" hidden>
      <p class="error" id="error-text"></p>
      <p class="muted">Se o link expirou (90 dias) ou o limite foi atingido, peça uma nova cópia à empresa emissora.</p>
    </div>
  </div>
  <script>
    (function () {
      var downloadUrl = ${JSON.stringify(downloadPath)};
      var remaining = ${remaining};
      var maxDownloads = ${max};
      var ready = document.getElementById('ready');
      var loading = document.getElementById('loading');
      var done = document.getElementById('done');
      var limitBox = document.getElementById('limit');
      var errorBox = document.getElementById('error');
      var errorText = document.getElementById('error-text');
      var downloadBtn = document.getElementById('download-btn');
      var downloadAgain = document.getElementById('download-again');
      var remainingEl = document.getElementById('remaining');
      var remainingAfter = document.getElementById('remaining-after');

      function showLimit() {
        ready.hidden = true;
        loading.hidden = true;
        done.hidden = true;
        errorBox.hidden = true;
        limitBox.hidden = false;
      }

      function showError(msg) {
        ready.hidden = true;
        loading.hidden = true;
        done.hidden = true;
        limitBox.hidden = true;
        errorBox.hidden = false;
        errorText.textContent = msg || 'Não foi possível descarregar a fatura.';
      }

      function startDownload() {
        if (remaining <= 0) {
          showLimit();
          return;
        }
        ready.hidden = true;
        done.hidden = true;
        errorBox.hidden = true;
        limitBox.hidden = true;
        loading.hidden = false;
        if (downloadBtn) downloadBtn.disabled = true;

        fetch(downloadUrl, {
          headers: { 'ngrok-skip-browser-warning': '1' },
        })
          .then(function (res) {
            if (res.status === 429 || res.status === 403) {
              return res.text().then(function (msg) {
                remaining = 0;
                showLimit();
                if (msg) errorText.textContent = msg;
                throw new Error('LIMIT');
              });
            }
            if (!res.ok) {
              return res.text().then(function (msg) {
                throw new Error(msg || 'Download indisponível');
              });
            }
            var leftHeader = res.headers.get('X-Downloads-Remaining');
            if (leftHeader != null && leftHeader !== '') {
              remaining = Math.max(0, parseInt(leftHeader, 10) || 0);
            } else {
              remaining = Math.max(0, remaining - 1);
            }
            var disposition = res.headers.get('Content-Disposition') || '';
            var match = /filename="([^"]+)"/i.exec(disposition);
            var filename = match ? match[1] : 'fatura.pdf';
            return res.blob().then(function (blob) {
              var url = URL.createObjectURL(blob);
              var a = document.createElement('a');
              a.href = url;
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
              loading.hidden = true;
              done.hidden = false;
              if (remainingAfter) remainingAfter.textContent = String(remaining);
              if (remainingEl) remainingEl.textContent = String(remaining);
              if (remaining > 0) {
                downloadAgain.hidden = false;
              } else {
                downloadAgain.hidden = true;
              }
            });
          })
          .catch(function (err) {
            if (err && err.message === 'LIMIT') return;
            loading.hidden = true;
            if (remaining > 0) {
              ready.hidden = false;
              if (downloadBtn) downloadBtn.disabled = false;
            }
            showError(err && err.message ? err.message : 'Não foi possível descarregar a fatura.');
          });
      }

      if (downloadBtn) downloadBtn.addEventListener('click', startDownload);
      if (downloadAgain) downloadAgain.addEventListener('click', startDownload);
    })();
  </script>
</body>
</html>`;
}

export function renderInvoiceDownloadLimitPage(maxDownloads: number): string {
  const max = Math.max(1, maxDownloads);
  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Limite de downloads atingido</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f1f5f9; color: #0f172a; margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1rem; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 2rem; max-width: 420px; text-align: center; }
    .limit { color: #92400e; font-size: 14px; line-height: 1.5; }
    .muted { color: #64748b; font-size: 13px; margin-top: 0.75rem; line-height: 1.5; }
    h1 { font-size: 1.15rem; font-weight: 600; margin: 0 0 0.75rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Limite de downloads atingido</h1>
    <p class="limit">Este link já foi utilizado o número máximo de vezes (${max} downloads). Por segurança, o PDF deixou de estar disponível neste endereço.</p>
    <p class="muted">Peça uma nova cópia à empresa emissora.</p>
  </div>
</body>
</html>`;
}
