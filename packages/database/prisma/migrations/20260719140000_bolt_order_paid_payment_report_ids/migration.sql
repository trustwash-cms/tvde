-- Bolt orders: paid flag for payment reports
ALTER TABLE "bolt_orders" ADD COLUMN "is_paid" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bolt_orders" ADD COLUMN "payment_date" TIMESTAMP(3);

CREATE INDEX "bolt_orders_tenant_id_is_paid_idx" ON "bolt_orders"("tenant_id", "is_paid");

-- Payment reports: store Bolt order IDs for faithful unmark on delete
ALTER TABLE "payment_reports" ADD COLUMN "bolt_order_ids" JSONB NOT NULL DEFAULT '[]';
