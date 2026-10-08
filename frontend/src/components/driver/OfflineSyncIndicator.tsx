'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  saveManifestOffline,
  getCachedManifest,
  getPendingScans,
  syncOfflineScans,
  markScanSynced,
  CachedTripManifest,
  PendingOfflineScan,
  OfflinePassenger,
} from '@/lib/offlineStore';
import { boardPassenger, batchOfflineSync, ManifestEntry, TripRow } from '@/services/api';

interface OfflineSyncIndicatorProps {
  tripId: number;
  currentTrip?: TripRow;
  manifest: ManifestEntry[];
  onSyncComplete?: () => void;
  onSimulateOfflineChange?: (isSimulatedOffline: boolean) => void;
}

export default function OfflineSyncIndicator({
  tripId,
  currentTrip,
  manifest,
  onSyncComplete,
  onSimulateOfflineChange,
}: OfflineSyncIndicatorProps) {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isSimulatedOffline, setIsSimulatedOffline] = useState<boolean>(false);
  const [cachedData, setCachedData] = useState<CachedTripManifest | null>(null);
  const [pendingScans, setPendingScans] = useState<PendingOfflineScan[]>([]);
  const [isCaching, setIsCaching] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncMessage, setSyncMessage] = useState<string>('');

  // Track browser online / offline events
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsOnline(window.navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Load cached manifest and pending queue
  const refreshCacheInfo = useCallback(async () => {
    if (!tripId) return;
    try {
      const cached = await getCachedManifest(tripId);
      setCachedData(cached);
      const pending = await getPendingScans(tripId);
      setPendingScans(pending);
    } catch (err) {
      console.warn('Error reading offline cache:', err);
    }
  }, [tripId]);

  useEffect(() => {
    refreshCacheInfo();
  }, [refreshCacheInfo]);

  // Handle caching manifest
  const handleCacheTrip = async () => {
    if (!tripId || manifest.length === 0) return;
    setIsCaching(true);
    setSyncMessage('');
    try {
      const offlinePassengers: OfflinePassenger[] = manifest.map((m) => ({
        booking_id: (m as { booking_id?: number }).booking_id,
        seat_number: m.seat_number,
        full_name: m.full_name,
        phone: m.phone,
        board_stop: m.board_stop,
        alight_stop: m.alight_stop,
        board_stop_order: m.board_stop_order,
        alight_stop_order: m.alight_stop_order,
        status: (m as { status?: string }).status || 'pending',
        payment_status: (m as { payment_status?: string }).payment_status || 'paid',
      }));

      await saveManifestOffline(
        tripId,
        {
          name: currentTrip?.name,
          plate_number: currentTrip?.plate_number,
          route_name: currentTrip?.route_name,
        },
        offlinePassengers
      );

      await refreshCacheInfo();
      setSyncMessage(`✓ Manifest Pre-Downloaded! Trip #${tripId} (${manifest.length} passengers) cached for offline dead zones.`);
      setTimeout(() => setSyncMessage(''), 5000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSyncMessage(`❌ Failed to cache manifest: ${msg}`);
    } finally {
      setIsCaching(false);
    }
  };

  // Sync queued scans back to server using high-speed deterministic batch sync
  const handleSyncScans = async () => {
    if (!tripId || pendingScans.length === 0 || isSyncing) return;
    setIsSyncing(true);
    setSyncMessage('');
    try {
      let syncedCount = 0;
      let failedCount = 0;
      const errors: string[] = [];

      try {
        const batchPayload = pendingScans.map((s) => ({
          booking_id: s.bookingId,
          ticket_code: s.ticketCode,
          seat_number: s.seatNumber,
          scanned_at: s.scannedAt,
        }));
        const batchRes = await batchOfflineSync(tripId, batchPayload);
        for (const s of pendingScans) {
          if (s.id != null) await markScanSynced(s.id);
        }
        syncedCount = batchRes.boarded_count + batchRes.already_boarded_count;
        failedCount = batchRes.conflict_count;
        if (batchRes.results) {
          batchRes.results
            .filter((r) => r.status === 'conflict_cancelled')
            .forEach((r) => errors.push(`Seat #${r.seat_number}: ticket cancelled`));
        }
      } catch {
        // Fallback to per-scan sync
        const result = await syncOfflineScans(tripId, async (tId, body) => {
          return await boardPassenger(tId, body);
        });
        syncedCount = result.syncedCount;
        failedCount = result.failedCount;
        errors.push(...result.errors);
      }

      await refreshCacheInfo();
      if (onSyncComplete) onSyncComplete();

      if (errors.length > 0) {
        setSyncMessage(`⚠️ Synced ${syncedCount} scans. ${failedCount} conflicts (${errors.join('; ')}).`);
      } else {
        setSyncMessage(`✓ All ${syncedCount} queued highway scans synced successfully to cloud!`);
      }
      setTimeout(() => setSyncMessage(''), 6000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSyncMessage(`❌ Sync failed: ${msg}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const effectiveOnline = isOnline && !isSimulatedOffline;

  return (
    <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 backdrop-blur-md shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Connection Status Badge */}
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center">
            <span
              className={`w-3 h-3 rounded-full ${
                effectiveOnline ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]' : 'bg-amber-500 shadow-[0_0_10px_#f59e0b]'
              }`}
            />
            {effectiveOnline && (
              <span className="absolute w-4 h-4 rounded-full bg-emerald-400 opacity-50 animate-ping" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-white">
                {effectiveOnline ? '🟢 Live Cloud Network' : '⚡ Highway Dead Zone Mode (Offline)'}
              </span>
              {isSimulatedOffline && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono font-bold">
                  Simulated
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {effectiveOnline
                ? 'Direct server synchronization active'
                : 'Offline QR check-ins stored locally in browser IndexedDB'}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Simulation Toggle */}
          <button
            onClick={() => {
              const next = !isSimulatedOffline;
              setIsSimulatedOffline(next);
              if (onSimulateOfflineChange) onSimulateOfflineChange(next);
            }}
            title="Simulate entering a cellular dead zone (e.g. Great Rift Valley escarpment or Kinungi)"
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold border transition ${
              isSimulatedOffline
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            {isSimulatedOffline ? '⚡ Disconnect (Active)' : '📡 Test Dead Zone'}
          </button>

          {/* Cache Manifest Button */}
          <button
            onClick={handleCacheTrip}
            disabled={isCaching || !tripId}
            className="px-3 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-40"
          >
            {isCaching ? 'Caching...' : '💾 Cache Trip Offline'}
          </button>

          {/* Sync Queued Scans Button */}
          {pendingScans.length > 0 && (
            <button
              onClick={handleSyncScans}
              disabled={isSyncing || !effectiveOnline}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black transition flex items-center gap-1.5 shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:opacity-40 animate-pulse"
            >
              {isSyncing ? 'Syncing...' : `🔄 Sync ${pendingScans.length} Scans`}
            </button>
          )}
        </div>
      </div>

      {/* Cache Status Details */}
      <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between text-xs text-slate-400 gap-2">
        <div className="flex items-center gap-3">
          <span>
            Offline Store:{' '}
            <strong className={cachedData ? 'text-cyan-300 font-mono' : 'text-slate-500'}>
              {cachedData
                ? `Cached ${new Date(cachedData.cachedAt).toLocaleTimeString('en-KE')} (${cachedData.passengers.length} passengers)`
                : 'Not Cached'}
            </strong>
          </span>
          {pendingScans.length > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-300 font-bold">
              ⚡ {pendingScans.length} queued offline {pendingScans.length === 1 ? 'scan' : 'scans'}
            </span>
          )}
        </div>

        {syncMessage && (
          <span className="text-xs font-semibold text-cyan-300 animate-fadeIn">
            {syncMessage}
          </span>
        )}
      </div>
    </div>
  );
}

