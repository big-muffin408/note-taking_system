import React from 'react';
import { NavLink } from 'react-router-dom';
import { useNotes, type NoteSummary } from '../contexts/NotesContext';

export default function NoteList() {
  const { notes, loading } = useNotes();

  if (loading) {
    return <div className="note-list-empty">加载中…</div>;
  }

  if (notes.length === 0) {
    return <div className="note-list-empty">暂无笔记，点击上方按钮创建</div>;
  }

  return (
    <nav className="note-list" aria-label="笔记列表">
      {notes.map((note) => (
        <NavLink
          key={note.id}
          to={`/note/${note.id}`}
          className={({ isActive }) => `note-item${isActive ? ' active' : ''}`}
        >
          <span className="note-item-title">{note.title || '未命名笔记'}</span>
          <span className="note-item-date">
            {new Date(note.updatedAt).toLocaleDateString('zh-CN', {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        </NavLink>
      ))}
    </nav>
  );
}
