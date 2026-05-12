import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { useAuth } from '../contexts/AuthContext';
import { useNotes } from '../contexts/NotesContext';
import { api, ApiError, streamAI } from '../lib/api';
import {
  getCachedNote,
  queueChange,
  removeServerConflictCopy,
  upsertCachedNote,
  type OfflineNote,
  type OfflineSyncStatus,
} from '../lib/offlineDb';
import Editor from '../components/Editor';
import VersionHistory from '../components/VersionHistory';
import ShareDialog from '../components/ShareDialog';
import { htmlToMarkdown, downloadFile } from '../lib/markdownConvert';

interface NoteDetail {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  createdAt?: string;
  serverUpdatedAt?: string;
  baseUpdatedAt?: string;
  sourcePdfId?: string;
  syncStatus?: OfflineSyncStatus;
  error?: string;
}

type CollabStatus = 'connecting' | 'connected' | 'disconnected' | 'synced';
type AiMode = 'summary' | 'chat' | 'polish';

interface CollaborationSession {
  document: Y.Doc;
  provider: WebsocketProvider;
}

interface PdfUploadResponse {
  pdfId: string;
  noteId: string;
  fileName: string;
  bytes: number;
  pages: number;
  parser?: string;
  wordCount?: number;
  chunks?: number;
  assetCount?: number;
  fallbackReason?: string;
  warnings?: string[];
  status: string;
  markdownDraft?: string;
}

type PdfJobStatus = 'queued' | 'parsing' | 'parsed' | 'failed';

interface PdfJobResponse {
  jobId: string;
  pdfId: string;
  noteId?: string;
  fileName?: string;
  bytes?: number;
  status: PdfJobStatus;
  parser?: string;
  pages?: number;
  wordCount?: number;
  chunks?: number;
  assetCount?: number;
  fallbackReason?: string;
  warnings?: string[];
  error?: string;
}

interface AiChatResponse {
  answer: string;
  sources: Array<{
    score: number;
    text: string;
    textPreview?: string;
    sourceName: string;
    chunkIndex: number;
  }>;
}

const WS_BASE = import.meta.env.VITE_WS_BASE_URL ?? '/ws';

function getCollabServerUrl() {
  const base = `${WS_BASE}`.replace(/\/$/, '');

  if (base.startsWith('ws://') || base.startsWith('wss://')) {
    return `${base}/collab`;
  }

  if (base.startsWith('http://') || base.startsWith('https://')) {
    return `${base.replace(/^http/, 'ws')}/collab`;
  }

  return `${window.location.origin.replace(/^http/, 'ws')}${base}/collab`;
}

function getUserColor(seed: string) {
  const palette = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2'];
  const index = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length;
  return palette[index];
}

function getStatusText(status: CollabStatus, count: number) {
  if (status === 'connected' || status === 'synced') return `协同已连接 · ${count} 人在线`;
  if (status === 'connecting') return '协同连接中…';
  return '协同离线，本地可继续编辑';
}

function getPdfJobStatusText(status: PdfJobStatus) {
  if (status === 'queued') return '已上传，等待解析';
  if (status === 'parsing') return 'MinerU/PDF 解析中';
  if (status === 'parsed') return '解析完成，正在打开笔记';
  return '解析失败';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function textToParagraphs(value: string) {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function cachedToDetail(note: OfflineNote): NoteDetail {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    serverUpdatedAt: note.serverUpdatedAt,
    baseUpdatedAt: note.baseUpdatedAt,
    sourcePdfId: note.sourcePdfId,
    syncStatus: note.syncStatus,
    error: note.error,
  };
}

function detailToCached(note: NoteDetail, userId: string): OfflineNote {
  const now = new Date().toISOString();
  return {
    id: note.id,
    userId,
    title: note.title,
    content: note.content,
    createdAt: note.createdAt ?? note.updatedAt ?? now,
    updatedAt: note.updatedAt ?? now,
    serverUpdatedAt: note.serverUpdatedAt ?? note.updatedAt,
    baseUpdatedAt: note.baseUpdatedAt ?? note.serverUpdatedAt ?? note.updatedAt,
    localUpdatedAt: note.updatedAt ?? now,
    sourcePdfId: note.sourcePdfId,
    syncStatus: note.syncStatus ?? 'synced',
    error: note.error,
  };
}

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const { token, user } = useAuth();
  const { fetchNotes, online, syncing, syncNow, upsertLocalNote, resolveConflict } = useNotes();
  const navigate = useNavigate();

  const [note, setNote] = useState<NoteDetail | null>(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [collaboration, setCollaboration] = useState<CollaborationSession | null>(null);
  const [collabStatus, setCollabStatus] = useState<CollabStatus>('connecting');
  const [collaboratorCount, setCollaboratorCount] = useState(1);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [lastPdfUpload, setLastPdfUpload] = useState<PdfUploadResponse | null>(null);
  const [pdfJob, setPdfJob] = useState<PdfJobResponse | null>(null);

  // AI state — streaming
  const [aiLoading, setAiLoading] = useState<AiMode | null>(null);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiResult, setAiResult] = useState('');
  const [aiResultStreaming, setAiResultStreaming] = useState('');
  const [aiSources, setAiSources] = useState<AiChatResponse['sources']>([]);
  const [aiError, setAiError] = useState('');

  // Polish state
  const [selectedText, setSelectedText] = useState('');
  const [polishResult, setPolishResult] = useState('');
  const [polishStreaming, setPolishStreaming] = useState('');
  const [showPolishModal, setShowPolishModal] = useState(false);

  const [insertRequest, setInsertRequest] = useState<{ id: number; html: string } | null>(null);
  const [contentKey, setContentKey] = useState(0);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);

  const contentRef = useRef('');
  const titleRef = useRef('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const streamAbortRef = useRef<AbortController | null>(null);
  const collabSyncedRef = useRef(false);

  useEffect(() => {
    if (!id || !token || !user) return;

    let cancelled = false;
    setLoading(true);

    async function loadNote() {
      const cached = await getCachedNote(user!.id, id!);
      if (cached && !cancelled) {
        const localNote = cachedToDetail(cached);
        setNote(localNote);
        setTitle(localNote.title);
        titleRef.current = localNote.title;
        contentRef.current = localNote.content;
        setLoading(false);
      }

      try {
        if (!navigator.onLine || id!.startsWith('local-')) {
          if (!cached && !cancelled) navigate('/', { replace: true });
          return;
        }

        const data = await api.get<NoteDetail>(`/api/doc/notes/${id}`, token);
        if (cancelled) return;
        const detail = {
          ...data,
          createdAt: data.createdAt ?? data.updatedAt,
          serverUpdatedAt: data.updatedAt,
          baseUpdatedAt: data.updatedAt,
          syncStatus: 'synced' as const,
        };
        setNote(detail);
        setTitle(detail.title);
        titleRef.current = detail.title;
        contentRef.current = detail.content;
        await upsertLocalNote(detailToCached(detail, user!.id));
      } catch (err) {
        console.error('Failed to load note:', err);
        if (!cached && !cancelled) navigate('/', { replace: true });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadNote();
    return () => {
      cancelled = true;
    };
  }, [id, token, user, navigate, upsertLocalNote]);

  useEffect(() => {
    function handleIdReplaced(event: Event) {
      const detail = (event as CustomEvent<{ localId: string; remoteId: string }>).detail;
      if (detail.localId === id) {
        navigate(`/note/${detail.remoteId}`, { replace: true });
      }
    }

    window.addEventListener('note-id-replaced', handleIdReplaced);
    return () => window.removeEventListener('note-id-replaced', handleIdReplaced);
  }, [id, navigate]);

  useEffect(() => {
    if (!pdfJob || !token) return;
    if (pdfJob.status !== 'queued' && pdfJob.status !== 'parsing') return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const next = await api.get<PdfJobResponse>(`/api/doc/pdf/jobs/${pdfJob.jobId}`, token);
        if (cancelled) return;
        setPdfJob(next);

        if (next.status === 'parsed' && next.noteId) {
          setUploadingPdf(false);
          setLastPdfUpload({
            pdfId: next.pdfId,
            noteId: next.noteId,
            fileName: next.fileName ?? 'PDF',
            bytes: next.bytes ?? 0,
            pages: next.pages ?? 0,
            parser: next.parser,
            wordCount: next.wordCount,
            chunks: next.chunks,
            assetCount: next.assetCount,
            fallbackReason: next.fallbackReason,
            warnings: next.warnings,
            status: next.status,
          });
          await fetchNotes();
          navigate(`/note/${next.noteId}`);
        } else if (next.status === 'failed') {
          setUploadingPdf(false);
          setAiError(next.error ?? 'PDF 解析失败');
        }
      } catch (err) {
        if (cancelled) return;
        console.error('PDF job polling failed:', err);
        setUploadingPdf(false);
        setAiError(err instanceof Error ? err.message : '获取 PDF 解析状态失败');
      }
    }, pdfJob.status === 'queued' ? 1000 : 1800);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fetchNotes, navigate, pdfJob, token]);

  useEffect(() => {
    if (!id || !token || !user) return;
    const userId = user.id;
    const userName = user.displayName ?? user.email ?? '协作者';
    const userColor = getUserColor(userId ?? token);

    if (!online || id.startsWith('local-')) {
      collabSyncedRef.current = false;
      setCollabStatus('disconnected');
      setCollaboratorCount(1);
      setCollaboration(null);
      return;
    }

    collabSyncedRef.current = false;
    setCollabStatus('connecting');
    setCollaboratorCount(1);

    const document = new Y.Doc();
    const provider = new WebsocketProvider(
      getCollabServerUrl(),
      encodeURIComponent(id),
      document,
      {
        params: { token },
      }
    );

    const updateAwarenessCount = () => {
      setCollaboratorCount(provider.awareness.getStates().size);
    };

    const handleStatus = ({ status }: { status: 'connected' | 'connecting' | 'disconnected' }) => {
      if (status === 'connected' && provider.synced) {
        collabSyncedRef.current = true;
        setCollabStatus('synced');
        return;
      }

      if (status === 'connected' && collabSyncedRef.current) {
        setCollabStatus('synced');
        return;
      }

      if (status !== 'connected') {
        collabSyncedRef.current = false;
      }

      setCollabStatus(status);
    };

    const handleSynced = (synced: boolean) => {
      collabSyncedRef.current = synced;
      setCollabStatus(
        synced
          ? 'synced'
          : provider.wsconnected
            ? 'connected'
            : provider.wsconnecting
              ? 'connecting'
              : 'disconnected'
      );
    };

    provider.awareness.setLocalStateField('user', {
      name: userName,
      color: userColor,
    });
    provider.awareness.on('update', updateAwarenessCount);
    provider.on('status', handleStatus);
    provider.on('synced', handleSynced);

    setCollaboration({ document, provider });
    updateAwarenessCount();

    return () => {
      collabSyncedRef.current = false;
      provider.awareness.off('update', updateAwarenessCount);
      provider.off('status', handleStatus);
      provider.off('synced', handleSynced);
      provider.destroy();
      document.destroy();
      setCollaboration(null);
    };
  }, [id, online, token, user?.displayName, user?.email, user?.id]);

  // Save to server — uses titleRef to avoid re-creating on every keystroke
  const saveToServer = useCallback(async () => {
    if (!id || !token || !user || !note) return;
    setSaving(true);
    const currentTitle = titleRef.current;
    const now = new Date().toISOString();
    const isCollabActive = collaboration != null;
    const localNote: OfflineNote = {
      id,
      userId: user.id,
      title: currentTitle,
      content: contentRef.current,
      createdAt: note.createdAt ?? note.updatedAt ?? now,
      updatedAt: note.updatedAt ?? now,
      serverUpdatedAt: note.serverUpdatedAt,
      baseUpdatedAt: note.baseUpdatedAt ?? note.serverUpdatedAt ?? note.updatedAt,
      localUpdatedAt: now,
      sourcePdfId: note.sourcePdfId,
      syncStatus: 'pending',
    };

    try {
      // When collaboration is active, content is persisted via Yjs/CRDT by the
      // collab-service.  Only save the title via REST to avoid dual-write
      // conflicts and stale baseUpdatedAt causing spurious 409 errors.
      if (isCollabActive) {
        if (!navigator.onLine || id.startsWith('local-')) {
          setSaving(false);
          return;
        }
        try {
          await api.put(`/api/doc/notes/${id}`, { title: currentTitle }, token);
          setLastSaved(new Date().toLocaleTimeString());
        } catch (titleErr) {
          console.error('Title save failed during collab:', titleErr);
        }
        setSaving(false);
        return;
      }

      await upsertLocalNote(localNote);

      if (!navigator.onLine || id.startsWith('local-')) {
        await queueChange({
          userId: user.id,
          noteId: id,
          type: id.startsWith('local-') ? 'create' : 'update',
          title: currentTitle,
          content: contentRef.current,
          createdAt: localNote.createdAt,
          baseUpdatedAt: localNote.baseUpdatedAt,
        });
        setNote(cachedToDetail(localNote));
        setLastSaved(`${new Date().toLocaleTimeString()} 本地`);
        await syncNow();
        return;
      }

      const saved = await api.put<NoteDetail>(`/api/doc/notes/${id}`, {
        title: currentTitle,
        content: contentRef.current,
        baseUpdatedAt: localNote.baseUpdatedAt,
      }, token);
      const synced = {
        ...localNote,
        title: saved.title ?? title,
        content: saved.content ?? contentRef.current,
        updatedAt: saved.updatedAt,
        serverUpdatedAt: saved.updatedAt,
        baseUpdatedAt: saved.updatedAt,
        localUpdatedAt: saved.updatedAt,
        syncStatus: 'synced' as const,
        error: undefined,
      };
      await removeServerConflictCopy(user.id, id);
      await upsertLocalNote(synced);
      setNote(cachedToDetail(synced));
      setLastSaved(new Date().toLocaleTimeString());
      fetchNotes(); // refresh sidebar list
    } catch (err) {
      console.error('Save failed:', err);
      if (err instanceof ApiError && err.status === 409) {
        const data = err.data as { serverNote?: NoteDetail };
        await upsertLocalNote({
          ...localNote,
          syncStatus: 'conflict',
          error: '服务器版本已更新，请选择保留本地草稿或使用服务器版本。',
        });
        if (data.serverNote) {
          await upsertCachedNote(detailToCached({
            ...data.serverNote,
            id: `${id}__server`,
            serverUpdatedAt: data.serverNote.updatedAt,
            baseUpdatedAt: data.serverNote.updatedAt,
            syncStatus: 'synced',
          }, user.id));
        }
        setNote({
          ...cachedToDetail(localNote),
          syncStatus: 'conflict',
          error: '服务器版本已更新，请选择保留本地草稿或使用服务器版本。',
        });
      } else {
        await queueChange({
          userId: user.id,
          noteId: id,
          type: id.startsWith('local-') ? 'create' : 'update',
          title: currentTitle,
          content: contentRef.current,
          createdAt: localNote.createdAt,
          baseUpdatedAt: localNote.baseUpdatedAt,
        });
        setNote(cachedToDetail({
          ...localNote,
          error: '网络不可用或服务器暂时不可达，已保存在本地等待同步。',
        }));
        setLastSaved(`${new Date().toLocaleTimeString()} 本地`);
      }
    } finally {
      setSaving(false);
    }
  }, [collaboration, fetchNotes, id, note, syncNow, token, upsertLocalNote, user]);

  // Debounced auto-save (3 seconds after last edit)
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveToServer();
    }, 3000);
  }, [saveToServer]);

  // Handle editor content change
  const handleContentUpdate = useCallback(
    (html: string) => {
      contentRef.current = html;
      // During collaboration, content is synced via Yjs — no need to trigger
      // the debounced REST save.  Title changes still go through scheduleSave.
      if (!collaboration) {
        scheduleSave();
      }
    },
    [collaboration, scheduleSave]
  );

  // Handle title change
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    titleRef.current = e.target.value;
    scheduleSave();
  };

  const handleImageUpload = useCallback(async (file: File): Promise<string> => {
    if (!token) throw new Error('未登录');
    const form = new FormData();
    form.append('file', file);
    const result = await api.postForm<{ url: string }>('/api/doc/images/upload', form, token);
    return result.url;
  }, [token]);

  const handlePdfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !token) return;

    setUploadingPdf(true);
    setAiError('');
    setPdfJob(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await api.postForm<PdfJobResponse>('/api/doc/pdf/jobs', form, token);
      setPdfJob(result);
    } catch (err) {
      console.error('PDF upload failed:', err);
      setAiError(err instanceof Error ? err.message : 'PDF 上传失败');
      setUploadingPdf(false);
    }
  };

  const retryPdfJob = async () => {
    if (!pdfJob || !token) return;
    setUploadingPdf(true);
    setAiError('');
    try {
      const result = await api.post<PdfJobResponse>(`/api/doc/pdf/jobs/${pdfJob.jobId}/retry`, {}, token);
      setPdfJob(result);
    } catch (err) {
      console.error('PDF retry failed:', err);
      setAiError(err instanceof Error ? err.message : 'PDF 重试失败');
      setUploadingPdf(false);
    } finally {
      // Parsed/failed state is settled by the polling effect.
    }
  };

  /** Cancel any ongoing SSE stream */
  const cancelStream = () => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    setAiLoading(null);
  };

  const runSummary = useCallback(async () => {
    if (!id) return;
    cancelStream();
    setAiLoading('summary');
    setAiError('');
    setAiResult('');
    setAiResultStreaming('');
    setAiSources([]);

    const abort = new AbortController();
    streamAbortRef.current = abort;

    await streamAI(
      '/api/ai/summary',
      { noteId: id, documentId: note?.sourcePdfId, text: contentRef.current },
      {
        onMeta: (meta) => setAiSources(meta.sources ?? []),
        onChunk: (chunk) => setAiResultStreaming((prev) => prev + chunk),
        onDone: (result) => {
          setAiResult(result.content ?? '');
          setAiResultStreaming('');
          setAiLoading(null);
        },
        onError: (err) => {
          if (err.name !== 'AbortError') {
            setAiError(err.message || '摘要生成失败');
          }
          setAiLoading(null);
        },
      },
      abort.signal,
    );
  }, [id, note?.sourcePdfId]);

  const runChat = useCallback(async () => {
    if (!id || !aiQuestion.trim()) return;
    console.log('[runChat] text length:', contentRef.current.length, 'question:', aiQuestion.trim().slice(0, 50));
    cancelStream();
    setAiLoading('chat');
    setAiError('');
    setAiResult('');
    setAiResultStreaming('');
    setAiSources([]);

    const abort = new AbortController();
    streamAbortRef.current = abort;

    await streamAI(
      '/api/ai/chat',
      { noteId: id, documentId: note?.sourcePdfId, question: aiQuestion.trim(), text: contentRef.current },
      {
        onMeta: (meta) => setAiSources(meta.sources ?? []),
        onChunk: (chunk) => setAiResultStreaming((prev) => prev + chunk),
        onDone: (result) => {
          setAiResult(result.content ?? '');
          setAiResultStreaming('');
          setAiLoading(null);
        },
        onError: (err) => {
          if (err.name !== 'AbortError') {
            setAiError(err.message || '问答失败');
          }
          setAiLoading(null);
        },
      },
      abort.signal,
    );
  }, [id, note?.sourcePdfId, aiQuestion]);

  const runPolish = useCallback(async () => {
    if (!selectedText.trim()) return;
    cancelStream();
    setAiLoading('polish');
    setAiError('');
    setPolishResult('');
    setPolishStreaming('');
    setShowPolishModal(true);

    const abort = new AbortController();
    streamAbortRef.current = abort;

    await streamAI(
      '/api/ai/polish',
      { text: selectedText },
      {
        onChunk: (chunk) => setPolishStreaming((prev) => prev + chunk),
        onDone: (result) => {
          setPolishResult(result.content ?? '');
          setPolishStreaming('');
          setAiLoading(null);
        },
        onError: (err) => {
          if (err.name !== 'AbortError') {
            setAiError(err.message || '润色失败');
          }
          setAiLoading(null);
          setShowPolishModal(false);
        },
      },
      abort.signal,
    );
  }, [selectedText]);

  const applyPolishResult = (replaceSelection: boolean) => {
    const text = polishResult || polishStreaming;
    if (!text.trim()) return;
    if (replaceSelection) {
      // Replace: wrap in a marker so EditorPage inserts as replacement
      setInsertRequest({
        id: Date.now(),
        html: textToParagraphs(text),
      });
    } else {
      setInsertRequest({
        id: Date.now(),
        html: `<h2>润色结果</h2>${textToParagraphs(text)}`,
      });
    }
    scheduleSave();
    setShowPolishModal(false);
  };

  const insertAiResult = () => {
    const text = aiResult || aiResultStreaming;
    if (!text.trim()) return;
    setInsertRequest({
      id: Date.now(),
      html: `<h2>AI 结果</h2>${textToParagraphs(text)}`
    });
    scheduleSave();
  };

  const handleResolveConflict = async (resolution: 'local' | 'server') => {
    if (!id || !user) return;
    await resolveConflict(id, resolution);
    const next = await getCachedNote(user.id, id);
    if (next) {
      const detail = cachedToDetail(next);
      setNote(detail);
      setTitle(detail.title);
      titleRef.current = detail.title;
      contentRef.current = detail.content;
    }
  };

  const handleExportMarkdown = useCallback(() => {
    const md = htmlToMarkdown(contentRef.current);
    downloadFile(md, `${title || '笔记'}.md`, 'text/markdown');
  }, [title]);

  const handleExportHtml = useCallback(() => {
    downloadFile(contentRef.current, `${title || '笔记'}.html`, 'text/html');
  }, [title]);

  const handleRestoreVersion = useCallback(
    (result: { content: string; title: string; restoredYjs?: boolean }) => {
      contentRef.current = result.content;
      setTitle(result.title);
      titleRef.current = result.title;
      setNote((prev) => (prev ? { ...prev, content: result.content, title: result.title } : prev));
      fetchNotes();

      // Increment contentKey to force Editor to re-initialize with restored content
      setContentKey((k) => k + 1);
    },
    [fetchNotes],
  );

  // Ctrl+S to save immediately
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveToServer();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveToServer]);

  // Cleanup timer on unmount, cancel any stream
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      cancelStream();
    };
  }, []);

  // Clear AI state when switching notes
  useEffect(() => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    setAiLoading(null);
    setAiResult('');
    setAiResultStreaming('');
    setAiSources([]);
    setAiError('');
    setAiQuestion('');
    setPolishResult('');
    setPolishStreaming('');
    setShowPolishModal(false);
    setSelectedText('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // The floating polish toolbar shown when text is selected
  const polishToolbar = useMemo(() => selectedText ? (
    <button
      id="btn-polish-selection"
      type="button"
      className="btn-polish"
      onClick={runPolish}
      disabled={aiLoading !== null}
      title="润色选中文字"
    >
      {aiLoading === 'polish' ? (
        <span className="ai-spinner" />
      ) : (
        '✦ 润色'
      )}
    </button>
  ) : null, [selectedText, aiLoading, runPolish]);

  // Stable collaboration object for Editor — avoids new reference every render
  const stableCollab = useMemo(() => {
    if (!collaboration || !user) return undefined;
    return {
      ...collaboration,
      user: {
        name: user.displayName ?? user.email ?? '协作者',
        color: getUserColor(user.id ?? token ?? 'guest'),
      },
    };
  }, [collaboration, user?.displayName, user?.email, user?.id, token]);

  if (loading) {
    return (
      <div className="editor-page">
        <div className="editor-loading">加载中…</div>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="editor-page">
        <div className="editor-loading">笔记不存在</div>
      </div>
    );
  }

  const displayText = aiResultStreaming || aiResult;
  const isStreaming = aiLoading === 'summary' || aiLoading === 'chat';

  return (
    <div className="editor-page">
      <header className="editor-header">
        <input
          className="title-input"
          type="text"
          value={title}
          onChange={handleTitleChange}
          placeholder="笔记标题"
        />
        <div className="editor-status">
          <span className={`offline-status offline-status-${note.syncStatus ?? 'synced'}`}>
            {!online ? '离线编辑' : note.syncStatus === 'pending' ? '待同步' : note.syncStatus === 'conflict' ? '有冲突' : syncing ? '同步中…' : '已同步'}
          </span>
          <span className={`collab-status collab-status-${collabStatus}`}>
            {getStatusText(collabStatus, collaboratorCount)}
          </span>
          {saving && <span className="status-saving">保存中…</span>}
          {!saving && lastSaved && (
            <span className="status-saved">已保存 {lastSaved}</span>
          )}
          {id && !id.startsWith('local-') && (
            <>
              <button
                className="btn-secondary"
                onClick={() => setShowShareDialog(true)}
                title="分享笔记"
              >
                分享
              </button>
              <button
                className="btn-secondary"
                onClick={() => setShowVersionHistory(true)}
                title="查看版本历史"
              >
                版本历史
              </button>
            </>
          )}
          <button className="btn-secondary" onClick={handleExportMarkdown} title="导出为 Markdown">
            导出 .md
          </button>
          <button className="btn-secondary" onClick={handleExportHtml} title="导出为 HTML">
            导出 .html
          </button>
          <button className="btn-save" onClick={saveToServer} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </header>

      <section className="ai-workbench">
        {note.syncStatus === 'conflict' && (
          <div className="sync-conflict-panel">
            <span>{note.error ?? '服务器版本已更新，请处理当前本地草稿。'}</span>
            <button type="button" className="btn-secondary" onClick={() => handleResolveConflict('local')}>
              保留本地草稿
            </button>
            <button type="button" className="btn-secondary" onClick={() => handleResolveConflict('server')}>
              使用服务器版本
            </button>
          </div>
        )}
        <div className="pdf-upload-control">
          <label className="btn-secondary">
            {uploadingPdf ? '处理中…' : '上传 PDF'}
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={handlePdfUpload}
              disabled={uploadingPdf}
            />
          </label>
          <button
            type="button"
            className="btn-secondary"
            onClick={runSummary}
            disabled={aiLoading !== null}
          >
            {aiLoading === 'summary' ? (
              <><span className="ai-spinner" /> 生成中</>
            ) : '生成摘要'}
          </button>
        </div>

        {pdfJob && (
          <div className={`pdf-job-panel pdf-job-panel-${pdfJob.status}`}>
            <div className="pdf-job-main">
              <span className="pdf-job-status">{getPdfJobStatusText(pdfJob.status)}</span>
              {pdfJob.fileName && <span>{pdfJob.fileName}</span>}
              <span>任务 {pdfJob.jobId.slice(-8)}</span>
            </div>
            <div className="pdf-job-meta">
              {pdfJob.parser && <span>{pdfJob.parser}</span>}
              {typeof pdfJob.pages === 'number' && <span>{pdfJob.pages} 页</span>}
              {typeof pdfJob.chunks === 'number' && <span>{pdfJob.chunks} chunks</span>}
              {typeof pdfJob.assetCount === 'number' && <span>{pdfJob.assetCount} 图片</span>}
              {pdfJob.fallbackReason && <span>{pdfJob.fallbackReason}</span>}
              {pdfJob.warnings?.slice(0, 1).map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
            {pdfJob.status === 'failed' && (
              <div className="pdf-job-actions">
                <span>{pdfJob.error ?? 'PDF 解析失败'}</span>
                <button type="button" className="btn-secondary" onClick={retryPdfJob} disabled={uploadingPdf}>
                  {uploadingPdf ? '重试中…' : '重试解析'}
                </button>
              </div>
            )}
          </div>
        )}

        {lastPdfUpload && (
          <div className={`pdf-parse-summary${lastPdfUpload.fallbackReason ? ' pdf-parse-summary-warning' : ''}`}>
            <span>{lastPdfUpload.parser ?? 'PDF'} · {lastPdfUpload.pages} 页</span>
            <span>{lastPdfUpload.chunks ?? 0} chunks</span>
            <span>{lastPdfUpload.assetCount ?? 0} 图片</span>
            {lastPdfUpload.fallbackReason && <span>{lastPdfUpload.fallbackReason}</span>}
            {lastPdfUpload.warnings?.slice(0, 1).map((warning) => (
              <span key={warning}>{warning}</span>
            ))}
          </div>
        )}

        <div className="ai-chat-control">
          <input
            type="text"
            value={aiQuestion}
            onChange={(event) => setAiQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runChat();
            }}
            placeholder="向当前笔记或 PDF 提问…"
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={runChat}
            disabled={aiLoading !== null || !aiQuestion.trim()}
          >
            {aiLoading === 'chat' ? (
              <><span className="ai-spinner" /> 检索中</>
            ) : '问答'}
          </button>
          {(aiLoading === 'summary' || aiLoading === 'chat') && (
            <button
              type="button"
              className="btn-secondary btn-stop"
              onClick={cancelStream}
              title="停止生成"
            >
              ■ 停止
            </button>
          )}
        </div>

        {(displayText || aiError) && (
          <div className="ai-result-panel">
            {aiError ? (
              <p className="ai-error">{aiError}</p>
            ) : (
              <>
                <p className={`ai-result-text${isStreaming ? ' ai-result-streaming' : ''}`}>
                  {displayText}
                </p>
                {aiSources.length > 0 && (
                  <div className="ai-sources">
                    {aiSources.slice(0, 3).map((source) => (
                      <span
                        key={`${source.sourceName}-${source.chunkIndex}`}
                        title={source.textPreview || source.text}
                      >
                        {source.sourceName || 'PDF'} #{source.chunkIndex + 1}
                        {source.textPreview ? ` · ${source.textPreview}` : ''}
                      </span>
                    ))}
                  </div>
                )}
                {!isStreaming && (
                  <button type="button" className="btn-link" onClick={insertAiResult}>
                    插入笔记
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <Editor
        key={id}
        content={note.content}
        onUpdate={handleContentUpdate}
        insertRequest={insertRequest}
        onSelectionChange={setSelectedText}
        floatingToolbar={polishToolbar}
        collaboration={stableCollab}
        contentKey={contentKey}
        onImageUpload={handleImageUpload}
      />

      {/* Version History */}
      {showVersionHistory && id && (
        <VersionHistory
          documentId={id}
          onClose={() => setShowVersionHistory(false)}
          onRestore={handleRestoreVersion}
        />
      )}

      {/* Share Dialog */}
      {showShareDialog && id && (
        <ShareDialog
          documentId={id}
          onClose={() => setShowShareDialog(false)}
        />
      )}

      {/* Polish Modal */}
      {showPolishModal && (
        <div className="polish-modal-overlay" onClick={() => {
          if (aiLoading !== 'polish') setShowPolishModal(false);
        }}>
          <div className="polish-modal" onClick={(e) => e.stopPropagation()}>
            <div className="polish-modal-header">
              <h2>✦ AI 润色</h2>
              <button
                type="button"
                className="polish-modal-close"
                onClick={() => {
                  cancelStream();
                  setShowPolishModal(false);
                }}
              >
                ✕
              </button>
            </div>

            <div className="polish-modal-body">
              <div className="polish-panel">
                <div className="polish-panel-label">原文</div>
                <div className="polish-original">{selectedText}</div>
              </div>
              <div className="polish-divider">→</div>
              <div className="polish-panel">
                <div className="polish-panel-label">润色结果</div>
                <div className={`polish-result${aiLoading === 'polish' ? ' ai-result-streaming' : ''}`}>
                  {polishStreaming || polishResult || (
                    aiLoading === 'polish' ? <span className="polish-thinking">润色中…</span> : null
                  )}
                </div>
              </div>
            </div>

            {(polishResult || polishStreaming) && aiLoading !== 'polish' && (
              <div className="polish-modal-footer">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => applyPolishResult(true)}
                >
                  替换选中文本
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => applyPolishResult(false)}
                >
                  插入笔记
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowPolishModal(false)}
                >
                  关闭
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
