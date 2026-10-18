/** A small fixed-window rate limiter: at most `limit` calls per `windowMs` for each key. Pure and clock-injectable. */
export function makeRateLimiter(limit: number, windowMs: number, maxKeys = 5000) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string, now = Date.now()): boolean => {
    const e = hits.get(key);
    if (!e || now >= e.resetAt) {
      if (hits.size >= maxKeys) for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
      if (hits.size >= maxKeys) hits.clear(); // never grow without bound
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    e.count++;
    return e.count <= limit;
  };
}
