import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNotes } from '../contexts/NotesContext';
import { markdownToHtml, readFileAsText } from '../lib/markdownConvert';
import NoteList from './NoteList';
import ThemeToggle from './ThemeToggle';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { createNote, online, syncing, syncNow } = useNotes();
  const navigate = useNavigate();

  async function handleNewNote() {
    try {
      const note = await createNote();
      navigate(`/note/${note.id}`);
    } catch (err) {
      console.error('Failed to create note:', err);
    }
  }

  async function handleImportMarkdown(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const md = await readFileAsText(file);
      const html = markdownToHtml(md);
      const title = file.name.replace(/\.md$/i, '') || '导入的笔记';
      const note = await createNote(title);
      // Navigate to the note and the content will be set via the editor
      navigate(`/note/${note.id}?import=1`, { state: { importContent: html } });
    } catch (err) {
      console.error('Failed to import markdown:', err);
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="sidebar-brand">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#4f46e5" />
            <path d="M9 10h14M9 16h10M9 22h12" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span>AI Notes</span>
        </div>

        <button className="btn-new-note" onClick={handleNewNote}>
          <span>+</span> 新建笔记
        </button>
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
