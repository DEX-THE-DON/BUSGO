/**
 * Transit GIS & Coordinate Engine
 * Maps Kenyan highway stops and coordinates, calculates route bounds,
 * interpolates intermediate stops, and computes distance & ETA.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeoStop {
  id?: number;
  stop_name: string;
  stop_order: number;
  coords: LatLng;
}

// Known transit terminals, stations, and waypoint coordinates across Kenya corridors
export const KNOWN_STATION_COORDS: Record<string, LatLng> = {
  // Nairobi Region
  'nairobi': { lat: -1.286389, lng: 36.817223 },
  'nairobi station': { lat: -1.286389, lng: 36.817223 },
  'nairobi central': { lat: -1.286389, lng: 36.817223 },
  'westlands': { lat: -1.2677, lng: 36.8049 },
  'kangemi': { lat: -1.2585, lng: 36.7516 },
  'uthiru': { lat: -1.2540, lng: 36.7210 },
  'kikuyu': { lat: -1.2447, lng: 36.6631 },
  'limuru': { lat: -1.1118, lng: 36.6437 },

  // Rift Valley & Western Corridor (A104)
  'naivasha': { lat: -0.7172, lng: 36.4310 },
  'gilgil': { lat: -0.4920, lng: 36.2870 },
  'nakuru': { lat: -0.3031, lng: 36.0800 },
  'nakuru terminal': { lat: -0.3031, lng: 36.0800 },
  'salgaa': { lat: -0.2200, lng: 35.8500 },
  'timboroa': { lat: 0.0400, lng: 35.5300 },
  'eldoret': { lat: 0.5143, lng: 35.2698 },
  'eldoret junction': { lat: 0.5143, lng: 35.2698 },
  'kericho': { lat: -0.3689, lng: 35.2863 },
  'kisumu': { lat: -0.0917, lng: 34.7680 },
  'kakamega': { lat: 0.2827, lng: 34.7519 },

  // Mombasa Coastal Corridor (A109)
  'athiriver': { lat: -1.4500, lng: 36.9800 },
  'machakos': { lat: -1.5177, lng: 37.2634 },
  'machakos junction': { lat: -1.5300, lng: 37.1000 },
  'emali': { lat: -2.0700, lng: 37.4600 },
  'sultan hamud': { lat: -2.0200, lng: 37.3800 },
  'makindu': { lat: -2.2800, lng: 37.8200 },
  'kibwezi': { lat: -2.4200, lng: 37.9700 },
  'mtito andei': { lat: -2.6900, lng: 38.1670 },
  'manyani': { lat: -3.0700, lng: 38.4800 },
  'voi': { lat: -3.3960, lng: 38.5560 },
  'voi junction': { lat: -3.3960, lng: 38.5560 },
  'maungu': { lat: -3.5600, lng: 38.7500 },
  'mackinnon road': { lat: -3.7300, lng: 39.0400 },
  'samburu': { lat: -3.7800, lng: 39.2700 },
  'mariakani': { lat: -3.8600, lng: 39.4700 },
  'mazeras': { lat: -3.9600, lng: 39.5400 },
  'changamwe': { lat: -4.0200, lng: 39.6300 },
  'mombasa': { lat: -4.0435, lng: 39.6682 },
  'mombasa terminal': { lat: -4.0435, lng: 39.6682 },
  'malindi': { lat: -3.2192, lng: 40.1169 },
  'diani': { lat: -4.2797, lng: 39.5936 },
  'ukunda': { lat: -4.2869, lng: 39.5664 },

  // Mt Kenya & Thika Superhighway Corridor
  'roysambu': { lat: -1.2185, lng: 36.8876 },
  'kahawa': { lat: -1.1824, lng: 36.9298 },
  'ruiru': { lat: -1.1444, lng: 36.9583 },
  'juja': { lat: -1.1026, lng: 37.0132 },
  'thika': { lat: -1.0333, lng: 37.0694 },
  'kenol': { lat: -0.9230, lng: 37.1230 },
  'muranga': { lat: -0.7211, lng: 37.1526 },
  'sagana': { lat: -0.6653, lng: 37.2025 },
  'karatina': { lat: -0.4833, lng: 37.1167 },
  'nyeri': { lat: -0.4197, lng: 36.9511 },
  'nanyuki': { lat: 0.0167, lng: 37.0722 },
  'meru': { lat: 0.0463, lng: 37.6559 },
  'embu': { lat: -0.5388, lng: 37.4593 },

  // South Rift & Western Border Corridors
  'mai mahiu': { lat: -0.9897, lng: 36.5861 },
  'narok': { lat: -1.0783, lng: 35.8601 },
  'bomet': { lat: -0.7813, lng: 35.3416 },
  'kisii': { lat: -0.6817, lng: 34.7667 },
  'homa bay': { lat: -0.5273, lng: 34.4571 },
  'migori': { lat: -1.0634, lng: 34.4731 },
  'kitale': { lat: 1.0157, lng: 35.0062 },
  'bungoma': { lat: 0.5695, lng: 34.5584 },
  'malaba': { lat: 0.6333, lng: 34.2833 },
  'busia': { lat: 0.4608, lng: 34.1115 },
  'mumias': { lat: 0.3344, lng: 34.4875 },
  'siaya': { lat: 0.0607, lng: 34.2881 },
};

/**
 * Normalizes station names for fuzzy lookup.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(the|at)\s+/i, '')
    .replace(/\s+(stage|station|stop|terminal|express|junction|hub|depot)$/i, '')
    .trim();
}

/**
 * Finds known coordinates for a stop name, or matches substring.
 */
export function lookupStopCoords(stopName: string): LatLng | null {
  const norm = normalizeName(stopName);
  if (KNOWN_STATION_COORDS[norm]) return KNOWN_STATION_COORDS[norm];

  // Try exact raw match
  const rawKey = stopName.trim().toLowerCase();
  if (KNOWN_STATION_COORDS[rawKey]) return KNOWN_STATION_COORDS[rawKey];

  // Fuzzy substring match
  for (const [key, coords] of Object.entries(KNOWN_STATION_COORDS)) {
    if (rawKey.includes(key) || key.includes(norm)) {
      return coords;
    }
  }

  return null;
}

/**
 * Haversine formula to compute great-circle distance between two points in kilometers.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371; // Earth radius in km
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

/**
 * Given an array of raw stops with order, resolves coordinates for every stop,
 * interpolating any unknown stops along the route trajectory.
 */
export function resolveRouteGeoStops(
  stops: { id?: number; stop_name: string; stop_order: number }[]
): GeoStop[] {
  if (!stops || stops.length === 0) return [];

  const sorted = [...stops].sort((a, b) => a.stop_order - b.stop_order);

  // First pass: direct lookup
  const initial = sorted.map((s) => ({
    id: s.id,
    stop_name: s.stop_name,
    stop_order: s.stop_order,
    coords: lookupStopCoords(s.stop_name),
  }));

  // Find known endpoints or fallback defaults
  const defaultOrigin: LatLng = { lat: -1.286389, lng: 36.817223 }; // Nairobi
  const defaultDest: LatLng = { lat: -0.3031, lng: 36.0800 }; // Nakuru

  const firstKnown = initial.find((s) => s.coords !== null)?.coords || defaultOrigin;
  const lastKnown = [...initial].reverse().find((s) => s.coords !== null)?.coords || defaultDest;

  // Second pass: interpolate missing coordinates proportionally by order
  const n = initial.length;
  return initial.map((s, idx) => {
    if (s.coords) {
      return {
        id: s.id,
        stop_name: s.stop_name,
        stop_order: s.stop_order,
        coords: s.coords,
      };
    }

    const ratio = n > 1 ? idx / (n - 1) : 0.5;
    const interpolated: LatLng = {
      lat: firstKnown.lat + ratio * (lastKnown.lat - firstKnown.lat),
      lng: firstKnown.lng + ratio * (lastKnown.lng - firstKnown.lng),
    };

    return {
      id: s.id,
      stop_name: s.stop_name,
      stop_order: s.stop_order,
      coords: interpolated,
    };
  });
}

/**
 * Formats ETA string from distance in km assuming average highway transit speed.
 */
export function formatETA(distanceKm: number, speedKmH = 65): string {
  if (distanceKm <= 0.5) return 'Arriving Now';
  const hours = distanceKm / speedKmH;
  const totalMins = Math.round(hours * 60);

  if (totalMins < 60) {
    return `${totalMins} mins`;
  }
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return m > 0 ? `${h} hr ${m} mins` : `${h} hr`;
}

/**
 * Calculates current estimated position along the route given current_stop_order.
 */
export function getBusPosition(
  geoStops: GeoStop[],
  currentStopOrder: number | null
): LatLng {
  if (geoStops.length === 0) return { lat: -1.286389, lng: 36.817223 };

  const currentIdx = geoStops.findIndex((s) => s.stop_order === (currentStopOrder ?? 1));
  if (currentIdx === -1) return geoStops[0].coords;

  // If at or beyond last stop
  if (currentIdx >= geoStops.length - 1) {
    return geoStops[geoStops.length - 1].coords;
  }

  // Slight 30% progress along the road towards next stop for visual excitement
  const cur = geoStops[currentIdx].coords;
  const next = geoStops[currentIdx + 1].coords;
  return {
    lat: cur.lat + 0.3 * (next.lat - cur.lat),
    lng: cur.lng + 0.3 * (next.lng - cur.lng),
  };
}

/**
 * Calculates compass bearing (0 - 360 degrees) between two geographic coordinates.
 */
export function calculateBearing(start: LatLng, end: LatLng): number {
  const startLat = (start.lat * Math.PI) / 180;
  const startLng = (start.lng * Math.PI) / 180;
  const endLat = (end.lat * Math.PI) / 180;
  const endLng = (end.lng * Math.PI) / 180;

  const dLng = endLng - startLng;
  const y = Math.sin(dLng) * Math.cos(endLat);
  const x =
    Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(dLng);

  let brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

