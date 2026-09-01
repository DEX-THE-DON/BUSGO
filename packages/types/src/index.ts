import { z } from 'zod';

/**
 * BUSGO shared API contracts — the single source of truth for types used by
 * both the server (`@busgo/server`) and the frontend (`frontend`).
 *
 * Every schema mirrors a Pydantic model (or endpoint response) from the
 * original FastAPI backend 1:1, so JSON wire-compatibility is preserved.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const RoleSchema = z.enum(['admin', 'driver', 'user']);
export type Role = z.infer<typeof RoleSchema>;

export const SeatLayoutSchema = z.object({
  columns: z.number().int(),
  rows: z.array(z.array(z.number().int())),
});
export type SeatLayout = z.infer<typeof SeatLayoutSchema>;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const UserSchema = z.object({
  id: z.number(),
  full_name: z.string(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  role: RoleSchema,
});
export type User = z.infer<typeof UserSchema>;

export const AuthResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string().default('bearer'),
  user: UserSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const RegisterRequestSchema = z.object({
  full_name: z.string(),
  email: z.string(),
  phone: z.string().nullish(),
  password: z.string(),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string(),
  password: z.string(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

// ---------------------------------------------------------------------------
// Trips & routes (public)
// ---------------------------------------------------------------------------

export const TripOptionSchema = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string(),
  scheduled_at: z.string().nullable(),
  current_stop_order: z.number().nullable(),
  route_id: z.number(),
  route_name: z.string(),
  route_type: z.enum(['direct', 'stopwise']).optional(),
  vehicle_id: z.number().nullable(),
  plate_number: z.string().nullable(),
  is_electric: z.boolean().optional(),
  vehicle_type: z.string().nullable().optional(),
  seat_capacity: z.number().nullable(),
  seat_layout: SeatLayoutSchema.nullable().optional(),
});
export type TripOption = z.infer<typeof TripOptionSchema>;

export const TripStopSchema = z.object({
  id: z.number(),
  stop_name: z.string(),
  stop_order: z.number(),
});
export type TripStop = z.infer<typeof TripStopSchema>;

export const RouteStopSchema = z.object({
  id: z.number(),
  stop_name: z.string(),
  stop_order: z.number(),
});
export type RouteStop = z.infer<typeof RouteStopSchema>;

export const RouteSchema = z.object({
  id: z.number(),
  name: z.string(),
  country: z.string(),
  route_type: z.enum(['direct', 'stopwise']),
  stops: z.array(RouteStopSchema),
});
export type Route = z.infer<typeof RouteSchema>;

export const RouteInSchema = z.object({
  name: z.string(),
  country: z.string().default('KE'),
  route_type: z.enum(['direct', 'stopwise']).default('stopwise'),
  stops: z.array(z.string()),
});
export type RouteIn = z.infer<typeof RouteInSchema>;

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

export const BookingRequestSchema = z.object({
  trip_id: z.number().int(),
  seat_number: z.number().int(),
  board_stop_order: z.number().int(),
  alight_stop_order: z.number().int(),
});
export type BookingRequest = z.infer<typeof BookingRequestSchema>;

export const BookSeatResponseSchema = z.object({
  status: z.string(),
  booking_id: z.number(),
  payment_id: z.number(),
  message: z.string(),
});
export type BookSeatResponse = z.infer<typeof BookSeatResponseSchema>;

export const BookingSchema = z.object({
  id: z.number(),
  trip_id: z.number(),
  seat_number: z.number(),
  board_stop_order: z.number(),
  alight_stop_order: z.number(),
  status: z.string(),
  payment_status: z.string(),
  created_at: z.string().nullable(),
  trip_name: z.string(),
  trip_status: z.string(),
  route_name: z.string(),
  board_stop: z.string().nullable(),
  alight_stop: z.string().nullable(),
});
export type Booking = z.infer<typeof BookingSchema>;

export const CancelBookingResponseSchema = z.object({
  deleted: z.number(),
  seat_freed: z.boolean(),
});
export type CancelBookingResponse = z.infer<typeof CancelBookingResponseSchema>;

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const PaymentRequestSchema = z.object({
  phone_number: z.string(),
  amount: z.number(),
  booking_id: z.number().int(),
});
export type PaymentRequest = z.infer<typeof PaymentRequestSchema>;

export const MpesaStkResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
  payment_id: z.number(),
  booking_id: z.number(),
});
export type MpesaStkResponse = z.infer<typeof MpesaStkResponseSchema>;

export const DarajaStkRequestSchema = z.object({
  booking_id: z.number().int(),
  phone_number: z.string(),
  amount: z.number().default(500),
});
export type DarajaStkRequest = z.infer<typeof DarajaStkRequestSchema>;

export const DarajaStkResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
  provider: z.string(),
  checkout_request_id: z.string(),
  booking_id: z.number(),
});
export type DarajaStkResponse = z.infer<typeof DarajaStkResponseSchema>;

export const PaymentRowSchema = z.object({
  id: z.number(),
  provider: z.string(),
  status: z.string(),
  amount: z.number(),
  phone_number: z.string().nullable(),
  provider_reference: z.string().nullable(),
  callback_verified: z.boolean(),
  created_at: z.string().nullable(),
  trip_id: z.number(),
  seat_number: z.number(),
});
export type PaymentRow = z.infer<typeof PaymentRowSchema>;

// ---------------------------------------------------------------------------
// Seat map & relay chains (the core relay feature)
// ---------------------------------------------------------------------------

export const SeatMapEntrySchema = z.object({
  seat_number: z.number(),
  state: z.enum(['free', 'partial', 'full']),
  next_free_stop: z.string().nullable(),
  next_free_stop_order: z.number().nullable(),
});
export type SeatMapEntry = z.infer<typeof SeatMapEntrySchema>;

export const SeatMapResponseSchema = z.object({
  trip_id: z.number(),
  board_order: z.number(),
  alight_order: z.number(),
  seat_capacity: z.number(),
  seats: z.array(SeatMapEntrySchema),
});
export type SeatMapResponse = z.infer<typeof SeatMapResponseSchema>;

export const ChainLinkSchema = z.object({
  booking_id: z.number(),
  board_stop_order: z.number(),
  alight_stop_order: z.number(),
  board_stop: z.string().nullable(),
  alight_stop: z.string().nullable(),
  passenger_name: z.string(),
});
export type ChainLink = z.infer<typeof ChainLinkSchema>;

export const TripChainsResponseSchema = z.object({
  trip_id: z.number(),
  seat_capacity: z.number(),
  chains: z.array(z.object({ seat_number: z.number(), links: z.array(ChainLinkSchema) })),
});
export type TripChainsResponse = z.infer<typeof TripChainsResponseSchema>;

// ---------------------------------------------------------------------------
// Waitlist (seat interests)
// ---------------------------------------------------------------------------

export const SeatInterestInSchema = z.object({
  trip_id: z.number().int(),
  board_stop_order: z.number().int(),
  alight_stop_order: z.number().int(),
  seat_number: z.number().int().nullish(),
});
export type SeatInterestIn = z.infer<typeof SeatInterestInSchema>;

export const SeatInterestSchema = z.object({
  id: z.number(),
  trip_id: z.number(),
  board_stop_order: z.number(),
  alight_stop_order: z.number(),
  seat_number: z.number().nullable(),
  status: z.string(),
  created_at: z.string().nullable(),
  trip_name: z.string(),
  route_name: z.string(),
  board_stop: z.string().nullable(),
  alight_stop: z.string().nullable(),
});
export type SeatInterest = z.infer<typeof SeatInterestSchema>;

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const AppNotificationSchema = z.object({
  id: z.number(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  payload: z.record(z.unknown()).nullable(),
  read: z.boolean(),
  created_at: z.string().nullable(),
});
export type AppNotification = z.infer<typeof AppNotificationSchema>;

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export const ManifestEntrySchema = z.object({
  seat_number: z.number(),
  user_id: z.number().nullable(),
  full_name: z.string().nullable(),
  phone: z.string().nullable(),
  board_stop_order: z.number(),
  alight_stop_order: z.number(),
  board_stop: z.string().nullable(),
  alight_stop: z.string().nullable(),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const TripStatusRequestSchema = z.object({
  status: z.string(),
});
export type TripStatusRequest = z.infer<typeof TripStatusRequestSchema>;

export const CurrentStopRequestSchema = z.object({
  stop_order: z.number().int(),
});
export type CurrentStopRequest = z.infer<typeof CurrentStopRequestSchema>;

// ---------------------------------------------------------------------------
// Admin: fleet & catalog
// ---------------------------------------------------------------------------

export const VehicleTypeSchema = z.object({
  id: z.number(),
  slug: z.string(),
  display_name: z.string(),
  seat_capacity: z.number(),
  seat_layout: SeatLayoutSchema.nullable(),
});
export type VehicleType = z.infer<typeof VehicleTypeSchema>;

export const VehicleTypeInSchema = z.object({
  slug: z.string(),
  display_name: z.string(),
  seat_capacity: z.number().int(),
});
export type VehicleTypeIn = z.infer<typeof VehicleTypeInSchema>;

export const VehicleSchema = z.object({
  id: z.number(),
  plate_number: z.string(),
  vehicle_type_id: z.number(),
  is_electric: z.boolean(),
  category: z.string(),
  vehicle_type_name: z.string(),
  seat_capacity: z.number(),
});
export type Vehicle = z.infer<typeof VehicleSchema>;

export const VehicleInSchema = z.object({
  plate_number: z.string(),
  vehicle_type_id: z.number().int(),
  is_electric: z.boolean().default(false),
});
export type VehicleIn = z.infer<typeof VehicleInSchema>;

export const DriverRowSchema = z.object({
  id: z.number(),
  full_name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  created_at: z.string().nullable(),
});
export type DriverRow = z.infer<typeof DriverRowSchema>;

export const DriverInSchema = z.object({
  full_name: z.string(),
  email: z.string(),
  phone: z.string().nullish(),
  password: z.string(),
});
export type DriverIn = z.infer<typeof DriverInSchema>;

export const TripInSchema = z.object({
  route_id: z.number().int(),
  vehicle_id: z.number().int().nullish(),
  driver_id: z.number().int().nullish(),
  name: z.string(),
  scheduled_at: z.string().nullish(),
  status: z.string().default('scheduled'),
});
export type TripIn = z.infer<typeof TripInSchema>;

export const TripPatchSchema = z.object({
  route_id: z.number().int().nullish(),
  vehicle_id: z.number().int().nullish(),
  driver_id: z.number().int().nullish(),
  name: z.string().nullish(),
  scheduled_at: z.string().nullish(),
  status: z.string().nullish(),
});
export type TripPatch = z.infer<typeof TripPatchSchema>;

export const AdminAnalyticsSchema = z.object({
  revenue: z.object({
    today: z.number(),
    week: z.number(),
    month: z.number(),
    year: z.number(),
    total: z.number(),
    paid_bookings: z.number(),
    completed_payments: z.number(),
    failed_payments: z.number(),
  }),
  revenue_prev: z.object({
    week: z.number(),
    month: z.number(),
    year: z.number(),
  }),
  bookings_per_day: z.array(z.object({ day: z.string(), bookings: z.number() })),
  occupancy: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      route_name: z.string(),
      seat_capacity: z.number().nullable(),
      seats_taken: z.number(),
    }),
  ),
});
export type AdminAnalytics = z.infer<typeof AdminAnalyticsSchema>;

// ---------------------------------------------------------------------------
// Common response envelopes
// ---------------------------------------------------------------------------

export const TripsResponseSchema = z.object({ trips: z.array(TripOptionSchema) });
export const TripStopsResponseSchema = z.object({ trip_id: z.number(), stops: z.array(TripStopSchema) });
export const BookedSeatsResponseSchema = z.object({ trip_id: z.number(), booked_seats: z.array(z.number()) });
export const RoutesResponseSchema = z.object({ routes: z.array(RouteSchema) });
export const UserBookingsResponseSchema = z.object({ bookings: z.array(BookingSchema) });
export const ManifestResponseSchema = z.object({ trip_id: z.number(), manifest: z.array(ManifestEntrySchema) });
export const DriverTripsResponseSchema = z.object({ trips: z.array(TripOptionSchema) });
export const SeatInterestsResponseSchema = z.object({ interests: z.array(SeatInterestSchema) });
export const NotificationsResponseSchema = z.object({
  notifications: z.array(AppNotificationSchema),
  unread: z.number(),
});
export const VehicleTypesResponseSchema = z.object({ vehicle_types: z.array(VehicleTypeSchema) });
export const VehiclesResponseSchema = z.object({ vehicles: z.array(VehicleSchema) });
export const DriversResponseSchema = z.object({ drivers: z.array(DriverRowSchema) });
export const UsersResponseSchema = z.object({ users: z.array(UserSchema) });
export const PaymentsResponseSchema = z.object({ payments: z.array(PaymentRowSchema) });



