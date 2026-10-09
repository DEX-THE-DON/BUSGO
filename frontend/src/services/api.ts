// Base URL for the BUSGO API. Override at runtime via NEXT_PUBLIC_API_URL
// (e.g. when the frontend is opened from another device and the backend
// lives on a different host than 127.0.0.1).
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8000';

/** WebSocket base derived from the API base (http->ws). */
export function wsBaseUrl(): string {
  return API_BASE_URL.replace(/^http/, 'ws');
}

const TOKEN_KEY = 'busgo_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

/** Extract a readable message from a thrown value. */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'An unexpected error occurred';
}

async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
    if (!res.ok) {
      let detail = `Request failed (HTTP ${res.status})`;
      try {
        const errData = await res.json();
        if (errData.detail) detail = typeof errData.detail === 'string' ? errData.detail : JSON.stringify(errData.detail);
      } catch {
        /* non-JSON error body */
      }
      throw new Error(detail);
    }
    return res.json() as Promise<T>;
  } catch (err: unknown) {
    if (err instanceof TypeError && err.message.toLowerCase().includes('fetch')) {
      throw new Error(`Cannot reach BUSGO backend at ${API_BASE_URL}. Ensure PostgreSQL and the backend API server are started (run ./start_all.sh).`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Types — shared with the backend (@busgo/types), so frontend API types can
// never drift from the server's Zod/Pydantic schemas.
// ---------------------------------------------------------------------------
import type {
  AdminAnalytics,
  AppNotification,
  AuthResponse,
  Booking,
  BookSeatResponse,
  ChainLink,
  DriverRow,
  ManifestEntry,
  PaymentRow,
  Route,
  RouteStop,
  SeatInterest,
  SeatMapEntry,
  TripOption,
  TripStop,
  TripSearchResult,
  PaystackInitResponse,
  PaystackVerifyResponse,
  User,
  Vehicle,
  VehicleType,
  VehiclePurpose,
  DriverVehicleRegister,
  TripGpsTelemetry,
  Sacco,
  VehicleCompliance,
  RadarVehicle,
  RadarFleetResponse,
  SaccoSettlementItem,
  SaccoSettlementSummary,
  SaccoWithdrawRequest,
  EvVehicle,
  EvFleetResponse,
  ChargingStation,
  ChargingStationsResponse,
  BudgetStageItem,
  BudgetReachResponse,
  GroupMember,
  GroupBooking,
  StageManifestPassenger,
  StageManifest,
  StageReconciliation,
  LostFoundItem,
  HighwayBlackspot,
  BlackspotProximityAlert,
  StageB2CPayoutRequest,
  StageB2CPayoutResponse,
  DispatchOutboxItem,
  TravelVoucher,
  MyVouchersResponse,
  ValidateVoucherResponse,
  RescheduleBookingRequest,
  RescheduleBookingResponse,
  CancelToVoucherResponse,
  ComplianceSweeperResult,
  ComplianceSummary,
  HardwareTrackerDevice,
  TrackersListResponse,
  BindTrackerRequest,
  BindTrackerResponse,
  TrackerBreadcrumb,
  TrackerHistoryResponse,
  OverspeedAlert,
  OverspeedAlertsResponse,
  GenericTelemetryIngestRequest,
} from '@busgo/types';

export type {
  ComplianceSweeperResult,
  ComplianceSummary,
  AdminAnalytics,
  AppNotification,
  AuthResponse,
  Booking,
  BookSeatResponse,
  ChainLink,
  DriverRow,
  ManifestEntry,
  PaymentRow,
  Route,
  RouteStop,
  SeatInterest,
  SeatMapEntry,
  TripOption,
  TripStop,
  TripSearchResult,
  PaystackInitResponse,
  PaystackVerifyResponse,
  User,
  Vehicle,
  VehicleType,
  VehiclePurpose,
  DriverVehicleRegister,
  TripGpsTelemetry,
  Sacco,
  VehicleCompliance,
  RadarVehicle,
  RadarFleetResponse,
  SaccoSettlementItem,
  SaccoSettlementSummary,
  SaccoWithdrawRequest,
  EvVehicle,
  EvFleetResponse,
  ChargingStation,
  ChargingStationsResponse,
  BudgetStageItem,
  BudgetReachResponse,
  GroupMember,
  GroupBooking,
  StageManifestPassenger,
  StageManifest,
  StageReconciliation,
  LostFoundItem,
  HighwayBlackspot,
  BlackspotProximityAlert,
  StageB2CPayoutRequest,
  StageB2CPayoutResponse,
  DispatchOutboxItem,
  TravelVoucher,
  MyVouchersResponse,
  ValidateVoucherResponse,
  RescheduleBookingRequest,
  RescheduleBookingResponse,
  CancelToVoucherResponse,
  HardwareTrackerDevice,
  TrackersListResponse,
  BindTrackerRequest,
  BindTrackerResponse,
  TrackerBreadcrumb,
  TrackerHistoryResponse,
  OverspeedAlert,
  OverspeedAlertsResponse,
  GenericTelemetryIngestRequest,
};

/** @deprecated Use `TripOption` (same wire shape, shared with the backend). */
export type TripRow = TripOption;

// ---------------------------------------------------------------------------
// Public / passenger endpoints
// ---------------------------------------------------------------------------


export async function fetchTrips() {
  return apiFetch<{ trips: TripOption[] }>('/api/trips');
}

export async function fetchTripStops(tripId: number) {
  return apiFetch<{ trip_id: number; stops: TripStop[] }>(`/api/trips/${tripId}/stops`);
}

export async function fetchBookedSeats(tripId: number, boardOrder: number, alightOrder: number) {
  return apiFetch<{ trip_id: number; booked_seats: number[] }>(
    `/api/trips/${tripId}/booked-seats?board_order=${boardOrder}&alight_order=${alightOrder}`,
  );
}

export async function fetchRoutes() {
  return apiFetch<{ routes: Route[] }>('/api/routes');
}

export async function bookSeatData(data: {
  trip_id: number;
  seat_number: number;
  board_stop_order: number;
  alight_stop_order: number;
  has_luggage?: boolean;
  luggage_count?: number;
  luggage_description?: string;
  voucher_code?: string;
}) {
  return apiFetch<BookSeatResponse>('/api/book-seat', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function payMpesa(data: { phone_number: string; amount: number; booking_id: number }) {
  return apiFetch<{ status: string; message: string; payment_id: number; booking_id: number }>('/api/pay/mpesa-stk', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchMyVouchers() {
  return apiFetch<MyVouchersResponse>('/api/vouchers/my-vouchers');
}

export async function validateTravelVoucher(code: string) {
  return apiFetch<ValidateVoucherResponse>('/api/vouchers/validate', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function cancelBookingToVoucher(bookingId: number) {
  return apiFetch<CancelToVoucherResponse>(`/api/bookings/${bookingId}/cancel-to-voucher`, {
    method: 'POST',
  });
}

export async function rescheduleBooking(bookingId: number, data: RescheduleBookingRequest) {
  return apiFetch<RescheduleBookingResponse>(`/api/bookings/${bookingId}/reschedule`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export async function login(email: string, password: string) {
  return apiFetch<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function register(data: { full_name: string; email: string; phone?: string; password: string }) {
  return apiFetch<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchMe() {
  return apiFetch<User>('/api/auth/me');
}

export async function updateProfile(data: {
  full_name?: string;
  email?: string;
  phone?: string;
  password?: string;
}) {
  return apiFetch<User>('/api/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Passenger: booking history (authenticated)
// ---------------------------------------------------------------------------
export async function fetchUserBookings() {
  return apiFetch<{ bookings: Booking[] }>('/api/user/bookings');
}

// ---------------------------------------------------------------------------
// Admin: fleet CRUD (admin only)
// ---------------------------------------------------------------------------
export async function fetchVehicleTypes() {
  return apiFetch<{ vehicle_types: VehicleType[] }>('/api/vehicle-types');
}

export async function createVehicleType(data: { slug: string; display_name: string; seat_capacity: number; purpose?: string; cargo_tonnage?: number }) {
  return apiFetch<VehicleType>('/api/admin/vehicle-types', { method: 'POST', body: JSON.stringify(data) });
}

export async function fetchAdminVehicles() {
  return apiFetch<{ vehicles: Vehicle[] }>('/api/admin/vehicles');
}

export async function createVehicle(data: {
  plate_number: string;
  vehicle_type_id?: number;
  is_electric?: boolean;
  purpose?: string;
  body_type?: string;
  cargo_tonnage_capacity?: number;
  driver_id?: number;
  sacco_id?: number;
}) {
  return apiFetch<Vehicle>('/api/admin/vehicles', { method: 'POST', body: JSON.stringify(data) });
}

export async function fetchDriverVehicles() {
  return apiFetch<{ vehicles: Vehicle[] }>('/api/driver/vehicles');
}

export async function registerDriverVehicle(data: {
  plate_number: string;
  purpose: 'passenger' | 'cargo' | 'people';
  vehicle_type_id?: number;
  body_type?: string;
  cargo_tonnage_capacity?: number;
  seat_capacity?: number;
  is_electric?: boolean;
  sacco_id?: number;
  chassis_number?: string;
  manufacture_year?: number;
}) {
  return apiFetch<{
    ok: boolean;
    vehicle_id: number;
    plate_number: string;
    purpose: string;
    body_type?: string;
    cargo_tonnage_capacity?: number;
    message: string;
  }>('/api/driver/vehicles', { method: 'POST', body: JSON.stringify(data) });
}

export async function assignTripVehicle(tripId: number, vehicleId: number) {
  return apiFetch<{
    ok: boolean;
    trip_id: number;
    vehicle_id: number;
    plate_number: string;
    purpose: string;
    message: string;
  }>(`/api/driver/trips/${tripId}/assign-vehicle`, {
    method: 'POST',
    body: JSON.stringify({ vehicle_id: vehicleId }),
  });
}

export async function deleteVehicle(vehicleId: number) {
  return apiFetch<{ deleted: number }>(`/api/admin/vehicles/${vehicleId}`, { method: 'DELETE' });
}

export async function createRoute(data: {
  name: string;
  country?: string;
  route_type?: 'direct' | 'stopwise';
  stops: string[];
  base_fare?: number;
  per_hop_fare?: number;
  fare_matrix?: Record<string, number>;
}) {
  return apiFetch<Route>('/api/admin/routes', { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteRoute(routeId: number) {
  return apiFetch<{ deleted: number }>(`/api/admin/routes/${routeId}`, { method: 'DELETE' });
}

export async function fetchAdminUsers() {
  return apiFetch<{ users: User[] }>('/api/admin/users');
}

export async function createTrip(data: {
  route_id: number;
  vehicle_id?: number | null;
  driver_id?: number | null;
  name: string;
  scheduled_at?: string | null;
  status?: string;
  fixed_price?: number | null;
  allow_driver_tier?: boolean;
  max_surcharge_pct?: number;
}) {
  return apiFetch<{ id: number; name: string; status: string }>('/api/admin/trips', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateTrip(
  tripId: number,
  data: {
    name?: string;
    status?: string;
    driver_id?: number | null;
    vehicle_id?: number | null;
    fixed_price?: number | null;
    allow_driver_tier?: boolean;
    max_surcharge_pct?: number;
    driver_tier?: string;
  },
) {
  return apiFetch<{ id: number; updated: boolean }>(`/api/admin/trips/${tripId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteTrip(tripId: number) {
  return apiFetch<{ deleted: number }>(`/api/admin/trips/${tripId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Driver (also used by admin fleet overview)
// ---------------------------------------------------------------------------
export async function fetchDriverTrips() {
  return apiFetch<{ trips: TripRow[] }>('/api/driver/trips');
}

export async function updateTripStatus(tripId: number, status: string) {
  return apiFetch<{ trip_id: number; status: string }>(`/api/trips/${tripId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function updateDriverTier(tripId: number, driverTier: string) {
  return apiFetch<{ trip_id: number; driver_tier: string; applied_surcharge_pct: number; message: string }>(
    `/api/trips/${tripId}/driver-tier`,
    {
      method: 'PATCH',
      body: JSON.stringify({ driver_tier: driverTier }),
    },
  );
}

export async function fetchManifest(tripId: number) {
  return apiFetch<{ trip_id: number; manifest: (ManifestEntry & { booking_id?: number; status?: string; payment_status?: string })[] }>(
    `/api/trips/${tripId}/manifest`
  );
}

export interface SendGpsPayload {
  lat: number;
  lng: number;
  speed?: number | null;
  heading?: number | null;
}

export async function sendTripGps(tripId: number, payload: SendGpsPayload) {
  return apiFetch<{ ok: boolean; gps: TripGpsTelemetry }>(`/api/trips/${tripId}/gps`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchTripGps(tripId: number) {
  return apiFetch<TripGpsTelemetry>(`/api/trips/${tripId}/gps`);
}

export interface BoardPassengerPayload {
  bookingId?: number;
  ticketCode?: string;
}

export async function boardPassenger(tripId: number, payload: BoardPassengerPayload) {
  return apiFetch<{
    ok: boolean;
    message: string;
    booking_id: number;
    status: string;
    seat_number: number;
  }>(`/api/trips/${tripId}/board-passenger`, {
    method: 'PATCH',
    body: JSON.stringify({
      booking_id: payload.bookingId,
      ticket_code: payload.ticketCode,
    }),
  });
}

export interface OfflineSyncItemPayload {
  booking_id?: number;
  ticket_code?: string;
  seat_number?: number;
  scanned_at?: string;
}

export async function batchOfflineSync(tripId: number, scans: OfflineSyncItemPayload[]) {
  return apiFetch<{
    ok: boolean;
    trip_id: number;
    total_scans: number;
    boarded_count: number;
    already_boarded_count: number;
    conflict_count: number;
    results: Array<{
      booking_id?: number;
      seat_number?: number;
      status: string;
      message?: string;
    }>;
  }>(`/api/trips/${tripId}/offline-sync`, {
    method: 'POST',
    body: JSON.stringify({ scans, synced_at: new Date().toISOString() }),
  });
}



// ---------------------------------------------------------------------------
// Seat map, chains, waitlist & notifications (the relay feature)
// ---------------------------------------------------------------------------
export async function fetchSeatMap(tripId: number, boardOrder: number, alightOrder: number) {
  return apiFetch<{
    trip_id: number;
    seat_capacity: number;
    board_order: number;
    alight_order: number;
    seats: SeatMapEntry[];
  }>(`/api/trips/${tripId}/seat-map?board_order=${boardOrder}&alight_order=${alightOrder}`);
}

export async function fetchTripChains(tripId: number) {
  return apiFetch<{ trip_id: number; seat_capacity: number; chains: { seat_number: number; links: ChainLink[] }[] }>(
    `/api/trips/${tripId}/chains`,
  );
}

export async function createSeatInterest(data: {
  trip_id: number;
  board_stop_order: number;
  alight_stop_order: number;
  seat_number?: number | null;
}) {
  return apiFetch<SeatInterest>('/api/seat-interests', { method: 'POST', body: JSON.stringify(data) });
}

export async function fetchSeatInterests() {
  return apiFetch<{ interests: SeatInterest[] }>('/api/seat-interests');
}

export async function deleteSeatInterest(id: number) {
  return apiFetch<{ deleted: number }>(`/api/seat-interests/${id}`, { method: 'DELETE' });
}

export async function fetchNotifications(limit = 30) {
  return apiFetch<{ notifications: AppNotification[]; unread: number }>(
    `/api/notifications?limit=${limit}`,
  );
}

export async function markNotificationRead(id: number) {
  return apiFetch<{ read: boolean }>(`/api/notifications/${id}/read`, { method: 'POST' });
}

export async function markAllNotificationsRead() {
  return apiFetch<{ read_all: boolean }>('/api/notifications/read-all', { method: 'POST' });
}

export async function cancelBooking(bookingId: number) {
  return apiFetch<{ deleted: number; seat_freed: boolean }>(`/api/bookings/${bookingId}`, { method: 'DELETE' });
}

export async function payDarajaStk(data: { booking_id: number; phone_number: string; amount: number; simulate?: boolean }) {
  return apiFetch<{ status: string; message: string; checkout_request_id: string; booking_id: number }>(
    '/api/pay/daraja/stk',
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export async function simulateDarajaCallback(data: {
  checkout_request_id: string;
  result_code?: number;
  amount?: number;
  receipt_number?: string;
  phone_number?: string;
  result_desc?: string;
}) {
  return apiFetch<{
    simulation: string;
    result_code: number;
    receipt_number?: string;
    callback_response: { ResultCode: number; ResultDesc: string };
    mock_payload: Record<string, unknown>;
  }>('/api/pay/daraja/simulate-callback', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchPaymentStatus(bookingId: number) {
  return apiFetch<{
    booking_id: number;
    booking_status: string;
    payment_status: string;
    seat_number: number;
    trip_id: number;
    payment: {
      id: number;
      provider: string;
      status: string;
      provider_reference?: string;
      receipt_number?: string;
      amount: number;
      phone_number?: string;
      callback_verified: boolean;
      created_at: string;
    } | null;
  }>(`/api/pay/status/${bookingId}`);
}

export async function dispatchBookingTicket(
  bookingId: number,
  data?: { channels?: string[]; override_phone?: string }
) {
  return apiFetch<{
    booking_id: number;
    recipient: string;
    ticket_ref: string;
    wa_link: string;
    messages: { whatsapp: string; sms: string };
    dispatches: Array<{
      dispatch_id: number;
      channel: string;
      recipient: string;
      status: string;
      provider: string;
      ref?: string;
    }>;
  }>(`/api/bookings/${bookingId}/dispatch`, {
    method: 'POST',
    body: JSON.stringify(data || {}),
  });
}

export async function fetchBookingDispatchPreview(bookingId: number) {
  return apiFetch<{
    booking_id: number;
    preview: {
      whatsapp: string;
      sms: string;
      wa_link: string;
      ticket_ref: string;
      recipient: string;
    };
    history: Array<{
      id: number;
      channel: string;
      recipient: string;
      status: string;
      provider: string;
      provider_reference?: string;
      created_at: string;
    }>;
  }>(`/api/bookings/${bookingId}/dispatch`);
}

export async function fetchAdminDispatches(limit = 50) {
  return apiFetch<{
    dispatches: Array<{
      id: number;
      booking_id: number;
      user_id: number;
      passenger_name?: string;
      channel: string;
      recipient: string;
      message_body: string;
      status: string;
      provider: string;
      provider_reference?: string;
      created_at: string;
    }>;
  }>(`/api/admin/dispatches?limit=${limit}`);
}


export async function setCurrentStop(tripId: number, stopOrder: number) {
  return apiFetch<{ trip_id: number; stop_order: number; released_seats: number }>(
    `/api/trips/${tripId}/current-stop`,
    { method: 'PATCH', body: JSON.stringify({ stop_order: stopOrder }) },
  );
}

export async function searchTrips(boardStop?: string, alightStop?: string) {
  const params = new URLSearchParams();
  if (boardStop) params.set('board_stop', boardStop);
  if (alightStop) params.set('alight_stop', alightStop);
  const qs = params.toString();
  return apiFetch<{ results: TripSearchResult[] }>(`/api/trips/search${qs ? `?${qs}` : ''}`);
}

export async function fetchSegmentFare(tripId: number, boardOrder: number, alightOrder: number) {
  return apiFetch<{ trip_id: number; board_order: number; alight_order: number; hop_count: number; fare: number }>(
    `/api/trips/${tripId}/fare?board_order=${boardOrder}&alight_order=${alightOrder}`
  );
}

export async function paystackInitialize(bookingId: number, callbackUrl?: string) {
  return apiFetch<PaystackInitResponse>('/api/pay/paystack/initialize', {
    method: 'POST',
    body: JSON.stringify({ booking_id: bookingId, callback_url: callbackUrl }),
  });
}

export async function paystackVerify(reference: string) {
  return apiFetch<PaystackVerifyResponse>(`/api/pay/paystack/verify/${encodeURIComponent(reference)}`);
}

// ---------------------------------------------------------------------------
// Admin: drivers, analytics, payment log
// ---------------------------------------------------------------------------
export async function fetchAdminDrivers() {
  return apiFetch<{ drivers: DriverRow[] }>('/api/admin/drivers');
}

export async function createDriver(data: { full_name: string; email: string; phone?: string; password: string }) {
  return apiFetch<DriverRow>('/api/admin/drivers', { method: 'POST', body: JSON.stringify(data) });
}

export async function fetchAdminAnalytics() {
  return apiFetch<AdminAnalytics>('/api/admin/analytics');
}

export async function fetchAdminPayments(limit = 50) {
  return apiFetch<{ payments: PaymentRow[] }>(`/api/admin/payments?limit=${limit}`);
}

export interface PaymentDiagnostics {
  summary: {
    total_transactions: number;
    completed: number;
    failed: number;
    initiated: number;
    total_revenue: number;
    success_rate_percent: number;
  };
  gateways: {
    paystack: {
      name: string;
      configured: boolean;
      mode: string;
      public_key: string;
      supported_channels: string[];
    };
    mpesa_daraja: {
      name: string;
      configured: boolean;
      mode: string;
      shortcode: string;
    };
  };
  provider_breakdown: { provider: string; count: number; total: number }[];
  recent_transactions: {
    id: number;
    provider: string;
    provider_reference?: string | null;
    amount: number;
    status: string;
    callback_verified: boolean;
    created_at: string | null;
    booking_id: number;
    trip_id: number;
    seat_number: number;
    passenger_name?: string | null;
  }[];
}

export async function claimSeatInterest(interestId: number) {
  return apiFetch<{
    status: string;
    booking_id: number;
    payment_id: number;
    seat_number: number;
    amount: number;
    message: string;
  }>(`/api/seat-interests/${interestId}/claim`, { method: 'POST' });
}

export async function fetchPaymentDiagnostics() {
  return apiFetch<PaymentDiagnostics>('/api/admin/payments/diagnostics');
}

export async function testPaymentWebhook(data: {
  provider?: string;
  booking_id?: number;
  reference?: string;
  amount?: number;
}) {
  return apiFetch<{
    status: string;
    message: string;
    payment_id: number;
    booking_id: number;
    reference: string;
    amount: number;
  }>('/api/admin/payments/test-webhook', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// // Item F: Luggage & Parcel (Mzigo) Services — Flexible Door-to-Door & Station
// ---------------------------------------------------------------------------
export type ParcelPickupType = 'station' | 'doorstep';
export type ParcelDeliveryType = 'station' | 'doorstep';

export interface ParcelTimelineStep {
  step: number;
  label: string;
  desc: string;
  done: boolean;
  current: boolean;
}

export interface Parcel {
  id: number;
  trip_id: number;
  sender_id?: number | null;
  sender_name: string;
  sender_phone: string;
  recipient_name: string;
  recipient_phone: string;
  pickup_stop_order: number;
  dropoff_stop_order: number;
  pickup_stop_name?: string;
  dropoff_stop_name?: string;
  tracking_code: string;
  security_pin?: string;
  category: 'small_envelope' | 'small_box' | 'medium_box' | 'heavy_sack' | 'special_fragile' | string;
  description: string;
  weight_kg?: number | null;
  fee: number;
  base_fare?: number;
  pickup_fee?: number;
  delivery_fee?: number;
  pickup_type: ParcelPickupType;
  delivery_type: ParcelDeliveryType;
  sender_address?: string | null;
  sender_city_or_area?: string | null;
  sender_pickup_notes?: string | null;
  recipient_address?: string | null;
  recipient_city_or_area?: string | null;
  recipient_delivery_notes?: string | null;
  declared_value?: number | null;
  courier_rider_phone?: string | null;
  payment_status: string;
  status:
    | 'registered'
    | 'pickup_dispatched'
    | 'received_at_hub'
    | 'loaded'
    | 'in_transit'
    | 'arrived_at_hub'
    | 'out_for_delivery'
    | 'ready_for_collection'
    | 'delivered'
    | 'returned'
    | string;
  loaded_at?: string | null;
  delivered_at?: string | null;
  created_at?: string | null;
  trip_name?: string;
  vehicle_plate?: string | null;
  timeline?: ParcelTimelineStep[];
}

export interface ParcelQuoteRequest {
  category?: string;
  weight_kg?: number;
  pickup_type: ParcelPickupType;
  delivery_type: ParcelDeliveryType;
  declared_value?: number;
  origin_city?: string;
  destination_city?: string;
  trip_id?: number;
}

export interface ParcelQuoteResponse {
  category: string;
  weight_kg: number;
  pickup_type: string;
  delivery_type: string;
  base_fare: number;
  pickup_fee: number;
  delivery_fee: number;
  insurance_fee: number;
  total_fee: number;
  savings_vs_door_to_door: number;
  delivery_mode_label: string;
  estimated_transit_hours: number;
}

export interface ParcelBookingRequest {
  trip_id?: number;
  origin_city?: string;
  destination_city?: string;
  sender_name: string;
  sender_phone: string;
  recipient_name: string;
  recipient_phone: string;
  category?: string;
  description: string;
  weight_kg?: number;
  pickup_type: ParcelPickupType;
  delivery_type: ParcelDeliveryType;
  sender_address?: string | null;
  sender_city_or_area?: string | null;
  sender_pickup_notes?: string | null;
  recipient_address?: string | null;
  recipient_city_or_area?: string | null;
  recipient_delivery_notes?: string | null;
  declared_value?: number;
  pickup_stop_order?: number;
  dropoff_stop_order?: number | null;
  payment_method?: 'mpesa' | 'cash_at_station';
}

export interface ParcelBookingResponse {
  ok: boolean;
  parcel_id: number;
  tracking_code: string;
  security_pin: string;
  fee: number;
  base_fare: number;
  pickup_fee: number;
  delivery_fee: number;
  pickup_type: string;
  delivery_type: string;
  status: string;
  dispatch?: any;
  message: string;
}

export interface TripParcelsResponse {
  trip_id: number;
  parcels: Parcel[];
  cargo_count: number;
  luggage_summary: {
    booking_count?: number;
    total_bags?: number;
    total_luggage_fee?: number;
  };
}

export async function fetchTripParcels(tripId: number) {
  return apiFetch<TripParcelsResponse>(`/api/trips/${tripId}/parcels`);
}

export async function getParcelQuote(req: ParcelQuoteRequest) {
  return apiFetch<ParcelQuoteResponse>('/api/parcels/quote', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function bookParcel(req: ParcelBookingRequest) {
  return apiFetch<ParcelBookingResponse>('/api/parcels/book', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function registerTripParcel(tripId: number, data: {
  sender_name: string;
  sender_phone: string;
  recipient_name: string;
  recipient_phone: string;
  pickup_stop_order: number;
  dropoff_stop_order: number;
  category: string;
  description: string;
  weight_kg?: number;
  fee?: number;
  payment_status?: string;
  pickup_type?: 'station' | 'doorstep';
  delivery_type?: 'station' | 'doorstep';
  sender_address?: string;
  recipient_address?: string;
}) {
  return apiFetch<{
    ok: boolean;
    parcel_id: number;
    tracking_code: string;
    security_pin: string;
    fee: number;
    status: string;
    dispatch: any;
    message: string;
  }>(`/api/trips/${tripId}/parcels`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateParcelStatus(parcelId: number, data: {
  status: string;
  security_pin?: string;
  courier_rider_phone?: string;
  courier_notes?: string;
}) {
  return apiFetch<{
    ok: boolean;
    parcel_id: number;
    tracking_code: string;
    status: string;
    message: string;
  }>(`/api/parcels/${parcelId}/status`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function trackParcelPublic(trackingCode: string) {
  return apiFetch<{
    parcel: Parcel & {
      trip_name?: string;
      current_stop_order?: number;
      current_lat?: number;
      current_lng?: number;
      current_speed?: number;
      last_gps_at?: string;
      vehicle_plate?: string;
      all_route_stops?: { stop_name: string; stop_order: number }[];
    };
  }>(`/api/parcels/track/${encodeURIComponent(trackingCode)}`);
}

export async function dispatchParcel(parcelId: number) {
  return apiFetch<{ ok: boolean; dispatch: any }>(`/api/parcels/${parcelId}/dispatch`, {
    method: 'POST',
  });
}

export interface CronStats {
  status: string;
  worker_running: boolean;
  last_run: string | null;
  runs_count: number;
  total_swept_bookings: number;
  total_expired_waitlists: number;
  total_completed_trips: number;
  total_reminders_dispatched: number;
  last_error: string | null;
  last_results: any;
}

export async function fetchCronStats(): Promise<CronStats> {
  return apiFetch<CronStats>('/api/admin/crons/stats');
}

export async function triggerCronSweep(): Promise<{
  ok: boolean;
  message: string;
  results: any;
  stats: CronStats;
}> {
  return apiFetch('/api/admin/crons/trigger', { method: 'POST' });
}

// ---------------------------------------------------------------------------
// SACCO & Fleet Compliance (NTSA)
// ---------------------------------------------------------------------------

export async function fetchSaccos(): Promise<{ saccos: Sacco[] }> {
  return apiFetch<{ saccos: Sacco[] }>('/api/saccos');
}

export async function fetchSacco(id: number): Promise<{ sacco: Sacco; vehicles: Vehicle[]; routes: Route[] }> {
  return apiFetch<{ sacco: Sacco; vehicles: Vehicle[]; routes: Route[] }>(`/api/saccos/${id}`);
}

export async function createSacco(payload: {
  name: string;
  slug: string;
  registration_no?: string;
  headquarters?: string;
  contact_phone?: string;
  contact_email?: string;
  primary_color?: string;
  accent_color?: string;
}): Promise<Sacco> {
  return apiFetch<Sacco>('/api/saccos', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateSacco(id: number, payload: Partial<Sacco>): Promise<Sacco> {
  return apiFetch<Sacco>(`/api/saccos/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function fetchFleetCompliance(saccoId?: number): Promise<{ compliance: VehicleCompliance[] }> {
  const query = saccoId ? `?sacco_id=${saccoId}` : '';
  return apiFetch<{ compliance: VehicleCompliance[] }>(`/api/compliance/fleet${query}`);
}

export async function updateVehicleCompliance(
  vehicleId: number,
  payload: {
    speed_governor_vendor?: string;
    speed_governor_cert?: string;
    speed_governor_expiry?: string;
    ntsa_inspection_cert?: string;
    ntsa_inspection_expiry?: string;
    insurance_underwriter?: string;
    insurance_policy_no?: string;
    insurance_expiry?: string;
  }
): Promise<VehicleCompliance> {
  return apiFetch<VehicleCompliance>(`/api/compliance/vehicles/${vehicleId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function toggleVehicleGrounding(
  vehicleId: number,
  isGrounded: boolean,
  reason?: string
): Promise<{ ok: boolean; message: string; vehicle_id: number; is_grounded: boolean }> {
  return apiFetch(`/api/compliance/vehicles/${vehicleId}/ground`, {
    method: 'POST',
    body: JSON.stringify({ is_grounded: isGrounded, reason }),
  });
}

export async function runComplianceSweeper(): Promise<{
  ok: boolean;
  message: string;
  results: ComplianceSweeperResult;
}> {
  return apiFetch('/api/compliance/run-sweeper', {
    method: 'POST',
  });
}

export async function fetchComplianceSummary(saccoId?: number): Promise<ComplianceSummary> {
  const query = saccoId ? `?sacco_id=${saccoId}` : '';
  return apiFetch<ComplianceSummary>(`/api/compliance/summary${query}`);
}

export async function updateDriverPsvBadge(
  driverId: number,
  data: { psv_badge_number: string; psv_badge_expiry: string }
): Promise<{ ok: boolean; message: string; driver_id: number; sweep_res: ComplianceSweeperResult }> {
  return apiFetch(`/api/compliance/drivers/${driverId}/psv-badge`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Loyalty: Commuter Safari Points (Option 7)
// ---------------------------------------------------------------------------
export interface LoyaltyInfo {
  points: number;
  cash_value_kes: number;
  tier: string;
  history: {
    id: number;
    points: number;
    description: string;
    created_at: string | null;
  }[];
}

export async function fetchMyLoyalty(): Promise<LoyaltyInfo> {
  return apiFetch<LoyaltyInfo>('/api/loyalty/me');
}

export async function redeemLoyaltyPoints(
  bookingId: number,
  pointsToRedeem: number
): Promise<{ ok: boolean; discount_kes: number; remaining_points: number; message: string }> {
  return apiFetch('/api/loyalty/redeem', {
    method: 'POST',
    body: JSON.stringify({ booking_id: bookingId, points_to_redeem: pointsToRedeem }),
  });
}

// ---------------------------------------------------------------------------
// Highway Incidents, Delays & Relief Bus Dispatch (Option 6)
// ---------------------------------------------------------------------------
export interface IncidentItem {
  id: number;
  trip_id: number;
  trip_name: string;
  sacco_name: string;
  reported_by: string;
  category: string;
  severity: string;
  estimated_delay_mins: number;
  location_name: string;
  description: string;
  status: string;
  created_at: string | null;
}

export async function reportIncident(payload: {
  trip_id: number;
  category: string;
  severity?: string;
  estimated_delay_mins?: number;
  location_name: string;
  lat?: number;
  lng?: number;
  description: string;
  broadcast_delay?: boolean;
}): Promise<{ ok: boolean; message: string; incident_id: number }> {
  return apiFetch('/api/incidents', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchIncidents(saccoId?: number, status?: string): Promise<{ incidents: IncidentItem[] }> {
  const params = new URLSearchParams();
  if (saccoId) params.append('sacco_id', String(saccoId));
  if (status) params.append('status', status);
  const q = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<{ incidents: IncidentItem[] }>(`/api/incidents${q}`);
}

export async function dispatchReliefBus(
  incidentId: number,
  payload: {
    relief_vehicle_id: number;
    relief_driver_id?: number;
    notes?: string;
  }
): Promise<{ ok: boolean; message: string; new_plate: string; passengers_transferred: number }> {
  return apiFetch(`/api/incidents/${incidentId}/relief`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function resolveIncident(incidentId: number): Promise<{ ok: boolean; message: string }> {
  return apiFetch(`/api/incidents/${incidentId}/resolve`, {
    method: 'PATCH',
  });
}

// ---------------------------------------------------------------------------
// National Fleet Radar (Option 1)
// ---------------------------------------------------------------------------

export async function fetchRadarFleet(corridor?: string): Promise<RadarFleetResponse> {
  const q = corridor ? `?corridor=${encodeURIComponent(corridor)}` : '';
  return apiFetch<RadarFleetResponse>(`/api/radar/fleet${q}`);
}

// ---------------------------------------------------------------------------
// SACCO Treasury & Daraja B2C Settlements (Option 2)
// ---------------------------------------------------------------------------

export async function fetchSettlementSummary(saccoId?: number): Promise<SaccoSettlementSummary> {
  const q = saccoId ? `?sacco_id=${saccoId}` : '';
  return apiFetch<SaccoSettlementSummary>(`/api/settlements/summary${q}`);
}

export async function withdrawSaccoFunds(payload: SaccoWithdrawRequest): Promise<{
  ok: boolean;
  message: string;
  settlement_id: number;
  b2c_transaction_id: string;
  b2c_conversation_id: string;
  gross_amount: number;
  platform_fee: number;
  net_payout: number;
  recipient_phone: string;
  recipient_name: string;
}> {
  return apiFetch('/api/settlements/withdraw', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface VehicleRevenueSplitItem {
  vehicle_id: number;
  plate_number: string;
  vehicle_model: string;
  purpose: string;
  sacco_id?: number | null;
  sacco_name: string;
  owner_name: string;
  owner_phone: string;
  trips_count: number;
  gross_revenue: number;
  fuel_deduction: number;
  conductor_commission: number;
  other_expenses: number;
  sacco_levy: number;
  platform_fee: number;
  net_earned: number;
  total_disbursed: number;
  available_for_owner: number;
}

export interface VehicleRevenueSplitsResponse {
  sacco_id?: number | null;
  total_vehicles: number;
  totals: {
    gross_revenue: number;
    fuel_deductions: number;
    conductor_commissions: number;
    sacco_levies: number;
    platform_fees: number;
    net_dividends: number;
    available_payout: number;
  };
  vehicles: VehicleRevenueSplitItem[];
}

export async function fetchVehicleRevenueSplits(saccoId?: number): Promise<VehicleRevenueSplitsResponse> {
  const q = saccoId ? `?sacco_id=${saccoId}` : '';
  return apiFetch<VehicleRevenueSplitsResponse>(`/api/settlements/vehicle-splits${q}`);
}

export async function disburseVehicleOwnerDividend(payload: {
  vehicle_id: number;
  amount?: number;
  recipient_phone?: string;
  recipient_name?: string;
  notes?: string;
}): Promise<{
  ok: boolean;
  message: string;
  settlement_id: number;
  vehicle_id: number;
  plate_number: string;
  b2c_transaction_id: string;
  b2c_conversation_id: string;
  net_payout: number;
  recipient_phone: string;
  recipient_name: string;
  status: string;
  simulated?: boolean;
}> {
  return apiFetch('/api/settlements/disburse-vehicle-owner', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function batchDisburseAllOwners(payload: {
  sacco_id?: number;
  min_amount?: number;
  notes?: string;
}): Promise<{
  ok: boolean;
  message: string;
  disbursed_count: number;
  total_disbursed: number;
  results: Array<{
    vehicle_id: number;
    plate_number: string;
    owner_name: string;
    phone: string;
    amount: number;
    status: string;
    transaction_id?: string;
    error?: string;
  }>;
}> {
  return apiFetch('/api/settlements/batch-disburse-owners', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}


// ---------------------------------------------------------------------------
// EV Fleet & Telemetry (Option 4)
// ---------------------------------------------------------------------------

export async function fetchEvFleet(): Promise<EvFleetResponse> {
  return apiFetch<EvFleetResponse>('/api/ev/fleet');
}

export async function recordEvTelemetry(payload: {
  vehicle_id: number;
  battery_soc_pct: number;
  battery_temp_c?: number;
  estimated_range_km?: number;
  charging_status?: string;
  power_consumption_kwh_per_km?: number;
  co2_saved_kg?: number;
  regen_braking_kwh?: number;
}): Promise<{ ok: boolean; message: string; battery_soc_pct: number; estimated_range_km: number }> {
  return apiFetch('/api/ev/telemetry', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchChargingStations(corridor?: string): Promise<ChargingStationsResponse> {
  const q = corridor ? `?corridor=${encodeURIComponent(corridor)}` : '';
  return apiFetch<ChargingStationsResponse>(`/api/ev/charging-stations${q}`);
}

// ---------------------------------------------------------------------------
// Bei ya Mfuko (Pocket Fare / Budget Hop Finder)
// ---------------------------------------------------------------------------

export async function fetchBudgetReach(
  tripId: number,
  boardOrder: number,
  budget: number,
  intendedAlightOrder?: number
): Promise<BudgetReachResponse> {
  const params = new URLSearchParams({
    board_order: String(boardOrder),
    budget: String(budget),
  });
  if (intendedAlightOrder) {
    params.set('intended_alight_order', String(intendedAlightOrder));
  }
  return apiFetch<BudgetReachResponse>(`/api/trips/${tripId}/budget-reach?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// 1. "Changa na Marafiki" (Group Split Fare)
// ---------------------------------------------------------------------------

export async function createGroupBooking(payload: {
  trip_id: number;
  group_name: string;
  board_stop_order: number;
  alight_stop_order: number;
  members: { seat_number: number; passenger_name: string; phone_number: string }[];
}): Promise<GroupBooking> {
  return apiFetch<GroupBooking>('/api/group-bookings', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchGroupBooking(groupId: number): Promise<GroupBooking> {
  return apiFetch<GroupBooking>(`/api/group-bookings/${groupId}`);
}

export async function payGroupShare(
  groupId: number,
  memberId: number,
  phoneNumber?: string
): Promise<{
  success: boolean;
  member_id: number;
  passenger_name: string;
  seat_number: number;
  amount_paid: number;
  mpesa_receipt: string;
  group_status: string;
  group_paid_amount: number;
  group_total_amount: number;
  is_fully_paid: boolean;
}> {
  return apiFetch(`/api/group-bookings/${groupId}/pay-share`, {
    method: 'POST',
    body: JSON.stringify({ member_id: memberId, phone_number: phoneNumber }),
  });
}

// ---------------------------------------------------------------------------
// 2. Stage Dispatcher / "Kondakta" Walk-In POS & Cash Reconciler
// ---------------------------------------------------------------------------

export async function createWalkInBooking(payload: {
  trip_id: number;
  seat_number: number;
  board_stop_order: number;
  alight_stop_order: number;
  passenger_name?: string;
  passenger_phone?: string;
  fare_amount: number;
  notes?: string;
}): Promise<{
  booking_id: number;
  trip_id: number;
  seat_number: number;
  passenger_name: string;
  receipt_number: string;
  amount_paid: number;
  payment_method: string;
  status: string;
}> {
  return apiFetch('/api/dispatcher/walkin-booking', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchDispatcherManifest(tripId: number): Promise<StageManifest> {
  return apiFetch<StageManifest>(`/api/dispatcher/trips/${tripId}/manifest`);
}

export async function reconcileStageTrip(payload: {
  trip_id: number;
  fuel_deduction: number;
  conductor_commission: number;
  other_expenses: number;
  notes?: string;
}): Promise<StageReconciliation> {
  return apiFetch<StageReconciliation>('/api/dispatcher/reconcile', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// 4. "Nipe Shugli" — Highway Lost & Found Registry
// ---------------------------------------------------------------------------

export async function reportLostFoundItem(payload: {
  trip_id?: number;
  sacco_id?: number;
  item_type: 'lost' | 'found';
  category: string;
  title: string;
  description: string;
  location_or_station: string;
  contact_name: string;
  contact_phone: string;
}): Promise<LostFoundItem & { message: string }> {
  return apiFetch('/api/lost-found', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchLostFoundItems(params?: {
  item_type?: string;
  category?: string;
  status?: string;
  q?: string;
}): Promise<{ items: LostFoundItem[]; count: number }> {
  const qp = new URLSearchParams();
  if (params?.item_type) qp.set('item_type', params.item_type);
  if (params?.category) qp.set('category', params.category);
  if (params?.status) qp.set('status', params.status);
  if (params?.q) qp.set('q', params.q);
  const queryStr = qp.toString() ? `?${qp.toString()}` : '';
  return apiFetch(`/api/lost-found${queryStr}`);
}

export async function claimLostFoundItem(
  itemId: number,
  payload: { claimant_phone: string; claimant_notes?: string }
): Promise<{ id: number; title: string; status: string; claimant_phone: string; message: string }> {
  return apiFetch(`/api/lost-found/${itemId}/claim`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// 5. Highway Blackspots & Proximity Radar
// ---------------------------------------------------------------------------

export async function fetchHighwayBlackspots(): Promise<{ blackspots: HighwayBlackspot[]; count: number }> {
  return apiFetch('/api/highway/blackspots');
}

export async function checkBlackspotProximity(
  lat: number,
  lng: number,
  currentSpeedKmh?: number
): Promise<{ in_danger_zone: boolean; alerts_count: number; alerts: BlackspotProximityAlert[] }> {
  return apiFetch('/api/highway/check-proximity', {
    method: 'POST',
    body: JSON.stringify({ lat, lng, current_speed_kmh: currentSpeedKmh }),
  });
}

// ---------------------------------------------------------------------------
// 6. Stage B2C Automated Payouts & Dispatches Outbox
// ---------------------------------------------------------------------------

export async function disburseStagePayoutB2C(
  payload: StageB2CPayoutRequest
): Promise<StageB2CPayoutResponse> {
  return apiFetch('/api/dispatcher/payout-b2c', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchDispatchOutbox(
  limit: number = 50,
  channel?: string
): Promise<{ outbox: DispatchOutboxItem[] }> {
  const qp = new URLSearchParams();
  if (limit) qp.set('limit', limit.toString());
  if (channel) qp.set('channel', channel);
  const queryStr = qp.toString() ? `?${qp.toString()}` : '';
  return apiFetch(`/api/dispatches/outbox${queryStr}`);
}

// ---------------------------------------------------------------------------
// 7. Hardware GPS Tracker Telemetry (Teltonika / Concox GT06)
// ---------------------------------------------------------------------------

export async function fetchHardwareTrackers(): Promise<TrackersListResponse> {
  return apiFetch<TrackersListResponse>('/api/telemetry/trackers');
}

export async function bindHardwareTracker(
  payload: BindTrackerRequest
): Promise<BindTrackerResponse> {
  return apiFetch<BindTrackerResponse>('/api/telemetry/trackers/bind', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchTrackerHistory(
  imei: string,
  limit: number = 100
): Promise<TrackerHistoryResponse> {
  return apiFetch<TrackerHistoryResponse>(
    `/api/telemetry/trackers/${encodeURIComponent(imei)}/history?limit=${limit}`
  );
}

export async function fetchOverspeedAlerts(
  limit: number = 50
): Promise<OverspeedAlertsResponse> {
  return apiFetch<OverspeedAlertsResponse>(
    `/api/telemetry/overspeed-alerts?limit=${limit}`
  );
}

export async function ingestGenericTelemetry(
  payload: GenericTelemetryIngestRequest
): Promise<{
  status: string;
  vehicle_id?: number;
  plate_number: string;
  trip_id?: number;
  speed_kmh: number;
  overspeed_warning: boolean;
  coordinates: { lat: number; lng: number };
}> {
  return apiFetch('/api/telemetry/ingest/generic', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function ingestHardwareHexFrame(
  protocol: 'teltonika' | 'concox',
  hexData: string,
  imei?: string
): Promise<{
  status: string;
  records_count?: number;
  packet_type?: string;
  ack_hex?: string;
}> {
  return apiFetch(`/api/telemetry/ingest/${protocol}`, {
    method: 'POST',
    body: JSON.stringify({ hex_data: hexData, imei }),
  });
}

// ---------------------------------------------------------------------------
// 8. Handheld Thermal POS Bluetooth Slip Printing (ESC/POS)
// ---------------------------------------------------------------------------

export async function fetchBookingEscPosSlip(
  bookingId: number,
  widthMm: 58 | 80 = 58,
  output: 'base64' | 'ascii' | 'binary' = 'base64'
): Promise<{
  ok: boolean;
  booking_id: number;
  width_mm: number;
  base64?: string;
  ascii_preview?: string;
  ticket?: any;
}> {
  return apiFetch(`/api/bookings/${bookingId}/escpos?width=${widthMm}&output=${output}`);
}

export async function fetchParcelEscPosSlip(
  parcelId: number,
  widthMm: 58 | 80 = 58,
  output: 'base64' | 'ascii' | 'binary' = 'base64'
): Promise<{
  ok: boolean;
  parcel_id: number;
  width_mm: number;
  base64?: string;
  parcel?: any;
}> {
  return apiFetch(`/api/parcels/${parcelId}/escpos?width=${widthMm}&output=${output}`);
}

// ---------------------------------------------------------------------------
// 9. USSD (*384#) Interface for Non-Smartphone Passengers
// ---------------------------------------------------------------------------

export interface UssdSimulateResponse {
  status: 'CON' | 'END';
  raw_response: string;
  message: string;
  session_id: string;
  phone_number: string;
  inputs: string[];
}

export interface UssdSessionRecord {
  id: number;
  session_id: string;
  phone_number: string;
  language: string;
  current_menu: string;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface UssdLogRecord {
  id: number;
  session_id: string;
  phone_number: string;
  input_text: string | null;
  menu_state: string;
  response_text: string;
  created_at: string | null;
}

export async function simulateUssdRequest(payload: {
  sessionId?: string;
  phoneNumber: string;
  text?: string;
  serviceCode?: string;
}): Promise<UssdSimulateResponse> {
  return apiFetch('/api/ussd/simulate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchUssdSessions(limit: number = 50): Promise<{
  count: number;
  sessions: UssdSessionRecord[];
}> {
  return apiFetch(`/api/ussd/sessions?limit=${limit}`);
}

export async function fetchUssdLogs(limit: number = 100): Promise<{
  count: number;
  logs: UssdLogRecord[];
}> {
  return apiFetch(`/api/ussd/logs?limit=${limit}`);
}








