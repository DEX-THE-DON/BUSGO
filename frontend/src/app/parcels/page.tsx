'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  getParcelQuote,
  bookParcel,
  trackParcelPublic,
  updateParcelStatus,
  Parcel,
  ParcelQuoteResponse,
  ParcelPickupType,
  ParcelDeliveryType,
  errMsg,
} from '@/services/api';
import TopNavSearchBar from '@/components/dashboard/TopNavSearchBar';
import NotificationsBell from '@/components/NotificationsBell';

const KENYAN_CITIES = [
  'Nairobi',
  'Nakuru',
  'Eldoret',
  'Kisumu',
  'Mombasa',
  'Naivasha',
  'Kericho',
  'Nanyuki',
];

const CATEGORIES = [
  { id: 'small_envelope', label: 'Documents & Envelope', icon: '✉️', desc: 'IDs, certificates, letters (< 1 kg)', base: 200 },
  { id: 'small_box', label: 'Small Box / Electronics', icon: '📱', desc: 'Phones, shoes, small gadgets (1–5 kg)', base: 350 },
  { id: 'medium_box', label: 'Medium Box / Carton', icon: '📦', desc: 'Clothes, books, kitchenware (5–15 kg)', base: 500 },
  { id: 'heavy_sack', label: 'Heavy Cargo / Produce', icon: '🌾', desc: 'Grains, farm sacks, machinery (15–30 kg)', base: 800 },
  { id: 'special_fragile', label: 'Fragile / Bulky Special', icon: '⚠️', desc: 'Glassware, electronics, 30+ kg', base: 1200 },
];

export default function ParcelsPage() {
  const [activeTab, setActiveTab] = useState<'send' | 'track'>('send');

  // Booking Form State
  const [originCity, setOriginCity] = useState('Nairobi');
  const [destinationCity, setDestinationCity] = useState('Nakuru');
  const [category, setCategory] = useState('medium_box');
  const [weightKg, setWeightKg] = useState(5);
  const [description, setDescription] = useState('');
  const [declaredValue, setDeclaredValue] = useState(0);

  // Door vs Station options
  const [pickupType, setPickupType] = useState<ParcelPickupType>('station');
  const [deliveryType, setDeliveryType] = useState<ParcelDeliveryType>('station');

  // Addresses & Notes
  const [senderName, setSenderName] = useState('');
  const [senderPhone, setSenderPhone] = useState('2547');
  const [senderAddress, setSenderAddress] = useState('');
  const [senderArea, setSenderArea] = useState('');
  const [senderNotes, setSenderNotes] = useState('');

  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('2547');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [recipientArea, setRecipientArea] = useState('');
  const [recipientNotes, setRecipientNotes] = useState('');

  const [paymentMethod, setPaymentMethod] = useState<'mpesa' | 'cash_at_station'>('mpesa');

  // Quote State
  const [quote, setQuote] = useState<ParcelQuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  // Booking action state
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [bookedSuccess, setBookedSuccess] = useState<any | null>(null);

  // Tracker State
  const [trackCode, setTrackCode] = useState('');
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackResult, setTrackResult] = useState<any | null>(null);
  const [trackError, setTrackError] = useState('');

  // Handover PIN state in tracker
  const [handoverPin, setHandoverPin] = useState('');
  const [handoverLoading, setHandoverLoading] = useState(false);
  const [handoverNotice, setHandoverNotice] = useState('');

  // Fetch live quotation whenever pricing factors change
  const refreshQuote = useCallback(async () => {
    setQuoteLoading(true);
    try {
      const q = await getParcelQuote({
        category,
        weight_kg: weightKg,
        pickup_type: pickupType,
        delivery_type: deliveryType,
        declared_value: declaredValue,
        origin_city: originCity,
        destination_city: destinationCity,
      });
      setQuote(q);
    } catch (err) {
      console.warn('Could not fetch parcel quote:', err);
    } finally {
      setQuoteLoading(false);
    }
  }, [category, weightKg, pickupType, deliveryType, declaredValue, originCity, destinationCity]);

  useEffect(() => {
    refreshQuote();
  }, [refreshQuote]);

  // URL search param listener for tracking code (e.g. /parcels?code=WB-MZG-XXXX)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      if (code) {
        setTrackCode(code);
        setActiveTab('track');
        handleTrackCode(code);
      }
    }
  }, []);

  const handleTrackCode = async (codeToSearch: string) => {
    const code = codeToSearch.trim().toUpperCase();
    if (!code) return;
    setTrackLoading(true);
    setTrackError('');
    setHandoverNotice('');
    try {
      const res = await trackParcelPublic(code);
      setTrackResult(res.parcel);
    } catch (err) {
      setTrackError(errMsg(err) || `No cargo package found with tracking code '${code}'.`);
      setTrackResult(null);
    } finally {
      setTrackLoading(false);
    }
  };

  // Submit Parcel Booking
  const handleBookParcel = async (e: React.FormEvent) => {
    e.preventDefault();
    setBookingLoading(true);
    setBookingError('');
    try {
      if (!senderName || !senderPhone || !recipientName || !recipientPhone || !description) {
        throw new Error('Please fill in sender, recipient, and parcel description details.');
      }
      if (pickupType === 'doorstep' && !senderAddress) {
        throw new Error('Please provide your doorstep address for courier pickup.');
      }
      if (deliveryType === 'doorstep' && !recipientAddress) {
        throw new Error("Please provide the recipient's doorstep delivery address.");
      }

      const res = await bookParcel({
        origin_city: originCity,
        destination_city: destinationCity,
        sender_name: senderName,
        sender_phone: senderPhone,
        recipient_name: recipientName,
        recipient_phone: recipientPhone,
        category,
        description,
        weight_kg: weightKg,
        pickup_type: pickupType,
        delivery_type: deliveryType,
        sender_address: senderAddress,
        sender_city_or_area: senderArea || originCity,
        sender_pickup_notes: senderNotes,
        recipient_address: recipientAddress,
        recipient_city_or_area: recipientArea || destinationCity,
        recipient_delivery_notes: recipientNotes,
        declared_value: declaredValue,
        payment_method: paymentMethod,
      });

      setBookedSuccess(res);
    } catch (err) {
      setBookingError(errMsg(err));
    } finally {
      setBookingLoading(false);
    }
  };

  // Handover PIN verification in Tracker
  const handleVerifyHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackResult?.id || !handoverPin) return;
    setHandoverLoading(true);
    setHandoverNotice('');
    try {
      await updateParcelStatus(trackResult.id, {
        status: 'delivered',
        security_pin: handoverPin.trim(),
      });
      setHandoverNotice('✓ Security PIN verified! Package marked as Delivered successfully.');
      // Refresh tracker
      await handleTrackCode(trackResult.tracking_code);
    } catch (err) {
      setHandoverNotice(`⚠️ Handover Failed: ${errMsg(err)}`);
    } finally {
      setHandoverLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#07090e] text-slate-100 p-4 sm:p-8">
      {/* Top Header */}
      <div className="max-w-7xl mx-auto mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">📦</span>
              <h1 className="text-xl sm:text-2xl font-black uppercase tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-sky-300 to-emerald-400">
                BUSGO Mzigo Express &bull; Courier Delivery
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              ENA Coach-style Flexible Intercity Parcel Delivery &bull; Station Drop-Off &bull; Doorstep Courier Pickup &amp; Delivery
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 shrink-0">
            <TopNavSearchBar
              placeholder="Search waybills, routes... (⌘K)"
              className="w-full sm:w-60 lg:w-72 min-w-0"
            />
            <Link
              href="/"
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-300 hover:text-white transition shrink-0"
            >
              Passenger Booking &rarr;
            </Link>
            <div className="relative shrink-0">
              <NotificationsBell />
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 mt-6">
          <button
            type="button"
            onClick={() => setActiveTab('send')}
            className={`px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-wider transition flex items-center gap-2 ${
              activeTab === 'send'
                ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-lg shadow-amber-500/20'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <span>🚚</span>
            <span>Send Parcel (Tuma Mzigo)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('track')}
            className={`px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-wider transition flex items-center gap-2 ${
              activeTab === 'track'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <span>🔍</span>
            <span>Live Waybill Tracker (Fuatilia Mzigo)</span>
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto">
        {/* ==================================================================== */}
        {/* TAB 1: SEND PARCEL WIZARD */}
        {/* ==================================================================== */}
        {activeTab === 'send' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left 2 Columns: Booking Form */}
            <div className="lg:col-span-2 space-y-6">
              <form onSubmit={handleBookParcel} className="space-y-6">
                {/* 1. Origin & Destination Corridor */}
                <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
                  <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
                    <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 font-mono text-xs flex items-center justify-center font-bold">
                      1
                    </span>
                    <h3 className="text-sm font-black uppercase tracking-wider text-white">
                      Intercity Highway Corridor
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
                        Origin Town / Hub
                      </label>
                      <select
                        value={originCity}
                        onChange={(e) => setOriginCity(e.target.value)}
                        className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-bold text-white focus:outline-none focus:border-cyan-500"
                      >
                        {KENYAN_CITIES.map((c) => (
                          <option key={c} value={c} disabled={c === destinationCity}>
                            {c} Station Hub
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
                        Destination Town / Hub
                      </label>
                      <select
                        value={destinationCity}
                        onChange={(e) => setDestinationCity(e.target.value)}
                        className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-bold text-white focus:outline-none focus:border-cyan-500"
                      >
                        {KENYAN_CITIES.map((c) => (
                          <option key={c} value={c} disabled={c === originCity}>
                            {c} Station Hub
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* 2. Flexible Pickup Mode Selection (ENA Coach Style) */}
                <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 font-mono text-xs flex items-center justify-center font-bold">
                        2
                      </span>
                      <h3 className="text-sm font-black uppercase tracking-wider text-white">
                        Sender Collection / Pickup Mode
                      </h3>
                    </div>
                    <span className="text-[10px] text-amber-400 font-bold uppercase">
                      Origin End ({originCity})
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Station Drop-Off */}
                    <button
                      type="button"
                      onClick={() => setPickupType('station')}
                      className={`p-4 rounded-2xl border text-left transition relative flex flex-col justify-between ${
                        pickupType === 'station'
                          ? 'bg-amber-500/15 border-amber-500 shadow-lg shadow-amber-500/10'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-xl">🏢</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-black">
                            INCLUDED / KES 0
                          </span>
                        </div>
                        <h4 className="font-bold text-xs text-white mt-2">Station Office Drop-Off</h4>
                        <p className="text-[11px] text-slate-400 mt-1">
                          Sender takes the parcel to the {originCity} bus office/stage counter before departure.
                        </p>
                      </div>
                      <div className="mt-3 text-[10px] font-mono text-amber-300 font-bold">
                        Standard Economical
                      </div>
                    </button>

                    {/* Doorstep Pickup */}
                    <button
                      type="button"
                      onClick={() => setPickupType('doorstep')}
                      className={`p-4 rounded-2xl border text-left transition relative flex flex-col justify-between ${
                        pickupType === 'doorstep'
                          ? 'bg-amber-500/15 border-amber-500 shadow-lg shadow-amber-500/10'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-xl">🛵</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-black">
                            +KES 300 SURCHARGE
                          </span>
                        </div>
                        <h4 className="font-bold text-xs text-white mt-2">Doorstep / Office Pickup</h4>
                        <p className="text-[11px] text-slate-400 mt-1">
                          A BusGo courier rider is dispatched directly to your doorstep/office in {originCity}.
                        </p>
                      </div>
                      <div className="mt-3 text-[10px] font-mono text-amber-300 font-bold">
                        Maximum Sender Convenience
                      </div>
                    </button>
                  </div>

                  {/* Sender Details */}
                  <div className="pt-2 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                          Sender Full Name *
                        </label>
                        <input
                          type="text"
                          required
                          value={senderName}
                          onChange={(e) => setSenderName(e.target.value)}
                          placeholder="e.g. John Mwangi"
                          className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-amber-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                          Sender Phone Number *
                        </label>
                        <input
                          type="tel"
                          required
                          value={senderPhone}
                          onChange={(e) => setSenderPhone(e.target.value)}
                          placeholder="2547XXXXXXXX"
                          className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                        />
                      </div>
                    </div>

                    {pickupType === 'doorstep' && (
                      <div className="p-3.5 rounded-2xl bg-slate-950 border border-amber-500/30 space-y-3 animate-in fade-in duration-200">
                        <div className="text-[11px] font-bold text-amber-300 flex items-center gap-1.5">
                          <span>📍</span>
                          <span>Doorstep Pickup Location Details</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                              Street / Estate / Building / House # *
                            </label>
                            <input
                              type="text"
                              required={pickupType === 'doorstep'}
                              value={senderAddress}
                              onChange={(e) => setSenderAddress(e.target.value)}
                              placeholder="e.g. Rhapta Road, Westlands, Apt 4B"
                              className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-amber-500"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                              Area / Neighborhood
                            </label>
                            <input
                              type="text"
                              value={senderArea}
                              onChange={(e) => setSenderArea(e.target.value)}
                              placeholder="e.g. Westlands / Kilimani"
                              className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-amber-500"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                            Pickup Instructions for Rider (Gate code, landmark, calling notes)
                          </label>
                          <input
                            type="text"
                            value={senderNotes}
                            onChange={(e) => setSenderNotes(e.target.value)}
                            placeholder="e.g. Ring gate 2 bell, package is in the reception"
                            className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Flexible Delivery Mode Selection (ENA Coach Style) */}
                <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 font-mono text-xs flex items-center justify-center font-bold">
                        3
                      </span>
                      <h3 className="text-sm font-black uppercase tracking-wider text-white">
                        Recipient Handover / Delivery Mode
                      </h3>
                    </div>
                    <span className="text-[10px] text-purple-400 font-bold uppercase">
                      Destination End ({destinationCity})
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Station Collection */}
                    <button
                      type="button"
                      onClick={() => setDeliveryType('station')}
                      className={`p-4 rounded-2xl border text-left transition relative flex flex-col justify-between ${
                        deliveryType === 'station'
                          ? 'bg-purple-500/15 border-purple-500 shadow-lg shadow-purple-500/10'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-xl">🏢</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-black">
                            INCLUDED / KES 0
                          </span>
                        </div>
                        <h4 className="font-bold text-xs text-white mt-2">Station Office Collection</h4>
                        <p className="text-[11px] text-slate-400 mt-1">
                          Recipient collects from the {destinationCity} bus terminus counter using their 4-digit secret PIN.
                        </p>
                      </div>
                      <div className="mt-3 text-[10px] font-mono text-purple-300 font-bold">
                        Free Station Pickup
                      </div>
                    </button>

                    {/* Doorstep Delivery */}
                    <button
                      type="button"
                      onClick={() => setDeliveryType('doorstep')}
                      className={`p-4 rounded-2xl border text-left transition relative flex flex-col justify-between ${
                        deliveryType === 'doorstep'
                          ? 'bg-purple-500/15 border-purple-500 shadow-lg shadow-purple-500/10'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-xl">🏠</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-black">
                            +KES 350 SURCHARGE
                          </span>
                        </div>
                        <h4 className="font-bold text-xs text-white mt-2">Doorstep Home / Office Delivery</h4>
                        <p className="text-[11px] text-slate-400 mt-1">
                          Last-mile delivery rider brings package directly to recipient&apos;s home or office in {destinationCity}.
                        </p>
                      </div>
                      <div className="mt-3 text-[10px] font-mono text-purple-300 font-bold">
                        Maximum Recipient Convenience
                      </div>
                    </button>
                  </div>

                  {/* Recipient Details */}
                  <div className="pt-2 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                          Recipient Full Name *
                        </label>
                        <input
                          type="text"
                          required
                          value={recipientName}
                          onChange={(e) => setRecipientName(e.target.value)}
                          placeholder="e.g. Mary Wanjiku"
                          className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                          Recipient Phone Number *
                        </label>
                        <input
                          type="tel"
                          required
                          value={recipientPhone}
                          onChange={(e) => setRecipientPhone(e.target.value)}
                          placeholder="2547XXXXXXXX"
                          className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    </div>

                    {deliveryType === 'doorstep' && (
                      <div className="p-3.5 rounded-2xl bg-slate-950 border border-purple-500/30 space-y-3 animate-in fade-in duration-200">
                        <div className="text-[11px] font-bold text-purple-300 flex items-center gap-1.5">
                          <span>📍</span>
                          <span>Recipient Doorstep Delivery Details</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                              Street / Estate / Building / House # *
                            </label>
                            <input
                              type="text"
                              required={deliveryType === 'doorstep'}
                              value={recipientAddress}
                              onChange={(e) => setRecipientAddress(e.target.value)}
                              placeholder="e.g. Section 58, Nakuru, House 12"
                              className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-purple-500"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                              Destination Area / Landmark
                            </label>
                            <input
                              type="text"
                              value={recipientArea}
                              onChange={(e) => setRecipientArea(e.target.value)}
                              placeholder="e.g. Near Total Petrol Station"
                              className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-purple-500"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                            Delivery Notes (Best delivery time, gate security instructions)
                          </label>
                          <input
                            type="text"
                            value={recipientNotes}
                            onChange={(e) => setRecipientNotes(e.target.value)}
                            placeholder="e.g. Call 15 mins before arrival, deliver before 6 PM"
                            className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-purple-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 4. Package Specifications */}
                <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
                  <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
                    <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 font-mono text-xs flex items-center justify-center font-bold">
                      4
                    </span>
                    <h3 className="text-sm font-black uppercase tracking-wider text-white">
                      Parcel Category &amp; Weight
                    </h3>
                  </div>

                  {/* Category Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setCategory(cat.id)}
                        className={`p-3 rounded-2xl border text-left transition flex flex-col justify-between ${
                          category === cat.id
                            ? 'bg-emerald-500/20 border-emerald-500 text-white'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xl">{cat.icon}</span>
                          <span className="text-[10px] font-mono text-emerald-400 font-bold">
                            From KES {cat.base}
                          </span>
                        </div>
                        <div className="mt-2">
                          <div className="font-bold text-xs">{cat.label}</div>
                          <div className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">{cat.desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[10px] font-bold uppercase text-slate-400">
                          Estimated Weight (KG)
                        </label>
                        <span className="font-mono font-bold text-emerald-400 text-xs">{weightKg} KG</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={50}
                        step={1}
                        value={weightKg}
                        onChange={(e) => setWeightKg(Number(e.target.value))}
                        className="w-full accent-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                        Declared Value for Insurance (Optional)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={500}
                        value={declaredValue}
                        onChange={(e) => setDeclaredValue(Number(e.target.value))}
                        placeholder="e.g. 10000"
                        className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                      Parcel Description *
                    </label>
                    <input
                      type="text"
                      required
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="e.g. 2 Travel bags, Lenovo Thinkpad Laptop, sack of potatoes"
                      className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={bookingLoading}
                  className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 hover:opacity-95 text-slate-950 font-black text-sm uppercase tracking-wider transition shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-2"
                >
                  {bookingLoading ? (
                    <span className="animate-pulse">Booking Waybill &amp; Generating PIN...</span>
                  ) : (
                    <>
                      <span>📦</span>
                      <span>
                        Confirm Waybill Booking &bull; Total KES {quote?.total_fee ?? 500}
                      </span>
                    </>
                  )}
                </button>

                {bookingError && (
                  <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-bold">
                    ⚠️ {bookingError}
                  </div>
                )}
              </form>
            </div>

            {/* Right Column: Live Pricing Breakdown & Service Summary */}
            <div className="space-y-6">
              {/* Cost Breakdown Card */}
              <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl space-y-4 sticky top-24">
                <div className="pb-3 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🧾</span>
                    <h3 className="text-sm font-black uppercase tracking-wider text-white">
                      Transparent Cost Breakdown
                    </h3>
                  </div>
                  {quoteLoading && <span className="text-[10px] text-cyan-400 animate-pulse">Calculating...</span>}
                </div>

                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between text-slate-300">
                    <span>Base Highway Transit:</span>
                    <span className="font-mono font-bold">KES {quote?.base_fare ?? 500}</span>
                  </div>

                  <div className="flex justify-between items-center text-slate-300">
                    <div className="flex items-center gap-1.5">
                      <span>Sender Pickup:</span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded font-bold uppercase bg-slate-800 text-amber-300">
                        {pickupType === 'doorstep' ? 'Doorstep Rider' : 'Station Drop-off'}
                      </span>
                    </div>
                    <span className="font-mono font-bold text-amber-400">
                      {quote?.pickup_fee ? `+KES ${quote.pickup_fee}` : 'FREE (KES 0)'}
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-slate-300">
                    <div className="flex items-center gap-1.5">
                      <span>Recipient Delivery:</span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded font-bold uppercase bg-slate-800 text-purple-300">
                        {deliveryType === 'doorstep' ? 'Doorstep Rider' : 'Station Pickup'}
                      </span>
                    </div>
                    <span className="font-mono font-bold text-purple-400">
                      {quote?.delivery_fee ? `+KES ${quote.delivery_fee}` : 'FREE (KES 0)'}
                    </span>
                  </div>

                  {Boolean(quote?.insurance_fee) && (
                    <div className="flex justify-between text-slate-300">
                      <span>Cargo Insurance (1.5%):</span>
                      <span className="font-mono font-bold text-cyan-400">+KES {quote?.insurance_fee}</span>
                    </div>
                  )}

                  <div className="pt-3 border-t border-slate-800 flex justify-between items-center">
                    <span className="text-sm font-bold text-white uppercase">Total Shipping Fee:</span>
                    <span className="text-xl font-black font-mono text-emerald-400">
                      KES {quote?.total_fee ?? 500}
                    </span>
                  </div>
                </div>

                {/* Savings Callout */}
                {Boolean(quote?.savings_vs_door_to_door) && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-300 flex items-center gap-2">
                    <span>💡</span>
                    <span>
                      You are saving <strong>KES {quote?.savings_vs_door_to_door}</strong> by choosing station handling!
                    </span>
                  </div>
                )}

                {/* Delivery Mode Banner */}
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Selected Mode</span>
                  <span className="text-white font-bold">{quote?.delivery_mode_label}</span>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Route: {originCity} Station &rarr; {destinationCity} Station (~{quote?.estimated_transit_hours} hrs highway transit)
                  </p>
                </div>

                {/* Payment method selector */}
                <div className="pt-2">
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1.5">
                    Payment Channel
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('mpesa')}
                      className={`p-2.5 rounded-xl border text-center text-xs font-bold transition ${
                        paymentMethod === 'mpesa'
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      📱 M-Pesa STK
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('cash_at_station')}
                      className={`p-2.5 rounded-xl border text-center text-xs font-bold transition ${
                        paymentMethod === 'cash_at_station'
                          ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      💵 Pay at Station
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* TAB 2: LIVE WAYBILL TRACKER */}
        {/* ==================================================================== */}
        {activeTab === 'track' && (
          <div className="space-y-6 max-w-4xl mx-auto">
            {/* Search Box */}
            <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
              <h3 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                <span>🔍</span>
                <span>Track Any Cargo Package or Waybill</span>
              </h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleTrackCode(trackCode);
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={trackCode}
                  onChange={(e) => setTrackCode(e.target.value)}
                  placeholder="Enter Waybill Tracking Code (e.g. WB-MZG-XXXXX)"
                  className="flex-1 p-3 rounded-2xl bg-slate-950 border border-slate-800 font-mono text-sm uppercase text-white focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="submit"
                  disabled={trackLoading}
                  className="px-6 py-3 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs uppercase tracking-wider transition"
                >
                  {trackLoading ? 'Tracking...' : 'Track Now'}
                </button>
              </form>

              {trackError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-bold">
                  {trackError}
                </div>
              )}
            </div>

            {/* Tracking Result Card */}
            {trackResult && (
              <div className="p-6 sm:p-8 rounded-3xl bg-slate-900 border border-cyan-500/40 shadow-2xl space-y-6 animate-in fade-in duration-200">
                {/* Header summary */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-800">
                  <div>
                    <span className="text-[10px] text-cyan-400 uppercase font-black tracking-wider block">
                      WAYBILL TRACKING
                    </span>
                    <h2 className="text-xl sm:text-2xl font-black font-mono text-white mt-0.5">
                      {trackResult.tracking_code}
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      {trackResult.category?.replace('_', ' ').toUpperCase()} &bull; {trackResult.description}
                    </p>
                  </div>

                  <div className="text-right">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider inline-block ${
                        trackResult.status === 'delivered'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 animate-pulse'
                      }`}
                    >
                      {trackResult.status.replace('_', ' ')}
                    </span>
                    <div className="text-xs font-mono text-slate-400 mt-1">
                      Total Fee: KES {trackResult.fee}
                    </div>
                  </div>
                </div>

                {/* Delivery Mode & Routing Overview */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                    <span className="text-[10px] font-bold text-amber-400 uppercase block">
                      Origin &bull; {trackResult.pickup_type === 'doorstep' ? '🛵 Doorstep Pickup' : '🏢 Station Drop-Off'}
                    </span>
                    <div className="font-bold text-white">{trackResult.sender_name} ({trackResult.sender_phone})</div>
                    <div className="text-slate-400">
                      Location: {trackResult.sender_address || trackResult.pickup_stop_name || 'Origin Station'}
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                    <span className="text-[10px] font-bold text-purple-400 uppercase block">
                      Destination &bull; {trackResult.delivery_type === 'doorstep' ? '🏠 Doorstep Delivery' : '🏢 Station Collection'}
                    </span>
                    <div className="font-bold text-white">{trackResult.recipient_name} ({trackResult.recipient_phone})</div>
                    <div className="text-slate-400">
                      Destination: {trackResult.recipient_address || trackResult.dropoff_stop_name || 'Destination Station'}
                    </div>
                  </div>
                </div>

                {/* Multi-Stage Visual Step Timeline */}
                <div className="space-y-3 pt-2">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-300">
                    Journey Milestones
                  </h4>
                  <div className="space-y-2.5">
                    {trackResult.timeline?.map((step: any) => (
                      <div
                        key={step.step}
                        className={`p-3.5 rounded-2xl border transition flex items-center justify-between text-xs ${
                          step.done
                            ? 'bg-emerald-500/10 border-emerald-500/40 text-slate-100'
                            : step.current
                            ? 'bg-cyan-500/15 border-cyan-500 text-white animate-pulse'
                            : 'bg-slate-950/60 border-slate-800 text-slate-500'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs ${
                              step.done
                                ? 'bg-emerald-500 text-slate-950'
                                : step.current
                                ? 'bg-cyan-500 text-slate-950'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {step.done ? '✓' : step.step}
                          </span>
                          <div>
                            <div className="font-bold">{step.label}</div>
                            <div className="text-[11px] opacity-80">{step.desc}</div>
                          </div>
                        </div>

                        <span className="text-[10px] font-mono uppercase font-bold shrink-0">
                          {step.done ? 'COMPLETED' : step.current ? 'ACTIVE' : 'PENDING'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Handover PIN Verification Box */}
                {trackResult.status !== 'delivered' && (
                  <div className="p-4 rounded-2xl bg-slate-950 border border-amber-500/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">🔒</span>
                        <h4 className="text-xs font-black uppercase tracking-wider text-amber-300">
                          Recipient Collection / Handover Verification
                        </h4>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">PIN Required</span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      When releasing this package to the recipient (at the station counter or at their doorstep),
                      enter the 4-digit secret PIN sent to the recipient via SMS.
                    </p>

                    <form onSubmit={handleVerifyHandover} className="flex gap-2 pt-1">
                      <input
                        type="text"
                        maxLength={4}
                        value={handoverPin}
                        onChange={(e) => setHandoverPin(e.target.value)}
                        placeholder="Enter 4-Digit Secret PIN"
                        className="w-48 p-2.5 rounded-xl bg-slate-900 border border-slate-800 font-mono text-center tracking-widest text-sm font-bold text-white focus:outline-none focus:border-amber-500"
                      />
                      <button
                        type="submit"
                        disabled={handoverLoading || handoverPin.length !== 4}
                        className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black text-xs uppercase tracking-wider transition"
                      >
                        {handoverLoading ? 'Verifying...' : 'Verify & Complete Handover'}
                      </button>
                    </form>

                    {handoverNotice && (
                      <div className="text-xs font-bold text-amber-400 mt-1">{handoverNotice}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Booking Success Modal */}
      {bookedSuccess && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-slate-900 border border-emerald-500/40 rounded-3xl p-6 shadow-2xl space-y-5">
            <div className="text-center space-y-2">
              <span className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 text-3xl flex items-center justify-center mx-auto">
                ✓
              </span>
              <h3 className="text-xl font-black text-white uppercase tracking-wider">
                Waybill Booked Successfully!
              </h3>
              <p className="text-xs text-slate-400">
                SMS notifications with tracking link and collection PIN have been dispatched.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3 font-mono text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Tracking Code:</span>
                <span className="font-bold text-cyan-400">{bookedSuccess.tracking_code}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Secret Handover PIN:</span>
                <span className="font-bold text-amber-400 text-base">{bookedSuccess.security_pin}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Delivery Mode:</span>
                <span className="font-bold text-white uppercase">
                  {bookedSuccess.pickup_type} &rarr; {bookedSuccess.delivery_type}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-800 pt-2 font-bold">
                <span className="text-slate-300">Total Fee:</span>
                <span className="text-emerald-400">KES {bookedSuccess.fee}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  const code = bookedSuccess.tracking_code;
                  setBookedSuccess(null);
                  setTrackCode(code);
                  setActiveTab('track');
                  handleTrackCode(code);
                }}
                className="flex-1 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs uppercase tracking-wider transition text-center"
              >
                Track This Waybill Live &rarr;
              </button>
              <button
                type="button"
                onClick={() => setBookedSuccess(null)}
                className="px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

