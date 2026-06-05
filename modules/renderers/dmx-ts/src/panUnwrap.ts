/**
 * Map a compass heading (deg) onto a fixture pan that may span >360°, choosing the reachable
 * representation closest to the current pan. This lets the head continue past 360° (toward `maxDeg`)
 * instead of snapping back when the heading wraps.
 *
 * Canonical behaviour must stay aligned with the simulator-2d copy — update both together.
 */
export function panUnwrap(currentDeg: number, headingDeg: number, maxDeg: number): number {
  const h = ((headingDeg % 360) + 360) % 360;
  let best = h;
  let bestDist = Infinity;
  for (let candidate = h; candidate <= maxDeg; candidate += 360) {
    const dist = Math.abs(candidate - currentDeg);
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}
