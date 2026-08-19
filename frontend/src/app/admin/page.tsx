'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import RequireRole from '@/components/RequireRole';
import NotificationsBell from '@/components/NotificationsBell';
import MetricCard from '@/components/MetricCard';
import { formatKSh, formatKShCompact } from '@/lib/format';
import { useAuth } from '@/context/AuthContext';
import {
  fetchAdminVehicles,
  fetchVehicleTypes,
  fetchRoutes,
  fetchAdminUsers,
  fetchDriverTrips,
  fetchAdminDrivers,
  createDriver,
  fetchAdminAnalytics,
  fetchAdminPayments,
  createVehicle,
  deleteVehicle,
  createVehicleType,
  createRoute,
  deleteRoute,
  createTrip,
  deleteTrip,
  errMsg,
  Vehicle,
  VehicleType,
  Route,
  User,
  TripRow,
  DriverRow,
  AdminAnalytics,
  PaymentRow,
} from '@/services/api';

type Tab = 'vehicles' | 'routes' | 'trips' | 'users' | 'drivers' | 'analytics' | 'payments';

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('vehicles');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);

  // New-vehicle form
  const [newPlate, setNewPlate] = useState('');
  const [newVehicleType, setNewVehicleType] = useState<number>(0);
  const [newElectric, setNewElectric] = useState(false);

  // New-route form
  const [newRouteName, setNewRouteName] = useState('');
  const [newRouteType, setNewRouteType] = useState<'direct' | 'stopwise'>('stopwise');
  const [newRouteStops, setNewRouteStops] = useState('');

  // New-driver form
  const [newDriverName, setNewDriverName] = useState('');
  const [newDriverEmail, setNewDriverEmail] = useState('');
  const [newDriverPhone, setNewDriverPhone] = useState('');
  const [newDriverPassword, setNewDriverPassword] = useState('');

  // New-trip form
  const [newTripName, setNewTripName] = useState('');
  const [newTripRoute, setNewTripRoute] = useState<number>(0);
  const [newTripVehicle, setNewTripVehicle] = useState<number>(0);
  const [newTripDriver, setNewTripDriver] = useState<number>(0);

  const showNotice = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(''), 4000);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [v, vt, r, u, t, d, a, p] = await Promise.all([
        fetchAdminVehicles(),
        fetchVehicleTypes(),
        fetchRoutes(),
        fetchAdminUsers(),
        fetchDriverTrips(),
        fetchAdminDrivers(),
        fetchAdminAnalytics(),
        fetchAdminPayments(),
      ]);
      setVehicles(v.vehicles);
      setVehicleTypes(vt.vehicle_types);
      setRoutes(r.routes);
      setUsers(u.users);
      setTrips(t.trips);
      setDrivers(d.drivers);
      setAnalytics(a);
      setPayments(p.payments);
    } catch (err: unknown) {
      setError(errMsg(err) || 'Failed to load fleet data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred so we don't synchronously setState inside the effect body.
    const t = window.setTimeout(() => {
      loadAll();
    }, 0);
    return () => window.clearTimeout(t);
  }, [loadAll]);

  const handleCreateVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlate || !newVehicleType) return;
    try {
      await createVehicle({ plate_number: newPlate, vehicle_type_id: newVehicleType, is_electric: newElectric });
      setNewPlate('');
      setNewElectric(false);
      showNotice(`Vehicle ${newPlate} added to the fleet.`);
      loadAll();
    } catch (err: unknown) {
      setError(errMsg(err));
    }
  };

  const handleDeleteVehicle = async (id: number) => {
    if (!window.confirm('Delete this vehicle?')) return;
    try {
      await deleteVehicle(id);
      showNotice('Vehicle removed.');
      loadAll();
    } catch (err: unknown) {
      setError(errMsg(err));
    }
  };

  const handleCreateVehicleType = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const slug = String(data.get('slug') || '').trim();
    const display_name = String(data.get('display_name') || '').trim();
    const seat_capacity = Number(data.get('seat_capacity'));
    if (!slug || !display_name || !seat_capacity) return;
    try {
      await createVehicleType({ slug, display_name, seat_capacity });
      form.reset();
      showNotice('Vehicle type created.');
      loadAll();
    } catch (err: unknown) {
      setError(errMsg(err));
    }
  };

  const handleCreateRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    const stops = newRouteStops
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!newRouteName || stops.length < 2) {
      setError('Route needs a name and at least 2 comma-separated stops.');
      return;
    }
    if (newRouteType === 'direct' && stops.length > 2) {
      setError('Direct routes have exactly 2 stops (origin, destination).');
      return;
    }
    try {
      await createRoute({ name: newRouteName, route_type: newRouteType, stops });
      setNewRouteName('');
      setNewRouteStops('');
      setNewRouteType('stopwise');
      showNotice('Route created.');
      loadAll();
    } catch (err: unknown) {
      setError(errMsg(err));
    }
  };

  const handleCreateDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDriverName || !newDriverEmail || !newDriverPassword) {
      setError('Driver needs a name, email and password.');
      return;
    }
    try {
      await createDriver({
        full_name: newDriverName,
        email: newDriverEmail,
        phone: newDriverPhone || undefined,
        password: newDriverPassword,
      });
      setNewDriverName('');
      setNewDriverEmail('');
      setNewDriverPhone('');
      setNewDriverPassword('');
      showNotice('Driver account created.');
      loadAll();
    } catch (err: unknown) {
      setError(errMsg(err));
    }
  };

  const handleDeleteRoute = async (id: number) => {
    if (!window.confirm('Delete this route and its stops?')) return;
    try {
      await deleteRoute(id);
      showNotice('Route deleted.');
      loadAll();
    } catch (err: unknown) {
      setError(errMsg(err));
    }
  };

  const handleCreateTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTripName || !newTripRoute) return;
    try {
      await createTrip({
        name: newTripName,
        route_id: newTripRoute,
        vehicle_id: newTripVehicle || null,
        driver_id: newTripDriver || null,
      });
      setNewTripName('');
      setNewTripRoute(0);
      setNewTripVehicle(0);
      setNewTripDriver(0);
      showNotice('Trip scheduled.');
      loadAll();
    } catch (err: unknown) {
      setError(errMsg(err));
    }
  };

  const handleDeleteTrip = async (id: number) => {
    if (!window.confirm('Delete this trip?')) return;
    try {
      await deleteTrip(id);
      showNotice('Trip deleted.');
      loadAll();
    } catch (err: unknown) {
      setError(errMsg(err));
    }
  };

  const navBtn = (t: Tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      className={`px-4 py-2 rounded-full text-sm font-bold transition ${
        tab === t ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  );


  return (
    <RequireRole roles={['admin']}>
      <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl flex justify-between items-center">
            <div>
              <span className="bg-blue-500/10 text-blue-400 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                Admin Control Center
              </span>
              <h1 className="text-3xl font-black mt-2">Fleet & Operations</h1>
              <p className="text-slate-400 text-sm">BUSGO Enterprise Telemetry — {user?.full_name}</p>
            </div>
            <div className="flex items-center gap-3">
              <NotificationsBell />
              <Link href="/" className="text-sm text-slate-400 hover:text-emerald-300 font-semibold">
                Home
              </Link>
              <button
                onClick={logout}
                className="text-sm bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-xl font-bold text-slate-300"
              >
                Logout
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {navBtn('vehicles', '🚌 Fleet')}
            {navBtn('routes', '🛣️ Routes')}
            {navBtn('trips', '📅 Trips')}
            {navBtn('users', '👥 Users')}
            {navBtn('drivers', '🧑‍✈️ Drivers')}
            {navBtn('analytics', '📈 Analytics')}
            {navBtn('payments', '💳 Payments')}
          </div>

          {error && (
            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm font-bold rounded-xl px-4 py-3">
              {error}
            </div>
          )}
          {notice && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-bold rounded-xl px-4 py-3">
              {notice}
            </div>
          )}

          {loading ? (
            <p className="text-slate-400">Loading fleet data…</p>
          ) : (
            <>
              {tab === 'vehicles' && (
                <VehicleTab
                  vehicles={vehicles}
                  vehicleTypes={vehicleTypes}
                  newPlate={newPlate}
                  setNewPlate={setNewPlate}
                  newVehicleType={newVehicleType}
                  setNewVehicleType={setNewVehicleType}
                  newElectric={newElectric}
                  setNewElectric={setNewElectric}
                  onAddVehicle={handleCreateVehicle}
                  onDeleteVehicle={handleDeleteVehicle}
                  onCreateType={handleCreateVehicleType}
                />
              )}

              {tab === 'routes' && (
                <RouteTab
                  routes={routes}
                  newRouteName={newRouteName}
                  setNewRouteName={setNewRouteName}
                  newRouteType={newRouteType}
                  setNewRouteType={setNewRouteType}
                  newRouteStops={newRouteStops}
                  setNewRouteStops={setNewRouteStops}
                  onCreateRoute={handleCreateRoute}
                  onDeleteRoute={handleDeleteRoute}
                />
              )}

              {tab === 'drivers' && (
                <DriversTab
                  drivers={drivers}
                  newDriverName={newDriverName}
                  setNewDriverName={setNewDriverName}
                  newDriverEmail={newDriverEmail}
                  setNewDriverEmail={setNewDriverEmail}
                  newDriverPhone={newDriverPhone}
                  setNewDriverPhone={setNewDriverPhone}
                  newDriverPassword={newDriverPassword}
                  setNewDriverPassword={setNewDriverPassword}
                  onCreateDriver={handleCreateDriver}
                />
              )}

              {tab === 'analytics' && <AnalyticsTab analytics={analytics} />}

              {tab === 'payments' && <PaymentsTab payments={payments} />}

              {tab === 'trips' && (
                <TripTab
                  trips={trips}
                  routes={routes}
                  vehicles={vehicles}
                  users={users}
                  newTripName={newTripName}
                  setNewTripName={setNewTripName}
                  newTripRoute={newTripRoute}
                  setNewTripRoute={setNewTripRoute}
                  newTripVehicle={newTripVehicle}
                  setNewTripVehicle={setNewTripVehicle}
                  newTripDriver={newTripDriver}
                  setNewTripDriver={setNewTripDriver}
                  onCreateTrip={handleCreateTrip}
                  onDeleteTrip={handleDeleteTrip}
                />
              )}

              {tab === 'users' && <UsersTab users={users} />}
            </>
          )}
        </div>
      </main>
    </RequireRole>
  );
}

// ---------------------------------------------------------------------------
// Tab: Vehicles
// ---------------------------------------------------------------------------
function VehicleTab(props: {
  vehicles: Vehicle[];
  vehicleTypes: VehicleType[];
  newPlate: string;
  setNewPlate: (v: string) => void;
  newVehicleType: number;
  setNewVehicleType: (v: number) => void;
  newElectric: boolean;
  setNewElectric: (v: boolean) => void;
  onAddVehicle: (e: React.FormEvent) => void;
  onDeleteVehicle: (id: number) => void;
  onCreateType: (e: React.FormEvent) => void;
}) {
  const {
    vehicles, vehicleTypes, newPlate, setNewPlate, newVehicleType, setNewVehicleType,
    newElectric, setNewElectric, onAddVehicle, onDeleteVehicle, onCreateType,
  } = props;

  return (
    <>
      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Register Vehicle</h3>
        <form onSubmit={onAddVehicle} className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Plate Number</label>
            <input
              value={newPlate}
              onChange={(e) => setNewPlate(e.target.value)}
              placeholder="KDA 123A"
              className="p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Vehicle Type</label>
            <select
              value={newVehicleType}
              onChange={(e) => setNewVehicleType(Number(e.target.value))}
              className="p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-blue-500"
            >
              <option value={0}>Select…</option>
              {vehicleTypes.map((vt) => (
                <option key={vt.id} value={vt.id}>
                  {vt.display_name} ({vt.seat_capacity} seats)
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 pb-3 text-sm font-semibold text-slate-300">
            <input type="checkbox" checked={newElectric} onChange={(e) => setNewElectric(e.target.checked)} />
            EV
          </label>
          <button type="submit" className="px-4 py-3 bg-blue-500 hover:bg-blue-400 text-white font-black rounded-xl">
            Add Vehicle
          </button>
        </form>
      </div>

      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Active Fleet Registry</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {vehicles.map((bus) => (
            <div key={bus.id} className="bg-slate-950 p-5 rounded-xl border border-slate-800 flex justify-between items-center">
              <div>
                <h4 className="font-bold text-lg text-white">{bus.plate_number}</h4>
                <p className="text-xs text-slate-400 capitalize">
                  Tier: {bus.category.replace('_', ' ')} (<span className="font-mono tabular-nums text-slate-300">{bus.seat_capacity}</span> Seats)
                </p>
              </div>
              <div className="flex items-center gap-2">
                {bus.is_electric ? (
                  <span className="bg-emerald-500/10 text-emerald-400 text-xs font-bold px-3 py-1.5 rounded-lg border border-emerald-500/20">
                    EV Fleet 🔋
                  </span>
                ) : (
                  <span className="bg-slate-800 text-slate-300 text-xs font-bold px-3 py-1.5 rounded-lg">
                    Standard Diesel
                  </span>
                )}
                <button
                  onClick={() => onDeleteVehicle(bus.id)}
                  className="text-xs bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 font-bold px-2 py-1.5 rounded-lg"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {vehicles.length === 0 && (
            <p className="text-slate-500 text-sm col-span-2">No vehicles registered yet.</p>
          )}
        </div>
      </div>

      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Add Vehicle Type</h3>
        <form onSubmit={onCreateType} className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Slug</label>
            <input name="slug" placeholder="bus_45" className="p-3 border border-slate-700 rounded-xl bg-slate-950 text-white focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Display Name</label>
            <input name="display_name" placeholder="Large Bus (45 seats)" className="p-3 border border-slate-700 rounded-xl bg-slate-950 text-white focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Seat Capacity</label>
            <input name="seat_capacity" type="number" placeholder="45" className="p-3 border border-slate-700 rounded-xl bg-slate-950 text-white focus:outline-none focus:border-blue-500" />
          </div>
          <button type="submit" className="px-4 py-3 bg-blue-500 hover:bg-blue-400 text-white font-black rounded-xl">
            Add Type
          </button>
        </form>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab: Routes
// ---------------------------------------------------------------------------
function RouteTab(props: {
  routes: Route[];
  newRouteName: string;
  setNewRouteName: (v: string) => void;
  newRouteType: 'direct' | 'stopwise';
  setNewRouteType: (v: 'direct' | 'stopwise') => void;
  newRouteStops: string;
  setNewRouteStops: (v: string) => void;
  onCreateRoute: (e: React.FormEvent) => void;
  onDeleteRoute: (id: number) => void;
}) {
  const {
    routes, newRouteName, setNewRouteName, newRouteType, setNewRouteType,
    newRouteStops, setNewRouteStops, onCreateRoute, onDeleteRoute,
  } = props;

  return (
    <>
      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Create Route</h3>
        <form onSubmit={onCreateRoute} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Route Name</label>
            <input
              value={newRouteName}
              onChange={(e) => setNewRouteName(e.target.value)}
              placeholder="Nairobi - Eldoret Express"
              className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Type</label>
            <div className="flex gap-2">
              {(['stopwise', 'direct'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setNewRouteType(t)}
                  className={`px-3 py-3 rounded-xl text-sm font-bold capitalize transition ${
                    newRouteType === t ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 min-w-[280px]">
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
              Stops (comma-separated, in order)
            </label>
            <input
              value={newRouteStops}
              onChange={(e) => setNewRouteStops(e.target.value)}
              placeholder={newRouteType === 'direct' ? 'Nairobi CBD, Nakuru' : 'Nairobi CBD, Westlands, Naivasha, Nakuru'}
              className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-blue-500"
            />
          </div>
          <button type="submit" className="px-4 py-3 bg-blue-500 hover:bg-blue-400 text-white font-black rounded-xl">
            Create Route
          </button>
        </form>
        <p className="text-xs text-slate-500 mt-2">
          {newRouteType === 'direct'
            ? 'Direct routes are non-stop origin → destination (exactly 2 stops).'
            : 'Stopwise routes allow boarding/alighting at every stop (relay chains).'}
        </p>
      </div>

      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Routes</h3>
        <div className="space-y-4">
          {routes.map((route) => (
            <div key={route.id} className="bg-slate-950 p-4 rounded-xl border border-slate-800">
              <div className="flex justify-between items-center mb-2">
                <h4 className="font-bold text-white">
                  {route.name}
                  <span className={`ml-2 text-[10px] font-black px-2 py-0.5 rounded-full uppercase ${
                    route.route_type === 'direct'
                      ? 'bg-blue-500/10 text-blue-300'
                      : 'bg-emerald-500/10 text-emerald-300'
                  }`}>
                    {route.route_type ?? 'stopwise'}
                  </span>
                </h4>
                <button
                  onClick={() => onDeleteRoute(route.id)}
                  className="text-xs bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 font-bold px-2 py-1.5 rounded-lg"
                >
                  Delete
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {route.stops.map((s, i) => (
                  <span key={s.id} className="text-xs bg-slate-800 text-slate-300 px-2.5 py-1 rounded-full">
                    {i > 0 && <span className="text-slate-500 mr-1">→</span>}
                    {s.stop_name}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {routes.length === 0 && <p className="text-slate-500 text-sm">No routes yet.</p>}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab: Trips
// ---------------------------------------------------------------------------
function TripTab(props: {
  trips: TripRow[];
  routes: Route[];
  vehicles: Vehicle[];
  users: User[];
  newTripName: string;
  setNewTripName: (v: string) => void;
  newTripRoute: number;
  setNewTripRoute: (v: number) => void;
  newTripVehicle: number;
  setNewTripVehicle: (v: number) => void;
  newTripDriver: number;
  setNewTripDriver: (v: number) => void;
  onCreateTrip: (e: React.FormEvent) => void;
  onDeleteTrip: (id: number) => void;
}) {
  const {
    trips, routes, vehicles, users, newTripName, setNewTripName, newTripRoute, setNewTripRoute,
    newTripVehicle, setNewTripVehicle, newTripDriver, setNewTripDriver, onCreateTrip, onDeleteTrip,
  } = props;

  return (
    <>
      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Schedule Trip</h3>
        <form onSubmit={onCreateTrip} className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Trip Name</label>
            <input
              value={newTripName}
              onChange={(e) => setNewTripName(e.target.value)}
              placeholder="Nairobi - Nakuru Morning"
              className="p-3 border border-slate-700 rounded-xl bg-slate-950 text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Route</label>
            <select
              value={newTripRoute}
              onChange={(e) => setNewTripRoute(Number(e.target.value))}
              className="p-3 border border-slate-700 rounded-xl bg-slate-950 text-white focus:outline-none focus:border-blue-500"
            >
              <option value={0}>Select…</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Vehicle</label>
            <select
              value={newTripVehicle}
              onChange={(e) => setNewTripVehicle(Number(e.target.value))}
              className="p-3 border border-slate-700 rounded-xl bg-slate-950 text-white focus:outline-none focus:border-blue-500"
            >
              <option value={0}>—</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.plate_number}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Driver</label>
            <select
              value={newTripDriver}
              onChange={(e) => setNewTripDriver(Number(e.target.value))}
              className="p-3 border border-slate-700 rounded-xl bg-slate-950 text-white focus:outline-none focus:border-blue-500"
            >
              <option value={0}>—</option>
              {users.filter((u) => u.role === 'driver').map((u) => (
                <option key={u.id} value={u.id}>{u.full_name}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="px-4 py-3 bg-blue-500 hover:bg-blue-400 text-white font-black rounded-xl">
            Schedule Trip
          </button>
        </form>
      </div>

      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Trips</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 uppercase text-xs">
                <th className="pb-3">ID</th>
                <th className="pb-3">Name</th>
                <th className="pb-3">Route</th>
                <th className="pb-3">Vehicle</th>
                <th className="pb-3">Status</th>
                <th className="pb-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((t) => (
                <tr key={t.id} className="border-t border-slate-800">
                  <td className="py-3 text-slate-400 font-mono tabular-nums">{t.id}</td>
                  <td className="py-3 font-semibold">{t.name}</td>
                  <td className="py-3 text-slate-300">{t.route_name}</td>
                  <td className="py-3 text-slate-300">{t.plate_number ?? '—'}</td>
                  <td className="py-3">
                    <span className="bg-slate-800 text-slate-300 text-xs font-bold px-2 py-1 rounded-full capitalize">{t.status}</span>
                  </td>
                  <td className="py-3">
                    <button
                      onClick={() => onDeleteTrip(t.id)}
                      className="text-xs bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 font-bold px-2 py-1.5 rounded-lg"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {trips.length === 0 && (
                <tr><td colSpan={6} className="py-3 text-slate-500">No trips yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab: Users
// ---------------------------------------------------------------------------
function UsersTab({ users }: { users: User[] }) {
  return (
    <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Registered Users</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 uppercase text-xs">
              <th className="pb-3">ID</th>
              <th className="pb-3">Name</th>
              <th className="pb-3">Email</th>
              <th className="pb-3">Phone</th>
              <th className="pb-3">Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-800">
                <td className="py-3 text-slate-400 font-mono tabular-nums">{u.id}</td>
                <td className="py-3 font-semibold">{u.full_name}</td>
                <td className="py-3 text-slate-300">{u.email ?? '—'}</td>
                <td className="py-3 text-slate-300">{u.phone ?? '—'}</td>
                <td className="py-3">
                  <span className={`text-xs font-bold px-2 py-1 rounded-full capitalize ${
                    u.role === 'admin' ? 'bg-blue-500/10 text-blue-400' :
                    u.role === 'driver' ? 'bg-cyan-500/10 text-cyan-300' :
                    'bg-emerald-500/10 text-emerald-400'
                  }`}>{u.role}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Drivers
// ---------------------------------------------------------------------------
function DriversTab(props: {
  drivers: DriverRow[];
  newDriverName: string;
  setNewDriverName: (v: string) => void;
  newDriverEmail: string;
  setNewDriverEmail: (v: string) => void;
  newDriverPhone: string;
  setNewDriverPhone: (v: string) => void;
  newDriverPassword: string;
  setNewDriverPassword: (v: string) => void;
  onCreateDriver: (e: React.FormEvent) => void;
}) {
  const {
    drivers, newDriverName, setNewDriverName, newDriverEmail, setNewDriverEmail,
    newDriverPhone, setNewDriverPhone, newDriverPassword, setNewDriverPassword, onCreateDriver,
  } = props;

  return (
    <>
      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Create Driver Account</h3>
        <form onSubmit={onCreateDriver} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Full Name</label>
            <input
              value={newDriverName}
              onChange={(e) => setNewDriverName(e.target.value)}
              placeholder="Jane Mwangi"
              className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Email</label>
            <input
              type="email"
              value={newDriverEmail}
              onChange={(e) => setNewDriverEmail(e.target.value)}
              placeholder="jane@busgo.test"
              className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Phone</label>
            <input
              value={newDriverPhone}
              onChange={(e) => setNewDriverPhone(e.target.value)}
              placeholder="2547XXXXXXXX"
              className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Password</label>
            <input
              type="password"
              value={newDriverPassword}
              onChange={(e) => setNewDriverPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-blue-500"
            />
          </div>
          <button type="submit" className="px-4 py-3 bg-blue-500 hover:bg-blue-400 text-white font-black rounded-xl">
            Create Driver
          </button>
        </form>
      </div>

      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Drivers</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 uppercase text-xs">
                <th className="pb-3">ID</th>
                <th className="pb-3">Name</th>
                <th className="pb-3">Email</th>
                <th className="pb-3">Phone</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.id} className="border-t border-slate-800">
                  <td className="py-3 text-slate-400 font-mono tabular-nums">{d.id}</td>
                  <td className="py-3 font-semibold">{d.full_name}</td>
                  <td className="py-3 text-slate-300">{d.email}</td>
                  <td className="py-3 text-slate-300">{d.phone ?? '—'}</td>
                </tr>
              ))}
              {drivers.length === 0 && (
                <tr><td colSpan={4} className="py-3 text-slate-500">No drivers yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}


// ---------------------------------------------------------------------------
// Tab: Analytics — fintech telemetry (segmented summaries + ledger)
// ---------------------------------------------------------------------------
function AnalyticsTab({ analytics }: { analytics: AdminAnalytics | null }) {
  if (!analytics) {
    return <p className="text-slate-400">Loading analytics…</p>;
  }
  const { revenue, revenue_prev, bookings_per_day, occupancy } = analytics;
  const maxDay = Math.max(1, ...bookings_per_day.map((d) => d.bookings));

  return (
    <div className="space-y-6">
      {/* Top summary widgets: Today's / Weekly / Monthly / Yearly + health */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Today's revenue" value={formatKSh(revenue.today)} sub="gross collections" />
        <MetricCard label="This week" value={formatKShCompact(revenue.week)} previous={revenue_prev.week} sub="vs previous week" />
        <MetricCard label="This month" value={formatKShCompact(revenue.month)} previous={revenue_prev.month} sub="vs previous month" />
        <MetricCard label="This year" value={formatKShCompact(revenue.year)} previous={revenue_prev.year} sub="vs previous year" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Total revenue (all time)" value={formatKShCompact(revenue.total)} />
        <MetricCard label="Paid bookings" value={String(revenue.paid_bookings)} accent="neutral" mono={false} sub="confirmed seats" />
        <MetricCard label="Completed payments" value={String(revenue.completed_payments)} accent="neutral" mono={false} sub="settled STK pushes" />
        <MetricCard label="Failed payments" value={String(revenue.failed_payments)} accent={revenue.failed_payments > 0 ? 'rose' : 'emerald'} mono={false} sub="rejected transactions" />
      </div>

      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Bookings — last 14 days</h3>
        {bookings_per_day.length === 0 ? (
          <p className="text-slate-500 text-sm">No bookings recorded yet.</p>
        ) : (
          <div className="flex items-end gap-2 h-40">
            {bookings_per_day.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-emerald-500/70 rounded-t-lg"
                  style={{ height: `${Math.max(4, (d.bookings / maxDay) * 120)}px` }}
                  title={`${d.bookings} bookings`}
                />
                <span className="text-[10px] text-slate-500 font-mono tabular-nums">{d.day.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Trip occupancy — fleet metrics</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 uppercase text-xs tracking-wider">
                <th className="pb-3 font-bold">Trip</th>
                <th className="pb-3 font-bold">Route</th>
                <th className="pb-3 font-bold">Capacity</th>
                <th className="pb-3 font-bold">Seats taken</th>
                <th className="pb-3 font-bold">Efficiency</th>
              </tr>
            </thead>
            <tbody>
              {occupancy.map((o) => {
                const pct = o.seat_capacity ? Math.round((o.seats_taken / o.seat_capacity) * 100) : 0;
                return (
                  <tr key={o.id} className="border-t border-slate-800">
                    <td className="py-3 font-semibold">{o.name}</td>
                    <td className="py-3 text-slate-400">{o.route_name}</td>
                    <td className="py-3 text-slate-300 font-mono tabular-nums">{o.seat_capacity ?? '—'}</td>
                    <td className="py-3 text-slate-300 font-mono tabular-nums">{o.seats_taken}</td>
                    <td className="py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-32 h-2 rounded-full bg-slate-800 overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-emerald-400 font-mono tabular-nums">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Tab: Payments
// ---------------------------------------------------------------------------
function PaymentsTab({ payments }: { payments: PaymentRow[] }) {
  return (
    <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Payment log</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 uppercase text-xs">
              <th className="pb-3">ID</th>
              <th className="pb-3">Provider</th>
              <th className="pb-3">Status</th>
              <th className="pb-3">Amount</th>
              <th className="pb-3">Phone</th>
              <th className="pb-3">Reference</th>
              <th className="pb-3">Verified</th>
              <th className="pb-3">Trip</th>
              <th className="pb-3">Seat</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-t border-slate-800">
                <td className="py-3 text-slate-400">{p.id}</td>
                <td className="py-3">
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                    p.provider === 'mpesa_daraja' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-300'
                  }`}>
                    {p.provider}
                  </span>
                </td>
                <td className="py-3">
                  <span className={`text-xs font-bold px-2 py-1 rounded-full capitalize ${
                    p.status === 'completed' ? 'bg-emerald-500/10 text-emerald-300' :
                    p.status === 'failed' ? 'bg-rose-500/10 text-rose-300' :
                    'bg-amber-500/10 text-amber-300'
                  }`}>
                    {p.status}
                  </span>
                </td>
                <td className="py-3 font-mono tabular-nums font-semibold">{formatKSh(p.amount)}</td>
                <td className="py-3 text-slate-300 font-mono text-xs">{p.phone_number ?? '—'}</td>
                <td className="py-3 text-slate-300 font-mono text-xs">{p.provider_reference ?? '—'}</td>
                <td className="py-3">{p.callback_verified ? '✅' : '—'}</td>
                <td className="py-3 text-slate-300 font-mono tabular-nums">#{p.trip_id}</td>
                <td className="py-3 text-slate-300 font-mono tabular-nums">#{p.seat_number}</td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr><td colSpan={9} className="py-3 text-slate-500">No payments yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

