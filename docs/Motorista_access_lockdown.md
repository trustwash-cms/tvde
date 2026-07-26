Acesso Motorista (admin) — lockdown + dashboard pessoal

Problema

DASHBOARD_ACCESS trata Motorista ≈ Staff (minRole: staff / admin em users). Com módulos activos no workspace, o motorista vê Utilizadores, Pagamentos completo, Gestão Admin, Facturação, Config (Geral/Audit), etc. As APIs (admin-mgmt, bolt reads, pagamentos) quase não têm floor de role — só módulo+tenant.

Menu Motorista (alvo)

Alinhado à outra app + o que pediste:







Área



Motorista





Dashboard



Sim — cards pessoais (sem grelha de módulos; sem pesquisa global)





Uber / Bolt



Sim — só dados do seu UUID (UserVehicle.uuidUber / uuidBolt)





Via Verde / Eletricidade / Combustível



Sim — só viaturas/cartões associados a si





Meus Pagamentos



Sim — só payment_reports do userId (sem sync/calculadora/massa)





Calendário



Sim





Meu Perfil (+ docs pessoais + foto)



Sim





Utilizadores / Gestão Admin / Facturação / Configurações



Não (Facturação volta depois com recibo verde)

Staff mantém-se como está (fora deste plano), salvo partilhar helpers de scope se útil.

1. Permissões partilhadas

Em [packages/shared/src/permissions.ts](packages/shared/src/permissions.ts):





Subir floors: users, admin_mgmt, billing, settings, audit, pagamentos (gestão) → **superadmin**



Manter para motorista (admin): dashboard, bolt, uber, via_verde, eletricidade, combustivel, calendar



Novo helper isDriverRole(role) e canAccessDriverSelfService



Novo area meus_pagamentos ou reutilizar pagamentos com flag driverSelfOnly no shell

Actualizar [dashboard-shell.tsx](apps/web/src/app/dashboard/dashboard-shell.tsx) + [settings-sub-nav.tsx](apps/web/src/components/settings/settings-sub-nav.tsx) + [dashboard-module-cards.tsx](apps/web/src/components/dashboard-module-cards.tsx) para esconder o que o floor já bloqueia.

2. Shell: branding motorista + foto

Em [dashboard-shell.tsx](apps/web/src/app/dashboard/dashboard-shell.tsx):





Se role === 'admin': topo mostra foto + fullName/username (não logo/nome da empresa)



Esconder pesquisa global para motorista



Footer perfil: avatar em vez de só iniciais

Schema: User.avatarUrl (ou UserProfile.avatarStorageKey) + upload em uploads/avatars/{userId}
API: POST/DELETE /users/me/avatar em [user-profile.routes.ts](apps/api/src/routes/user-profile.routes.ts)
UI: botão «Alterar foto» no Meu Perfil (como a outra app) + uso no shell

3. Dashboard motorista

Novo ramo em [apps/web/src/app/dashboard/page.tsx](apps/web/src/app/dashboard/page.tsx) (ou componente driver-dashboard.tsx):





Banner «Bem-vindo, {nome}»



Cards semana: Uber / Bolt / Via Verde / Eletricidade (totais do próprio) + link «Ver detalhes»



Sem grelha de módulos; calendário «próximos eventos» pode ficar



Endpoint agregado leve GET /dashboard/driver-summary (ou reutilizar lists filtradas)

4. Scope de dados (API — crítico)

Helper getDriverScope(db, userId) → placas, uuidUber[], uuidBolt[], cartões Prio das UserVehicle activas.







Módulo



Filtro motorista





Uber



driverUuid IN uuidUber (+ userId)





Bolt orders



motorista Bolt UUID match uuidBolt





Via Verde / Elec / Fuel



userId ou placas/cartões do scope





Pagamentos



paymentReports.userId = me; bloquear calculate/confirm/sync/delete para admin





Users / admin-mgmt / billing writes



requireRole('superadmin')





Audit / settings gerais



requireRole('superadmin') (ou master)

Rotas a endurecer: [business.routes.ts](apps/api/src/routes/business.routes.ts), [admin-mgmt.routes.ts](apps/api/src/routes/admin-mgmt.routes.ts), [payment.routes.ts](apps/api/src/routes/payment.routes.ts), [bolt.routes.ts](apps/api/src/routes/bolt.routes.ts), uber/via-verde/electricity/combustivel list endpoints.

UI Bolt/Uber/VV/etc.: se motorista, esconder sync/import/admin actions; listas já vêm filtradas pela API.

5. Meus Pagamentos





Nav label «Meus Pagamentos» → página read-only (lista dos seus reports + detalhe)



Não montar [pagamentos-panel](apps/web/src/components/pagamentos/pagamentos-panel.tsx) completo (calculadora/sync)

6. Documentos de viatura (fora de v1)

Menu «Documentos» da outra app (Carta Verde, inspeção…) fica adiado — no Meu Perfil mantêm-se documentos pessoais do motorista (já filtrados).

Ordem de implementação

flowchart TD
  perms[permissions + nav floors]
  api[API requireRole + driver scope]
  avatar[avatar schema + upload]
  shell[shell branding + hide search]
  dash[driver dashboard]
  pay[Meus Pagamentos UI]
  perms --> api
  perms --> shell
  avatar --> shell
  api --> dash
  api --> pay

Fora de âmbito agora





Redesign visual dark sidebar da outra app



Facturação / recibo verde para motorista



Documentos de viatura partilhados



Alterar hierarquia staff

