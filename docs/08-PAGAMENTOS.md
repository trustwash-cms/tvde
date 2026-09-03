# 08 — Pagamentos (cálculo semanal)

Documento do módulo **Pagamentos** no TVDE.  
Regra de negócio herdada de [`ficheiros de exemplo/PAYMENT_CALCULATOR.md`](./ficheiros%20de%20exemplo/PAYMENT_CALCULATOR.md) e email/conta corrente em [`AREA_PAGAMENTOS_EMAIL.md`](./ficheiros%20de%20exemplo/AREA_PAGAMENTOS_EMAIL.md).

| Relacionado | |
|-------------|--|
| Roadmap | [`01-ROADMAP_TVDE.md`](./01-ROADMAP_TVDE.md) |
| Uber / Bolt / VV / PRIO | [`06-UBER.md`](./06-UBER.md), Bolt, [`04-VIAVERDE.md`](./04-VIAVERDE.md), [`05-PRIO.md`](./05-PRIO.md) |
| Viaturas / comissão | Users → Matrículas (`UserVehicle`) |
| WhatsApp no confirm | [`10-WHATSAPP_BUSINESS_API.MD`](./10-WHATSAPP_BUSINESS_API.MD) |

---

## 1. Estado (2026-07-19)

| Capacidade | Estado | Notas |
|------------|--------|--------|
| Nav **Pagamentos** | **OK** | `moduleKey=pagamentos` · `/dashboard/pagamentos` |
| Listagem (filtros + tabela) | **OK** | Sobreposição período, pesquisa, estado, método, paginação |
| Detalhe tipo calculadora | **OK** | Ícone olho → mesmas linhas Uber/Bolt/VV/… |
| Pré-visualização cálculo | **OK** | Botão «Calcular pagamento» |
| Gravar `payment_reports` | **OK** | «Confirmar e gravar» / massa |
| Marcar movimentos pagos | **OK** | VV / elec / fuel / Uber / **Bolt** (`is_paid`) |
| Só movimentos em aberto | **OK** | Cálculo filtra `isPaid=false` em todas as fontes |
| Toggle pago / pendente | **OK** | Modal método (MBWAY, TB, CC, NUM) — estado do **relatório** |
| Eliminar relatório | **OK** | Repõe `is_paid=false` nos IDs guardados |
| Conta corrente | Pendente | Coluna pronta; impacto = 0 |
| Bolt «pago a si» | **OK** | Usa `payout_amount` (= `net_earnings` Fleet) |
| Email / anexos / ZIP | Pendente | Botões desactivados na UI |
| PRIO elec vs combustão por viatura | Pendente | Config futura (checkbox / tipo energia) — ver §6 |

---

## 2. Fórmula

\[
\text{resultado} = (\text{Uber} + \text{Bolt}) - (\text{Via Verde} + \text{Eletricidade} + \text{Combustível} + \text{Comissão} + \text{IVA 6\% receitas} + \text{Conta corrente})
\]

Default de intervalo: **última semana completa** segunda→domingo (Europe/Lisbon). Se hoje é domingo, usa a semana que termina hoje; de segunda a sábado, usa a semana anterior (`defaultPaymentWeekRange()`).

| Componente | Fonte | Regra de datas | Em aberto |
|------------|-------|----------------|-----------|
| Uber | `uber_payments.amount` por `uuidUber` | `reportDate` no intervalo | `is_paid=false` |
| Bolt | `bolt_orders.payout_amount` (= `net_earnings`) por `uuidBolt` | `order_created_timestamp` · finished / cancelamentos com líquido | `is_paid=false` |
| Via Verde | `via_verde_movements` | **Sem** filtro de data (matrículas activas hoje) | `is_paid=false` |
| Eletricidade | `electricity_charges` | `chargeDate` no intervalo · cartão/nome | `is_paid=false` |
| Combustível | `fuel_transactions` | `chargeDate` no intervalo · cartão | `is_paid=false` |
| Comissão | `user_vehicles` (`fixa` / `%` / `slot`) | Viaturas activas hoje | — |
| Conta corrente | — | 0 por agora | — |

**Bolt (prioridade):**
1. CSV Fleet «Ganhos por motorista» → `bolt_driver_earnings.net_amount` (Pagamento previsto), se importado para o período.
2. Fallback API: soma `bolt_orders.payout_amount` = **`order_price.net_earnings`** — o mesmo valor que o CSV «Ganhos líquidos» / «Pagamento previsto» (confirmado: Wellington 24–30 ago = 603,07 €).

Não somar `tip` + `toll_fee` ao líquido: no relatório Fleet são colunas de decomposição; o pagamento previsto é só `net_earnings`.

Ao **confirmar** um pagamento: os IDs incluídos no cálculo (VV, elec, fuel, Uber, Bolt) passam a `is_paid=true` e ficam guardados no `payment_reports`. Ao **apagar** o relatório: os mesmos IDs voltam a `is_paid=false` — sem isto o próximo cálculo voltaria a somar (ou a omitir) valores incorrectos.

UUID Uber/Bolt: se o mesmo UUID estiver em várias viaturas, escolhe-se a com **mais dias de sobreposição** com o período (`overlapDays`).

Comissão **fixa** / **%** / **slot** conforme `comissaoTipo` na viatura.  
Checkbox **IVA 6%** (`comissaoIva6`): **não** multiplica a comissão — cria despesas discriminadas `IVA 6% · Uber` e `IVA 6% · Bolt` (6%×receitas de cada plataforma).

---

## 3. API

| Método | Path | Papel |
|--------|------|--------|
| GET | `/pagamentos/drivers` | Motoristas do tenant com ≥1 viatura |
| GET | `/pagamentos/default-range` | Semana anterior Y-m-d |
| GET | `/pagamentos/methods` | Métodos (hardcoded até Settings) |
| GET | `/pagamentos/reports` | Listagem filtrada + paginação |
| GET | `/pagamentos/reports/:id` | Detalhe (linhas + avisos gravados) |
| POST | `/pagamentos/calculate` | Pré-visualização |
| POST | `/pagamentos/confirm` | Grava `payment_reports` + marca IDs pagos |
| PATCH | `/pagamentos/reports/:id/paid` | `{ isPaid, paymentMethod? }` (estado do relatório) |
| DELETE | `/pagamentos/reports/:id` | Apaga + repõe movimentos |

Query `GET /pagamentos/reports`: `periodStart`, `periodEnd` (sobreposição), `search`, `isPaid`, `paymentMethod`, `page`, `perPage` (10/25/50/100).

Módulo: `requireModule('pagamentos')` · calcular/confirmar/pago/delete: `requireRole('admin')`.

Ao confirmar: movimentos Via Verde / eletricidade / combustível / Uber / Bolt incluídos no cálculo passam a `is_paid=true`. O relatório fica `is_paid=false` até marcar pago ao motorista com método.

---

## 4. Ficheiros

| Ficheiro | Papel |
|----------|--------|
| `packages/shared/src/payment-calculator.ts` | Tipos + `defaultPaymentWeekRange` |
| `apps/api/src/services/payment-calculator.service.ts` | Motor de cálculo |
| `apps/api/src/services/payment-report.service.ts` | Persistência + mark/unmark paid |
| `apps/api/src/routes/payment.routes.ts` | Rotas |
| `apps/web/src/components/pagamentos/pagamentos-panel.tsx` | UI listagem + calculadora |
| `apps/web/src/components/pagamentos/sync-pagamentos-modal.tsx` | Sync Uber→Bolt→VV→Prio |
| `apps/web/src/components/pagamentos/mass-pagamentos-modal.tsx` | Geração em massa |
| `apps/web/src/components/pagamentos/portal-quick-login-modal.tsx` | Login rápido em timeout/sessão |
| `apps/web/src/app/dashboard/pagamentos/page.tsx` | Página |
| Migrations | `20260719010000_payment_reports`, `20260719140000_bolt_order_paid_payment_report_ids` |

### Sync plataformas (UX)

Sequência: Uber → Bolt → Via Verde → Prio (frota + electricidade).

- Uber: lista relatórios; se há match no intervalo → escolher último existente ou gerar novo.
- Em erro: **Repetir** sempre. **Login** só se a API indicar sessão expirada / desligada / OTP — **não** em timeout genérico («Timeout Playwright» / poll). Se fosse falta de login, o sync Via Verde falha cedo (`expired`), não após 5 minutos.
- Se o portal já está em **`awaiting_otp`** (ex. MyPRIO SMS): **Login** abre o modal do código OTP, sem criar outro job de connect.
- Se há **password guardada** (`hasPassword`): **Login** oferece **Continuar** sem digitar; opções **Introduzir outra password** e **Esquecer password**. **Desligar** remove password + sessão; **Esquecer** remove só a password.
- Contas portal: botão **Limpar** remove avisos persistentes sem desligar.
- Confirmações destrutivas (eliminar pagamento, marcar pendente) usam **`ConfirmDialog`** da app — nunca `window.confirm`.

### Paginação (plataformas)

| Módulo | Página |
|--------|--------|
| Uber pagamentos | 50 |
| Bolt pedidos / motoristas / veículos | 50 |
| Via Verde / Eletricidade / Combustível | 50 |

---

## 5. Próximos passos

1. [x] Persistir `payment_reports` + marcar VV/elec/fuel/uber/bolt pagos
2. [x] Listagem + detalhe tipo calculadora
3. [ ] Conta corrente (`driver_expenses`)
4. [x] Receita Bolt via `bolt_orders.ride_price` (sem «pago a si»)
5. [ ] Email HTML + comprovativos + ZIP
6. [ ] Métodos de pagamento em Settings (substituir hardcoded)
7. [ ] PRIO: tipo energia por viatura (só elec / só combustível / ambos)

---

## 6. PRIO — electricidade vs combustão (mais tarde)

Hoje o cálculo usa o **mesmo cartão PRIO** (`numCartaoPrio`) / nome para eletricidade **e** combustível. Na prática:

- quem só tem eléctrico não deveria «apanhar» frota combustível (e vice-versa);
- quem tem os dois precisa dos dois.

**Proposta (não implementada):** em Settings TVDE / viatura, checkbox ou enum `prioEnergy: electric | fuel | both` (ou flags `incluirEletricidade` / `incluirCombustivel`) e o calculador só consulta a tabela correspondente.

---

*Actualizado 2026-07-22 — reutilizar password guardada no Login; Esquecer password; ConfirmDialog.*
