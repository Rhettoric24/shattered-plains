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

export const SAFETY_RECONCILIATION_MS = 5 * 60 * 1000;

export function createSubscriptionLifecycle({ createClient, debounceMs = 50, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let sessionKey = null;
  let client = null;
  let batchTimer = null;
  let revision = 0;
  let onBatch = () => {};
  let onError = () => {};
  const subscriptions = new Map();
  const pendingValues = new Map();
  const waiters = new Set();

  function flush() {
    batchTimer = null;
    if (pendingValues.size === 0) return;
    const batch = new Map(pendingValues);
    pendingValues.clear();
    onBatch(batch);
  }

  function record(key, value) {
    revision += 1;
    pendingValues.set(key, value);
    for (const waiter of [...waiters]) {
      if (revision > waiter.afterRevision) {
        clearTimer(waiter.timer);
        waiters.delete(waiter);
        waiter.resolve(true);
      }
    }
    if (batchTimer === null) batchTimer = setTimer(flush, debounceMs);
  }

  async function dispose() {
    if (batchTimer !== null) clearTimer(batchTimer);
    batchTimer = null;
    pendingValues.clear();
    for (const { unsubscribe } of subscriptions.values()) unsubscribe();
    subscriptions.clear();
    for (const waiter of waiters) {
      clearTimer(waiter.timer);
      waiter.resolve(false);
    }
    waiters.clear();
    const closingClient = client;
    client = null;
    sessionKey = null;
    if (closingClient) await closingClient.close();
  }

  return {
    start(nextSessionKey, authTokenFetcher, handlers = {}) {
      if (client && sessionKey === nextSessionKey) return false;
      if (client) void dispose();
      sessionKey = nextSessionKey;
      onBatch = handlers.onBatch || (() => {});
      onError = handlers.onError || (() => {});
      client = createClient();
      client.setAuth(authTokenFetcher);
      return true;
    },
    sync(specs) {
      if (!client) return;
      const unique = new Map(specs.map((spec) => [spec.key, spec]));
      for (const [key, active] of subscriptions) {
        const next = unique.get(key);
        if (next && next.query === active.query) continue;
        active.unsubscribe();
        subscriptions.delete(key);
      }
      for (const [key, spec] of unique) {
        if (subscriptions.has(key)) continue;
        const unsubscribe = client.onUpdate(
          spec.query,
          spec.args || {},
          (value) => record(key, value),
          (error) => onError(error, key),
        );
        subscriptions.set(key, { query: spec.query, unsubscribe });
      }
    },
    get revision() { return revision; },
    get size() { return subscriptions.size; },
    get active() { return Boolean(client); },
    waitForUpdateAfter(afterRevision, timeoutMs) {
      if (revision > afterRevision) return Promise.resolve(true);
      return new Promise((resolve) => {
        const waiter = { afterRevision, resolve, timer: null };
        waiter.timer = setTimer(() => {
          waiters.delete(waiter);
          resolve(false);
        }, timeoutMs);
        waiters.add(waiter);
      });
    },
    dispose,
  };
}
