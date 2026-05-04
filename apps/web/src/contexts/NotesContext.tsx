import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from './AuthContext';

export interface NoteSummary {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
}

interface NotesContextValue {
  notes: NoteSummary[];
  loading: boolean;
  fetchNotes: () => Promise<void>;
  createNote: (title?: string) => Promise<NoteSummary>;
  deleteNote: (id: string) => Promise<void>;
}

const NotesContext = createContext<NotesContextValue | null>(null);

export function NotesProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotes = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      const data = await api.get<{ items: NoteSummary[] }>('/api/doc/notes', token);
      setNotes(data.items);
    } catch (err) {
      console.error('Failed to fetch notes:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      fetchNotes();
    }
  }, [token, fetchNotes]);

  const createNote = useCallback(
    async (title = '未命名笔记') => {
      const note = await api.post<NoteSummary>('/api/doc/notes', { title }, token);
      setNotes((prev) => [note, ...prev]);
      return note;
    },
    [token]
  );

  const deleteNote = useCallback(
    async (id: string) => {
      await api.del(`/api/doc/notes/${id}`, token);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    },
    [token]
  );

  return (
    <NotesContext.Provider value={{ notes, loading, fetchNotes, createNote, deleteNote }}>
      {children}
    </NotesContext.Provider>
  );
}

export function useNotes() {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error('useNotes must be used within NotesProvider');
  return ctx;
}
