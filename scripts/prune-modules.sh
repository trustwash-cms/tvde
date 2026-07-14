#!/usr/bin/env bash
# Remove modules not needed in TVDE (ecommerce, carwash, stripe, etc.)
set -euo pipefail

TVDE="${TVDE_ROOT:-/Applications/XAMPP/xamppfiles/htdocs/tvde}"
cd "$TVDE"

echo "==> Pruning TVDE modules..."

# API routes & services to remove
rm -f apps/api/src/routes/ecommerce.routes.ts
rm -f apps/api/src/routes/ecommerce-email-cron.routes.ts
rm -f apps/api/src/routes/woocommerce.routes.ts
rm -f apps/api/src/routes/shopify.routes.ts
rm -f apps/api/src/routes/stripe.routes.ts
rm -f apps/api/src/routes/stripe-webhook.routes.ts
rm -f apps/api/src/routes/correos-express.routes.ts
rm -f apps/api/src/routes/bookings.routes.ts
rm -f apps/api/src/routes/carwash.routes.ts
rm -f apps/api/src/routes/carwash-public.routes.ts

# API services - ecommerce
rm -rf apps/api/src/services/ecommerce-*.ts
rm -rf apps/api/src/services/arc-email
rm -rf apps/api/src/services/gift-email
rm -rf apps/api/src/services/rappod-email
rm -rf apps/api/src/services/woocommerce-*.ts
rm -rf apps/api/src/services/shopify-*.ts
rm -rf apps/api/src/services/stripe-*.ts
rm -rf apps/api/src/services/correos-express-*.ts
rm -rf apps/api/src/services/carwash-*.ts
rm -rf apps/api/src/services/bookings
rm -rf apps/api/src/services/storefront-email.service.ts
rm -rf apps/api/src/services/store-shipping-carrier.service.ts
rm -rf apps/api/src/services/whatsapp-bridge.client.ts
rm -rf apps/api/src/workers
rm -f apps/api/src/lib/ecommerce-customer-auth.ts
rm -f apps/api/scripts/import-woo-to-ecommerce.ts

# Web dashboard pages - remove module sections
rm -rf apps/web/src/app/dashboard/ecommerce
rm -rf apps/web/src/app/dashboard/woocommerce
rm -rf apps/web/src/app/dashboard/shopify
rm -rf apps/web/src/app/dashboard/stripe
rm -rf apps/web/src/app/dashboard/bookings
rm -rf apps/web/src/app/dashboard/carwash
rm -rf apps/web/src/app/bookings
rm -rf apps/web/src/app/carwash
rm -rf apps/web/src/app/dashboard/settings/ecommerce
rm -rf apps/web/src/app/dashboard/settings/stripe
rm -rf apps/web/src/app/dashboard/settings/correos-express
rm -rf apps/web/src/app/dashboard/settings/entregas
rm -rf apps/web/src/app/dashboard/settings/pagamentos
rm -rf apps/web/src/app/dashboard/settings/bookings
rm -rf apps/web/src/app/dashboard/settings/whatsapp
rm -rf apps/web/public/loja

# Web components
rm -rf apps/web/src/components/ecommerce
rm -rf apps/web/src/components/woocommerce
rm -rf apps/web/src/components/shopify
rm -rf apps/web/src/components/stripe
rm -rf apps/web/src/components/correos-express
rm -rf apps/web/src/components/carwash
rm -rf apps/web/src/components/deliveries
rm -rf apps/web/src/components/payments
rm -rf apps/web/src/components/settings/settings-bookings-panel.tsx
rm -rf apps/web/src/components/settings/settings-whatsapp-panel.tsx
rm -rf apps/web/src/components/settings/settings-whatsapp-master-panel.tsx

# Web libs
rm -f apps/web/src/lib/carwash-*.ts
rm -f apps/web/src/lib/ecommerce-*.ts
rm -f apps/web/scripts/sync-loja-public.mjs

# Shared - remove ecommerce/carwash/stripe/correos exports
for f in \
  ecommerce-special-pages.ts \
  ecommerce-special-pages-default-content.ts \
  ecommerce-cookies-cmp.ts \
  ecommerce-wireframe-config.ts \
  ecommerce-orders.ts \
  ecommerce-shipping.ts \
  ecommerce-delivery.ts \
  ecommerce-payments.ts \
  ecommerce-vat.ts \
  ecommerce-product-image.ts \
  ecommerce-media.ts \
  ecommerce-wireframes.ts \
  ecommerce-storefronts.ts \
  ecommerce-storefront-wireframes.ts \
  ecommerce-email-themes.ts \
  carwash-catalog.ts \
  carwash-daily-cash.ts \
  carwash-license-plate.ts \
  carwash-vehicle-image.ts \
  car-module-branding.ts \
  correos-express.ts \
  stripe.ts \
  whatsapp-phone.ts \
  remove-solid-background.ts; do
  rm -f "packages/shared/src/$f"
done

# Keep csv-import but remove ecommerce parts later in index.ts

echo "==> Prune complete"
