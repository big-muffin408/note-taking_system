import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type ServiceStatus = {
  name: string;
  path: string;
  status: 'checking' | 'ok' | 'error';
  detail?: string;
};

const serviceChecks = [
  { name: '用户服务', path: '/api/user/health' },
  { name: '文档服务', path: '/api/doc/health' },
  { name: 'AI 服务', path: '/api/ai/health' },
  { name: '同步服务', path: '/api/sync/health' }
];

function App() {
  const [statuses, setStatuses] = useState<ServiceStatus[]>(
    serviceChecks.map((item) => ({ ...item, status: 'checking' }))
  );
  const [wsStatus, setWsStatus] = useState('checking');

  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';
  const wsBaseUrl = useMemo(() => {
    const configured = import.meta.env.VITE_WS_BASE_URL ?? '/ws';
    if (configured.startsWith('ws')) {
      return configured;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${configured}`;
  }, []);

  useEffect(() => {
    async function checkServices() {
      const results = await Promise.all(
        serviceChecks.map(async (item) => {
          try {
            const response = await fetch(`${apiBaseUrl}${item.path}`);
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            return {
              ...item,
              status: 'ok' as const,
              detail: data.service ?? 'ok'
            };
          } catch (error) {
            return {
              ...item,
              status: 'error' as const,
              detail: error instanceof Error ? error.message : 'unknown error'
            };
          }
        })
      );
      setStatuses(results);
    }

    checkServices();
  }, [apiBaseUrl]);

  useEffect(() => {
    const socket = new WebSocket(`${wsBaseUrl}/collab/demo-document`);

    socket.addEventListener('open', () => setWsStatus('ok'));
    socket.addEventListener('error', () => setWsStatus('error'));
    socket.addEventListener('close', () => {
      setWsStatus((current) => current === 'ok' ? 'closed' : current);
    });

    return () => socket.close();
  }, [wsBaseUrl]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">AI Notes</p>
          <h1>协作笔记系统</h1>
        </div>
        <button className="primary-action">新建笔记</button>
        <nav className="note-list" aria-label="笔记列表">
          <a className="active" href="#editor">项目说明</a>
          <a href="#pdf">PDF 导入草稿</a>
          <a href="#rag">RAG 问答记录</a>
        </nav>
      </aside>

      <section className="editor-panel" id="editor">
        <header className="toolbar">
          <div>
            <p className="eyebrow">Markdown Editor</p>
            <h2>项目骨架笔记</h2>
          </div>
          <span className={`ws-pill ${wsStatus}`}>协同：{wsStatus}</span>
        </header>
        <article className="editor-surface">
          <h3>开发阶段</h3>
          <p>当前已进入基础环境与微服务搭建阶段。这里预留 TipTap、Yjs、Markdown 快捷键、表格和公式扩展的集成位置。</p>
          <pre>{`# AI 协作笔记系统\n\n- Markdown 编辑器\n- PDF 转 Markdown\n- AI 摘要与 RAG 问答\n- 多人实时协同`}</pre>
        </article>
      </section>

      <aside className="right-panel">
        <section>
          <p className="eyebrow">Service Health</p>
          <h2>服务状态</h2>
          <div className="status-list">
            {statuses.map((item) => (
              <div className="status-row" key={item.path}>
                <span>{item.name}</span>
                <strong className={item.status}>{item.status}</strong>
              </div>
            ))}
            <div className="status-row">
              <span>协同 WebSocket</span>
              <strong className={wsStatus === 'ok' ? 'ok' : 'error'}>{wsStatus}</strong>
            </div>
          </div>
        </section>

        <section>
          <p className="eyebrow">AI Panel</p>
          <h2>AI 操作</h2>
          <div className="ai-actions">
            <button>生成摘要</button>
            <button>润色选区</button>
            <button>笔记问答</button>
          </div>
        </section>
      </aside>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
