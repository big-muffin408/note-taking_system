import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { useAuth } from '../contexts/AuthContext';
import { useNotes } from '../contexts/NotesContext';
import { api } from '../lib/api';
import Editor from '../components/Editor';

interface NoteDetail {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  sourcePdfId?: string;
}

type CollabStatus = 'connecting' | 'connected' | 'disconnected' | 'synced';
type AiMode = 'summary' | 'chat';

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
  status: string;
  markdownDraft: string;
}

interface AiSummaryResponse {
  content: string;
}

interface AiChatResponse {
  answer: string;
  sources: Array<{
    score: number;
    text: string;
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

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const { token, user } = useAuth();
  const { fetchNotes } = useNotes();
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
  const [aiLoading, setAiLoading] = useState<AiMode | null>(null);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiResult, setAiResult] = useState('');
  const [aiSources, setAiSources] = useState<AiChatResponse['sources']>([]);
  const [aiError, setAiError] = useState('');
  const [insertRequest, setInsertRequest] = useState<{ id: number; html: string } | null>(null);

  const contentRef = useRef('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Load note from server
  useEffect(() => {
    if (!id || !token) return;

    setLoading(true);
    api
      .get<NoteDetail>(`/api/doc/notes/${id}`, token)
      .then((data) => {
        setNote(data);
        setTitle(data.title);
        contentRef.current = data.content;
      })
      .catch((err) => {
        console.error('Failed to load note:', err);
        navigate('/', { replace: true });
      })
      .finally(() => setLoading(false));
  }, [id, token, navigate]);

  useEffect(() => {
    if (!id || !token || !note) return;

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
      setCollabStatus(status);
    };

    const handleSynced = (synced: boolean) => {
      if (synced) setCollabStatus('synced');
    };

    provider.awareness.setLocalStateField('user', {
      name: user?.displayName ?? user?.email ?? '协作者',
      color: getUserColor(user?.id ?? token),
    });
    provider.awareness.on('update', updateAwarenessCount);
    provider.on('status', handleStatus);
    provider.on('synced', handleSynced);

    setCollaboration({ document, provider });
    updateAwarenessCount();

    return () => {
      provider.awareness.off('update', updateAwarenessCount);
      provider.off('status', handleStatus);
      provider.off('synced', handleSynced);
      provider.destroy();
      document.destroy();
      setCollaboration(null);
    };
  }, [id, note, token, user]);

  // Save to server
  const saveToServer = useCallback(async () => {
    if (!id || !token) return;
    setSaving(true);
    try {
      await api.put(`/api/doc/notes/${id}`, {
        title,
        content: contentRef.current,
      }, token);
      setLastSaved(new Date().toLocaleTimeString());
      fetchNotes(); // refresh sidebar list
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  }, [id, token, title, fetchNotes]);

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
    },
    []
  );

  // Handle title change
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    scheduleSave();
  };

  const handlePdfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !token) return;

    setUploadingPdf(true);
    setAiError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await api.postForm<PdfUploadResponse>('/api/doc/pdf/upload', form, token);
      await fetchNotes();
      navigate(`/note/${result.noteId}`);
    } catch (err) {
      console.error('PDF upload failed:', err);
      setAiError(err instanceof Error ? err.message : 'PDF 上传失败');
    } finally {
      setUploadingPdf(false);
    }
  };

  const runSummary = async () => {
    if (!id || !token) return;

    setAiLoading('summary');
    setAiError('');
    setAiSources([]);
    try {
      const result = await api.post<AiSummaryResponse>('/api/ai/summary', {
        noteId: id,
        documentId: note?.sourcePdfId,
        text: contentRef.current,
      }, token);
      setAiResult(result.content);
    } catch (err) {
      console.error('Summary failed:', err);
      setAiError(err instanceof Error ? err.message : '摘要生成失败');
    } finally {
      setAiLoading(null);
    }
  };

  const runChat = async () => {
    if (!id || !token || !aiQuestion.trim()) return;

    setAiLoading('chat');
    setAiError('');
    try {
      const result = await api.post<AiChatResponse>('/api/ai/chat', {
        noteId: id,
        documentId: note?.sourcePdfId,
        question: aiQuestion.trim(),
      }, token);
      setAiResult(result.answer);
      setAiSources(result.sources ?? []);
    } catch (err) {
      console.error('Chat failed:', err);
      setAiError(err instanceof Error ? err.message : '问答失败');
    } finally {
      setAiLoading(null);
    }
  };

  const insertAiResult = () => {
    if (!aiResult.trim()) return;
    setInsertRequest({
      id: Date.now(),
      html: `<h2>AI 结果</h2>${textToParagraphs(aiResult)}`
    });
    scheduleSave();
  };

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

  // Cleanup timer on unmount, trigger final save
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

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
          <span className={`collab-status collab-status-${collabStatus}`}>
            {getStatusText(collabStatus, collaboratorCount)}
          </span>
          {saving && <span className="status-saving">保存中…</span>}
          {!saving && lastSaved && (
            <span className="status-saved">标题已保存 {lastSaved}</span>
          )}
          <button className="btn-save" onClick={saveToServer} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </header>

      <section className="ai-workbench">
        <div className="pdf-upload-control">
          <label className="btn-secondary">
            {uploadingPdf ? '解析中…' : '上传 PDF'}
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
            {aiLoading === 'summary' ? '生成中…' : '生成摘要'}
          </button>
        </div>

        <div className="ai-chat-control">
          <input
            type="text"
            value={aiQuestion}
            onChange={(event) => setAiQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runChat();
            }}
            placeholder="向当前笔记或 PDF 提问"
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={runChat}
            disabled={aiLoading !== null || !aiQuestion.trim()}
          >
            {aiLoading === 'chat' ? '检索中…' : '问答'}
          </button>
        </div>

        {(aiResult || aiError) && (
          <div className="ai-result-panel">
            {aiError ? (
              <p className="ai-error">{aiError}</p>
            ) : (
              <>
                <p className="ai-result-text">{aiResult}</p>
                {aiSources.length > 0 && (
                  <div className="ai-sources">
                    {aiSources.slice(0, 3).map((source) => (
                      <span key={`${source.sourceName}-${source.chunkIndex}`}>
                        {source.sourceName || 'PDF'} #{source.chunkIndex + 1}
                      </span>
                    ))}
                  </div>
                )}
                <button type="button" className="btn-link" onClick={insertAiResult}>
                  插入笔记
                </button>
              </>
            )}
          </div>
        )}
      </section>

      <Editor
        content={note.content}
        onUpdate={handleContentUpdate}
        insertRequest={insertRequest}
        collaboration={
          collaboration
            ? {
                ...collaboration,
                user: {
                  name: user?.displayName ?? user?.email ?? '协作者',
                  color: getUserColor(user?.id ?? token ?? 'guest'),
                },
              }
            : undefined
        }
      />
    </div>
  );
}
