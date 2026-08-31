export interface BoltTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface BoltCompany {
  company_id: number;
  company_name?: string;
}

export interface BoltOrderStop {
  type?: string;
  stop_type?: string;
  lat?: number;
  lng?: number;
  real_lat?: number;
  real_lng?: number;
  stop_order?: number;
}

export interface BoltOrderRow {
  order_reference: string;
  driver_name?: string;
  driver_uuid?: string;
  driver_phone?: string;
  order_status?: string;
  vehicle_model?: string;
  vehicle_license_plate?: string;
  order_created_timestamp?: number;
  order_stops?: BoltOrderStop[];
  order_price?: {
    ride_price?: number;
    booking_fee?: number;
    toll_fee?: number;
    tip?: number;
    commission?: number;
    net_earnings?: number;
    cancellation_fee?: number;
    cash_discount?: number;
    in_app_discount?: number;
  };
  ride_price?: number;
}

export interface BoltDriverRow {
  driver_uuid: string;
  partner_uuid?: string;
  first_name?: string | null;
  last_name?: string | null;
  name?: string;
  phone?: string;
  email?: string | null;
  state?: string;
  portal_status?: string;
  created_at_timestamp?: number;
}

export interface BoltVehicleRow {
  id?: number;
  vehicle_id?: string | number;
  model?: string;
  year?: number;
  reg_number?: string;
  vin?: string | null;
  uuid?: string | null;
  state?: string;
  portal_status?: string;
}

export type BoltSyncType = 'orders' | 'drivers' | 'vehicles' | 'all';

export interface BoltSyncCounters {
  synced: number;
  created: number;
  updated: number;
  skipped: number;
}
