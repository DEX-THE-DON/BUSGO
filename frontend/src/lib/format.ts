/**
 * Shared display formatting for the BUSGO "fintech" telemetry style:
 *  - KSh currency columns (uniform, not mixed text styles)
 *  - trend indicators (▲ green / ▼ red with % change)
 */

/** Format an amount as a KSh value with 2 decimals, e.g. 12500.5 -> "KSh 12,500.50". */
export function formatKSh(amount: number | null | undefined): string {
  const value = Number(amount ?? 0);
  return `KSh ${value.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Compact KSh, e.g. 1_250_000 -> "KSh 1.25M". Good for big metrics. */
export function formatKShCompact(amount: number | null | undefined): string {
  const value = Number(amount ?? 0);
  if (Math.abs(value) >= 1_000_000) return `KSh ${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `KSh ${(value / 1_000).toFixed(1)}K`;
  return formatKSh(value);
}

/**
 * Compute the ▲/▼ trend vs the previous period.
 * Returns { arrow: '▲' | '▼' | '—', pct: number, positive: boolean }.
 */
export function trendInfo(current: number | null | undefined, previous: number | null | undefined) {
  const cur = Number(current ?? 0);
  const prev = Number(previous ?? 0);
  if (prev <= 0) {
    return cur > 0 ? { arrow: '▲', pct: 100, positive: true } : { arrow: '—', pct: 0, positive: true };
  }
  const pct = Math.round(((cur - prev) / prev) * 100);
  return {
    arrow: pct > 0 ? '▲' : pct < 0 ? '▼' : '—',
    pct,
    positive: pct >= 0,
  };
}
