import { WEB_ROUTES } from './routes';

export type SearchResultType = 'tenant' | 'workspace' | 'user' | 'client' | 'product';

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string | null;
}

export const SEARCH_TYPE_LABELS: Record<SearchResultType, string> = {
  tenant: 'Tenant',
  workspace: 'Workspace',
  user: 'Utilizador',
  client: 'Cliente',
  product: 'Produto',
};

export function getSearchResultHref(result: SearchResult, query: string): string {
  const q = encodeURIComponent(query.trim());
  const routes: Record<SearchResultType, string> = {
    tenant: WEB_ROUTES.dashboard.tenants,
    workspace: WEB_ROUTES.dashboard.workspaces,
    user: WEB_ROUTES.dashboard.users,
    client: WEB_ROUTES.dashboard.clients,
    product: WEB_ROUTES.dashboard.products,
  };
  return `${routes[result.type]}?q=${q}`;
}
