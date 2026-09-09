'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  createGroupBooking,
  fetchGroupBooking,
  payGroupShare,
  fetchSeatMap,
  SeatMapEntry,
  GroupBooking,
  errMsg,
} from '@/services/api';

interface GroupBookingModalProps {
  tripId: number;
  routeName: string;
  boardStopOrder: number;
  alightStopOrder: number;
  boardStopName: string;
  alightStopName: string;
  selectedSeats?: number[];
  initialSelectedSeat?: number | null;
  unitFare: number;
  onClose: () => void;
  onSuccess?: (groupId: number) => void;
}

export default function GroupBookingModal({
  tripId,
  routeName,
  boardStopOrder,
  alightStopOrder,
  boardStopName,
  alightStopName,
  selectedSeats,
  initialSelectedSeat,
  unitFare,
  onClose,
  onSuccess,
}: GroupBookingModalProps) {
  const [groupName, setGroupName] = useState('Chama Roadtrip Crew');
  const [members, setMembers] = useState<
    { seat_number: number; passenger_name: string; phone_number: string }[]
  >([]);
  const [activeGroup, setActiveGroup] = useState<GroupBooking | null>(null);
  const [loading, setLoading] = useState(false);
  const [seatMapLoading, setSeatMapLoading] = useState(true);
  const [seatMap, setSeatMap] = useState<SeatMapEntry[]>([]);
  const [seatCapacity, setSeatCapacity] = useState<number>(14);
  const [payingMemberId, setPayingMemberId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [secondsRemaining, setSecondsRemaining] = useState<number>(900);

  // 1. Fetch real-time seat availability for this specific trip segment
  useEffect(() => {
    let isMounted = true;
    setSeatMapLoading(true);
    setError('');

    fetchSeatMap(tripId, boardStopOrder, alightStopOrder)
      .then((res) => {
        if (!isMounted) return;
        setSeatMap(res.seats || []);
        const cap = res.seat_capacity || 14;
        setSeatCapacity(cap);

        // Find truly free seats
        const freeSeats = (res.seats || [])
          .filter((s) => s.state === 'free')
          .map((s) => s.seat_number);

        if (freeSeats.length < 2) {
          setError(
            `Only ${freeSeats.length} seat(s) available on this bus for this segment. Group split fare requires at least 2 available seats.`
          );
        }

        // Determine starting seats:
        // Try initialSelectedSeat or selectedSeats, but ONLY if they are genuinely free
        const chosen: number[] = [];
        const candidates = [
          ...(initialSelectedSeat ? [initialSelectedSeat] : []),
          ...(selectedSeats || []),
        ];

        for (const c of candidates) {
          if (freeSeats.includes(c) && !chosen.includes(c)) {
            chosen.push(c);
          }
        }

        // Fill remaining up to 2 using the first available free seats
        for (const f of freeSeats) {
          if (chosen.length >= 2) break;
          if (!chosen.includes(f)) {
            chosen.push(f);
          }
        }

        // Populate initial members with the verified free seats
        if (chosen.length > 0) {
          setMembers(
            chosen.map((seat, idx) => ({
              seat_number: seat,
              passenger_name: idx === 0 ? 'Lead Organizer' : `Friend #${idx + 1}`,
              phone_number: `2547${Math.floor(10000000 + Math.random() * 90000000)}`,
            }))
          );
        }
      })
      .catch((err) => {
        if (isMounted) setError(errMsg(err));
      })
      .finally(() => {
        if (isMounted) setSeatMapLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [tripId, boardStopOrder, alightStopOrder, initialSelectedSeat]);

  // Set of free seats from the seatMap
  const availableSeatNumbers = useMemo(() => {
    return seatMap.filter((s) => s.state === 'free').map((s) => s.seat_number);
  }, [seatMap]);

  // Selected seat numbers in the current group members list
  const selectedSeatNumbers = useMemo(() => {
    return members.map((m) => m.seat_number);
  }, [members]);

  // Unselected free seats (available for new members or reassignments)
  const remainingFreeSeats = useMemo(() => {
    return availableSeatNumbers.filter((s) => !selectedSeatNumbers.includes(s));
  }, [availableSeatNumbers, selectedSeatNumbers]);

  // Toggle seat selection on the visual manual seat grid
  const handleToggleSeat = (seatNum: number) => {
    setError('');
    const isCurrentlySelected = selectedSeatNumbers.includes(seatNum);

    if (isCurrentlySelected) {
      if (members.length <= 2) {
        setError('Changa na Marafiki requires at least 2 seats. Please add another seat first before removing this one.');
        return;
      }
      setMembers((prev) => prev.filter((m) => m.seat_number !== seatNum));
    } else {
      // Add seat to members
      const newMemberIdx = members.length;
      setMembers((prev) => [
        ...prev,
        {
          seat_number: seatNum,
          passenger_name: `Friend #${newMemberIdx + 1}`,
          phone_number: `2547${Math.floor(10000000 + Math.random() * 90000000)}`,
        },
      ]);
    }
  };

  // Change a specific member's seat via dropdown
  const handleChangeMemberSeat = (memberIdx: number, newSeat: number) => {
    setError('');
    setMembers((prev) => {
      const copy = [...prev];
      copy[memberIdx] = { ...copy[memberIdx], seat_number: newSeat };
      return copy;
    });
  };

  // Add a friend with the next free seat
  const handleAddMember = () => {
    setError('');
    if (remainingFreeSeats.length === 0) {
      setError('No more free seats available on this vehicle for this segment.');
      return;
    }
    const nextSeat = remainingFreeSeats[0];
    const newIdx = members.length;
    setMembers((prev) => [
      ...prev,
      {
        seat_number: nextSeat,
        passenger_name: `Friend #${newIdx + 1}`,
        phone_number: `2547${Math.floor(10000000 + Math.random() * 90000000)}`,
      },
    ]);
  };

  // Remove a member
  const handleRemoveMember = (seatNum: number) => {
    setError('');
    if (members.length <= 2) {
      setError('Changa na Marafiki requires at least 2 seats.');
      return;
    }
    setMembers((prev) => prev.filter((m) => m.seat_number !== seatNum));
  };

  // Countdown timer when group is active
  useEffect(() => {
    if (!activeGroup || activeGroup.status !== 'pending') return;
    const interval = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [activeGroup]);

  // Poll group status
  const refreshStatus = useCallback(async () => {
    if (!activeGroup?.group_id) return;
    try {
      const data = await fetchGroupBooking(activeGroup.group_id);
      setActiveGroup(data);
      if (data.seconds_remaining !== undefined) {
        setSecondsRemaining(data.seconds_remaining);
      }
    } catch (err) {
      console.error(err);
    }
  }, [activeGroup?.group_id]);

  useEffect(() => {
    if (!activeGroup || activeGroup.status === 'completed' || activeGroup.status === 'expired') return;
    const poll = setInterval(refreshStatus, 4000);
    return () => clearInterval(poll);
  }, [activeGroup, refreshStatus]);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Pre-validation
    if (members.length < 2) {
      setError('Changa na Marafiki requires at least 2 passenger seats.');
      return;
    }

    const uniqueSeats = new Set(members.map((m) => m.seat_number));
    if (uniqueSeats.size !== members.length) {
      setError('Each friend must have a unique, distinct seat number.');
      return;
    }

    setLoading(true);
    try {
      const group = await createGroupBooking({
        trip_id: tripId,
        group_name: groupName.trim() || 'Safari Crew',
        board_stop_order: boardStopOrder,
        alight_stop_order: alightStopOrder,
        members,
      });
      setActiveGroup(group);
      setSecondsRemaining(900);
      if (onSuccess) onSuccess(group.group_id);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  const handlePayShare = async (memberId: number, phone: string) => {
    if (!activeGroup) return;
    setPayingMemberId(memberId);
    setError('');
    try {
      await payGroupShare(activeGroup.group_id, memberId, phone);
      await refreshStatus();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setPayingMemberId(null);
    }
  };

  const formatTimer = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const numSeats = members.length;
  const discountPct =
    numSeats >= 5 ? 15 : numSeats >= 3 ? 10 : numSeats >= 2 ? 5 : 0;
  const discountedUnitFare = Math.round(unitFare * (1 - discountPct / 100) * 100) / 100;
  const originalTotal = Math.round(unitFare * numSeats * 100) / 100;
  const totalFare = Math.round(discountedUnitFare * numSeats * 100) / 100;
  const totalDiscountSaved = Math.round((originalTotal - totalFare) * 100) / 100;

  const paidCount = activeGroup?.members.filter((m) => m.payment_status === 'paid').length ?? 0;
  const totalCount = activeGroup?.members.length ?? members.length;
  const progressPct = totalCount > 0 ? Math.round((paidCount / totalCount) * 100) : 0;

  // Build array of all seats on the vehicle for the interactive manual grid
  const allSeatNumbers = useMemo(() => {
    const cap = Math.max(seatCapacity, 14);
    return Array.from({ length: cap }, (_, i) => i + 1);
  }, [seatCapacity]);

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-slate-900 border border-amber-500/40 rounded-3xl p-5 sm:p-7 shadow-2xl shadow-amber-950/40 max-h-[92vh] flex flex-col relative overflow-hidden">
        {/* Glow Accent */}
        <div className="absolute -top-24 -right-24 w-60 h-60 bg-amber-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-60 h-60 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🤝</span>
              <h3 className="text-lg font-black tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-yellow-300 to-emerald-400 uppercase">
                Changa na Marafiki &bull; Split Fare Harambee
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {routeName} &bull; <span className="text-emerald-400 font-semibold">{boardStopName}</span> &rarr;{' '}
              <span className="text-amber-400 font-semibold">{alightStopName}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors text-xs font-bold"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mt-3 p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs font-semibold flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto pr-1 py-4 space-y-5">
          {!activeGroup ? (
            /* Setup Phase */
            <form onSubmit={handleCreateGroup} className="space-y-5">
              {/* Fare & Seats Summary Card with Group Shared Discount */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-950/30 via-slate-900 to-emerald-950/30 border border-amber-500/40 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-slate-400 font-semibold">Selected Group Seats:</span>
                  <span className="font-mono font-black text-amber-300">
                    {members.length} Seats ({members.map((m) => `#${m.seat_number}`).join(', ')})
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-slate-400 font-semibold">Per Passenger Share:</span>
                  <div className="flex items-center gap-2">
                    {discountPct > 0 && (
                      <span className="font-mono text-slate-500 line-through text-[11px]">
                        KES {unitFare}
                      </span>
                    )}
                    <span className="font-mono font-black text-white text-xs">
                      KES {discountedUnitFare}
                    </span>
                    {discountPct > 0 && (
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 font-bold text-[10px] border border-emerald-500/30">
                        {discountPct}% OFF
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-2 border-t border-slate-800">
                  <span className="text-slate-200 font-bold">Total Shared Harambee Fare:</span>
                  <div className="text-right">
                    <span className="font-mono font-black text-emerald-400 text-base">
                      KES {totalFare}
                    </span>
                    {discountPct > 0 && (
                      <span className="text-[10px] text-emerald-300 block font-bold">
                        🎉 Total Group Savings: KES {totalDiscountSaved}
                      </span>
                    )}
                  </div>
                </div>

                {/* Tiered Discount Perk Banner */}
                <div className="p-2.5 rounded-xl bg-emerald-950/50 border border-emerald-500/30 flex items-center justify-between text-[11px]">
                  <span className="font-bold text-emerald-300 flex items-center gap-1.5">
                    <span>🔥</span>
                    <span>
                      {discountPct === 15
                        ? '15% Mega Harambee Discount Unlocked!'
                        : discountPct === 10
                        ? '10% Chama Roadtrip Discount Unlocked!'
                        : discountPct === 5
                        ? '5% Chama Group Discount Unlocked!'
                        : 'Book 2+ seats for a Shared Group Discount!'}
                    </span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium">
                    {numSeats === 2
                      ? 'Add 1 more seat for 10% off'
                      : numSeats < 5
                      ? 'Add up to 5 seats for 15% off'
                      : 'Max group discount achieved'}
                  </span>
                </div>
              </div>

              {/* Manual Seat Selection Grid */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-black uppercase tracking-wider text-slate-200 block">
                      💺 Manually Select Group Seats
                    </label>
                    <span className="text-[11px] text-slate-400">
                      Tap any free seat to add or remove it from your crew
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-bold">
                    <span className="flex items-center gap-1 text-emerald-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                      {availableSeatNumbers.length} Free
                    </span>
                    <span className="flex items-center gap-1 text-amber-400">
                      <span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>
                      {members.length} Selected
                    </span>
                  </div>
                </div>

                {seatMapLoading ? (
                  <div className="p-6 text-center text-xs text-slate-400 animate-pulse">
                    Checking bus seat availability...
                  </div>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 max-h-48 overflow-y-auto p-1">
                    {allSeatNumbers.map((seatNum) => {
                      const isFree = availableSeatNumbers.includes(seatNum);
                      const isSelected = selectedSeatNumbers.includes(seatNum);

                      return (
                        <button
                          key={seatNum}
                          type="button"
                          disabled={!isFree}
                          onClick={() => handleToggleSeat(seatNum)}
                          className={`py-2 px-1 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center relative ${
                            isSelected
                              ? 'bg-amber-500/20 border-2 border-amber-400 text-amber-300 shadow-md shadow-amber-500/30 scale-[1.02]'
                              : isFree
                              ? 'bg-slate-900 border border-slate-700 hover:border-emerald-400 text-slate-200 hover:text-emerald-300 cursor-pointer active:scale-95'
                              : 'bg-slate-950/60 border border-slate-800/80 text-slate-600 cursor-not-allowed opacity-50'
                          }`}
                          title={
                            isSelected
                              ? `Seat #${seatNum} (Selected in Group)`
                              : isFree
                              ? `Seat #${seatNum} (Available - Click to select)`
                              : `Seat #${seatNum} (Booked / Occupied for this segment)`
                          }
                        >
                          <span className="font-mono text-xs">#{seatNum}</span>
                          <span className="text-[9px] font-normal leading-tight mt-0.5">
                            {isSelected ? '✓ In Crew' : isFree ? 'Free' : 'Taken'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Group Name Input */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Chama / Group Name
                </label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="e.g. Naivasha Weekend Trip, Mama Mboga Chama"
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-bold text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              {/* Member Assignment Cards */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Assign Friends &amp; M-Pesa Phone Numbers ({members.length} Members)
                  </label>
                  <button
                    type="button"
                    disabled={remainingFreeSeats.length === 0}
                    onClick={handleAddMember}
                    className="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-bold text-[10px] transition disabled:opacity-40"
                  >
                    + Add Friend / Seat
                  </button>
                </div>

                {members.map((m, idx) => (
                  <div
                    key={`member-${idx}`}
                    className="p-3 bg-slate-950/70 border border-slate-800 rounded-2xl flex flex-col sm:flex-row gap-2 items-stretch sm:items-center"
                  >
                    <div className="flex items-center gap-2 min-w-[130px]">
                      <span className="text-[10px] text-slate-400 font-bold uppercase">Seat</span>
                      {/* Manual Seat Dropdown */}
                      <select
                        value={m.seat_number}
                        onChange={(e) => handleChangeMemberSeat(idx, parseInt(e.target.value, 10))}
                        className="bg-slate-900 border border-amber-500/40 rounded-lg px-2 py-1 text-xs font-black text-amber-300 focus:outline-none focus:border-amber-400 cursor-pointer"
                      >
                        <option value={m.seat_number}>#{m.seat_number}</option>
                        {remainingFreeSeats.map((s) => (
                          <option key={s} value={s}>
                            #{s}
                          </option>
                        ))}
                      </select>
                    </div>

                    <input
                      type="text"
                      placeholder="Passenger Name"
                      value={m.passenger_name}
                      onChange={(e) => {
                        const copy = [...members];
                        copy[idx].passenger_name = e.target.value;
                        setMembers(copy);
                      }}
                      required
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    />

                    <input
                      type="text"
                      placeholder="2547..."
                      value={m.phone_number}
                      onChange={(e) => {
                        const copy = [...members];
                        copy[idx].phone_number = e.target.value;
                        setMembers(copy);
                      }}
                      required
                      className="w-full sm:w-36 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-cyan-400"
                    />

                    {members.length > 2 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(m.seat_number)}
                        className="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 hover:text-rose-200 text-xs font-bold self-end sm:self-center transition"
                        title="Remove member"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button
                type="submit"
                disabled={loading || seatMapLoading || members.length < 2}
                className="w-full py-3.5 bg-gradient-to-r from-amber-500 via-amber-600 to-emerald-600 hover:from-amber-400 hover:to-emerald-500 text-slate-950 font-black rounded-2xl text-xs uppercase tracking-wider transition shadow-lg shadow-amber-900/40 disabled:opacity-50"
              >
                {loading
                  ? 'Locking Seats...'
                  : `🔒 Lock ${members.length} Seats · Launch Changa (${discountPct}% Off · KES ${discountedUnitFare}/seat)`}
              </button>
            </form>
          ) : (
            /* Active Group Harambee Phase */
            <div className="space-y-4">
              {/* Progress & Countdown Bar */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-amber-500/40">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h4 className="text-sm font-black text-white">{activeGroup.group_name}</h4>
                    <span className="text-[10px] text-slate-400">
                      Group #{activeGroup.group_id} &bull; {paidCount} of {totalCount} shares settled
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">
                      Hold Timer
                    </span>
                    <span
                      className={`font-mono font-black text-sm ${
                        secondsRemaining < 180 ? 'text-rose-400 animate-pulse' : 'text-amber-300'
                      }`}
                    >
                      ⏱️ {formatTimer(secondsRemaining)}
                    </span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-amber-500 to-emerald-500 h-2.5 rounded-full transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                  <span>KES {activeGroup.paid_amount} Paid</span>
                  <span className="text-emerald-400 font-bold">
                    Total KES {activeGroup.total_amount}{' '}
                    {activeGroup.discount_pct ? `(${activeGroup.discount_pct}% Harambee Discount)` : ''}
                  </span>
                </div>
              </div>

              {/* Completion Banner */}
              {activeGroup.status === 'completed' ? (
                <div className="p-4 rounded-2xl bg-emerald-950/80 border border-emerald-500 text-center animate-in zoom-in-95 duration-200">
                  <span className="text-3xl block mb-1">🎉</span>
                  <h4 className="text-base font-black text-emerald-300">
                    Harambee Kamili! All Seats Confirmed!
                  </h4>
                  <p className="text-xs text-slate-300 mt-1">
                    Every member in {activeGroup.group_name} has paid their share. Digital boarding passes have been dispatched.
                  </p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="mt-3 px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition"
                  >
                    Close &amp; View Digital Tickets
                  </button>
                </div>
              ) : activeGroup.status === 'expired' ? (
                <div className="p-4 rounded-2xl bg-rose-950/80 border border-rose-600 text-center">
                  <span className="text-2xl block mb-1">⏳</span>
                  <h4 className="text-sm font-black text-rose-300">Changa Expired</h4>
                  <p className="text-xs text-slate-400 mt-1">
                    The 15-minute hold timer expired before all shares were settled. Unpaid seats have been released back to public inventory.
                  </p>
                </div>
              ) : null}

              {/* Member Payment Cards */}
              <div className="space-y-2.5">
                <h5 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Individual Shares &amp; M-Pesa Status
                </h5>
                {activeGroup.members.map((m) => {
                  const isPaid = m.payment_status === 'paid';
                  const isPaying = payingMemberId === m.id;
                  return (
                    <div
                      key={m.id}
                      className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between ${
                        isPaid
                          ? 'bg-emerald-950/20 border-emerald-500/40'
                          : 'bg-slate-950 border-slate-800'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white">{m.passenger_name}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono font-bold">
                            Seat #{m.seat_number}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                          {m.phone_number} &bull; KES {m.share_amount}
                        </div>
                        {isPaid && m.mpesa_receipt && (
                          <span className="text-[10px] text-emerald-400 font-mono block mt-0.5">
                            Receipt: {m.mpesa_receipt}
                          </span>
                        )}
                      </div>

                      <div>
                        {isPaid ? (
                          <span className="px-3 py-1 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-xs font-bold flex items-center gap-1">
                            <span>✓</span> Paid
                          </span>
                        ) : activeGroup.status === 'pending' ? (
                          <button
                            type="button"
                            disabled={isPaying}
                            onClick={() => handlePayShare(m.id ?? 0, m.phone_number)}
                            className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-xl shadow-md transition disabled:opacity-50 flex items-center gap-1.5"
                          >
                            {isPaying ? (
                              'Processing...'
                            ) : (
                              <>
                                <span>📱</span> Settle Share (KES {m.share_amount})
                              </>
                            )}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500">Unpaid</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
