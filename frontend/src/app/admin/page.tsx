'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import RequireRole from '@/components/RequireRole';
import { useAuth } from '@/context/AuthContext';
import {
  fetchAdminVehicles,
  fetchVehicleTypes,
  fetchRoutes,
  fetchAdminUsers,
  fetchDriverTrips,
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
} from '@/services/api';

type Tab = 'vehicles' | 'routes' | 'trips' | 'users';

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

  // New-vehicle form
  const [newPlate, setNewPlate] = useState('');
  const [newVehicleType, setNewVehicleType] = useState<number>(0);
  const [newElectric, setNewElectric] = useState(false);

  // New-route form
  const [newRouteName, setNewRouteName] = useState('');
  const [newRouteStops, setNewRouteStops] = useState('');

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
      const [v, vt, r, u, t] = await Promise.all([
        fetchAdminVehicles(),
        fetchVehicleTypes(),
        fetchRoutes(),
        fetchAdminUsers(),
        fetchDriverTrips(),
      ]);
      setVehicles(v.vehicles);
      setVehicleTypes(vt.vehicle_types);
      setRoutes(r.routes);
      setUsers(u.users);
      setTrips(t.trips);
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
    try {
      await createRoute({ name: newRouteName, stops });
      setNewRouteName('');
      setNewRouteStops('');
      showNotice('Route created.');
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
                  newRouteStops={newRouteStops}
                  setNewRouteStops={setNewRouteStops}
                  onCreateRoute={handleCreateRoute}
                  onDeleteRoute={handleDeleteRoute}
                />
              )}

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
                  Tier: {bus.category.replace('_', ' ')} ({bus.seat_capacity} Seats)
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
  newRouteStops: string;
  setNewRouteStops: (v: string) => void;
  onCreateRoute: (e: React.FormEvent) => void;
  onDeleteRoute: (id: number) => void;
}) {
  const { routes, newRouteName, setNewRouteName, newRouteStops, setNewRouteStops, onCreateRoute, onDeleteRoute } = props;

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
          <div className="flex-1 min-w-[280px]">
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Stops (comma-separated, in order)</label>
            <input
              value={newRouteStops}
              onChange={(e) => setNewRouteStops(e.target.value)}
              placeholder="Nairobi CBD, Westlands, Naivasha, Nakuru"
              className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-blue-500"
            />
          </div>
          <button type="submit" className="px-4 py-3 bg-blue-500 hover:bg-blue-400 text-white font-black rounded-xl">
            Create Route
          </button>
        </form>
      </div>

      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Routes</h3>
        <div className="space-y-4">
          {routes.map((route) => (
            <div key={route.id} className="bg-slate-950 p-4 rounded-xl border border-slate-800">
              <div className="flex justify-between items-center mb-2">
                <h4 className="font-bold text-white">{route.name}</h4>
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
                  <td className="py-3 text-slate-400">{t.id}</td>
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
                <td className="py-3 text-slate-400">{u.id}</td>
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
