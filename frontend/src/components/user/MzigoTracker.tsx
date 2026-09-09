'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { trackParcelPublic, Parcel, errMsg } from '@/services/api';
import { IconTrip, IconRoute, IconZap } from '@/components/dashboard/FluxIcons';

interface MzigoTrackerProps {
  initialCode?: string;
}

export default function MzigoTracker({ initialCode = '' }: MzigoTrackerProps) {
  const [trackingCode, setTrackingCode] = useState(initialCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any | null>(null);

  const handleTrack = useCallback(async (codeToTrack: string) => {
    const code = codeToTrack.trim().toUpperCase();
    if (!code) return;
    setLoading(true);
    setError('');
    try {
      const res = await trackParcelPublic(code);
      setResult(res.parcel);
    } catch (err) {
      setError(errMsg(err) || `No cargo package found with tracking code '${code}'.`);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialCode) {
      handleTrack(initialCode);
    } else if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlCode = params.get('code');
      if (urlCode) {
        setTrackingCode(urlCode);
        handleTrack(urlCode);
      }
    }
  }, [initialCode, handleTrack]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'registered':
        return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
      case 'loaded':
        return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
      case 'in_transit':
        return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30 animate-pulse';
      case 'arrived':
        return 'bg-purple-500/15 text-purple-300 border-purple-500/30';
      case 'delivered':
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
      case 'returned':
        return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  const getStatusStep = (status: string) => {
    switch (status) {
      case 'registered': return 1;
      case 'loaded': return 2;
      case 'in_transit': return 3;
      case 'arrived': return 4;
      case 'delivered': return 5;
      default: return 1;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Search Bar */}
      <div className="rounded-2xl border border-slate-800/80 bg-[#121624] p-6 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-2.5">
              <span className="text-2xl">📦</span>
              <span>BUSGO Mzigo — Live Cargo & Parcel Tracker</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Track unaccompanied packages and cargo moving across the Kenyan highway network in real-time.
            </p>
          </div>
          <span className="text-[10px] font-bold px-3 py-1 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-mono">
            KENYA TRANSIT CARGO
          </span>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleTrack(trackingCode);
          }}
          className="flex flex-col sm:flex-row gap-3"
        >
          <div className="relative flex-1">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-xs text-slate-500 font-bold">
              REF:
            </span>
            <input
              type="text"
              placeholder="e.g. MZG-DLL76"
              value={trackingCode}
              onChange={(e) => setTrackingCode(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-14 pr-4 py-3 text-sm font-mono font-bold text-white placeholder-slate-600 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 tracking-wider uppercase"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !trackingCode.trim()}
            className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl shadow-lg transition disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="animate-spin">🌀</span>
            ) : (
              <IconRoute className="w-4 h-4" />
            )}
            <span>Track Package</span>
          </button>
        </form>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-center text-xs font-bold text-rose-300">
            {error}
          </div>
        )}
      </div>

      {/* Tracking Result Card */}
      {result && (
        <div className="rounded-3xl border border-cyan-500/30 bg-[#0e1424] p-6 sm:p-7 shadow-2xl space-y-6 animate-in fade-in duration-200">
          {/* Top Status Banner */}
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-black text-lg text-cyan-400">{result.tracking_code}</span>
                <span className={`text-xs font-black uppercase px-3 py-0.5 rounded-full border ${getStatusColor(result.status)}`}>
                  {result.status.replace('_', ' ')}
                </span>
              </div>
              <h3 className="text-base font-bold text-white mt-1">{result.description}</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Category: <strong className="text-slate-200 capitalize">{result.category?.replace('_', ' ')}</strong> · Service Trip: <strong className="text-slate-200">{result.trip_name}</strong>
              </p>
            </div>

            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Transit Carrier</span>
              <p className="font-mono font-bold text-white text-sm mt-0.5">
                {result.vehicle_plate || 'Assigned PSV'}
              </p>
              <span className="text-[10px] text-emerald-400 block mt-0.5">
                Fee: KES {result.fee?.toLocaleString()} ({result.payment_status?.toUpperCase()})
              </span>
            </div>
          </div>

          {/* Stepper Progress Bar */}
          <div>
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 mb-2">
              <span className={getStatusStep(result.status) >= 1 ? 'text-emerald-400' : ''}>1. Registered</span>
              <span className={getStatusStep(result.status) >= 2 ? 'text-emerald-400' : ''}>2. Loaded</span>
              <span className={getStatusStep(result.status) >= 3 ? 'text-cyan-300' : ''}>3. In Transit</span>
              <span className={getStatusStep(result.status) >= 4 ? 'text-purple-400' : ''}>4. Arrived</span>
              <span className={getStatusStep(result.status) >= 5 ? 'text-emerald-400' : ''}>5. Delivered</span>
            </div>
            <div className="w-full bg-slate-950 rounded-full h-2.5 p-0.5 border border-slate-800">
              <div
                className="bg-gradient-to-r from-cyan-400 to-emerald-400 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${(getStatusStep(result.status) / 5) * 100}%` }}
              />
            </div>
          </div>

          {/* Hop Route Journey */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-950 p-4 rounded-2xl border border-slate-800/80">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Origin Pick-up Station</span>
              <p className="font-bold text-emerald-400 text-sm mt-0.5">{result.pickup_stop_name}</p>
              <p className="text-xs text-slate-400 mt-0.5">Sender: {result.sender_name}</p>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Destination Delivery Station</span>
              <p className="font-bold text-purple-400 text-sm mt-0.5">{result.dropoff_stop_name}</p>
              <p className="text-xs text-slate-400 mt-0.5">Recipient: {result.recipient_name}</p>
            </div>
          </div>

          {/* Collection Instructions Notice */}
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
            <span className="text-xl mt-0.5">🔒</span>
            <div className="text-xs space-y-1">
              <h5 className="font-black text-amber-300 uppercase tracking-wide">Security Collection Notice</h5>
              <p className="text-slate-300 leading-relaxed">
                For safe handover, the recipient must present their <strong>4-digit Security Claim PIN</strong> (sent via SMS/WhatsApp) along with their National ID upon collecting this package at <strong>{result.dropoff_stop_name}</strong>.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

