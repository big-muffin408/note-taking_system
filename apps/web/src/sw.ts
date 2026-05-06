/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(
  ({ request }) => request.mode === 'navigate',
  new NetworkFirst({
    cacheName: 'navigation-cache',
    networkTimeoutSeconds: 3,
  }),
);

// --- IndexedDB helpers for service worker context ---

const DB_NAME = 'ai-notes-offline';
const DB_VERSION = 2;
const NOTE_STORE = 'offline_notes';
const QUEUE_STORE = 'sync_queue';
const AUTH_STORE = 'auth';

let cachedDb: IDBDatabase | null = null;

function openSwDb(): Promise<IDBDatabase> {
  if (cachedDb) return Promise.resolve(cachedDb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = () => {
      cachedDb = req.result;
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAllByIndex<T>(db: IDBDatabase, store: string, indexName: string, key: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).index(indexName).getAll(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbPut(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Background Sync ---

const FETCH_TIMEOUT_MS = 15000;

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

self.addEventListener('sync' as any, (event: any) => {
  if (event.tag === 'sync-notes') {
    event.waitUntil(handleBackgroundSync());
  }
});

async function handleBackgroundSync(): Promise<void> {
  const db = await openSwDb();

  const authRow = await idbGet<{ key: string; value: string }>(db, AUTH_STORE, 'jwt');
  if (!authRow?.value) return;

  const token = authRow.value;
  const userId = parseUserId(token);
  if (!userId) return;

  const allChanges = await idbGetAllByIndex<{ userId: string }>(db, QUEUE_STORE, 'userId', userId);

  if (allChanges.length > 0) {
    let pushRes: Response;
    try {
      pushRes = await fetchWithTimeout('/api/sync/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ changes: allChanges }),
      });
    } catch {
      notifyTabsError('push-network');
      return;
    }

    if (!pushRes.ok) {
      notifyTabsError('push-failed');
      return;
    }

    const pushed = (await pushRes.json()) as {
      results: Array<{
        queueId: string;
        noteId: string;
        status: string;
        remoteId?: string;
        note?: { id: string; title: string; content: string; createdAt: string; updatedAt: string; sourcePdfId?: string };
        serverNote?: { id: string; title: string; content: string; createdAt: string; updatedAt: string; sourcePdfId?: string };
        message?: string;
      }>;
    };

    // Process each result incrementally — remove from queue as soon as it succeeds
    for (const result of pushed.results) {
      if (result.status === 'created' || result.status === 'updated' || result.status === 'deleted') {
        await idbDelete(db, QUEUE_STORE, result.queueId);
        if (result.status === 'deleted') {
          await idbDelete(db, NOTE_STORE, `${userId}:${result.noteId}`);
        } else if (result.note) {
          await idbPut(db, NOTE_STORE, {
            key: `${userId}:${result.note.id}`,
            id: result.note.id,
            userId,
            title: result.note.title,
            content: result.note.content,
            createdAt: result.note.createdAt,
            updatedAt: result.note.updatedAt,
            serverUpdatedAt: result.note.updatedAt,
            baseUpdatedAt: result.note.updatedAt,
            localUpdatedAt: result.note.updatedAt,
            sourcePdfId: result.note.sourcePdfId,
            syncStatus: 'synced',
          });
        }
      } else if (result.status === 'conflict') {
        await idbDelete(db, QUEUE_STORE, result.queueId);
        // Mark local note as conflict so the tab can prompt the user
        const existing = await idbGet<{ syncStatus?: string }>(db, NOTE_STORE, `${userId}:${result.noteId}`);
        if (existing) {
          await idbPut(db, NOTE_STORE, { ...existing, syncStatus: 'conflict', error: '服务器版本已更新' });
        }
        if (result.serverNote) {
          await idbPut(db, NOTE_STORE, {
            key: `${userId}:${result.noteId}__server`,
            id: `${result.noteId}__server`,
            userId,
            title: result.serverNote.title,
            content: result.serverNote.content,
            createdAt: result.serverNote.createdAt,
            updatedAt: result.serverNote.updatedAt,
            serverUpdatedAt: result.serverNote.updatedAt,
            baseUpdatedAt: result.serverNote.updatedAt,
            localUpdatedAt: result.serverNote.updatedAt,
            sourcePdfId: result.serverNote.sourcePdfId,
            syncStatus: 'synced',
          });
        }
      }
      // 'error' status: leave in queue for next retry
    }
  }

  let pullOk = false;
  try {
    pullOk = await pullFromServer(db, token, userId);
  } catch {
    // Pull failed — don't notify tabs "sync done" so they retry
    return;
  }

  if (pullOk) {
    notifyTabs();
  }
}

async function pullFromServer(db: IDBDatabase, token: string, userId: string): Promise<boolean> {
  const pullRes = await fetchWithTimeout('/api/sync/pull', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!pullRes.ok) return false;

  const data = (await pullRes.json()) as {
    notes: Array<{
      id: string;
      title: string;
      content?: string;
      createdAt: string;
      updatedAt: string;
      sourcePdfId?: string;
    }>;
  };

  for (const note of data.notes) {
    const noteKey = `${userId}:${note.id}`;
    const existing = await idbGet<{ syncStatus?: string; content?: string }>(db, NOTE_STORE, noteKey);
    if (existing?.syncStatus === 'pending' || existing?.syncStatus === 'conflict') {
      continue;
    }
    await idbPut(db, NOTE_STORE, {
      key: noteKey,
      id: note.id,
      userId,
      title: note.title,
      content: note.content ?? existing?.content ?? '<p></p>',
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      serverUpdatedAt: note.updatedAt,
      baseUpdatedAt: note.updatedAt,
      localUpdatedAt: note.updatedAt,
      sourcePdfId: note.sourcePdfId,
      syncStatus: 'synced',
    });
  }

  return true;
}

function notifyTabs(): void {
  const channel = new BroadcastChannel('sync-channel');
  channel.postMessage({ type: 'sw-sync-done' });
  channel.close();
}

function notifyTabsError(reason: string): void {
  const channel = new BroadcastChannel('sync-channel');
  channel.postMessage({ type: 'sw-sync-error', reason });
  channel.close();
}

function parseUserId(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.id ?? null;
  } catch {
    return null;
  }
}

// --- Message handler for manual triggers from tabs ---

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data?.type === 'trigger-sync') {
    event.waitUntil(handleBackgroundSync());
  }
});
