import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import AiPanel from './AiPanel';
import { useAiPanel } from '../contexts/AiPanelContext';

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 520;
const SIDEBAR_DEFAULT = 280;
const STORAGE_KEY = 'sidebar-width';

const AIPANEL_MIN = 280;
const AIPANEL_MAX = 600;
const AIPANEL_DEFAULT = 360;
const AIPANEL_STORAGE_KEY = 'aipanel-width';

function loadWidth(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) {
      const n = parseInt(v, 10);
      if (n >= SIDEBAR_MIN && n <= SIDEBAR_MAX) return n;
    }
  } catch {}
  return SIDEBAR_DEFAULT;
}

function loadAiPanelWidth(): number {
  try {
    const v = localStorage.getItem(AIPANEL_STORAGE_KEY);
    if (v) {
      const n = parseInt(v, 10);
      if (n >= AIPANEL_MIN && n <= AIPANEL_MAX) return n;
    }
  } catch {}
  return AIPANEL_DEFAULT;
}

export default function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(loadWidth);
  const [resizing, setResizing] = useState(false);
  const [aiPanelWidth, setAiPanelWidth] = useState(loadAiPanelWidth);
  const [aiResizing, setAiResizing] = useState(false);
  const { open: aiOpen } = useAiPanel();
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const aiStartXRef = useRef(0);
  const aiStartWidthRef = useRef(0);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!sidebarOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSidebar();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [sidebarOpen, closeSidebar]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
    setResizing(true);

    let currentWidth = startWidthRef.current;

    const handleMouseMove = (ev: MouseEvent) => {
      currentWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startWidthRef.current + ev.clientX - startXRef.current));
      setSidebarWidth(currentWidth);
    };

    const handleMouseUp = () => {
      setResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      try { localStorage.setItem(STORAGE_KEY, String(currentWidth)); } catch {}
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [sidebarWidth]);

  const handleAiResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    aiStartXRef.current = e.clientX;
    aiStartWidthRef.current = aiPanelWidth;
    setAiResizing(true);

    let currentWidth = aiStartWidthRef.current;

    const handleMouseMove = (ev: MouseEvent) => {
      // Drag left → wider, drag right → narrower (opposite of sidebar)
      currentWidth = Math.max(AIPANEL_MIN, Math.min(AIPANEL_MAX, aiStartWidthRef.current - (ev.clientX - aiStartXRef.current)));
      setAiPanelWidth(currentWidth);
    };

    const handleMouseUp = () => {
      setAiResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      try { localStorage.setItem(AIPANEL_STORAGE_KEY, String(currentWidth)); } catch {}
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [aiPanelWidth]);

  return (
    <div
      className={`app-shell${aiOpen ? ' has-ai' : ''}${resizing ? ' is-resizing' : ''}${aiResizing ? ' is-ai-resizing' : ''}`}
      style={{ '--sidebar-w': `${sidebarWidth}px`, '--aipanel-w': `${aiPanelWidth}px` } as React.CSSProperties}
    >
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
      <Sidebar open={sidebarOpen} onClose={closeSidebar} onResizeStart={handleResizeStart} />
      <main className="main-content">
        <Outlet />
      </main>
      <AiPanel onResizeStart={handleAiResizeStart} />
    </div>
  );
}
