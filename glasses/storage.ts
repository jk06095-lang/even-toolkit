/**
 * Persistent storage for Even Hub apps.
 *
 * Writes to BOTH the SDK bridge AND browser localStorage.
 * Reads from SDK bridge first, falls back to localStorage.
 * This ensures persistence on the real Even Hub (bridge)
 * and in development/simulator (localStorage).
 */

function getBridge(): any {
  const bridge = (window as any).__evenBridge;
  if (bridge?.setLocalStorage) return bridge;
  if (bridge?.rawBridge?.setLocalStorage) return bridge.rawBridge;
  return null;
}

async function getRawBridge(): Promise<any> {
  const existing = getBridge();
  if (existing) return existing;
  try {
    const { EvenBetterSdk } = await import('@jappyjan/even-better-sdk');
    const raw = await Promise.race([
      EvenBetterSdk.getRawBridge(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    return raw;
  } catch {
    return null;
  }
}

/** Read a JSON value — tries SDK bridge first, then localStorage */
export async function storageGet<T>(key: string, fallback: T): Promise<T> {
  const bridge = getBridge() ?? await getRawBridge();
  if (bridge?.getLocalStorage) {
    try {
      const raw = await bridge.getLocalStorage(key);
      if (raw && raw !== '') return JSON.parse(raw);
    } catch { /* fall through */ }
  }
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return fallback;
}

/** Read a raw string — tries SDK bridge first, then localStorage */
export async function storageGetRaw(key: string): Promise<string> {
  const bridge = getBridge() ?? await getRawBridge();
  if (bridge?.getLocalStorage) {
    try {
      const val = await bridge.getLocalStorage(key);
      if (val && val !== '') return val;
    } catch { /* fall through */ }
  }
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

/** Write a JSON value to BOTH SDK bridge and localStorage */
export async function storageSet(key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  try { localStorage.setItem(key, json); } catch { /* ignore */ }
  const bridge = getBridge();
  if (bridge?.setLocalStorage) {
    try { await bridge.setLocalStorage(key, json); } catch { /* ignore */ }
  }
}

/** Write a raw string to BOTH SDK bridge and localStorage */
export async function storageSetRaw(key: string, value: string): Promise<void> {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
  const bridge = getBridge();
  if (bridge?.setLocalStorage) {
    try { await bridge.setLocalStorage(key, value); } catch { /* ignore */ }
  }
}

/** Remove a key from BOTH SDK bridge and localStorage */
export async function storageRemove(key: string): Promise<void> {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
  const bridge = getBridge();
  if (bridge?.setLocalStorage) {
    try { await bridge.setLocalStorage(key, ''); } catch { /* ignore */ }
  }
}
