'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  fetchSettlementSummary,
  withdrawSaccoFunds,
  fetchVehicleRevenueSplits,
  disburseVehicleOwnerDividend,
  batchDisburseAllOwners,
  SaccoSettlementSummary,
  VehicleRevenueSplitsResponse,
  VehicleRevenueSplitItem,
  fetchSaccos,
  Sacco,
  errMsg,
} from '@/services/api';

export default function SaccoSettlementManager() {
  const [activeTab, setActiveTab] = useState<'treasury' | 'vehicle_splits'>('vehicle_splits');
  const [summary, setSummary] = useState<SaccoSettlementSummary | null>(null);
  const [splitsData, setSplitsData] = useState<VehicleRevenueSplitsResponse | null>(null);
  const [saccos, setSaccos] = useState<Sacco[]>([]);
  const [selectedSaccoId, setSelectedSaccoId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successNotice, setSuccessNotice] = useState('');

  // Sacco Treasury Cashout Modal State
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

  // Individual Owner Disburse Modal State
  const [showOwnerModal, setShowOwnerModal] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleRevenueSplitItem | null>(null);
  const [ownerCustomAmount, setOwnerCustomAmount] = useState<number>(0);
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerSubmitting, setOwnerSubmitting] = useState(false);

  // Batch Payout State
  const [batchSubmitting, setBatchSubmitting] = useState(false);

  const loadData = useCallback(async (saccoId?: number) => {
    try {
      setLoading(true);
      setError('');
      const [sumRes, splitsRes, saccoRes] = await Promise.all([
        fetchSettlementSummary(saccoId),
        fetchVehicleRevenueSplits(saccoId),
        fetchSaccos(),
      ]);
      setSummary(sumRes);
      setSplitsData(splitsRes);
      setSaccos(saccoRes.saccos || []);
      if (!selectedSaccoId && sumRes.sacco_id) {
        setSelectedSaccoId(sumRes.sacco_id);
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [selectedSaccoId]);

  useEffect(() => {
    loadData(selectedSaccoId || undefined);
  }, [selectedSaccoId, loadData]);

  // Handle Treasury Withdrawal
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

  // Handle Individual Vehicle Owner Dividend Disbursal
  const handleDisburseOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicle) return;
    const payoutAmt = ownerCustomAmount > 0 ? ownerCustomAmount : selectedVehicle.available_for_owner;
    if (payoutAmt <= 0) {
      setError(`Available balance for ${selectedVehicle.plate_number} is KES 0.`);
      return;
    }

    try {
      setOwnerSubmitting(true);
      setError('');
      const res = await disburseVehicleOwnerDividend({
        vehicle_id: selectedVehicle.vehicle_id,
        amount: payoutAmt,
        recipient_phone: ownerPhone || selectedVehicle.owner_phone,
        recipient_name: ownerName || selectedVehicle.owner_name,
        notes: `Owner Dividend for ${selectedVehicle.plate_number}`,
      });

      setSuccessNotice(`✓ ${res.message} (M-Pesa Ref: ${res.b2c_transaction_id})`);
      setShowOwnerModal(false);
      setSelectedVehicle(null);
      loadData(selectedSaccoId || undefined);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setOwnerSubmitting(false);
    }
  };

  // Handle 1-Click Batch Disbursal across all eligible vehicle owners
  const handleBatchDisburse = async () => {
    if (!splitsData || splitsData.vehicles.length === 0) return;
    const eligibleCount = splitsData.vehicles.filter((v) => v.available_for_owner >= 100).length;
    if (eligibleCount === 0) {
      setError('No vehicle owners with pending balances >= KES 100 to disburse.');
      return;
    }

    const confirmed = window.confirm(
      `Trigger Daraja B2C batch payouts to ${eligibleCount} vehicle owners for a total of KES ${splitsData.totals.available_payout.toLocaleString()}?`
    );
    if (!confirmed) return;

    try {
      setBatchSubmitting(true);
      setError('');
      const res = await batchDisburseAllOwners({
        sacco_id: selectedSaccoId || undefined,
        min_amount: 100,
        notes: 'End of Day Vehicle Owner Dividends',
      });

      setSuccessNotice(`✓ ${res.message}`);
      loadData(selectedSaccoId || undefined);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBatchSubmitting(false);
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
              SACCO Treasury & Automated M-Pesa B2C Payouts
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time vehicle owner dividend splits, stage expense reconciliation, and instant Safaricom B2C disbursements.
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

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('vehicle_splits')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
            activeTab === 'vehicle_splits'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-lg shadow-cyan-500/10'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <span>🚐</span>
          <span>Vehicle Owner Dividends & Splits</span>
          {splitsData && (
            <span className="px-2 py-0.5 rounded-full bg-cyan-500/30 text-[10px] font-mono">
              {splitsData.total_vehicles}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('treasury')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
            activeTab === 'treasury'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-lg shadow-emerald-500/10'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <span>🏦</span>
          <span>SACCO Treasury Pool</span>
        </button>
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

      {/* VIEW A: VEHICLE OWNER REVENUE SPLITS & B2C PAYOUTS */}
      {activeTab === 'vehicle_splits' && (
        <div className="space-y-5">
          {/* Metrics Overview Cards */}
          {splitsData && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg">
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Fleet Gross Fares</div>
                <div className="text-2xl font-black text-white mt-1">
                  KES {splitsData.totals.gross_revenue.toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">From all passenger trips</div>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg">
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Stage Deductions</div>
                <div className="text-2xl font-black text-rose-400 mt-1">
                  - KES {(splitsData.totals.fuel_deductions + splitsData.totals.conductor_commissions).toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">Fuel & Conductor commissions</div>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg">
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">SACCO Levy (5%) & Platform (3%)</div>
                <div className="text-2xl font-black text-cyan-400 mt-1">
                  KES {(splitsData.totals.sacco_levies + splitsData.totals.platform_fees).toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">Operational & tech levies</div>
              </div>

              <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-950/80 to-slate-900 border border-emerald-500/50 shadow-lg shadow-emerald-950/40 relative overflow-hidden">
                <div className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider flex items-center justify-between">
                  <span>Pending Owner Payouts</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                </div>
                <div className="text-2xl font-black text-emerald-300 mt-1">
                  KES {splitsData.totals.available_payout.toLocaleString()}
                </div>
                <button
                  onClick={handleBatchDisburse}
                  disabled={batchSubmitting || splitsData.totals.available_payout <= 0}
                  className="mt-3 w-full py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:brightness-110 text-slate-950 font-black text-xs transition-all shadow-md shadow-emerald-500/20 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {batchSubmitting ? 'Processing B2C...' : '⚡ 1-Click Disburse All Owners'}
                </button>
              </div>
            </div>
          )}

          {/* Vehicle Splits Table */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>🚐</span> Vehicle Owner Dividend Ledger (Kenya SACCO Model)
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Gross trips minus fuel, conductor wage, SACCO 5% levy, and platform 3% fee = Net Owner Dividend.
                </p>
              </div>
              <button
                onClick={() => loadData(selectedSaccoId || undefined)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold"
              >
                🔄 Refresh Splits
              </button>
            </div>

            {splitsData?.vehicles.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No vehicles registered under this SACCO yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 uppercase font-mono text-[10px]">
                    <tr>
                      <th className="py-3 px-4">Vehicle Plate</th>
                      <th className="py-3 px-4">Owner Contact</th>
                      <th className="py-3 px-4">Trips</th>
                      <th className="py-3 px-4">Gross Fares</th>
                      <th className="py-3 px-4">Fuel & Conductor</th>
                      <th className="py-3 px-4">Levies (5%+3%)</th>
                      <th className="py-3 px-4">Net Earned</th>
                      <th className="py-3 px-4">Available Payout</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-200">
                    {splitsData?.vehicles.map((v) => (
                      <tr key={v.vehicle_id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-black text-white font-mono">{v.plate_number}</div>
                          <div className="text-[10px] text-cyan-300 flex items-center gap-1">
                            <span>{v.vehicle_model}</span>
                            <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 uppercase text-[9px]">
                              {v.purpose}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-100">{v.owner_name}</div>
                          <div className="text-[11px] font-mono text-cyan-400">{v.owner_phone}</div>
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-slate-300">
                          {v.trips_count}
                        </td>
                        <td className="py-3 px-4 font-semibold text-white">
                          KES {v.gross_revenue.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-rose-400">
                          - KES {(v.fuel_deduction + v.conductor_commission).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-slate-400">
                          KES {(v.sacco_levy + v.platform_fee).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-semibold text-cyan-300">
                          KES {v.net_earned.toLocaleString()}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2.5 py-1 rounded-lg font-black text-xs ${
                              v.available_for_owner > 0
                                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
                                : 'bg-slate-800/80 text-slate-500'
                            }`}
                          >
                            KES {v.available_for_owner.toLocaleString()}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => {
                              setSelectedVehicle(v);
                              setOwnerCustomAmount(v.available_for_owner);
                              setOwnerPhone(v.owner_phone);
                              setOwnerName(v.owner_name);
                              setShowOwnerModal(true);
                            }}
                            disabled={v.available_for_owner <= 0}
                            className="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold transition disabled:opacity-30 disabled:hover:bg-emerald-500/20"
                          >
                            Disburse M-Pesa &rarr;
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW B: SACCO TREASURY POOL (EXISTING VIEW) */}
      {activeTab === 'treasury' && (
        <div className="space-y-5">
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
                No B2C cashout disbursements recorded yet.
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
                      <th className="py-3 px-4">Fee (3%)</th>
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
        </div>
      )}

      {/* INDIVIDUAL VEHICLE OWNER DISBURSE MODAL */}
      {showOwnerModal && selectedVehicle && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl relative animate-in fade-in zoom-in-95">
            <button
              onClick={() => setShowOwnerModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-md bg-slate-800 text-xs"
            >
              ✕
            </button>

            <form onSubmit={handleDisburseOwner} className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-sm font-black font-mono">
                  M
                </div>
                <div>
                  <h3 className="text-base font-black text-white">
                    Disburse Vehicle Dividend
                  </h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    Plate: {selectedVehicle.plate_number} ({selectedVehicle.vehicle_model})
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
                <div className="flex justify-between text-slate-400">
                  <span>Gross Trips Revenue:</span>
                  <span className="font-semibold text-white">KES {selectedVehicle.gross_revenue.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-rose-400">
                  <span>Fuel & Conductor Wage:</span>
                  <span>- KES {(selectedVehicle.fuel_deduction + selectedVehicle.conductor_commission).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>SACCO 5% Levy + 3% Platform:</span>
                  <span>- KES {(selectedVehicle.sacco_levy + selectedVehicle.platform_fee).toLocaleString()}</span>
                </div>
                <div className="pt-2 border-t border-slate-800 flex justify-between font-bold text-emerald-300">
                  <span>Available Net Dividend:</span>
                  <span className="text-sm font-mono font-black">KES {selectedVehicle.available_for_owner.toLocaleString()}</span>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block mb-1">
                  Payout Amount (KES)
                </label>
                <input
                  type="number"
                  min="1"
                  max={selectedVehicle.available_for_owner}
                  value={ownerCustomAmount}
                  onChange={(e) => setOwnerCustomAmount(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block mb-1">
                  Owner M-Pesa Phone Number
                </label>
                <input
                  type="text"
                  value={ownerPhone}
                  onChange={(e) => setOwnerPhone(e.target.value)}
                  placeholder="2547XXXXXXXX"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block mb-1">
                  Registered Owner Name
                </label>
                <input
                  type="text"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={ownerSubmitting}
                className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-wider transition-all disabled:opacity-50"
              >
                {ownerSubmitting ? 'Transmitting Daraja B2C...' : `Confirm & Send KES ${ownerCustomAmount.toLocaleString()}`}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* SACCO TREASURY WITHDRAW MODAL */}
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

                <div>
                  <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block mb-1">
                    Withdrawal Amount (Gross KES)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={summary.available_balance}
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
                    required
                  />
                  <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                    <span>Platform Fee (3%):</span>
                    <span className="text-rose-400 font-mono">
                      - KES {(withdrawAmount * 0.03).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-emerald-400 font-bold mt-0.5">
                    <span>Net M-Pesa Disbursed:</span>
                    <span className="font-mono text-sm">
                      KES {(withdrawAmount * 0.97).toFixed(2)}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block mb-1">
                    Treasurer Phone Number (M-Pesa)
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+254712345678"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block mb-1">
                    Recipient Name / Role
                  </label>
                  <input
                    type="text"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="e.g. John Doe (SACCO Treasurer)"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block mb-1">
                    Settlement Notes / Remarks
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Corridor Daily Fares Payout"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:brightness-110 text-slate-950 font-black text-xs uppercase tracking-wider transition-all disabled:opacity-50"
                >
                  {submitting ? 'Initiating Daraja B2C...' : `Confirm & Cash Out KES ${(withdrawAmount * 0.97).toLocaleString()}`}
                </button>
              </form>
            ) : (
              <div className="space-y-4 text-center py-2">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center text-xl font-bold">
                  ✓
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Disbursement Dispatched!</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    KES {payoutResult.net_payout.toLocaleString()} sent to {phone} via Daraja B2C.
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-left font-mono text-[11px] space-y-1">
                  <div className="text-slate-400">
                    Safaricom Ref: <span className="text-emerald-400 font-bold">{payoutResult.b2c_transaction_id}</span>
                  </div>
                  <div className="text-slate-400">
                    Conversation ID: <span className="text-slate-200">{payoutResult.b2c_conversation_id}</span>
                  </div>
                  <div className="text-slate-400">
                    Status: <span className="text-cyan-400 font-bold">COMPLETED (M-PESA)</span>
                  </div>
                </div>
                <button
                  onClick={() => setShowWithdrawModal(false)}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
