'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchTripParcels,
  registerTripParcel,
  updateParcelStatus,
  dispatchParcel,
  Parcel,
  TripRow,
  TripStop,
  errMsg,
} from '@/services/api';
import { IconTrip, IconRoute, IconZap, IconUsers } from '@/components/dashboard/FluxIcons';

interface MzigoManifestProps {
  tripId: number;
  currentTrip?: TripRow | null;
  stops: TripStop[];
}

const CATEGORY_FEES: Record<string, number> = {
  small_envelope: 150,
  medium_box: 300,
  heavy_sack: 500,
  special_fragile: 800,
};

export default function MzigoManifest({ tripId, currentTrip, stops }: MzigoManifestProps) {
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [luggageSummary, setLuggageSummary] = useState<{
    booking_count?: number;
    total_bags?: number;
    total_luggage_fee?: number;
  }>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<string>('all');

  // Verify PIN Handover Modal
  const [pinModalParcel, setPinModalParcel] = useState<Parcel | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [verifyingPin, setVerifyingPin] = useState(false);

  // Register Walk-up Cargo Modal
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [senderName, setSenderName] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [pickupStop, setPickupStop] = useState<number>(stops[0]?.stop_order ?? 1);
  const [dropoffStop, setDropoffStop] = useState<number>(stops[stops.length - 1]?.stop_order ?? 2);
  const [category, setCategory] = useState('medium_box');
  const [description, setDescription] = useState('');
  const [customFee, setCustomFee] = useState<number>(300);
  const [registering, setRegistering] = useState(false);

  const showToast = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(''), 4000);
  };

  const loadParcels = useCallback(async () => {
    if (!tripId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetchTripParcels(tripId);
      setParcels(res.parcels);
      setLuggageSummary(res.luggage_summary);
    } catch (err) {
      setError(errMsg(err) || 'Failed to load cargo manifest.');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    loadParcels();
  }, [loadParcels]);

  // Update category and default fee
  const handleCategoryChange = (cat: string) => {
    setCategory(cat);
    setCustomFee(CATEGORY_FEES[cat] ?? 300);
  };

  const handleStatusAdvance = async (parcel: Parcel, nextStatus: string) => {
    if (nextStatus === 'delivered') {
      setPinModalParcel(parcel);
      setPinInput('');
      setPinError('');
      return;
    }
    try {
      await updateParcelStatus(parcel.id, { status: nextStatus });
      showToast(`Package ${parcel.tracking_code} marked as '${nextStatus}'`);
      await loadParcels();
    } catch (err) {
      setError(errMsg(err) || 'Failed to update package status.');
    }
  };

  const handleVerifyPinAndDeliver = async () => {
    if (!pinModalParcel || !pinInput.trim()) return;
    setVerifyingPin(true);
    setPinError('');
    try {
      await updateParcelStatus(pinModalParcel.id, {
        status: 'delivered',
        security_pin: pinInput.trim(),
      });
      showToast(`✓ Package ${pinModalParcel.tracking_code} successfully verified and released!`);
      setPinModalParcel(null);
      await loadParcels();
    } catch (err) {
      setPinError(errMsg(err) || 'Invalid Security PIN! Verification failed.');
    } finally {
      setVerifyingPin(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pickupStop >= dropoffStop) {
      setError('Pickup stop must come before destination stop.');
      return;
    }
    setRegistering(true);
    setError('');
    try {
      const res = await registerTripParcel(tripId, {
        sender_name: senderName,
        sender_phone: senderPhone,
        recipient_name: recipientName,
        recipient_phone: recipientPhone,
        pickup_stop_order: pickupStop,
        dropoff_stop_order: dropoffStop,
        category,
        description,
        fee: customFee,
        payment_status: 'paid',
      });
      showToast(`✓ Registered Cargo ${res.tracking_code} (PIN: ${res.security_pin})!`);
      setShowRegisterModal(false);
      // Reset form
      setSenderName('');
      setSenderPhone('');
      setRecipientName('');
      setRecipientPhone('');
      setDescription('');
      await loadParcels();
    } catch (err) {
      setError(errMsg(err) || 'Failed to register cargo.');
    } finally {
      setRegistering(false);
    }
  };

  const filteredParcels = parcels.filter((p) => {
    if (filter === 'all') return true;
    return p.status === filter;
  });

  const totalCargoRevenue = parcels.reduce((acc, p) => acc + (p.fee || 0), 0);

  return (
    <div className="space-y-6">
      {/* Toast Notice */}
      {notice && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-bold rounded-2xl px-5 py-4 animate-in fade-in">
          {notice}
        </div>
      )}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm font-bold rounded-2xl px-5 py-4 animate-in fade-in">
          {error}
        </div>
      )}

      {/* Top Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Active Unaccompanied Parcels
          </span>
          <div className="font-mono text-2xl font-black text-cyan-400 mt-1">
            {parcels.length} <span className="text-xs text-slate-400 font-sans font-normal">items</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {parcels.filter((p) => p.status === 'in_transit').length} currently in transit
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Accompanied Luggage On Board
          </span>
          <div className="font-mono text-2xl font-black text-emerald-400 mt-1">
            {luggageSummary.total_bags || 0} <span className="text-xs text-slate-400 font-sans font-normal">bags</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            From {luggageSummary.booking_count || 0} passenger bookings (KES {luggageSummary.total_luggage_fee || 0} fee)
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Total Cargo Revenue
          </span>
          <div className="font-mono text-2xl font-black text-white mt-1">
            KES {(totalCargoRevenue + (luggageSummary.total_luggage_fee || 0)).toLocaleString()}
          </div>
          <p className="text-[11px] text-emerald-400 mt-1 font-bold">
            Cargo: KES {totalCargoRevenue.toLocaleString()} + Baggage: KES {(luggageSummary.total_luggage_fee || 0).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Header with Quick Actions */}
      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <h3 className="text-lg font-black text-white flex items-center gap-2">
              <span>📦 Mzigo & Cargo Manifest</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-mono">
                TRIP #{tripId}
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Verify packages, manage baggage in the trunk, and perform secure collection handovers.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRegisterModal(true)}
              className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl shadow-lg transition flex items-center gap-1.5"
            >
              <span>+</span>
              <span>Register Walk-up Cargo</span>
            </button>

            <button
              onClick={loadParcels}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition"
              title="Refresh Manifest"
            >
              🔄
            </button>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2">
          {['all', 'registered', 'loaded', 'in_transit', 'arrived', 'delivered'].map((st) => (
            <button
              key={st}
              onClick={() => setFilter(st)}
              className={`px-3 py-1 rounded-xl text-xs font-bold capitalize transition border ${
                filter === st
                  ? 'bg-cyan-500 text-slate-950 border-cyan-400'
                  : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-white'
              }`}
            >
              {st.replace('_', ' ')}
            </button>
          ))}
        </div>

        {/* Parcels List */}
        {filteredParcels.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-sm">
            No packages match the selected filter.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredParcels.map((p) => (
              <div
                key={p.id}
                className="bg-[#090d16] border border-slate-800/80 rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 transition hover:border-slate-700"
              >
                {/* Left: Code, Category & Route */}
                <div className="space-y-1.5 min-w-[240px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-black text-cyan-400 text-sm">{p.tracking_code}</span>
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
                      {p.category.replace('_', ' ')}
                    </span>
                    <span
                      className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md border ${
                        p.status === 'delivered'
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : p.status === 'in_transit'
                          ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                          : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                      }`}
                    >
                      {p.status.replace('_', ' ')}
                    </span>
                    {p.delivery_type === 'doorstep' ? (
                      <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                        🏠 Door Delivery
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700">
                        🏢 Station Pickup
                      </span>
                    )}
                  </div>

                  <h4 className="text-sm font-bold text-white">{p.description}</h4>

                  <div className="text-xs text-slate-400 flex items-center gap-1.5">
                    <span className="text-emerald-400 font-bold">{p.pickup_stop_name}</span>
                    <span>→</span>
                    <span className="text-purple-400 font-bold">{p.dropoff_stop_name}</span>
                  </div>
                </div>

                {/* Middle: Contacts */}
                <div className="text-xs space-y-1 min-w-[200px]">
                  <div className="text-slate-300">
                    <span className="text-slate-500">Recipient:</span> <strong>{p.recipient_name}</strong> ({p.recipient_phone})
                  </div>
                  {p.delivery_type === 'doorstep' && (
                    <div className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-lg">
                      <div className="font-semibold flex items-center gap-1">
                        <span>📍 Delivery Address:</span>
                        <span>{p.recipient_address || p.recipient_city_or_area || 'Standard Doorstep'}</span>
                      </div>
                      {p.recipient_delivery_notes && (
                        <div className="text-slate-400 text-[10px] italic">Note: {p.recipient_delivery_notes}</div>
                      )}
                    </div>
                  )}
                  <div className="text-slate-400">
                    <span className="text-slate-500">Sender:</span> {p.sender_name} ({p.sender_phone})
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Fee: <strong className="text-emerald-400">KES {p.fee}</strong> · Claim PIN: <span className="font-mono text-amber-400 font-bold">****</span>
                  </div>
                </div>

                {/* Right: Operational Actions */}
                <div className="flex flex-wrap items-center gap-2">
                  {p.status === 'registered' && (
                    <button
                      onClick={() => handleStatusAdvance(p, 'loaded')}
                      className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-bold transition"
                    >
                      📥 Mark Loaded
                    </button>
                  )}

                  {p.status === 'loaded' && (
                    <button
                      onClick={() => handleStatusAdvance(p, 'in_transit')}
                      className="px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-xl text-xs font-bold transition"
                    >
                      🚗 Mark In Transit
                    </button>
                  )}

                  {p.status === 'in_transit' && (
                    <button
                      onClick={() => handleStatusAdvance(p, 'arrived')}
                      className="px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-xl text-xs font-bold transition"
                    >
                      📍 Mark Arrived
                    </button>
                  )}

                  {p.status === 'arrived' && (
                    <button
                      onClick={() => handleStatusAdvance(p, 'delivered')}
                      className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl text-xs transition shadow-lg flex items-center gap-1"
                    >
                      <span>🔒</span>
                      <span>Verify PIN & Handover</span>
                    </button>
                  )}

                  {p.status === 'delivered' && (
                    <span className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl text-xs font-bold">
                      ✓ Handed Over
                    </span>
                  )}

                  {/* Direct WhatsApp recipient link */}
                  <a
                    href={`https://wa.me/${p.recipient_phone.replace('+', '')}?text=${encodeURIComponent(
                      p.delivery_type === 'doorstep'
                        ? `Hello ${p.recipient_name}, this is your BUSGO driver/courier for trip #${tripId}. Your package ${p.tracking_code} is arriving for doorstep delivery to ${p.recipient_address || p.dropoff_stop_name}. Please prepare your 4-digit secret PIN for handover.`
                        : `Hello ${p.recipient_name}, this is the BUSGO driver for trip #${tripId}. Your package ${p.tracking_code} is arriving at ${p.dropoff_stop_name} parcel office. Please have your 4-digit PIN ready for collection.`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs transition"
                    title="WhatsApp Recipient"
                  >
                    💬
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Verify PIN Modal */}
      {pinModalParcel && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-[#0e1424] border border-emerald-500/30 p-6 sm:p-7 rounded-3xl max-w-md w-full shadow-2xl space-y-4">
            <div className="text-center space-y-2">
              <span className="text-3xl">🔒</span>
              <h3 className="text-lg font-black text-white">Verify Recipient Claim PIN</h3>
              <p className="text-xs text-slate-400">
                Package <strong className="font-mono text-cyan-400">{pinModalParcel.tracking_code}</strong> for{' '}
                <strong className="text-white">{pinModalParcel.recipient_name}</strong> ({pinModalParcel.recipient_phone}).
              </p>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-xs space-y-1">
              <div className="text-slate-300">
                Item: <strong>{pinModalParcel.description}</strong>
              </div>
              <div className="text-slate-400">
                Dropoff Station: <strong className="text-purple-400">{pinModalParcel.dropoff_stop_name}</strong>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 text-center">
                Enter 4-Digit Security PIN:
              </label>
              <input
                type="text"
                maxLength={4}
                autoFocus
                placeholder="••••"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                className="w-full text-center tracking-[0.5em] font-mono text-2xl font-black rounded-2xl border border-slate-700 bg-slate-950 py-3 text-white focus:border-emerald-400 focus:outline-none"
              />
            </div>

            {pinError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-center text-xs font-bold text-rose-300">
                {pinError}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPinModalParcel(null)}
                className="w-1/2 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs transition border border-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleVerifyPinAndDeliver}
                disabled={verifyingPin || pinInput.trim().length !== 4}
                className="w-1/2 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl text-xs transition shadow-lg disabled:opacity-40"
              >
                {verifyingPin ? 'Verifying...' : 'Confirm Release'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Register Walk-up Cargo Modal */}
      {showRegisterModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in">
          <form
            onSubmit={handleRegisterSubmit}
            className="bg-[#0e1424] border border-cyan-500/30 p-6 sm:p-7 rounded-3xl max-w-lg w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <span>📦</span>
                <span>Register Walk-up Cargo (Mzigo)</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowRegisterModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Sender & Recipient fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Sender Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. John Kamau"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white placeholder-slate-600 focus:border-cyan-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Sender Phone
                </label>
                <input
                  type="text"
                  required
                  placeholder="07XXXXXXXX"
                  value={senderPhone}
                  onChange={(e) => setSenderPhone(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white placeholder-slate-600 focus:border-cyan-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Recipient Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Mary Achieng"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white placeholder-slate-600 focus:border-cyan-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Recipient Phone (Gets PIN)
                </label>
                <input
                  type="text"
                  required
                  placeholder="07XXXXXXXX"
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white placeholder-slate-600 focus:border-cyan-400 focus:outline-none"
                />
              </div>
            </div>

            {/* Stops */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Pick-up Stop
                </label>
                <select
                  value={pickupStop}
                  onChange={(e) => setPickupStop(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs font-bold text-white focus:border-cyan-400 focus:outline-none"
                >
                  {stops.map((s) => (
                    <option key={s.id} value={s.stop_order}>
                      Stop #{s.stop_order} — {s.stop_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Drop-off Stop
                </label>
                <select
                  value={dropoffStop}
                  onChange={(e) => setDropoffStop(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs font-bold text-white focus:border-cyan-400 focus:outline-none"
                >
                  {stops.map((s) => (
                    <option key={s.id} value={s.stop_order}>
                      Stop #{s.stop_order} — {s.stop_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Category & Description */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Package Category
                </label>
                <select
                  value={category}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs font-bold text-white focus:border-cyan-400 focus:outline-none"
                >
                  <option value="small_envelope">Small / Documents (KES 150)</option>
                  <option value="medium_box">Standard Box / Bag (KES 300)</option>
                  <option value="heavy_sack">Heavy Sack / Produce (KES 500)</option>
                  <option value="special_fragile">Special / Fragile (KES 800)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Fee (KES)
                </label>
                <input
                  type="number"
                  required
                  value={customFee}
                  onChange={(e) => setCustomFee(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs font-mono font-bold text-emerald-400 focus:border-cyan-400 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Description of Package
              </label>
              <input
                type="text"
                required
                placeholder="e.g. 50kg Sack of Maize, Laptop in bag"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white placeholder-slate-600 focus:border-cyan-400 focus:outline-none"
              />
            </div>

            <div className="pt-3 border-t border-slate-800 flex gap-3">
              <button
                type="button"
                onClick={() => setShowRegisterModal(false)}
                className="w-1/2 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs transition border border-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={registering}
                className="w-1/2 py-3 bg-gradient-to-r from-cyan-500 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider transition shadow-lg disabled:opacity-40"
              >
                {registering ? 'Registering...' : 'Register & Dispatch SMS/WA'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

