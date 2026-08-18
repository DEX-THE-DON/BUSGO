'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { errMsg } from '@/services/api';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const homeForRole = (role: string) => {
    if (role === 'admin') return '/admin';
    if (role === 'driver') return '/driver';
    return '/user';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const user = await login(email, password);
      router.replace(homeForRole(user.role));
    } catch (err) {
      setError(errMsg(err) || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-slate-900 p-8 rounded-3xl border border-slate-800 shadow-2xl">
        <h1 className="text-3xl font-black text-emerald-400">BUSGO</h1>
        <p className="text-slate-400 text-sm mt-1 mb-6">Sign in to your transit account</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@busgo.test"
              className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-emerald-500"
            />
          </div>

          {error && <p className="text-rose-400 text-xs font-bold">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-black rounded-xl transition-all"
          >
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-800 text-center text-sm text-slate-400">
          <p>
            No account?{' '}
            <Link href="/register" className="text-emerald-400 font-bold hover:underline">
              Register
            </Link>
          </p>
        </div>

        <div className="mt-5 text-xs text-slate-500 bg-slate-950/60 border border-slate-800 rounded-xl p-3 space-y-1">
          <p className="font-bold text-slate-400 uppercase tracking-wider">Demo accounts</p>
          <p>admin@busgo.test / admin123</p>
          <p>driver1@busgo.test / driver123</p>
          <p>passenger1@busgo.test / pass123</p>
        </div>
      </div>
    </main>
  );
}
