export { ROLES, ROLE_HIERARCHY, ROLE_LABELS, getRoleLabel, hasMinRole, type Role } from './roles';
export {
  ROLE_MANAGER,
  canAssignRole,
  getAssignableRoles,
  canManageUser,
  DASHBOARD_ACCESS,
  canAccessDashboardArea,
  canAccessClientsDashboard,
} from './permissions';
export {
  REMOVED_MODULE_KEYS,
  filterTvdeModules,
  isRemovedModule,
  type RemovedModuleKey,
} from './modules';

import type { Role } from './roles';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  tenantId: string | null;
  workspaceId: string | null;
  siteId: string | null;
  sessionId: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export const DEFAULT_LIMITS = {
  storage_gb: 5,
  max_users: 10,
  max_products: 100,
  max_workspaces: 1,
  api_calls_month: 1000,
};

export {
  formatExVatInput,
  formatIncVatDisplay,
  formatVatPriceInput,
  getTaxRateById,
  priceExVatToIncVat,
  priceIncVatToExVat,
  EX_VAT_DECIMALS,
  roundExVat,
  roundMoney,
  type VatTaxRate,
} from './vat-pricing';

export { WEB_ROUTES, API_PATHS, STORAGE_KEYS } from './routes';
export {
  SEARCH_TYPE_LABELS,
  getSearchResultHref,
  type SearchResult,
  type SearchResultType,
} from './search';
export { getWebConfig } from './config.client';
export { getMoloniRedirectUri, isMoloniLocalRedirect } from './moloni-redirect';
export {
  parseMoloniInvoiceErrorMessage,
  type MoloniDocumentSetHealth,
  type MoloniDocumentSetHealthSeverity,
} from './moloni-document-set';
export {
  BILLING_DOCUMENT_TYPES,
  BILLING_ENTITY_TYPES,
  getDocumentTypeLabel,
  getBillingDocumentEditPath,
  type BillingNavItem,
  type MoloniDocumentType,
  type MoloniEntityType,
} from './billing-catalog';
export {
  CALENDAR_TIMEZONE_OPTIONS,
  DEFAULT_CALENDAR_TIMEZONE,
  formatDateTimeLocal,
  formatTimezoneLabel,
  getBusinessDayRange,
  getTodayRangeInTimezone,
  getZonedParts,
  isStartInPast,
  minStartDateTimeLocal,
  parseDateTimeLocal,
} from './calendar-timezone';
export { latLngToTile, osmEmbedUrl, osmTileUrl } from './calendar-map';
export {
  CALENDAR_RECURRENCE_OPTIONS,
  buildCalendarOccurrenceId,
  buildRecurrenceRule,
  getRecurrenceLabel,
  parseCalendarOccurrenceId,
  parseRecurrencePreset,
  type CalendarRecurrencePreset,
} from './calendar-recurrence';
export {
  EMAIL_DEFAULT_CC_KEY,
  EMAIL_DEFAULT_BCC_KEY,
} from './email-settings';
export {
  TENANT_BRANDING_LOGO_MIME_TYPES,
  TENANT_BRANDING_MAX_LOGO_BYTES,
  TENANT_BRANDING_MAX_WALLPAPER_BYTES,
  TENANT_BRANDING_WALLPAPER_MIME_TYPES,
  TENANT_COMPANY_LOGO_SETTING_KEY,
  TENANT_LOGIN_WALLPAPER_SETTING_KEY,
  TENANT_LOGIN_LOGO_SCALE_SETTING_KEY,
  TENANT_LOGIN_LOGO_SCALES,
  parseTenantLoginLogoScale,
  type TenantLoginLogoScale,
  type TenantBrandingLogoMimeType,
  type TenantCompanyLogoMeta,
  type TenantLoginWallpaperMeta,
} from './tenant-branding';
export {
  CALENDAR_EVENT_TYPES,
  CALENDAR_SCHEDULED_INVOICE_ENABLED_KEY,
  CALENDAR_SCHEDULED_INVOICE_CATEGORY_ID_KEY,
  type CalendarEventType,
  type CalendarScheduledInvoiceDraft,
  type CalendarScheduledInvoiceLine,
  type CalendarScheduledInvoiceSummary,
} from './calendar-scheduled-invoice';
export {
  CATALOG_IMPORT_MAX_ROWS,
  CATALOG_IMPORT_TEMPLATE_HEADERS,
  CATALOG_IMPORT_IGNORE,
  CATALOG_IMPORT_FIELD_OPTIONS,
  applyCatalogImportMapping,
  buildCatalogImportCsvFromRows,
  buildCatalogImportTemplateCsv,
  getCatalogImportColumnCount,
  guessCatalogFieldMapping,
  padCatalogImportRows,
  parseCatalogImportCsv,
  parseImportBoolean,
  CATALOG_IMPORT_MAPPABLE_FIELDS,
  normalizeCatalogImportRow,
  parseImportMoney,
  parseImportNumber,
  parseImportPercent,
  parseRawCsvRows,
  resolveImportExVatPrice,
  validateCatalogImportMapping,
  type CatalogImportFieldOption,
  type CatalogImportResult,
  type CatalogImportRowError,
} from './csv-import';
export {
  ADMIN_MGMT_MODULE_KEY,
  ADMIN_MGMT_MODULE_NAME,
  ADMIN_MGMT_VENCIMENTO_ORIGENS,
  ADMIN_MGMT_VENCIMENTO_STATUSES,
  ADMIN_MGMT_SEGURO_TIPO_AUTOMOVEL,
  ADMIN_MGMT_MAX_APOlices,
  ADMIN_MGMT_MAX_FATURA_ANEXOS,
  ADMIN_MGMT_FATURA_TIPOS,
  ADMIN_MGMT_FATURA_PAGAMENTO_STATUSES,
  ADMIN_MGMT_FATURA_METODOS_PAGAMENTO,
  ADMIN_MGMT_FATURA_ANEXO_MIME_TYPES,
  getAdminMgmtFaturaTipoLabel,
  getAdminMgmtFaturaPagamentoLabel,
  getAdminMgmtFaturaMetodoPagamentoLabel,
  type AdminMgmtFaturaAnexo,
  DEFAULT_ADMIN_MGMT_SEGURADORAS,
  DEFAULT_ADMIN_MGMT_TIPOS_PRODUTO,
  ADMIN_MGMT_APOlice_MIME_TYPES,
  isAdminMgmtSeguroTipoAutomovel,
  type AdminMgmtApoliceFile,
  ADMIN_MGMT_SEGURO_OBJETO_TIPOS,
  ADMIN_MGMT_SEGURO_PERIODICIDADES,
  ADMIN_MGMT_SEGURO_PAGAMENTO_STATUSES,
  ADMIN_MGMT_CONTRATO_TIPOS,
  ADMIN_MGMT_CONTRATO_PERIODICIDADES,
  ADMIN_MGMT_CONTRATO_STATUSES,
  ADMIN_MGMT_FISCAL_STATUSES,
  ADMIN_MGMT_IVA_REGIMES,
  ADMIN_MGMT_IVA_STATUSES,
  ADMIN_MGMT_IRS_TIPOS,
  DEFAULT_ADMIN_MGMT_ALERT_DAYS,
  getAdminMgmtVencimentoOrigemLabel,
  getAdminMgmtVencimentoStatusLabel,
  getAdminMgmtVencimentoHref,
  vencimentoUrgencyClass,
  formatAdminMgmtMoney,
  formatAdminMgmtAlertTitle,
  formatAdminMgmtAlertSubject,
  type AdminMgmtVencimentoOrigem,
  type AdminMgmtVencimentoStatus,
} from './admin-mgmt';
export {
  formatWhatsappPhone,
  normalizeWhatsappPhoneDigits,
  whatsappPhonesMatch,
} from './whatsapp-phone';
export {
  CARWASH_LICENSE_COUNTRIES,
  formatLicensePlateDisplay,
  formatPortugueseLicensePlate,
  normalizeLicensePlate,
  stripLicenseInput,
  validatePortugueseLicensePlate,
  type CarwashLicenseCountry,
} from './carwash-license-plate';
export {
  RECIBOS_VERDES_CSV_MAX_ROWS,
  parseRecibosVerdesCsv,
  mapSireTipoDocumento,
  type RecibosVerdesCsvParsedRow,
  type RecibosVerdesCsvParseResult,
  type RecibosVerdesImportPreviewRow,
  type RecibosVerdesImportResult,
  type RecibosVerdesCsvRowError,
} from './recibos-verdes-import';
