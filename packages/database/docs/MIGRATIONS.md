# Migrations Prisma — regras de segurança

## Ordem e dependências

1. **Nunca** fazer `ALTER TABLE` numa tabela que ainda não existe na mesma cadeia de migrations.
2. Se o módulo **cria** tabelas numa migration `20250625100000_*`, colunas extra desse módulo devem ir numa migration com **timestamp posterior** (ex. `20250625110000_*`), não numa data anterior.
3. Migrations **só aditivas** em produção: `CREATE`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. Sem `DROP`, `TRUNCATE` ou `RESET`.

## Nunca marcar como aplicada sem SQL

- **Proibido** em produção: `prisma migrate resolve --applied` para "saltar" uma migration que falhou, excepto casos documentados e com SQL manual já aplicado.
- O script `prisma-migrate-safe.sh` **não** resolve automaticamente migrations desconhecidas — o deploy deve **parar** e ser corrigido manualmente.

## Verificação automática

Após cada `migrate deploy` (local, VPS, CI), corre:

```bash
bash scripts/deploy/verify-schema.sh
```

O deploy (`deploy-release.sh`) chama isto automaticamente. Se faltar uma coluna/tabela que o código espera, o deploy **falha** antes do build.

Ao adicionar módulos críticos, actualizar `packages/database/prisma/schema-invariants.sql`.

## Drift (Prisma diz "up to date" mas falta coluna)

1. Diagnosticar: `bash scripts/deploy/verify-schema.sh`
2. Aplicar SQL incremental (`ADD COLUMN IF NOT EXISTS`, etc.)
3. Criar migration de reparação idempotente com o mesmo SQL para outros ambientes
4. **Não** usar `migrate reset`

## Comandos

| Ambiente | Comando |
|----------|---------|
| Produção / VPS | `npx prisma migrate deploy --schema=packages/database/prisma/schema.prisma` |
| Verificar | `bash scripts/deploy/verify-schema.sh` |
| Estado | `npx prisma migrate status --schema=packages/database/prisma/schema.prisma` |
