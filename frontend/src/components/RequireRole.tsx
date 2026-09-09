'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

/**
 * Client-side role guard. While the session is loading it shows a spinner;
 * if the user is not authenticated or lacks one of the allowed roles it
 * redirects to /login.
 */
export default function RequireRole({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { user, loading, requireRole } = useAuth();
  const router = useRouter();

  const isAuthorized = Boolean(user && requireRole(...roles));

  React.useEffect(() => {
    if (!loading && !isAuthorized && typeof window !== 'undefined') {
      router.replace('/login');
    }
  }, [loading, isAuthorized, router]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <p className="text-slate-400 animate-pulse">Loading…</p>
      </main>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return <>{children}</>;
}
