import React, { useState, useEffect, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!sidebarOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSidebar();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [sidebarOpen, closeSidebar]);

  return (
    <div className="app-shell">
      <button
        type="button"
        className="sidebar-hamburger"
        onClick={() => setSidebarOpen(true)}
        aria-label="打开侧边栏"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={closeSidebar} />}
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
