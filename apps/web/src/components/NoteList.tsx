import React from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { useNotes, type NoteSummary } from '../contexts/NotesContext';
import { useAuth } from '../contexts/AuthContext';

export type NoteFilter = 'all' | 'starred' | 'shared' | 'recent';

interface NoteListProps {
  filter?: NoteFilter;
}

function getSnippet(note: NoteSummary): string {
  const raw = (note as any).content ?? (note as any).snippet ?? '';
  if (!raw) return '';
  const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, 80);
}

export default function NoteList({ filter = 'all' }: NoteListProps) {
  const { notes, loading, deleteNote } = useNotes();
  const { user } = useAuth();
  const navigate = useNavigate();

  const filteredNotes = React.useMemo(() => {
    if (filter === 'starred') {
      return notes.filter((n) => (n as any).starred);
    }
    if (filter === 'shared') {
      if (!user?.id) return [];
      return notes.filter((n) => {
        const ownerId = (n as any).ownerId;
        return ownerId && ownerId !== user.id;
      });
    }
    if (filter === 'recent') {
      return [...notes].sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    }
    return notes;
  }, [notes, filter, user?.id]);
  const { id: activeNoteId } = useParams<{ id: string }>();
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [confirmNote, setConfirmNote] = React.useState<NoteSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleDelete(note: NoteSummary) {
    setConfirmNote(null);
    setDeletingId(note.id);
    setError(null);
    try {
      await deleteNote(note.id);
      if (activeNoteId === note.id) {
        navigate('/', { replace: true });
      }
    } catch (err) {
      console.error('Failed to delete note:', err);
      setError(err instanceof Error ? err.message : '删除笔记失败');
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return <div className="note-list-empty">加载中…</div>;
  }

  if (notes.length === 0) {
    return <div className="note-list-empty">暂无笔记，点击上方按钮创建</div>;
  }

  if (filteredNotes.length === 0) {
    const emptyText = filter === 'starred' ? '还没有收藏的笔记'
      : filter === 'shared' ? '没有共享给你的笔记'
      : '暂无笔记';
    return <div className="note-list-empty">{emptyText}</div>;
  }

  return (
    <nav className="note-list" aria-label="笔记列表">
      {error && (
        <div className="note-list-error" role="alert">
          {error}
          <button type="button" className="note-list-error-dismiss" onClick={() => setError(null)}>×</button>
        </div>
      )}
      {filteredNotes.map((note) => (
        <div className="note-item-row" key={note.id}>
          <NavLink
            to={`/note/${note.id}`}
            className={({ isActive }) => `note-item${isActive ? ' active' : ''}`}
          >
            <div className="note-item-main">
              <span className="note-item-title">{note.title || '未命名笔记'}</span>
              {getSnippet(note) && (
                <span className="note-item-snippet">{getSnippet(note)}</span>
              )}
              <div className="note-item-meta">
                <span className="note-item-date">
                  {new Date(note.updatedAt).toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                {note.syncStatus && note.syncStatus !== 'synced' && (
                  <span className={`sync-badge ${note.syncStatus}`}>
                    {note.syncStatus === 'pending' ? '待同步' : note.syncStatus === 'conflict' ? '冲突' : '离线'}
                  </span>
                )}
              </div>
            </div>
          </NavLink>
          <button
            type="button"
            className="note-item-delete"
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); setConfirmNote(note); }}
            disabled={deletingId === note.id}
            aria-label={`删除 ${note.title || '未命名笔记'}`}
            title="删除笔记"
          >
            {deletingId === note.id ? '…' : '×'}
          </button>
        </div>
      ))}

      {confirmNote && createPortal(
        <div className="confirm-overlay" onClick={() => setConfirmNote(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p>确定删除「{confirmNote.title || '未命名笔记'}」吗？此操作无法撤销。</p>
            <div className="confirm-actions">
              <button type="button" className="btn-secondary" onClick={() => setConfirmNote(null)}>取消</button>
              <button type="button" className="btn-danger" onClick={() => handleDelete(confirmNote)}>删除</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </nav>
  );
}
