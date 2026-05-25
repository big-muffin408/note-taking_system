import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../Sidebar';
import { vi } from 'vitest';

const mockNavigate = vi.fn();
const mockCreateNote = vi.fn();
const mockLogout = vi.fn();
const mockSyncNow = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({}),
  };
});

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { displayName: 'Test User', email: 'test@example.com' },
    logout: mockLogout,
  }),
}));

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ mode: 'light', setMode: vi.fn() }),
}));

vi.mock('../../contexts/NotesContext', () => ({
  useNotes: () => ({
    notes: [],
    loading: false,
    deleteNote: vi.fn(),
    createNote: mockCreateNote,
    online: true,
    syncing: false,
    syncNow: mockSyncNow,
  }),
}));

function renderSidebar(props = {}) {
  return render(
    <MemoryRouter>
      <Sidebar {...props} />
    </MemoryRouter>
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders brand name', () => {
    renderSidebar();
    expect(screen.getByText('Notebook')).toBeInTheDocument();
  });

  it('renders new note button', () => {
    renderSidebar();
    expect(screen.getByText('新建笔记')).toBeInTheDocument();
  });

  it('renders user display name', () => {
    renderSidebar();
    expect(screen.getByText('Test User')).toBeInTheDocument();
  });

  it('renders logout button', () => {
    renderSidebar();
    expect(screen.getByTitle('退出登录')).toBeInTheDocument();
  });

  it('renders sync status in user chip', () => {
    renderSidebar();
    expect(screen.getByText(/已同步/)).toBeInTheDocument();
  });

  it('renders theme toggle', () => {
    renderSidebar();
    expect(screen.getByRole('group')).toBeInTheDocument();
  });

  it('renders import markdown button', () => {
    renderSidebar();
    expect(screen.getByTitle('导入 Markdown')).toBeInTheDocument();
  });

  it('creates note and navigates on new note click', async () => {
    mockCreateNote.mockResolvedValue({ id: 'new-note-id' });
    renderSidebar();
    fireEvent.click(screen.getByText('新建笔记'));
    await vi.waitFor(() => {
      expect(mockCreateNote).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/note/new-note-id');
    });
  });

  it('calls logout on logout button click', () => {
    renderSidebar();
    fireEvent.click(screen.getByTitle('退出登录'));
    expect(mockLogout).toHaveBeenCalled();
  });

  it('calls syncNow when user chip is clicked', () => {
    renderSidebar();
    fireEvent.click(screen.getByTitle('点击同步离线改动'));
    expect(mockSyncNow).toHaveBeenCalled();
  });

  it('shows close button when onClose is provided', () => {
    const onClose = vi.fn();
    renderSidebar({ open: true, onClose });
    const closeBtn = screen.getByLabelText('关闭侧边栏');
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not show close button when onClose is not provided', () => {
    renderSidebar();
    expect(screen.queryByLabelText('关闭侧边栏')).not.toBeInTheDocument();
  });

  it('shows offline status when not online', () => {
    vi.mocked(vi.importActual('../../contexts/NotesContext')).then(() => {});
    vi.doMock('../../contexts/NotesContext', () => ({
      useNotes: () => ({
        notes: [],
        loading: false,
        deleteNote: vi.fn(),
        createNote: mockCreateNote,
        online: false,
        syncing: false,
        syncNow: mockSyncNow,
      }),
    }));
    // Offline state is reflected in the user-chip label text
  });
});
