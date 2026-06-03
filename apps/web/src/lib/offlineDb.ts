export type OfflineSyncStatus = 'synced' | 'pending' | 'conflict' | 'deleted';

export interface OfflineNote {
  id: string;
  userId: string;
  ownerId?: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  serverUpdatedAt?: string;
  baseUpdatedAt?: string;
  localUpdatedAt: string;
  sourcePdfId?: string;
  starred?: boolean;
  syncStatus: OfflineSyncStatus;
  error?: string;
}

export type SyncChangeType = 'create' | 'update' | 'delete';

export interface SyncQueueItem {
  id: string;
  userId: string;
  noteId: string;
  type: SyncChangeType;
  title?: string;
  content?: string;
  createdAt?: string;
  baseUpdatedAt?: string;
  queuedAt: string;
}

const DB_NAME = 'ai-notes-offline';
const DB_VERSION = 2;
const NOTE_STORE = 'offline_notes';
const QUEUE_STORE = 'sync_queue';
const AUTH_STORE = 'auth';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(NOTE_STORE)) {
        const noteStore = db.createObjectStore(NOTE_STORE, { keyPath: 'key' });
        noteStore.createIndex('userId', 'userId', { unique: false });
      }

      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const queueStore = db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        queueStore.createIndex('userId', 'userId', { unique: false });
        queueStore.createIndex('noteId', 'noteId', { unique: false });
      }

      if (!db.objectStoreNames.contains(AUTH_STORE)) {
        db.createObjectStore(AUTH_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null; // Clear cached promise so next call retries
      reject(request.error);
    };
  });

  return dbPromise;
}

function noteKey(userId: string, noteId: string) {
  return `${userId}:${noteId}`;
}

function txDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedNotes(userId: string): Promise<OfflineNote[]> {
  const db = await openDb();
  const tx = db.transaction(NOTE_STORE, 'readonly');
  const index = tx.objectStore(NOTE_STORE).index('userId');
  const rows = await requestToPromise<Array<OfflineNote & { key: string }>>(index.getAll(userId));

  return rows
    .filter((note) => note.syncStatus !== 'deleted' && !note.id.endsWith('__server'))
    .sort((a, b) => new Date(b.localUpdatedAt).getTime() - new Date(a.localUpdatedAt).getTime());
}

export async function getCachedNote(userId: string, noteId: string): Promise<OfflineNote | null> {
  const db = await openDb();
  const tx = db.transaction(NOTE_STORE, 'readonly');
  const row = await requestToPromise<OfflineNote & { key: string } | undefined>(
    tx.objectStore(NOTE_STORE).get(noteKey(userId, noteId)),
  );

  return row ?? null;
}

export async function upsertCachedNote(note: OfflineNote): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(NOTE_STORE, 'readwrite');
  tx.objectStore(NOTE_STORE).put({ ...note, key: noteKey(note.userId, note.id) });
  await txDone(tx);
}

export async function removeCachedNote(userId: string, noteId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(NOTE_STORE, 'readwrite');
  tx.objectStore(NOTE_STORE).delete(noteKey(userId, noteId));
  await txDone(tx);
}

export async function removeServerConflictCopy(userId: string, noteId: string): Promise<void> {
  await removeCachedNote(userId, `${noteId}__server`);
}

export async function cacheServerNotes(userId: string, notes: Array<{
  id: string;
  ownerId?: string;
  title: string;
  content?: string;
  createdAt: string;
  updatedAt: string;
  sourcePdfId?: string;
  starred?: boolean;
}>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(NOTE_STORE, 'readwrite');
  const store = tx.objectStore(NOTE_STORE);

  for (const note of notes) {
    const existing = await requestToPromise<OfflineNote & { key: string } | undefined>(
      store.get(noteKey(userId, note.id)),
    );

    if (existing?.syncStatus === 'pending' || existing?.syncStatus === 'conflict') {
      continue;
    }

    const content = note.content ?? existing?.content ?? '<p></p>';
    store.put({
      key: noteKey(userId, note.id),
      id: note.id,
      userId,
      ownerId: note.ownerId ?? existing?.ownerId,
      title: note.title,
      content,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      serverUpdatedAt: note.updatedAt,
      baseUpdatedAt: note.updatedAt,
      localUpdatedAt: note.updatedAt,
      sourcePdfId: note.sourcePdfId,
      // Preserve a locally-set star when the server payload omits the flag (e.g. sync pull)
      starred: note.starred ?? existing?.starred ?? false,
      syncStatus: 'synced',
    } satisfies OfflineNote & { key: string });
  }

  await txDone(tx);
}

export async function queueChange(change: Omit<SyncQueueItem, 'id' | 'queuedAt'>): Promise<SyncQueueItem> {
  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, 'readwrite');
  const store = tx.objectStore(QUEUE_STORE);
  const existing = await requestToPromise<SyncQueueItem[]>(store.index('noteId').getAll(change.noteId));
  const sameUser = existing.filter((item) => item.userId === change.userId);

  for (const item of sameUser) {
    store.delete(item.id);
  }

  const createChange = sameUser.find((item) => item.type === 'create');
  const nextType =
    change.type === 'delete'
      ? 'delete'
      : createChange
        ? 'create'
        : change.type;
  const queued: SyncQueueItem = {
    ...change,
    type: nextType,
    title: change.title ?? createChange?.title,
    content: change.content ?? createChange?.content,
    createdAt: change.createdAt ?? createChange?.createdAt,
    baseUpdatedAt: createChange ? createChange.baseUpdatedAt : change.baseUpdatedAt,
    id: `${change.userId}:${change.noteId}:${Date.now()}`,
    queuedAt: new Date().toISOString(),
  };

  store.put(queued);
  await txDone(tx);
  return queued;
}

export async function getQueuedChanges(userId: string): Promise<SyncQueueItem[]> {
  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, 'readonly');
  const rows = await requestToPromise<SyncQueueItem[]>(tx.objectStore(QUEUE_STORE).index('userId').getAll(userId));
  return rows.sort((a, b) => new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime());
}

export async function removeQueuedChanges(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, 'readwrite');
  const store = tx.objectStore(QUEUE_STORE);
  for (const id of ids) {
    store.delete(id);
  }
  await txDone(tx);
}

export async function clearQueuedChangesForNotes(userId: string, noteIds: string[]): Promise<void> {
  if (noteIds.length === 0) return;

  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, 'readwrite');
  const store = tx.objectStore(QUEUE_STORE);
  const uniqueNoteIds = Array.from(new Set(noteIds));

  for (const noteId of uniqueNoteIds) {
    const existing = await requestToPromise<SyncQueueItem[]>(store.index('noteId').getAll(noteId));
    for (const item of existing) {
      if (item.userId === userId) {
        store.delete(item.id);
      }
    }
  }

  await txDone(tx);
}

export async function removeQueuedChangesForNote(userId: string, noteId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, 'readwrite');
  const store = tx.objectStore(QUEUE_STORE);
  const existing = await requestToPromise<SyncQueueItem[]>(store.index('noteId').getAll(noteId));

  for (const item of existing) {
    if (item.userId === userId) {
      store.delete(item.id);
    }
  }

  await txDone(tx);
}

export function createLocalNoteId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function saveAuthToken(token: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(AUTH_STORE, 'readwrite');
  tx.objectStore(AUTH_STORE).put({ key: 'jwt', value: token });
  await txDone(tx);
}

export async function getAuthToken(): Promise<string | null> {
  const db = await openDb();
  const tx = db.transaction(AUTH_STORE, 'readonly');
  const row = await requestToPromise<{ key: string; value: string } | undefined>(
    tx.objectStore(AUTH_STORE).get('jwt'),
  );
  return row?.value ?? null;
}

export async function clearAuthToken(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(AUTH_STORE, 'readwrite');
  tx.objectStore(AUTH_STORE).delete('jwt');
  await txDone(tx);
}
