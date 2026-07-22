# 05 — MyPRIO (Prio Electric + Frota)

Documento de referência do portal **MyPRIO** no TVDE (login + 2FA SMS + sync).  
Complementa [`03-PORTAL_RPA.md`](./03-PORTAL_RPA.md).

| Ficheiro exemplo | Uso |
|------------------|-----|
| `docs/ficheiros de exemplo/Transacoes_Eletrico_PRIO_exemplo.xlsx` | Import manual Electric |
| `docs/ficheiros de exemplo/Transacoes_Frota_PRIO_exemplo.xlsx` | Import manual Combustível |

---

## Estado confirmado (2026-07-16)

| Capacidade | Estado | Notas |
|------------|--------|--------|
| Ligar conta (login + SMS OTP) | **OK** | Host `www.myprio.com` · `61***71` |
| OTP no sync **Pagamentos** | **OK** | `portal-quick-login-modal` abre OTP se `awaiting_otp` |
| Sessão / Desligar | **OK** | Desligar limpa cookies → SMS novo |
| **Sincronizar Combustível** | **OK · scrape DOM** | 23:30 — `1 inseridos, 3 ignorados` (**sem Excel portal**) |
| **Sincronizar Electric** | **OK · scrape DOM** | Mesma abordagem que Frota (Excel = fallback) |
| UI Eletricidade | **OK** | Sem Matrícula · coluna **Total** |
| Import manual | **OK** | Electric ignora `MATRÍCULA`; Frota datas MDY no XLSX |

---

## 1. O que sincroniza

| Destino TVDE | Fonte MyPRIO | URL |
|--------------|--------------|-----|
| **Eletricidade** | Transações Electric | `…/Transactions?TradIsElectric=True` |
| **Combustível** | Transações Frota | `…/Transactions/Transactions` |

Uma conta MyPRIO (`portal=myprio`) alimenta os dois. Host **só `www.myprio.com`** (apex = cert inválido → `chrome-error`).

---

## 2. Ligar conta (login + OTP)

Ver detalhe histórico na implementação `myprio.adapter.ts`. Resumo:

1. Login Reactive: user text + password → **INICIAR SESSÃO**
2. OTP: 6× `input[type=number]` ~157px · sem Confirmar · toast «Código validado…»
3. Esperar Home / `SESSION_USER_ID` ≠ 0 → gravar `storageState`
4. **Desligar** apaga sessão; Ligar de novo = SMS

### 2.1 Manter sessão activa (limites MyPRIO)

Infra partilhada: [`03-PORTAL_RPA.md` → Manter sessões activas](./03-PORTAL_RPA.md#manter-sessões-activas-keep-alive).

| Capacidade | MyPRIO |
|------------|--------|
| Refresh cookies a cada 3h (default) | **Sim** — enquanto a sessão no portal ainda for válida |
| Gravar cookies renovados após refresh | **Sim** |
| Re-login automático se expirar | **Não** — o portal exige OTP SMS |
| Estado quando cookies morrem | `expired` · mensagem «Sessão expirada» |
| Acção do gestor | **Ligar conta** → password (se pedida) → código SMS |

Não é realista prometer **15 dias sem OTP**. O keep-alive só **atrasa** a expiração; quando o MyPRIO invalida cookies, é preciso SMS outra vez. A API tem de estar **sempre a correr** (`PORTAL_RPA_REFRESH_INTERVAL_HOURS`).

---

## 3. Abordagem de sync: scrape DOM (Electric + Frota)

O menu **Exportar** do portal muitas vezes **não expõe** o item `.XLS` ao Playwright  
(`near=[Exportar | Exportar | …]`).  

**Solução confirmada no Combustível e aplicada ao Electric:** ler a **grelha HTML** + paginação.

```
Sincronizar (electric | fleet)
  → Home → URL Transações → datas (15 dias) → Pesquisar
  → scrapeTransactionsToXlsx  ← preferido (grelha + páginas)
  → (fallback) Exportar Excel portal
  → ingest → electricity.ts | combustivel.ts
```

Funções: `scrapeTransactionsToXlsx` · `extractTransactionsTablePage` · `goToTransactionsTablePage`  
em `apps/api/src/services/portal-rpa/myprio.adapter.ts`.

Logs típicos:
```
[myprio-sync] fleet|electric dom-scrape:page=1 rows=20 total=20
[myprio-sync] fleet|electric dom-scrape:ok rows=44 bytes=…
```

---

## 4. Combustível / Frota (documentado + confirmado)

| | |
|--|--|
| Botão | **Sincronizar Combustível** |
| `syncScope` | `fleet` |
| Resultado real | `Combustível: 1 inseridos, 3 ignorados` (16/07/2026 23:30) |

### 4.1 Colunas lidas da grelha

`POSTO · DATA · HORA · CARTÃO · DESC. CARTÃO · LITROS · COMBUSTÍVEL · RECIBO · TOTAL`

- Cartão UI: `7824…0000 DaciaBV` → número + descrição  
- Datas UI **DD/MM/AAAA** → ISO no scrape (evita bug MM/DD do Excel)  
- Ficheiro interno: `Transacoes_Frota_DOM.xlsx`

### 4.2 Datas no import manual Excel Frota

Se importar XLSX do portal à mão: células podem vir `7/16/26` (US).  
Parser: `order: 'mdy'` + XLSX `raw:true` → calendário local.

UI TVDE: `dd/mm/aaaa, HH:mm`.

### 4.3 Fallback

Import manual `Transacoes_Frota_PRIO_exemplo.xlsx`.

---

## 5. Electric (mesma abordagem DOM)

| | |
|--|--|
| Botão | **Sincronizar Electric** |
| `syncScope` | `electric` |
| URL | `?TradIsElectric=True` |

### 5.1 Colunas lidas da grelha → XLSX interno

`DATA · Nº. CARTÃO · NOME · ID CARREGAMENTO · P. CARREGAMENTO (= posto) · ENERGIA · DURAÇÃO · TOTAL c/ IVA`

- Header UI **«P. CARREGAMENTO»** → campo `station` / coluna POSTO no XLSX interno  
- Sem matrícula  
- Ficheiro interno: `Transacoes_Eletrico_DOM.xlsx`  
- Ingest: `parseElectricityRows`

### 5.2 UI TVDE Eletricidade

**Data · Nome · Nº cartão · Posto · Energia · Duração · Total · Pago · Ações**

### 5.3 Fallback

Import manual `Transacoes_Eletrico_PRIO_exemplo.xlsx`.

---

## 6. Área autenticada (portal)

| Página | URL |
|--------|-----|
| Home | `/MyPrio/HomePage.aspx` |
| Frota | `/Transactions/Transactions` |
| Electric | `/Transactions/Transactions?TradIsElectric=True` |

Pesquisa RPA: **últimos 15 dias** → Pesquisar.

---

## 7. Ficheiros

| Ficheiro | Papel |
|----------|--------|
| `myprio.adapter.ts` | Login, OTP, **scrape DOM** Electric+Frota, Excel fallback |
| `portal-connection.service.ts` | Jobs, sessão, timeouts |
| `portal-connection-panel.tsx` | Ligar / SMS / Sync |
| `electricity-panel.tsx` / `combustivel-panel.tsx` | UI |
| `ingest.service.ts` | Detecta electric vs fuel |
| `electricity.ts` / `combustivel.ts` | Parsers |

---

## 8. Checklist

1. Conta **Ligado**  
2. **Sincronizar Combustível** → `fleet dom-scrape:ok` + inseridos/ignorados  
3. **Sincronizar Electric** → `electric dom-scrape:ok`  
4. Re-sync → sobretudo duplicados  
5. Import manual XLSX se scrape falhar  

---

## 9. Problemas / resolvidos

| Sintoma | Causa | Acção |
|---------|--------|--------|
| Exportar sem `.XLS` no RPA | Menu OutSystems | **Scrape DOM** (ambos) |
| Datas Frota «futuro» | Excel MM/DD | DOM ISO + parser mdy no XLSX |
| Matrícula Electric | Vazia no portal | Fora da UI + ignore import |
| OTP / chrome-error / sessão | Ver histórico | www only; OTP 6 dígitos; Desligar→Ligar |
| Sessão expirada de manhã | Cookies mortos / API parada de noite | Ligar + OTP; keep-alive 24/7 em prod |

---

*Actualizado 2026-07-17 — keep-alive / refresh 3h documentado; Combustível+Electric DOM.*
