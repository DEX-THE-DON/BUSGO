'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import RequireRole from '@/components/RequireRole';
import NotificationsBell from '@/components/NotificationsBell';
import { useAuth } from '@/context/AuthContext';
import {
  fetchUserBookings,
  fetchSeatInterests,
  deleteSeatInterest,
  cancelBooking,
  Booking,
  SeatInterest,
  errMsg,
} from '@/services/api';

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    confirmed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    cancelled: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    paid: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    unpaid: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  };
  return `text-xs font-bold px-3 py-1 rounded-full border capitalize ${map[status] ?? 'bg-slate-800 text-slate-300 border-slate-700'}`;
};

export default function UserDashboard() {
  const { user, logout } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [interests, setInterests] = useState<SeatInterest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadBookings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [b, i] = await Promise.all([fetchUserBookings(), fetchSeatInterests()]);
      setBookings(b.bookings);
      setInterests(i.interests);
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

  return (
    <RequireRole roles={['user']}>
      <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-2xl flex justify-between items-center">
            <div>
              <span className="bg-cyan-500/10 text-cyan-300 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                Passenger Dashboard
              </span>
              <h1 className="text-4xl font-black mt-4">Welcome back, {user?.full_name}</h1>
              <p className="text-slate-400 mt-2 text-sm">
                Review your upcoming rides, booking details, and seat status.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <NotificationsBell />
              <Link href="/" className="text-sm text-slate-400 hover:text-emerald-300 font-semibold">
                Book a seat
              </Link>
              <button
                onClick={logout}
                className="text-sm bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-xl font-bold text-slate-300"
              >
                Logout
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm font-bold rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Account summary */}
            <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-xl">
              <h2 className="text-xl font-bold text-white mb-4">Account Summary</h2>
              <div className="grid grid-cols-1 gap-4 text-slate-300 text-sm">
                <div className="rounded-2xl bg-slate-950/70 p-4 border border-slate-800">
                  <p className="text-xs uppercase tracking-wider text-slate-500">Name</p>
                  <p className="font-semibold">{user?.full_name}</p>
                </div>
                <div className="rounded-2xl bg-slate-950/70 p-4 border border-slate-800">
                  <p className="text-xs uppercase tracking-wider text-slate-500">Email</p>
                  <p className="font-semibold break-all">{user?.email ?? '—'}</p>
                </div>
                <div className="rounded-2xl bg-slate-950/70 p-4 border border-slate-800">
                  <p className="text-xs uppercase tracking-wider text-slate-500">Phone</p>
                  <p className="font-semibold">{user?.phone ?? '—'}</p>
                </div>
                <div className="rounded-2xl bg-slate-950/70 p-4 border border-slate-800">
                  <p className="text-xs uppercase tracking-wider text-slate-500">Total bookings</p>
                  <p className="font-semibold">{bookings.length}</p>
                </div>
              </div>
            </div>

            {/* Bookings */}
            <div className="lg:col-span-2 bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-xl">
              <h2 className="text-xl font-bold text-white mb-4">My Bookings</h2>

              {loading ? (
                <p className="text-slate-400 text-sm">Loading bookings…</p>
              ) : bookings.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-slate-400 mb-4">You have no bookings yet.</p>
                  <Link
                    href="/"
                    className="inline-block px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl"
                  >
                    Book your first seat
                  </Link>
                </div>
              ) : (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                      Upcoming ({upcoming.length})
                    </h3>
                    {upcoming.length === 0 ? (
                      <p className="text-sm text-slate-500">No upcoming rides.</p>
                    ) : (
                      <div className="space-y-3">
                        {upcoming.map((b) => (
                          <div key={b.id} className="rounded-2xl bg-slate-950/70 p-4 border border-slate-800">
                            <div className="flex justify-between items-start gap-3">
                              <div>
                                <p className="font-bold text-white">{b.route_name}</p>
                                <p className="text-sm text-slate-400">
                                  {b.board_stop ?? 'Stop ' + b.board_stop_order} →{' '}
                                  {b.alight_stop ?? 'Stop ' + b.alight_stop_order}
                                </p>
                                <p className="text-xs text-slate-500 mt-1">
                                  Seat #{b.seat_number} · {b.trip_name}
                                </p>
                              </div>
                              <div className="flex flex-col items-end gap-1.5">
                                <span className={statusBadge(b.status)}>{b.status}</span>
                                <span className={statusBadge(b.payment_status)}>{b.payment_status}</span>
                                {b.status !== 'cancelled' && (
                                  <button
                                    onClick={() => handleCancel(b.id)}
                                    className="text-xs bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 font-bold px-2 py-1 rounded-lg"
                                  >
                                    Cancel
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                      History ({past.length})
                    </h3>
                    {past.length === 0 ? (
                      <p className="text-sm text-slate-500">No past rides yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {past.map((b) => (
                          <div key={b.id} className="rounded-2xl bg-slate-950/70 p-4 border border-slate-800">
                            <div className="flex justify-between items-start gap-3">
                              <div>
                                <p className="font-bold text-white">{b.route_name}</p>
                                <p className="text-sm text-slate-400">
                                  {b.board_stop ?? 'Stop ' + b.board_stop_order} →{' '}
                                  {b.alight_stop ?? 'Stop ' + b.alight_stop_order}
                                </p>
                                <p className="text-xs text-slate-500 mt-1">
                                  Seat #{b.seat_number} · {b.trip_name} · {b.trip_status}
                                </p>
                              </div>
                              <div className="flex flex-col items-end gap-1.5">
                                <span className={statusBadge(b.status)}>{b.status}</span>
                                <span className={statusBadge(b.payment_status)}>{b.payment_status}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Seat waitlist */}
                  <div>
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                      🔔 Seat waitlist ({interests.length})
                    </h3>
                    {interests.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        No waitlist entries.{' '}
                        <Link href="/" className="text-emerald-400 hover:text-emerald-300 font-semibold">
                          Watch a segment
                        </Link>{' '}
                        to be notified when a seat frees up.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {interests.map((i) => (
                          <div key={i.id} className="rounded-2xl bg-slate-950/70 p-4 border border-slate-800">
                            <div className="flex justify-between items-start gap-3">
                              <div>
                                <p className="font-bold text-white">{i.route_name}</p>
                                <p className="text-sm text-slate-400">
                                  {i.board_stop ?? 'Stop ' + i.board_stop_order} →{' '}
                                  {i.alight_stop ?? 'Stop ' + i.alight_stop_order}
                                </p>
                                <p className="text-xs text-slate-500 mt-1">
                                  {i.seat_number ? `Seat #${i.seat_number}` : 'Any seat'} · {i.trip_name}
                                </p>
                              </div>
                              <div className="flex flex-col items-end gap-1.5">
                                <span className={statusBadge(i.status)}>{i.status}</span>
                                <button
                                  onClick={() => handleRemoveInterest(i.id)}
                                  className="text-xs bg-slate-800 text-slate-400 hover:bg-slate-700 font-bold px-2 py-1 rounded-lg"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </RequireRole>
  );
}
