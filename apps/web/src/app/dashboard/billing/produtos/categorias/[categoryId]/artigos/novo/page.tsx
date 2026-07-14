import { BillingProductFormPanel } from '@/components/billing/billing-product-form-panel';

export default function BillingNewProductPage({
  params,
}: {
  params: { categoryId: string };
}) {
  return <BillingProductFormPanel categoryId={Number(params.categoryId)} />;
}
