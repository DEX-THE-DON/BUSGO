'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  fetchLostFoundItems,
  reportLostFoundItem,
  claimLostFoundItem,
  LostFoundItem,
  errMsg,
} from '@/services/api';

const CATEGORIES = [
  { id: 'all', label: 'All Categories' },
  { id: 'luggage', label: '🧳 Luggage / Bags' },
  { id: 'electronics', label: '📱 Phones & Laptops' },
  { id: 'wallet_id', label: '🪪 Wallets & National IDs' },
  { id: 'documents', label: '📄 Documents & Folders' },
  { id: 'clothing', label: '🧥 Jackets & Clothing' },
  { id: 'other', label: '📦 Other Parcels' },
];

export default function LostFoundPage() {
  const [items, setItems] = useState<LostFoundItem[]>([]);
  const [itemTypeFilter, setItemTypeFilter] = useState<'all' | 'lost' | 'found'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Modal State
  const [showReportModal, setShowReportModal] = useState(false);
  const [modalItemType, setModalItemType] = useState<'lost' | 'found'>('lost');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('luggage');
  const [description, setDescription] = useState('');
  const [locationOrStation, setLocationOrStation] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('2547');
  const [submitting, setSubmitting] = useState(false);

  // Claim Modal State
  const [claimingItem, setClaimingItem] = useState<LostFoundItem | null>(null);
  const [claimantPhone, setClaimantPhone] = useState('2547');
  const [claimantNotes, setClaimantNotes] = useState('');
  const [claimSubmitting, setClaimSubmitting] = useState(false);

  const loadItems = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await fetchLostFoundItems({
        item_type: itemTypeFilter === 'all' ? undefined : itemTypeFilter,
        category: categoryFilter === 'all' ? undefined : categoryFilter,
        q: searchQuery.trim() || undefined,
      });
      setItems(data.items);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [itemTypeFilter, categoryFilter, searchQuery]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const res = await reportLostFoundItem({
        item_type: modalItemType,
        category,
        title: title.trim(),
        description: description.trim(),
        location_or_station: locationOrStation.trim(),
        contact_name: contactName.trim(),
        contact_phone: contactPhone.trim(),
      });
      setSuccessMsg(res.message);
      setShowReportModal(false);
      setTitle('');
      setDescription('');
      setLocationOrStation('');
      await loadItems();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimingItem) return;
    setClaimSubmitting(true);
    setError('');
    try {
      const res = await claimLostFoundItem(claimingItem.id, {
        claimant_phone: claimantPhone.trim(),
        claimant_notes: claimantNotes.trim(),
      });
      setSuccessMsg(res.message);
      setClaimingItem(null);
      await loadItems();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setClaimSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#07090e] text-slate-100 p-4 sm:p-8">
      {/* Header */}
      <div className="max-w-6xl mx-auto mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">🧳</span>
              <h1 className="text-xl sm:text-2xl font-black uppercase tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-sky-300 to-emerald-400">
                &quot;Nipe Shugli&quot; &bull; Highway Lost &amp; Found Registry
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              National PSV Item Recovery Ledger &bull; Report Forgotten Baggage &bull; Stage Depot Retrieval
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setModalItemType('lost');
                setShowReportModal(true);
              }}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black transition shadow-md shadow-rose-950/40 flex items-center gap-1.5"
            >
              <span>🔍</span> Report Lost Item
            </button>
            <button
              onClick={() => {
                setModalItemType('found');
                setShowReportModal(true);
              }}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition shadow-md shadow-emerald-950/40 flex items-center gap-1.5"
            >
              <span>✓</span> Log Found Item
            </button>
            <Link
              href="/"
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition"
            >
              Home &rarr;
            </Link>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3.5 rounded-2xl bg-rose-950/70 border border-rose-800 text-rose-300 text-xs">
            ⚠️ {error}
          </div>
        )}
        {successMsg && (
          <div className="mt-4 p-3.5 rounded-2xl bg-emerald-950/70 border border-emerald-500 text-emerald-300 text-xs flex items-center justify-between">
            <span>{successMsg}</span>
            <button onClick={() => setSuccessMsg('')} className="text-slate-400 hover:text-white">✕</button>
          </div>
        )}
      </div>

      <div className="max-w-6xl mx-auto space-y-6">
        {/* Filter Controls Bar */}
        <div className="p-4 sm:p-5 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Search Input */}
            <div className="sm:col-span-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search items, bags, laptops, stages..."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
              />
            </div>

            {/* Type Toggle */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800">
              <button
                onClick={() => setItemTypeFilter('all')}
                className={`flex-1 py-1 text-xs font-bold rounded-lg transition ${
                  itemTypeFilter === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setItemTypeFilter('lost')}
                className={`flex-1 py-1 text-xs font-bold rounded-lg transition ${
                  itemTypeFilter === 'lost' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' : 'text-slate-400'
                }`}
              >
                Lost ({items.filter((i) => i.item_type === 'lost').length})
              </button>
              <button
                onClick={() => setItemTypeFilter('found')}
                className={`flex-1 py-1 text-xs font-bold rounded-lg transition ${
                  itemTypeFilter === 'found' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'text-slate-400'
                }`}
              >
                Found ({items.filter((i) => i.item_type === 'found').length})
              </button>
            </div>

            {/* Category Select */}
            <div>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 text-xs font-bold text-white focus:outline-none focus:border-cyan-400"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Item Cards Grid */}
        {loading ? (
          <div className="p-16 text-center text-slate-400 text-xs animate-pulse">
            Searching Lost &amp; Found registry...
          </div>
        ) : items.length === 0 ? (
          <div className="p-16 text-center rounded-3xl bg-slate-900 border border-slate-800">
            <span className="text-4xl block mb-2">📭</span>
            <h3 className="text-sm font-black text-white">No items found</h3>
            <p className="text-xs text-slate-400 mt-1">
              Try adjusting your search filters, or report a new lost or found item.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((it) => {
              const isLost = it.item_type === 'lost';
              const isClaimed = it.status === 'claimed' || it.status === 'resolved';

              return (
                <div
                  key={it.id}
                  className="p-5 rounded-3xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition shadow-lg flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          isClaimed
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            : isLost
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        }`}
                      >
                        {isClaimed ? '✓ Claimed / Returned' : isLost ? '🔍 Lost' : '📦 Found'}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        #{it.id} &bull; {it.category}
                      </span>
                    </div>

                    <h3 className="text-sm font-black text-white line-clamp-1">{it.title}</h3>
                    <p className="text-xs text-slate-300 mt-1.5 line-clamp-2">{it.description}</p>

                    <div className="mt-4 p-3 bg-slate-950 rounded-2xl border border-slate-800 text-[11px] space-y-1">
                      <div className="flex items-center gap-1.5 text-slate-300">
                        <span>📍</span>
                        <span className="truncate">{it.location_or_station}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-400 font-mono">
                        <span>📞</span>
                        <span>{it.contact_phone} ({it.contact_name})</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">
                      {it.created_at ? new Date(it.created_at).toLocaleDateString() : 'Recent'}
                    </span>

                    {!isClaimed && (
                      <button
                        onClick={() => {
                          setClaimingItem(it);
                          setClaimantPhone(it.contact_phone || '2547');
                        }}
                        className="px-3 py-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-bold text-xs transition"
                      >
                        Claim / Verify &rarr;
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-black text-white uppercase">
                {modalItemType === 'lost' ? '🔍 Report Lost Item' : '📦 Log Found Item'}
              </h3>
              <button onClick={() => setShowReportModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleReport} className="space-y-3.5">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  Item Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Black HP Laptop Bag, National ID (John Doe)"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-white"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 text-xs text-white"
                  >
                    <option value="luggage">Luggage / Bags</option>
                    <option value="electronics">Phones &amp; Laptops</option>
                    <option value="wallet_id">Wallets &amp; IDs</option>
                    <option value="documents">Documents</option>
                    <option value="clothing">Clothing</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                    Stage / Vehicle Location
                  </label>
                  <input
                    type="text"
                    value={locationOrStation}
                    onChange={(e) => setLocationOrStation(e.target.value)}
                    placeholder="e.g. Tea Room Terminal, Vehicle KDD 123X"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  Description &amp; Identifying Marks
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Color, brand, contents, or where it was left on the vehicle..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                    Contact Name
                  </label>
                  <input
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Your Name"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                    Contact Phone
                  </label>
                  <input
                    type="text"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="2547..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-cyan-400"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-gradient-to-r from-cyan-500 to-emerald-600 hover:from-cyan-400 hover:to-emerald-500 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider transition mt-2 disabled:opacity-50"
              >
                {submitting ? 'Registering Entry...' : 'Submit to National Registry'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Claim / Verify Modal */}
      {claimingItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-amber-500/50 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-black text-white">Claim Item #{claimingItem.id}</h3>
              <button onClick={() => setClaimingItem(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <p className="text-xs text-slate-300">
              You are verifying pickup for <strong className="text-amber-300">{claimingItem.title}</strong>.
            </p>

            <form onSubmit={handleClaim} className="space-y-3.5">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  Claimant M-Pesa / Phone Number
                </label>
                <input
                  type="text"
                  value={claimantPhone}
                  onChange={(e) => setClaimantPhone(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-cyan-400"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  Verification Notes / ID Check
                </label>
                <textarea
                  rows={2}
                  value={claimantNotes}
                  onChange={(e) => setClaimantNotes(e.target.value)}
                  placeholder="e.g. National ID verified at Tea Room counter by Clerk Kamau"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={claimSubmitting}
                className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider transition disabled:opacity-50"
              >
                {claimSubmitting ? 'Resolving...' : '✓ Confirm Pickup & Mark Resolved'}
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

