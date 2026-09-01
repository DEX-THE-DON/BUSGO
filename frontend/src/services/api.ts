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
// Types — shared with the backend (@busgo/types), so frontend API types can
// never drift from the server's Zod/Pydantic schemas.
// ---------------------------------------------------------------------------
import type {
  AdminAnalytics,
  AppNotification,
  AuthResponse,
  Booking,
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
  User,
  Vehicle,
  VehicleType,
} from '@busgo/types';

export type {
  AdminAnalytics,
  AppNotification,
  AuthResponse,
  Booking,
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
  User,
  Vehicle,
  VehicleType,
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

export async function fetchManifest(tripId: number) {
  return apiFetch<{ trip_id: number; manifest: ManifestEntry[] }>(`/api/trips/${tripId}/manifest`);
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
