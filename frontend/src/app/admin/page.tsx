'use client';

import React, { useEffect, useState, useCallback } from 'react';
import RequireRole from '@/components/RequireRole';
import MetricCard from '@/components/MetricCard';
import { formatKSh, formatKShCompact } from '@/lib/format';
import FluxDashboardShell, { FluxNavGroup } from '@/components/dashboard/FluxDashboardShell';
import {
  FluxChartCard,
  FluxProgressWidget,
  FluxActivityWidget,
  FluxMetric,
} from '@/components/dashboard/FluxWidgets';
import {
  IconDashboard,
  IconAnalytics,
  IconFleet,
  IconRoute,
  IconTrip,
  IconUsers,
  IconDriver,
  IconPayment,
  IconZap,
  IconActivity,
} from '@/components/dashboard/FluxIcons';
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
  fetchPaymentDiagnostics,
  testPaymentWebhook,
  fetchManifest,
  PaymentDiagnostics,
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
import { downloadCSV, printPoliceManifest } from '@/lib/export';
import CronManagerWidget from '@/components/admin/CronManagerWidget';
import SaccoManager from '@/components/admin/SaccoManager';
import FleetComplianceTable from '@/components/admin/FleetComplianceTable';
import IncidentDispatcher from '@/components/admin/IncidentDispatcher';
import SaccoSettlementManager from '@/components/admin/SaccoSettlementManager';
import EvFleetDashboard from '@/components/admin/EvFleetDashboard';
import HardwareTrackersManager from '@/components/admin/HardwareTrackersManager';
import dynamic from 'next/dynamic';

const NationalFleetRadar = dynamic(() => import('@/components/radar/NationalFleetRadar'), {
  ssr: false,
  loading: () => <div className="p-8 text-center text-slate-400 text-xs">Loading Highway Radar GIS...</div>,
});

type Tab =
  | 'overview'
  | 'radar'
  | 'vehicles'
  | 'hardware_gps'
  | 'ev_fleet'
  | 'routes'
  | 'trips'
  | 'users'
  | 'drivers'
  | 'analytics'
  | 'payments'
  | 'settlements'
  | 'crons'
  | 'saccos'
  | 'compliance'
  | 'incidents';

export default function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('overview');
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
  const [newPurpose, setNewPurpose] = useState<'cargo' | 'passenger'>('cargo');
  const [newTonnage, setNewTonnage] = useState<number>(3.5);
  const [newBodyType, setNewBodyType] = useState<string>('canter_lorry');
  const [adminVehicleFilter, setAdminVehicleFilter] = useState<'all' | 'cargo' | 'passenger'>('all');

  // New-route form
  const [newRouteName, setNewRouteName] = useState('');
  const [newRouteType, setNewRouteType] = useState<'direct' | 'stopwise'>('stopwise');
  const [newRouteStops, setNewRouteStops] = useState('');
  const [newRouteBaseFare, setNewRouteBaseFare] = useState<number>(200);
  const [newRoutePerHop, setNewRoutePerHop] = useState<number>(150);
  const [newRouteMatrix, setNewRouteMatrix] = useState<string>('');

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
  const [newTripFixedPrice, setNewTripFixedPrice] = useState<string>('');
  const [newTripAllowDriverTier, setNewTripAllowDriverTier] = useState<boolean>(false);
  const [newTripMaxSurcharge, setNewTripMaxSurcharge] = useState<number>(25);

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
    if (!newPlate.trim()) return;
    try {
      const selVt = vehicleTypes.find((vt) => vt.id === newVehicleType);
      const purpose = newPurpose || (selVt?.purpose === 'cargo' ? 'cargo' : 'passenger');
      await createVehicle({
        plate_number: newPlate.trim().toUpperCase(),
        vehicle_type_id: newVehicleType || undefined,
        is_electric: newElectric,
        purpose,
        body_type: newBodyType,
        cargo_tonnage_capacity: purpose === 'cargo' ? newTonnage : undefined,
      });
      setNewPlate('');
      setNewElectric(false);
      showNotice(`Vehicle ${newPlate.toUpperCase()} added to the fleet under ${purpose.toUpperCase()}.`);
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
    let parsedMatrix: Record<string, number> | undefined = undefined;
    if (newRouteMatrix.trim()) {
      try {
        parsedMatrix = JSON.parse(newRouteMatrix);
      } catch {
        setError('Invalid JSON for Stop-to-Stop Price Matrix. Format: {"StopA-StopB": 250}');
        return;
      }
    }
    try {
      await createRoute({
        name: newRouteName,
        route_type: newRouteType,
        stops,
        base_fare: Number(newRouteBaseFare) || 200,
        per_hop_fare: Number(newRoutePerHop) || 150,
        fare_matrix: parsedMatrix,
      });
      setNewRouteName('');
      setNewRouteStops('');
      setNewRouteType('stopwise');
      setNewRouteBaseFare(200);
      setNewRoutePerHop(150);
      setNewRouteMatrix('');
      showNotice('Route created with custom pricing rules.');
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
        fixed_price: newTripFixedPrice.trim() ? parseFloat(newTripFixedPrice) : null,
        allow_driver_tier: newTripAllowDriverTier,
        max_surcharge_pct: Number(newTripMaxSurcharge) || 25,
      });
      setNewTripName('');
      setNewTripRoute(0);
      setNewTripVehicle(0);
      setNewTripDriver(0);
      setNewTripFixedPrice('');
      setNewTripAllowDriverTier(false);
      setNewTripMaxSurcharge(25);
      showNotice('Trip scheduled with pricing governance.');
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

  const navGroups: FluxNavGroup[] = [
    {
      title: 'OVERVIEW & TRANSIT GIS',
      items: [
        { id: 'overview', label: 'Dashboard', icon: <IconDashboard /> },
        { id: 'radar', label: 'Highway Radar GIS', icon: <span className="text-base">📡</span> },
        { id: 'hardware_gps', label: 'Hardware Trackers (GPS)', icon: <span className="text-base">🛰️</span> },
        { id: 'analytics', label: 'Analytics', icon: <IconAnalytics /> },
        { id: 'vehicles', label: 'Fleet & Vehicles', icon: <IconFleet />, badge: vehicles.length },
        { id: 'ev_fleet', label: 'Green Fleet & EV', icon: <span className="text-base">⚡</span> },
        { id: 'routes', label: 'Transit Routes', icon: <IconRoute />, badge: routes.length },
        { id: 'trips', label: 'Trips & Schedule', icon: <IconTrip />, badge: trips.length },
      ],
    },
    {
      title: 'COMMERCE & OPERATIONS',
      items: [
        { id: 'drivers', label: 'Drivers', icon: <IconDriver />, badge: drivers.length },
        { id: 'users', label: 'Passengers', icon: <IconUsers />, badge: users.length },
        { id: 'payments', label: 'Payments & M-Pesa', icon: <IconPayment />, badge: payments.length },
        { id: 'settlements', label: 'Treasury & Cashout', icon: <span className="text-base">💰</span> },
        { id: 'crons', label: 'Automations & Crons', icon: <IconZap /> },
      ],
    },
    {
      title: 'KENYAN SACCO & NTSA',
      items: [
        { id: 'saccos', label: 'SACCO Tenants', icon: <span className="text-base">🏢</span> },
        { id: 'compliance', label: 'NTSA Compliance', icon: <span className="text-base">🛡️</span> },
        { id: 'incidents', label: 'Highway Incidents & SOS', icon: <span className="text-base">🚨</span> },
      ],
    },
  ];

  const metrics: FluxMetric[] = [
    {
      label: 'MRR / REVENUE',
      value: analytics?.revenue?.total ? formatKShCompact(analytics.revenue.total) : 'KSh 48.2K',
      change: '+12.4% vs last month',
      trend: 'up',
      icon: <IconZap className="w-3.5 h-3.5" />,
    },
    {
      label: 'ACTIVE USERS',
      value: users.length ? users.length.toLocaleString() : '12,847',
      change: '+8.2% vs last month',
      trend: 'up',
      icon: <IconUsers className="w-3.5 h-3.5" />,
    },
    {
      label: 'DEPLOYMENTS',
      value: trips.length ? trips.length.toString() : '342',
      change: '+24.1% vs last month',
      trend: 'up',
      icon: <IconTrip className="w-3.5 h-3.5" />,
    },
    {
      label: 'FLEET UPTIME',
      value: '99.98%',
      change: '+0.02% vs last month',
      trend: 'up',
      icon: <IconActivity className="w-3.5 h-3.5" />,
    },
  ];

  const activityList = payments.length > 0
    ? payments.slice(0, 5).map((p, idx) => {
        const colors = [
          'bg-blue-500/20 text-blue-400 border-blue-500/30',
          'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
          'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
          'bg-pink-500/20 text-pink-400 border-pink-500/30',
          'bg-purple-500/20 text-purple-400 border-purple-500/30',
        ];
        const initialsList = ['SC', 'AM', 'PK', 'ML', 'JT'];
        return {
          id: p.id,
          initials: initialsList[idx % initialsList.length],
          name: `Trip #${p.trip_id} (Seat #${p.seat_number})`,
          action: `paid ${formatKSh(p.amount)} via ${p.provider}`,
          time: `${(idx + 1) * 7}m`,
          avatarColor: colors[idx % colors.length],
        };
      })
    : undefined;

  return (
    <RequireRole roles={['admin']}>
      <FluxDashboardShell
        activeTab={tab}
        onTabChange={(t) => setTab(t as Tab)}
        navGroups={navGroups}
        metrics={metrics}
        heroGreeting="Good morning"
        heroSubtitle="Here's what's happening with your fleet and transit operations today."
        primaryAction={{
          label: '+ New Order',
          onClick: () => setTab('trips'),
        }}
        searchPlaceholder="Search routes, trips, passengers..."
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

        {loading ? (
          <div className="rounded-2xl border border-slate-800 bg-[#121624] p-12 text-center">
            <p className="text-slate-400 animate-pulse">Loading transit telemetry & fleet data…</p>
          </div>
        ) : (
          <>
            {tab === 'overview' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left 2/3 column: Revenue Growth / Monthly Recurring Revenue Trend Chart */}
                <div className="lg:col-span-2 space-y-6">
                  <FluxChartCard
                    title="Revenue Growth"
                    subtitle="Monthly recurring revenue and transit fare volume"
                  />
                  {/* Quick Telemetry Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="rounded-2xl border border-slate-800/80 bg-[#121624] p-5 shadow-lg">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Active Fleet</span>
                        <button onClick={() => setTab('vehicles')} className="text-xs font-semibold text-indigo-400 hover:text-indigo-300">Manage →</button>
                      </div>
                      <p className="text-2xl font-bold font-mono text-white mt-2">{vehicles.length} Vehicles</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {vehicles.filter((v) => v.is_electric).length} Electric • {vehicles.length - vehicles.filter((v) => v.is_electric).length} Standard Diesel
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-800/80 bg-[#121624] p-5 shadow-lg">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Scheduled Trips</span>
                        <button onClick={() => setTab('trips')} className="text-xs font-semibold text-indigo-400 hover:text-indigo-300">Schedule →</button>
                      </div>
                      <p className="text-2xl font-bold font-mono text-white mt-2">{trips.length} Trips Active</p>
                      <p className="text-xs text-slate-400 mt-1">{routes.length} Transit corridors deployed</p>
                    </div>
                  </div>
                </div>

                {/* Right 1/3 column: Sprint 24 & Team Activity */}
                <div className="space-y-6">
                  <FluxProgressWidget
                    title="Sprint 24"
                    subtitle="5 days remaining"
                    linkText="View board ↗"
                    onLinkClick={() => setTab('trips')}
                    segments={[
                      { label: 'Completed', count: trips.filter((t) => t.status === 'completed').length || 14, color: 'bg-cyan-400', pct: 65 },
                      { label: 'In Progress', count: trips.filter((t) => t.status === 'in_transit' || t.status === 'boarding').length || 5, color: 'bg-amber-400', pct: 25 },
                      { label: 'To Do', count: trips.filter((t) => t.status === 'scheduled').length || 2, color: 'bg-slate-600', pct: 10 },
                    ]}
                  />
                  <FluxActivityWidget
                    title="Team Activity"
                    subtitle="Latest from your team"
                    linkText="View all ↗"
                    onLinkClick={() => setTab('payments')}
                    items={activityList}
                  />
                </div>
                {/* Full-width Background Automations & Crons Status Widget */}
                <div className="lg:col-span-3">
                  <CronManagerWidget />
                </div>
              </div>
            )}

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
                newPurpose={newPurpose}
                setNewPurpose={setNewPurpose}
                newTonnage={newTonnage}
                setNewTonnage={setNewTonnage}
                newBodyType={newBodyType}
                setNewBodyType={setNewBodyType}
                adminVehicleFilter={adminVehicleFilter}
                setAdminVehicleFilter={setAdminVehicleFilter}
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
                newRouteBaseFare={newRouteBaseFare}
                setNewRouteBaseFare={setNewRouteBaseFare}
                newRoutePerHop={newRoutePerHop}
                setNewRoutePerHop={setNewRoutePerHop}
                newRouteMatrix={newRouteMatrix}
                setNewRouteMatrix={setNewRouteMatrix}
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

            {tab === 'radar' && <NationalFleetRadar />}

            {tab === 'hardware_gps' && (
              <HardwareTrackersManager vehicles={vehicles} onRefreshVehicles={loadAll} />
            )}

            {tab === 'ev_fleet' && <EvFleetDashboard />}

            {tab === 'settlements' && <SaccoSettlementManager />}

            {tab === 'analytics' && <AnalyticsTab analytics={analytics} />}

            {tab === 'payments' && <PaymentsTab payments={payments} onRefreshPayments={loadAll} />}

            {tab === 'crons' && <CronManagerWidget />}

            {tab === 'saccos' && <SaccoManager />}

            {tab === 'compliance' && <FleetComplianceTable />}

            {tab === 'incidents' && <IncidentDispatcher />}

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
                newTripFixedPrice={newTripFixedPrice}
                setNewTripFixedPrice={setNewTripFixedPrice}
                newTripAllowDriverTier={newTripAllowDriverTier}
                setNewTripAllowDriverTier={setNewTripAllowDriverTier}
                newTripMaxSurcharge={newTripMaxSurcharge}
                setNewTripMaxSurcharge={setNewTripMaxSurcharge}
                onCreateTrip={handleCreateTrip}
                onDeleteTrip={handleDeleteTrip}
              />
            )}

            {tab === 'users' && <UsersTab users={users} />}
          </>
        )}
      </FluxDashboardShell>
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
  newPurpose: 'cargo' | 'passenger';
  setNewPurpose: (v: 'cargo' | 'passenger') => void;
  newTonnage: number;
  setNewTonnage: (v: number) => void;
  newBodyType: string;
  setNewBodyType: (v: string) => void;
  adminVehicleFilter: 'all' | 'cargo' | 'passenger';
  setAdminVehicleFilter: (v: 'all' | 'cargo' | 'passenger') => void;
  onAddVehicle: (e: React.FormEvent) => void;
  onDeleteVehicle: (id: number) => void;
  onCreateType: (e: React.FormEvent) => void;
}) {
  const {
    vehicles, vehicleTypes, newPlate, setNewPlate, newVehicleType, setNewVehicleType,
    newElectric, setNewElectric, newPurpose, setNewPurpose, newTonnage, setNewTonnage,
    newBodyType, setNewBodyType, adminVehicleFilter, setAdminVehicleFilter,
    onAddVehicle, onDeleteVehicle, onCreateType,
  } = props;

  const filteredVehicles = vehicles.filter((v) => {
    if (adminVehicleFilter === 'all') return true;
    if (adminVehicleFilter === 'cargo') return v.purpose === 'cargo';
    return v.purpose !== 'cargo';
  });

  return (
    <>
      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Register Fleet Vehicle</h3>
        <form onSubmit={onAddVehicle} className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Purpose / Classification</label>
              <select
                value={newPurpose}
                onChange={(e) => {
                  const p = e.target.value as 'cargo' | 'passenger';
                  setNewPurpose(p);
                  if (p === 'cargo') {
                    setNewBodyType('canter_lorry');
                    setNewTonnage(3.5);
                  } else {
                    setNewBodyType('matatu_14');
                  }
                }}
                className="p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-amber-500"
              >
                <option value="cargo">🚛 Cargo (Lorries & Heavy Freight)</option>
                <option value="passenger">👥 People (Passenger PSVs)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Plate Number</label>
              <input
                value={newPlate}
                onChange={(e) => setNewPlate(e.target.value.toUpperCase())}
                placeholder="e.g. KDE 842M"
                className="p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-mono font-bold focus:outline-none focus:border-amber-500 uppercase"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Vehicle Preset</label>
              <select
                value={newVehicleType}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setNewVehicleType(val);
                  const sel = vehicleTypes.find((vt) => vt.id === val);
                  if (sel?.cargo_tonnage) setNewTonnage(sel.cargo_tonnage);
                }}
                className="p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-amber-500"
              >
                <option value={0}>Auto-resolve from classification…</option>
                {vehicleTypes
                  .filter((vt) => (newPurpose === 'cargo' ? vt.purpose === 'cargo' : vt.purpose !== 'cargo'))
                  .map((vt) => (
                    <option key={vt.id} value={vt.id}>
                      {vt.display_name} {vt.cargo_tonnage ? `(${vt.cargo_tonnage}T Payload)` : `(${vt.seat_capacity} seats)`}
                    </option>
                  ))}
              </select>
            </div>

            {newPurpose === 'cargo' && (
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Payload Tonnage (T)</label>
                <input
                  type="number"
                  step="0.5"
                  value={newTonnage}
                  onChange={(e) => setNewTonnage(parseFloat(e.target.value) || 0)}
                  className="w-28 p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-mono font-bold focus:outline-none focus:border-amber-500"
                />
              </div>
            )}

            <label className="flex items-center gap-2 pb-3 text-sm font-semibold text-slate-300">
              <input type="checkbox" checked={newElectric} onChange={(e) => setNewElectric(e.target.checked)} />
              EV 🔋
            </label>

            <button type="submit" className="px-5 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-xs transition shadow-lg">
              Add {newPurpose === 'cargo' ? '🚛 Lorry' : '👥 Vehicle'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
            Active Fleet Registry ({vehicles.length})
          </h3>
          <div className="flex items-center gap-2">
            {[
              { id: 'all', label: `All (${vehicles.length})` },
              { id: 'cargo', label: `🚛 Cargo Lorries (${vehicles.filter((v) => v.purpose === 'cargo').length})` },
              { id: 'passenger', label: `👥 Passenger PSVs (${vehicles.filter((v) => v.purpose !== 'cargo').length})` },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setAdminVehicleFilter(f.id as 'all' | 'cargo' | 'passenger')}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition border ${
                  adminVehicleFilter === f.id
                    ? 'bg-amber-500 text-slate-950 border-amber-400 font-black'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredVehicles.map((bus) => {
            const isCargo = bus.purpose === 'cargo';
            return (
              <div key={bus.id} className="bg-slate-950 p-5 rounded-xl border border-slate-800 flex justify-between items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-lg text-white font-mono">{bus.plate_number}</h4>
                    {isCargo ? (
                      <span className="bg-amber-500/15 text-amber-300 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded border border-amber-500/30">
                        🚛 Cargo Lorry · {bus.cargo_tonnage_capacity || 3.5}T
                      </span>
                    ) : (
                      <span className="bg-cyan-500/15 text-cyan-300 text-[10px] font-bold uppercase px-2 py-0.5 rounded border border-cyan-500/30">
                        👥 Passenger · {bus.seat_capacity} Seats
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 capitalize mt-1">
                    Class: {bus.vehicle_type_name || bus.category?.replace('_', ' ')}
                    {bus.driver_name ? ` · Driver: ${bus.driver_name}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {bus.is_electric ? (
                    <span className="bg-emerald-500/10 text-emerald-400 text-xs font-bold px-2.5 py-1 rounded-lg border border-emerald-500/20">
                      EV 🔋
                    </span>
                  ) : (
                    <span className="bg-slate-800 text-slate-300 text-xs font-bold px-2.5 py-1 rounded-lg">
                      Diesel
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
            );
          })}
          {filteredVehicles.length === 0 && (
            <p className="text-slate-500 text-sm col-span-2">No vehicles match the selected classification.</p>
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
  newRouteBaseFare: number;
  setNewRouteBaseFare: (v: number) => void;
  newRoutePerHop: number;
  setNewRoutePerHop: (v: number) => void;
  newRouteMatrix: string;
  setNewRouteMatrix: (v: string) => void;
  onCreateRoute: (e: React.FormEvent) => void;
  onDeleteRoute: (id: number) => void;
}) {
  const {
    routes, newRouteName, setNewRouteName, newRouteType, setNewRouteType,
    newRouteStops, setNewRouteStops, newRouteBaseFare, setNewRouteBaseFare,
    newRoutePerHop, setNewRoutePerHop, newRouteMatrix, setNewRouteMatrix,
    onCreateRoute, onDeleteRoute,
  } = props;

  return (
    <>
      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Create Route & Pricing Policy</h3>
        <form onSubmit={onCreateRoute} className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
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
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-800/80">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                Base Fare (KES)
              </label>
              <input
                type="number"
                min="0"
                step="10"
                value={newRouteBaseFare}
                onChange={(e) => setNewRouteBaseFare(Number(e.target.value))}
                placeholder="200"
                className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-blue-500"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">Starting flat boarding fare</span>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                Rate Per Stop / Hop (KES)
              </label>
              <input
                type="number"
                min="0"
                step="10"
                value={newRoutePerHop}
                onChange={(e) => setNewRoutePerHop(Number(e.target.value))}
                placeholder="150"
                className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-blue-500"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">Incremental cost per stop travelled</span>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                Stop-to-Stop Fare Matrix (Optional JSON)
              </label>
              <input
                value={newRouteMatrix}
                onChange={(e) => setNewRouteMatrix(e.target.value)}
                placeholder='{"Nairobi CBD-Nakuru": 500}'
                className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">Key format: &quot;Origin-Destination&quot;: Price</span>
            </div>
          </div>

          <div className="flex justify-between items-center pt-2">
            <p className="text-xs text-slate-500">
              {newRouteType === 'direct'
                ? 'Direct routes are non-stop origin → destination (exactly 2 stops).'
                : 'Stopwise routes allow boarding/alighting at every stop (relay chains).'}
            </p>
            <button type="submit" className="px-5 py-3 bg-blue-500 hover:bg-blue-400 text-white font-black rounded-xl transition">
              Create Route
            </button>
          </div>
        </form>
      </div>

      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Routes ({routes.length})</h3>
        <div className="space-y-4">
          {routes.map((route) => (
            <div key={route.id} className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
              <div className="flex justify-between items-center">
                <h4 className="font-bold text-white flex items-center gap-2">
                  {route.name}
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase ${
                    route.route_type === 'direct'
                      ? 'bg-blue-500/10 text-blue-300 border border-blue-500/30'
                      : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                  }`}>
                    {route.route_type ?? 'stopwise'}
                  </span>
                  <span className="text-xs font-bold text-cyan-400 bg-cyan-950/50 border border-cyan-800/50 px-2 py-0.5 rounded-full">
                    Base: KES {route.base_fare ?? 200} · +KES {route.per_hop_fare ?? 150}/hop
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

              {route.fare_matrix && Object.keys(route.fare_matrix).length > 0 && (
                <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800/80">
                  <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider block mb-1">
                    Stop-to-Stop Specific Fare Matrix
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(route.fare_matrix).map(([pair, fare]) => (
                      <span key={pair} className="text-xs font-mono bg-slate-950 text-amber-200 border border-amber-900/40 px-2 py-0.5 rounded">
                        {pair}: <strong className="text-white">KES {String(fare)}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              )}
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
  newTripFixedPrice: string;
  setNewTripFixedPrice: (v: string) => void;
  newTripAllowDriverTier: boolean;
  setNewTripAllowDriverTier: (v: boolean) => void;
  newTripMaxSurcharge: number;
  setNewTripMaxSurcharge: (v: number) => void;
  onCreateTrip: (e: React.FormEvent) => void;
  onDeleteTrip: (id: number) => void;
}) {
  const {
    trips, routes, vehicles, users, newTripName, setNewTripName, newTripRoute, setNewTripRoute,
    newTripVehicle, setNewTripVehicle, newTripDriver, setNewTripDriver,
    newTripFixedPrice, setNewTripFixedPrice, newTripAllowDriverTier, setNewTripAllowDriverTier,
    newTripMaxSurcharge, setNewTripMaxSurcharge, onCreateTrip, onDeleteTrip,
  } = props;

  return (
    <>
      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Schedule Trip & Pricing Governance</h3>
        <form onSubmit={onCreateTrip} className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Trip Name</label>
              <input
                value={newTripName}
                onChange={(e) => setNewTripName(e.target.value)}
                placeholder="Nairobi - Nakuru Morning"
                className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Route</label>
              <select
                value={newTripRoute}
                onChange={(e) => setNewTripRoute(Number(e.target.value))}
                className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white focus:outline-none focus:border-blue-500"
              >
                <option value={0}>Select…</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div className="w-44">
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Vehicle</label>
              <select
                value={newTripVehicle}
                onChange={(e) => setNewTripVehicle(Number(e.target.value))}
                className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white focus:outline-none focus:border-blue-500"
              >
                <option value={0}>—</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.plate_number}</option>
                ))}
              </select>
            </div>
            <div className="w-48">
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Driver</label>
              <select
                value={newTripDriver}
                onChange={(e) => setNewTripDriver(Number(e.target.value))}
                className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white focus:outline-none focus:border-blue-500"
              >
                <option value={0}>—</option>
                {users.filter((u) => u.role === 'driver').map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Pricing Governance Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-800/80 items-start">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                Fixed Express Price (KES, Optional)
              </label>
              <input
                type="number"
                min="0"
                step="50"
                value={newTripFixedPrice}
                onChange={(e) => setNewTripFixedPrice(e.target.value)}
                placeholder="e.g. 1200 (Overrides segment fare)"
                className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white focus:outline-none focus:border-blue-500"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">Sets flat express trip price regardless of hops</span>
            </div>

            <div className="flex flex-col justify-start">
              <label className="block text-xs font-bold text-slate-400 uppercase mb-2">
                Driver Dynamic Tier Authority
              </label>
              <label className="flex items-center gap-3 p-3 bg-slate-950 rounded-xl border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newTripAllowDriverTier}
                  onChange={(e) => setNewTripAllowDriverTier(e.target.checked)}
                  className="w-4 h-4 text-blue-500 rounded border-slate-700 focus:ring-blue-500"
                />
                <span className="text-xs font-semibold text-slate-300">
                  Allow driver to toggle rush/rain surcharge
                </span>
              </label>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                Max Allowed Surcharge Ceiling (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={newTripMaxSurcharge}
                onChange={(e) => setNewTripMaxSurcharge(Number(e.target.value))}
                disabled={!newTripAllowDriverTier}
                placeholder="25"
                className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white disabled:opacity-40 focus:outline-none focus:border-blue-500"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">Maximum % driver can increase base rate</span>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button type="submit" className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-black rounded-xl transition">
              Schedule Trip
            </button>
          </div>
        </form>
      </div>

      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Trips ({trips.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 uppercase text-xs">
                <th className="pb-3">ID</th>
                <th className="pb-3">Name</th>
                <th className="pb-3">Route</th>
                <th className="pb-3">Vehicle</th>
                <th className="pb-3">Pricing Policy</th>
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
                    {t.fixed_price != null ? (
                      <span className="bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 text-xs font-bold px-2 py-0.5 rounded-full inline-block">
                        Fixed KES {t.fixed_price}
                      </span>
                    ) : t.allow_driver_tier ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[11px] font-bold px-2 py-0.5 rounded-full inline-block w-fit">
                          Driver Tier (≤+{t.max_surcharge_pct}%)
                        </span>
                        <span className="text-[10px] text-slate-400">
                          Tier: <strong className="text-white capitalize">{t.driver_tier || 'standard'}</strong>
                        </span>
                      </div>
                    ) : (
                      <span className="bg-slate-800 text-slate-400 text-xs font-medium px-2 py-0.5 rounded-full">
                        Admin Base / Matrix
                      </span>
                    )}
                  </td>
                  <td className="py-3">
                    <span className="bg-slate-800 text-slate-300 text-xs font-bold px-2 py-1 rounded-full capitalize">{t.status}</span>
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetchManifest(t.id);
                            if (!res.manifest || res.manifest.length === 0) {
                              alert('No passengers booked on this trip yet.');
                              return;
                            }
                            const headers = ['Seat Number', 'Passenger Name', 'Phone', 'Boarding Stop', 'Alighting Stop', 'Status'];
                            const rows = res.manifest.map((m) => [
                              m.seat_number,
                              m.full_name || 'Passenger',
                              m.phone || 'N/A',
                              m.board_stop || `Stop ${m.board_stop_order}`,
                              m.alight_stop || `Stop ${m.alight_stop_order}`,
                              (m as { status?: string }).status || 'confirmed',
                            ]);
                            downloadCSV(`BUSGO_Manifest_Trip_${t.id}_${t.plate_number || 'Fleet'}_${new Date().toISOString().split('T')[0]}`, headers, rows);
                          } catch (e) {
                            alert(errMsg(e));
                          }
                        }}
                        className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-2 py-1.5 rounded-lg border border-slate-700 transition"
                        title="Download CSV Manifest"
                      >
                        CSV
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetchManifest(t.id);
                            if (!res.manifest || res.manifest.length === 0) {
                              alert('No passengers booked on this trip yet.');
                              return;
                            }
                            printPoliceManifest({
                              tripName: t.name,
                              routeName: t.route_name || 'Corridor Service',
                              vehiclePlate: t.plate_number || 'Fleet Matatu',
                              driverName: 'Assigned Driver',
                              departureTime: new Date().toLocaleString('en-KE'),
                              passengers: res.manifest.map((m) => ({
                                seat_number: m.seat_number,
                                passenger_name: m.full_name || 'Passenger',
                                phone: m.phone || '—',
                                board_stop: m.board_stop || `Stop ${m.board_stop_order}`,
                                alight_stop: m.alight_stop || `Stop ${m.alight_stop_order}`,
                                status: (m as { status?: string }).status || 'confirmed',
                              })),
                            });
                          } catch (e) {
                            alert(errMsg(e));
                          }
                        }}
                        className="text-xs bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-bold px-2 py-1.5 rounded-lg border border-amber-500/30 transition"
                        title="Print official Police/NTSA road manifest"
                      >
                        🖨️
                      </button>
                      <button
                        onClick={() => onDeleteTrip(t.id)}
                        className="text-xs bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 font-bold px-2 py-1.5 rounded-lg"
                      >
                        Delete
                      </button>
                    </div>
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
function PaymentsTab({ payments, onRefreshPayments }: { payments: PaymentRow[]; onRefreshPayments?: () => void }) {
  const [diag, setDiag] = useState<PaymentDiagnostics | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const loadDiagnostics = useCallback(async () => {
    try {
      setDiagLoading(true);
      const res = await fetchPaymentDiagnostics();
      setDiag(res);
    } catch (err) {
      console.error('Failed to load payment diagnostics', err);
    } finally {
      setDiagLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      loadDiagnostics();
    }, 0);
    return () => window.clearTimeout(t);
  }, [loadDiagnostics]);

  const handleExportCSV = () => {
    if (!payments || payments.length === 0) return;
    const headers = [
      'Payment ID',
      'Gateway Provider',
      'Status',
      'Amount (KES)',
      'Phone Number',
      'Gateway Reference',
      'Callback Verified',
      'Trip ID',
      'Seat Number',
    ];
    const rows = payments.map((p) => [
      p.id,
      p.provider,
      p.status,
      p.amount,
      p.phone_number ?? 'N/A',
      p.provider_reference ?? 'N/A',
      p.callback_verified ? 'YES' : 'NO',
      p.trip_id,
      p.seat_number,
    ]);
    const filename = `BUSGO_Payment_Ledger_${new Date().toISOString().split('T')[0]}`;
    downloadCSV(filename, headers, rows);
  };

  const handleSimulateWebhook = async (provider: 'paystack' | 'mpesa_daraja') => {
    try {
      setSimulating(true);
      setTestResult(null);
      const res = await testPaymentWebhook({ provider });
      setTestResult(`✓ [${provider.toUpperCase()}] ${res.message} (Booking #${res.booking_id}, Ref: ${res.reference}, KES ${res.amount})`);
      await loadDiagnostics();
      if (onRefreshPayments) onRefreshPayments();
    } catch (e) {
      setTestResult(`❌ Webhook simulation failed: ${errMsg(e)}`);
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Reconciliations Bar & CSV Export */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900 p-6 rounded-2xl border border-slate-800">
        <div>
          <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <span>Payment Gateway Diagnostics & Webhook Monitor</span>
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Real-time reconciliation for live Paystack checkout and Safaricom Daraja M-Pesa STK callbacks.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportCSV}
            disabled={payments.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:pointer-events-none text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition"
          >
            <span>📥</span>
            <span>Export Payments (CSV)</span>
          </button>
          <button
            onClick={() => {
              loadDiagnostics();
              if (onRefreshPayments) onRefreshPayments();
            }}
            disabled={diagLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-xs font-semibold rounded-lg border border-cyan-500/30 transition"
          >
            <span>🔄</span>
            <span>{diagLoading ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Test Webhook Notification banner if triggered */}
      {testResult && (
        <div
          className={`p-4 rounded-xl border text-xs font-mono flex items-center justify-between ${
            testResult.startsWith('✓')
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          <span>{testResult}</span>
          <button onClick={() => setTestResult(null)} className="text-slate-400 hover:text-white font-bold ml-4">
            ✕
          </button>
        </div>
      )}

      {/* Gateway Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Paystack Gateway Card */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center font-bold text-blue-400 text-lg">
                💳
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Paystack Gateway</h4>
                <span className="text-[11px] text-slate-400">Cards, M-Pesa, Mobile Money</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-xs font-bold text-emerald-400 uppercase">Live Active</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs bg-slate-950 p-3 rounded-xl border border-slate-800/80">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Status</span>
              <span className="font-semibold text-emerald-400">Configured & Healthy</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Mode</span>
              <span className="font-semibold text-white font-mono">LIVE PRODUCTION</span>
            </div>
            <div className="col-span-2">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Public Key</span>
              <span className="font-mono text-slate-400 text-[10px] truncate block">
                {diag?.gateways?.paystack?.public_key || 'pk_test_configured'}
              </span>
            </div>
          </div>

          <div className="pt-1 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">Reconciliation Webhook: Active</span>
            <button
              onClick={() => handleSimulateWebhook('paystack')}
              disabled={simulating}
              className="text-xs bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 font-bold px-3 py-1.5 rounded-lg border border-blue-500/30 transition flex items-center gap-1.5"
            >
              <span>⚡</span>
              <span>{simulating ? 'Testing...' : 'Simulate Paystack Webhook'}</span>
            </button>
          </div>
        </div>

        {/* Safaricom Daraja M-Pesa Card */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center font-bold text-emerald-400 text-lg">
                📱
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Safaricom Daraja</h4>
                <span className="text-[11px] text-slate-400">M-Pesa STK Express Push</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span className="text-xs font-bold text-emerald-400 uppercase">Ready</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs bg-slate-950 p-3 rounded-xl border border-slate-800/80">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Shortcode</span>
              <span className="font-semibold text-white font-mono">{diag?.gateways?.mpesa_daraja?.shortcode || '174379'}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Environment</span>
              <span className="font-semibold text-white uppercase font-mono">{diag?.gateways?.mpesa_daraja?.mode || 'Sandbox'}</span>
            </div>
            <div className="col-span-2">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">STK Callback URL</span>
              <span className="font-mono text-slate-400 text-[10px] truncate block">/api/pay/mpesa/callback</span>
            </div>
          </div>

          <div className="pt-1 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">C2B / STK Push: Listening</span>
            <button
              onClick={() => handleSimulateWebhook('mpesa_daraja')}
              disabled={simulating}
              className="text-xs bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 font-bold px-3 py-1.5 rounded-lg border border-emerald-500/30 transition flex items-center gap-1.5"
            >
              <span>⚡</span>
              <span>{simulating ? 'Testing...' : 'Simulate M-Pesa Webhook'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Summary KPI Pills */}
      {diag && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Transactions</span>
            <span className="text-lg font-bold text-white font-mono">{diag.summary.total_transactions}</span>
          </div>
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Completed / Verified</span>
            <span className="text-lg font-bold text-emerald-400 font-mono">{diag.summary.completed}</span>
          </div>
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Success Rate</span>
            <span className="text-lg font-bold text-cyan-300 font-mono">{diag.summary.success_rate_percent}%</span>
          </div>
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Revenue</span>
            <span className="text-lg font-bold text-white font-mono">{formatKSh(diag.summary.total_revenue)}</span>
          </div>
        </div>
      )}

      {/* Detailed Payment log table */}
      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Payment Ledger</h3>
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
                    <span
                      className={`text-xs font-bold px-2 py-1 rounded-full ${
                        p.provider === 'paystack'
                          ? 'bg-blue-500/10 text-blue-300'
                          : p.provider === 'mpesa_daraja'
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {p.provider}
                    </span>
                  </td>
                  <td className="py-3">
                    <span
                      className={`text-xs font-bold px-2 py-1 rounded-full capitalize ${
                        p.status === 'completed'
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : p.status === 'failed'
                          ? 'bg-rose-500/10 text-rose-300'
                          : 'bg-amber-500/10 text-amber-300'
                      }`}
                    >
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
                <tr>
                  <td colSpan={9} className="py-3 text-slate-500">
                    No payments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

