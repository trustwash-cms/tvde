import { BillingProductFormPanel } from '@/components/billing/billing-product-form-panel';

export default function BillingEditProductPage({
  params,
}: {
  params: { categoryId: string; productId: string };
}) {
  return (
    <BillingProductFormPanel
      categoryId={Number(params.categoryId)}
      productId={Number(params.productId)}
    />
  );
}
