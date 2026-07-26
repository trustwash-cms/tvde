/**
 * Moloni demo/demonstration companies include "Demonstração" (or similar) in the name.
 * Used to gate destructive local cleanup so live companies cannot be wiped by mistake.
 */
const MOLONI_DEMO_COMPANY_RE = /demonstra/i;

export function isMoloniDemoCompany(companyName: string | null | undefined): boolean {
  if (!companyName?.trim()) return false;
  return MOLONI_DEMO_COMPANY_RE.test(companyName);
}
