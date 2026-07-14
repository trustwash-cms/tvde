import { BillingCategoryArticlesPanel } from '@/components/billing/billing-category-articles-panel';

export default function BillingCategoryArticlesPage({
  params,
}: {
  params: { categoryId: string };
}) {
  return <BillingCategoryArticlesPanel categoryId={Number(params.categoryId)} />;
}
