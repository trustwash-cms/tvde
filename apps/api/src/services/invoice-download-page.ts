/** Página HTML que descarrega o PDF via fetch (contorna aviso ngrok free no browser). */
export function renderInvoiceDownloadPage(token: string, apiPrefix: string): string {
  const safeToken = token.replace(/[^a-f0-9]/gi, '');
  const prefix = apiPrefix.replace(/\/$/, '');
  const downloadPath = `${prefix}/invoices/public/download?token=${encodeURIComponent(safeToken)}`;

  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>A descarregar fatura…</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f1f5f9; color: #0f172a; margin: 0; min-height: 100vh; display: grid; place-items: center; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 2rem; max-width: 420px; text-align: center; }
    .spinner { width: 28px; height: 28px; border: 3px solid #e2e8f0; border-top-color: #534AB7; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error { color: #b91c1c; font-size: 14px; line-height: 1.5; }
    .muted { color: #64748b; font-size: 13px; margin-top: 0.75rem; }
  </style>
</head>
<body>
  <div class="card">
    <div id="loading">
      <div class="spinner" aria-hidden="true"></div>
      <p>A preparar o download da fatura…</p>
    </div>
    <div id="error" hidden>
      <p class="error" id="error-text"></p>
      <p class="muted">Se o link expirou (90 dias), peça uma nova cópia à empresa emissora.</p>
    </div>
  </div>
  <script>
    (function () {
      var downloadUrl = ${JSON.stringify(downloadPath)};
      var loading = document.getElementById('loading');
      var errorBox = document.getElementById('error');
      var errorText = document.getElementById('error-text');

      fetch(downloadUrl, {
        headers: { 'ngrok-skip-browser-warning': '1' },
      })
        .then(function (res) {
          if (!res.ok) {
            return res.text().then(function (msg) {
              throw new Error(msg || 'Download indisponível');
            });
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
            loading.innerHTML = '<p>Download iniciado.</p><p class="muted">Pode fechar esta página.</p>';
          });
        })
        .catch(function (err) {
          loading.hidden = true;
          errorBox.hidden = false;
          errorText.textContent = err && err.message ? err.message : 'Não foi possível descarregar a fatura.';
        });
    })();
  </script>
</body>
</html>`;
}
