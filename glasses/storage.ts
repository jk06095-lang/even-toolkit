/**
 * Persistent storage for Even Hub apps.
 *
 * Uses the SDK bridge's setLocalStorage/getLocalStorage directly.
 * No browser localStorage, no caching — the SDK bridge is the single source of truth.
 * Falls back silently when SDK is not available (web/dev).
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

/** Read a JSON value from SDK storage */
export async function storageGet<T>(key: string, fallback: T): Promise<T> {
  const bridge = getBridge() ?? await getRawBridge();
  if (!bridge?.getLocalStorage) return fallback;
  try {
    const raw = await bridge.getLocalStorage(key);
    if (raw && raw !== '') return JSON.parse(raw);
  } catch { /* ignore */ }
  return fallback;
}

/** Read a raw string from SDK storage */
export async function storageGetRaw(key: string): Promise<string> {
  const bridge = getBridge() ?? await getRawBridge();
  if (!bridge?.getLocalStorage) return '';
  try {
    return await bridge.getLocalStorage(key);
  } catch {
    return '';
  }
}

/** Write a JSON value to SDK storage */
export async function storageSet(key: string, value: unknown): Promise<void> {
  const bridge = getBridge();
  if (!bridge?.setLocalStorage) return;
  try {
    await bridge.setLocalStorage(key, JSON.stringify(value));
  } catch { /* ignore */ }
}

/** Write a raw string to SDK storage */
export async function storageSetRaw(key: string, value: string): Promise<void> {
  const bridge = getBridge();
  if (!bridge?.setLocalStorage) return;
  try {
    await bridge.setLocalStorage(key, value);
  } catch { /* ignore */ }
}

/** Remove a key from SDK storage */
export async function storageRemove(key: string): Promise<void> {
  const bridge = getBridge();
  if (!bridge?.setLocalStorage) return;
  try {
    await bridge.setLocalStorage(key, '');
  } catch { /* ignore */ }
}
