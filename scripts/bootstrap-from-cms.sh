#!/usr/bin/env bash
# Bootstrap TVDE project from CMS — independent copy, no runtime dependency on cms/
set -euo pipefail

CMS_ROOT="${CMS_ROOT:-/Applications/XAMPP/xamppfiles/htdocs/cms}"
TVDE_ROOT="${TVDE_ROOT:-/Applications/XAMPP/xamppfiles/htdocs/tvde}"

echo "==> Bootstrap TVDE from CMS"
echo "    CMS:  $CMS_ROOT"
echo "    TVDE: $TVDE_ROOT"

mkdir -p "$TVDE_ROOT"

RSYNC_EXCLUDES=(
  --exclude node_modules
  --exclude .next
  --exclude dist
  --exclude .git
  --exclude uploads
  --exclude backups
  --exclude .cursor
  --exclude loja
  --exclude apps/whatsapp-bridge
  --exclude packages/ecommerce
  --exclude packages/woocommerce
  --exclude packages/shopify
  --exclude packages/stripe
  --exclude packages/correos-express
)

# Root configs
for f in .gitignore tsconfig.json; do
  if [[ -f "$CMS_ROOT/$f" ]]; then
    cp "$CMS_ROOT/$f" "$TVDE_ROOT/$f"
  fi
done

# Apps
mkdir -p "$TVDE_ROOT/apps"
rsync -a "${RSYNC_EXCLUDES[@]}" "$CMS_ROOT/apps/api/" "$TVDE_ROOT/apps/api/"
rsync -a "${RSYNC_EXCLUDES[@]}" "$CMS_ROOT/apps/web/" "$TVDE_ROOT/apps/web/"

# Packages (only needed ones)
mkdir -p "$TVDE_ROOT/packages"
for pkg in database shared billing; do
  rsync -a "${RSYNC_EXCLUDES[@]}" "$CMS_ROOT/packages/$pkg/" "$TVDE_ROOT/packages/$pkg/"
done

# Docs (core only)
mkdir -p "$TVDE_ROOT/docs"
for doc in 06-seguranca-multitenancy.md 11-permissoes-roles-modulos.md 12-calendario.md 22-gestao-administrativa.md; do
  if [[ -f "$CMS_ROOT/docs/$doc" ]]; then
    cp "$CMS_ROOT/docs/$doc" "$TVDE_ROOT/docs/$doc"
  fi
done

# Billing docs
if [[ -d "$CMS_ROOT/packages/billing/docs" ]]; then
  mkdir -p "$TVDE_ROOT/packages/billing/docs"
  cp -R "$CMS_ROOT/packages/billing/docs/"* "$TVDE_ROOT/packages/billing/docs/" 2>/dev/null || true
fi

# Replace @cms -> @tvde and cms -> tvde in package names
if command -v rg &>/dev/null; then
  rg -l '@tvde/' "$TVDE_ROOT" --glob '!node_modules' --glob '!.next' --glob '!dist' 2>/dev/null | while read -r f; do
    sed -i '' 's/@cms\//@tvde\//g' "$f"
  done
  rg -l '"cms"' "$TVDE_ROOT" --glob 'package.json' 2>/dev/null | while read -r f; do
    sed -i '' 's/"name": "cms"/"name": "tvde"/' "$f"
  done
else
  find "$TVDE_ROOT" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.json' -o -name '*.mjs' -o -name '*.js' -o -name '*.md' \) \
    ! -path '*/node_modules/*' ! -path '*/.next/*' ! -path '*/dist/*' -print0 \
    | while IFS= read -r -d '' f; do
      if grep -q '@tvde/' "$f" 2>/dev/null; then
        sed -i '' 's/@cms\//@tvde\//g' "$f"
      fi
    done
fi

echo "==> Bootstrap copy complete"
