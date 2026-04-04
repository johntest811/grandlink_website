type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const GLOBAL_CACHE_KEY = "__grandlinkWebsiteServerCache";

function getStore() {
  const globalRef = globalThis as any;
  if (!globalRef[GLOBAL_CACHE_KEY]) {
    globalRef[GLOBAL_CACHE_KEY] = new Map<string, CacheEntry<unknown>>();
  }
  return globalRef[GLOBAL_CACHE_KEY] as Map<string, CacheEntry<unknown>>;
}

export function readServerMemoryCache<T>(key: string): T | null {
  const entry = getStore().get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    getStore().delete(key);
    return null;
  }
  return entry.value;
}

export function writeServerMemoryCache<T>(key: string, value: T, ttlMs: number) {
  const safeTtl = Math.max(1_000, Math.floor(ttlMs));
  getStore().set(key, {
    value,
    expiresAt: Date.now() + safeTtl,
  });
}

export function invalidateServerMemoryCacheByPrefix(prefix: string) {
  const store = getStore();
  const keys = Array.from(store.keys());
  for (const key of keys) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

export function invalidateServerMemoryCacheKey(key: string) {
  getStore().delete(key);
}