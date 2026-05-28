import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { useAuth } from '../contexts/AuthContext';
import { useNotes } from '../contexts/NotesContext';
import { useAiPanel } from '../contexts/AiPanelContext';
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
import { getWsBaseUrl } from '../lib/electronConfig';

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

function getCollabServerUrl() {
  const base = getWsBaseUrl().replace(/\/$/, '');

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
  const { fetchNotes, online, syncNow, upsertLocalNote, resolveConflict } = useNotes();
  const ai = useAiPanel();
  const navigate = useNavigate();

  const [note, setNote] = useState<NoteDetail | null>(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [collaboration, setCollaboration] = useState<CollaborationSession | null>(null);
  const [collabStatus, setCollabStatus] = useState<CollabStatus>('connecting');
  const [collaboratorCount, setCollaboratorCount] = useState(1);
  const [collaborators, setCollaborators] = useState<Array<{ name: string; color: string }>>([]);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [lastPdfUpload, setLastPdfUpload] = useState<PdfUploadResponse | null>(null);
  const [pdfJob, setPdfJob] = useState<PdfJobResponse | null>(null);

  const [insertRequest, setInsertRequest] = useState<{ id: number; html: string } | null>(null);
  const [contentKey, setContentKey] = useState(0);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [readingMode, setReadingMode] = useState(false);

  // Aliases into ai context (kept short so existing call sites still read naturally)
  const aiLoading = ai.aiLoading;
  const setAiLoading = ai.setAiLoading;
  const setAiError = ai.setAiError;
  const selectedText = ai.selectedText;
  const setSelectedText = ai.setSelectedText;

  const contentRef = useRef('');
  const titleRef = useRef('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const streamAbortRef = ai.streamAbortRef;
  const collabSyncedRef = useRef(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);

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
      setCollaborators([]);
      setCollaboration(null);
      return;
    }

    collabSyncedRef.current = false;
    setCollabStatus('connecting');
    setCollaboratorCount(1);
    setCollaborators([]);

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
      const states = provider.awareness.getStates();
      setCollaboratorCount(states.size);
      const list: Array<{ name: string; color: string }> = [];
      states.forEach((state: any) => {
        const u = state?.user;
        if (u && typeof u.name === 'string') {
          list.push({ name: u.name, color: typeof u.color === 'string' ? u.color : '#888' });
        }
      });
      setCollaborators(list);
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

  const cancelStream = ai.cancelStream;

  const runSummary = useCallback(async () => {
    if (!id) return;
    cancelStream();
    setAiLoading('summary');
    setAiError('');
    ai.setSummaryResult('');
    ai.setSummaryStreaming('');
    ai.setSummarySources([]);
    ai.setTab('summary');
    if (!ai.open) ai.setOpen(true);

    const abort = new AbortController();
    streamAbortRef.current = abort;

    await streamAI(
      '/api/ai/summary',
      { noteId: id, documentId: note?.sourcePdfId, text: contentRef.current },
      {
        onMeta: (meta) => ai.setSummarySources(meta.sources ?? []),
        onChunk: (chunk) => ai.setSummaryStreaming((prev) => (prev || '') + chunk),
        onDone: (result) => {
          ai.setSummaryResult(result.content ?? '');
          ai.setSummaryStreaming('');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, note?.sourcePdfId]);

  const runChat = useCallback(async (question: string) => {
    if (!id || !question.trim()) return;
    cancelStream();
    setAiLoading('chat');
    setAiError('');

    const userMsg = { who: 'user' as const, text: question.trim() };
    ai.appendMessage(userMsg);
    ai.appendMessage({ who: 'ai', text: '', streaming: true });
    let acc = '';
    let sources: AiChatResponse['sources'] = [];

    const abort = new AbortController();
    streamAbortRef.current = abort;

    await streamAI(
      '/api/ai/chat',
      { noteId: id, documentId: note?.sourcePdfId, question: question.trim(), text: contentRef.current },
      {
        onMeta: (meta) => {
          sources = meta.sources ?? [];
        },
        onChunk: (chunk) => {
          acc += chunk;
          ai.updateLastMessage((last) => ({ ...last, text: acc, streaming: true }));
        },
        onDone: (result) => {
          ai.updateLastMessage((last) => ({
            ...last,
            text: result.content ?? acc,
            streaming: false,
            sources,
          }));
          setAiLoading(null);
        },
        onError: (err) => {
          if (err.name !== 'AbortError') {
            setAiError(err.message || '问答失败');
            ai.updateLastMessage((last) => ({
              ...last,
              text: acc || '（生成失败）',
              streaming: false,
            }));
          } else {
            ai.updateLastMessage((last) => ({
              ...last,
              text: acc,
              streaming: false,
            }));
          }
          setAiLoading(null);
        },
      },
      abort.signal,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, note?.sourcePdfId]);

  const runPolish = useCallback(async () => {
    if (!selectedText.trim()) return;
    cancelStream();
    setAiLoading('polish');
    setAiError('');
    ai.setPolishResult('');
    ai.setPolishStreaming('');
    ai.setTab('polish');
    if (!ai.open) ai.setOpen(true);

    const abort = new AbortController();
    streamAbortRef.current = abort;

    await streamAI(
      '/api/ai/polish',
      { text: selectedText },
      {
        onChunk: (chunk) => ai.setPolishStreaming((prev) => (prev || '') + chunk),
        onDone: (result) => {
          ai.setPolishResult(result.content ?? '');
          ai.setPolishStreaming('');
          setAiLoading(null);
        },
        onError: (err) => {
          if (err.name !== 'AbortError') {
            setAiError(err.message || '润色失败');
          }
          setAiLoading(null);
        },
      },
      abort.signal,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedText]);

  const insertAiResult = useCallback((text: string) => {
    if (!text.trim()) return;
    setInsertRequest({
      id: Date.now(),
      html: textToParagraphs(text),
    });
    scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register handlers so AiPanel can trigger them
  useEffect(() => {
    ai.registerHandlers({
      runSummary,
      runChat,
      runPolish,
      insertResult: insertAiResult,
    });
  }, [ai, runSummary, runChat, runPolish, insertAiResult]);

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
    setAiError('');
    ai.setSummaryResult('');
    ai.setSummaryStreaming('');
    ai.setSummarySources([]);
    ai.setPolishResult('');
    ai.setPolishStreaming('');
    setSelectedText('');
    ai.clearMessages();
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

  // Compute word count from current content (plain text length excluding HTML tags)
  const plainText = note.content.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  const wordCount = plainText.length;
  const updatedLabel = (() => {
    const ts = note.updatedAt;
    if (!ts) return '';
    try {
      const d = new Date(ts);
      const sameDay = d.toDateString() === new Date().toDateString();
      if (sameDay) return `更新于 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
      return `更新于 ${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    } catch {
      return '';
    }
  })();
  const meAvatar = (user?.displayName ?? user?.email ?? '?').charAt(0);
  const otherCollaborators = collaborators.filter((c) => c.name !== (user?.displayName ?? user?.email ?? ''));
  const collaboratorsLabel = otherCollaborators.length > 0
    ? `${user?.displayName ?? '我'} + ${otherCollaborators.length} 位协作者`
    : (user?.displayName ?? '我');

  const noteTags = ((note as any)?.tags as string[] | undefined) ?? [];
  const editorMeta = (
    <div className="editor-meta">
      {updatedLabel && <span>{updatedLabel}</span>}
      {updatedLabel && <span>·</span>}
      <span>{wordCount.toLocaleString()} 字</span>
      <span>·</span>
      <span>{collaboratorsLabel}</span>
      {noteTags.map((t) => (
        <span key={t} className="tag">{t}</span>
      ))}
    </div>
  );

  return (
    <div className="editor-page">
      <header className="topbar">
        <div className="crumbs">
          <span>我的笔记</span>
          <span className="sep">/</span>
          <span className="here">{title || '未命名笔记'}</span>
        </div>
        <div className="topbar-spacer" />

        <div className="save-state">
          {saving ? (
            <><span className="pulse" /> 保存中…</>
          ) : lastSaved ? (
            <><span className="pulse" /> 已保存 {lastSaved}</>
          ) : null}
        </div>

        {collaborators.length > 0 && (
          <div className="presence" title={collaborators.map((c) => c.name).join(', ')}>
            {collaborators.slice(0, 4).map((c, idx) => (
              <div
                key={`${c.name}-${idx}`}
                className="presence-avatar"
                style={{ background: c.color }}
              >
                {c.name.charAt(0).toUpperCase()}
              </div>
            ))}
          </div>
        )}

        {id && !id.startsWith('local-') && (
          <>
            <button className="btn-ghost" onClick={() => setShowVersionHistory(true)} title="查看版本历史">
              历史
            </button>
            <button
              className="btn-ghost"
              onClick={() => pdfInputRef.current?.click()}
              disabled={uploadingPdf}
              title="上传 PDF 解析为笔记"
            >
              {uploadingPdf ? '解析中…' : 'PDF'}
            </button>
            <input
              ref={pdfInputRef}
              type="file"
              accept="application/pdf,.pdf"
              style={{ display: 'none' }}
              onChange={handlePdfUpload}
            />
            <button className="btn-ghost" onClick={() => setShowShareDialog(true)} title="分享笔记">
              分享
            </button>
          </>
        )}
        <button
          className={`btn-ghost btn-reading-mode${readingMode ? ' active' : ''}`}
          onClick={() => setReadingMode((prev) => !prev)}
          title={readingMode ? '切换到编辑模式' : '切换到阅读模式'}
        >
          {readingMode ? '编辑' : '阅读'}
        </button>
        <button className="btn-ghost" onClick={handleExportMarkdown} title="导出为 Markdown">导出</button>
        <button className="btn-ghost" onClick={saveToServer} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
        <button
          className={`btn-ghost${ai.open ? ' active' : ''}`}
          onClick={ai.toggleOpen}
          title="AI 工具面板"
          style={ai.open ? { background: 'var(--ink)', color: 'var(--paper)' } : undefined}
        >
          ✦ AI
        </button>
      </header>

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

      {pdfJob && (pdfJob.status === 'queued' || pdfJob.status === 'parsing' || pdfJob.status === 'failed') && (
        <div className={`pdf-job-floating pdf-job-panel-${pdfJob.status}`}>
          <div className="pdf-job-main">
            <strong>{getPdfJobStatusText(pdfJob.status)}</strong>
            {pdfJob.fileName && <span style={{ marginLeft: 6 }}>{pdfJob.fileName}</span>}
          </div>
          {(pdfJob.status === 'queued' || pdfJob.status === 'parsing') && (
            <div
              className="pdf-job-progress"
              role="progressbar"
              aria-label="PDF 解析进度"
              style={{ marginTop: 6 }}
            >
              <div className="pdf-job-progress-bar" />
            </div>
          )}
          {pdfJob.status === 'failed' && (
            <div className="pdf-job-actions" style={{ marginTop: 6 }}>
              <span>{pdfJob.error ?? 'PDF 解析失败'}</span>
              <button type="button" className="btn-secondary" onClick={retryPdfJob} disabled={uploadingPdf}>
                {uploadingPdf ? '重试中…' : '重试'}
              </button>
            </div>
          )}
        </div>
      )}

      {lastPdfUpload?.warnings?.length ? (
        <div className="pdf-job-floating" style={{ top: 96 }}>
          {lastPdfUpload.parser ?? 'PDF'} · {lastPdfUpload.pages} 页 · {lastPdfUpload.warnings[0]}
        </div>
      ) : null}

      <Editor
        key={id}
        content={note.content}
        onUpdate={handleContentUpdate}
        editable={!readingMode}
        readingMode={readingMode}
        insertRequest={insertRequest}
        onSelectionChange={setSelectedText}
        floatingToolbar={readingMode ? null : polishToolbar}
        collaboration={stableCollab}
        contentKey={contentKey}
        onImageUpload={handleImageUpload}
        title={title}
        onTitleChange={(value) => { setTitle(value); titleRef.current = value; scheduleSave(); }}
        metaSlot={editorMeta}
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

    </div>
  );
}
