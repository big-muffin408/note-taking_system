import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NoteList from '../NoteList';
import { vi } from 'vitest';

const mockDeleteNote = vi.fn();
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: 'note-1' }),
  };
});

vi.mock('../../contexts/NotesContext', () => ({
  useNotes: () => ({
    notes: [
      { id: 'note-1', title: 'Test Note 1', updatedAt: '2024-01-01T00:00:00Z', syncStatus: 'synced' },
      { id: 'note-2', title: 'Test Note 2', updatedAt: '2024-01-02T00:00:00Z', syncStatus: 'pending' },
      { id: 'note-3', title: '', updatedAt: '2024-01-03T00:00:00Z', syncStatus: 'conflict' },
    ],
    loading: false,
    deleteNote: mockDeleteNote,
  }),
}));

function renderNoteList() {
  return render(
    <MemoryRouter>
      <NoteList />
    </MemoryRouter>
  );
}

describe('NoteList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders note titles', () => {
    renderNoteList();
    expect(screen.getByText('Test Note 1')).toBeInTheDocument();
    expect(screen.getByText('Test Note 2')).toBeInTheDocument();
  });

  it('shows default title for empty title', () => {
    renderNoteList();
    expect(screen.getByText('未命名笔记')).toBeInTheDocument();
  });

  it('shows sync badges', () => {
    renderNoteList();
    expect(screen.getByText('待同步')).toBeInTheDocument();
    expect(screen.getByText('冲突')).toBeInTheDocument();
  });

  it('renders delete buttons with correct aria labels', () => {
    renderNoteList();
    expect(screen.getByLabelText('删除 Test Note 1')).toBeInTheDocument();
    expect(screen.getByLabelText('删除 Test Note 2')).toBeInTheDocument();
  });

  it('shows confirmation dialog on delete click', () => {
    renderNoteList();
    fireEvent.click(screen.getByLabelText('删除 Test Note 1'));
    expect(screen.getByText(/确定删除/)).toBeInTheDocument();
  });

  it('calls deleteNote when confirmed', async () => {
    mockDeleteNote.mockResolvedValue(undefined);
    renderNoteList();
    fireEvent.click(screen.getByLabelText('删除 Test Note 1'));
    fireEvent.click(screen.getByText('删除'));
    expect(mockDeleteNote).toHaveBeenCalledWith('note-1');
  });

  it('navigates to root after deleting active note', async () => {
    mockDeleteNote.mockResolvedValue(undefined);
    renderNoteList();
    fireEvent.click(screen.getByLabelText('删除 Test Note 1'));
    fireEvent.click(screen.getByText('删除'));
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('dismisses confirmation on cancel', () => {
    renderNoteList();
    fireEvent.click(screen.getByLabelText('删除 Test Note 1'));
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByText(/确定删除/)).not.toBeInTheDocument();
  });
});
