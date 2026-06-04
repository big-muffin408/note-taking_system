import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNotes } from '../contexts/NotesContext';
import { markdownToHtml, readFileAsText } from '../lib/markdownConvert';
import NoteList from './NoteList';
import ThemeToggle from './ThemeToggle';
import BrandMark from './BrandMark';

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
  onResizeStart?: (e: React.MouseEvent) => void;
}

export default function Sidebar({ open, onClose, onResizeStart }: SidebarProps) {
  const { user, logout } = useAuth();
  const { notes, createNote, online, syncing, syncNow } = useNotes();
  const navigate = useNavigate();
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<'all' | 'starred' | 'shared' | 'recent'>('all');
  const [query, setQuery] = React.useState('');
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const currentUserId = user?.id;
  const starredCount = notes.filter((n) => (n as any).starred).length;
  const sharedCount = currentUserId
    ? notes.filter((n) => (n as any).ownerId && (n as any).ownerId !== currentUserId).length
    : 0;

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

  const syncLabel = !online ? '离线' : syncing ? '同步中…' : '已同步 · 在线';

  return (
    <aside className={`sidebar${open ? ' sidebar-open' : ''}`} style={{ position: 'relative' }}>
      <div className="sidebar-top">
        {/* Brand */}
        <div className="brand">
          <div className="brand-mark brand-mark-svg"><BrandMark size={28} /></div>
          <div className="brand-name">Quire <em>· 集册</em></div>
          {onClose && (
            <button
              type="button"
              className="sidebar-close"
              onClick={onClose}
              aria-label="关闭侧边栏"
              style={{ marginLeft: 'auto' }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {/* Actions: new note + import */}
        <div className="sidebar-actions">
          <button className="btn-new" onClick={handleNewNote} disabled={creating}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" width="14" height="14"><path d="M8 3v10M3 8h10"/></svg>
            {creating ? '创建中…' : '新建笔记'}
          </button>
          <label className="btn-import-md" title="导入 Markdown">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><path d="M8 11V3M5 6l3-3 3 3M3 13h10"/></svg>
            <input
              type="file"
              accept=".md,.markdown,text/markdown"
              onChange={handleImportMarkdown}
            />
          </label>
        </div>

        {error && (
          <div className="sidebar-error" role="alert">
            {error}
            <button type="button" className="note-list-error-dismiss" onClick={() => setError(null)}>×</button>
          </div>
        )}

        {/* Search */}
        <div className="search">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>
          </svg>
          <input
            ref={searchInputRef}
            placeholder="搜索笔记 · 内容"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
            aria-label="搜索笔记"
          />
          {query ? (
            <button
              type="button"
              className="search-clear"
              onClick={() => { setQuery(''); searchInputRef.current?.focus(); }}
              aria-label="清除搜索"
            >×</button>
          ) : (
            <span className="search-kbd">⌘K</span>
          )}
        </div>
      </div>

      {/* Nav filters */}
      <div className="sidebar-nav">
        <button
          className={`nav-item${filter === 'all' ? ' active' : ''}`}
          onClick={() => setFilter('all')}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="14" height="14"><path d="M3 2h7l3 3v9H3z"/><path d="M10 2v3h3M5.5 9h5M5.5 11.5h5M5.5 6.5h2.5" strokeLinecap="round"/></svg>
          全部笔记
          <span className="nav-item-count">{notes.length}</span>
        </button>
        <button
          className={`nav-item${filter === 'starred' ? ' active' : ''}`}
          onClick={() => setFilter('starred')}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" width="14" height="14"><path d="M8 2l1.9 3.85L14 6.45l-3 2.92.7 4.13L8 11.55 4.3 13.5 5 9.37 2 6.45l4.1-.6L8 2z"/></svg>
          收藏
          <span className="nav-item-count">{starredCount}</span>
        </button>
        <button
          className={`nav-item${filter === 'shared' ? ' active' : ''}`}
          onClick={() => setFilter('shared')}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><circle cx="4" cy="8" r="2"/><circle cx="12" cy="4" r="2"/><circle cx="12" cy="12" r="2"/><path d="M5.7 7l4.6-2.5M5.7 9l4.6 2.5"/></svg>
          共享给我
          <span className="nav-item-count">{sharedCount}</span>
        </button>
        <button
          className={`nav-item${filter === 'recent' ? ' active' : ''}`}
          onClick={() => setFilter('recent')}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" width="14" height="14"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></svg>
          最近编辑
        </button>
      </div>

      {/* Notes section */}
      <div className="section-label">
        {query.trim() ? '搜索结果'
          : filter === 'starred' ? '收藏笔记'
          : filter === 'shared' ? '共享给我'
          : filter === 'recent' ? '最近编辑'
          : '最近笔记'}
      </div>

      <div className="sidebar-notes">
        <NoteList filter={filter} query={query} />
      </div>

      {/* Footer */}
      <div className="sidebar-bottom">
        <ThemeToggle />
        <div className="sidebar-foot-row">
          <button
            className="user-chip"
            onClick={syncNow}
            disabled={!online || syncing}
            title="点击同步离线改动"
            style={{ flex: 1 }}
          >
            <div className="user-avatar">
              {user?.displayName?.charAt(0)?.toUpperCase() ?? '?'}
            </div>
            <div className="user-info">
              <div className="user-name">{user?.displayName ?? '用户'}</div>
              <div className="user-status">
                <span className="ok-dot" />
                {syncLabel}
              </div>
            </div>
          </button>
          <button className="btn-icon" style={{ width: 28, height: 28, border: 0 }} onClick={logout} title="退出登录">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" width="14" height="14">
              <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M10 11l3-3-3-3M13 8H6"/>
            </svg>
          </button>
        </div>
      </div>
      {onResizeStart && (
        <div className="sidebar-resize-handle" onMouseDown={onResizeStart} />
      )}
    </aside>
  );
}
