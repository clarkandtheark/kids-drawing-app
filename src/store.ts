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
export const saveDrawing = (png: Blob, lessonId: string | null, createdAt = Date.now()) =>
  tx<IDBValidKey>('gallery', 'readwrite', (s) => s.add({ lessonId, createdAt, png })) as Promise<number | undefined>;

const pad = (n: number) => String(n).padStart(2, '0');
/** File name by local date and lesson: 2026-10-04_15-30-12_cat_7.png (the id keeps names unique). */
export function drawingName(d: Drawing) {
  const t = new Date(d.createdAt);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}_${pad(t.getHours())}-${pad(t.getMinutes())}-${pad(t.getSeconds())}_${d.lessonId ?? 'free'}_${d.id}.png`;
}
/** Inverse of drawingName, for importing; names it doesn't recognise import as free drawings made now. */
export function parseDrawingName(name: string) {
  const m = name.match(/^(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)-(\d\d)_(.+)_\d+\.png$/i);
  if (!m) return { createdAt: Date.now(), lessonId: null };
  return { createdAt: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(), lessonId: m[7] === 'free' ? null : m[7] };
}

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
