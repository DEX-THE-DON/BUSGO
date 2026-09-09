'use client';

import React, { useState, useEffect } from 'react';
import { fetchSaccos, createSacco, updateSacco, Sacco, errMsg } from '@/services/api';

export default function SaccoManager() {
  const [saccos, setSaccos] = useState<Sacco[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSacco, setEditingSacco] = useState<Sacco | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [regNo, setRegNo] = useState('');
  const [hq, setHq] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#06b6d4');
  const [accentColor, setAccentColor] = useState('#f43f5e');
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await fetchSaccos();
      setSaccos(data.saccos || []);
    } catch (err: unknown) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateModal = () => {
    setEditingSacco(null);
    setName('');
    setSlug('');
    setRegNo('');
    setHq('');
    setPhone('');
    setEmail('');
    setPrimaryColor('#06b6d4');
    setAccentColor('#f43f5e');
    setIsModalOpen(true);
  };

  const openEditModal = (s: Sacco) => {
    setEditingSacco(s);
    setName(s.name);
    setSlug(s.slug);
    setRegNo(s.registration_no || '');
    setHq(s.headquarters || '');
    setPhone(s.contact_phone || '');
    setEmail(s.contact_email || '');
    setPrimaryColor(s.primary_color || '#06b6d4');
    setAccentColor(s.accent_color || '#f43f5e');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) {
      setError('SACCO Name and Unique Slug are required.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      if (editingSacco) {
        await updateSacco(editingSacco.id, {
          name,
          slug,
          registration_no: regNo || undefined,
          headquarters: hq || undefined,
          contact_phone: phone || undefined,
          contact_email: email || undefined,
          primary_color: primaryColor,
          accent_color: accentColor,
        });
        setSuccess(`SACCO "${name}" updated successfully.`);
      } else {
        await createSacco({
          name,
          slug,
          registration_no: regNo || undefined,
          headquarters: hq || undefined,
          contact_phone: phone || undefined,
          contact_email: email || undefined,
          primary_color: primaryColor,
          accent_color: accentColor,
        });
        setSuccess(`New SACCO "${name}" registered into BUSGO ecosystem.`);
      }
      setIsModalOpen(false);
      loadData();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: unknown) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 p-6 rounded-2xl border border-white/10 backdrop-blur-xl">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-xl">
              🏢
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-wide">
                Kenyan SACCO Tenants &amp; Fleets
              </h2>
              <p className="text-xs text-slate-400">
                Multi-tenant management for authorized transport cooperatives (Super Metro, 2NK, Easy Coach, Tahmeed)
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            disabled={loading}
            className="px-4 py-2 text-xs font-semibold text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition flex items-center gap-2"
          >
            <span className={loading ? 'animate-spin' : ''}>🔄</span> Refresh
          </button>
          <button
            onClick={openCreateModal}
            className="px-4 py-2 text-xs font-semibold text-black bg-gradient-to-r from-cyan-400 to-emerald-400 hover:opacity-90 rounded-xl transition shadow-lg shadow-cyan-500/20 flex items-center gap-2"
          >
            <span>➕</span> Register SACCO
          </button>
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

      {/* SACCO Cards Grid */}
      {loading && saccos.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-56 bg-slate-900/40 border border-white/5 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : saccos.length === 0 ? (
        <div className="p-12 text-center bg-slate-900/40 rounded-2xl border border-white/10 text-slate-400">
          <p className="text-base font-semibold">No SACCOs Registered</p>
          <p className="text-xs mt-1">Click &quot;Register SACCO&quot; to onboard the first transport cooperative.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {saccos.map((s) => (
            <div
              key={s.id}
              className="relative overflow-hidden bg-slate-900/70 border border-white/10 rounded-2xl p-6 backdrop-blur-xl hover:border-white/25 transition-all shadow-xl group"
            >
              {/* SACCO Brand Color Top Banner Stripe */}
              <div
                className="absolute top-0 left-0 right-0 h-1.5"
                style={{
                  background: `linear-gradient(90deg, ${s.primary_color || '#06b6d4'}, ${s.accent_color || '#f43f5e'})`,
                }}
              />

              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center font-black text-lg text-white shadow-inner"
                    style={{ backgroundColor: `${s.primary_color || '#06b6d4'}33`, borderColor: s.primary_color || '#06b6d4', borderWidth: 1 }}
                  >
                    {s.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white group-hover:text-cyan-400 transition">
                      {s.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-white/5 text-slate-400 border border-white/5">
                        {s.slug}
                      </span>
                      {s.registration_no && (
                        <span className="text-[10px] text-slate-400">
                          {s.registration_no}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => openEditModal(s)}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white transition text-xs"
                  title="Edit SACCO"
                >
                  ✏️
                </button>
              </div>

              {/* Details & Location */}
              <div className="mt-4 space-y-1.5 text-xs text-slate-300 border-t border-white/5 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">HQ Stage:</span>
                  <span className="font-medium text-slate-200">{s.headquarters || 'Nairobi Central'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Dispatch Phone:</span>
                  <span className="font-mono text-slate-200">{s.contact_phone || '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Email:</span>
                  <span className="text-slate-200 truncate max-w-[160px]">{s.contact_email || '—'}</span>
                </div>
              </div>

              {/* Stats Footer */}
              <div className="mt-5 grid grid-cols-3 gap-2 bg-black/40 rounded-xl p-3 border border-white/5">
                <div className="text-center">
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">Fleet</div>
                  <div className="text-sm font-bold text-cyan-400">{s.fleet_count ?? 0} buses</div>
                </div>
                <div className="text-center border-x border-white/10">
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">Routes</div>
                  <div className="text-sm font-bold text-emerald-400">{s.routes_count ?? 0}</div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">NTSA Score</div>
                  <div className="text-sm font-bold text-amber-400">{s.compliance_score ?? 100}%</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Create or Edit SACCO */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-slate-900 border border-white/15 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <span>{editingSacco ? '✏️ Edit SACCO' : '➕ Register New SACCO'}</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    SACCO Official Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (!editingSacco && !slug) {
                        setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '_'));
                      }
                    }}
                    placeholder="e.g. Super Metro Sacco"
                    className="w-full px-3 py-2 text-sm bg-slate-800 border border-white/10 rounded-xl text-white focus:border-cyan-400 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Unique Slug / Code *
                  </label>
                  <input
                    type="text"
                    required
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    placeholder="e.g. super_metro"
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-800 border border-white/10 rounded-xl text-white focus:border-cyan-400 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Registration No (NTSA/Co-op)
                  </label>
                  <input
                    type="text"
                    value={regNo}
                    onChange={(e) => setRegNo(e.target.value)}
                    placeholder="e.g. CPR/2013/10294"
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-800 border border-white/10 rounded-xl text-white focus:border-cyan-400 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Headquarters / Main Stage
                  </label>
                  <input
                    type="text"
                    value={hq}
                    onChange={(e) => setHq(e.target.value)}
                    placeholder="e.g. Nairobi CBD"
                    className="w-full px-3 py-2 text-sm bg-slate-800 border border-white/10 rounded-xl text-white focus:border-cyan-400 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Dispatch Phone
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+254 700 000 000"
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-800 border border-white/10 rounded-xl text-white focus:border-cyan-400 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Contact Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="info@sacco.co.ke"
                    className="w-full px-3 py-2 text-sm bg-slate-800 border border-white/10 rounded-xl text-white focus:border-cyan-400 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 p-3 bg-black/40 rounded-xl border border-white/5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Primary Brand Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0"
                    />
                    <span className="text-xs font-mono text-slate-300">{primaryColor}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Accent Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0"
                    />
                    <span className="text-xs font-mono text-slate-300">{accentColor}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 text-xs font-bold text-black bg-cyan-400 hover:bg-cyan-300 rounded-xl transition shadow-lg shadow-cyan-500/20 flex items-center gap-2"
                >
                  {saving ? 'Saving...' : editingSacco ? 'Save Changes' : 'Register SACCO'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

