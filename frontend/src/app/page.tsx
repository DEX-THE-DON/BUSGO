'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import SeatGrid, { SeatState } from '@/components/SeatGrid';
import ChainView from '@/components/ChainView';
import NotificationsBell from '@/components/NotificationsBell';
import {
  fetchTrips,
  fetchTripStops,
  fetchSeatMap,
  fetchTripChains,
  bookSeatData,
  payMpesa,
  payDarajaStk,
  paystackInitialize,
  paystackVerify,
  searchTrips,
  createSeatInterest,
  errMsg,
  getToken,
  TripOption,
  TripStop,
  ChainLink,
  TripSearchResult,
} from '@/services/api';
import { lookupStopCoords, haversineKm, formatETA } from '@/lib/geo';
import { IconRoute, IconZap, IconTicket } from '@/components/dashboard/FluxIcons';
import PocketBudgetModal from '@/components/user/PocketBudgetModal';
import GroupBookingModal from '@/components/user/GroupBookingModal';
import TopNavSearchBar from '@/components/dashboard/TopNavSearchBar';

export default function BookingPage() {
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [tripId, setTripId] = useState<number>(0);
  const [stops, setStops] = useState<TripStop[]>([]);
  const [boardStop, setBoardStop] = useState<number>(1);
  const [alightStop, setAlightStop] = useState<number>(4);
  const [seatStates, setSeatStates] = useState<Record<number, SeatState>>({});
  const [chains, setChains] = useState<{ seat_number: number; links: ChainLink[] }[]>([]);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);

  // Segment Search state
  const [searchFrom, setSearchFrom] = useState<string>('');
  const [searchTo, setSearchTo] = useState<string>('');
  const [searchResults, setSearchResults] = useState<TripSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Payment modal state
  const [pendingBooking, setPendingBooking] = useState<{ booking_id: number; seat: number; amount: number } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'paystack' | 'mpesa'>('paystack');
  const [phone, setPhone] = useState<string>('2547');
  const [isPaying, setIsPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [paystackRef, setPaystackRef] = useState<string | null>(null);
  const [paystackVerifying, setPaystackVerifying] = useState(false);

  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    setAuthenticated(Boolean(getToken()));
  }, []);

  // Load initial trips
  useEffect(() => {
    let active = true;
    fetchTrips()
      .then((data) => {
        if (!active) return;
        setTrips(data.trips);
        if (data.trips.length > 0) {
          const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
          const urlTripId = urlParams ? Number(urlParams.get('trip')) : 0;
          const found = data.trips.find((t) => t.id === urlTripId);
          if (found) {
            setTripId(found.id);
            setTimeout(() => {
              const el = document.getElementById('seating-selection');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }, 200);
          } else {
            const firstActive = data.trips.find((t) => t.status === 'scheduled' || t.status === 'boarding') || data.trips[0];
            setTripId(firstActive.id);
          }
        }
      })
      .catch((err: unknown) => {
        if (active) setError(errMsg(err));
      });
    return () => {
      active = false;
    };
  }, []);

  // Listen for global trip select events (e.g. from top nav search bar)
  useEffect(() => {
    const handleTripSelect = (e: Event) => {
      const customEvent = e as CustomEvent<{ tripId: number }>;
      const tid = customEvent.detail?.tripId;
      if (tid) {
        setTripId(tid);
        setSelectedSeat(null);
        setTimeout(() => {
          const el = document.getElementById('seating-selection');
          if (el) el.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      }
    };
    window.addEventListener('busgo:select-trip', handleTripSelect);
    return () => window.removeEventListener('busgo:select-trip', handleTripSelect);
  }, []);

  const currentTrip = trips.find((t) => t.id === tripId);
  const isDirect = currentTrip?.route_type === 'direct';
  const seatCapacity = currentTrip?.seat_capacity ?? 0;

  // Load stops when the trip changes.
  useEffect(() => {
    if (!tripId) return;
    let active = true;
    fetchTripStops(tripId)
      .then((data) => {
        if (!active) return;
        setStops(data.stops);
        if (data.stops.length > 0) {
          setBoardStop(data.stops[0].stop_order);
          setAlightStop(data.stops[data.stops.length - 1].stop_order);
        }
      })
      .catch((err: unknown) => {
        if (active) setError(errMsg(err));
      });
    return () => {
      active = false;
    };
  }, [tripId]);

  const refreshSeats = useCallback(() => {
    if (!tripId || boardStop >= alightStop) return;
    return Promise.all([fetchSeatMap(tripId, boardStop, alightStop), fetchTripChains(tripId)])
      .then(([map, chainsRes]) => {
        const states: Record<number, SeatState> = {};
        map.seats.forEach((s) => (states[s.seat_number] = s.state));
        setSeatStates(states);
        setChains(chainsRes.chains);
      })
      .catch((err: unknown) => setError(errMsg(err)));
  }, [tripId, boardStop, alightStop]);

  useEffect(() => {
    refreshSeats();
  }, [refreshSeats]);

  // Dynamic fare calculation: KES 200 base + KES 150 per hop
  const segmentFare = useMemo(() => {
    const hops = Math.max(1, alightStop - boardStop);
    return 200 + hops * 150;
  }, [boardStop, alightStop]);

  // Stop names and distance metrics
  const boardStopObj = stops.find((s) => s.stop_order === boardStop);
  const alightStopObj = stops.find((s) => s.stop_order === alightStop);

  const segmentMetrics = useMemo(() => {
    if (!boardStopObj || !alightStopObj) return null;
    const c1 = lookupStopCoords(boardStopObj.stop_name);
    const c2 = lookupStopCoords(alightStopObj.stop_name);
    if (!c1 || !c2) return null;
    const km = haversineKm(c1, c2);
    const eta = formatETA(km);
    return { km: km.toFixed(1), eta };
  }, [boardStopObj, alightStopObj]);

  // Search trips for intermediate route legs
  const handleSearch = async (fromVal?: string, toVal?: string) => {
    const fromQuery = fromVal !== undefined ? fromVal : searchFrom;
    const toQuery = toVal !== undefined ? toVal : searchTo;
    setIsSearching(true);
    setError('');
    try {
      const res = await searchTrips(fromQuery, toQuery);
      setSearchResults(res.results);
      if (res.results.length === 0) {
        setMessage('No buses found matching that exact segment. Try searching intermediate cities.');
      } else {
        setMessage('');
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (result: TripSearchResult) => {
    setTripId(result.trip_id);
    setBoardStop(result.board_stop.stop_order);
    setAlightStop(result.alight_stop.stop_order);
    setSelectedSeat(null);
    const el = document.getElementById('seating-selection');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  const swapSearchStops = () => {
    const temp = searchFrom;
    setSearchFrom(searchTo);
    setSearchTo(temp);
  };

  // Booking action
  const handleBook = async () => {
    if (!selectedSeat) return;
    if (!authenticated) {
      setMessage('Please log in to book a seat.');
      return;
    }
    setError('');
    setMessage('');
    try {
      const res = await bookSeatData({
        trip_id: tripId,
        seat_number: selectedSeat,
        board_stop_order: boardStop,
        alight_stop_order: alightStop,
      });
      setPendingBooking({
        booking_id: res.booking_id,
        seat: selectedSeat,
        amount: res.amount ?? segmentFare,
      });
      setPaid(false);
      setPaystackRef(null);
    } catch (err: unknown) {
      setMessage(errMsg(err));
    }
  };

  // Paystack checkout trigger
  const handlePaystackCheckout = async () => {
    if (!pendingBooking || isPaying) return;
    setIsPaying(true);
    setError('');
    try {
      const res = await paystackInitialize(pendingBooking.booking_id);
      setPaystackRef(res.reference);
      // Open Paystack secure checkout
      if (res.authorization_url) {
        window.open(res.authorization_url, '_blank');
      }
    } catch (err) {
      setError(errMsg(err) || 'Failed to initialize Paystack transaction');
    } finally {
      setIsPaying(false);
    }
  };

  // Paystack verification checker
  const handleVerifyPaystack = async () => {
    if (!paystackRef || paystackVerifying) return;
    setPaystackVerifying(true);
    try {
      const res = await paystackVerify(paystackRef);
      if (res.status === 'success') {
        setPaid(true);
        setMessage(`Payment verified via Paystack! Seat #${pendingBooking?.seat} confirmed.`);
        refreshSeats();
        setSelectedSeat(null);
      } else {
        setMessage(res.message || 'Payment is still processing with Paystack. Please complete checkout.');
      }
    } catch (err) {
      setError(errMsg(err) || 'Verification pending.');
    } finally {
      setPaystackVerifying(false);
    }
  };

  // Direct M-Pesa STK push
  const confirmMpesaPayment = async () => {
    if (!pendingBooking || isPaying) return;
    setIsPaying(true);
    setError('');
    const amt = pendingBooking.amount || segmentFare;
    try {
      try {
        await payDarajaStk({ booking_id: pendingBooking.booking_id, phone_number: phone, amount: amt });
      } catch (err) {
        if (String(errMsg(err)).toLowerCase().includes('not configured')) {
          await payMpesa({ phone_number: phone, amount: amt, booking_id: pendingBooking.booking_id });
        } else {
          throw err;
        }
      }
      setPaid(true);
      setMessage(`Seat #${pendingBooking.seat} confirmed. STK prompt sent to ${phone} for KES ${amt}.`);
      refreshSeats();
      setSelectedSeat(null);
    } catch (err: unknown) {
      setMessage(errMsg(err) || 'M-Pesa payment failed');
    } finally {
      setIsPaying(false);
    }
  };

  const handleWaitlist = async () => {
    if (!authenticated) {
      setMessage('Please log in to join the waitlist.');
      return;
    }
    try {
      await createSeatInterest({
        trip_id: tripId,
        board_stop_order: boardStop,
        alight_stop_order: alightStop,
        seat_number: selectedSeat,
      });
      setMessage(
        selectedSeat
          ? `We'll notify you when seat #${selectedSeat} frees up for ${boardStopObj?.stop_name ?? 'your segment'}.`
          : `We'll notify you when any seat frees up for ${boardStopObj?.stop_name ?? 'your segment'}.`,
      );
    } catch (err: unknown) {
      setMessage(errMsg(err));
    }
  };

  const selectedChain = chains.find((c) => c.seat_number === selectedSeat);

  return (
    <main className="min-h-screen bg-[#070b14] text-slate-100 p-4 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Top Header Navigation */}
        <div className="bg-slate-900/90 p-4 sm:p-5 rounded-3xl border border-slate-800 backdrop-blur shadow-2xl space-y-3.5">
          {/* Top Row: Brand & Quick Global Controls */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 sm:gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-inner shrink-0">
                <IconRoute className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-sky-300 to-emerald-400 truncate">
                    BUSGO
                  </h1>
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-400 border border-emerald-500/20 shrink-0">
                    Multi-Leg Transit
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 truncate">
                  Dynamic Relay Booking · Intermediate Stops · Paystack &amp; M-Pesa
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <TopNavSearchBar
                placeholder="Search trips, routes, waybills... (⌘K)"
                className="w-full sm:w-64 md:w-72 lg:w-80 min-w-0"
              />
              <div className="relative shrink-0">
                <NotificationsBell />
              </div>
              {authenticated ? (
                <Link
                  href="/user"
                  className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-2 text-xs font-bold text-cyan-300 transition hover:bg-cyan-500/20 shadow-md shrink-0 flex items-center gap-1.5"
                >
                  <span>👤</span>
                  <span>My Dashboard</span>
                </Link>
              ) : (
                <Link
                  href="/login"
                  className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-2 text-xs font-bold text-cyan-300 transition hover:bg-cyan-500/20 shadow-md shrink-0"
                >
                  Log in to Book
                </Link>
              )}
            </div>
          </div>

          {/* Bottom Row: Transit Portals & Quick Operational Links */}
          <div className="flex flex-wrap items-center gap-2 pt-2.5 border-t border-slate-800/80 text-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1 hidden sm:inline">
              Portals:
            </span>
            <Link
              href="/parcels"
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-400 transition hover:bg-emerald-500/20 shadow-sm flex items-center gap-1.5"
            >
              <span className="text-[11px]">📦</span>
              <span>Mzigo Parcels</span>
            </Link>
            <Link
              href="/radar"
              className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-400 transition hover:bg-cyan-500/20 shadow-sm flex items-center gap-1.5"
            >
              <span className="text-[11px]">📡</span>
              <span>Live Radar</span>
            </Link>
            <Link
              href="/dispatcher"
              className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-400 transition hover:bg-amber-500/20 shadow-sm flex items-center gap-1.5"
            >
              <span className="text-[11px]">📋</span>
              <span>Stage POS</span>
            </Link>
            <Link
              href="/onboard"
              className="rounded-xl border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs font-bold text-purple-400 transition hover:bg-purple-500/20 shadow-sm flex items-center gap-1.5"
            >
              <span className="text-[11px]">🎵</span>
              <span>Nganya Screen</span>
            </Link>
            <Link
              href="/lost-found"
              className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-bold text-sky-400 transition hover:bg-sky-500/20 shadow-sm flex items-center gap-1.5"
            >
              <span className="text-[11px]">🧳</span>
              <span>Lost &amp; Found</span>
            </Link>
            <Link
              href="/ussd"
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-400 transition hover:bg-emerald-500/20 shadow-sm flex items-center gap-1.5"
            >
              <span className="text-[11px]">📟</span>
              <span>*384*254# USSD</span>
            </Link>
          </div>
        </div>

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-bold rounded-2xl px-4 py-3 shadow-md">
            {error}
          </div>
        )}

        {/* 1. Intermediate Stop & Segment Search Hero */}
        <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-[#0c1222] to-slate-900 p-6 sm:p-8 shadow-2xl">
          <div className="max-w-2xl">
            <span className="text-[11px] font-black uppercase tracking-wider text-cyan-400">
              Segment Journey Planner
            </span>
            <h2 className="text-2xl font-black text-white mt-1">
              Find buses between any intermediate Kenyan highway stops
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Hop on at any station and hop off at your destination. Pay only for the segments you travel.
            </p>
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-5">
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                Departure Station (From)
              </label>
              <input
                type="text"
                placeholder="e.g. Nairobi, Westlands, Naivasha..."
                value={searchFrom}
                onChange={(e) => setSearchFrom(e.target.value)}
                className="w-full p-3 text-sm rounded-xl border border-slate-700 bg-slate-950 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
              />
            </div>

            <div className="sm:col-span-2 flex justify-center pb-1">
              <button
                type="button"
                onClick={swapSearchStops}
                title="Swap departure and arrival stations"
                className="h-10 w-10 flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition"
              >
                ⇄
              </button>
            </div>

            <div className="sm:col-span-5">
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                Destination Station (To)
              </label>
              <input
                type="text"
                placeholder="e.g. Nakuru, Gilgil, Kisumu..."
                value={searchTo}
                onChange={(e) => setSearchTo(e.target.value)}
                className="w-full p-3 text-sm rounded-xl border border-slate-700 bg-slate-950 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
              />
            </div>
          </div>

          {/* Quick Route Suggestions */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-500">Popular Corridors:</span>
            {[
              { from: 'Nairobi', to: 'Nakuru' },
              { from: 'Nairobi', to: 'Naivasha' },
              { from: 'Westlands', to: 'Nakuru' },
              { from: 'Nairobi', to: 'Mombasa' },
            ].map((p) => (
              <button
                key={`${p.from}-${p.to}`}
                type="button"
                onClick={() => {
                  setSearchFrom(p.from);
                  setSearchTo(p.to);
                  handleSearch(p.from, p.to);
                }}
                className="rounded-lg border border-slate-800 bg-slate-950/80 px-2.5 py-1 text-[11px] font-bold text-slate-300 hover:border-cyan-400 hover:text-cyan-300 transition"
              >
                {p.from} → {p.to}
              </button>
            ))}
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => handleSearch()}
              disabled={isSearching}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 text-slate-950 font-black text-xs transition shadow-lg flex items-center gap-2"
            >
              <span>{isSearching ? 'Searching Routes...' : 'Search Route Legs 🔍'}</span>
            </button>
          </div>

          {/* Search Results Display */}
          {searchResults.length > 0 && (
            <div className="mt-6 pt-6 border-t border-slate-800 space-y-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-cyan-400">
                Found {searchResults.length} Matching Trip{searchResults.length > 1 ? 's' : ''}:
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {searchResults.map((r) => (
                  <div
                    key={r.trip_id}
                    className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4 hover:border-cyan-500/50 transition flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-black text-white">{r.name}</span>
                        <span className="rounded-full bg-emerald-500/15 text-emerald-400 font-mono font-black text-xs px-2.5 py-0.5 border border-emerald-500/30">
                          KES {r.fare}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        {r.board_stop.stop_name} → {r.alight_stop.stop_name} ({r.hop_count} stop{r.hop_count > 1 ? 's' : ''})
                      </p>
                      <div className="flex items-center gap-2 mt-2 text-[11px] text-slate-400">
                        <span>Plate: <strong className="text-slate-200">{r.plate_number || 'Fleet'}</strong></span>
                        <span>·</span>
                        <span className="text-cyan-300 font-bold">{r.available_seats} seats free</span>
                        {r.is_electric && (
                          <span className="text-emerald-400 font-bold flex items-center gap-0.5">
                            <IconZap className="w-3 h-3" /> ⚡ EV
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleSelectSearchResult(r)}
                      className="mt-3 w-full py-2 rounded-xl bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-slate-200 text-xs font-bold transition text-center"
                    >
                      Select This Journey ➔
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 2. Main Booking Engine: Trip Selection & Stopwise Segment Configuration */}
        <div id="seating-selection" className="bg-slate-900 p-6 sm:p-8 rounded-3xl border border-slate-800 shadow-2xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Select Active Transit Service
              </label>
              <select
                value={tripId}
                onChange={(e) => setTripId(Number(e.target.value))}
                className="mt-1 p-2.5 border border-slate-700 rounded-xl bg-slate-950 text-white font-bold text-sm focus:outline-none focus:border-cyan-400"
              >
                {trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.route_name} ({t.route_type === 'direct' ? 'Direct' : 'Stopwise'})
                    {t.is_electric ? ' ⚡EV' : ''} · {t.plate_number ?? 'Fleet'}
                  </option>
                ))}
              </select>
            </div>

            {/* Fare and Distance Callout + Pocket Budget Finder */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowBudgetModal(true)}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 font-bold text-xs transition active:scale-95 shadow-sm"
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
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 font-bold text-xs transition active:scale-95 shadow-sm"
                title="Changa na Marafiki - Group Split Fare & M-Pesa Harambee"
              >
                <span className="text-base">🤝</span>
                <div className="text-left">
                  <div className="font-extrabold text-[11px] leading-tight text-cyan-300">Changa na Marafiki</div>
                  <div className="text-[9px] text-cyan-400/80 font-normal">Split Fare Harambee</div>
                </div>
              </button>

              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-2.5 text-right">
                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400">
                  Segment Fare
                </span>
                <div className="text-xl font-black text-white font-mono">
                  KES {segmentFare}
                </div>
                {segmentMetrics && (
                  <div className="text-[10px] text-slate-300 mt-0.5">
                    ~{segmentMetrics.km} km · ETA {segmentMetrics.eta}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Boarding and Alighting Stop Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-800 bg-[#090d16] p-4">
              <label className="block text-[11px] font-bold text-emerald-400 uppercase tracking-wider mb-1">
                🟢 Boarding Stop (Pickup)
              </label>
              <select
                value={boardStop}
                disabled={isDirect}
                onChange={(e) => setBoardStop(Number(e.target.value))}
                className="w-full p-2.5 border border-slate-700 rounded-xl bg-slate-900 text-white font-semibold text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-50"
              >
                {stops.map((s) => (
                  <option key={s.id} value={s.stop_order}>
                    Stop #{s.stop_order}: {s.stop_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-[#090d16] p-4">
              <label className="block text-[11px] font-bold text-purple-400 uppercase tracking-wider mb-1">
                🏁 Alighting Stop (Dropoff)
              </label>
              <select
                value={alightStop}
                disabled={isDirect}
                onChange={(e) => setAlightStop(Number(e.target.value))}
                className="w-full p-2.5 border border-slate-700 rounded-xl bg-slate-900 text-white font-semibold text-sm focus:outline-none focus:border-purple-500 disabled:opacity-50"
              >
                {stops.map((s) => (
                  <option key={s.id} value={s.stop_order}>
                    Stop #{s.stop_order}: {s.stop_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Stop Progression Ribbon */}
          {stops.length > 0 && (
            <div className="rounded-2xl border border-slate-800/80 bg-[#070b14] p-4">
              <div className="flex items-center justify-between text-xs text-slate-400 font-bold mb-2">
                <span>Route Stop Chain ({stops.length} stops)</span>
                <span className="text-cyan-400">
                  {alightStop > boardStop ? `${alightStop - boardStop} segments selected` : 'Select valid stop order'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                {stops.map((s, idx) => {
                  const isBoard = s.stop_order === boardStop;
                  const isAlight = s.stop_order === alightStop;
                  const isInBetween = s.stop_order > boardStop && s.stop_order < alightStop;

                  return (
                    <React.Fragment key={s.id}>
                      <div
                        className={`flex-shrink-0 px-3 py-1.5 rounded-xl border text-xs font-bold transition ${
                          isBoard
                            ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                            : isAlight
                            ? 'border-purple-500 bg-purple-500/20 text-purple-300'
                            : isInBetween
                            ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
                            : 'border-slate-800 bg-slate-900 text-slate-500'
                        }`}
                      >
                        <span>{s.stop_name}</span>
                        {isBoard && <span className="ml-1 text-[9px] text-emerald-400 font-mono">(Board)</span>}
                        {isAlight && <span className="ml-1 text-[9px] text-purple-400 font-mono">(Alight)</span>}
                      </div>
                      {idx < stops.length - 1 && (
                        <span className={`text-xs ${isInBetween || isBoard ? 'text-cyan-400' : 'text-slate-700'}`}>
                          →
                        </span>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          )}

          {boardStop >= alightStop && (
            <p className="text-rose-400 text-xs font-bold">
              ⚠️ Alighting stop must be further down the route than your boarding stop.
            </p>
          )}

          {/* Seating Grid Header & Legend */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-200 flex items-center gap-2">
                <span>Select Physical Seat</span>
                <span className="text-xs font-normal text-slate-400">
                  ({currentTrip?.vehicle_type ?? 'Bus'} · {seatCapacity} seats)
                </span>
              </h3>
            </div>

            <SeatGrid
              seatCapacity={seatCapacity}
              seatLayout={currentTrip?.seat_layout}
              seatStates={seatStates}
              selectedSeat={selectedSeat}
              onSelect={setSelectedSeat}
              disabled={boardStop >= alightStop}
              vehicleType={currentTrip?.vehicle_type}
              plateNumber={currentTrip?.plate_number}
              isElectric={currentTrip?.is_electric}
            />
          </div>

          {/* Relay Chain Visualization when a seat is selected */}
          {selectedChain && (
            <div className="rounded-2xl bg-[#090d16] border border-slate-800 p-4">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <IconZap className="w-3.5 h-3.5 text-cyan-400" />
                <span>Seat #{selectedSeat} Relay Chains & Handoffs</span>
              </p>
              <ChainView seatNumber={selectedSeat ?? 0} links={selectedChain.links} />
              <p className="text-xs text-emerald-400/90 mt-2">
                This seat is available between {boardStopObj?.stop_name} and {alightStopObj?.stop_name}.
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-slate-800">
            {selectedSeat && !pendingBooking && (
              <button
                onClick={handleBook}
                disabled={boardStop >= alightStop}
                className="flex-1 py-3.5 bg-gradient-to-r from-emerald-500 to-cyan-400 hover:from-emerald-400 hover:to-cyan-300 text-slate-950 font-black text-sm rounded-xl shadow-xl transition-all disabled:opacity-40"
              >
                Proceed to Checkout (Seat #{selectedSeat} · KES {segmentFare})
              </button>
            )}
            <button
              onClick={handleWaitlist}
              className="flex-1 py-3.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl transition-all border border-slate-700"
            >
              {selectedSeat ? `Notify me when seat #${selectedSeat} frees` : 'Join waitlist for this segment'}
            </button>
          </div>

          {message && (
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-center text-xs font-bold text-cyan-300">
              {message}
            </div>
          )}
        </div>
      </div>

      {/* 3. Payment Checkout Modal (Paystack & M-Pesa Multi-Gateway) */}
      {pendingBooking && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 p-6 sm:p-7 rounded-3xl max-w-lg w-full shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <span>Confirm & Pay for Journey</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Booking #{pendingBooking.booking_id} · Seat #{pendingBooking.seat}
                </p>
              </div>
              <div className="text-right">
                <span className="text-[10px] uppercase font-bold text-slate-400">Total Amount</span>
                <p className="font-mono font-black text-emerald-400 text-lg">
                  KES {pendingBooking.amount}
                </p>
              </div>
            </div>

            {/* Journey Summary Card */}
            <div className="rounded-2xl bg-slate-950 p-4 border border-slate-800 text-xs space-y-2">
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-500">Route:</span>
                <span className="font-bold text-white">{currentTrip?.route_name}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-500">Pickup:</span>
                <span className="font-bold text-emerald-400">{boardStopObj?.stop_name} (Stop #{boardStop})</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-500">Destination:</span>
                <span className="font-bold text-purple-400">{alightStopObj?.stop_name} (Stop #{alightStop})</span>
              </div>
            </div>

            {/* Payment Method Selector Tabs */}
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                Choose Payment Gateway
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('paystack')}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-black transition flex items-center justify-center gap-2 ${
                    paymentMethod === 'paystack'
                      ? 'border-cyan-400 bg-cyan-500/15 text-cyan-300 shadow-md ring-1 ring-cyan-400'
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <span>💳 Paystack (Cards/M-Pesa)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('mpesa')}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-black transition flex items-center justify-center gap-2 ${
                    paymentMethod === 'mpesa'
                      ? 'border-emerald-400 bg-emerald-500/15 text-emerald-300 shadow-md ring-1 ring-emerald-400'
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <span>📱 M-Pesa Direct STK</span>
                </button>
              </div>
            </div>

            {/* Paystack Checkout View */}
            {paymentMethod === 'paystack' && (
              <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs">
                <p className="text-slate-300">
                  Pay securely with your Visa, Mastercard, M-Pesa, or Bank through <strong>Paystack</strong>.
                </p>

                {paystackRef ? (
                  <div className="space-y-3 pt-2">
                    <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-cyan-200">
                      <p className="font-bold">Transaction Reference:</p>
                      <p className="font-mono text-xs text-white">{paystackRef}</p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        If checkout window was closed, tap &apos;Verify Status&apos; once payment is completed.
                      </p>
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
                        onClick={handlePaystackCheckout}
                        disabled={isPaying || paid}
                        className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition"
                      >
                        Reopen Checkout
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handlePaystackCheckout}
                    disabled={isPaying}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 text-slate-950 font-black text-xs transition shadow-lg"
                  >
                    {isPaying ? 'Launching Paystack...' : `Pay KES ${pendingBooking.amount} via Paystack ➔`}
                  </button>
                )}
              </div>
            )}

            {/* M-Pesa Direct STK View */}
            {paymentMethod === 'mpesa' && (
              <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs">
                <label className="block text-slate-400 font-bold">
                  Safaricom Phone Number:
                </label>
                <input
                  type="text"
                  placeholder="2547XXXXXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full p-2.5 border border-slate-700 bg-slate-900 rounded-xl text-white focus:outline-none focus:border-emerald-500 font-mono text-sm"
                />
                <button
                  onClick={confirmMpesaPayment}
                  disabled={isPaying || paid}
                  className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition shadow-lg disabled:opacity-60"
                >
                  {isPaying ? 'Sending STK Prompt...' : paid ? 'Confirmed ✓' : `Send M-Pesa Prompt (KES ${pendingBooking.amount})`}
                </button>
              </div>
            )}

            {/* Modal Bottom Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setPendingBooking(null)}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 font-bold rounded-xl text-slate-300 text-xs transition"
              >
                {paid ? 'Close & View Bookings' : 'Cancel'}
              </button>
              {paid && (
                <Link
                  href="/user"
                  className="w-full py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black rounded-xl text-xs transition text-center flex items-center justify-center gap-1.5"
                >
                  <IconTicket className="w-3.5 h-3.5" />
                  <span>View Boarding Pass</span>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bei ya Mfuko Pocket Budget Modal */}
      {showBudgetModal && currentTrip && (
        <PocketBudgetModal
          tripId={currentTrip.id}
          routeName={currentTrip.route_name}
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
      {showGroupModal && currentTrip && (
        <GroupBookingModal
          tripId={currentTrip.id}
          routeName={currentTrip.route_name}
          boardStopOrder={boardStop}
          alightStopOrder={alightStop}
          boardStopName={boardStopObj?.stop_name || 'Origin'}
          alightStopName={alightStopObj?.stop_name || 'Destination'}
          initialSelectedSeat={selectedSeat}
          unitFare={segmentFare}
          onClose={() => setShowGroupModal(false)}
        />
      )}
    </main>
  );
}
