'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import RequireRole from '@/components/RequireRole';
import FluxDashboardShell, { FluxNavGroup } from '@/components/dashboard/FluxDashboardShell';
import {
  FluxProgressWidget,
  FluxActivityWidget,
  FluxMetric,
} from '@/components/dashboard/FluxWidgets';
import {
  IconDashboard,
  IconTrip,
  IconBell,
  IconTicket,
  IconUsers,
  IconZap,
  IconActivity,
  IconRoute,
} from '@/components/dashboard/FluxIcons';
import { useAuth } from '@/context/AuthContext';
import {
  fetchUserBookings,
  fetchSeatInterests,
  deleteSeatInterest,
  claimSeatInterest,
  paystackInitialize,
  updateProfile,
  cancelBooking,
  Booking,
  SeatInterest,
  errMsg,
} from '@/services/api';
import DigitalTicketModal, { TicketBookingData } from '@/components/DigitalTicketModal';
import LiveTransitMap from '@/components/LiveTransitMap';
import PassengerBookingFlow from '@/components/PassengerBookingFlow';
import MzigoTracker from '@/components/user/MzigoTracker';

type UserTab = 'overview' | 'book' | 'rides' | 'tracking' | 'waitlist' | 'history' | 'account' | 'mzigo';

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    confirmed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    boarded: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
    pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    cancelled: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    paid: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    unpaid: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    claimed: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
  };
  return `text-xs font-bold px-3 py-1 rounded-full border capitalize ${map[status] ?? 'bg-slate-800 text-slate-300 border-slate-700'}`;
};

function WaitlistReserveTimer({ createdAt }: { createdAt: string | null }) {
  const calculateRemaining = useCallback(() => {
    if (!createdAt) return 300;
    const createdMs = new Date(createdAt).getTime();
    const nowMs = Date.now();
    const elapsedSec = Math.max(0, Math.floor((nowMs - createdMs) / 1000));
    const left = 300 - (elapsedSec % 300);
    return left > 0 ? left : 0;
  }, [createdAt]);

  const [secondsLeft, setSecondsLeft] = useState(calculateRemaining);

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft(calculateRemaining());
    }, 1000);
    return () => clearInterval(interval);
  }, [calculateRemaining]);

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const formatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono text-xs font-bold animate-pulse">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
      <span>⏱️ {formatted} reserve window</span>
    </span>
  );
}

export default function UserDashboard() {
  const { user, updateUser } = useAuth();
  const [tab, setTab] = useState<UserTab>('overview');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [interests, setInterests] = useState<SeatInterest[]>([]);
  const [selectedTicketBooking, setSelectedTicketBooking] = useState<TicketBookingData | null>(null);
  const [trackedBooking, setTrackedBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [claimingId, setClaimingId] = useState<number | null>(null);
  const [claimedData, setClaimedData] = useState<{
    booking_id: number;
    payment_id: number;
    seat_number: number;
    amount: number;
    message: string;
  } | null>(null);
  const [payingWithPaystack, setPayingWithPaystack] = useState(false);

  // Profile editing state
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState(user?.full_name || '');
  const [editEmail, setEditEmail] = useState(user?.email || '');
  const [editPhone, setEditPhone] = useState(user?.phone || '');
  const [editPassword, setEditPassword] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNotice, setProfileNotice] = useState('');
  const [profileError, setProfileError] = useState('');

  // Auto-switch to tab if passed in URL e.g. /user?tab=account
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const urlTab = params.get('tab');
        if (urlTab && ['overview', 'book', 'rides', 'tracking', 'waitlist', 'history', 'account', 'mzigo'].includes(urlTab)) {
          setTab(urlTab as UserTab);
        }
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const loadBookings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [b, i] = await Promise.all([fetchUserBookings(), fetchSeatInterests()]);
      setBookings(b.bookings);
      setInterests(i.interests);
      setTrackedBooking((prev) => {
        if (prev) return prev;
        const upcomingFirst = b.bookings.find(
          (x) => x.trip_status === 'scheduled' && x.status !== 'cancelled'
        );
        return upcomingFirst || b.bookings[0] || null;
      });
    } catch (err) {
      setError(errMsg(err) || 'Failed to load bookings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred so we don't synchronously setState inside the effect body.
    const t = window.setTimeout(() => {
      loadBookings();
    }, 0);
    return () => window.clearTimeout(t);
  }, [loadBookings]);

  const upcoming = bookings.filter((b) => b.trip_status === 'scheduled' && b.status !== 'cancelled');
  const past = bookings.filter((b) => !upcoming.includes(b));

  const handleCancel = async (bookingId: number) => {
    if (!window.confirm('Cancel this booking? The seat will be released to other passengers.')) return;
    try {
      await cancelBooking(bookingId);
      loadBookings();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const handleRemoveInterest = async (id: number) => {
    try {
      await deleteSeatInterest(id);
      loadBookings();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const handleClaimInterest = async (interestId: number) => {
    try {
      setClaimingId(interestId);
      setError('');
      const res = await claimSeatInterest(interestId);
      setClaimedData(res);
      await loadBookings();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setClaimingId(null);
    }
  };

  const handlePayClaimedWithPaystack = async () => {
    if (!claimedData) return;
    try {
      setPayingWithPaystack(true);
      setError('');
      const res = await paystackInitialize(claimedData.booking_id);
      if (res.authorization_url) {
        window.location.href = res.authorization_url;
      } else {
        setError('Failed to obtain Paystack checkout URL.');
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setPayingWithPaystack(false);
    }
  };

  const startEditingProfile = () => {
    setEditName(user?.full_name || '');
    setEditEmail(user?.email || '');
    setEditPhone(user?.phone || '');
    setEditPassword('');
    setProfileNotice('');
    setProfileError('');
    setIsEditingProfile(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      setProfileError('Full name is required.');
      return;
    }
    try {
      setSavingProfile(true);
      setProfileError('');
      setProfileNotice('');
      const updated = await updateProfile({
        full_name: editName.trim(),
        email: editEmail.trim() || undefined,
        phone: editPhone.trim() || undefined,
        password: editPassword.trim() ? editPassword : undefined,
      });
      updateUser(updated);
      setProfileNotice('✓ Profile updated successfully!');
      setIsEditingProfile(false);
      setEditPassword('');
    } catch (err) {
      setProfileError(errMsg(err));
    } finally {
      setSavingProfile(false);
    }
  };

  const navGroups: FluxNavGroup[] = [
    {
      title: 'OVERVIEW',
      items: [
        { id: 'overview', label: 'Dashboard', icon: <IconDashboard /> },
        { id: 'book', label: 'Book a Seat', icon: <IconRoute />, badge: 'New' },
        { id: 'mzigo', label: 'Mzigo & Cargo Tracker', icon: <IconTrip />, badge: 'Cargo' },
        { id: 'rides', label: 'My Upcoming Rides', icon: <IconTrip />, badge: upcoming.length },
        {
          id: 'tracking',
          label: 'Live Bus Tracker',
          icon: <IconRoute />,
          badge: upcoming.length > 0 ? 'Live' : undefined,
        },
        { id: 'waitlist', label: 'Waitlist Alerts', icon: <IconBell />, badge: interests.length },
        { id: 'history', label: 'Travel History', icon: <IconTicket />, badge: past.length },
      ],
    },
    {
      title: 'ACCOUNT & SETTINGS',
      items: [
        { id: 'account', label: 'Passenger Profile', icon: <IconUsers /> },
      ],
    },
  ];

  const metrics: FluxMetric[] = [
    {
      label: 'TOTAL BOOKINGS',
      value: `${bookings.length}`,
      change: `${upcoming.length} active journeys`,
      trend: 'up',
      icon: <IconTrip className="w-3.5 h-3.5" />,
    },
    {
      label: 'NEXT RIDE',
      value: upcoming[0]?.seat_number ? `Seat #${upcoming[0].seat_number}` : 'None',
      change: upcoming[0]?.route_name || 'No upcoming travel',
      trend: 'up',
      icon: <IconTicket className="w-3.5 h-3.5" />,
    },
    {
      label: 'WAITLIST ALERTS',
      value: `${interests.length}`,
      change: 'Relay chain watches',
      trend: 'up',
      icon: <IconZap className="w-3.5 h-3.5" />,
    },
    {
      label: 'MEMBERSHIP',
      value: 'VERIFIED',
      change: 'M-Pesa enabled',
      trend: 'up',
      icon: <IconActivity className="w-3.5 h-3.5" />,
    },
  ];

  return (
    <RequireRole roles={['user']}>
      <FluxDashboardShell
        activeTab={tab}
        onTabChange={(t) => setTab(t as UserTab)}
        navGroups={navGroups}
        metrics={metrics}
        heroGreeting="Good morning"
        heroSubtitle="Review your upcoming rides, ticket booking details, and seat relay alerts."
        primaryAction={{
          label: '+ Book Seat',
          href: '/',
        }}
        searchPlaceholder="Search your trips, tickets, routes..."
      >
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm font-bold rounded-2xl px-5 py-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-slate-800 bg-[#121624] p-12 text-center">
            <p className="text-slate-400 animate-pulse">Loading passenger tickets & bookings…</p>
          </div>
        ) : (
          <>
            {tab === 'overview' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left 2/3: Upcoming Bookings & Fast Action */}
                <div className="lg:col-span-2 space-y-6">
                  <div className="rounded-2xl border border-slate-800/80 bg-[#121624] p-6 shadow-xl">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-base font-bold text-white tracking-wide">Next Upcoming Journey</h2>
                      <button
                        onClick={() => setTab('book')}
                        className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition"
                      >
                        Book Another Ride →
                      </button>
                    </div>

                    {upcoming.length === 0 ? (
                      <div className="text-center py-8 space-y-3">
                        <p className="text-slate-400 text-sm">You have no upcoming trips scheduled.</p>
                        <div className="flex flex-wrap items-center justify-center gap-3">
                          <button
                            onClick={() => setTab('book')}
                            className="inline-block px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black rounded-xl text-xs shadow-lg transition"
                          >
                            Find and Book a Bus
                          </button>
                          <button
                            onClick={() =>
                              setSelectedTicketBooking({
                                id: 1042,
                                trip_id: 1,
                                seat_number: 8,
                                board_stop_order: 1,
                                alight_stop_order: 4,
                                status: 'confirmed',
                                payment_status: 'paid',
                                trip_name: 'Mombasa Express 08:00 AM',
                                route_name: 'Nairobi — Mombasa Highway',
                                board_stop: 'Nairobi Central Terminal',
                                alight_stop: 'Mombasa Coastal Hub',
                                vehicle_plate: 'KDA 451B',
                                vehicle_model: 'Scania Metroliner',
                                driver_name: 'Captain J. Mwangi',
                                departure_time: new Date().toISOString(),
                              })
                            }
                            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold rounded-xl text-xs border border-slate-700 transition"
                          >
                            <IconTicket className="w-3.5 h-3.5" />
                            <span>Preview Demo Boarding Pass</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {upcoming.slice(0, 2).map((b) => (
                          <div key={b.id} className="rounded-xl bg-[#090d16] p-5 border border-slate-800">
                            <div className="flex flex-wrap justify-between items-start gap-4">
                              <div>
                                <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">{b.trip_name}</span>
                                <h3 className="text-lg font-bold text-white mt-1">{b.route_name}</h3>
                                <p className="text-sm text-slate-400 mt-1">
                                  {b.board_stop ?? 'Stop ' + b.board_stop_order} → {b.alight_stop ?? 'Stop ' + b.alight_stop_order}
                                </p>
                                <p className="text-xs text-slate-500 mt-2">
                                  Physical Seat <span className="font-mono font-bold text-white">#{b.seat_number}</span> · Service: <span className="font-mono text-slate-300">{b.trip_name}</span>
                                </p>
                              </div>
                              <div className="flex flex-col items-end gap-2">
                                <div className="flex items-center gap-2">
                                  <span className={statusBadge(b.status)}>{b.status}</span>
                                  <span className={statusBadge(b.payment_status)}>{b.payment_status}</span>
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  <button
                                    onClick={() => {
                                      setTrackedBooking(b);
                                      setTab('tracking');
                                    }}
                                    className="text-xs bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 font-bold px-3 py-1.5 rounded-lg border border-emerald-500/30 transition flex items-center gap-1.5 shadow-sm"
                                  >
                                    <IconRoute className="w-3.5 h-3.5" />
                                    <span>Track Bus</span>
                                  </button>
                                  <button
                                    onClick={() => setSelectedTicketBooking(b as unknown as TicketBookingData)}
                                    className="text-xs bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 font-bold px-3 py-1.5 rounded-lg border border-cyan-500/30 transition flex items-center gap-1.5 shadow-sm"
                                  >
                                    <IconTicket className="w-3.5 h-3.5" />
                                    <span>Boarding Pass</span>
                                  </button>
                                  {b.status !== 'cancelled' && (
                                    <button
                                      onClick={() => handleCancel(b.id)}
                                      className="text-xs bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 font-bold px-3 py-1.5 rounded-lg transition"
                                    >
                                      Cancel Booking
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Profile & Account snippet */}
                  <div className="rounded-2xl border border-slate-800/80 bg-[#121624] p-6 shadow-xl">
                    <h2 className="text-base font-bold text-white tracking-wide mb-4">Passenger Credentials</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                      <div className="rounded-xl bg-[#090d16] p-4 border border-slate-800">
                        <p className="uppercase text-slate-500 font-bold">Full Name</p>
                        <p className="text-sm font-semibold text-white mt-1">{user?.full_name}</p>
                      </div>
                      <div className="rounded-xl bg-[#090d16] p-4 border border-slate-800">
                        <p className="uppercase text-slate-500 font-bold">Email</p>
                        <p className="text-sm font-semibold text-white mt-1 truncate">{user?.email ?? '—'}</p>
                      </div>
                      <div className="rounded-xl bg-[#090d16] p-4 border border-slate-800">
                        <p className="uppercase text-slate-500 font-bold">Mobile</p>
                        <p className="text-sm font-semibold text-white mt-1">{user?.phone ?? '—'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right 1/3: Travel Status & Updates */}
                <div className="space-y-6">
                  <FluxProgressWidget
                    title="Sprint 24 · Ride Status"
                    subtitle="Journey progression & verification"
                    linkText="View all ↗"
                    onLinkClick={() => setTab('rides')}
                    segments={[
                      { label: 'Confirmed', count: upcoming.filter((b) => b.status === 'confirmed').length || 1, color: 'bg-cyan-400', pct: 60 },
                      { label: 'Pending', count: upcoming.filter((b) => b.status === 'pending').length || 0, color: 'bg-amber-400', pct: 20 },
                      { label: 'Past Rides', count: past.length || 2, color: 'bg-slate-600', pct: 20 },
                    ]}
                  />

                  <FluxActivityWidget
                    title="Transit Activity"
                    subtitle="Latest travel events"
                    linkText="View all ↗"
                    onLinkClick={() => setTab('history')}
                    items={
                      bookings.length > 0
                        ? bookings.slice(0, 5).map((b, idx) => {
                            const colors = [
                              'bg-blue-500/20 text-blue-400 border-blue-500/30',
                              'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
                              'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
                              'bg-pink-500/20 text-pink-400 border-pink-500/30',
                              'bg-purple-500/20 text-purple-400 border-purple-500/30',
                            ];
                            const initialsList = ['SC', 'AM', 'PK', 'ML', 'JT'];
                            return {
                              id: b.id,
                              initials: initialsList[idx % initialsList.length],
                              name: b.route_name,
                              action: `booked seat #${b.seat_number} (${b.status})`,
                              time: `${(idx + 1) * 15}m`,
                              avatarColor: colors[idx % colors.length],
                            };
                          })
                        : undefined
                    }
                  />
                </div>
              </div>
            )}

            {tab === 'book' && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3 bg-[#121624] p-5 rounded-2xl border border-slate-800 shadow-xl">
                  <div>
                    <h2 className="text-lg font-bold text-white tracking-wide flex items-center gap-2">
                      <span>Corridor PSV Booking Station</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                        Official Kenyan Fleet
                      </span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Search trips between highway stops, reserve authentic seats, and pay instantly via Safaricom M-Pesa STK push.
                    </p>
                  </div>
                </div>

                <PassengerBookingFlow
                  userPhone={user?.phone ?? undefined}
                  userName={user?.full_name ?? undefined}
                  onBookingComplete={async (bookingId, bookingData) => {
                    await loadBookings();
                    setSelectedTicketBooking(bookingData);
                    setTrackedBooking(bookingData as unknown as Booking);
                  }}
                  onNavigateToTracking={(tripId) => {
                    setTab('tracking');
                  }}
                />
              </div>
            )}

            {tab === 'rides' && (
              <div className="rounded-2xl border border-slate-800/80 bg-[#121624] p-6 shadow-xl">
                <h2 className="text-lg font-bold text-white mb-4">Upcoming Rides ({upcoming.length})</h2>
                {upcoming.length === 0 ? (
                  <p className="text-slate-500 text-sm">No upcoming rides scheduled.</p>
                ) : (
                  <div className="space-y-4">
                    {upcoming.map((b) => (
                      <div key={b.id} className="rounded-xl bg-[#090d16] p-5 border border-slate-800">
                        <div className="flex flex-wrap justify-between items-start gap-4">
                          <div>
                            <p className="font-bold text-white text-base">{b.route_name}</p>
                            <p className="text-sm text-slate-400 mt-0.5">
                              {b.board_stop ?? 'Stop ' + b.board_stop_order} → {b.alight_stop ?? 'Stop ' + b.alight_stop_order}
                            </p>
                            <p className="text-xs text-slate-500 mt-2">
                              Seat <span className="font-mono text-cyan-300 font-bold">#{b.seat_number}</span> · {b.trip_name}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <div className="flex items-center gap-2">
                              <span className={statusBadge(b.status)}>{b.status}</span>
                              <span className={statusBadge(b.payment_status)}>{b.payment_status}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <button
                                onClick={() => {
                                  setTrackedBooking(b);
                                  setTab('tracking');
                                }}
                                className="text-xs bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 font-bold px-3 py-1.5 rounded-lg border border-emerald-500/30 transition flex items-center gap-1.5 shadow-sm"
                              >
                                <IconRoute className="w-3.5 h-3.5" />
                                <span>Track Bus</span>
                              </button>
                              <button
                                onClick={() => setSelectedTicketBooking(b as unknown as TicketBookingData)}
                                className="text-xs bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 font-bold px-3 py-1.5 rounded-lg border border-cyan-500/30 transition flex items-center gap-1.5 shadow-sm"
                              >
                                <IconTicket className="w-3.5 h-3.5" />
                                <span>Boarding Pass</span>
                              </button>
                              {b.status !== 'cancelled' && (
                                <button
                                  onClick={() => handleCancel(b.id)}
                                  className="text-xs bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 font-bold px-3 py-1.5 rounded-lg transition"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'tracking' && (
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-800/80 bg-[#121624] p-6 shadow-xl">
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                    <div>
                      <h2 className="text-xl font-black text-white flex items-center gap-2.5">
                        <IconRoute className="w-6 h-6 text-cyan-400" />
                        <span>Live Bus Tracking & Corridor Navigation</span>
                      </h2>
                      <p className="text-xs text-slate-400 mt-1">
                        Real-time GPS corridor positioning, highway waypoint milestones, and live seat vacancy updates.
                      </p>
                    </div>

                    {/* Booking switcher if user has multiple bookings */}
                    {bookings.length > 1 && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-400">Track Journey:</span>
                        <select
                          value={trackedBooking?.id ?? ''}
                          onChange={(e) => {
                            const b = bookings.find((x) => x.id === Number(e.target.value));
                            if (b) setTrackedBooking(b);
                          }}
                          className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:ring-1 focus:ring-cyan-400"
                        >
                          {bookings.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.route_name} (#{b.trip_name} · Seat {b.seat_number})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {trackedBooking ? (
                    <div className="space-y-6">
                      {/* Active Journey Snapshot Card */}
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 rounded-xl border border-slate-800 bg-[#090d16] p-4 text-xs">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Service</span>
                          <p className="font-bold text-white text-sm mt-0.5 truncate">{trackedBooking.route_name}</p>
                          <p className="text-slate-400 text-[11px]">{trackedBooking.trip_name}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Your Pick-up Stop</span>
                          <p className="font-bold text-emerald-400 text-sm mt-0.5">
                            {trackedBooking.board_stop ?? `Stop #${trackedBooking.board_stop_order}`}
                          </p>
                          <p className="text-slate-400 text-[11px]">Stop Order #{trackedBooking.board_stop_order}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Your Destination</span>
                          <p className="font-bold text-purple-400 text-sm mt-0.5">
                            {trackedBooking.alight_stop ?? `Stop #${trackedBooking.alight_stop_order}`}
                          </p>
                          <p className="text-slate-400 text-[11px]">Stop Order #{trackedBooking.alight_stop_order}</p>
                        </div>
                        <div className="flex flex-col justify-between items-start sm:items-end">
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Assigned Seat</span>
                            <p className="font-mono font-black text-cyan-300 text-base">#{trackedBooking.seat_number}</p>
                          </div>
                          <button
                            onClick={() => setSelectedTicketBooking(trackedBooking as unknown as TicketBookingData)}
                            className="mt-2 flex items-center gap-1.5 rounded-lg bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/20 transition shadow-sm"
                          >
                            <IconTicket className="w-3.5 h-3.5" />
                            <span>Boarding Pass</span>
                          </button>
                        </div>
                      </div>

                      {/* Live Transit Map Component */}
                      <LiveTransitMap
                        tripId={trackedBooking.trip_id}
                        routeName={trackedBooking.route_name}
                        vehiclePlate={trackedBooking.vehicle_plate}
                        currentStopOrder={trackedBooking.current_stop_order ?? 1}
                        initialLat={trackedBooking.current_lat}
                        initialLng={trackedBooking.current_lng}
                        initialSpeed={trackedBooking.current_speed}
                        initialHeading={trackedBooking.current_heading}
                        userBoardStopOrder={trackedBooking.board_stop_order}
                        userAlightStopOrder={trackedBooking.alight_stop_order}
                        tripStatus={trackedBooking.trip_status}
                      />
                    </div>
                  ) : (
                    /* Demo / Preview Interactive Transit Corridor */
                    <div className="space-y-4">
                      <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 text-xs text-cyan-200">
                        <p className="font-bold">✨ Interactive Transit Map Demo Mode</p>
                        <p className="mt-1 text-cyan-300/80">
                          You do not have an active booking yet. Below is a live interactive simulation of the Nairobi — Nakuru Highway Corridor.
                          Book a seat anytime to track your live bus!
                        </p>
                      </div>

                      <LiveTransitMap
                        tripId={1}
                        routeName="Nairobi — Nakuru Express (Demo Corridor)"
                        vehiclePlate="KDA 890L"
                        stops={[
                          { id: 1, stop_name: 'Nairobi Central', stop_order: 1 },
                          { id: 2, stop_name: 'Westlands', stop_order: 2 },
                          { id: 3, stop_name: 'Limuru Stage', stop_order: 3 },
                          { id: 4, stop_name: 'Naivasha Junction', stop_order: 4 },
                          { id: 5, stop_name: 'Gilgil', stop_order: 5 },
                          { id: 6, stop_name: 'Nakuru Terminal', stop_order: 6 },
                        ]}
                        currentStopOrder={2}
                        userBoardStopOrder={1}
                        userAlightStopOrder={6}
                        tripStatus="in_progress"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'waitlist' && (
              <div className="rounded-2xl border border-slate-800/80 bg-[#121624] p-6 shadow-xl">
                <h2 className="text-lg font-bold text-white mb-4">Seat Waitlist Alerts ({interests.length})</h2>
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                      <span>Seat Waitlist Alerts</span>
                      <span className="text-xs bg-cyan-500/20 text-cyan-300 font-mono font-bold px-2.5 py-0.5 rounded-full border border-cyan-500/30">
                        {interests.length}
                      </span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      Real-time corridor seat releases. When a seat frees up on your boarding segment, claim it within the 5-minute reservation timer before it returns to open booking.
                    </p>
                  </div>
                </div>

                {interests.length === 0 ? (
                  <p className="text-slate-500 text-sm">
                    No waitlist entries. When seats become available at your stop, you&apos;ll be notified.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {interests.map((i) => (
                      <div key={i.id} className="rounded-xl bg-[#090d16] p-4 border border-slate-800 flex flex-wrap justify-between items-center gap-4">
                        <div>
                          <div className="flex items-center gap-2.5">
                            <p className="font-bold text-white">{i.route_name}</p>
                            {i.status !== 'claimed' && <WaitlistReserveTimer createdAt={i.created_at} />}
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            {i.board_stop ?? 'Stop ' + i.board_stop_order} → {i.alight_stop ?? 'Stop ' + i.alight_stop_order}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-1">
                            {i.seat_number ? `Preferred Seat #${i.seat_number}` : 'Any seat'} · {i.trip_name}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={statusBadge(i.status)}>{i.status}</span>
                          {i.status !== 'claimed' ? (
                            <button
                              onClick={() => handleClaimInterest(i.id)}
                              disabled={claimingId === i.id}
                              className="text-xs bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold px-3 py-1.5 rounded-lg transition flex items-center gap-1 shadow-md shadow-emerald-500/20"
                            >
                              <span>⚡</span>
                              <span>{claimingId === i.id ? 'Reserving...' : 'Claim & Book Seat'}</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => setTab('rides')}
                              className="text-xs bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 font-bold px-3 py-1.5 rounded-lg transition"
                            >
                              View in Rides →
                            </button>
                          )}
                          <button
                            onClick={() => handleRemoveInterest(i.id)}
                            className="text-xs bg-slate-800 text-slate-400 hover:bg-slate-700 font-bold px-3 py-1.5 rounded-lg transition"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'history' && (
              <div className="rounded-2xl border border-slate-800/80 bg-[#121624] p-6 shadow-xl">
                <h2 className="text-lg font-bold text-white mb-4">Ride History ({past.length})</h2>
                {past.length === 0 ? (
                  <p className="text-slate-500 text-sm">No past journeys recorded.</p>
                ) : (
                  <div className="space-y-3">
                    {past.map((b) => (
                      <div key={b.id} className="rounded-xl bg-[#090d16] p-4 border border-slate-800 flex justify-between items-center">
                        <div>
                          <p className="font-bold text-white">{b.route_name}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {b.board_stop ?? 'Stop ' + b.board_stop_order} → {b.alight_stop ?? 'Stop ' + b.alight_stop_order}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-1">
                            Seat #{b.seat_number} · {b.trip_name} · {b.trip_status}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={statusBadge(b.status)}>{b.status}</span>
                          <span className={statusBadge(b.payment_status)}>{b.payment_status}</span>
                          <button
                            onClick={() => setSelectedTicketBooking(b as unknown as TicketBookingData)}
                            className="text-xs bg-slate-800 text-slate-300 hover:text-cyan-300 hover:bg-slate-700 font-bold px-2.5 py-1 rounded-lg transition flex items-center gap-1 border border-slate-700"
                            title="View E-Ticket"
                          >
                            <IconTicket className="w-3.5 h-3.5" />
                            <span>Ticket</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'account' && (
              <div className="rounded-2xl border border-slate-800/80 bg-[#121624] p-6 shadow-xl max-w-2xl space-y-6">
                {/* Header with Avatar and Edit action */}
                <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center font-bold text-white text-lg shadow-lg border border-white/20">
                      {user?.full_name ? user.full_name.slice(0, 2).toUpperCase() : 'PS'}
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <span>{user?.full_name || 'Passenger Profile'}</span>
                        <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                          {user?.role || 'user'}
                        </span>
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">{user?.email || 'No email registered'}</p>
                    </div>
                  </div>

                  {!isEditingProfile ? (
                    <button
                      onClick={startEditingProfile}
                      className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl text-xs transition shadow-md shadow-blue-600/20 flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>✏️</span>
                      <span>Edit Profile</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => setIsEditingProfile(false)}
                      disabled={savingProfile}
                      className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs transition border border-slate-700 cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                </div>

                {/* Feedback banners */}
                {profileNotice && (
                  <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium flex items-center justify-between">
                    <span>{profileNotice}</span>
                    <button onClick={() => setProfileNotice('')} className="text-slate-400 hover:text-white font-bold ml-2">✕</button>
                  </div>
                )}
                {profileError && (
                  <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium flex items-center justify-between">
                    <span>{profileError}</span>
                    <button onClick={() => setProfileError('')} className="text-slate-400 hover:text-white font-bold ml-2">✕</button>
                  </div>
                )}

                {/* Edit Form or Display View */}
                {isEditingProfile ? (
                  <form onSubmit={handleSaveProfile} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                        Full Name <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="e.g. Jane Mwangi"
                        required
                        className="w-full p-3 border border-slate-700/80 rounded-xl bg-slate-950 text-white text-sm focus:outline-none focus:border-cyan-400 transition"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                        Email Address
                      </label>
                      <input
                        type="email"
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        placeholder="e.g. passenger@busgo.test"
                        className="w-full p-3 border border-slate-700/80 rounded-xl bg-slate-950 text-white text-sm focus:outline-none focus:border-cyan-400 transition"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                        Phone Number (for M-Pesa & SMS tickets)
                      </label>
                      <input
                        type="tel"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        placeholder="e.g. 254712345678"
                        className="w-full p-3 border border-slate-700/80 rounded-xl bg-slate-950 text-white text-sm focus:outline-none focus:border-cyan-400 font-mono transition"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                        New Password <span className="text-slate-500 font-normal lowercase">(optional — leave blank to keep current)</span>
                      </label>
                      <input
                        type="password"
                        value={editPassword}
                        onChange={(e) => setEditPassword(e.target.value)}
                        placeholder="••••••••"
                        minLength={6}
                        className="w-full p-3 border border-slate-700/80 rounded-xl bg-slate-950 text-white text-sm focus:outline-none focus:border-cyan-400 transition"
                      />
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                      <button
                        type="submit"
                        disabled={savingProfile}
                        className="px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition shadow-lg shadow-cyan-500/20 cursor-pointer"
                      >
                        {savingProfile ? 'Saving Changes...' : 'Save Profile Changes'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditingProfile(false)}
                        disabled={savingProfile}
                        className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl text-xs transition cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-3 text-sm">
                    <div className="rounded-xl bg-[#090d16] p-4 border border-slate-800 flex justify-between items-center">
                      <div>
                        <span className="text-xs uppercase tracking-wider text-slate-500 font-bold">Full Name</span>
                        <p className="font-semibold text-white mt-1">{user?.full_name}</p>
                      </div>
                      <span className="text-xs text-slate-500 font-mono">Verified Passenger</span>
                    </div>
                    <div className="rounded-xl bg-[#090d16] p-4 border border-slate-800 flex justify-between items-center">
                      <div>
                        <span className="text-xs uppercase tracking-wider text-slate-500 font-bold">Email Address</span>
                        <p className="font-semibold text-white mt-1">{user?.email ?? '—'}</p>
                      </div>
                      <span className="text-xs text-emerald-400 font-mono">Primary Login</span>
                    </div>
                    <div className="rounded-xl bg-[#090d16] p-4 border border-slate-800 flex justify-between items-center">
                      <div>
                        <span className="text-xs uppercase tracking-wider text-slate-500 font-bold">Phone Number</span>
                        <p className="font-semibold text-white mt-1 font-mono">{user?.phone ?? '—'}</p>
                      </div>
                      <span className="text-xs text-cyan-400 font-mono">M-Pesa STK</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div className="rounded-xl bg-[#090d16] p-4 border border-slate-800">
                        <span className="text-xs uppercase tracking-wider text-slate-500 font-bold">Lifetime Bookings</span>
                        <p className="font-semibold font-mono text-white text-lg mt-1">{bookings.length}</p>
                      </div>
                      <div className="rounded-xl bg-[#090d16] p-4 border border-slate-800">
                        <span className="text-xs uppercase tracking-wider text-slate-500 font-bold">Active Waitlists</span>
                        <p className="font-semibold font-mono text-amber-400 text-lg mt-1">{interests.length}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'mzigo' && <MzigoTracker />}

            {/* Digital Boarding Pass Modal */}
            <DigitalTicketModal
              booking={selectedTicketBooking}
              passengerName={user?.full_name}
              onClose={() => setSelectedTicketBooking(null)}
            />

            {/* Auto-Claimed Seat Checkout Modal */}
            {claimedData && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="bg-[#121624] border border-emerald-500/30 rounded-3xl p-6 max-w-md w-full shadow-2xl relative">
                  <div className="text-center space-y-3">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto text-2xl">
                      ⚡
                    </div>
                    <h3 className="text-xl font-bold text-white">Seat Reserved!</h3>
                    <p className="text-xs text-slate-400">
                      {claimedData.message}
                    </p>

                    <div className="bg-[#090d16] p-4 rounded-2xl border border-slate-800 space-y-2 text-left my-4">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">Reserved Seat</span>
                        <span className="font-mono font-bold text-emerald-400 text-sm">#{claimedData.seat_number}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">Booking Reference</span>
                        <span className="font-mono text-slate-200">#{claimedData.booking_id}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs border-t border-slate-800/80 pt-2">
                        <span className="text-slate-400 font-bold">Segment Fare</span>
                        <span className="font-mono font-bold text-white text-base">KES {claimedData.amount.toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="space-y-2 pt-2">
                      <button
                        onClick={handlePayClaimedWithPaystack}
                        disabled={payingWithPaystack}
                        className="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold rounded-xl text-sm transition shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
                      >
                        <span>💳</span>
                        <span>{payingWithPaystack ? 'Connecting to Paystack...' : `Pay KES ${claimedData.amount} via Paystack`}</span>
                      </button>

                      <button
                        onClick={() => {
                          setClaimedData(null);
                          setTab('rides');
                        }}
                        className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl text-xs transition"
                      >
                        View in Upcoming Rides
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </FluxDashboardShell>
    </RequireRole>
  );
}
