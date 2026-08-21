export function createSessionQueryCache() {
  let sessionKey = null;
  const values = new Map();
  const pending = new Map();
  return {
    setSession(nextSessionKey) {
      if (sessionKey === nextSessionKey) return;
      sessionKey = nextSessionKey;
      values.clear();
      pending.clear();
    },
    async get(key, loader) {
      if (values.has(key)) return values.get(key);
      if (pending.has(key)) return pending.get(key);
      const request = Promise.resolve().then(loader).then((value) => {
        values.set(key, value);
        pending.delete(key);
        return value;
      }, (error) => {
        pending.delete(key);
        throw error;
      });
      pending.set(key, request);
      return request;
    },
    set(key, value) { values.set(key, value); pending.delete(key); },
    invalidate(key) { values.delete(key); pending.delete(key); },
    clear() { sessionKey = null; values.clear(); pending.clear(); },
  };
}

export function projectGameClock(clock, realMsPerGameDay, now = Date.now()) {
  if (!clock || !Number.isFinite(clock.elapsedGameDays)) return null;
  const elapsedSinceSync = Math.max(0, now - Number(clock.browserReceivedAt || now));
  const elapsedGameDays = clock.elapsedGameDays + elapsedSinceSync / Math.max(1, Number(realMsPerGameDay) || 1);
  const day = Math.floor(elapsedGameDays) + 1;
  const hour = Math.floor((elapsedGameDays % 1) * 24);
  return { day, hour, elapsedGameDays, label: `Day ${day}, hour ${hour}` };
}

export function routeNeedsChronicle(route) {
  return route?.view === "chronicle";
}
