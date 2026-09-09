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

export const RoleSchema = z.enum(['admin', 'sacco_admin', 'driver', 'user']);
export type Role = z.infer<typeof RoleSchema>;

export const SeatLayoutSchema = z.object({
  columns: z.number().int(),
  rows: z.array(z.array(z.number().int())),
  type: z.string().optional(),
  name: z.string().optional(),
  door: z.object({ row: z.number().int(), col: z.number().int() }).optional(),
  driver: z.object({ row: z.number().int(), col: z.number().int() }).optional(),
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
  sacco_id: z.number().nullish(),
  sacco_name: z.string().nullish(),
  psv_badge_number: z.string().nullish(),
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
  fixed_price: z.number().nullable().optional(),
  allow_driver_tier: z.boolean().optional(),
  max_surcharge_pct: z.number().optional(),
  driver_tier: z.string().optional(),
  current_lat: z.number().nullable().optional(),
  current_lng: z.number().nullable().optional(),
  current_speed: z.number().nullable().optional(),
  current_heading: z.number().nullable().optional(),
  last_gps_at: z.string().nullable().optional(),
  sacco_id: z.number().nullish().optional(),
  sacco_name: z.string().nullish().optional(),
  sacco_color: z.string().nullish().optional(),
});
export type TripOption = z.infer<typeof TripOptionSchema>;

export const TripGpsTelemetrySchema = z.object({
  trip_id: z.number(),
  lat: z.number(),
  lng: z.number(),
  speed: z.number().nullable().optional(),
  heading: z.number().nullable().optional(),
  last_gps_at: z.string().nullable().optional(),
  timestamp: z.string().optional(),
});
export type TripGpsTelemetry = z.infer<typeof TripGpsTelemetrySchema>;

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
  base_fare: z.number().optional(),
  per_hop_fare: z.number().optional(),
  fare_matrix: z.record(z.string(), z.number()).nullable().optional(),
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
  amount: z.number().optional(),
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
  current_stop_order: z.number().nullable().optional(),
  vehicle_plate: z.string().nullable().optional(),
  vehicle_model: z.string().nullable().optional(),
  driver_name: z.string().nullable().optional(),
  departure_time: z.string().nullable().optional(),
  current_lat: z.number().nullable().optional(),
  current_lng: z.number().nullable().optional(),
  current_speed: z.number().nullable().optional(),
  current_heading: z.number().nullable().optional(),
  last_gps_at: z.string().nullable().optional(),
});
export type Booking = z.infer<typeof BookingSchema>;

export const CancelBookingResponseSchema = z.object({
  deleted: z.number(),
  seat_freed: z.boolean(),
});
export type CancelBookingResponse = z.infer<typeof CancelBookingResponseSchema>;

// ---------------------------------------------------------------------------
// Search & Multi-Leg Results
// ---------------------------------------------------------------------------

export const TripSearchResultSchema = z.object({
  trip_id: z.number(),
  name: z.string(),
  route_id: z.number(),
  route_name: z.string(),
  route_type: z.enum(['direct', 'stopwise']).optional(),
  scheduled_at: z.string().nullable(),
  status: z.string(),
  plate_number: z.string().nullable(),
  vehicle_type: z.string().nullable().optional(),
  is_electric: z.boolean().optional(),
  seat_capacity: z.number(),
  seat_layout: SeatLayoutSchema.nullable().optional(),
  board_stop: z.object({
    id: z.number(),
    stop_name: z.string(),
    stop_order: z.number(),
  }),
  alight_stop: z.object({
    id: z.number(),
    stop_name: z.string(),
    stop_order: z.number(),
  }),
  hop_count: z.number(),
  fare: z.number(),
  available_seats: z.number(),
  sacco_name: z.string().nullish().optional(),
  sacco_color: z.string().nullish().optional(),
  stops: z.array(z.object({
    id: z.number(),
    stop_name: z.string(),
    stop_order: z.number(),
  })).optional(),
});
export type TripSearchResult = z.infer<typeof TripSearchResultSchema>;

// ---------------------------------------------------------------------------
// Payments (M-Pesa & Paystack)
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

export const PaystackInitRequestSchema = z.object({
  booking_id: z.number().int(),
  callback_url: z.string().optional(),
});
export type PaystackInitRequest = z.infer<typeof PaystackInitRequestSchema>;

export const PaystackInitResponseSchema = z.object({
  status: z.string(),
  authorization_url: z.string(),
  access_code: z.string(),
  reference: z.string(),
  amount: z.number(),
  public_key: z.string(),
});
export type PaystackInitResponse = z.infer<typeof PaystackInitResponseSchema>;

export const PaystackVerifyResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
  booking_id: z.number().optional(),
  amount: z.number().optional(),
});
export type PaystackVerifyResponse = z.infer<typeof PaystackVerifyResponseSchema>;

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

export const VehiclePurposeSchema = z.enum(['passenger', 'cargo']);
export type VehiclePurpose = z.infer<typeof VehiclePurposeSchema>;

export const VehicleTypeSchema = z.object({
  id: z.number(),
  slug: z.string(),
  display_name: z.string(),
  seat_capacity: z.number(),
  purpose: z.string().default('passenger'),
  cargo_tonnage: z.number().nullish().optional(),
  seat_layout: SeatLayoutSchema.nullable(),
});
export type VehicleType = z.infer<typeof VehicleTypeSchema>;

export const VehicleTypeInSchema = z.object({
  slug: z.string(),
  display_name: z.string(),
  seat_capacity: z.number().int(),
  purpose: z.string().default('passenger'),
  cargo_tonnage: z.number().optional(),
});
export type VehicleTypeIn = z.infer<typeof VehicleTypeInSchema>;

export const SaccoSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  registration_no: z.string().nullish(),
  headquarters: z.string().default('Nairobi'),
  contact_phone: z.string().nullish(),
  contact_email: z.string().nullish(),
  primary_color: z.string().default('#06b6d4'),
  accent_color: z.string().default('#f43f5e'),
  logo_url: z.string().nullish(),
  created_at: z.string().nullish(),
  fleet_count: z.number().optional(),
  routes_count: z.number().optional(),
  compliance_score: z.number().optional(),
});
export type Sacco = z.infer<typeof SaccoSchema>;

export const VehicleComplianceSchema = z.object({
  id: z.number(),
  vehicle_id: z.number(),
  plate_number: z.string().optional(),
  sacco_name: z.string().nullish().optional(),
  speed_governor_vendor: z.string().nullish(),
  speed_governor_cert: z.string().nullish(),
  speed_governor_expiry: z.string().nullish(),
  ntsa_inspection_cert: z.string().nullish(),
  ntsa_inspection_expiry: z.string().nullish(),
  insurance_underwriter: z.string().nullish(),
  insurance_policy_no: z.string().nullish(),
  insurance_expiry: z.string().nullish(),
  is_grounded: z.boolean().default(false),
  grounded_reason: z.string().nullish(),
  last_inspected_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  status: z.enum(['compliant', 'warning_expiring', 'grounded']).optional(),
});
export type VehicleCompliance = z.infer<typeof VehicleComplianceSchema>;

export const VehicleSchema = z.object({
  id: z.number(),
  plate_number: z.string(),
  vehicle_type_id: z.number(),
  is_electric: z.boolean(),
  category: z.string(),
  vehicle_type_name: z.string(),
  seat_capacity: z.number(),
  purpose: z.string().default('passenger'),
  body_type: z.string().nullish().optional(),
  cargo_tonnage_capacity: z.number().nullish().optional(),
  driver_id: z.number().nullish().optional(),
  driver_name: z.string().nullish().optional(),
  active_trip_id: z.number().nullish().optional(),
  active_trip_name: z.string().nullish().optional(),
  sacco_id: z.number().nullish().optional(),
  sacco_name: z.string().nullish().optional(),
  is_grounded: z.boolean().optional(),
  compliance_status: z.enum(['compliant', 'warning_expiring', 'grounded']).optional(),
});
export type Vehicle = z.infer<typeof VehicleSchema>;

export const VehicleInSchema = z.object({
  plate_number: z.string(),
  vehicle_type_id: z.number().int().optional(),
  is_electric: z.boolean().default(false),
  purpose: z.string().default('passenger'),
  body_type: z.string().optional(),
  cargo_tonnage_capacity: z.number().optional(),
  seat_capacity: z.number().int().optional(),
  driver_id: z.number().int().nullish().optional(),
  sacco_id: z.number().int().nullish().optional(),
});
export type VehicleIn = z.infer<typeof VehicleInSchema>;

export const DriverVehicleRegisterSchema = z.object({
  plate_number: z.string(),
  purpose: z.enum(['passenger', 'cargo', 'people']).default('cargo'),
  vehicle_type_id: z.number().int().optional(),
  body_type: z.string().optional(),
  cargo_tonnage_capacity: z.number().optional(),
  seat_capacity: z.number().int().optional(),
  is_electric: z.boolean().default(false),
  sacco_id: z.number().int().nullish().optional(),
  chassis_number: z.string().optional(),
  manufacture_year: z.number().int().optional(),
});
export type DriverVehicleRegister = z.infer<typeof DriverVehicleRegisterSchema>;

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
export const SaccosResponseSchema = z.object({ saccos: z.array(SaccoSchema) });
export const FleetComplianceResponseSchema = z.object({ compliance: z.array(VehicleComplianceSchema) });

// ---------------------------------------------------------------------------
// National Fleet Radar (Option 1)
// ---------------------------------------------------------------------------

export const RadarVehicleSchema = z.object({
  trip_id: z.number(),
  trip_name: z.string(),
  status: z.string(),
  current_stop_order: z.number().nullable(),
  current_lat: z.number(),
  current_lng: z.number(),
  current_speed: z.number().nullable().optional(),
  current_heading: z.number().nullable().optional(),
  last_gps_at: z.string().nullable().optional(),
  route_id: z.number(),
  route_name: z.string(),
  route_type: z.string().optional(),
  vehicle_id: z.number().nullable().optional(),
  plate_number: z.string().nullable().optional(),
  is_electric: z.boolean().optional(),
  seat_capacity: z.number().nullable().optional(),
  vehicle_type: z.string().nullable().optional(),
  sacco_id: z.number(),
  sacco_name: z.string(),
  sacco_color: z.string(),
  occupied_seats: z.number(),
  active_incidents: z.number(),
});
export type RadarVehicle = z.infer<typeof RadarVehicleSchema>;

export const RadarFleetResponseSchema = z.object({
  fleet: z.array(RadarVehicleSchema),
  count: z.number(),
  timestamp: z.string(),
});
export type RadarFleetResponse = z.infer<typeof RadarFleetResponseSchema>;

// ---------------------------------------------------------------------------
// SACCO Treasury & Daraja B2C Settlements (Option 2)
// ---------------------------------------------------------------------------

export const SaccoSettlementItemSchema = z.object({
  id: z.number(),
  gross_amount: z.number(),
  platform_fee: z.number(),
  net_payout: z.number(),
  recipient_phone: z.string(),
  recipient_name: z.string(),
  b2c_conversation_id: z.string().nullable().optional(),
  b2c_transaction_id: z.string().nullable().optional(),
  status: z.string(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});
export type SaccoSettlementItem = z.infer<typeof SaccoSettlementItemSchema>;

export const SaccoSettlementSummarySchema = z.object({
  sacco_id: z.number(),
  sacco_name: z.string(),
  gross_revenue: z.number(),
  platform_fee_pct: z.number(),
  platform_fee_total: z.number(),
  net_revenue: z.number(),
  total_disbursed: z.number(),
  available_balance: z.number(),
  available_net: z.number(),
  recent_settlements: z.array(SaccoSettlementItemSchema),
});
export type SaccoSettlementSummary = z.infer<typeof SaccoSettlementSummarySchema>;

export const SaccoWithdrawRequestSchema = z.object({
  sacco_id: z.number(),
  amount: z.number(),
  recipient_phone: z.string(),
  recipient_name: z.string(),
  notes: z.string().optional(),
});
export type SaccoWithdrawRequest = z.infer<typeof SaccoWithdrawRequestSchema>;

// ---------------------------------------------------------------------------
// EV Fleet & Telemetry (Option 4)
// ---------------------------------------------------------------------------

export const EvVehicleSchema = z.object({
  vehicle_id: z.number(),
  plate_number: z.string(),
  manufacture_year: z.number().nullable().optional(),
  vehicle_type: z.string(),
  vehicle_type_name: z.string(),
  seat_capacity: z.number(),
  sacco_id: z.number(),
  sacco_name: z.string(),
  sacco_color: z.string(),
  active_trip_id: z.number().nullable().optional(),
  active_trip_name: z.string().nullable().optional(),
  battery_soc_pct: z.number(),
  battery_temp_c: z.number(),
  estimated_range_km: z.number(),
  charging_status: z.string(),
  power_consumption_kwh_per_km: z.number(),
  co2_saved_kg: z.number(),
  regen_braking_kwh: z.number(),
  recorded_at: z.string().nullable().optional(),
});
export type EvVehicle = z.infer<typeof EvVehicleSchema>;

export const EvFleetResponseSchema = z.object({
  ev_fleet: z.array(EvVehicleSchema),
  total_electric_vehicles: z.number(),
  total_co2_saved_kg: z.number(),
  timestamp: z.string(),
});
export type EvFleetResponse = z.infer<typeof EvFleetResponseSchema>;

export const ChargingStationSchema = z.object({
  id: z.number(),
  name: z.string(),
  operator: z.string(),
  location_name: z.string(),
  corridor: z.string(),
  lat: z.number(),
  lng: z.number(),
  power_kw: z.number(),
  ports_total: z.number(),
  ports_available: z.number(),
  connector_type: z.string(),
});
export type ChargingStation = z.infer<typeof ChargingStationSchema>;

export const ChargingStationsResponseSchema = z.object({
  stations: z.array(ChargingStationSchema),
  count: z.number(),
});
export type ChargingStationsResponse = z.infer<typeof ChargingStationsResponseSchema>;

// ---------------------------------------------------------------------------
// Bei ya Mfuko (Pocket Fare / Budget Hop Finder)
// ---------------------------------------------------------------------------

export const BudgetStageItemSchema = z.object({
  id: z.number().optional(),
  stop_name: z.string(),
  stop_order: z.number(),
  hop_count: z.number(),
  fare: z.number(),
  is_reachable: z.boolean(),
  change_remaining: z.number(),
  deficit: z.number(),
});
export type BudgetStageItem = z.infer<typeof BudgetStageItemSchema>;

export const BudgetReachResponseSchema = z.object({
  trip_id: z.number(),
  trip_name: z.string(),
  route_name: z.string(),
  board_stop: z.object({
    id: z.number().optional(),
    stop_name: z.string(),
    stop_order: z.number(),
  }),
  budget: z.number(),
  furthest_reachable_stop: BudgetStageItemSchema.nullable().optional(),
  intended_alight_stop: BudgetStageItemSchema.nullable().optional(),
  deficit_to_destination: z.number(),
  stages_breakdown: z.array(BudgetStageItemSchema),
  can_reach_any: z.boolean(),
});
export type BudgetReachResponse = z.infer<typeof BudgetReachResponseSchema>;

// ---------------------------------------------------------------------------
// Group Split Fare ("Changa na Marafiki")
// ---------------------------------------------------------------------------

export const GroupMemberSchema = z.object({
  id: z.number().optional(),
  seat_number: z.number(),
  passenger_name: z.string(),
  phone_number: z.string(),
  share_amount: z.number(),
  payment_status: z.enum(['pending', 'paid']),
  mpesa_receipt: z.string().nullable().optional(),
  paid_at: z.string().nullable().optional(),
  booking_id: z.number().nullable().optional(),
});
export type GroupMember = z.infer<typeof GroupMemberSchema>;

export const GroupBookingSchema = z.object({
  group_id: z.number(),
  trip_id: z.number(),
  group_name: z.string(),
  board_stop_order: z.number(),
  alight_stop_order: z.number(),
  total_amount: z.number(),
  paid_amount: z.number(),
  status: z.string(),
  expires_at: z.string(),
  seconds_remaining: z.number().optional(),
  is_fully_paid: z.boolean().optional(),
  discount_pct: z.number().optional(),
  discount_amount: z.number().optional(),
  original_total_amount: z.number().optional(),
  unit_fare: z.number().optional(),
  original_unit_fare: z.number().optional(),
  members: z.array(GroupMemberSchema),
});
export type GroupBooking = z.infer<typeof GroupBookingSchema>;

// ---------------------------------------------------------------------------
// Stage Dispatcher & Reconciliation
// ---------------------------------------------------------------------------

export const StageManifestPassengerSchema = z.object({
  id: z.number(),
  seat_number: z.number(),
  board_stop_order: z.number(),
  alight_stop_order: z.number(),
  status: z.string(),
  payment_status: z.string(),
  payment_provider: z.string(),
  receipt_number: z.string(),
  amount: z.number(),
  passenger_name: z.string(),
  passenger_phone: z.string(),
  board_stop: z.string().nullish(),
  alight_stop: z.string().nullish(),
});
export type StageManifestPassenger = z.infer<typeof StageManifestPassengerSchema>;

export const StageManifestSchema = z.object({
  trip: z.record(z.any()),
  total_seats: z.number(),
  filled_seats: z.number(),
  empty_seats: z.array(z.number()),
  cash_passengers: z.array(StageManifestPassengerSchema),
  mpesa_passengers: z.array(StageManifestPassengerSchema),
  cash_total: z.number(),
  mpesa_total: z.number(),
  total_collections: z.number(),
});
export type StageManifest = z.infer<typeof StageManifestSchema>;

export const StageReconciliationSchema = z.object({
  id: z.number(),
  trip_id: z.number(),
  gross_cash: z.number(),
  gross_mpesa: z.number(),
  total_revenue: z.number(),
  fuel_deduction: z.number(),
  conductor_commission: z.number(),
  other_expenses: z.number(),
  net_sacco_cash: z.number(),
  passenger_count: z.number(),
  notes: z.string().nullable().optional(),
  reconciled_at: z.string(),
});
export type StageReconciliation = z.infer<typeof StageReconciliationSchema>;

// ---------------------------------------------------------------------------
// "Nipe Shugli" - Lost & Found Registry
// ---------------------------------------------------------------------------

export const LostFoundItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  item_type: z.enum(['lost', 'found']),
  status: z.string(),
  location_or_station: z.string(),
  contact_name: z.string(),
  contact_phone: z.string(),
  claimant_phone: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  resolved_at: z.string().nullable().optional(),
});
export type LostFoundItem = z.infer<typeof LostFoundItemSchema>;

// ---------------------------------------------------------------------------
// Highway Blackspot & Hazard Radar
// ---------------------------------------------------------------------------

export const HighwayBlackspotSchema = z.object({
  id: z.string(),
  name: z.string(),
  corridor: z.string(),
  lat: z.number(),
  lng: z.number(),
  radius_km: z.number(),
  speed_limit_kmh: z.number(),
  severity: z.string(),
  hazard_type: z.string(),
  caution_sw: z.string(),
  caution_en: z.string(),
});
export type HighwayBlackspot = z.infer<typeof HighwayBlackspotSchema>;

export const BlackspotProximityAlertSchema = z.object({
  spot_id: z.string(),
  name: z.string(),
  corridor: z.string(),
  distance_km: z.number(),
  severity: z.string(),
  hazard_type: z.string(),
  speed_limit_kmh: z.number(),
  current_speed_kmh: z.number().nullable().optional(),
  is_overspeeding: z.boolean(),
  caution_sw: z.string(),
  caution_en: z.string(),
});
export type BlackspotProximityAlert = z.infer<typeof BlackspotProximityAlertSchema>;

// ---------------------------------------------------------------------------
// Stage B2C Automated Payouts & Dispatches Outbox
// ---------------------------------------------------------------------------

export const StageB2CPayoutRequestSchema = z.object({
  trip_id: z.number(),
  recipient_phone: z.string(),
  amount: z.number(),
  payout_type: z.enum(['conductor_commission', 'driver_float', 'fuel_deduction', 'sacco_surplus']).default('conductor_commission'),
  recipient_name: z.string().optional(),
  reconciliation_id: z.number().optional(),
  notes: z.string().optional(),
});
export type StageB2CPayoutRequest = z.infer<typeof StageB2CPayoutRequestSchema>;

export const StageB2CPayoutResponseSchema = z.object({
  success: z.boolean(),
  b2c_transaction_id: z.string(),
  conversation_id: z.string(),
  amount: z.number(),
  recipient_phone: z.string(),
  recipient_name: z.string().optional(),
  payout_type: z.string(),
  sacco_name: z.string(),
  settled_at: z.string(),
  sms_dispatched: z.boolean(),
});
export type StageB2CPayoutResponse = z.infer<typeof StageB2CPayoutResponseSchema>;

export const DispatchOutboxItemSchema = z.object({
  id: z.number(),
  booking_id: z.number().nullable().optional(),
  channel: z.string(),
  recipient: z.string(),
  message_body: z.string(),
  status: z.string(),
  provider: z.string(),
  provider_reference: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});
export type DispatchOutboxItem = z.infer<typeof DispatchOutboxItemSchema>;

// ---------------------------------------------------------------------------
// Flexible Parcel Courier System (Mzigo Express — ENA Coach Model)
// ---------------------------------------------------------------------------

export const ParcelPickupTypeSchema = z.enum(['station', 'doorstep']);
export type ParcelPickupType = z.infer<typeof ParcelPickupTypeSchema>;

export const ParcelDeliveryTypeSchema = z.enum(['station', 'doorstep']);
export type ParcelDeliveryType = z.infer<typeof ParcelDeliveryTypeSchema>;

export const ParcelQuoteRequestSchema = z.object({
  category: z.string().default('medium_box'),
  weight_kg: z.number().optional().default(5.0),
  pickup_type: ParcelPickupTypeSchema.default('station'),
  delivery_type: ParcelDeliveryTypeSchema.default('station'),
  declared_value: z.number().optional().default(0.0),
  origin_city: z.string().optional().default('Nairobi'),
  destination_city: z.string().optional().default('Nakuru'),
  trip_id: z.number().optional(),
});
export type ParcelQuoteRequest = z.infer<typeof ParcelQuoteRequestSchema>;

export const ParcelQuoteResponseSchema = z.object({
  category: z.string(),
  weight_kg: z.number(),
  pickup_type: z.string(),
  delivery_type: z.string(),
  base_fare: z.number(),
  pickup_fee: z.number(),
  delivery_fee: z.number(),
  insurance_fee: z.number(),
  total_fee: z.number(),
  savings_vs_door_to_door: z.number(),
  delivery_mode_label: z.string(),
  estimated_transit_hours: z.number(),
});
export type ParcelQuoteResponse = z.infer<typeof ParcelQuoteResponseSchema>;

export const ParcelBookingRequestSchema = z.object({
  trip_id: z.number().optional(),
  origin_city: z.string().optional().default('Nairobi'),
  destination_city: z.string().optional().default('Nakuru'),
  sender_name: z.string(),
  sender_phone: z.string(),
  recipient_name: z.string(),
  recipient_phone: z.string(),
  category: z.string().default('medium_box'),
  description: z.string(),
  weight_kg: z.number().optional().default(5.0),
  pickup_type: ParcelPickupTypeSchema.default('station'),
  delivery_type: ParcelDeliveryTypeSchema.default('station'),
  sender_address: z.string().optional().nullable(),
  sender_city_or_area: z.string().optional().nullable(),
  sender_pickup_notes: z.string().optional().nullable(),
  recipient_address: z.string().optional().nullable(),
  recipient_city_or_area: z.string().optional().nullable(),
  recipient_delivery_notes: z.string().optional().nullable(),
  declared_value: z.number().optional().default(0.0),
  pickup_stop_order: z.number().optional().default(1),
  dropoff_stop_order: z.number().optional().nullable(),
  payment_method: z.enum(['mpesa', 'cash_at_station']).optional().default('mpesa'),
});
export type ParcelBookingRequest = z.infer<typeof ParcelBookingRequestSchema>;

export const ParcelTimelineStepSchema = z.object({
  step: z.number(),
  label: z.string(),
  desc: z.string(),
  done: z.boolean(),
  current: z.boolean(),
});
export type ParcelTimelineStep = z.infer<typeof ParcelTimelineStepSchema>;

export const ParcelSchema = z.object({
  id: z.number(),
  trip_id: z.number(),
  sender_id: z.number().nullable().optional(),
  sender_name: z.string(),
  sender_phone: z.string(),
  recipient_name: z.string(),
  recipient_phone: z.string(),
  pickup_stop_order: z.number(),
  dropoff_stop_order: z.number(),
  pickup_stop_name: z.string().optional(),
  dropoff_stop_name: z.string().optional(),
  tracking_code: z.string(),
  security_pin: z.string().optional(),
  category: z.string(),
  description: z.string(),
  weight_kg: z.number().nullable().optional(),
  fee: z.number(),
  base_fare: z.number().optional(),
  pickup_fee: z.number().optional(),
  delivery_fee: z.number().optional(),
  pickup_type: z.string().default('station'),
  delivery_type: z.string().default('station'),
  sender_address: z.string().nullable().optional(),
  sender_city_or_area: z.string().nullable().optional(),
  sender_pickup_notes: z.string().nullable().optional(),
  recipient_address: z.string().nullable().optional(),
  recipient_city_or_area: z.string().nullable().optional(),
  recipient_delivery_notes: z.string().nullable().optional(),
  declared_value: z.number().nullable().optional(),
  courier_rider_phone: z.string().nullable().optional(),
  payment_status: z.string(),
  status: z.string(),
  loaded_at: z.string().nullable().optional(),
  delivered_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  trip_name: z.string().optional(),
  vehicle_plate: z.string().nullable().optional(),
  timeline: z.array(ParcelTimelineStepSchema).optional(),
});
export type Parcel = z.infer<typeof ParcelSchema>;








