'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchIncidents,
  dispatchReliefBus,
  resolveIncident,
  IncidentItem,
  fetchAdminVehicles,
  Vehicle,
} from '@/services/api';

interface IncidentDispatcherProps {
  saccoId?: number;
}

export default function IncidentDispatcher({ saccoId }: IncidentDispatcherProps) {
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Relief Bus Modal State
  const [selectedIncident, setSelectedIncident] = useState<IncidentItem | null>(null);
  const [selectedReliefVehicleId, setSelectedReliefVehicleId] = useState<number | null>(null);
  const [reliefNotes, setReliefNotes] = useState('');
  const [isDispatching, setIsDispatching] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [incRes, vehRes] = await Promise.all([
        fetchIncidents(saccoId, 'all'),
        fetchAdminVehicles(),
      ]);
      setIncidents(incRes.incidents);
      setVehicles(vehRes.vehicles.filter((v) => !v.is_grounded && v.compliance_status !== 'grounded'));
      if (vehRes.vehicles.length > 0) {
        setSelectedReliefVehicleId(vehRes.vehicles[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load incident dispatch data');
    } finally {
      setLoading(false);
    }
  }, [saccoId]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleDispatchRelief = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIncident || !selectedReliefVehicleId) return;
    setIsDispatching(true);
    setError('');
    setSuccessMsg('');

    try {
      const res = await dispatchReliefBus(selectedIncident.id, {
        relief_vehicle_id: selectedReliefVehicleId,
        notes: reliefNotes.trim() || undefined,
      });

      if (res.ok) {
        setSuccessMsg(res.message);
        setSelectedIncident(null);
        setReliefNotes('');
        await loadData();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Relief dispatch failed');
    } finally {
      setIsDispatching(false);
    }
  };

  const handleResolve = async (incidentId: number) => {
    try {
      const res = await resolveIncident(incidentId);
      if (res.ok) {
        setSuccessMsg(`Incident #${incidentId} marked resolved.`);
        await loadData();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resolve incident');
    }
  };

  const getSeverityBadge = (sev: string) => {
    switch (sev) {
      case 'critical_sos':
        return <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px] font-black uppercase tracking-wider animate-pulse">Critical SOS</span>;
      case 'high':
        return <span className="px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 text-[10px] font-black uppercase tracking-wider">High Severity</span>;
      case 'medium':
        return <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-black uppercase tracking-wider">Moderate</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-black uppercase tracking-wider">Minor Delay</span>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="px-2 py-0.5 rounded-md bg-rose-950 text-rose-300 font-mono text-[10px] font-bold border border-rose-800">Active Alert</span>;
      case 'relief_dispatched':
        return <span className="px-2 py-0.5 rounded-md bg-cyan-950 text-cyan-300 font-mono text-[10px] font-bold border border-cyan-800">Relief Dispatched</span>;
      case 'resolved':
        return <span className="px-2 py-0.5 rounded-md bg-emerald-950 text-emerald-300 font-mono text-[10px] font-bold border border-emerald-800">Resolved</span>;
      default:
        return <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 font-mono text-[10px]">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <span className="text-xl">🚨</span>
            Highway Incident, Delays & Emergency SOS Dispatch
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Monitor real-time driver roadside alerts, broadcast delay advisories, and deploy standby relief vehicles.
          </p>
        </div>
        <button
          onClick={loadData}
          className="self-start sm:self-auto px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-bold transition"
        >
          ↻ Refresh Incidents
        </button>
      </div>

      {error && (
        <div className="p-3 bg-rose-500/15 border border-rose-500/40 rounded-2xl text-rose-300 text-xs font-bold">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-emerald-500/15 border border-emerald-500/40 rounded-2xl text-emerald-300 text-xs font-bold">
          ✓ {successMsg}
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-slate-500 font-mono text-xs">
          Loading incident streams...
        </div>
      ) : incidents.length === 0 ? (
        <div className="p-10 rounded-2xl bg-slate-900/50 border border-slate-800 text-center text-slate-400 text-xs">
          No active highway delays or incident reports. All corridor routes are moving smoothly!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {incidents.map((inc) => (
            <div
              key={inc.id}
              className={`p-5 rounded-3xl border transition-all space-y-4 ${
                inc.status === 'active'
                  ? inc.severity === 'critical_sos'
                    ? 'bg-rose-950/20 border-rose-800/80 shadow-rose-950/20 shadow-xl ring-1 ring-rose-500/30'
                    : 'bg-slate-900/90 border-slate-800 shadow-xl'
                  : 'bg-slate-950/60 border-slate-900 opacity-80'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-white text-sm">{inc.trip_name}</span>
                    {getSeverityBadge(inc.severity)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                    <span>📍 {inc.location_name}</span>
                    <span>•</span>
                    <span>Driver: {inc.reported_by}</span>
                  </div>
                </div>
                {getStatusBadge(inc.status)}
              </div>

              <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800/80 text-xs space-y-1">
                <div className="flex justify-between text-slate-400 text-[11px]">
                  <span>Category:</span>
                  <span className="font-mono font-bold text-slate-200 uppercase">{inc.category.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between text-slate-400 text-[11px]">
                  <span>Estimated Delay:</span>
                  <span className="font-mono font-black text-amber-400">+{inc.estimated_delay_mins} mins</span>
                </div>
                <div className="text-slate-300 text-[11px] pt-1 border-t border-slate-800/80 italic">
                  &ldquo;{inc.description}&rdquo;
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-1">
                {inc.status !== 'resolved' && (
                  <>
                    <button
                      onClick={() => setSelectedIncident(inc)}
                      className="flex-1 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs uppercase tracking-wider transition shadow-md"
                    >
                      🚑 Dispatch Relief Bus
                    </button>
                    <button
                      onClick={() => handleResolve(inc.id)}
                      className="px-3 py-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 font-bold text-xs transition"
                    >
                      Mark Resolved ✓
                    </button>
                  </>
                )}
                {inc.status === 'resolved' && (
                  <div className="text-[10px] text-slate-500 font-mono italic">
                    Resolved • Operations normal
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Relief Bus Dispatch Modal */}
      {selectedIncident && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-5 animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  <span>Deploy Relief Vehicle & Transfer Manifest</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Incident #{selectedIncident.id} · {selectedIncident.trip_name}
                </p>
              </div>
              <button
                onClick={() => setSelectedIncident(null)}
                className="text-slate-400 hover:text-white text-sm font-mono px-2 py-1 rounded bg-slate-800"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleDispatchRelief} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Select Standby Compliant Vehicle:
                </label>
                <select
                  value={selectedReliefVehicleId || ''}
                  onChange={(e) => setSelectedReliefVehicleId(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-400 font-mono"
                  required
                >
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plate_number} · {v.vehicle_type_name || v.category} {v.is_electric ? '(⚡ EV)' : ''} · Compliant
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
                  Relief Dispatch Notes:
                </label>
                <textarea
                  value={reliefNotes}
                  onChange={(e) => setReliefNotes(e.target.value)}
                  placeholder="e.g. Relief bus leaving Nairobi terminal to intercept passengers near Limuru..."
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div className="p-3 bg-cyan-950/40 border border-cyan-800/60 rounded-xl text-xs text-cyan-200">
                ℹ️ <strong>Automated Actions:</strong> Manifest passengers will be transferred automatically to the relief vehicle, and an instant SMS advisory with the new plate number will be delivered to every commuter.
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedIncident(null)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-700 bg-slate-800 text-xs font-bold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isDispatching || !selectedReliefVehicleId}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 text-slate-950 font-black text-xs uppercase tracking-wider transition shadow-lg disabled:opacity-60"
                >
                  {isDispatching ? 'Dispatching...' : 'Deploy Relief Bus'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
