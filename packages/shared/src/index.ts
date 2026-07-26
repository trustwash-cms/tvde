export { ROLES, ROLE_HIERARCHY, ROLE_LABELS, getRoleLabel, hasMinRole, type Role } from './roles';
export {
  ROLE_MANAGER,
  canAssignRole,
  getAssignableRoles,
  canManageUser,
  canCreateUsers,
  canToggleUserStatus,
  isDriverRole,
  DASHBOARD_ACCESS,
  canAccessDashboardArea,
  canAccessClientsDashboard,
  canAccessDriverSelfService,
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
  /** Presente quando MASTER está a personificar este utilizador */
  impersonatorId?: string;
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
  max_vehicles: 3,
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
export { isMoloniDemoCompany } from './moloni-demo';
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
  DEFAULT_LOGIN_WALLPAPER_PATH,
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
  USERNAME_PATTERN,
  USER_STATUS_OPTIONS,
  buildUserPhone,
  getPasswordRequirementChecks,
  isPasswordStrong,
  isValidUserPhone,
  isValidUsername,
  normalizeUsername,
  roleRequiresPhone,
  splitUserPhone,
  type PasswordRequirementCheck,
} from './user-validation';
export {
  USER_DOCUMENT_TYPES,
  USER_DOCUMENT_TYPE_LABELS,
  USER_DOCUMENT_VISIBILITIES,
  USER_DOCUMENT_VISIBILITY_LABELS,
  USER_DOCUMENT_MIME_TYPES,
  USER_DOCUMENT_MAX_BYTES,
  canViewUserProfile,
  canEditUserProfile,
  isAllowedUserDocumentMime,
  type UserDocumentType,
  type UserDocumentVisibility,
  type UserProfileFields,
  type UserDocumentItem,
  type UserProfileDetail,
  type UserProfileDetailUser,
} from './user-profile';
export {
  VEHICLE_COMMISSION_TYPES,
  VEHICLE_COMMISSION_TYPE_LABELS,
  normalizeUserVehicleMatricula,
  formatUserVehicleMatricula,
  parseOptionalDecimal,
  parseOptionalYear,
  parseDateOnlyInput,
  formatDateOnlyInput,
  type VehicleCommissionType,
  type UserVehicleRecord,
  type TenantVehicleLimits,
} from './user-vehicle';
export {
  STORAGE_GB_BYTES,
  gbToStorageBytes,
  storageBytesToGb,
  formatStorageBytes,
  storageUsagePercent,
  storageLimitAlertLevel,
  type TenantStorageBreakdown,
  type TenantStorageSummary,
} from './storage';
export {
  overlapDays,
  isUserVehicleActive,
  pickBestUserVehicleForPeriod,
  vehicleLimitUsagePercent,
  vehicleLimitAlertLevel,
  toDateOnlyUtc,
  type UserVehiclePeriodRecord,
} from './user-vehicle-overlap';
export {
  defaultPaymentWeekRange,
  type PaymentMoneyLine,
  type PaymentCalculationReceitas,
  type PaymentCalculationDespesas,
  type PaymentCalculationIds,
  type PaymentCalculation,
  type PaymentDriverOption,
} from './payment-calculator';
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
  PORTAL_KINDS,
  PORTAL_KIND_LABELS,
  PORTAL_CONNECTION_STATUSES,
  PORTAL_CONNECTION_STATUS_LABELS,
  MYPRIO_SYNC_SCOPES,
  MYPRIO_SYNC_SCOPE_LABELS,
  UBER_SYNC_MODES,
  defaultUberReportRange,
  lisbonDatetimeLocalToIso,
  isoToLisbonDatetimeLocal,
  guessUberOrganizationsFromReports,
  ymdToUberCompact,
  uberReportMatchesPeriod,
  pickLatestUberReportForPeriod,
  type PortalKind,
  type PortalConnectionStatus,
  type PortalConnectionPublic,
  type PortalConnectInput,
  type PortalOtpInput,
  type PortalSyncResultSummary,
  type MyPrioSyncScope,
  type UberSyncMode,
  type UberSyncOptions,
  type UberReportListItem,
} from './portal-rpa';
export {
  PT_MONTH_LABELS,
  currentMonthKey,
  parseMonthKey,
  getMonthUtcRange,
  currentYearMonthOptions,
} from './month-filter';
export {
  SPREADSHEET_IMPORT_EXTENSIONS,
  cellToImportString,
  normalizeSpreadsheetRows,
  parseCsvTextToRows,
  parseSpreadsheetDateValue,
  findSpreadsheetHeaderRowIndex,
  isSpreadsheetImportFilename,
} from './spreadsheet-rows';
export {
  VIA_VERDE_PAGE_SIZE,
  parseViaVerdeRows,
  parseViaVerdeCsv,
  parseViaVerdeImportFileName,
  type ViaVerdeMovementItem,
  type ViaVerdeDashboardStats,
  type ViaVerdeImportRowError,
  type ViaVerdeParsedMovement,
  type ViaVerdeImportResult,
} from './via-verde';
export {
  ELECTRICITY_PAGE_SIZE,
  ELECTRICITY_IMPORT_FIELDS,
  guessElectricityFieldMapping,
  parseElectricityRows,
  parseElectricityCsv,
  parseElectricityImportFileName,
  type ElectricityImportField,
  type ElectricityChargeItem,
  type ElectricityDashboardStats,
  type ElectricityImportRowError,
  type ElectricityParsedCharge,
  type ElectricityImportResult,
} from './electricity';
export {
  COMBUSTIVEL_PAGE_SIZE,
  parseCombustivelRows,
  parseCombustivelCsv,
  parseCombustivelImportFileName,
  type CombustivelImportRowError,
  type CombustivelParsedTransaction,
  type CombustivelImportResult,
} from './combustivel';
export {
  UBER_CSV_REQUIRED_COLUMNS,
  parseUberCsv,
  parseUberImportFileName,
  type UberImportRowError,
  type UberParsedPayment,
  type UberImportResult,
} from './uber-import';
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
