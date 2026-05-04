import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNotes } from '../contexts/NotesContext';
import NoteList from './NoteList';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { createNote } = useNotes();
  const navigate = useNavigate();

  async function handleNewNote() {
    try {
      const note = await createNote();
      navigate(`/note/${note.id}`);
    } catch (err) {
      console.error('Failed to create note:', err);
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
      </div>

      <div className="sidebar-notes">
        <NoteList />
      </div>

      <div className="sidebar-bottom">
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
