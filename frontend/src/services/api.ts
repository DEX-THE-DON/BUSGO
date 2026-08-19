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
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface User {
  id: number;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  role: 'admin' | 'driver' | 'user';
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface Booking {
  id: number;
  trip_id: number;
  seat_number: number;
  board_stop_order: number;
  alight_stop_order: number;
  status: string;
  payment_status: string;
  created_at: string | null;
  trip_name: string;
  trip_status: string;
  route_name: string;
  board_stop: string | null;
  alight_stop: string | null;
}

export interface Vehicle {
  id: number;
  plate_number: string;
  vehicle_type_id: number;
  is_electric: boolean;
  category: string;
  vehicle_type_name: string;
  seat_capacity: number;
}

export interface VehicleType {
  id: number;
  slug: string;
  display_name: string;
  seat_capacity: number;
  seat_layout?: { columns: number; rows: number[][] } | null;
}

export interface RouteStop {
  id: number;
  stop_name: string;
  stop_order: number;
}

export interface Route {
  id: number;
  name: string;
  country: string;
  route_type: 'direct' | 'stopwise';
  stops: RouteStop[];
}

export interface TripRow {
  id: number;
  name: string;
  status: string;
  scheduled_at: string | null;
  route_name: string;
  route_type?: 'direct' | 'stopwise';
  plate_number: string | null;
  is_electric?: boolean;
  seat_capacity?: number | null;
  seat_layout?: { columns: number; rows: number[][] } | null;
  current_stop_order?: number | null;
}

// ---------------------------------------------------------------------------
// Public / passenger endpoints
// ---------------------------------------------------------------------------
export interface TripStop {
  id: number;
  stop_name: string;
  stop_order: number;
}

export interface TripOption {
  id: number;
  name: string;
  status: string;
  scheduled_at: string | null;
  route_id: number;
  route_name: string;
  route_type?: 'direct' | 'stopwise';
  vehicle_id: number | null;
  plate_number: string | null;
  is_electric?: boolean;
  vehicle_type?: string | null;
  seat_capacity: number | null;
  seat_layout?: { columns: number; rows: number[][] } | null;
  current_stop_order?: number | null;
}

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
}) {
  return apiFetch<{ status: string; booking_id: number; payment_id: number; message: string }>('/api/book-seat', {
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
  return apiFetch<{ vehicle_types: VehicleType[] }>('/api/admin/vehicle-types');
}

export async function createVehicleType(data: { slug: string; display_name: string; seat_capacity: number }) {
  return apiFetch<VehicleType>('/api/admin/vehicle-types', { method: 'POST', body: JSON.stringify(data) });
}

export async function fetchAdminVehicles() {
  return apiFetch<{ vehicles: Vehicle[] }>('/api/admin/vehicles');
}

export async function createVehicle(data: { plate_number: string; vehicle_type_id: number; is_electric: boolean }) {
  return apiFetch<Vehicle>('/api/admin/vehicles', { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteVehicle(vehicleId: number) {
  return apiFetch<{ deleted: number }>(`/api/admin/vehicles/${vehicleId}`, { method: 'DELETE' });
}

export async function createRoute(data: { name: string; country?: string; route_type?: 'direct' | 'stopwise'; stops: string[] }) {
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
}) {
  return apiFetch<{ id: number; name: string; status: string }>('/api/admin/trips', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateTrip(
  tripId: number,
  data: { name?: string; status?: string; driver_id?: number | null; vehicle_id?: number | null },
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

export interface ManifestEntry {
  seat_number: number;
  user_id: number | null;
  full_name: string | null;
  phone: string | null;
  board_stop_order: number;
  alight_stop_order: number;
  board_stop: string | null;
  alight_stop: string | null;
}

export async function fetchManifest(tripId: number) {
  return apiFetch<{ trip_id: number; manifest: ManifestEntry[] }>(`/api/trips/${tripId}/manifest`);
}


// ---------------------------------------------------------------------------
// Seat map, chains, waitlist & notifications (the relay feature)
// ---------------------------------------------------------------------------
export interface SeatMapEntry {
  seat_number: number;
  state: 'free' | 'partial' | 'full';
  next_free_stop: string | null;
  next_free_stop_order: number | null;
}

export async function fetchSeatMap(tripId: number, boardOrder: number, alightOrder: number) {
  return apiFetch<{
    trip_id: number;
    seat_capacity: number;
    board_order: number;
    alight_order: number;
    seats: SeatMapEntry[];
  }>(`/api/trips/${tripId}/seat-map?board_order=${boardOrder}&alight_order=${alightOrder}`);
}

export interface ChainLink {
  booking_id: number;
  board_stop_order: number;
  alight_stop_order: number;
  board_stop: string | null;
  alight_stop: string | null;
  passenger_name: string;
}

export async function fetchTripChains(tripId: number) {
  return apiFetch<{ trip_id: number; seat_capacity: number; chains: { seat_number: number; links: ChainLink[] }[] }>(
    `/api/trips/${tripId}/chains`,
  );
}

export interface SeatInterest {
  id: number;
  trip_id: number;
  board_stop_order: number;
  alight_stop_order: number;
  seat_number: number | null;
  status: string;
  created_at: string | null;
  trip_name: string;
  route_name: string;
  board_stop: string | null;
  alight_stop: string | null;
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

export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  payload: Record<string, unknown> | null;
  read: boolean;
  created_at: string | null;
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

export async function payDarajaStk(data: { booking_id: number; phone_number: string; amount: number }) {
  return apiFetch<{ status: string; message: string; checkout_request_id: string; booking_id: number }>(
    '/api/pay/daraja/stk',
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export async function setCurrentStop(tripId: number, stopOrder: number) {
  return apiFetch<{ trip_id: number; stop_order: number; released_seats: number }>(
    `/api/trips/${tripId}/current-stop`,
    { method: 'PATCH', body: JSON.stringify({ stop_order: stopOrder }) },
  );
}

// ---------------------------------------------------------------------------
// Admin: drivers, analytics, payment log
// ---------------------------------------------------------------------------
export interface DriverRow {
  id: number;
  full_name: string;
  email: string;
  phone: string | null;
  created_at: string | null;
}

export async function fetchAdminDrivers() {
  return apiFetch<{ drivers: DriverRow[] }>('/api/admin/drivers');
}

export async function createDriver(data: { full_name: string; email: string; phone?: string; password: string }) {
  return apiFetch<DriverRow>('/api/admin/drivers', { method: 'POST', body: JSON.stringify(data) });
}

export interface AdminAnalytics {
  revenue: {
    total_revenue: number;
    paid_bookings: number;
    completed_payments: number;
    failed_payments: number;
  };
  bookings_per_day: { day: string; bookings: number }[];
  occupancy: { id: number; name: string; route_name: string; seat_capacity: number | null; seats_taken: number }[];
}

export async function fetchAdminAnalytics() {
  return apiFetch<AdminAnalytics>('/api/admin/analytics');
}

export interface PaymentRow {
  id: number;
  provider: string;
  status: string;
  amount: number;
  phone_number: string | null;
  provider_reference: string | null;
  callback_verified: boolean;
  created_at: string | null;
  trip_id: number;
  seat_number: number;
}

export async function fetchAdminPayments(limit = 50) {
  return apiFetch<{ payments: PaymentRow[] }>(`/api/admin/payments?limit=${limit}`);
}
