// Persistence on raw IndexedDB: the gallery, plus a key-value store for progress and settings.
// Fails soft: where IndexedDB is missing or broken (some private modes) reads resolve empty, writes
// do nothing, and the app carries on without persisting.

export type Drawing = { id: number; lessonId: string | null; createdAt: number; png: Blob };

let dbp: Promise<IDBDatabase | null> | undefined;
const db = () => dbp ??= new Promise((resolve) => {
  // ponytail: iOS Safari has had bugs where open() never settles; give up after 3s rather than hang startup.
  setTimeout(() => resolve(null), 3000);
  try {
    const r = indexedDB.open('kids-drawing', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('gallery', { keyPath: 'id', autoIncrement: true });
      r.result.createObjectStore('kv');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
  } catch { resolve(null); }
});

/** One transaction on one store; resolves with the request's result once committed (undefined on any failure). */
async function tx<T>(store: 'gallery' | 'kv', mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void) {
  const d = await db();
  if (!d) return undefined;
  return new Promise<T | undefined>((resolve) => {
    try {
      const t = d.transaction(store, mode);
      const req = f(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = t.onabort = () => { console.warn('IndexedDB', t.error); resolve(undefined); };
    } catch (e) { console.warn('IndexedDB', e); resolve(undefined); }
  });
}

/** Save a PNG to the gallery; resolves with its id (undefined if nothing persists). */
export const saveDrawing = (png: Blob, lessonId: string | null) =>
  tx<IDBValidKey>('gallery', 'readwrite', (s) => s.add({ lessonId, createdAt: Date.now(), png })) as Promise<number | undefined>;

/** Newest first. */
export const listDrawings = async () => ((await tx<Drawing[]>('gallery', 'readonly', (s) => s.getAll())) ?? []).reverse();

export const deleteDrawing = (id: number) => tx('gallery', 'readwrite', (s) => { s.delete(id); });

export const getCompleted = async () => (await tx<string[]>('kv', 'readonly', (s) => s.get('completed'))) ?? [];

export const markCompleted = (lessonId: string) => tx('kv', 'readwrite', (s) => {
  const r = s.get('completed');
  r.onsuccess = () => {
    const ids: string[] = r.result ?? [];
    if (!ids.includes(lessonId)) s.put([...ids, lessonId], 'completed');
  };
});

export const resetProgress = () => tx('kv', 'readwrite', (s) => { s.delete('completed'); });

export const getSetting = async <T>(key: string, fallback: T) =>
  ((await tx<T>('kv', 'readonly', (s) => s.get(`setting:${key}`))) ?? fallback) as T;

export const setSetting = (key: string, value: unknown) => tx('kv', 'readwrite', (s) => {
  s.put(value, `setting:${key}`);
  s.transaction.commit?.(); // flush now: a toggle should survive the app being closed right after
});
