/**
 * IndexedDB write-through buffer for recording chunks.
 *
 * WHY:
 * MediaRecorder hands us a chunk every few seconds. If we only hold chunks in
 * memory and the tab crashes / is refreshed / loses network, the recording is
 * lost. Riverside-style reliability comes from persisting every chunk to disk
 * (IndexedDB) BEFORE attempting upload, and only deleting it once the segment
 * is safely registered. On reload we can drain whatever is left.
 *
 * Each buffered chunk is keyed by a stable id so the same chunk is never
 * uploaded twice, and carries all metadata the segment API needs.
 */

const DB_NAME = "openside-recordings";
const STORE = "chunks";

/**
 * DB_VERSION / migration note (raw-PCM fields):
 *
 * The PCM pipeline adds three optional fields to BufferedChunk
 * (sampleRate/bitDepth/channelCount). IndexedDB object stores are schemaless at
 * the RECORD level - new fields on stored objects need NO version bump and NO
 * upgrade transaction; only new stores/indexes do. Adding a value migration here
 * would mean pinning an explicit version, which is exactly what reintroduces the
 * VersionError this module was rewritten to avoid (openDb adopts whatever version
 * exists on disk on purpose). So there is intentionally no version bump for these
 * fields - they simply flow through putChunk/getAllChunks. If a future change
 * needs a new INDEX, add it inside the `store missing` reopen path in openDb().
 */

export type BufferedTrackType =
  | "combined"
  | "audio"
  | "screen"
  | "camera"
  | "pcm";
export type BufferedUploadScope = "space" | "screen";

export interface BufferedChunk {
  /** Stable id: `${participantRecordingId}:${sequenceNumber}`. */
  id: string;
  uploadScope?: BufferedUploadScope;
  spaceId: string;
  spaceRecordingSessionId: string;
  recordingSessionId: string;
  participantRecordingId: string;
  participantSessionId: string;
  trackType: BufferedTrackType;
  sequenceNumber: number;
  startMs: number;
  durationMs: number;
  mimeType: string;
  blob: Blob;
  createdAt: number;
  // Raw-PCM ("pcm" trackType) chunks only: the audio format the server needs to
  // write a valid WAV header at finalization. Null/undefined for every other
  // track. These live directly on the record - see the DB_VERSION note below on
  // why adding them requires no IndexedDB upgrade.
  sampleRate?: number;
  bitDepth?: number;
  channelCount?: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function createStore(db: IDBDatabase): void {
  const store = db.createObjectStore(STORE, { keyPath: "id" });
  // Lets us drain/clear by recording session efficiently.
  store.createIndex("bySession", "spaceRecordingSessionId", { unique: false });
  store.createIndex("byRecording", "participantRecordingId", { unique: false });
}

/**
 * Open the DB without pinning a version so we adopt whatever version already
 * exists on disk. Hardcoding a version is a trap: an earlier build (or another
 * branch) may have bumped this DB to a higher version, and reopening at a lower
 * one throws VersionError forever. If the store is missing (fresh DB, or a
 * higher-version DB created by unrelated code), reopen at existing+1 to add it.
 */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);

    // Fires only for a brand-new DB (version 0 -> 1).
    request.onupgradeneeded = () => createStore(request.result);

    request.onsuccess = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(STORE)) {
        resolve(db);
        return;
      }
      // Store missing on an existing DB: bump the version to create it.
      const nextVersion = db.version + 1;
      db.close();
      const upgrade = indexedDB.open(DB_NAME, nextVersion);
      upgrade.onupgradeneeded = () => createStore(upgrade.result);
      upgrade.onsuccess = () => resolve(upgrade.result);
      upgrade.onerror = () => reject(upgrade.error);
    };
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function tx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function buildChunkId(
  participantRecordingId: string,
  sequenceNumber: number,
): string {
  return `${participantRecordingId}:${sequenceNumber}`;
}

export async function putChunk(chunk: BufferedChunk): Promise<void> {
  const db = await openDb();
  await promisifyRequest(tx(db, "readwrite").put(chunk));
}

export async function deleteChunk(id: string): Promise<void> {
  const db = await openDb();
  await promisifyRequest(tx(db, "readwrite").delete(id));
}

/** All buffered chunks, oldest first (by sequence/created order). */
export async function getAllChunks(): Promise<BufferedChunk[]> {
  const db = await openDb();
  const all = await promisifyRequest(
    tx(db, "readonly").getAll() as IDBRequest<BufferedChunk[]>,
  );
  return all.sort(
    (a, b) =>
      a.createdAt - b.createdAt || a.sequenceNumber - b.sequenceNumber,
  );
}

/**
 * Delete buffered chunks older than `maxAgeMs`. A chunk left behind by an ended
 * or crashed session can never upload - its participant is no longer active, so
 * the presign call is rejected permanently - yet nothing else ever removes it.
 * Left alone these accumulate and, sitting at the head of a fresh recording's
 * upload queue, block that recording's real chunks. Genuinely-recoverable
 * chunks (a quick refresh inside a still-live meeting) are always recent, so a
 * generous age cutoff purges only the dead ones. Returns how many were removed.
 */
export async function purgeStaleChunks(maxAgeMs: number): Promise<number> {
  const db = await openDb();
  const all = await promisifyRequest(
    tx(db, "readonly").getAll() as IDBRequest<BufferedChunk[]>,
  );
  const cutoff = Date.now() - maxAgeMs;
  const stale = all.filter((chunk) => (chunk.createdAt ?? 0) < cutoff);
  if (stale.length === 0) return 0;

  const store = tx(db, "readwrite");
  await Promise.all(
    stale.map((chunk) => promisifyRequest(store.delete(chunk.id))),
  );
  return stale.length;
}
