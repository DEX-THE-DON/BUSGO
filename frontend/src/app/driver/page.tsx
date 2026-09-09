'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import RequireRole from '@/components/RequireRole';
import SeatGrid, { SeatState } from '@/components/SeatGrid';
import ChainView from '@/components/ChainView';
import LiveTransitMap from '@/components/LiveTransitMap';
import DriverCameraScanner from '@/components/driver/DriverCameraScanner';
import MzigoManifest from '@/components/driver/MzigoManifest';
import FluxDashboardShell, { FluxNavGroup } from '@/components/dashboard/FluxDashboardShell';
import { downloadCSV, printPoliceManifest } from '@/lib/export';
import { resolveRouteGeoStops, calculateBearing } from '@/lib/geo';
import { FluxMetric } from '@/components/dashboard/FluxWidgets';
import PrintableTicketModal, { TicketData } from '@/components/user/PrintableTicketModal';
import OfflineSyncIndicator from '@/components/driver/OfflineSyncIndicator';
import ConductorAudioPanel from '@/components/driver/ConductorAudioPanel';
import DriverIncidentReportModal from '@/components/driver/DriverIncidentReportModal';
import { announceTicketVerified, announceStageArrival } from '@/lib/conductorVoice';
import {
  saveManifestOffline,
  getCachedManifest,
  validateOfflineTicket,
} from '@/lib/offlineStore';
import {
  IconTrip,
  IconUsers,
  IconFleet,
  IconRoute,
  IconZap,
  IconActivity,
} from '@/components/dashboard/FluxIcons';
import {
  fetchTripStops,
  fetchSeatMap,
  fetchTripChains,
  bookSeatData,
  fetchDriverTrips,
  fetchManifest,
  updateTripStatus,
  setCurrentStop,
  boardPassenger,
  updateDriverTier,
  sendTripGps,
  fetchDriverVehicles,
  registerDriverVehicle,
  assignTripVehicle,
  fetchVehicleTypes,
  Vehicle,
  VehicleType,
  TripRow,
  ManifestEntry,
  TripStop,
  ChainLink,
  errMsg,
  wsBaseUrl,
} from '@/services/api';

const TRIP_STATUSES = ['scheduled', 'boarding', 'in_transit', 'completed'];

type DriverTab = 'control' | 'manifest' | 'mzigo' | 'trips' | 'vehicles';

export default function DriverPage() {
  const [tab, setTab] = useState<DriverTab>('control');
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [tripId, setTripId] = useState<number>(0);
  const [tripStatus, setTripStatus] = useState<string>('scheduled');
  const [manifest, setManifest] = useState<ManifestEntry[]>([]);
  const [stops, setStops] = useState<TripStop[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [boardStop, setBoardStop] = useState<number>(1);
  const [alightStop, setAlightStop] = useState<number>(4);
  const [seatStates, setSeatStates] = useState<Record<number, SeatState>>({});
  const [chains, setChains] = useState<{ seat_number: number; links: ChainLink[] }[]>([]);
  const [currentStop, setCurrentStopVal] = useState<number | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [message, setMessage] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [showMpesaModal, setShowMpesaModal] = useState<boolean>(false);
  const [isPaying, setIsPaying] = useState<boolean>(false);
  const [updatingTier, setUpdatingTier] = useState<boolean>(false);
  const [showIncidentModal, setShowIncidentModal] = useState<boolean>(false);

  // Real-time GPS Broadcaster & Drive Simulation
  const [isBroadcastingGps, setIsBroadcastingGps] = useState<boolean>(false);
  const [isSimulatingDrive, setIsSimulatingDrive] = useState<boolean>(false);
  const [gpsTelemetry, setGpsTelemetry] = useState<{
    lat: number;
    lng: number;
    speed: number | null;
    heading: number | null;
    lastSync: string | null;
  } | null>(null);
  const [gpsError, setGpsError] = useState<string>('');

  // Digital Ticket Scanner & Passenger Boarding state
  const [boardingLoadingId, setBoardingLoadingId] = useState<number | null>(null);
  const [scanCode, setScanCode] = useState<string>('');
  const [scanResult, setScanResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);
  const [printableTicket, setPrintableTicket] = useState<TicketData | null>(null);
  const [isSimulatedOffline, setIsSimulatedOffline] = useState<boolean>(false);

  // Driver Fleet & Vehicle Registration state
  const [driverVehicles, setDriverVehicles] = useState<Vehicle[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [showRegVehicleModal, setShowRegVehicleModal] = useState(false);
  const [regPlate, setRegPlate] = useState('');
  const [regPurpose, setRegPurpose] = useState<'cargo' | 'people'>('cargo');
  const [regBodyType, setRegBodyType] = useState('canter_lorry');
  const [regTonnage, setRegTonnage] = useState<number>(3.5);
  const [regSeatCapacity, setRegSeatCapacity] = useState<number>(14);
  const [regElectric, setRegElectric] = useState(false);
  const [regYear, setRegYear] = useState<string>('2022');
  const [regChassis, setRegChassis] = useState<string>('');
  const [isRegisteringVehicle, setIsRegisteringVehicle] = useState(false);
  const [assigningVehicleId, setAssigningVehicleId] = useState<number | null>(null);
  const [vehicleFilter, setVehicleFilter] = useState<'all' | 'cargo' | 'passenger'>('all');

  const showNotice = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(''), 4000);
  };

  const handleBoardPassenger = async (bookingId?: number) => {
    if (!bookingId || !tripId) return;
    setBoardingLoadingId(bookingId);
    setScanResult(null);

    const isOfflineMode = isSimulatedOffline || (typeof navigator !== 'undefined' && !navigator.onLine);

    if (isOfflineMode) {
      try {
        const offRes = await validateOfflineTicket(tripId, bookingId);
        if (offRes.success) {
          setManifest((prev) =>
            prev.map((m) => ((m as { booking_id?: number }).booking_id === bookingId ? { ...m, status: 'boarded' } : m))
          );
          showNotice(offRes.message);
          setScanResult({ success: true, message: offRes.message });
        } else {
          setScanResult({ success: false, message: offRes.message });
        }
      } catch (err: unknown) {
        setScanResult({ success: false, message: errMsg(err) });
      } finally {
        setBoardingLoadingId(null);
      }
      return;
    }

    try {
      const res = await boardPassenger(tripId, { bookingId });
      setManifest((prev) =>
        prev.map((m) => ((m as { booking_id?: number }).booking_id === bookingId ? { ...m, status: 'boarded' } : m))
      );
      showNotice(res.message || 'Passenger checked in & boarded!');
      setScanResult({ success: true, message: res.message || 'Passenger checked in & boarded!' });
      announceTicketVerified((res as { seat_number?: number }).seat_number || bookingId);
    } catch (err: unknown) {
      // Automatic fallback to offline store if network fails
      try {
        const offRes = await validateOfflineTicket(tripId, bookingId);
        if (offRes.success) {
          setManifest((prev) =>
            prev.map((m) => ((m as { booking_id?: number }).booking_id === bookingId ? { ...m, status: 'boarded' } : m))
          );
          showNotice(`⚡ Dead Zone Mode — ${offRes.message}`);
          setScanResult({ success: true, message: `⚡ Dead Zone Mode — ${offRes.message}` });
          announceTicketVerified(offRes.seatNumber || bookingId);
          return;
        }
      } catch {}
      setError(errMsg(err));
      setScanResult({ success: false, message: errMsg(err) });
    } finally {
      setBoardingLoadingId(null);
    }
  };

  const processTicketCode = async (codeToVerify: string) => {
    if (!tripId || !codeToVerify.trim()) return;
    const isOfflineMode = isSimulatedOffline || (typeof navigator !== 'undefined' && !navigator.onLine);

    if (isOfflineMode) {
      try {
        const offRes = await validateOfflineTicket(tripId, codeToVerify.trim());
        if (offRes.success) {
          setManifest((prev) =>
            prev.map((m) =>
              (m as { booking_id?: number }).booking_id === offRes.passenger?.booking_id || m.seat_number === offRes.seatNumber
                ? { ...m, status: 'boarded' }
                : m
            )
          );
          showNotice(offRes.message);
          setScanResult({ success: true, message: offRes.message });
          setScanCode('');
        } else {
          setScanResult({ success: false, message: offRes.message });
        }
      } catch (err: unknown) {
        setScanResult({ success: false, message: errMsg(err) });
      }
      return;
    }

    try {
      setScanResult(null);
      const res = await boardPassenger(tripId, { ticketCode: codeToVerify.trim() });
      setManifest((prev) =>
        prev.map((m) =>
          (m as { booking_id?: number }).booking_id === res.booking_id || m.seat_number === res.seat_number
            ? { ...m, status: 'boarded' }
            : m
        )
      );
      showNotice(res.message || `Seat #${res.seat_number} boarded successfully!`);
      setScanResult({ success: true, message: res.message || `Seat #${res.seat_number} boarded successfully!` });
      setScanCode('');
      announceTicketVerified(res.seat_number);
    } catch (err: unknown) {
      // Fallback to offline store if network fails
      try {
        const offRes = await validateOfflineTicket(tripId, codeToVerify.trim());
        if (offRes.success) {
          setManifest((prev) =>
            prev.map((m) =>
              (m as { booking_id?: number }).booking_id === offRes.passenger?.booking_id || m.seat_number === offRes.seatNumber
                ? { ...m, status: 'boarded' }
                : m
            )
          );
          showNotice(`⚡ Highway Dead Zone — ${offRes.message}`);
          setScanResult({ success: true, message: `⚡ Highway Dead Zone — ${offRes.message}` });
          setScanCode('');
          announceTicketVerified(offRes.seatNumber || 1);
          return;
        }
      } catch {}
      setScanResult({ success: false, message: errMsg(err) || 'Invalid ticket code or booking not found for this trip.' });
    }
  };

  const handleScanVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await processTicketCode(scanCode);
  };

  const handleCameraScannedCode = async (code: string) => {
    setScanCode(code);
    await processTicketCode(code);
  };

  // Load the driver's assigned trips (or all trips, for admins).
  useEffect(() => {
    const t = window.setTimeout(() => {
      fetchDriverTrips()
        .then((data) => {
          setTrips(data.trips);
          if (data.trips.length > 0) setTripId(data.trips[0].id);
        })
        .catch((err: unknown) => setError(errMsg(err)));
      // Load driver's registered vehicles and catalog
      fetchDriverVehicles()
        .then((vData) => setDriverVehicles(vData.vehicles))
        .catch(() => {});
      fetchVehicleTypes()
        .then((vtData) => setVehicleTypes(vtData.vehicle_types))
        .catch(() => {});
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const loadDriverVehicles = useCallback(async () => {
    setLoadingVehicles(true);
    try {
      const [vRes, vtRes] = await Promise.all([
        fetchDriverVehicles(),
        fetchVehicleTypes(),
      ]);
      setDriverVehicles(vRes.vehicles);
      setVehicleTypes(vtRes.vehicle_types);
    } catch (err: unknown) {
      setError(errMsg(err) || 'Failed to load driver vehicles.');
    } finally {
      setLoadingVehicles(false);
    }
  }, []);

  const handleRegisterVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPlate = regPlate.trim().toUpperCase();
    if (!cleanPlate) {
      setError('Please provide a valid vehicle license plate (e.g. KDA 123A).');
      return;
    }
    setIsRegisteringVehicle(true);
    setError('');
    try {
      const res = await registerDriverVehicle({
        plate_number: cleanPlate,
        purpose: regPurpose === 'cargo' ? 'cargo' : 'passenger',
        body_type: regBodyType,
        cargo_tonnage_capacity: regPurpose === 'cargo' ? Number(regTonnage) : undefined,
        seat_capacity: regPurpose === 'people' ? Number(regSeatCapacity) : 2,
        is_electric: regElectric,
        manufacture_year: regYear ? Number(regYear) : undefined,
        chassis_number: regChassis ? regChassis.trim().toUpperCase() : undefined,
      });
      showNotice(`✓ ${res.message}`);
      setShowRegVehicleModal(false);
      setRegPlate('');
      setRegChassis('');
      await loadDriverVehicles();
    } catch (err: unknown) {
      setError(errMsg(err) || 'Vehicle registration failed.');
    } finally {
      setIsRegisteringVehicle(false);
    }
  };

  const handleAssignVehicleToTrip = async (vehicleId: number) => {
    if (!tripId) {
      setError('Please select an active trip first before assigning a vehicle.');
      return;
    }
    setAssigningVehicleId(vehicleId);
    setError('');
    try {
      const res = await assignTripVehicle(tripId, vehicleId);
      showNotice(`✓ ${res.message}`);
      // Refresh trips and vehicles
      const tripsData = await fetchDriverTrips();
      setTrips(tripsData.trips);
      await loadDriverVehicles();
    } catch (err: unknown) {
      setError(errMsg(err) || 'Failed to assign vehicle to trip.');
    } finally {
      setAssigningVehicleId(null);
    }
  };

  const currentTrip = trips.find((t) => t.id === tripId);
  const isDirect = currentTrip?.route_type === 'direct';

  const loadTrip = useCallback(
    (id: number) => {
      if (!id) return;
      Promise.all([
        fetchTripStops(id),
        fetchManifest(id),
        fetchSeatMap(id, boardStop, alightStop),
        fetchTripChains(id),
      ])
        .then(([stopsRes, manifestRes, mapRes, chainsRes]) => {
          setStops(stopsRes.stops);
          setManifest(manifestRes.manifest);
          const states: Record<number, SeatState> = {};
          mapRes.seats.forEach((s) => (states[s.seat_number] = s.state));
          setSeatStates(states);
          setChains(chainsRes.chains);
          setError('');

          // Auto-cache to IndexedDB for offline highway resilience
          const matchingTrip = trips.find((t) => t.id === id) || currentTrip;
          saveManifestOffline(
            id,
            { name: matchingTrip?.name, plate_number: matchingTrip?.plate_number, route_name: matchingTrip?.route_name },
            manifestRes.manifest.map((m) => ({
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
            }))
          ).catch(() => {});
        })
        .catch(async (err: unknown) => {
          // If network failed, check IndexedDB offline cache
          try {
            const cached = await getCachedManifest(id);
            if (cached && cached.passengers.length > 0) {
              setManifest(cached.passengers as ManifestEntry[]);
              showNotice(`⚡ Loaded Trip #${id} from offline highway cache (${cached.passengers.length} passengers).`);
              return;
            }
          } catch {}
          setError(errMsg(err));
        });
    },
    [boardStop, alightStop, trips, currentTrip],
  );

  // When the selected trip changes, load its stops / manifest / seats.
  useEffect(() => {
    loadTrip(tripId);
  }, [tripId, loadTrip]);
  const selectedChain = chains.find((c) => c.seat_number === selectedSeat);

  // Refresh seat states when board/alight segment changes.
  useEffect(() => {
    if (boardStop < alightStop && tripId) {
      fetchSeatMap(tripId, boardStop, alightStop)
        .then((mapRes) => {
          const states: Record<number, SeatState> = {};
          mapRes.seats.forEach((s) => (states[s.seat_number] = s.state));
          setSeatStates(states);
        })
        .catch((err: unknown) => setError(errMsg(err)));
    }
  }, [boardStop, alightStop, tripId]);

  // WebSocket listener for live seat updates on the selected trip.
  useEffect(() => {
    if (!tripId) return;
    const ws = new WebSocket(`${wsBaseUrl()}/ws/trip/${tripId}`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'seat_booked' && data.trip_id === tripId) {
          fetchSeatMap(tripId, boardStop, alightStop)
            .then((mapRes) => {
              const states: Record<number, SeatState> = {};
              mapRes.seats.forEach((s) => (states[s.seat_number] = s.state));
              setSeatStates(states);
            });
          fetchTripChains(tripId).then((res) => setChains(res.chains));
          fetchManifest(tripId).then((res) => setManifest(res.manifest));
        }
        if (data.event === 'trip_status' && data.trip_id === tripId) {
          setTripStatus(data.status);
          showNotice(`Trip status updated: ${data.status}`);
        }
        if (data.event === 'seat_freed' && data.trip_id === tripId) {
          showNotice(`Seat #${data.seat_number} freed at ${data.stop_name ?? `stop ${data.stop_order}`}`);
          fetchSeatMap(tripId, boardStop, alightStop)
            .then((mapRes) => {
              const states: Record<number, SeatState> = {};
              mapRes.seats.forEach((s) => (states[s.seat_number] = s.state));
              setSeatStates(states);
            });
          fetchTripChains(tripId).then((res) => setChains(res.chains));
        }
        if (data.event === 'passenger_boarded') {
          setManifest((prev) =>
            prev.map((m) =>
              (m as { booking_id?: number }).booking_id === data.booking_id || m.seat_number === data.seat_number
                ? { ...m, status: 'boarded' }
                : m
            )
          );
          showNotice(`Seat #${data.seat_number} boarded.`);
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    return () => {
      ws.close();
    };
  }, [tripId, boardStop, alightStop]);

  // Initialize GPS Telemetry from currentTrip if present
  useEffect(() => {
    if (currentTrip && currentTrip.current_lat != null && currentTrip.current_lng != null) {
      setGpsTelemetry({
        lat: currentTrip.current_lat,
        lng: currentTrip.current_lng,
        speed: currentTrip.current_speed ?? null,
        heading: currentTrip.current_heading ?? null,
        lastSync: currentTrip.last_gps_at ?? null,
      });
    }
  }, [
    currentTrip?.id,
    currentTrip?.current_lat,
    currentTrip?.current_lng,
    currentTrip?.current_speed,
    currentTrip?.current_heading,
    currentTrip?.last_gps_at,
  ]);

  // 1. Live Device GPS Tracking via navigator.geolocation.watchPosition
  useEffect(() => {
    if (!isBroadcastingGps || !tripId) return;

    if (!('geolocation' in navigator)) {
      setGpsError('Geolocation is not supported by your browser.');
      setIsBroadcastingGps(false);
      return;
    }

    setGpsError('');
    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const speed = position.coords.speed != null ? Math.round(position.coords.speed * 3.6) : null;
        const heading = position.coords.heading != null ? Math.round(position.coords.heading) : null;
        const lastSync = new Date().toLocaleTimeString();

        setGpsTelemetry({ lat, lng, speed, heading, lastSync });

        try {
          await sendTripGps(tripId, { lat, lng, speed, heading });
        } catch (err) {
          console.warn('GPS broadcast failed:', err);
        }
      },
      (error) => {
        setGpsError(error.message || 'GPS location error.');
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 10000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [isBroadcastingGps, tripId]);

  // 2. Desk Testing Highway Simulation Drive
  // Interpolates coordinates smoothly along the route stops every 1.8s
  useEffect(() => {
    if (!isSimulatingDrive || !tripId || stops.length < 2) return;

    const geoStops = resolveRouteGeoStops(stops);
    if (geoStops.length < 2) return;

    let step = 0;
    const totalStepsPerLeg = 8;
    let currentLeg = 0;

    const interval = window.setInterval(async () => {
      if (currentLeg >= geoStops.length - 1) {
        currentLeg = 0;
        step = 0;
      }

      const fromStop = geoStops[currentLeg];
      const toStop = geoStops[currentLeg + 1];

      step += 1;
      const progress = step / totalStepsPerLeg;

      const lat = fromStop.coords.lat + progress * (toStop.coords.lat - fromStop.coords.lat);
      const lng = fromStop.coords.lng + progress * (toStop.coords.lng - fromStop.coords.lng);
      const heading = Math.round(calculateBearing(fromStop.coords, toStop.coords));
      const speed = Math.round(68 + Math.sin(step) * 12);
      const lastSync = new Date().toLocaleTimeString();

      setGpsTelemetry({ lat, lng, speed, heading, lastSync });

      try {
        await sendTripGps(tripId, { lat, lng, speed, heading });
      } catch (err) {
        console.warn('Simulation GPS push error:', err);
      }

      if (step >= totalStepsPerLeg) {
        currentLeg += 1;
        step = 0;
        const nextOrder = toStop.stop_order;
        setCurrentStopVal(nextOrder);
        try {
          await setCurrentStop(tripId, nextOrder);
          showNotice(`Vehicle arrived at ${toStop.stop_name}`);
        } catch {
          // ignore
        }
      }
    }, 1800);

    return () => {
      window.clearInterval(interval);
    };
  }, [isSimulatingDrive, tripId, stops]);

  const handleChangeStatus = async (next: string) => {
    if (!tripId || next === tripStatus) return;
    try {
      await updateTripStatus(tripId, next);
      setTripStatus(next);
      showNotice(`Trip #${tripId} is now ${next}.`);
    } catch (err: unknown) {
      setError(errMsg(err));
    }
  };

  const handleCurrentStop = async (stopOrder: number) => {
    if (!tripId || stopOrder === currentStop) return;
    try {
      const res = await setCurrentStop(tripId, stopOrder);
      setCurrentStopVal(stopOrder);
      const stp = stops.find((s) => s.stop_order === stopOrder);
      if (stp) {
        announceStageArrival(stp.stop_name);
      }
      showNotice(
        `Bus is at stop #${stopOrder} — ${res.released_seats} seat(s) released.` +
          (res.released_seats > 0 ? ' Next passengers have been notified.' : ''),
      );
      const chainsRes = await fetchTripChains(tripId);
      setChains(chainsRes.chains);
    } catch (err: unknown) {
      setError(errMsg(err));
    }
  };

  const handleDriverTierChange = async (tier: string) => {
    if (!tripId || updatingTier) return;
    setUpdatingTier(true);
    setError('');
    try {
      const res = await updateDriverTier(tripId, tier);
      showNotice(
        `Pricing tier switched to "${tier.replace(/_/g, ' ')}" (${
          res.applied_surcharge_pct > 0 ? `+${res.applied_surcharge_pct}%` : `${res.applied_surcharge_pct}%`
        }).`
      );
      setTrips((prev) =>
        prev.map((t) => (t.id === tripId ? { ...t, driver_tier: tier } : t))
      );
    } catch (err: unknown) {
      setError(errMsg(err));
    } finally {
      setUpdatingTier(false);
    }
  };

  const handleExportManifestCSV = () => {
    if (!manifest || manifest.length === 0) {
      showNotice('Manifest is currently empty.');
      return;
    }
    const headers = [
      'Seat Number',
      'Passenger Name',
      'Phone Number',
      'Boarding Stop',
      'Alighting Stop',
      'Booking Status',
      'Boarding Verification',
      'Payment Status',
    ];
    const rows = manifest.map((m) => [
      m.seat_number,
      m.full_name || 'Passenger',
      m.phone || 'N/A',
      m.board_stop || `Stop ${m.board_stop_order}`,
      m.alight_stop || `Stop ${m.alight_stop_order}`,
      (m as { status?: string }).status || 'confirmed',
      (m as { status?: string }).status === 'boarded' ? 'CHECKED IN' : 'NOT BOARDED',
      (m as { payment_status?: string }).payment_status || 'paid',
    ]);
    const filename = `BUSGO_Manifest_Trip_${tripId}_${currentTrip?.plate_number || 'Fleet'}_${new Date().toISOString().split('T')[0]}`;
    downloadCSV(filename, headers, rows);
    showNotice(`Manifest exported as ${filename}.csv`);
  };

  const handlePrintManifest = () => {
    if (!manifest || manifest.length === 0) {
      showNotice('Manifest is currently empty.');
      return;
    }
    printPoliceManifest({
      tripName: currentTrip?.name || `Trip #${tripId}`,
      routeName: currentTrip?.route_name || 'Transit Corridor',
      vehiclePlate: currentTrip?.plate_number || 'KDA 451B',
      driverName: 'Assigned Driver',
      departureTime: currentTrip?.scheduled_at ? new Date(currentTrip.scheduled_at).toLocaleString('en-KE') : 'Scheduled Service',
      passengers: manifest.map((m) => ({
        seat_number: m.seat_number,
        passenger_name: m.full_name || 'Passenger',
        phone: m.phone || '—',
        board_stop: m.board_stop || `Stop ${m.board_stop_order}`,
        alight_stop: m.alight_stop || `Stop ${m.alight_stop_order}`,
        status: (m as { status?: string }).status || 'confirmed',
      })),
    });
  };

  const handleBookingTrigger = () => {
    if (!selectedSeat) return;
    setShowMpesaModal(true);
  };

  const confirmMpesaPayment = async () => {
    if (!selectedSeat || isPaying) return;
    setIsPaying(true);
    setMessage('');
    try {
      // 1. Create the booking FIRST, then pay for the returned booking_id.
      const bookingRes = await bookSeatData({
        trip_id: tripId,
        seat_number: selectedSeat,
        board_stop_order: boardStop,
        alight_stop_order: alightStop,
      });
      const bookingId = bookingRes.booking_id;

      // 2. Simulated M-Pesa STK push for that exact booking.
      const paymentRes = await fetch('http://127.0.0.1:8000/api/pay/mpesa-stk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: phone, amount: 500, booking_id: bookingId }),
      });
      const paymentData = await paymentRes.json();
      if (!paymentRes.ok) {
        throw new Error(paymentData.detail || `Payment failed (HTTP ${paymentRes.status})`);
      }

      setMessage(`${paymentData.message} | Booking #${bookingId} confirmed.`);
      setShowMpesaModal(false);

      const boardStopName = stops.find((s) => s.stop_order === boardStop)?.stop_name || `Stop ${boardStop}`;
      const alightStopName = stops.find((s) => s.stop_order === alightStop)?.stop_name || `Stop ${alightStop}`;
      setPrintableTicket({
        bookingId: bookingId,
        tripId: tripId,
        passengerName: 'Walk-up Passenger',
        passengerPhone: phone,
        seatNumber: selectedSeat,
        routeName: currentTrip?.route_name ?? currentTrip?.name ?? 'Transit Corridor',
        boardStop: boardStopName,
        alightStop: alightStopName,
        vehiclePlate: currentTrip?.plate_number,
        fareAmount: 500,
        receiptNumber: paymentData.mpesa_receipt || `MP${Date.now().toString().slice(-8)}`,
        paymentStatus: 'paid',
        qrData: `BUSGO:${bookingId}:${tripId}:${selectedSeat}`,
      });

      setSelectedSeat(null);

      const mapRes = await fetchSeatMap(tripId, boardStop, alightStop);
      const states: Record<number, SeatState> = {};
      mapRes.seats.forEach((s) => (states[s.seat_number] = s.state));
      setSeatStates(states);
      const manifestRes = await fetchManifest(tripId);
      setManifest(manifestRes.manifest);
      const chainsRes = await fetchTripChains(tripId);
      setChains(chainsRes.chains);
    } catch (err: unknown) {
      setMessage(errMsg(err) || 'Booking/payment failed');
    } finally {
      setIsPaying(false);
    }
  };

  const navGroups: FluxNavGroup[] = [
    {
      title: 'OVERVIEW',
      items: [
        { id: 'control', label: 'Trip Operations', icon: <IconTrip /> },
        { id: 'manifest', label: 'Passenger Manifest', icon: <IconUsers />, badge: manifest.length },
        { id: 'mzigo', label: 'Mzigo & Cargo Manifest', icon: <IconTrip />, badge: 'Cargo' },
        { id: 'trips', label: 'Assigned Trips', icon: <IconFleet />, badge: trips.length },
        { id: 'vehicles', label: 'My Fleet & Vehicles', icon: <IconFleet />, badge: driverVehicles.length },
      ],
    },
  ];

  const metrics: FluxMetric[] = [
    {
      label: 'MANIFEST PASSENGERS',
      value: `${manifest.length}`,
      change: `${manifest.length} passengers booked`,
      trend: 'up',
      icon: <IconUsers className="w-3.5 h-3.5" />,
    },
    {
      label: 'ACTIVE CORRIDOR',
      value: currentTrip?.route_name || 'Direct Route',
      change: `${stops.length} scheduled stops`,
      trend: 'up',
      icon: <IconRoute className="w-3.5 h-3.5" />,
    },
    {
      label: 'RELAY SEAT CHAINS',
      value: `${chains.length}`,
      change: 'Dynamic partial legs',
      trend: 'up',
      icon: <IconZap className="w-3.5 h-3.5" />,
    },
    {
      label: 'DISPATCH STATUS',
      value: (currentTrip?.status ?? tripStatus).toUpperCase(),
      change: currentTrip?.plate_number ?? 'Fleet Unit',
      trend: 'up',
      icon: <IconActivity className="w-3.5 h-3.5" />,
    },
  ];

  return (
    <RequireRole roles={['driver', 'admin']}>
      <FluxDashboardShell
        activeTab={tab}
        onTabChange={(t) => setTab(t as DriverTab)}
        navGroups={navGroups}
        metrics={metrics}
        heroGreeting="Good morning"
        heroSubtitle={`BusGo Driver Console — Active on ${currentTrip?.name || 'Assigned Transit Service'}`}
        primaryAction={{
          label: '+ Book Walk-up',
          onClick: () => {
            setTab('control');
            const el = document.getElementById('walkup-section');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          },
        }}
        searchPlaceholder="Search passenger, seat #, or stop..."
      >
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm font-bold rounded-2xl px-5 py-4">
            {error}
          </div>
        )}
        {notice && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-bold rounded-2xl px-5 py-4">
            {notice}
          </div>
        )}

          {trips.length === 0 ? (
            <div className="bg-slate-900 p-10 rounded-2xl border border-slate-800 text-center">
              <p className="text-slate-400 mb-3">No trips assigned to you yet.</p>
              <Link href="/admin" className="text-emerald-400 font-bold hover:underline">
                Ask an admin to assign you a trip →
              </Link>
            </div>
          ) : (
            <>
              {/* Trip selector + status */}
              <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
                <div className="flex flex-wrap gap-4 items-end">
                  <div className="flex-1 min-w-[260px]">
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Assigned Trips</label>
                    <select
                      value={tripId}
                      onChange={(e) => setTripId(Number(e.target.value))}
                      className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-cyan-500"
                    >
                      {trips.map((t) => (
                        <option key={t.id} value={t.id}>
                          #{t.id} · {t.name} — {t.route_name} ({t.plate_number ?? 'no vehicle'})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Trip Status</label>
                    <div className="flex flex-wrap gap-2">
                      {TRIP_STATUSES.map((s) => (
                        <button
                          key={s}
                          onClick={() => handleChangeStatus(s)}
                          disabled={s === tripStatus}
                          className={`px-3 py-2 rounded-xl text-xs font-bold capitalize transition ${
                            s === tripStatus
                              ? 'bg-cyan-500 text-slate-950'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Road Hazard / SOS</label>
                    <button
                      type="button"
                      onClick={() => setShowIncidentModal(true)}
                      className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white transition shadow-lg flex items-center gap-1.5"
                    >
                      <span>🚨</span>
                      Report Hazard / Delay
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-3">
                  Current status:{' '}
                  <span className="text-cyan-300 font-bold capitalize">{currentTrip?.status ?? tripStatus}</span>
                </p>

                {/* Admin-Governed Operational Pricing Control */}
                {currentTrip && (
                  <div className="mt-4 pt-4 border-t border-slate-800/80">
                    {currentTrip.allow_driver_tier ? (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                              <span>⚡ Operational Pricing Tier (Admin Authorized)</span>
                            </span>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              Admin policy permits you to set operational surge/discount up to a ceiling of{' '}
                              <strong className="text-amber-300">+{currentTrip.max_surcharge_pct}%</strong>.
                            </p>
                          </div>
                          <span className="text-xs bg-amber-500/10 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-full font-bold">
                            Active Tier: {(currentTrip.driver_tier || 'standard').replace(/_/g, ' ')}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {[
                            { id: 'off_peak', label: 'Off-Peak', mult: '-10%', note: 'Off-peak commuter discount' },
                            { id: 'standard', label: 'Standard', mult: '0% (Base)', note: 'Regular operating fare' },
                            { id: 'peak_rush', label: 'Peak Rush', mult: '+15%', note: 'Rush hour demand' },
                            { id: 'rush_hour_rain', label: 'Rain / Storm', mult: '+25%', note: 'Severe weather / gridlock' },
                          ].map((tier) => {
                            const isSelected = (currentTrip.driver_tier || 'standard') === tier.id;
                            return (
                              <button
                                key={tier.id}
                                type="button"
                                disabled={updatingTier}
                                onClick={() => handleDriverTierChange(tier.id)}
                                className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                                  isSelected
                                    ? 'bg-amber-500/20 border-amber-500 text-white ring-1 ring-amber-500'
                                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                                }`}
                              >
                                <div className="flex justify-between items-center w-full mb-1">
                                  <span className="text-xs font-bold">{tier.label}</span>
                                  <span
                                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                      isSelected ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'
                                    }`}
                                  >
                                    {tier.mult}
                                  </span>
                                </div>
                                <span className="text-[10px] text-slate-500">{tier.note}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-950/60 rounded-xl border border-slate-800/80">
                        <div className="flex items-center gap-2">
                          <span className="text-xs bg-slate-800 text-slate-300 font-bold px-2 py-0.5 rounded-full border border-slate-700">
                            🔒 Fixed Admin Pricing Policy
                          </span>
                          <span className="text-xs text-slate-400">
                            {currentTrip.fixed_price != null
                              ? `Express Flat Rate: KES ${currentTrip.fixed_price}`
                              : 'Route stop-to-stop matrix & base fares are governed by Admin. Driver tier adjustment is locked.'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* TAB: CONTROL — Interactive Live Transit Map Corridor & GPS Telemetry */}
              {tab === 'control' && tripId && stops.length > 0 && !isDirect && (
                <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
                          <span>Interactive Live Route Corridor & Real-Time Tracking</span>
                        </h4>
                        <p className="text-xs text-slate-400 mt-1">
                          Stream live coordinates to passenger tracking maps or click any stop along the corridor to report arrival.
                        </p>
                      </div>
                    </div>

                    {/* In-Cab Conductor Audio Synthesizer Panel */}
                    <ConductorAudioPanel
                      currentStopName={stops.find((s) => s.stop_order === currentStop)?.stop_name}
                      nextStopName={stops.find((s) => s.stop_order === (currentStop ? currentStop + 1 : 2))?.stop_name}
                      destinationName={stops[stops.length - 1]?.stop_name}
                      routeName={currentTrip?.route_name || currentTrip?.name || 'Corridor Route'}
                    />

                    {/* Driver Live GPS Telemetry Transmitter Widget */}
                    <div className="rounded-2xl border border-cyan-500/30 bg-slate-950/80 p-4 shadow-lg backdrop-blur-md space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                              isBroadcastingGps || isSimulatingDrive
                                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 shadow-sm'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            <IconZap className="w-4 h-4" />
                          </div>
                          <div>
                            <h5 className="text-xs font-black uppercase tracking-wide text-white flex items-center gap-2">
                              <span>Satellite GPS Telemetry Transmitter</span>
                              <span
                                className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                  isBroadcastingGps
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    : isSimulatingDrive
                                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                                    : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    isBroadcastingGps || isSimulatingDrive
                                      ? 'bg-emerald-400 animate-ping'
                                      : 'bg-slate-500'
                                  }`}
                                />
                                {isBroadcastingGps
                                  ? 'Broadcasting Live GPS'
                                  : isSimulatingDrive
                                  ? 'Simulation Active'
                                  : 'Standby'}
                              </span>
                            </h5>
                            <p className="text-[11px] text-slate-400">
                              Stream phone coordinates or run an automated highway drive along the corridor stops for desk testing.
                            </p>
                          </div>
                        </div>

                        {/* Toggle Action Buttons */}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (!isBroadcastingGps) {
                                setIsSimulatingDrive(false);
                                setIsBroadcastingGps(true);
                              } else {
                                setIsBroadcastingGps(false);
                              }
                            }}
                            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border shadow-sm ${
                              isBroadcastingGps
                                ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-emerald-500/20'
                                : 'bg-slate-900 text-slate-200 border-slate-700 hover:bg-slate-800 hover:border-slate-600'
                            }`}
                          >
                            <span>📡</span>
                            <span>{isBroadcastingGps ? 'Stop GPS Broadcast' : 'Broadcast Device GPS'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              if (!isSimulatingDrive) {
                                setIsBroadcastingGps(false);
                                setIsSimulatingDrive(true);
                              } else {
                                setIsSimulatingDrive(false);
                              }
                            }}
                            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border shadow-sm ${
                              isSimulatingDrive
                                ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-cyan-500/20'
                                : 'bg-slate-900 text-cyan-300 border-cyan-500/40 hover:bg-slate-800 hover:border-cyan-400'
                            }`}
                          >
                            <span>🚗</span>
                            <span>{isSimulatingDrive ? 'Stop Highway Drive' : 'Simulate Route Drive'}</span>
                          </button>
                        </div>
                      </div>

                      {/* Real-time Telemetry Readout Pills */}
                      {gpsTelemetry && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80">
                          <div className="bg-slate-900/90 rounded-xl p-2 border border-slate-800">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Latitude</span>
                            <span className="font-mono text-xs font-black text-cyan-300">{gpsTelemetry.lat.toFixed(5)}°</span>
                          </div>
                          <div className="bg-slate-900/90 rounded-xl p-2 border border-slate-800">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Longitude</span>
                            <span className="font-mono text-xs font-black text-cyan-300">{gpsTelemetry.lng.toFixed(5)}°</span>
                          </div>
                          <div className="bg-slate-900/90 rounded-xl p-2 border border-slate-800">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Speed</span>
                            <span className="font-mono text-xs font-black text-emerald-400">
                              {gpsTelemetry.speed != null ? `${gpsTelemetry.speed} km/h` : '0 km/h'}
                            </span>
                          </div>
                          <div className="bg-slate-900/90 rounded-xl p-2 border border-slate-800">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Heading / Sync</span>
                            <span className="font-mono text-xs font-black text-amber-300">
                              {gpsTelemetry.heading != null ? `${gpsTelemetry.heading}°` : 'N/A'} · {gpsTelemetry.lastSync || 'Active'}
                            </span>
                          </div>
                        </div>
                      )}

                      {gpsError && (
                        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-300 font-bold">
                          ⚠️ {gpsError}
                        </div>
                      )}
                    </div>

                    <LiveTransitMap
                      tripId={tripId}
                      routeName={currentTrip?.route_name || currentTrip?.name || 'Transit Route'}
                      vehiclePlate={currentTrip?.plate_number}
                      stops={stops}
                      currentStopOrder={currentStop}
                      initialLat={gpsTelemetry?.lat ?? currentTrip?.current_lat}
                      initialLng={gpsTelemetry?.lng ?? currentTrip?.current_lng}
                      initialSpeed={gpsTelemetry?.speed ?? currentTrip?.current_speed}
                      initialHeading={gpsTelemetry?.heading ?? currentTrip?.current_heading}
                      tripStatus={currentTrip?.status ?? tripStatus}
                      isDriverControl={true}
                      onAdvanceStop={(stopOrder) => handleCurrentStop(stopOrder)}
                    />

                    {/* Quick Manual Fallback Buttons */}
                    <div className="pt-2">
                      <label className="block text-[11px] font-bold text-slate-400 uppercase mb-2">
                        Quick Manual Stop Advancement:
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {stops.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => handleCurrentStop(s.stop_order)}
                            disabled={s.stop_order === currentStop}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                              s.stop_order === currentStop
                                ? 'bg-emerald-500 text-slate-950 ring-2 ring-emerald-400'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            {s.stop_name} {s.stop_order === currentStop ? '✓' : ''}
                          </button>
                        ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Manifest & Boarding Station */}
              {tab === 'manifest' && (
                <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                      <span>Passenger Manifest & Digital Boarding</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Verify electronic boarding passes and check in passengers in real time.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Official Manifest & Export Actions */}
                    <button
                      onClick={handleExportManifestCSV}
                      disabled={!manifest || manifest.length === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:pointer-events-none text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition"
                      title="Download CSV spreadsheet"
                    >
                      <span>📥</span>
                      <span>Export CSV</span>
                    </button>
                    <button
                      onClick={handlePrintManifest}
                      disabled={!manifest || manifest.length === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 disabled:opacity-50 disabled:pointer-events-none text-xs font-semibold rounded-lg border border-amber-500/30 transition"
                      title="Print official Police/NTSA road manifest"
                    >
                      <span>🖨️</span>
                      <span>Print Police Manifest</span>
                    </button>

                    {/* Boarding counter metric */}
                    {manifest.length > 0 && (
                      <div className="flex items-center gap-3 bg-slate-950 px-3.5 py-1.5 rounded-xl border border-slate-800">
                        <div className="text-right">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Boarding Progress</span>
                          <span className="text-xs font-mono font-bold text-white">
                            {manifest.filter((m) => (m as { status?: string }).status === 'boarded').length} / {manifest.length} Boarded
                          </span>
                        </div>
                        <div className="w-16 h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-cyan-400 transition-all duration-300"
                            style={{
                              width: `${
                                manifest.length > 0
                                  ? (manifest.filter((m) => (m as { status?: string }).status === 'boarded').length /
                                      manifest.length) *
                                    100
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Offline Highway Mode & Sync Controller */}
                <OfflineSyncIndicator
                  tripId={tripId}
                  currentTrip={currentTrip}
                  manifest={manifest}
                  onSyncComplete={() => loadTrip(tripId)}
                  onSimulateOfflineChange={(simulated) => setIsSimulatedOffline(simulated)}
                />

                {/* Quick QR Scanner / Ticket Code verification */}
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white flex items-center gap-1.5">
                        <span>🎫</span>
                        <span>Passenger Check-in & Optical QR Scanner</span>
                        {isSimulatedOffline && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                            Offline Dead-Zone Active
                          </span>
                        )}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsCameraScannerOpen(true)}
                      className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold text-xs transition flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 cursor-pointer"
                    >
                      <span className="text-sm">📷</span>
                      <span>Open Camera Scanner</span>
                    </button>
                  </div>

                  <form onSubmit={handleScanVerify} className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={scanCode}
                        onChange={(e) => setScanCode(e.target.value)}
                        placeholder="Scan or enter ticket code (e.g. BUSGO:14:2:8 or BG-0014-8)..."
                        className="w-full pl-3.5 pr-4 py-2 bg-[#0d1222] border border-slate-700/80 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-mono transition"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsCameraScannerOpen(true)}
                      className="px-4 py-2 rounded-xl bg-emerald-600/80 hover:bg-emerald-500 border border-emerald-500/40 text-white font-bold text-xs sm:text-sm transition flex items-center justify-center gap-1.5 shrink-0"
                    >
                      <span>📷</span>
                      <span>Camera</span>
                    </button>
                    <button
                      type="submit"
                      disabled={!scanCode.trim()}
                      className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-xs sm:text-sm transition flex items-center justify-center gap-1.5 shrink-0 shadow-lg shadow-cyan-500/20"
                    >
                      <span>Verify & Board</span>
                    </button>
                  </form>

                  {/* Scan feedback message */}
                  {scanResult && (
                    <div
                      className={`mt-2.5 px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 ${
                        scanResult.success
                          ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
                      }`}
                    >
                      <span>{scanResult.success ? '✓' : '⚠️'}</span>
                      <span>{scanResult.message}</span>
                    </div>
                  )}

                  {/* In-App Optical Camera Scanner Modal */}
                  <DriverCameraScanner
                    isOpen={isCameraScannerOpen}
                    onClose={() => setIsCameraScannerOpen(false)}
                    onScan={handleCameraScannedCode}
                    activeTripName={currentTrip?.name}
                  />
                </div>

                {manifest.length === 0 ? (
                  <p className="text-slate-500 text-sm">No passengers booked yet on this trip.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-slate-400 uppercase text-xs">
                          <th className="pb-3">Seat</th>
                          <th className="pb-3">Passenger</th>
                          <th className="pb-3">Phone</th>
                          <th className="pb-3">Boarding</th>
                          <th className="pb-3">Alighting</th>
                          <th className="pb-3">Status</th>
                          <th className="pb-3 text-right">Check-in</th>
                        </tr>
                      </thead>
                      <tbody>
                        {manifest.map((m, idx) => {
                          const isBoarded = (m as { status?: string }).status === 'boarded';
                          const bookingId = (m as { booking_id?: number }).booking_id;
                          return (
                            <tr
                              key={`${m.seat_number}-${m.board_stop_order}-${m.alight_stop_order}-${idx}`}
                              className="border-t border-slate-800"
                            >
                              <td className="py-3 font-black font-mono tabular-nums text-cyan-300">
                                #{m.seat_number}
                              </td>
                              <td className="py-3 font-semibold">{m.full_name ?? 'Walk-up / Unregistered'}</td>
                              <td className="py-3 text-slate-300 font-mono text-xs">{m.phone ?? '—'}</td>
                              <td className="py-3 text-slate-300">{m.board_stop ?? `Stop ${m.board_stop_order}`}</td>
                              <td className="py-3 text-slate-300">{m.alight_stop ?? `Stop ${m.alight_stop_order}`}</td>
                              <td className="py-3">
                                {isBoarded ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                                    ✓ Boarded
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                    Pending
                                  </span>
                                )}
                              </td>
                              <td className="py-3 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => {
                                      setPrintableTicket({
                                        bookingId: bookingId || m.seat_number,
                                        tripId: tripId,
                                        passengerName: m.full_name ?? 'Walk-up Passenger',
                                        passengerPhone: m.phone,
                                        seatNumber: m.seat_number,
                                        routeName: currentTrip?.route_name ?? currentTrip?.name ?? 'Transit Corridor',
                                        boardStop: m.board_stop ?? `Stop ${m.board_stop_order}`,
                                        alightStop: m.alight_stop ?? `Stop ${m.alight_stop_order}`,
                                        vehiclePlate: currentTrip?.plate_number,
                                        departureTime: currentTrip?.scheduled_at ? new Date(currentTrip.scheduled_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : undefined,
                                        paymentStatus: (m as { payment_status?: string }).payment_status || 'paid',
                                        qrData: `BUSGO:${bookingId || m.seat_number}:${tripId}:${m.seat_number}`,
                                      });
                                    }}
                                    title="Print Thermal POS Receipt / Boarding Pass"
                                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-mono transition flex items-center gap-1"
                                  >
                                    🧾 Receipt
                                  </button>
                                  {isBoarded ? (
                                    <span className="text-xs text-slate-500 font-mono">Checked In</span>
                                  ) : (
                                    <button
                                      onClick={() => handleBoardPassenger(bookingId)}
                                      disabled={boardingLoadingId === bookingId}
                                      className="px-3 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-bold transition disabled:opacity-50"
                                    >
                                      {boardingLoadingId === bookingId ? 'Checking in...' : 'Board'}
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Walk-up seat booking */}
            {tab === 'control' && (
              <div id="walkup-section" className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">
                  Book Walk-up Passenger — {currentTrip?.name}
                </h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Boarding Stop</label>
                    <select
                      value={boardStop}
                      onChange={(e) => setBoardStop(Number(e.target.value))}
                      className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-cyan-500"
                    >
                      {stops.map((s) => (
                        <option key={s.id} value={s.stop_order}>{s.stop_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Alighting Stop</label>
                    <select
                      value={alightStop}
                      onChange={(e) => setAlightStop(Number(e.target.value))}
                      className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-cyan-500"
                    >
                      {stops.map((s) => (
                        <option key={s.id} value={s.stop_order}>{s.stop_name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {boardStop >= alightStop && (
                  <p className="text-rose-400 text-xs font-bold mb-4">⚠️ Alighting stop must be further down the route than boarding.</p>
                )}

                <h4 className="font-bold text-slate-300 mb-3">
                  Seating Grid ({currentTrip?.route_type === 'direct' ? 'Direct' : 'Stopwise'} · {currentTrip?.seat_capacity ?? 14}-seater
                  {currentTrip?.is_electric ? ' · ⚡ Electric' : ''})
                </h4>
                <SeatGrid
                  seatCapacity={currentTrip?.seat_capacity ?? 14}
                  seatLayout={currentTrip?.seat_layout}
                  seatStates={seatStates}
                  selectedSeat={selectedSeat}
                  onSelect={setSelectedSeat}
                  disabled={boardStop >= alightStop}
                  vehicleType={currentTrip?.vehicle_type}
                  plateNumber={currentTrip?.plate_number}
                  isElectric={currentTrip?.is_electric}
                />

                {selectedChain && (
                  <div className="mt-4 rounded-2xl bg-slate-950 border border-slate-700 p-3">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                      🔗 Seat #{selectedSeat} relay chain
                    </p>
                    <ChainView seatNumber={selectedSeat ?? 0} links={selectedChain.links} />
                  </div>
                )}

                {selectedSeat && (
                  <button
                    onClick={handleBookingTrigger}
                    className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl shadow-lg transition-all"
                  >
                    Proceed to M-Pesa Checkout (Seat #{selectedSeat})
                  </button>
                )}

                {message && <p className="mt-4 text-center font-semibold text-emerald-400 text-sm">{message}</p>}

                {showMpesaModal && (
                  <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl max-w-md w-full">
                      <h3 className="text-xl font-bold text-emerald-400 mb-2">M-Pesa Express Checkout</h3>
                      <p className="text-slate-400 text-xs mb-4">
                        Enter the passenger&apos;s Safaricom number for an STK Push for seat #{selectedSeat}.
                      </p>
                      <input
                        type="text"
                        placeholder="2547XXXXXXXX"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full p-3 border border-slate-700 bg-slate-950 rounded-xl text-white mb-4 focus:outline-none focus:border-emerald-500 font-mono"
                      />
                      <div className="flex gap-3">
                        <button
                          onClick={() => setShowMpesaModal(false)}
                          disabled={isPaying}
                          className="w-1/2 py-3 bg-slate-800 hover:bg-slate-700 font-bold rounded-xl text-slate-300 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={confirmMpesaPayment}
                          disabled={isPaying}
                          className="w-1/2 py-3 bg-emerald-500 hover:bg-emerald-400 font-bold rounded-xl text-slate-950 disabled:opacity-60"
                        >
                          {isPaying ? 'Processing…' : 'Pay KSh 500'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB: MZIGO & CARGO MANIFEST */}
            {tab === 'mzigo' && (
              <MzigoManifest tripId={tripId} currentTrip={currentTrip} stops={stops} />
            )}

            {/* TAB: ASSIGNED TRIPS */}
            {tab === 'trips' && (
              <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="text-base font-black text-white flex items-center gap-2">
                      <IconFleet className="w-5 h-5 text-cyan-400" />
                      <span>All Assigned Trips ({trips.length})</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Select a scheduled corridor service to operate, track GPS, and manage manifests.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {trips.map((t) => (
                    <div
                      key={t.id}
                      className={`p-5 rounded-2xl border transition ${
                        t.id === tripId
                          ? 'bg-cyan-500/10 border-cyan-500/40 ring-1 ring-cyan-500/30'
                          : 'bg-[#090d16] border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-[10px] font-bold uppercase text-slate-500 font-mono">Trip #{t.id}</span>
                          <h4 className="text-base font-bold text-white mt-0.5">{t.name}</h4>
                          <p className="text-xs text-slate-400 mt-0.5">{t.route_name}</p>
                        </div>
                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 capitalize">
                          {t.status}
                        </span>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                        <span className="text-slate-400">
                          Vehicle: <strong className="text-cyan-300 font-mono">{t.plate_number || 'Unassigned'}</strong>
                        </span>
                        <button
                          onClick={() => {
                            setTripId(t.id);
                            setTab('control');
                            showNotice(`Switched active trip to #${t.id} (${t.name})`);
                          }}
                          className={`px-3.5 py-1.5 rounded-xl font-bold transition text-xs ${
                            t.id === tripId
                              ? 'bg-cyan-500 text-slate-950 font-black'
                              : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                          }`}
                        >
                          {t.id === tripId ? 'Active Service ✓' : 'Switch to Trip →'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB: MY FLEET & VEHICLES (CARGO LORRIES & PASSENGER PSVs) */}
            {tab === 'vehicles' && (
              <div className="space-y-6">
                {/* Header & Registration Trigger */}
                <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-black text-white flex items-center gap-2">
                      <span className="text-xl">🚛</span>
                      <span>My Registered Fleet & Vehicles (Lori Langu / Gari Langu)</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Register your vehicles under either <strong className="text-amber-400">Cargo (Lorries, Heavy Haulage & Pickups)</strong> or <strong className="text-cyan-400">People (Passenger PSVs)</strong>.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowRegVehicleModal(!showRegVehicleModal)}
                    className="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black rounded-xl text-xs transition shadow-lg flex items-center gap-2"
                  >
                    <span>{showRegVehicleModal ? '✕ Cancel' : '➕ Register New Vehicle / Lori'}</span>
                  </button>
                </div>

                {/* Registration Modal / Form */}
                {showRegVehicleModal && (
                  <div className="bg-[#090d16] p-6 sm:p-8 rounded-2xl border border-amber-500/30 shadow-2xl space-y-6 animate-in fade-in slide-in-from-top-4 duration-200">
                    <div className="border-b border-slate-800 pb-4">
                      <span className="text-[10px] font-black uppercase text-amber-400 tracking-wider">Driver Self-Service Onboarding</span>
                      <h4 className="text-lg font-black text-white mt-0.5">Register Vehicle into Fleet</h4>
                      <p className="text-xs text-slate-400">
                        Drivers can register vehicles under either <strong>Cargo (preferred: Lorries)</strong> or <strong>People (Passenger PSVs)</strong>.
                      </p>
                    </div>

                    <form onSubmit={handleRegisterVehicle} className="space-y-6">
                      {/* Step 1: Vehicle Purpose Toggle */}
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                          1. Choose Vehicle Purpose
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setRegPurpose('cargo');
                              setRegBodyType('canter_lorry');
                              setRegTonnage(3.5);
                            }}
                            className={`p-4 rounded-xl border text-left transition ${
                              regPurpose === 'cargo'
                                ? 'bg-amber-500/15 border-amber-500/60 ring-2 ring-amber-500/40'
                                : 'bg-slate-900 border-slate-800 hover:border-slate-700 opacity-70'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-2xl">🚛</span>
                              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                Recommended for Cargo
                              </span>
                            </div>
                            <h5 className="font-bold text-white text-sm">Cargo & Freight (Lorries)</h5>
                            <p className="text-xs text-slate-400 mt-1">
                              Canter lorries, heavy tipper lorries, box body trucks & pickups for goods delivery.
                            </p>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setRegPurpose('people');
                              setRegBodyType('matatu_14');
                              setRegSeatCapacity(14);
                            }}
                            className={`p-4 rounded-xl border text-left transition ${
                              regPurpose === 'people'
                                ? 'bg-cyan-500/15 border-cyan-500/60 ring-2 ring-cyan-500/40'
                                : 'bg-slate-900 border-slate-800 hover:border-slate-700 opacity-70'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-2xl">👥</span>
                              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                                Passenger Transport
                              </span>
                            </div>
                            <h5 className="font-bold text-white text-sm">People (Passenger PSVs)</h5>
                            <p className="text-xs text-slate-400 mt-1">
                              14-seater matatus, 35-seater nganyas, and large highway passenger buses.
                            </p>
                          </button>
                        </div>
                      </div>

                      {/* Step 2: Body Type Selector */}
                      {regPurpose === 'cargo' ? (
                        <div className="space-y-4">
                          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
                            2. Select Lorry Body Type
                          </label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {[
                              { id: 'canter_lorry', label: 'Canter Lorry (3.5 Tons)', desc: 'Standard medium distribution lorry (Isuzu NKR, Canter)', ton: 3.5, icon: '🚛' },
                              { id: 'box_lorry', label: 'Isuzu FRR Box Lorry (7 Tons)', desc: 'Enclosed secure dry cargo & parcel freight lorry', ton: 7.0, icon: '📦' },
                              { id: 'tipper_lorry', label: 'Actros Tipper / Heavy Lorry (15 Tons)', desc: 'Heavy bulk haulage, sand, quarry & construction', ton: 15.0, icon: '🏗️' },
                              { id: 'flatbed_lorry', label: 'Flatbed Cargo Lorry (10 Tons)', desc: 'Open deck for timber, steel, containers & farm produce', ton: 10.0, icon: '🚜' },
                              { id: 'pickup_lorry', label: 'Toyota Dyna Pickup Lorry (1.5 Tons)', desc: 'Fast agile urban courier & rapid delivery', ton: 1.5, icon: '🛻' },
                            ].map((b) => (
                              <button
                                key={b.id}
                                type="button"
                                onClick={() => {
                                  setRegBodyType(b.id);
                                  setRegTonnage(b.ton);
                                }}
                                className={`p-3.5 rounded-xl border text-left transition ${
                                  regBodyType === b.id
                                    ? 'bg-amber-500/10 border-amber-500 text-white ring-1 ring-amber-500/40'
                                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                                }`}
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <span>{b.icon}</span>
                                  <strong className="text-xs font-bold">{b.label}</strong>
                                </div>
                                <p className="text-[11px] text-slate-400">{b.desc}</p>
                              </button>
                            ))}
                          </div>

                          {/* Cargo Tonnage Input */}
                          <div className="bg-slate-900/90 p-4 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <label className="block text-xs font-bold text-slate-300 uppercase">
                                Cargo Payload Capacity (Metric Tons)
                              </label>
                              <span className="text-[11px] text-slate-400">Total rated cargo carrying capacity</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {[1.5, 3.5, 7.0, 10.0, 15.0, 28.0].map((tVal) => (
                                <button
                                  key={tVal}
                                  type="button"
                                  onClick={() => setRegTonnage(tVal)}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition border ${
                                    regTonnage === tVal
                                      ? 'bg-amber-500 text-slate-950 border-amber-400'
                                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
                                  }`}
                                >
                                  {tVal}T
                                </button>
                              ))}
                              <input
                                type="number"
                                step="0.1"
                                min="0.5"
                                max="50"
                                value={regTonnage}
                                onChange={(e) => setRegTonnage(parseFloat(e.target.value) || 0)}
                                className="w-20 px-2.5 py-1 text-center bg-slate-950 border border-slate-700 rounded-lg text-white font-mono font-bold text-xs"
                              />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
                            2. Select PSV Body Type
                          </label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            {[
                              { id: 'matatu_14', label: 'Matatu Shuttle', seats: 14, desc: '14-seater intercity shuttle', icon: '🚐' },
                              { id: 'nganya_35', label: 'Nganya Minibus', seats: 35, desc: '35-seater city / highway minibus', icon: '🚐' },
                              { id: 'coach_51', label: 'Highway Coach', seats: 51, desc: '51-seater long-distance coach', icon: '🚌' },
                              { id: 'ev_matatu_14', label: 'EV Electric Matatu', seats: 14, desc: 'Zero emissions electric van', icon: '🔋' },
                            ].map((b) => (
                              <button
                                key={b.id}
                                type="button"
                                onClick={() => {
                                  setRegBodyType(b.id);
                                  setRegSeatCapacity(b.seats);
                                  if (b.id === 'ev_matatu_14') setRegElectric(true);
                                }}
                                className={`p-3.5 rounded-xl border text-left transition ${
                                  regBodyType === b.id
                                    ? 'bg-cyan-500/10 border-cyan-500 text-white ring-1 ring-cyan-500/40'
                                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                                }`}
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <span>{b.icon}</span>
                                  <strong className="text-xs font-bold">{b.label}</strong>
                                </div>
                                <p className="text-[11px] text-slate-400">{b.desc}</p>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Step 3: Registration Specifications */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                            Plate Number *
                          </label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. KDE 842M"
                            value={regPlate}
                            onChange={(e) => setRegPlate(e.target.value.toUpperCase())}
                            className="w-full p-3 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono font-bold text-sm focus:border-amber-400 outline-none uppercase"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                            Manufacture Year
                          </label>
                          <input
                            type="number"
                            min="1990"
                            max="2027"
                            value={regYear}
                            onChange={(e) => setRegYear(e.target.value)}
                            className="w-full p-3 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:border-amber-400 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                            Powertrain / Fuel
                          </label>
                          <label className="flex items-center gap-3 p-3 bg-slate-950 border border-slate-700 rounded-xl cursor-pointer text-sm font-semibold text-slate-300">
                            <input
                              type="checkbox"
                              checked={regElectric}
                              onChange={(e) => setRegElectric(e.target.checked)}
                              className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500"
                            />
                            <span>🔋 Electric (EV)</span>
                          </label>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => setShowRegVehicleModal(false)}
                          className="px-4 py-2.5 rounded-xl border border-slate-700 text-slate-400 text-xs font-bold hover:text-white"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={isRegisteringVehicle}
                          className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-xs transition shadow-lg disabled:opacity-50 flex items-center gap-2"
                        >
                          <span>{regPurpose === 'cargo' ? '🚛' : '👥'}</span>
                          <span>{isRegisteringVehicle ? 'Registering Vehicle...' : 'Register Vehicle into BusGo Fleet'}</span>
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* Filter Pills */}
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { id: 'all', label: `All Vehicles (${driverVehicles.length})` },
                    { id: 'cargo', label: `🚛 Cargo Lorries (${driverVehicles.filter((v) => v.purpose === 'cargo').length})` },
                    { id: 'passenger', label: `👥 Passenger PSVs (${driverVehicles.filter((v) => v.purpose !== 'cargo').length})` },
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setVehicleFilter(f.id as 'all' | 'cargo' | 'passenger')}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition border ${
                        vehicleFilter === f.id
                          ? 'bg-amber-500 text-slate-950 border-amber-400 font-black shadow-md'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Vehicles Grid */}
                {loadingVehicles ? (
                  <div className="py-12 text-center text-slate-500 text-sm animate-pulse">
                    Loading your registered vehicles...
                  </div>
                ) : driverVehicles.filter((v) => vehicleFilter === 'all' || (vehicleFilter === 'cargo' ? v.purpose === 'cargo' : v.purpose !== 'cargo')).length === 0 ? (
                  <div className="bg-slate-900 p-10 rounded-2xl border border-slate-800 text-center space-y-3">
                    <span className="text-4xl">🚛</span>
                    <h4 className="text-base font-bold text-white">No vehicles registered in this category</h4>
                    <p className="text-xs text-slate-400 max-w-md mx-auto">
                      Click &ldquo;Register New Vehicle / Lori&rdquo; above to register your lorry, pickup, or passenger vehicle into the BusGo fleet.
                    </p>
                    <button
                      onClick={() => setShowRegVehicleModal(true)}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-xs"
                    >
                      + Register Your Lorry Now
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {driverVehicles
                      .filter((v) => vehicleFilter === 'all' || (vehicleFilter === 'cargo' ? v.purpose === 'cargo' : v.purpose !== 'cargo'))
                      .map((v) => {
                        const isCargo = v.purpose === 'cargo';
                        const isAssigned = currentTrip?.plate_number === v.plate_number;
                        return (
                          <div
                            key={v.id}
                            className={`p-5 rounded-2xl border transition ${
                              isAssigned
                                ? 'bg-amber-500/10 border-amber-500/50 ring-1 ring-amber-500/30'
                                : 'bg-[#090d16] border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex justify-between items-start gap-2">
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono font-black text-white text-base tracking-wider">
                                    {v.plate_number}
                                  </span>
                                  {isCargo ? (
                                    <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                      🚛 Cargo Lorry
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                                      👥 Passenger PSV
                                    </span>
                                  )}
                                  {v.is_electric && (
                                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                      🔋 EV
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-300 mt-1 font-semibold">
                                  {v.vehicle_type_name || v.category?.replace('_', ' ')}
                                </p>
                              </div>
                              <span
                                className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${
                                  v.is_grounded
                                    ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                                    : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                }`}
                              >
                                {v.is_grounded ? 'Grounded' : 'Compliant'}
                              </span>
                            </div>

                            {/* Capacity and Specs */}
                            <div className="mt-4 grid grid-cols-2 gap-2 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 text-xs">
                              {isCargo ? (
                                <div>
                                  <span className="text-slate-500 block text-[10px] uppercase">Payload Capacity</span>
                                  <strong className="text-amber-400 font-mono text-sm">
                                    {v.cargo_tonnage_capacity ? `${v.cargo_tonnage_capacity} Tons` : '3.5 Tons (Standard)'}
                                  </strong>
                                </div>
                              ) : (
                                <div>
                                  <span className="text-slate-500 block text-[10px] uppercase">Passenger Seats</span>
                                  <strong className="text-cyan-400 font-mono text-sm">
                                    {v.seat_capacity} Seats
                                  </strong>
                                </div>
                              )}
                              <div>
                                <span className="text-slate-500 block text-[10px] uppercase">Body Class</span>
                                <strong className="text-slate-300 capitalize text-xs">
                                  {v.body_type?.replace('_', ' ') || (isCargo ? 'Lorry' : 'Bus')}
                                </strong>
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                              <span className="text-slate-400 text-[11px]">
                                {isAssigned ? (
                                  <span className="text-amber-300 font-bold flex items-center gap-1">
                                    <span>⚡</span> Active on current trip #{tripId}
                                  </span>
                                ) : (
                                  <span>Ready for assignment</span>
                                )}
                              </span>
                              {!isAssigned && (
                                <button
                                  disabled={assigningVehicleId === v.id || !tripId}
                                  onClick={() => handleAssignVehicleToTrip(v.id)}
                                  className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs transition border border-slate-700 disabled:opacity-50"
                                >
                                  {assigningVehicleId === v.id ? 'Assigning...' : `Set for Trip #${tripId} →`}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </FluxDashboardShell>

      {printableTicket && (
        <PrintableTicketModal
          isOpen={!!printableTicket}
          ticket={printableTicket}
          onClose={() => setPrintableTicket(null)}
          defaultFormat="thermal"
        />
      )}

      <DriverIncidentReportModal
        tripId={tripId}
        tripName={currentTrip?.name || 'Assigned Trip'}
        isOpen={showIncidentModal}
        onClose={() => setShowIncidentModal(false)}
        onSuccess={() => showNotice('Highway hazard alert broadcasted to fleet dispatch and booked passengers.')}
      />
    </RequireRole>
  );
}