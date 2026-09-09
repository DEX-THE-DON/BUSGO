// BUSGO Highway Dead-Zone Offline Ticket & Manifest Store
// Powered by IndexedDB for zero-network validation on Kenyan transit corridors

export interface OfflinePassenger {
  booking_id?: number;
  seat_number: number;
  full_name?: string | null;
  phone?: string | null;
  board_stop?: string | null;
  alight_stop?: string | null;
  board_stop_order?: number;
  alight_stop_order?: number;
  status?: string; // 'pending' | 'boarded'
  payment_status?: string;
  ticket_code?: string;
}

export interface CachedTripManifest {
  tripId: number;
  tripName: string;
  plateNumber?: string | null;
  routeName?: string | null;
  cachedAt: string;
  passengers: OfflinePassenger[];
}

export interface PendingOfflineScan {
  id?: number;
  tripId: number;
  bookingId?: number;
  ticketCode?: string;
  seatNumber: number;
  passengerName: string;
  scannedAt: string;
  synced: boolean;
  syncError?: string;
}

export interface PendingOfflineWalkin {
  id?: number;
  tripId: number;
  seatNumber: number;
  passengerName: string;
  passengerPhone: string;
  boardStopOrder: number;
  alightStopOrder: number;
  fareAmount: number;
  offlineReceipt: string;
  createdAt: string;
  synced: boolean;
  syncError?: string;
}

const DB_NAME = 'busgo_offline_db';
const DB_VERSION = 2;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not supported'));
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('manifests')) {
        db.createObjectStore('manifests', { keyPath: 'tripId' });
      }
      if (!db.objectStoreNames.contains('pending_scans')) {
        const scanStore = db.createObjectStore('pending_scans', { keyPath: 'id', autoIncrement: true });
        scanStore.createIndex('tripId', 'tripId', { unique: false });
        scanStore.createIndex('synced', 'synced', { unique: false });
      }
      if (!db.objectStoreNames.contains('pending_walkins')) {
        const walkinStore = db.createObjectStore('pending_walkins', { keyPath: 'id', autoIncrement: true });
        walkinStore.createIndex('tripId', 'tripId', { unique: false });
        walkinStore.createIndex('synced', 'synced', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Cache an entire trip manifest into local IndexedDB for highway dead zones.
 */
export async function saveManifestOffline(
  tripId: number,
  tripInfo: { name?: string; plate_number?: string | null; route_name?: string | null },
  manifest: OfflinePassenger[]
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('manifests', 'readwrite');
    const store = tx.objectStore('manifests');

    const record: CachedTripManifest = {
      tripId,
      tripName: tripInfo.name || `Trip #${tripId}`,
      plateNumber: tripInfo.plate_number,
      routeName: tripInfo.route_name,
      cachedAt: new Date().toISOString(),
      passengers: manifest,
    };

    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieve cached manifest for a trip.
 */
export async function getCachedManifest(tripId: number): Promise<CachedTripManifest | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('manifests', 'readonly');
    const store = tx.objectStore('manifests');
    const req = store.get(tripId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Offline ticket parsing & verification:
 * Checks cached manifest and local pending scans when conductor is offline.
 */
export async function validateOfflineTicket(
  tripId: number,
  ticketInput: string | number
): Promise<{
  success: boolean;
  message: string;
  duplicate?: boolean;
  passenger?: OfflinePassenger;
  seatNumber?: number;
}> {
  const cached = await getCachedManifest(tripId);
  if (!cached) {
    return {
      success: false,
      message: 'No offline manifest cached for this trip. Connect to internet once to cache.',
    };
  }

  const rawStr = String(ticketInput).trim();
  let bookingId: number | undefined;
  let seatNumber: number | undefined;

  // Format: BUSGO:<booking_id>:<trip_id>:<seat_number> or plain number or ticket code
  if (rawStr.startsWith('BUSGO:')) {
    const parts = rawStr.split(':');
    if (parts.length >= 4) {
      bookingId = parseInt(parts[1], 10);
      seatNumber = parseInt(parts[3], 10);
    }
  } else if (!isNaN(Number(rawStr))) {
    bookingId = Number(rawStr);
  }

  // Look for match in cached passengers
  let matchedPassenger: OfflinePassenger | undefined;

  if (bookingId != null) {
    matchedPassenger = cached.passengers.find((p) => p.booking_id === bookingId);
  }
  if (!matchedPassenger && seatNumber != null) {
    matchedPassenger = cached.passengers.find((p) => p.seat_number === seatNumber);
  }
  if (!matchedPassenger) {
    matchedPassenger = cached.passengers.find(
      (p) => p.ticket_code === rawStr || (p.phone && p.phone === rawStr)
    );
  }

  if (!matchedPassenger) {
    return {
      success: false,
      message: `❌ Unrecognized ticket (${rawStr}) in offline manifest for Trip #${tripId}.`,
    };
  }

  // Check if already boarded in cached manifest
  if (matchedPassenger.status === 'boarded') {
    return {
      success: false,
      duplicate: true,
      passenger: matchedPassenger,
      seatNumber: matchedPassenger.seat_number,
      message: `⚠️ Already Boarded! Seat #${matchedPassenger.seat_number} was previously checked in.`,
    };
  }

  // Check if already scanned in pending_scans
  const pending = await getPendingScans(tripId);
  const alreadyInQueue = pending.find(
    (s) =>
      (s.bookingId && s.bookingId === matchedPassenger?.booking_id) ||
      s.seatNumber === matchedPassenger?.seat_number
  );

  if (alreadyInQueue) {
    return {
      success: false,
      duplicate: true,
      passenger: matchedPassenger,
      seatNumber: matchedPassenger.seat_number,
      message: `⚠️ Duplicate Offline Scan! Seat #${matchedPassenger.seat_number} already scanned at ${new Date(
        alreadyInQueue.scannedAt
      ).toLocaleTimeString('en-KE')}.`,
    };
  }

  // Valid offline boarding! Save to pending scans queue
  const pendingScan: PendingOfflineScan = {
    tripId,
    bookingId: matchedPassenger.booking_id,
    ticketCode: rawStr,
    seatNumber: matchedPassenger.seat_number,
    passengerName: matchedPassenger.full_name || 'Walk-up Passenger',
    scannedAt: new Date().toISOString(),
    synced: false,
  };

  await recordOfflineScan(pendingScan);

  // Update cached manifest status to 'boarded' so conductor immediately sees checked in
  matchedPassenger.status = 'boarded';
  await saveManifestOffline(
    tripId,
    { name: cached.tripName, plate_number: cached.plateNumber, route_name: cached.routeName },
    cached.passengers
  );

  return {
    success: true,
    message: `✓ Valid Offline Ticket! Seat #${matchedPassenger.seat_number} (${matchedPassenger.full_name || 'Passenger'}) boarded. Queued for sync.`,
    passenger: matchedPassenger,
    seatNumber: matchedPassenger.seat_number,
  };
}

/**
 * Record an offline scan into pending_scans queue.
 */
export async function recordOfflineScan(scan: PendingOfflineScan): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_scans', 'readwrite');
    const store = tx.objectStore('pending_scans');
    const req = store.add(scan);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Fetch all pending un-synced scans for a trip (or all trips).
 */
export async function getPendingScans(tripId?: number): Promise<PendingOfflineScan[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_scans', 'readonly');
    const store = tx.objectStore('pending_scans');
    const req = store.getAll();
    req.onsuccess = () => {
      let scans: PendingOfflineScan[] = (req.result || []).filter((s) => !s.synced);
      if (tripId != null) {
        scans = scans.filter((s) => s.tripId === tripId);
      }
      resolve(scans);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Mark a scan as synced in IndexedDB.
 */
export async function markScanSynced(scanId: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_scans', 'readwrite');
    const store = tx.objectStore('pending_scans');
    const getReq = store.get(scanId);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (record) {
        record.synced = true;
        store.put(record);
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Sync all pending offline scans to backend when network connectivity is restored.
 */
export async function syncOfflineScans(
  tripId: number,
  boardFn: (tripId: number, body: { bookingId?: number; ticketCode?: string }) => Promise<{ ok?: boolean; success?: boolean; message?: string } | any>
): Promise<{ syncedCount: number; failedCount: number; errors: string[] }> {
  const pending = await getPendingScans(tripId);
  let syncedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  for (const scan of pending) {
    try {
      await boardFn(tripId, {
        bookingId: scan.bookingId,
        ticketCode: scan.ticketCode,
      });
      if (scan.id != null) {
        await markScanSynced(scan.id);
      }
      syncedCount++;
    } catch (err: unknown) {
      failedCount++;
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`Seat #${scan.seatNumber}: ${errMsg}`);
    }
  }

  return { syncedCount, failedCount, errors };
}

/**
 * Queue a walk-in cash ticket issued at a remote terminus while offline.
 */
export async function queueOfflineWalkin(
  walkin: Omit<PendingOfflineWalkin, 'id' | 'createdAt' | 'synced'>
): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_walkins', 'readwrite');
    const store = tx.objectStore('pending_walkins');
    const record: Omit<PendingOfflineWalkin, 'id'> = {
      ...walkin,
      createdAt: new Date().toISOString(),
      synced: false,
    };
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieve all pending offline walk-in bookings.
 */
export async function getPendingWalkins(tripId?: number): Promise<PendingOfflineWalkin[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_walkins', 'readonly');
    const store = tx.objectStore('pending_walkins');
    const req = store.getAll();

    req.onsuccess = () => {
      let results = (req.result as PendingOfflineWalkin[]).filter((w) => !w.synced);
      if (tripId) {
        results = results.filter((w) => w.tripId === tripId);
      }
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Mark a queued walk-in ticket as synced.
 */
export async function markWalkinSynced(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_walkins', 'readwrite');
    const store = tx.objectStore('pending_walkins');
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const record = getReq.result as PendingOfflineWalkin | undefined;
      if (record) {
        record.synced = true;
        store.put(record);
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Sync queued offline walk-in bookings to the backend server.
 */
export async function syncOfflineWalkins(
  syncFn: (payload: {
    trip_id: number;
    seat_number: number;
    passenger_name: string;
    passenger_phone?: string;
    board_stop_order: number;
    alight_stop_order: number;
    fare_amount: number;
  }) => Promise<any>
): Promise<{ syncedCount: number; failedCount: number; errors: string[] }> {
  const pending = await getPendingWalkins();
  let syncedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  for (const w of pending) {
    try {
      await syncFn({
        trip_id: w.tripId,
        seat_number: w.seatNumber,
        passenger_name: w.passengerName,
        passenger_phone: w.passengerPhone,
        board_stop_order: w.boardStopOrder,
        alight_stop_order: w.alightStopOrder,
        fare_amount: w.fareAmount,
      });
      if (w.id != null) {
        await markWalkinSynced(w.id);
      }
      syncedCount++;
    } catch (err: unknown) {
      failedCount++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Seat #${w.seatNumber} (${w.passengerName}): ${msg}`);
    }
  }

  return { syncedCount, failedCount, errors };
}
