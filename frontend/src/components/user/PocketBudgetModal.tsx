'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { fetchBudgetReach, BudgetReachResponse, errMsg } from '@/services/api';

interface PocketBudgetModalProps {
  tripId: number;
  routeName: string;
  stops: { id?: number; stop_name: string; stop_order: number }[];
  currentBoardOrder: number;
  currentAlightOrder?: number;
  onSelectReachableStage: (stopOrder: number, stageName: string, fare: number) => void;
  onClose: () => void;
}

export default function PocketBudgetModal({
  tripId,
  routeName,
  stops,
  currentBoardOrder,
  currentAlightOrder,
  onSelectReachableStage,
  onClose,
}: PocketBudgetModalProps) {
  const [budget, setBudget] = useState<number>(100);
  const [boardOrder, setBoardOrder] = useState<number>(currentBoardOrder || 1);
  const [intendedOrder, setIntendedOrder] = useState<number>(
    currentAlightOrder || (stops.length > 1 ? stops[stops.length - 1].stop_order : 4)
  );
  const [reachData, setReachData] = useState<BudgetReachResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const calculateReach = useCallback(async () => {
    if (!tripId || budget < 0) return;
    try {
      setLoading(true);
      setError('');
      const data = await fetchBudgetReach(tripId, boardOrder, budget, intendedOrder);
      setReachData(data);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [tripId, boardOrder, budget, intendedOrder]);

  useEffect(() => {
    calculateReach();
  }, [calculateReach]);

  const presetBudgets = [50, 100, 150, 200, 250, 300, 500];

  const boardStopName = stops.find((s) => s.stop_order === boardOrder)?.stop_name || 'Boarding Stage';
  const intendedStopName = stops.find((s) => s.stop_order === intendedOrder)?.stop_name || 'Final Destination';

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-slate-900 border border-cyan-500/40 rounded-3xl p-5 sm:p-7 shadow-2xl shadow-cyan-950/50 max-h-[90vh] flex flex-col relative overflow-hidden">
        {/* Glowing synthwave backdrop accent */}
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">💡</span>
              <h3 className="text-lg font-black tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-sky-300 to-emerald-400 uppercase">
                Bei ya Mfuko &bull; Pocket Hop Finder
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              &quot;Niko na KES {budget}, inanifikisha wapi?&quot; &mdash; Calculate furthest reachable stop along {routeName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors text-xs font-bold"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="overflow-y-auto space-y-5 py-4 flex-1 pr-1 custom-scrollbar">
          {/* Controls: Boarding Stage & Budget Input */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/80 p-4 rounded-2xl border border-slate-800">
            <div>
              <label className="text-[11px] font-bold uppercase text-slate-400 block mb-1.5">
                1. Boarding From:
              </label>
              <select
                value={boardOrder}
                onChange={(e) => setBoardOrder(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-cyan-400"
              >
                {stops.slice(0, -1).map((s) => (
                  <option key={s.stop_order} value={s.stop_order}>
                    Stop #{s.stop_order}: {s.stop_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase text-slate-400 block mb-1.5">
                2. Intended Destination (Optional):
              </label>
              <select
                value={intendedOrder}
                onChange={(e) => setIntendedOrder(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-cyan-300 focus:outline-none focus:border-cyan-400"
              >
                {stops
                  .filter((s) => s.stop_order > boardOrder)
                  .map((s) => (
                    <option key={s.stop_order} value={s.stop_order}>
                      Stop #{s.stop_order}: {s.stop_name}
                    </option>
                  ))}
              </select>
            </div>

            {/* Budget Input & Quick Buttons */}
            <div className="sm:col-span-2 pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-bold uppercase text-slate-400">
                  3. Pocket Budget Available:
                </label>
                <span className="text-sm font-black text-cyan-400 font-mono">
                  KES {budget}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={budget}
                  onChange={(e) => setBudget(Math.max(0, Number(e.target.value)))}
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-sm font-black text-white focus:outline-none focus:border-cyan-400"
                  placeholder="Enter cash or M-Pesa amount"
                />
              </div>

              {/* Quick Presets */}
              <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                {presetBudgets.map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setBudget(val)}
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${
                      budget === val
                        ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/30 scale-105'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                    }`}
                  >
                    KES {val}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs">
              ⚠️ {error}
            </div>
          )}

          {/* Results Analysis */}
          {reachData && (
            <div className="space-y-4">
              {/* Highlight Card: Furthest Stage */}
              {reachData.furthest_reachable_stop ? (
                <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/80 via-slate-900 to-cyan-950/80 border border-emerald-500/60 shadow-xl relative overflow-hidden">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        ⭐ Furthest Stage for KES {budget}
                      </span>
                      <h4 className="text-xl font-black text-white mt-1.5 flex items-center gap-2">
                        {reachData.furthest_reachable_stop.stop_name}
                        <span className="text-xs text-slate-400 font-normal">
                          (Stop #{reachData.furthest_reachable_stop.stop_order})
                        </span>
                      </h4>
                      <p className="text-xs text-slate-300 mt-1">
                        Fare from <b>{boardStopName}</b> is exactly <b className="text-emerald-400">KES {reachData.furthest_reachable_stop.fare}</b>.
                        {reachData.furthest_reachable_stop.change_remaining > 0 && (
                          <span className="text-cyan-300 ml-1">
                            (Change: KES {reachData.furthest_reachable_stop.change_remaining})
                          </span>
                        )}
                      </p>
                    </div>

                    <button
                      onClick={() =>
                        onSelectReachableStage(
                          reachData.furthest_reachable_stop!.stop_order,
                          reachData.furthest_reachable_stop!.stop_name,
                          reachData.furthest_reachable_stop!.fare
                        )
                      }
                      className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 text-slate-950 font-black text-xs hover:brightness-110 shadow-lg shadow-emerald-500/30 transition-all"
                    >
                      Book Seat &rarr;
                    </button>
                  </div>

                  {/* Deficit to final destination notice */}
                  {reachData.intended_alight_stop && reachData.deficit_to_destination > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between text-xs gap-2">
                      <span className="text-slate-400">
                        To reach your dream destination (<b>{intendedStopName}</b>):
                      </span>
                      <span className="text-rose-300 font-bold">
                        Deficit: KES {reachData.deficit_to_destination} (or redeem {reachData.deficit_to_destination} Safari Points)
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-rose-200">
                    <span>⚠️</span> Bajeti haitoshi hata kituo cha kwanza (First stage fare exceeds budget)
                  </div>
                  <p className="text-[11px] text-slate-300">
                    The minimum fare from {boardStopName} to the next stage is KES {reachData.stages_breakdown[0]?.fare || 150}.
                    You need an extra <b>KES {reachData.stages_breakdown[0] ? reachData.stages_breakdown[0].fare - budget : 50}</b> to hop on.
                  </p>
                </div>
              )}

              {/* Complete Corridor Breakdown Table */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Corridor Stage-by-Stage Fare Meter
                </h4>
                <div className="space-y-2">
                  {reachData.stages_breakdown.map((stage) => {
                    const isFurthest = reachData.furthest_reachable_stop?.stop_order === stage.stop_order;
                    return (
                      <div
                        key={stage.stop_order}
                        className={`p-3 rounded-xl border transition-all flex items-center justify-between text-xs ${
                          isFurthest
                            ? 'bg-emerald-950/40 border-emerald-500/80 shadow-md shadow-emerald-950/50'
                            : stage.is_reachable
                            ? 'bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-300'
                            : 'bg-slate-950/30 border-slate-800/40 opacity-60 text-slate-500'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                              stage.is_reachable
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {stage.is_reachable ? '✓' : '×'}
                          </span>
                          <div>
                            <span className="font-bold text-white flex items-center gap-1.5">
                              {stage.stop_name}
                              {isFurthest && (
                                <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-extrabold uppercase">
                                  Furthest
                                </span>
                              )}
                            </span>
                            <span className="text-[10px] text-slate-400 block">
                              {stage.hop_count} hop{stage.hop_count > 1 ? 's' : ''} from {boardStopName}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <span className="text-sm font-black text-white block">
                              KES {stage.fare}
                            </span>
                            {stage.is_reachable ? (
                              <span className="text-[10px] text-cyan-400 font-semibold">
                                Change: KES {stage.change_remaining}
                              </span>
                            ) : (
                              <span className="text-[10px] text-rose-400 font-semibold">
                                Short by KES {stage.deficit}
                              </span>
                            )}
                          </div>

                          <button
                            onClick={() => onSelectReachableStage(stage.stop_order, stage.stop_name, stage.fare)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                              stage.is_reachable
                                ? 'bg-slate-800 hover:bg-emerald-500 hover:text-slate-950 text-slate-200'
                                : 'bg-slate-900 text-slate-600 hover:text-slate-400'
                            }`}
                          >
                            Select
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

