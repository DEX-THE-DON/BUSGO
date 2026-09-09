'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import SeatGrid, { SeatState } from '@/components/SeatGrid';
import ChainView from '@/components/ChainView';
import { TicketBookingData } from '@/components/DigitalTicketModal';
import PrintableTicketModal from '@/components/user/PrintableTicketModal';
import PocketBudgetModal from '@/components/user/PocketBudgetModal';
import GroupBookingModal from '@/components/user/GroupBookingModal';
import {
  IconRoute,
  IconZap,
  IconTrip,
  IconTicket,
  IconFleet,
  IconUsers,
} from '@/components/dashboard/FluxIcons';
import {
  searchTrips,
  fetchTrips,
  fetchTripStops,
  fetchSeatMap,
  fetchTripChains,
  bookSeatData,
  fetchSegmentFare,
  payDarajaStk,
  payMpesa,
  paystackInitialize,
  paystackVerify,
  createSeatInterest,
  fetchMyLoyalty,
  redeemLoyaltyPoints,
  LoyaltyInfo,
  TripSearchResult,
  TripOption,
  TripStop,
  ChainLink,
  errMsg,
} from '@/services/api';

const POPULAR_KENYA_STOPS = [
  'Nairobi Central',
  'Westlands',
  'Limuru Stage',
  'Naivasha Junction',
  'Gilgil',
  'Nakuru Terminal',
  'Salgaa',
  'Timboroa',
  'Eldoret Junction',
  'Kericho',
  'Kisumu Terminal',
  'Mtito Andei',
  'Voi Junction',
  'Mombasa Terminal',
];

export interface PassengerBookingFlowProps {
  userPhone?: string;
  userName?: string;
  onBookingComplete?: (bookingId: number, data: TicketBookingData) => void;
  onNavigateToTracking?: (tripId: number) => void;
}

export default function PassengerBookingFlow({
  userPhone = '',
  userName = 'Passenger',
  onBookingComplete,
  onNavigateToTracking,
}: PassengerBookingFlowProps) {
  // Step 1: Search criteria
  const [searchFrom, setSearchFrom] = useState('Nairobi Central');
  const [searchTo, setSearchTo] = useState('Nakuru Terminal');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<TripSearchResult[]>([]);
  const [allTrips, setAllTrips] = useState<TripOption[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  // Step 2: Selected trip & corridor stops
  const [selectedTrip, setSelectedTrip] = useState<TripOption | null>(null);
  const [stops, setStops] = useState<TripStop[]>([]);
  const [boardStop, setBoardStop] = useState<number>(1);
  const [alightStop, setAlightStop] = useState<number>(2);

  // Step 3: Seat selection
  const [seatStates, setSeatStates] = useState<Record<number, SeatState>>({});
  const [chains, setChains] = useState<{ seat_number: number; links: ChainLink[] }[]>([]);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [segmentFare, setSegmentFare] = useState<number>(0);
  const [fareLoading, setFareLoading] = useState(false);

  // Luggage Add-on (Item F)
  const [hasLuggage, setHasLuggage] = useState(false);
  const [luggageCount, setLuggageCount] = useState(1);
  const [luggageDesc, setLuggageDesc] = useState('');

  // Step 4: Checkout & Payment
  const [pendingBooking, setPendingBooking] = useState<{
    booking_id: number;
    seat: number;
    amount: number;
  } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'mpesa' | 'paystack'>('mpesa');
  const [phone, setPhone] = useState(userPhone || '254712345678');
  const [isPaying, setIsPaying] = useState(false);
  const [stkPromptSent, setStkPromptSent] = useState(false);
  const [paid, setPaid] = useState(false);
  const [paystackRef, setPaystackRef] = useState<string | null>(null);
  const [paystackVerifying, setPaystackVerifying] = useState(false);
  const [confirmedBookingData, setConfirmedBookingData] = useState<TicketBookingData | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [loyalty, setLoyalty] = useState<LoyaltyInfo | null>(null);
  const [redeemPoints, setRedeemPoints] = useState(false);

  // Feedback notifications
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Initial load of scheduled trips & loyalty balance
  useEffect(() => {
    fetchTrips()
      .then((res) => {
        setAllTrips(res.trips);
        if (res.trips.length > 0) {
          const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
          const urlTripId = urlParams ? Number(urlParams.get('trip')) : 0;
          const found = res.trips.find((t) => t.id === urlTripId);
          const first = found || res.trips.find((t) => t.status === 'scheduled' || t.status === 'boarding') || res.trips[0];
          setSelectedTrip(first);
        }
      })
      .catch((err) => setError(errMsg(err)));

    fetchMyLoyalty()
      .then((data) => setLoyalty(data))
      .catch(() => {});
  }, []);

  // Listen for global trip select events (e.g. from top nav search bar)
  useEffect(() => {
    const handleSelectTrip = (e: Event) => {
      const customEvent = e as CustomEvent<{ tripId: number }>;
      const tid = customEvent.detail?.tripId;
      if (tid && allTrips.length > 0) {
        const found = allTrips.find((t) => t.id === tid);
        if (found) {
          setSelectedTrip(found);
          setSelectedSeat(null);
        }
      }
    };
    window.addEventListener('busgo:select-trip', handleSelectTrip);
    return () => window.removeEventListener('busgo:select-trip', handleSelectTrip);
  }, [allTrips]);

  // Sync default phone if passed from props
  useEffect(() => {
    if (userPhone && phone === '254712345678') {
      setPhone(userPhone);
    }
  }, [userPhone, phone]);

  // Handle Corridor Stop Search
  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchFrom.trim() || !searchTo.trim()) return;
    setIsSearching(true);
    setError('');
    setMessage('');
    try {
      const res = await searchTrips(searchFrom.trim(), searchTo.trim());
      setSearchResults(res.results);
      setHasSearched(true);
      if (res.results.length > 0) {
        const first = res.results[0];
        const matched = allTrips.find((t) => t.id === first.trip_id) || {
          id: first.trip_id,
          name: first.name,
          route_name: first.route_name,
          route_id: first.route_id,
          status: first.status,
          scheduled_at: first.scheduled_at,
          current_stop_order: 1,
          plate_number: first.plate_number,
          vehicle_id: null,
          vehicle_type: first.vehicle_type,
          seat_capacity: first.seat_capacity,
          is_electric: first.is_electric,
          fixed_price: null,
        };
        setSelectedTrip(matched);
        setBoardStop(first.board_stop.stop_order);
        setAlightStop(first.alight_stop.stop_order);
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setIsSearching(false);
    }
  };

  const swapStops = () => {
    const tmp = searchFrom;
    setSearchFrom(searchTo);
    setSearchTo(tmp);
  };

  // Load stops, seat map, and chains whenever selectedTrip changes
  const loadTripData = useCallback(async (tripId: number) => {
    if (!tripId) return;
    try {
      const [stopsRes, chainsRes] = await Promise.all([
        fetchTripStops(tripId),
        fetchTripChains(tripId),
      ]);
      setStops(stopsRes.stops);
      setChains(chainsRes.chains);
      if (stopsRes.stops.length >= 2) {
        setBoardStop(stopsRes.stops[0].stop_order);
        setAlightStop(stopsRes.stops[stopsRes.stops.length - 1].stop_order);
      }
    } catch (err) {
      setError(errMsg(err));
    }
  }, []);

  useEffect(() => {
    if (selectedTrip?.id) {
      loadTripData(selectedTrip.id);
      setSelectedSeat(null);
    }
  }, [selectedTrip?.id, loadTripData]);

  // Refresh seat map & fare whenever boarding/alighting changes
  useEffect(() => {
    if (!selectedTrip?.id || boardStop >= alightStop) return;

    fetchSeatMap(selectedTrip.id, boardStop, alightStop)
      .then((mapRes) => {
        const states: Record<number, SeatState> = {};
        mapRes.seats.forEach((s) => (states[s.seat_number] = s.state));
        setSeatStates(states);
      })
      .catch(() => {});

    setFareLoading(true);
    fetchSegmentFare(selectedTrip.id, boardStop, alightStop)
      .then((res) => {
        setSegmentFare(res.fare);
      })
      .catch(() => {
        const hops = Math.max(1, alightStop - boardStop);
        setSegmentFare(200 + hops * 150);
      })
      .finally(() => setFareLoading(false));
  }, [selectedTrip?.id, boardStop, alightStop]);

  const boardStopObj = useMemo(
    () => stops.find((s) => s.stop_order === boardStop),
    [stops, boardStop]
  );
  const alightStopObj = useMemo(
    () => stops.find((s) => s.stop_order === alightStop),
    [stops, alightStop]
  );

  const selectedChain = useMemo(
    () => chains.find((c) => c.seat_number === selectedSeat),
    [chains, selectedSeat]
  );

  // Step 3 -> 4: Create booking reservation
  const handleProceedToCheckout = async () => {
    if (!selectedSeat || !selectedTrip) return;
    setError('');
    setMessage('');
    try {
      const res = await bookSeatData({
        trip_id: selectedTrip.id,
        seat_number: selectedSeat,
        board_stop_order: boardStop,
        alight_stop_order: alightStop,
        has_luggage: hasLuggage,
        luggage_count: hasLuggage ? luggageCount : 0,
        luggage_description: hasLuggage ? luggageDesc : undefined,
      });

      setPendingBooking({
        booking_id: res.booking_id,
        seat: selectedSeat,
        amount: res.amount ?? (segmentFare + (hasLuggage ? luggageCount * 150 : 0)),
      });
      setPaid(false);
      setStkPromptSent(false);
      setPaystackRef(null);
    } catch (err) {
      setError(errMsg(err) || 'Failed to initialize seat booking reservation.');
    }
  };

  // Direct M-Pesa STK Push with Safari Points redemption
  const handleMpesaPay = async () => {
    if (!pendingBooking || isPaying) return;
    setIsPaying(true);
    setError('');
    setMessage('');

    const userLoyaltyPoints = loyalty?.points ?? 0;
    const maxRedeemable = Math.min(userLoyaltyPoints, pendingBooking.amount);
    const amt = redeemPoints ? Math.max(0, pendingBooking.amount - maxRedeemable) : pendingBooking.amount;

    if (redeemPoints && maxRedeemable > 0) {
      try {
        await redeemLoyaltyPoints(pendingBooking.booking_id, maxRedeemable);
        fetchMyLoyalty().then(setLoyalty).catch(() => {});
      } catch {
        // continue if deduction fails
      }
    }

    try {
      try {
        await payDarajaStk({
          booking_id: pendingBooking.booking_id,
          phone_number: phone,
          amount: amt,
        });
      } catch (darajaErr) {
        if (String(errMsg(darajaErr)).toLowerCase().includes('not configured')) {
          await payMpesa({
            booking_id: pendingBooking.booking_id,
            phone_number: phone,
            amount: amt,
          });
        } else {
          throw darajaErr;
        }
      }

      setStkPromptSent(true);
      setPaid(true);

      const ticketData: TicketBookingData = {
        id: pendingBooking.booking_id,
        trip_id: selectedTrip?.id ?? 1,
        seat_number: pendingBooking.seat,
        board_stop_order: boardStop,
        alight_stop_order: alightStop,
        status: 'confirmed',
        payment_status: 'paid',
        trip_name: selectedTrip?.name,
        route_name: selectedTrip?.route_name,
        board_stop: boardStopObj?.stop_name,
        alight_stop: alightStopObj?.stop_name,
        vehicle_plate: selectedTrip?.plate_number ?? undefined,
        vehicle_model: selectedTrip?.vehicle_type ?? undefined,
        departure_time: selectedTrip?.scheduled_at ?? new Date().toISOString(),
        created_at: new Date().toISOString(),
        sacco_name: selectedTrip?.sacco_name ?? undefined,
      };

      setConfirmedBookingData(ticketData);
      setMessage(`M-Pesa payment processed! Seat #${pendingBooking.seat} confirmed.`);
      if (onBookingComplete) {
        onBookingComplete(pendingBooking.booking_id, ticketData);
      }
    } catch (err) {
      setError(errMsg(err) || 'M-Pesa payment failed. Please retry.');
    } finally {
      setIsPaying(false);
    }
  };

  // Paystack Multi-gateway checkout
  const handlePaystackPay = async () => {
    if (!pendingBooking || isPaying) return;
    setIsPaying(true);
    setError('');
    try {
      const res = await paystackInitialize(pendingBooking.booking_id);
      setPaystackRef(res.reference);
      if (res.authorization_url) {
        window.open(res.authorization_url, '_blank');
      }
    } catch (err) {
      setError(errMsg(err) || 'Paystack initialization failed.');
    } finally {
      setIsPaying(false);
    }
  };

  const handleVerifyPaystack = async () => {
    if (!paystackRef || paystackVerifying) return;
    setPaystackVerifying(true);
    try {
      const res = await paystackVerify(paystackRef);
      if (res.status === 'success') {
        setPaid(true);
        const ticketData: TicketBookingData = {
          id: pendingBooking?.booking_id ?? 0,
          trip_id: selectedTrip?.id ?? 1,
          seat_number: pendingBooking?.seat ?? 1,
          board_stop_order: boardStop,
          alight_stop_order: alightStop,
          status: 'confirmed',
          payment_status: 'paid',
          trip_name: selectedTrip?.name,
          route_name: selectedTrip?.route_name,
          board_stop: boardStopObj?.stop_name,
          alight_stop: alightStopObj?.stop_name,
          vehicle_plate: selectedTrip?.plate_number ?? undefined,
          vehicle_model: selectedTrip?.vehicle_type ?? undefined,
          departure_time: selectedTrip?.scheduled_at ?? new Date().toISOString(),
          created_at: new Date().toISOString(),
          sacco_name: selectedTrip?.sacco_name ?? undefined,
        };
        setConfirmedBookingData(ticketData);
        setMessage(`Payment verified via Paystack! Seat #${pendingBooking?.seat} confirmed.`);
        if (pendingBooking?.booking_id && onBookingComplete) {
          onBookingComplete(pendingBooking.booking_id, ticketData);
        }
      } else {
        setMessage(res.message || 'Payment is still processing with Paystack. Please complete checkout.');
      }
    } catch (err) {
      setError(errMsg(err) || 'Paystack verification error.');
    } finally {
      setPaystackVerifying(false);
    }
  };

  // Waitlist interest registration
  const handleWaitlist = async () => {
    if (!selectedTrip?.id) return;
    try {
      await createSeatInterest({
        trip_id: selectedTrip.id,
        board_stop_order: boardStop,
        alight_stop_order: alightStop,
        seat_number: selectedSeat ?? undefined,
      });
      setMessage(
        selectedSeat
          ? `Seat #${selectedSeat} waitlist confirmed! We will notify you when it frees up.`
          : `Waitlist confirmed for ${boardStopObj?.stop_name ?? 'your segment'}!`
      );
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Highway Corridor Search Header */}
      <div className="rounded-3xl border border-cyan-500/30 bg-gradient-to-br from-slate-900 via-[#0a1020] to-slate-900 p-6 shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-inner">
              <IconRoute className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-white uppercase tracking-wide flex items-center gap-2">
                <span>Corridor Journey Planner</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  Live Hop Matrix
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Book any intermediate Kenyan highway stops with dynamic seat release & fare precedence.
              </p>
            </div>
          </div>
        </div>

        {/* Search Input Bar */}
        <form onSubmit={handleSearch} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
          <div className="sm:col-span-5 relative">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Boarding Station (Origin)
            </label>
            <input
              type="text"
              list="stops-from"
              value={searchFrom}
              onChange={(e) => setSearchFrom(e.target.value)}
              placeholder="e.g. Nairobi Central or Westlands"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white font-bold focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/50 transition"
            />
            <datalist id="stops-from">
              {POPULAR_KENYA_STOPS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          <div className="sm:col-span-1 flex justify-center sm:pt-5">
            <button
              type="button"
              onClick={swapStops}
              title="Swap route directions"
              className="h-9 w-9 rounded-full border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 flex items-center justify-center transition shadow"
            >
              ⇄
            </button>
          </div>

          <div className="sm:col-span-4 relative">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Alighting Station (Dropoff)
            </label>
            <input
              type="text"
              list="stops-to"
              value={searchTo}
              onChange={(e) => setSearchTo(e.target.value)}
              placeholder="e.g. Nakuru Terminal or Naivasha"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white font-bold focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/50 transition"
            />
            <datalist id="stops-to">
              {POPULAR_KENYA_STOPS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          <div className="sm:col-span-2 sm:pt-5">
            <button
              type="submit"
              disabled={isSearching}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 text-slate-950 font-black text-xs uppercase tracking-wider transition shadow-lg disabled:opacity-50"
            >
              {isSearching ? 'Finding...' : 'Find Buses'}
            </button>
          </div>
        </form>

        {/* Search Results Display */}
        {hasSearched && (
          <div className="mt-4 pt-4 border-t border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400 font-bold">
              <span>Matching Available Departures: {searchResults.length}</span>
              {searchResults.length === 0 && (
                <span className="text-amber-400 font-normal">
                  Showing all active fleet trips below
                </span>
              )}
            </div>

            {searchResults.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                {searchResults.map((r) => {
                  const isSelected = selectedTrip?.id === r.trip_id;
                  return (
                    <div
                      key={r.trip_id}
                      onClick={() => {
                        const matched = allTrips.find((t) => t.id === r.trip_id) || {
                          id: r.trip_id,
                          name: r.name,
                          route_name: r.route_name,
                          route_id: r.route_id,
                          status: r.status,
                          scheduled_at: r.scheduled_at,
                          current_stop_order: 1,
                          plate_number: r.plate_number,
                          vehicle_id: null,
                          vehicle_type: r.vehicle_type,
                          seat_capacity: r.seat_capacity,
                          is_electric: r.is_electric,
                          fixed_price: null,
                          sacco_name: r.sacco_name,
                          sacco_color: r.sacco_color,
                        };
                        setSelectedTrip(matched);
                        setBoardStop(r.board_stop.stop_order);
                        setAlightStop(r.alight_stop.stop_order);
                      }}
                      className={`cursor-pointer rounded-2xl border p-3 transition ${
                        isSelected
                          ? 'border-cyan-400 bg-cyan-500/10 ring-1 ring-cyan-400'
                          : 'border-slate-800 bg-slate-950/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-white">{r.name}</span>
                          {r.sacco_name && (
                            <span
                              className="px-2 py-0.5 rounded-md text-[9px] font-bold tracking-wider uppercase border"
                              style={{
                                backgroundColor: `${r.sacco_color || '#06b6d4'}22`,
                                borderColor: `${r.sacco_color || '#06b6d4'}66`,
                                color: r.sacco_color || '#06b6d4',
                              }}
                            >
                              {r.sacco_name}
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-xs font-black text-emerald-400">
                          KES {r.fare}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                        <span>Plate: <strong className="text-cyan-300 font-mono">{r.plate_number || 'Fleet'}</strong></span>
                        <span>·</span>
                        <span>{r.vehicle_type || 'Kenyan PSV'}</span>
                        <span>·</span>
                        <span className="text-emerald-300">{r.available_seats} seats left</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Active Trip Selection & Corridor Stops Bar */}
      <div className="rounded-3xl border border-slate-800 bg-[#0d121f] p-6 shadow-xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-black uppercase tracking-wider text-cyan-400">
                Selected Transit Route
              </span>
              {allTrips.length > 1 && (
                <select
                  value={selectedTrip?.id || 0}
                  onChange={(e) => {
                    const tid = Number(e.target.value);
                    const chosen = allTrips.find((t) => t.id === tid);
                    if (chosen) setSelectedTrip(chosen);
                  }}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-bold text-slate-200 focus:border-cyan-400 focus:outline-none"
                >
                  {allTrips.map((t) => (
                    <option key={t.id} value={t.id}>
                      #{t.id} {t.name} · {t.route_name}
                    </option>
                  ))}
                </select>
              )}
              {selectedTrip?.sacco_name && (
                <span
                  className="rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wide uppercase border"
                  style={{
                    backgroundColor: `${selectedTrip.sacco_color || '#06b6d4'}22`,
                    borderColor: `${selectedTrip.sacco_color || '#06b6d4'}66`,
                    color: selectedTrip.sacco_color || '#06b6d4',
                  }}
                >
                  🏢 {selectedTrip.sacco_name}
                </span>
              )}
              {selectedTrip?.is_electric && (
                <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.2 text-[9px] font-bold text-emerald-300">
                  ⚡ 100% Electric PSV
                </span>
              )}
            </div>
            <h4 className="text-lg font-black text-white mt-0.5">
              {selectedTrip?.route_name || selectedTrip?.name || 'Corridor Express'}
            </h4>
            <p className="text-xs text-slate-400 mt-0.5">
              Plate: <strong className="text-cyan-300 font-mono">{selectedTrip?.plate_number || 'Fleet Unit'}</strong> · Model: <strong className="text-slate-200">{selectedTrip?.vehicle_type || 'Kenyan PSV'}</strong> · Capacity: <strong className="text-slate-200">{selectedTrip?.seat_capacity || 14} Seats</strong>
            </p>
          </div>

          {/* Hop Fare Card + Pocket Budget Finder + Group Booking */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowBudgetModal(true)}
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 font-bold text-xs transition active:scale-95 shadow-sm"
              title="Find how far your cash will get you along this route"
            >
              <span className="text-base">💡</span>
              <div className="text-left">
                <div className="font-extrabold text-[11px] leading-tight text-amber-300">Bei ya Mfuko</div>
                <div className="text-[9px] text-amber-400/80 font-normal">Budget Hop Finder</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setShowGroupModal(true)}
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 font-bold text-xs transition active:scale-95 shadow-sm"
              title="Split fare with friends and pay via M-Pesa Harambee"
            >
              <span className="text-base">🤝</span>
              <div className="text-left">
                <div className="font-extrabold text-[11px] leading-tight text-indigo-300">Changa na Marafiki</div>
                <div className="text-[9px] text-indigo-400/80 font-normal">Split Fare Harambee</div>
              </div>
            </button>

            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-3 text-right">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 block">
                Calculated Segment Fare
              </span>
              <div className="font-mono text-xl font-black text-white mt-0.5">
                {fareLoading ? (
                  <span className="text-slate-400 text-sm animate-pulse">Calculating...</span>
                ) : (
                  <>KES {segmentFare}</>
                )}
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                {alightStop - boardStop > 0 ? `${alightStop - boardStop} hop corridor journey` : 'Select stops'}
              </span>
            </div>
          </div>
        </div>

        {/* Intermediate Stop Segment Selectors */}
        {stops.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-950/70 p-4 rounded-2xl border border-slate-800">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Your Boarding Stop:
              </label>
              <select
                value={boardStop}
                onChange={(e) => setBoardStop(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 p-2.5 text-xs font-bold text-white focus:border-cyan-400 focus:outline-none"
              >
                {stops.map((s) => (
                  <option key={s.id} value={s.stop_order}>
                    Stop #{s.stop_order} — {s.stop_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Your Alighting Stop:
              </label>
              <select
                value={alightStop}
                onChange={(e) => setAlightStop(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 p-2.5 text-xs font-bold text-white focus:border-cyan-400 focus:outline-none"
              >
                {stops.map((s) => (
                  <option key={s.id} value={s.stop_order}>
                    Stop #{s.stop_order} — {s.stop_name}
                  </option>
                ))}
              </select>
            </div>

            {boardStop >= alightStop && (
              <div className="sm:col-span-2 text-rose-400 text-xs font-bold">
                ⚠️ Alighting stop must be further down the route corridor than boarding stop.
              </div>
            )}
          </div>
        )}

        {/* 3. Authentic Kenyan Seat Blueprint */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h5 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <span>Interactive Kenyan Vehicle Seat Blueprint</span>
            </h5>
            <span className="text-xs text-slate-400">
              Tap any green or yellow seat to reserve
            </span>
          </div>

          <SeatGrid
            seatCapacity={selectedTrip?.seat_capacity ?? 14}
            seatLayout={selectedTrip?.seat_layout}
            seatStates={seatStates}
            selectedSeat={selectedSeat}
            onSelect={setSelectedSeat}
            disabled={boardStop >= alightStop}
            vehicleType={selectedTrip?.vehicle_type}
            plateNumber={selectedTrip?.plate_number}
            isElectric={selectedTrip?.is_electric}
          />
        </div>

        {/* Relay Chain Visualization */}
        {selectedChain && (
          <div className="rounded-2xl bg-slate-950 border border-slate-800 p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-300 uppercase tracking-wide">
              <IconZap className="w-3.5 h-3.5 text-cyan-400" />
              <span>Seat #{selectedSeat} Corridor Relay Handoffs</span>
            </div>
            <ChainView seatNumber={selectedSeat ?? 0} links={selectedChain.links} />
            <p className="text-xs text-emerald-400/90 mt-1">
              Available from {boardStopObj?.stop_name} to {alightStopObj?.stop_name}. Onward relay will be released for other passengers after your dropoff.
            </p>
          </div>
        )}

        {/* Luggage / Accompanied Mzigo Add-on (Item F) */}
        {selectedSeat && (
          <div className="bg-slate-950/80 rounded-2xl border border-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🧳</span>
                <div>
                  <h5 className="text-xs font-black text-white">Accompanied Luggage Add-on (Mzigo)</h5>
                  <p className="text-[11px] text-slate-400">Standard carry-on is free. Extra large bags/produce sacks: +KES 150/bag</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasLuggage}
                  onChange={(e) => setHasLuggage(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
              </label>
            </div>

            {hasLuggage && (
              <div className="pt-3 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 gap-3 animate-in fade-in duration-200">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Extra Baggage Pieces (+KES 150 each)
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setLuggageCount(Math.max(1, luggageCount - 1))}
                      className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-black text-sm flex items-center justify-center border border-slate-700"
                    >
                      -
                    </button>
                    <span className="font-mono font-black text-white text-sm w-6 text-center">{luggageCount}</span>
                    <button
                      type="button"
                      onClick={() => setLuggageCount(Math.min(6, luggageCount + 1))}
                      className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-black text-sm flex items-center justify-center border border-slate-700"
                    >
                      +
                    </button>
                    <span className="text-xs font-mono font-bold text-emerald-400 ml-2">
                      +KES {luggageCount * 150}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Luggage Description (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 2 large travel bags, sack of potatoes"
                    value={luggageDesc}
                    onChange={(e) => setLuggageDesc(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 p-2 text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-slate-800">
          {selectedSeat && !pendingBooking && (
            <button
              onClick={handleProceedToCheckout}
              disabled={boardStop >= alightStop}
              className="flex-1 py-3.5 bg-gradient-to-r from-emerald-500 to-cyan-400 hover:from-emerald-400 hover:to-cyan-300 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl shadow-xl transition disabled:opacity-40"
            >
              Proceed to Checkout (Seat #{selectedSeat} · KES {segmentFare + (hasLuggage ? luggageCount * 150 : 0)})
            </button>
          )}

          <button
            onClick={handleWaitlist}
            className="flex-1 py-3.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl transition border border-slate-700"
          >
            {selectedSeat
              ? `Watchlist Seat #${selectedSeat} (Notify me on vacancy)`
              : 'Join Waitlist for this Stop Segment'}
          </button>
        </div>

        {message && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-center text-xs font-bold text-emerald-300">
            {message}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-center text-xs font-bold text-rose-300">
            {error}
          </div>
        )}
      </div>

      {/* 4. Payment Checkout Modal (M-Pesa STK & Paystack Multi-Gateway) */}
      {pendingBooking && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-[#0e1424] border border-slate-800 p-6 sm:p-7 rounded-3xl max-w-lg w-full shadow-2xl space-y-5">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  <span>Confirm Journey & Instant Checkout</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Booking #{pendingBooking.booking_id} · Preferred Seat #{pendingBooking.seat}
                </p>
              </div>
              <div className="text-right">
                <span className="text-[10px] uppercase font-bold text-slate-400">Fare Due</span>
                {redeemPoints && (loyalty?.points ?? 0) > 0 ? (
                  <div className="flex flex-col items-end">
                    <span className="text-xs line-through text-slate-500 font-mono">KES {pendingBooking.amount}</span>
                    <p className="font-mono font-black text-emerald-400 text-lg">
                      KES {Math.max(0, pendingBooking.amount - Math.min(loyalty?.points ?? 0, pendingBooking.amount))}
                    </p>
                  </div>
                ) : (
                  <p className="font-mono font-black text-emerald-400 text-lg">
                    KES {pendingBooking.amount}
                  </p>
                )}
              </div>
            </div>

            {/* Journey Summary */}
            <div className="rounded-2xl bg-slate-950 p-4 border border-slate-800 text-xs space-y-2">
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-500">Route:</span>
                <span className="font-bold text-white">{selectedTrip?.route_name || selectedTrip?.name}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-500">Pickup:</span>
                <span className="font-bold text-emerald-400">{boardStopObj?.stop_name} (Stop #{boardStop})</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-500">Dropoff:</span>
                <span className="font-bold text-purple-400">{alightStopObj?.stop_name} (Stop #{alightStop})</span>
              </div>
            </div>

            {/* Safari Points Loyalty Redemption */}
            {loyalty && loyalty.points > 0 && (
              <div className="rounded-2xl bg-gradient-to-r from-amber-500/10 via-amber-600/10 to-transparent p-4 border border-amber-500/30 text-xs flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                    <span className="text-base leading-none">🏅</span>
                  </div>
                  <div>
                    <div className="font-bold text-amber-200 flex items-center gap-2">
                      <span>Safari Points Loyalty</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono">
                        {loyalty.tier}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      You have <strong>{loyalty.points}</strong> pts (KES {loyalty.points} discount value).
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer ml-3">
                  <input
                    type="checkbox"
                    checked={redeemPoints}
                    onChange={(e) => setRedeemPoints(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
              </div>
            )}

            {/* Gateway Selector Tabs */}
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                Select Instant Payment Method
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('mpesa')}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-black transition flex items-center justify-center gap-2 ${
                    paymentMethod === 'mpesa'
                      ? 'border-emerald-400 bg-emerald-500/15 text-emerald-300 shadow-md ring-1 ring-emerald-400'
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <span>📱 M-Pesa STK Push</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('paystack')}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-black transition flex items-center justify-center gap-2 ${
                    paymentMethod === 'paystack'
                      ? 'border-cyan-400 bg-cyan-500/15 text-cyan-300 shadow-md ring-1 ring-cyan-400'
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <span>💳 Card / Paystack</span>
                </button>
              </div>
            </div>

            {/* M-Pesa Direct STK View */}
            {paymentMethod === 'mpesa' && (
              <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs">
                <label className="block text-slate-400 font-bold">
                  Safaricom M-Pesa Mobile Number:
                </label>
                <input
                  type="text"
                  placeholder="2547XXXXXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full p-2.5 border border-slate-700 bg-slate-900 rounded-xl text-white focus:outline-none focus:border-emerald-500 font-mono text-sm"
                />
                <button
                  onClick={handleMpesaPay}
                  disabled={isPaying || paid}
                  className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition shadow-lg disabled:opacity-60"
                >
                  {isPaying
                    ? 'Sending STK Push to Phone...'
                    : paid
                    ? 'Payment Confirmed ✓'
                    : `Trigger M-Pesa STK (KES ${
                        redeemPoints && (loyalty?.points ?? 0) > 0
                          ? Math.max(0, pendingBooking.amount - Math.min(loyalty?.points ?? 0, pendingBooking.amount))
                          : pendingBooking.amount
                      })`}
                </button>

                {stkPromptSent && (
                  <p className="text-[11px] text-emerald-300/90 text-center font-bold animate-pulse">
                    📲 Check your phone screen for the Safaricom PIN dialog!
                  </p>
                )}
              </div>
            )}

            {/* Paystack Checkout View */}
            {paymentMethod === 'paystack' && (
              <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs">
                <p className="text-slate-300">
                  Pay securely with Visa, Mastercard, Bank, or M-Pesa via <strong>Paystack</strong>.
                </p>

                {paystackRef ? (
                  <div className="space-y-3 pt-2">
                    <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-cyan-200">
                      <p className="font-bold">Transaction Reference:</p>
                      <p className="font-mono text-xs text-white">{paystackRef}</p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={handleVerifyPaystack}
                        disabled={paystackVerifying || paid}
                        className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition"
                      >
                        {paystackVerifying ? 'Verifying...' : paid ? 'Verified ✓' : 'I Have Paid — Verify Now'}
                      </button>
                      <button
                        onClick={handlePaystackPay}
                        disabled={isPaying || paid}
                        className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition"
                      >
                        Reopen Checkout
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handlePaystackPay}
                    disabled={isPaying}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 text-slate-950 font-black text-xs transition shadow-lg"
                  >
                    {isPaying ? 'Launching Paystack...' : `Pay KES ${pendingBooking.amount} via Paystack ➔`}
                  </button>
                )}
              </div>
            )}

            {/* Bottom Actions */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setPendingBooking(null)}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 font-bold rounded-xl text-slate-300 text-xs transition"
              >
                {paid ? 'Done' : 'Cancel'}
              </button>

              {paid && confirmedBookingData && (
                <>
                  <button
                    onClick={() => {
                      if (onBookingComplete) {
                        onBookingComplete(confirmedBookingData.id, confirmedBookingData);
                      }
                      setPendingBooking(null);
                    }}
                    className="w-full py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black rounded-xl text-xs transition text-center flex items-center justify-center gap-1.5"
                  >
                    <IconTicket className="w-3.5 h-3.5" />
                    <span>View E-Pass</span>
                  </button>

                  <button
                    onClick={() => setShowPrintModal(true)}
                    className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black rounded-xl text-xs transition text-center flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-900/30"
                  >
                    <span>🖨️ Print Ticket / POS</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Printable PDF & 58mm Thermal Receipt Modal */}
      {confirmedBookingData && (
        <PrintableTicketModal
          isOpen={showPrintModal}
          onClose={() => setShowPrintModal(false)}
          ticket={{
            bookingId: confirmedBookingData.id,
            tripId: confirmedBookingData.trip_id,
            passengerName: 'Passenger',
            seatNumber: confirmedBookingData.seat_number,
            routeName: confirmedBookingData.route_name || selectedTrip?.name || 'BusGo Corridor',
            boardStop: confirmedBookingData.board_stop || boardStopObj?.stop_name || 'Origin Stage',
            alightStop: confirmedBookingData.alight_stop || alightStopObj?.stop_name || 'Terminus',
            vehiclePlate: confirmedBookingData.vehicle_plate,
            vehicleModel: confirmedBookingData.vehicle_model,
            fareAmount: pendingBooking?.amount,
            hasLuggage,
            luggageCount,
            luggageFee: hasLuggage ? luggageCount * 150 : 0,
            receiptNumber: 'PAID-MPESA',
            paymentStatus: 'paid',
            qrData: `BUSGO:${confirmedBookingData.id}:${confirmedBookingData.trip_id}:${confirmedBookingData.seat_number}`,
          }}
        />
      )}

      {/* Bei ya Mfuko Pocket Budget Modal */}
      {showBudgetModal && selectedTrip && (
        <PocketBudgetModal
          tripId={selectedTrip.id}
          routeName={selectedTrip.route_name || selectedTrip.name}
          stops={stops}
          currentBoardOrder={boardStop}
          currentAlightOrder={alightStop}
          onSelectReachableStage={(stopOrder) => {
            setAlightStop(stopOrder);
            setShowBudgetModal(false);
          }}
          onClose={() => setShowBudgetModal(false)}
        />
      )}

      {/* Changa na Marafiki Group Split Fare Modal */}
      {showGroupModal && selectedTrip && (
        <GroupBookingModal
          tripId={selectedTrip.id}
          routeName={selectedTrip.route_name || selectedTrip.name || 'Express Corridor'}
          boardStopOrder={boardStop}
          alightStopOrder={alightStop}
          boardStopName={boardStopObj?.stop_name || 'Origin'}
          alightStopName={alightStopObj?.stop_name || 'Destination'}
          initialSelectedSeat={selectedSeat}
          unitFare={segmentFare}
          onClose={() => setShowGroupModal(false)}
        />
      )}
    </div>
  );
}
