'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  fetchFleetCompliance,
  fetchSaccos,
  toggleVehicleGrounding,
  updateVehicleCompliance,
  runComplianceSweeper,
  VehicleCompliance,
  Sacco,
  ComplianceSweeperResult,
  errMsg,
} from '@/services/api';

export default function FleetComplianceTable() {
  const [complianceList, setComplianceList] = useState<VehicleCompliance[]>([]);
  const [saccos, setSaccos] = useState<Sacco[]>([]);
  const [selectedSacco, setSelectedSacco] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Grounding modal state
  const [groundingVehicle, setGroundingVehicle] = useState<VehicleCompliance | null>(null);
  const [groundingReason, setGroundingReason] = useState('Speed governor calibration expired');
  const [submittingAction, setSubmittingAction] = useState(false);

  // Edit / Renew Compliance modal state
  const [editingCompliance, setEditingCompliance] = useState<VehicleCompliance | null>(null);
  const [govVendor, setGovVendor] = useState('');
  const [govCert, setGovCert] = useState('');
  const [govExpiry, setGovExpiry] = useState('');
  const [ntsaCert, setNtsaCert] = useState('');
  const [ntsaExpiry, setNtsaExpiry] = useState('');
  const [insVendor, setInsVendor] = useState('');
  const [insPolicy, setInsPolicy] = useState('');
  const [insExpiry, setInsExpiry] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const [compRes, saccoRes] = await Promise.all([
        fetchFleetCompliance(),
        fetchSaccos(),
      ]);
      setComplianceList(compRes.compliance || []);
      setSaccos(saccoRes.saccos || []);
    } catch (err: unknown) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  const [runningSweeper, setRunningSweeper] = useState(false);
  const [sweeperResult, setSweeperResult] = useState<ComplianceSweeperResult | null>(null);

  const handleRunSweeper = async () => {
    try {
      setRunningSweeper(true);
      setError('');
      const res = await runComplianceSweeper();
      setSweeperResult(res.results);
      setSuccess(res.message);
      loadData();
    } catch (err: unknown) {
      setError(errMsg(err));
    } finally {
      setRunningSweeper(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredList = useMemo(() => {
    if (selectedSacco === 'all') return complianceList;
    return complianceList.filter(
      (c) => c.sacco_name?.toLowerCase() === selectedSacco.toLowerCase()
    );
  }, [complianceList, selectedSacco]);

  const stats = useMemo(() => {
    const total = complianceList.length;
    const grounded = complianceList.filter((c) => c.is_grounded).length;
    const compliant = complianceList.filter((c) => !c.is_grounded && c.status === 'compliant').length;
    const warnings = complianceList.filter((c) => !c.is_grounded && c.status !== 'compliant').length;
    return { total, grounded, compliant, warnings };
  }, [complianceList]);

  const handleToggleGround = async (v: VehicleCompliance) => {
    if (v.is_grounded) {
      if (!window.confirm(`Clear and restore vehicle ${v.plate_number} to active service?`)) return;
      try {
        setSubmittingAction(true);
        await toggleVehicleGrounding(v.vehicle_id, false);
        setSuccess(`Vehicle ${v.plate_number} cleared for active Kenyan transit routes.`);
        loadData();
        setTimeout(() => setSuccess(''), 4000);
      } catch (err: unknown) {
        setError(errMsg(err));
      } finally {
        setSubmittingAction(false);
      }
    } else {
      setGroundingVehicle(v);
      setGroundingReason('Speed governor calibration expired');
    }
  };

  const confirmGroundVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groundingVehicle) return;
    try {
      setSubmittingAction(true);
      await toggleVehicleGrounding(groundingVehicle.vehicle_id, true, groundingReason);
      setSuccess(`Vehicle ${groundingVehicle.plate_number} GROUNDED. Trips and bookings are blocked.`);
      setGroundingVehicle(null);
      loadData();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: unknown) {
      setError(errMsg(err));
    } finally {
      setSubmittingAction(false);
    }
  };

  const openRenewModal = (c: VehicleCompliance) => {
    setEditingCompliance(c);
    setGovVendor(c.speed_governor_vendor || 'Omata Africa Ltd');
    setGovCert(c.speed_governor_cert || `OM-${c.plate_number}`);
    setGovExpiry(c.speed_governor_expiry ? c.speed_governor_expiry.slice(0, 10) : '');
    setNtsaCert(c.ntsa_inspection_cert || `NTSA-${c.plate_number}`);
    setNtsaExpiry(c.ntsa_inspection_expiry ? c.ntsa_inspection_expiry.slice(0, 10) : '');
    setInsVendor(c.insurance_underwriter || 'Directline Assurance');
    setInsPolicy(c.insurance_policy_no || `DL-${c.plate_number}`);
    setInsExpiry(c.insurance_expiry ? c.insurance_expiry.slice(0, 10) : '');
  };

  const handleRenewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCompliance) return;
    try {
      setSubmittingAction(true);
      await updateVehicleCompliance(editingCompliance.vehicle_id, {
        speed_governor_vendor: govVendor,
        speed_governor_cert: govCert,
        speed_governor_expiry: govExpiry ? new Date(govExpiry).toISOString() : undefined,
        ntsa_inspection_cert: ntsaCert,
        ntsa_inspection_expiry: ntsaExpiry ? new Date(ntsaExpiry).toISOString() : undefined,
        insurance_underwriter: insVendor,
        insurance_policy_no: insPolicy,
        insurance_expiry: insExpiry ? new Date(insExpiry).toISOString() : undefined,
      });
      setSuccess(`Compliance certification renewed for ${editingCompliance.plate_number}`);
      setEditingCompliance(null);
      loadData();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: unknown) {
      setError(errMsg(err));
    } finally {
      setSubmittingAction(false);
    }
  };

  const formatDate = (iso?: string | null) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  const isExpiringSoon = (iso?: string | null) => {
    if (!iso) return false;
    const diffDays = (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return diffDays < 30 && diffDays > 0;
  };

  const isExpired = (iso?: string | null) => {
    if (!iso) return false;
    return new Date(iso).getTime() <= Date.now();
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 p-6 rounded-2xl border border-white/10 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-xl">
            🛡️
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-wide">
              NTSA &amp; PSV Fleet Compliance
            </h2>
            <p className="text-xs text-slate-400">
              National Transport and Safety Authority compliance audit: speed governors, inspections, and grounding enforcement
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedSacco}
            onChange={(e) => setSelectedSacco(e.target.value)}
            className="px-3 py-2 text-xs font-semibold bg-slate-800 border border-white/10 rounded-xl text-white outline-none focus:border-cyan-400"
          >
            <option value="all">All SACCOs &amp; Operators</option>
            {saccos.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>

          <button
            onClick={loadData}
            disabled={loading}
            className="px-4 py-2 text-xs font-semibold text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition flex items-center gap-2"
          >
            <span className={loading ? 'animate-spin' : ''}>🔄</span> Refresh
          </button>

          <button
            onClick={handleRunSweeper}
            disabled={runningSweeper || loading}
            className="px-4 py-2 text-xs font-bold text-slate-950 bg-gradient-to-r from-amber-400 to-rose-400 hover:from-amber-300 hover:to-rose-300 rounded-xl transition flex items-center gap-2 shadow-lg shadow-amber-500/20 disabled:opacity-50"
          >
            <span>⚡</span>
            <span>{runningSweeper ? 'Sweeping Fleet…' : 'Run NTSA Sweeper'}</span>
          </button>
        </div>
      </div>

      {/* Sweeper Result Banner */}
      {sweeperResult && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200 flex items-start justify-between gap-4 animate-in fade-in">
          <div>
            <p className="font-bold text-amber-300 text-sm flex items-center gap-2">
              <span>🛡️</span>
              <span>NTSA Auto-Grounding Sweeper Pass Finished</span>
              <span className="text-[10px] text-slate-400 font-normal">
                ({new Date(sweeperResult.timestamp).toLocaleTimeString()})
              </span>
            </p>
            <p className="mt-1">
              Audited <span className="font-mono font-bold text-white">{sweeperResult.total_vehicles_checked}</span> fleet vehicles ·{' '}
              <span className="font-bold text-rose-400">{sweeperResult.auto_grounded_count} newly auto-grounded</span> ·{' '}
              <span className="font-bold text-emerald-400">{sweeperResult.auto_cleared_count} restored</span> ·{' '}
              <span className="font-bold text-amber-300">{sweeperResult.suspended_trips_count} scheduled trips suspended</span>.
            </p>
          </div>
          <button
            onClick={() => setSweeperResult(null)}
            className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded bg-slate-800/60"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-4 backdrop-blur-md">
          <div className="text-[11px] text-slate-400 uppercase font-bold">Total Monitored Fleet</div>
          <div className="text-2xl font-black text-white mt-1">{stats.total}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">PSV Licensed vehicles</div>
        </div>
        <div className="bg-slate-900/50 border border-emerald-500/20 rounded-xl p-4 backdrop-blur-md">
          <div className="text-[11px] text-emerald-400 uppercase font-bold">NTSA Roadworthy</div>
          <div className="text-2xl font-black text-emerald-400 mt-1">{stats.compliant}</div>
          <div className="text-[10px] text-emerald-500/80 mt-0.5">Fully certified &amp; verified</div>
        </div>
        <div className="bg-slate-900/50 border border-amber-500/20 rounded-xl p-4 backdrop-blur-md">
          <div className="text-[11px] text-amber-400 uppercase font-bold">Expiring &le; 30 Days</div>
          <div className="text-2xl font-black text-amber-400 mt-1">{stats.warnings}</div>
          <div className="text-[10px] text-amber-500/80 mt-0.5">Renewals pending</div>
        </div>
        <div className="bg-slate-900/50 border border-rose-500/20 rounded-xl p-4 backdrop-blur-md">
          <div className="text-[11px] text-rose-400 uppercase font-bold">Grounded Vehicles</div>
          <div className="text-2xl font-black text-rose-500 mt-1">{stats.grounded}</div>
          <div className="text-[10px] text-rose-400/80 mt-0.5">Barred from revenue service</div>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
          <button onClick={() => setError('')} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {success && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>✅</span>
            <span>{success}</span>
          </div>
          <button onClick={() => setSuccess('')} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Compliance Table */}
      <div className="overflow-x-auto bg-slate-900/60 border border-white/10 rounded-2xl backdrop-blur-xl shadow-xl">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-white/5 border-b border-white/10 text-slate-400 uppercase font-semibold text-[10px]">
            <tr>
              <th className="py-3 px-4">Vehicle &amp; SACCO</th>
              <th className="py-3 px-4">Speed Governor (Omata)</th>
              <th className="py-3 px-4">NTSA Inspection</th>
              <th className="py-3 px-4">PSV Insurance</th>
              <th className="py-3 px-4 text-center">Status</th>
              <th className="py-3 px-4 text-right">Grounding Enforcement</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading && complianceList.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-400">
                  <div className="animate-spin inline-block mr-2">🔄</div> Scanning NTSA compliance records...
                </td>
              </tr>
            ) : filteredList.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-400">
                  No vehicle compliance records found.
                </td>
              </tr>
            ) : (
              filteredList.map((c) => {
                const govExp = isExpired(c.speed_governor_expiry);
                const govWarn = isExpiringSoon(c.speed_governor_expiry);
                const ntsaExp = isExpired(c.ntsa_inspection_expiry);
                const ntsaWarn = isExpiringSoon(c.ntsa_inspection_expiry);
                const insExp = isExpired(c.insurance_expiry);
                const insWarn = isExpiringSoon(c.insurance_expiry);

                return (
                  <tr
                    key={c.id}
                    className={`hover:bg-white/5 transition ${
                      c.is_grounded ? 'bg-rose-950/20' : ''
                    }`}
                  >
                    {/* Plate & SACCO */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="px-2.5 py-1 rounded bg-amber-400/10 border border-amber-400/30 text-amber-300 font-mono font-bold text-xs tracking-wider">
                          {c.plate_number}
                        </div>
                        <div>
                          <div className="font-semibold text-white">{c.sacco_name || 'Independent'}</div>
                          {c.is_grounded && (
                            <div className="text-[10px] text-rose-400 font-medium">
                              Grounded: {c.grounded_reason || 'NTSA non-compliance'}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Speed Governor */}
                    <td className="py-3.5 px-4">
                      <div className="font-mono text-slate-200">{c.speed_governor_cert || '—'}</div>
                      <div className="text-[10px] text-slate-400">{c.speed_governor_vendor || 'Omata'}</div>
                      <div
                        className={`text-[10px] font-semibold mt-0.5 ${
                          govExp ? 'text-rose-400' : govWarn ? 'text-amber-400' : 'text-emerald-400'
                        }`}
                      >
                        Exp: {formatDate(c.speed_governor_expiry)}
                      </div>
                    </td>

                    {/* NTSA Inspection */}
                    <td className="py-3.5 px-4">
                      <div className="font-mono text-slate-200">{c.ntsa_inspection_cert || '—'}</div>
                      <div
                        className={`text-[10px] font-semibold mt-0.5 ${
                          ntsaExp ? 'text-rose-400' : ntsaWarn ? 'text-amber-400' : 'text-emerald-400'
                        }`}
                      >
                        Exp: {formatDate(c.ntsa_inspection_expiry)}
                      </div>
                    </td>

                    {/* PSV Insurance */}
                    <td className="py-3.5 px-4">
                      <div className="font-mono text-slate-200">{c.insurance_policy_no || '—'}</div>
                      <div className="text-[10px] text-slate-400">{c.insurance_underwriter || 'Directline'}</div>
                      <div
                        className={`text-[10px] font-semibold mt-0.5 ${
                          insExp ? 'text-rose-400' : insWarn ? 'text-amber-400' : 'text-emerald-400'
                        }`}
                      >
                        Exp: {formatDate(c.insurance_expiry)}
                      </div>
                    </td>

                    {/* Status Badge */}
                    <td className="py-3.5 px-4 text-center">
                      {c.is_grounded ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                          GROUNDED
                        </span>
                      ) : c.status === 'compliant' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          COMPLIANT
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                          ATTENTION
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openRenewModal(c)}
                          className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 transition"
                          title="Update or renew compliance certificates"
                        >
                          Renew / Certs
                        </button>

                        <button
                          onClick={() => handleToggleGround(c)}
                          disabled={submittingAction}
                          className={`px-3 py-1 text-[11px] font-bold rounded-lg transition flex items-center gap-1.5 ${
                            c.is_grounded
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                          }`}
                        >
                          {c.is_grounded ? (
                            <>
                              <span>🟢</span> Clear
                            </>
                          ) : (
                            <>
                              <span>🛡️</span> Ground
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modal: Grounding Confirmation */}
      {groundingVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-slate-900 border border-rose-500/30 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-base font-bold text-rose-400 flex items-center gap-2">
                <span>🛡️ Ground Vehicle {groundingVehicle.plate_number}</span>
              </h3>
              <button
                onClick={() => setGroundingVehicle(null)}
                className="text-slate-400 hover:text-white text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={confirmGroundVehicle} className="p-6 space-y-4">
              <p className="text-xs text-slate-300">
                Grounding this vehicle will immediately bar it from operating on active trips. Passengers will not be able to book seats, and dispatch will be notified.
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Enforcement / Grounding Reason *
                </label>
                <select
                  value={groundingReason}
                  onChange={(e) => setGroundingReason(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-800 border border-white/10 rounded-xl text-white outline-none focus:border-rose-400"
                >
                  <option value="Speed governor calibration expired">Speed governor calibration expired</option>
                  <option value="Speed governor wire tampered">Speed governor wire tampered</option>
                  <option value="Expired NTSA roadworthiness inspection">Expired NTSA roadworthiness inspection</option>
                  <option value="Expired PSV insurance policy">Expired PSV insurance policy</option>
                  <option value="Police / NTSA roadside impound">Police / NTSA roadside impound</option>
                  <option value="Mechanical defect reported by driver">Mechanical defect reported by driver</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setGroundingVehicle(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAction}
                  className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-xl transition shadow-lg shadow-rose-600/30"
                >
                  {submittingAction ? 'Enforcing...' : 'Enforce Grounding'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Renew / Edit Compliance */}
      {editingCompliance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-slate-900 border border-white/15 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>📋 Renew NTSA Compliance: {editingCompliance.plate_number}</span>
              </h3>
              <button
                onClick={() => setEditingCompliance(null)}
                className="text-slate-400 hover:text-white text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRenewSubmit} className="p-6 space-y-4">
              {/* Speed Governor Section */}
              <div className="p-3 bg-black/40 rounded-xl border border-white/5 space-y-3">
                <div className="text-xs font-bold text-cyan-400">1. Speed Governor Calibration</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Vendor</label>
                    <input
                      type="text"
                      value={govVendor}
                      onChange={(e) => setGovVendor(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-800 border border-white/10 rounded-lg text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Certificate #</label>
                    <input
                      type="text"
                      value={govCert}
                      onChange={(e) => setGovCert(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-800 border border-white/10 rounded-lg text-white outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Calibration Expiry Date</label>
                  <input
                    type="date"
                    value={govExpiry}
                    onChange={(e) => setGovExpiry(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-800 border border-white/10 rounded-lg text-white outline-none"
                  />
                </div>
              </div>

              {/* NTSA Roadworthiness */}
              <div className="p-3 bg-black/40 rounded-xl border border-white/5 space-y-3">
                <div className="text-xs font-bold text-amber-400">2. NTSA Motor Vehicle Inspection</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Inspection Cert #</label>
                    <input
                      type="text"
                      value={ntsaCert}
                      onChange={(e) => setNtsaCert(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-800 border border-white/10 rounded-lg text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Inspection Expiry Date</label>
                    <input
                      type="date"
                      value={ntsaExpiry}
                      onChange={(e) => setNtsaExpiry(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-800 border border-white/10 rounded-lg text-white outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* PSV Insurance */}
              <div className="p-3 bg-black/40 rounded-xl border border-white/5 space-y-3">
                <div className="text-xs font-bold text-emerald-400">3. PSV Commercial Insurance</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Underwriter</label>
                    <input
                      type="text"
                      value={insVendor}
                      onChange={(e) => setInsVendor(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-800 border border-white/10 rounded-lg text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Policy Number</label>
                    <input
                      type="text"
                      value={insPolicy}
                      onChange={(e) => setInsPolicy(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-800 border border-white/10 rounded-lg text-white outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Policy Expiry Date</label>
                  <input
                    type="date"
                    value={insExpiry}
                    onChange={(e) => setInsExpiry(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-800 border border-white/10 rounded-lg text-white outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setEditingCompliance(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAction}
                  className="px-5 py-2 text-xs font-bold text-black bg-emerald-400 hover:bg-emerald-300 rounded-xl transition shadow-lg shadow-emerald-500/20"
                >
                  {submittingAction ? 'Updating...' : 'Save Certificates'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

