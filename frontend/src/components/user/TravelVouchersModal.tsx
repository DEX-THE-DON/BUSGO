'use client';

import React, { useState, useEffect } from 'react';
import {
  TravelVoucher,
  fetchMyVouchers,
  errMsg,
} from '@/services/api';

interface TravelVouchersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TravelVouchersModal({
  isOpen,
  onClose,
}: TravelVouchersModalProps) {
  const [vouchers, setVouchers] = useState<TravelVoucher[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const loadVouchers = () => {
    setLoading(true);
    setError('');
    fetchMyVouchers()
      .then((res) => {
        setVouchers(res.vouchers || []);
      })
      .catch((err) => setError(errMsg(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (isOpen) {
      loadVouchers();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2500);
  };

  const activeVouchers = vouchers.filter((v) => v.status === 'active' && v.remaining_balance > 0);
  const pastVouchers = vouchers.filter((v) => !activeVouchers.includes(v));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-[#0f1422] p-6 shadow-2xl overflow-y-auto max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
          <div>
            <span className="text-[10px] font-bold tracking-widest uppercase px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              Travel Wallet & Credits
            </span>
            <h2 className="text-xl font-bold text-white mt-1">My Travel Vouchers</h2>
            <p className="text-xs text-slate-400">
              Vouchers issued from advance trip cancellations or rescheduling differences.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400 animate-pulse">
            Loading your travel credit vouchers…
          </div>
        ) : (
          <div className="space-y-4">
            {/* Active Vouchers */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                Active Vouchers ({activeVouchers.length})
              </h3>
              {activeVouchers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-500">
                  No active travel credit vouchers. If you cancel an upcoming trip, 100% of your ticket fare will appear here automatically.
                </div>
              ) : (
                <div className="space-y-3">
                  {activeVouchers.map((v) => {
                    const isCopied = copiedCode === v.code;
                    const expStr = v.expires_at
                      ? new Date(v.expires_at).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : '90 days';

                    return (
                      <div
                        key={v.id}
                        className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 flex flex-wrap items-center justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-base text-emerald-300 tracking-wider">
                              {v.code}
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                              Active
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            Expires on <span className="text-slate-300">{expStr}</span> · Valid on all routes
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-[10px] text-slate-400 uppercase font-semibold">Available Credit</p>
                            <p className="font-mono font-bold text-lg text-white">
                              KES {v.remaining_balance.toLocaleString()}
                            </p>
                          </div>
                          <button
                            onClick={() => copyCode(v.code)}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold transition border border-emerald-500/40 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
                          >
                            {isCopied ? 'Copied ✓' : 'Copy Code'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Past/Redeemed Vouchers */}
            {pastVouchers.length > 0 && (
              <div className="pt-3 border-t border-slate-800/80">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Redeemed & Expired ({pastVouchers.length})
                </h3>
                <div className="space-y-2">
                  {pastVouchers.map((v) => (
                    <div
                      key={v.id}
                      className="rounded-xl border border-slate-800 bg-[#121624] p-3 flex items-center justify-between text-xs opacity-60"
                    >
                      <div>
                        <span className="font-mono font-semibold text-slate-400">{v.code}</span>
                        <span className="ml-2 text-[10px] uppercase font-bold text-slate-500">
                          {v.status}
                        </span>
                      </div>
                      <span className="font-mono text-slate-400">
                        KES {v.initial_amount.toLocaleString()} initial
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

