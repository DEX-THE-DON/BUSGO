'use client';

import React, { useEffect, useState } from 'react';
import {
  fetchSettlementSummary,
  withdrawSaccoFunds,
  SaccoSettlementSummary,
  fetchSaccos,
  Sacco,
  errMsg,
} from '@/services/api';

export default function SaccoSettlementManager() {
  const [summary, setSummary] = useState<SaccoSettlementSummary | null>(null);
  const [saccos, setSaccos] = useState<Sacco[]>([]);
  const [selectedSaccoId, setSelectedSaccoId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successNotice, setSuccessNotice] = useState('');

  // Cashout Modal State
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState<number>(0);
  const [phone, setPhone] = useState('+254712345678');
  const [recipientName, setRecipientName] = useState('SACCO Treasurer');
  const [notes, setNotes] = useState('Daily Corridor Settlement');
  const [submitting, setSubmitting] = useState(false);
  const [payoutResult, setPayoutResult] = useState<{
    b2c_transaction_id: string;
    b2c_conversation_id: string;
    net_payout: number;
  } | null>(null);

  const loadData = async (saccoId?: number) => {
    try {
      setLoading(true);
      setError('');
      const [sumRes, saccoRes] = await Promise.all([
        fetchSettlementSummary(saccoId),
        fetchSaccos(),
      ]);
      setSummary(sumRes);
      setSaccos(saccoRes.saccos || []);
      if (!selectedSaccoId && sumRes.sacco_id) {
        setSelectedSaccoId(sumRes.sacco_id);
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(selectedSaccoId || undefined);
  }, [selectedSaccoId]);

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary || withdrawAmount <= 0) return;
    if (withdrawAmount > summary.available_balance) {
      setError(`Cannot withdraw KES ${withdrawAmount}. Maximum available balance is KES ${summary.available_balance}`);
      return;
    }

    try {
      setSubmitting(true);
      setError('');
      const res = await withdrawSaccoFunds({
        sacco_id: summary.sacco_id,
        amount: withdrawAmount,
        recipient_phone: phone,
        recipient_name: recipientName,
        notes: notes || undefined,
      });

      setPayoutResult({
        b2c_transaction_id: res.b2c_transaction_id,
        b2c_conversation_id: res.b2c_conversation_id,
        net_payout: res.net_payout,
      });
      setSuccessNotice(`Disbursed KES ${res.net_payout.toLocaleString()} via Daraja B2C to ${phone}.`);
      loadData(summary.sacco_id);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & SACCO Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950 border border-slate-800 shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">💰</span>
            <h2 className="text-lg font-black text-white tracking-wide uppercase">
              SACCO Treasury & Daraja B2C Payouts
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Automated 3% platform commission deduction, daily revenue split, and instant Safaricom B2C M-Pesa disbursements.
          </p>
        </div>

        {/* SACCO Switcher */}
        {saccos.length > 1 && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 font-semibold">Tenant:</label>
            <select
              value={selectedSaccoId || ''}
              onChange={(e) => setSelectedSaccoId(Number(e.target.value))}
              className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-cyan-300 font-bold focus:outline-none focus:border-cyan-500"
            >
              {saccos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs flex items-center justify-between">
          <span>⚠️ {error}</span>
          <button onClick={() => setError('')} className="text-rose-400 font-bold">✕</button>
        </div>
      )}

      {successNotice && (
        <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 text-xs flex items-center justify-between">
          <span>✓ {successNotice}</span>
          <button onClick={() => setSuccessNotice('')} className="text-emerald-400 font-bold">✕</button>
        </div>
      )}

      {/* Financial Metrics Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Gross Fares Collected</div>
            <div className="text-2xl font-black text-white mt-1">KES {summary.gross_revenue.toLocaleString()}</div>
            <div className="text-[11px] text-slate-500 mt-1">100% Passenger ticket bookings</div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">BUSGO Platform Fee (3%)</div>
            <div className="text-2xl font-black text-cyan-400 mt-1">KES {summary.platform_fee_total.toLocaleString()}</div>
            <div className="text-[11px] text-slate-500 mt-1">Technology & corridor infra fee</div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Disbursed to Date</div>
            <div className="text-2xl font-black text-slate-300 mt-1">KES {summary.total_disbursed.toLocaleString()}</div>
            <div className="text-[11px] text-slate-500 mt-1">Transferred via Daraja B2C</div>
          </div>

          <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-950/80 to-slate-900 border border-emerald-500/50 shadow-lg shadow-emerald-950/40 relative overflow-hidden">
            <div className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider flex items-center justify-between">
              <span>Available for Cashout</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            </div>
            <div className="text-2xl font-black text-emerald-300 mt-1">KES {summary.available_net.toLocaleString()}</div>
            <button
              onClick={() => {
                setWithdrawAmount(summary.available_balance);
                setPayoutResult(null);
                setShowWithdrawModal(true);
              }}
              disabled={summary.available_balance <= 0}
              className="mt-3 w-full py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:brightness-110 text-slate-950 font-black text-xs transition-all shadow-md shadow-emerald-500/20 disabled:opacity-50"
            >
              Withdraw to M-Pesa &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Disbursal Audit Ledger */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span>📜</span> Daraja B2C Disbursement Audit Ledger
          </h3>
          <span className="text-xs text-slate-400 font-mono">
            {summary?.recent_settlements.length || 0} Records
          </span>
        </div>

        {summary?.recent_settlements.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            No B2C cashout disbursements recorded yet. Click &quot;Withdraw to M-Pesa&quot; above to initiate a payout.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 uppercase font-mono text-[10px]">
                <tr>
                  <th className="py-3 px-4">Date / Time</th>
                  <th className="py-3 px-4">Recipient</th>
                  <th className="py-3 px-4">Phone</th>
                  <th className="py-3 px-4">Gross Claim</th>
                  <th className="py-3 px-4">Platform Fee (3%)</th>
                  <th className="py-3 px-4">Net Disbursed</th>
                  <th className="py-3 px-4">Safaricom Ref</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-200">
                {summary?.recent_settlements.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                      {item.created_at ? new Date(item.created_at).toLocaleString('en-KE') : 'Just now'}
                    </td>
                    <td className="py-3 px-4 font-bold text-white">{item.recipient_name}</td>
                    <td className="py-3 px-4 font-mono text-cyan-300">{item.recipient_phone}</td>
                    <td className="py-3 px-4 font-semibold">KES {item.gross_amount.toLocaleString()}</td>
                    <td className="py-3 px-4 text-rose-400 font-semibold">- KES {item.platform_fee.toLocaleString()}</td>
                    <td className="py-3 px-4 text-emerald-400 font-black">KES {item.net_payout.toLocaleString()}</td>
                    <td className="py-3 px-4 font-mono text-[10px] text-slate-400">
                      {item.b2c_transaction_id || 'PENDING'}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800/50 uppercase">
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Instant Withdraw Modal */}
      {showWithdrawModal && summary && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl relative animate-in fade-in zoom-in-95">
            <button
              onClick={() => setShowWithdrawModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-md bg-slate-800 text-xs"
            >
              ✕
            </button>

            {!payoutResult ? (
              <form onSubmit={handleWithdraw} className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-sm font-black">
                    M
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white">Instant M-Pesa B2C Cashout</h3>
                    <p className="text-[11px] text-slate-400">Funds transferred directly via Safaricom Daraja API</p>
                  </div>
                </div>

                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Available Gross Balance:</span>
                    <span className="font-bold text-white">KES {summary.available_balance.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>BUSGO Platform Fee (3%):</span>
                    <span className="text-cyan-400 font-bold">- KES {(withdrawAmount * 0.03).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-300 pt-1 border-t border-slate-800 font-bold">
                    <span>Net M-Pesa Received:</span>
                    <span>KES {(withdrawAmount * 0.97).toFixed(2)}</span>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Withdrawal Amount (KES)
                  </label>
                  <input
                    type="number"
                    max={summary.available_balance}
                    min={10}
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white font-black focus:outline-none focus:border-emerald-500"
                  />
                  <div className="flex gap-2 mt-2">
                    {[0.25, 0.5, 1.0].map((frac) => (
                      <button
                        key={frac}
                        type="button"
                        onClick={() => setWithdrawAmount(Math.round(summary.available_balance * frac))}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold"
                      >
                        {frac * 100}% (KES {Math.round(summary.available_balance * frac).toLocaleString()})
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Safaricom M-Pesa Phone Number
                  </label>
                  <input
                    type="text"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+2547XXXXXXXX"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-xs text-cyan-300 font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Recipient Name / Official Title
                  </label>
                  <input
                    type="text"
                    required
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Disbursement Notes / Audit Purpose
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="pt-2 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowWithdrawModal(false)}
                    className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || withdrawAmount <= 0}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-black text-xs hover:brightness-110 shadow-lg shadow-emerald-500/30 disabled:opacity-50"
                  >
                    {submitting ? 'Disbursing...' : 'Confirm Cashout &rarr;'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="text-center py-4 space-y-4">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center text-2xl animate-bounce">
                  ✓
                </div>
                <div>
                  <h3 className="text-base font-black text-white">M-Pesa B2C Transfer Complete!</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    KES {payoutResult.net_payout.toLocaleString()} was successfully disbursed to {phone}.
                  </p>
                </div>

                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-left text-xs font-mono space-y-1">
                  <div className="text-slate-500 text-[10px]">M-PESA RECEIPT</div>
                  <div className="text-white font-bold">{payoutResult.b2c_transaction_id}</div>
                  <div className="text-slate-500 text-[10px] mt-1">CONVERSATION ID</div>
                  <div className="text-cyan-400 text-[11px]">{payoutResult.b2c_conversation_id}</div>
                </div>

                <button
                  onClick={() => setShowWithdrawModal(false)}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs"
                >
                  Close Receipt
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

