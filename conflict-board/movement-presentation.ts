import type { Formation } from './types';

/** Reused from the Lab: current square excluded; depth 1 is nearest fallback. */
export function retreatShade(f: Pick<Formation, 'history' | 'position'>, position: string) {
  const route = f.history.filter(p => p !== f.position).slice().reverse();
  const index = route.indexOf(position);
  return index < 0 ? null : {depth: index + 1, color: `hsl(270 40% ${44 - 26 * index / Math.max(1, route.length - 1)}%)`};
}

/** Conditional presentation, never a simulation or a route/order authority.
 * The resolver allows step 2 only for the server-projected Speed specialization.
 * Fighting, retreat, merging, weather, withdrawal and deadlines can interrupt it. */
export function queuedRouteHints(row: { formation: Formation; stats?: {specialization: string}; traveling?: boolean }, timing: {
  nextCycleAt: number; resolutionIntervalMs?: number; arriveAt?: number;
}) {
  const f = row.formation;
  if (f.order.kind !== 'move') return [];
  const interval = timing.resolutionIntervalMs;
  const known = Boolean(row.stats && (!row.traveling || (interval && Number.isFinite(timing.arriveAt))));
  const delayed = row.traveling && known ? Math.max(0, Math.ceil((timing.arriveAt! - timing.nextCycleAt) / interval!)) : 0;
  const steps = row.stats?.specialization === 'Speed' ? 2 : 1;
  return f.order.route.map((position, index) => ({position, step: index + 1,
    resolution: known && !f.order.paused ? delayed + Math.floor(index / steps) + 1 : null,
  }));
}
