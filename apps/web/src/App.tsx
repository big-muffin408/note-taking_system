import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NotesProvider } from './contexts/NotesContext';
import { AiPanelProvider } from './contexts/AiPanelContext';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import OAuthCallbackPage from './pages/OAuthCallbackPage';
import EditorPage from './pages/EditorPage';
import AdminPage from './pages/AdminPage';
import MainLayout from './components/MainLayout';
import SettingsDialog from './components/SettingsDialog';
import { isElectron, isBackendConfigured } from './lib/electronConfig';
import BrandMark from './components/BrandMark';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Uncaught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="auth-page">
          <div className="auth-form" style={{ textAlign: 'center' }}>
            <h2>出现了一些问题</h2>
            <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
              页面遇到了意外错误，请尝试刷新页面。
            </p>
            <button
              className="btn-primary"
              onClick={() => window.location.reload()}
              style={{ width: 'auto', padding: '0.6rem 2rem' }}
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function WelcomePage() {
  return (
    <div className="welcome-page">
      <div className="welcome-content">
        <BrandMark size={48} />
        <h2>欢迎使用 Quire·集册</h2>
        <p>在左侧选择一篇笔记开始编辑，或点击「新建笔记」创建一篇新的笔记。</p>
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-page">
        <div className="auth-loading">加载中…</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-page">
        <div className="auth-loading">加载中…</div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    window.electronAPI?.onOpenSettings(() => setShowSettings(true));
    // 首次启动未配置后端地址时，自动弹出设置
    if (isElectron() && !isBackendConfigured()) {
      setShowSettings(true);
    }
  }, []);

  return (
    <BrowserRouter>
      <ErrorBoundary>
      <AuthProvider>
        {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
        <Routes>
          <Route
            path="/auth/callback"
            element={<OAuthCallbackPage />}
          />
          <Route
            path="/login"
            element={
              <GuestOnly>
                <LoginPage />
              </GuestOnly>
            }
          />
          <Route
            path="/register"
            element={
              <GuestOnly>
                <RegisterPage />
              </GuestOnly>
            }
          />
          <Route
            element={
              <RequireAuth>
                <NotesProvider>
                  <AiPanelProvider>
                    <MainLayout />
                  </AiPanelProvider>
                </NotesProvider>
              </RequireAuth>
            }
          >
            <Route index element={<WelcomePage />} />
            <Route path="note/:id" element={<EditorPage />} />
            <Route path="admin" element={<AdminPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
