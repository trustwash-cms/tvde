export { BoltFleetClient, computeSyncWindow, type BoltClientConfig, type BoltTestConnectionOptions } from './client';
export { unwrapBoltResponse, type BoltApiEnvelope } from './api-envelope';
export {
  coerceCompanyId,
  extractCompaniesFromAccessToken,
  normalizeCompany,
  parseCompaniesPayload,
} from './parse-companies';
export type {
  BoltCompany,
  BoltDriverRow,
  BoltOrderRow,
  BoltOrderStop,
  BoltSyncCounters,
  BoltSyncType,
  BoltVehicleRow,
} from './types';
