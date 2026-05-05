import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import {
  cacheServerNotes,
  clearQueuedChangesForNotes,
  createLocalNoteId,
  getCachedNote,
  getCachedNotes,
  getQueuedChanges,
  queueChange,
  removeCachedNote,
  removeQueuedChanges,
  removeQueuedChangesForNote,
  removeServerConflictCopy,
  upsertCachedNote,
  type OfflineNote,
  type OfflineSyncStatus,
} from '../lib/offlineDb';
import { useAuth } from './AuthContext';
import { withRetry } from '../lib/retry';

// --- Multi-tab sync coordination ---
const syncChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('sync-channel')
  : null;

const SYNC_LOCK_KEY = 'notes-sync-lock';
const LOCK_TTL_MS = 30000;

function tryAcquireSyncLock(): boolean {
  try {
    const existing = localStorage.getItem(SYNC_LOCK_KEY);
    if (existing) {
      const { timestamp } = JSON.parse(existing);
      if (Date.now() - timestamp < LOCK_TTL_MS) {
        return false;
      }
    }
    localStorage.setItem(SYNC_LOCK_KEY, JSON.stringify({ timestamp: Date.now() }));
    return true;
  } catch {
    return true;
  }
}

function releaseSyncLock(): void {
  try {
    localStorage.removeItem(SYNC_LOCK_KEY);
  } catch {
    // ignore
  }
}

function registerBackgroundSync(): void {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready.then((reg: any) => {
      reg.sync?.register('sync-notes').catch(() => {});
    }).catch(() => {});
  }
}

export interface NoteSummary {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  sourcePdfId?: string;
  syncStatus?: OfflineSyncStatus;
  error?: string;
}

interface NotesContextValue {
  notes: NoteSummary[];
  loading: boolean;
  online: boolean;
  syncing: boolean;
  fetchNotes: () => Promise<void>;
  createNote: (title?: string) => Promise<NoteSummary>;
  deleteNote: (id: string) => Promise<void>;
  syncNow: () => Promise<void>;
  upsertLocalNote: (note: OfflineNote) => Promise<void>;
  resolveConflict: (noteId: string, resolution: 'local' | 'server') => Promise<void>;
}

const NotesContext = createContext<NotesContextValue | null>(null);

export function NotesProvider({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuth();
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const syncInFlightRef = useRef(false);

  const loadCachedNotes = useCallback(async () => {
    if (!user) {
      setNotes([]);
      setLoading(false);
      return [];
    }

    const cached = await getCachedNotes(user.id);
    setNotes(cached.map((note) => ({
      id: note.id,
      title: note.title,
      createdAt: note.createdAt,
      updatedAt: note.localUpdatedAt,
      sourcePdfId: note.sourcePdfId,
      syncStatus: note.syncStatus,
      error: note.error,
    })));
    return cached;
  }, [user]);

  const fetchNotes = useCallback(async () => {
    if (!token || !user) return;
    try {
      setLoading(true);
      await loadCachedNotes();
      const data = await api.get<{ items: NoteSummary[] }>('/api/doc/notes', token);
      await cacheServerNotes(user.id, data.items);
      await loadCachedNotes();
    } catch (err) {
      console.error('Failed to fetch notes:', err);
      await loadCachedNotes();
    } finally {
      setLoading(false);
    }
  }, [loadCachedNotes, token, user]);

  useEffect(() => {
    if (token && user) {
      fetchNotes();
    } else {
      setNotes([]);
      setLoading(false);
    }
  }, [token, user, fetchNotes]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!syncChannel) return;

    function handleMessage(event: MessageEvent) {
      if (event.data?.type === 'sw-sync-done' || event.data?.type === 'tab-sync-done') {
        if (user) loadCachedNotes();
      }
    }

    syncChannel.addEventListener('message', handleMessage);
    return () => syncChannel.removeEventListener('message', handleMessage);
  }, [user, loadCachedNotes]);

  useEffect(() => {
    function handleBeforeUnload() {
      releaseSyncLock();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const syncNow = useCallback(async () => {
    if (!token || !user || syncInFlightRef.current || !navigator.onLine) return;

    if (!tryAcquireSyncLock()) return;

    syncInFlightRef.current = true;
    setSyncing(true);
    try {
      await withRetry(async () => {
        const changes = await getQueuedChanges(user.id);
        if (changes.length > 0) {
          const pushed = await api.post<{
            results: Array<{
              queueId: string;
              noteId: string;
              status: 'created' | 'updated' | 'deleted' | 'conflict' | 'error';
              remoteId?: string;
              note?: NoteSummary & { content: string };
              serverNote?: NoteSummary & { content: string };
              message?: string;
            }>;
          }>('/api/sync/push', { changes }, token);

          const doneQueueIds: string[] = [];
          for (const result of pushed.results) {
            if (result.status === 'created' || result.status === 'updated') {
              doneQueueIds.push(result.queueId);
              if (result.remoteId && result.remoteId !== result.noteId) {
                await removeCachedNote(user.id, result.noteId);
                window.dispatchEvent(new CustomEvent('note-id-replaced', {
                  detail: { localId: result.noteId, remoteId: result.remoteId },
                }));
              }
              if (result.note) {
                await removeServerConflictCopy(user.id, result.note.id);
                await upsertCachedNote({
                  id: result.note.id,
                  userId: user.id,
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
            } else if (result.status === 'deleted') {
              doneQueueIds.push(result.queueId);
              await removeCachedNote(user.id, result.noteId);
              await removeServerConflictCopy(user.id, result.noteId);
            } else if (result.status === 'conflict') {
              doneQueueIds.push(result.queueId);
              const local = (await getCachedNotes(user.id)).find((note) => note.id === result.noteId);
              if (local) {
                await upsertCachedNote({
                  ...local,
                  syncStatus: 'conflict',
                  error: '服务器版本已更新，请选择保留本地草稿或使用服务器版本。',
                });
              }
              if (result.serverNote) {
                await upsertCachedNote({
                  id: `${result.noteId}__server`,
                  userId: user.id,
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
            } else if (result.status === 'error') {
              const local = (await getCachedNotes(user.id)).find((note) => note.id === result.noteId);
              if (local) {
                await upsertCachedNote({
                  ...local,
                  syncStatus: 'pending',
                  error: result.message ?? '同步失败，稍后会继续重试。',
                });
              }
            }
          }
          await removeQueuedChanges(doneQueueIds);
        }

        const pull = await api.get<{ notes: Array<NoteSummary & { content: string }> }>('/api/sync/pull', token);
        await cacheServerNotes(user.id, pull.notes);
      }, { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 15000 });

      await loadCachedNotes();
      syncChannel?.postMessage({ type: 'tab-sync-done' });
    } catch (err) {
      console.error('Sync failed after retries:', err);
      await loadCachedNotes();
    } finally {
      syncInFlightRef.current = false;
      setSyncing(false);
      releaseSyncLock();
    }
  }, [loadCachedNotes, token, user]);

  useEffect(() => {
    if (online) {
      syncNow();
    }
  }, [online, syncNow]);

  const createNote = useCallback(
    async (title = '未命名笔记') => {
      if (!user) throw new Error('未登录');

      const now = new Date().toISOString();
      const localNote: OfflineNote = {
        id: createLocalNoteId(),
        userId: user.id,
        title,
        content: '<p></p>',
        createdAt: now,
        updatedAt: now,
        localUpdatedAt: now,
        syncStatus: 'pending',
      };

      try {
        const note = await api.post<NoteSummary & { content?: string }>('/api/doc/notes', { title }, token);
        await upsertCachedNote({
          ...localNote,
          id: note.id,
          title: note.title,
          content: note.content ?? '<p></p>',
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          serverUpdatedAt: note.updatedAt,
          baseUpdatedAt: note.updatedAt,
          localUpdatedAt: note.updatedAt,
          syncStatus: 'synced',
        });
        await loadCachedNotes();
        return note;
      } catch (err) {
        await upsertCachedNote(localNote);
        await queueChange({
          userId: user.id,
          noteId: localNote.id,
          type: 'create',
          title: localNote.title,
          content: localNote.content,
          createdAt: localNote.createdAt,
        });
        registerBackgroundSync();
        await loadCachedNotes();
        return localNote;
      }
    },
    [loadCachedNotes, token, user]
  );

  const deleteNote = useCallback(
    async (id: string) => {
      if (!user) throw new Error('未登录');
      const cached = (await getCachedNotes(user.id)).find((note) => note.id === id);

      try {
        if (!id.startsWith('local-')) {
          await api.del(`/api/doc/notes/${id}`, token);
        } else {
          await removeQueuedChangesForNote(user.id, id);
        }
        await removeCachedNote(user.id, id);
      } catch (err) {
        if (!cached) throw err;
        await upsertCachedNote({
          ...cached,
          syncStatus: 'deleted',
          localUpdatedAt: new Date().toISOString(),
        });
        await queueChange({
          userId: user.id,
          noteId: id,
          type: 'delete',
          baseUpdatedAt: cached.baseUpdatedAt,
        });
        registerBackgroundSync();
      }
      await loadCachedNotes();
    },
    [loadCachedNotes, token, user]
  );

  const upsertLocalNote = useCallback(async (note: OfflineNote) => {
    await upsertCachedNote(note);
    await loadCachedNotes();
  }, [loadCachedNotes]);

  const resolveConflict = useCallback(async (noteId: string, resolution: 'local' | 'server') => {
    if (!user) return;

    const notes = await getCachedNotes(user.id);
    const local = notes.find((note) => note.id === noteId);
    if (!local) return;

    if (resolution === 'server') {
      const server = await getCachedNote(user.id, `${noteId}__server`);
      if (server) {
        await upsertCachedNote({
          ...server,
          id: noteId,
          syncStatus: 'synced',
          error: undefined,
        });
        await removeCachedNote(user.id, server.id);
      }
      await clearQueuedChangesForNotes(user.id, [noteId]);
      await loadCachedNotes();
      return;
    }

    const server = await getCachedNote(user.id, `${noteId}__server`);
    await upsertCachedNote({
      ...local,
      syncStatus: 'pending',
      error: undefined,
      baseUpdatedAt: server?.serverUpdatedAt ?? local.baseUpdatedAt,
      localUpdatedAt: new Date().toISOString(),
    });
    await queueChange({
      userId: user.id,
      noteId,
      type: noteId.startsWith('local-') ? 'create' : 'update',
      title: local.title,
      content: local.content,
      baseUpdatedAt: server?.serverUpdatedAt ?? local.baseUpdatedAt,
      createdAt: local.createdAt,
    });
    await loadCachedNotes();
    await syncNow();
  }, [loadCachedNotes, syncNow, user]);

  return (
    <NotesContext.Provider value={{ notes, loading, online, syncing, fetchNotes, createNote, deleteNote, syncNow, upsertLocalNote, resolveConflict }}>
      {children}
    </NotesContext.Provider>
  );
}

export function useNotes() {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error('useNotes must be used within NotesProvider');
  return ctx;
}
