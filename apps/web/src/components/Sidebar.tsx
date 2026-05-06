import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNotes } from '../contexts/NotesContext';
import { markdownToHtml, readFileAsText } from '../lib/markdownConvert';
import NoteList from './NoteList';
import ThemeToggle from './ThemeToggle';

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const { user, logout } = useAuth();
  const { createNote, online, syncing, syncNow } = useNotes();
  const navigate = useNavigate();
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleNewNote() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const note = await createNote();
      navigate(`/note/${note.id}`);
    } catch (err) {
      console.error('Failed to create note:', err);
      setError('创建笔记失败，请重试');
    } finally {
      setCreating(false);
    }
  }

  async function handleImportMarkdown(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);

    try {
      const md = await readFileAsText(file);
      const html = markdownToHtml(md);
      const title = file.name.replace(/\.md$/i, '') || '导入的笔记';
      const note = await createNote(title);
      navigate(`/note/${note.id}?import=1`, { state: { importContent: html } });
    } catch (err) {
      console.error('Failed to import markdown:', err);
      setError('导入失败，请确认文件格式正确');
    }
  }

  return (
    <aside className={`sidebar${open ? ' sidebar-open' : ''}`}>
      <div className="sidebar-top">
        <div className="sidebar-brand">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#4f46e5" />
            <path d="M9 10h14M9 16h10M9 22h12" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span>AI Notes</span>
          {onClose && (
            <button type="button" className="sidebar-close" onClick={onClose} aria-label="关闭侧边栏">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        <button className="btn-new-note" onClick={handleNewNote} disabled={creating}>
          <span>+</span> {creating ? '创建中…' : '新建笔记'}
        </button>
        {error && (
          <div className="sidebar-error" role="alert">
            {error}
            <button type="button" className="note-list-error-dismiss" onClick={() => setError(null)}>×</button>
          </div>
        )}
        <label className="btn-import-md">
          导入 .md
          <input
            type="file"
            accept=".md,.markdown,text/markdown"
            onChange={handleImportMarkdown}
          />
        </label>
      </div>

      <div className="sidebar-notes">
        <NoteList />
      </div>

      <div className="sidebar-bottom">
        <ThemeToggle />
        <button className="sync-status-button" onClick={syncNow} disabled={!online || syncing} title="同步离线改动">
          {!online ? '离线' : syncing ? '同步中…' : '同步'}
        </button>
        <div className="user-info">
          <div className="user-avatar">
            {user?.displayName?.charAt(0)?.toUpperCase() ?? '?'}
          </div>
          <span className="user-name">{user?.displayName ?? '用户'}</span>
        </div>
        <button className="btn-logout" onClick={logout} title="退出登录">
          退出
        </button>
      </div>
    </aside>
  );
}
