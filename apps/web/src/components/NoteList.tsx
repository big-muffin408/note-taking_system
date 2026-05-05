import React from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { useNotes, type NoteSummary } from '../contexts/NotesContext';

export default function NoteList() {
  const { notes, loading, deleteNote } = useNotes();
  const navigate = useNavigate();
  const { id: activeNoteId } = useParams<{ id: string }>();
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  async function handleDelete(
    event: React.MouseEvent<HTMLButtonElement>,
    note: NoteSummary
  ) {
    event.preventDefault();
    event.stopPropagation();

    const title = note.title || '未命名笔记';
    if (!window.confirm(`确定删除「${title}」吗？此操作无法撤销。`)) {
      return;
    }

    setDeletingId(note.id);
    try {
      await deleteNote(note.id);
      if (activeNoteId === note.id) {
        navigate('/', { replace: true });
      }
    } catch (err) {
      console.error('Failed to delete note:', err);
      window.alert(err instanceof Error ? err.message : '删除笔记失败');
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

  return (
    <nav className="note-list" aria-label="笔记列表">
      {notes.map((note) => (
        <div className="note-item-row" key={note.id}>
          <NavLink
            to={`/note/${note.id}`}
            className={({ isActive }) => `note-item${isActive ? ' active' : ''}`}
          >
              <span className="note-item-main">
                <span className="note-item-title">{note.title || '未命名笔记'}</span>
                {note.syncStatus && note.syncStatus !== 'synced' && (
                  <span className={`note-sync-badge note-sync-badge-${note.syncStatus}`}>
                    {note.syncStatus === 'pending' ? '待同步' : note.syncStatus === 'conflict' ? '冲突' : '离线'}
                  </span>
                )}
                <span className="note-item-date">
                {new Date(note.updatedAt).toLocaleDateString('zh-CN', {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </span>
          </NavLink>
          <button
            type="button"
            className="note-item-delete"
            onClick={(event) => handleDelete(event, note)}
            disabled={deletingId === note.id}
            aria-label={`删除 ${note.title || '未命名笔记'}`}
            title="删除笔记"
          >
            {deletingId === note.id ? '…' : '×'}
          </button>
        </div>
      ))}
    </nav>
  );
}
