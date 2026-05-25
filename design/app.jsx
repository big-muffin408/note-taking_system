// ============================================================
// AI 协作笔记系统 — Polished prototype
// ============================================================

const { useState, useEffect, useRef, useCallback } = React;

// ---------- Icons (Lucide-style, minimal) ----------
const Icon = {
  Plus: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M8 3v10M3 8h10"/></svg>,
  Search: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>,
  Upload: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8 11V3M5 6l3-3 3 3M3 13h10"/></svg>,
  File: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 2h6l4 4v8H3z"/><path d="M9 2v4h4"/></svg>,
  Filter: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 4h12M4 8h8M6 12h4"/></svg>,
  Star: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M8 2l1.8 3.7 4 .6-3 2.9.8 4-3.6-1.9-3.6 1.9.8-4-3-2.9 4-.6z"/></svg>,
  Share: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="3.5" r="2"/><circle cx="4" cy="8" r="2"/><circle cx="12" cy="12.5" r="2"/><path d="M5.8 7l4.5-2.5M5.8 9l4.5 2.5"/></svg>,
  Clock: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2 1.5" strokeLinecap="round"/></svg>,
  Sparkles: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M9 2l1 2.5L12.5 5.5 10 6.5 9 9 8 6.5 5.5 5.5 8 4.5z" fill="currentColor"/><path d="M3.5 9.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="currentColor"/></svg>,
  X: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>,
  ChevronRight: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4l4 4-4 4"/></svg>,
  ChevronDown: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4"/></svg>,
  Send: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2L7.5 8.5M14 2l-5 12-2-5.5-5-2z"/></svg>,
  Bold: () => <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 3h4.5a2.5 2.5 0 010 5H4V3zm0 5h5a2.5 2.5 0 010 5H4V8zm1.5-3.5v2.5h2.5a1.25 1.25 0 000-2.5h-2.5zm0 5v2.5h3a1.25 1.25 0 000-2.5h-3z"/></svg>,
  Italic: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 3h6M3 13h6M10 3l-4 10"/></svg>,
  Underline: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 3v5a4 4 0 008 0V3M3 14h10"/></svg>,
  List: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="3" cy="4" r=".8" fill="currentColor"/><circle cx="3" cy="8" r=".8" fill="currentColor"/><circle cx="3" cy="12" r=".8" fill="currentColor"/><path d="M6 4h8M6 8h8M6 12h8"/></svg>,
  OL: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><text x="1" y="6" fontSize="4.5" fill="currentColor" stroke="none" fontFamily="monospace">1</text><text x="1" y="11" fontSize="4.5" fill="currentColor" stroke="none" fontFamily="monospace">2</text><text x="1" y="16" fontSize="4.5" fill="currentColor" stroke="none" fontFamily="monospace">3</text><path d="M6 4h8M6 9h8M6 14h8"/></svg>,
  Quote: () => <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 5c0-1 1-2 2-2v1.5c-.5 0-1 .5-1 1h1V8H3V5zm5 0c0-1 1-2 2-2v1.5c-.5 0-1 .5-1 1h1V8H8V5z"/><path d="M3 9h2v2H3zM8 9h2v2H8z" fill="currentColor"/></svg>,
  Code: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4L2 8l3 4M11 4l3 4-3 4M9 3l-2 10"/></svg>,
  Link: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M7 9a3 3 0 004.5 0l2-2a3 3 0 00-4.5-4.5L8 3.5M9 7a3 3 0 00-4.5 0l-2 2a3 3 0 004.5 4.5L8 12.5"/></svg>,
  More: () => <svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12.5" cy="8" r="1.2"/></svg>,
  Trash: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h10M6 4V2.5h4V4M5 4l.5 9h5L11 4M7 7v4M9 7v4"/></svg>,
  Sun: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.5 3.5l1 1M11.5 11.5l1 1M3.5 12.5l1-1M11.5 4.5l1-1"/></svg>,
  Moon: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M13 9.5A6 6 0 016.5 3a6 6 0 109 6.5 5 5 0 01-2.5 0z"/></svg>,
  Copy: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M2 11V3a1 1 0 011-1h8"/></svg>,
  Check: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3 3 7-7"/></svg>,
  Refresh: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4v3h3M14 12v-3h-3"/><path d="M3 8a5 5 0 019-2.5L14 7M13 8a5 5 0 01-9 2.5L2 9"/></svg>,
  Wand: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 13l8-8M9 3l1 1M12 6l1 1M2 8l1 1M5 11l1 1"/></svg>,
  Doc: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 2h7l3 3v9H3z"/><path d="M10 2v3h3M5.5 9h5M5.5 11.5h5M5.5 6.5h2.5" strokeLinecap="round"/></svg>,
  Tag: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M2 8.5V2.5h6L14 8.5l-5.5 5.5z"/><circle cx="5" cy="5.5" r=".8" fill="currentColor"/></svg>,
};

// ---------- Brand mark (Quire · 集册) ----------
// Refined Ink-slab logo: italic Q in a dark slab with a folded page corner.
function BrandMark({ size = 28, radius }) {
  const r = radius != null ? radius : Math.round(size * 0.22);
  const fold = size * 0.22;
  const id = `qclip-${size}`;
  return (
    <svg viewBox="0 0 132 132" width={size} height={size} aria-label="Quire" style={{display:'block'}}>
      <defs>
        <clipPath id={id}><rect width="132" height="132" rx={r * 132 / size}/></clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>
        <rect width="132" height="132" rx={r * 132 / size} fill="var(--ink)"/>
        <text x="66" y="100" textAnchor="middle"
              fontFamily="Newsreader, Georgia, 'Times New Roman', serif"
              fontStyle="italic" fontWeight="400"
              fontSize="112" fill="var(--paper)"
              style={{letterSpacing:'-0.04em'}}>Q</text>
        {size >= 22 && (<>
          <path d="M132 102 L132 132 L102 132 Z" fill="var(--paper-2)"/>
          <path d="M102 132 L132 102" stroke="var(--ink)" strokeWidth="1.2" opacity="0.45"/>
        </>)}
      </g>
    </svg>
  );
}

// ============================================================
// SAMPLE DATA
// ============================================================

const SAMPLE_NOTES = [
  { id: '1', title: '产品周会要点 · W34', snippet: '本周聚焦：协同光标性能、PDF 解析失败率、离线冲突...', when: '14:32', tag: '会议', shared: true, status: null, active: true },
  { id: '2', title: 'MinerU 部署调研', snippet: '比较 CPU/GPU 两种模式下的解析速度、显存占用和精度差异。', when: '昨天', tag: '研究', status: 'pending' },
  { id: '3', title: '《写作的零阶段》读书笔记', snippet: '草稿不是写出来的，是改出来的。零阶段写作要刻意降低标准...', when: '昨天', tag: '阅读' },
  { id: '4', title: '协同编辑冲突处理设计', snippet: 'CRDT vs OT — 为什么选择 Yjs，以及在我们场景下的取舍。', when: '周一', tag: '架构', shared: true },
  { id: '5', title: 'AI 提示词笔记', snippet: '摘要 / 润色 / 问答场景下的 system prompt 调试记录。', when: '周一', tag: '研究', status: 'offline' },
  { id: '6', title: '可访问性 checklist', snippet: '键盘可达、对比度、aria-label、focus ring、屏幕阅读器测试。', when: '上周', tag: '设计' },
];

const SAMPLE_NOTE_CONTENT = `
  <h2>本周决议</h2>
  <p>本期目标围绕<span class="ai-highlight">协同性能与离线可靠性</span>展开。在解决了上周遗留的版本恢复死锁后，团队将精力集中到 PDF 异步任务和冲突体验两条主线上。</p>

  <div class="callout">
    <span class="callout-icon">i</span>
    <span><strong>关键指标</strong>：协同延迟 P95 控制在 80ms 内；PDF 解析失败率 &lt; 3%；离线编辑同步成功率 &gt; 99%。</span>
  </div>

  <h3>架构调整</h3>
  <p>将 <code>document-service</code> 中的 PDF 同步上传路径标记为兼容路径，新接入的客户端默认走 <code>POST /pdf/jobs</code> 异步队列。原因有三：</p>
  <ul>
    <li>大文档解析耗时跨越 HTTP 请求超时阈值；</li>
    <li>MinerU 在排队时容易出现瞬时拥堵，异步可用更优雅的重试策略；</li>
    <li>前端能用 jobId 轮询出更细的状态机：<code>queued → parsing → parsed</code>。</li>
  </ul>

  <h3>协同冲突的边界</h3>
  <blockquote>"CRDT 解决了同时写不冲突，并不代表语义上不冲突。" — 协同会议讨论</blockquote>
  <p>当前 <code>baseUpdatedAt</code> 机制处理的是离线 push 的冲突；协同正文走 Yjs，理论上不需要乐观锁。但当用户在离线期间手动改动后又恢复协同会话时，仍需将本地 update 合入服务器 doc，这一步要让用户能看见差异并选择保留方向。</p>

  <h3>下周事项</h3>
  <ol>
    <li>设计版本树视图（替代当前线性列表）</li>
    <li>分享邀请增加通知中心入口</li>
    <li>把 AI 摘要的 token 用量上报到管理后台</li>
  </ol>
`;

// ============================================================
// LEFT — SIDEBAR
// ============================================================

function Sidebar({ filter, setFilter }) {
  return (
    <aside className="sidebar" data-screen-label="sidebar">
      <div className="sidebar-top">
        <div className="brand">
          <div className="brand-mark"><BrandMark size={28}/></div>
          <div className="brand-name">Quire <em>· 集册</em></div>
        </div>
        <div className="sidebar-actions">
          <button className="btn-new"><Icon.Plus /> 新建笔记</button>
          <button className="btn-icon" title="导入 Markdown / PDF"><Icon.Upload /></button>
        </div>
        <div className="search">
          <Icon.Search />
          <input placeholder="搜索笔记 · 内容 · 标签" />
          <span className="search-kbd">⌘K</span>
        </div>
      </div>

      <div className="sidebar-nav">
        <button className={`nav-item${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
          <Icon.Doc /> 全部笔记 <span className="nav-item-count">128</span>
        </button>
        <button className={`nav-item${filter === 'starred' ? ' active' : ''}`} onClick={() => setFilter('starred')}>
          <Icon.Star /> 收藏 <span className="nav-item-count">12</span>
        </button>
        <button className={`nav-item${filter === 'shared' ? ' active' : ''}`} onClick={() => setFilter('shared')}>
          <Icon.Share /> 共享给我 <span className="nav-item-count">7</span>
        </button>
        <button className={`nav-item${filter === 'recent' ? ' active' : ''}`} onClick={() => setFilter('recent')}>
          <Icon.Clock /> 最近编辑
        </button>
      </div>

      <div className="section-label">标签</div>
      <div className="sidebar-nav" style={{paddingTop:0}}>
        {[
          { name: '会议', count: 14, color: 'oklch(0.62 0.10 250)' },
          { name: '研究', count: 22, color: 'oklch(0.62 0.10 150)' },
          { name: '阅读', count: 31, color: 'oklch(0.65 0.10 80)' },
          { name: '架构', count: 9, color: 'oklch(0.62 0.10 25)' },
        ].map(t => (
          <button key={t.name} className="nav-item">
            <span style={{width:8,height:8,borderRadius:2,background:t.color,display:'inline-block'}}/>
            {t.name} <span className="nav-item-count">{t.count}</span>
          </button>
        ))}
      </div>

      <div className="section-label" style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span>最近笔记</span>
        <button className="icon-btn-sm" title="筛选"><Icon.Filter /></button>
      </div>
      <div className="sidebar-notes">
        {SAMPLE_NOTES.map(n => (
          <div key={n.id} className={`note-item${n.active ? ' active' : ''}`}>
            <div className="note-item-title">
              {n.shared && <span className="shared-mark"><Icon.Share /></span>}
              {n.title}
            </div>
            <div className="note-item-snippet">{n.snippet}</div>
            <div className="note-item-meta">
              <span>{n.when}</span>
              <span className="dot"/>
              <span>{n.tag}</span>
              {n.status && <span className={`sync-badge ${n.status}`}>{n.status === 'pending' ? '待同步' : n.status === 'conflict' ? '冲突' : '离线'}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="sidebar-bottom">
        <button className="user-chip">
          <div className="user-avatar">Z</div>
          <div className="user-info">
            <div className="user-name">朱明远</div>
            <div className="user-status"><span className="ok-dot"/> 已同步 · 在线</div>
          </div>
        </button>
        <button className="btn-icon" title="设置" style={{width:30,height:30}}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" strokeLinecap="round"/></svg>
        </button>
      </div>
    </aside>
  );
}

// ============================================================
// CENTER — EDITOR
// ============================================================

function Editor({ aiOpen, setAiOpen, onShare, onVersions, onUpload }) {
  const [saved, setSaved] = useState('已保存');
  useEffect(() => {
    const t = setInterval(() => {
      setSaved('正在保存…');
      setTimeout(() => setSaved('已保存于 14:32'), 800);
    }, 14000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="main" data-screen-label="editor">
      <div className="topbar">
        <div className="crumbs">
          <span>团队 / 工作日志</span>
          <span className="sep">/</span>
          <span className="here">W34 周会要点</span>
        </div>
        <div className="topbar-spacer" />

        <div className="save-state"><span className="pulse"/> {saved}</div>

        <div className="presence" title="协作者">
          <div className="presence-avatar" style={{background:'oklch(0.55 0.13 250)'}}>L</div>
          <div className="presence-avatar" style={{background:'oklch(0.55 0.13 150)'}}>X</div>
          <div className="presence-avatar" style={{background:'oklch(0.6 0.13 25)'}}>Y</div>
        </div>

        <button className="btn-ghost" onClick={onVersions}><Icon.Clock /> 历史</button>
        <button className="btn-ghost" onClick={onUpload}><Icon.Upload /> PDF</button>
        <button className="btn-ghost" onClick={onShare}><Icon.Share /> 分享</button>
        <button className={`btn-ghost${aiOpen ? ' active' : ''}`} onClick={() => setAiOpen(!aiOpen)} style={aiOpen ? {background:'var(--ink)', color:'var(--paper)'} : {}}>
          <Icon.Sparkles /> AI
        </button>
        <button className="btn-icon" style={{width:30,height:30,border:0}}><Icon.More /></button>
      </div>

      <div className="format-bar">
        <button className="fmt-btn fmt-heading">H1</button>
        <button className="fmt-btn fmt-heading">H2</button>
        <button className="fmt-btn fmt-heading">H3</button>
        <div className="fmt-divider"/>
        <button className="fmt-btn active"><Icon.Bold /></button>
        <button className="fmt-btn"><Icon.Italic /></button>
        <button className="fmt-btn"><Icon.Underline /></button>
        <div className="fmt-divider"/>
        <button className="fmt-btn"><Icon.List /></button>
        <button className="fmt-btn"><Icon.OL /></button>
        <button className="fmt-btn"><Icon.Quote /></button>
        <button className="fmt-btn"><Icon.Code /></button>
        <button className="fmt-btn"><Icon.Link /></button>
        <div className="fmt-divider"/>
        <button className="btn-ghost" style={{height:26,padding:'0 8px',fontSize:11}}>
          <Icon.Sparkles /> 润色选中
        </button>
      </div>

      <div className="editor-scroll">
        <div className="editor-canvas">
          <h1 className="editor-title" contentEditable suppressContentEditableWarning>产品周会要点 · W34</h1>
          <div className="editor-meta">
            <span>更新于 周四 14:32</span>
            <span>·</span>
            <span>1,247 字</span>
            <span>·</span>
            <span>朱明远 + 2 位协作者</span>
            <span className="tag">会议</span>
            <span className="tag">W34</span>
          </div>
          <div className="editor-body" dangerouslySetInnerHTML={{__html: SAMPLE_NOTE_CONTENT}} />
        </div>
      </div>
    </section>
  );
}

// ============================================================
// RIGHT — AI PANEL
// ============================================================

function AIPanel({ onClose }) {
  const [tab, setTab] = useState('chat');
  const [messages, setMessages] = useState([
    { who: 'user', text: '帮我用三句话总结这篇笔记的核心结论。' },
    { who: 'ai', text: '本周聚焦三件事：将 PDF 上传切到异步任务路径以应对超时；明确 Yjs 协同与 baseUpdatedAt 离线冲突的边界并补充用户可见的合并选择；以及把 AI 调用的成本数据接入管理后台。整体方向是把"看不见的可靠性"做成"看得见的状态"。', cite: ['§1', '§2'] },
  ]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);

  function send() {
    if (!input.trim() || streaming) return;
    const userMsg = { who: 'user', text: input };
    setMessages(m => [...m, userMsg]);
    setInput('');
    setStreaming(true);

    const reply = '让我看看这篇笔记里关于冲突处理的具体设计。文中提到当前 baseUpdatedAt 机制处理的是离线 push 路径，协同正文走 Yjs。两者的边界在于——';
    let i = 0;
    setMessages(m => [...m, { who: 'ai', text: '', streaming: true }]);
    const t = setInterval(() => {
      i += 2 + Math.floor(Math.random() * 3);
      if (i >= reply.length) {
        i = reply.length;
        clearInterval(t);
        setMessages(m => {
          const copy = [...m];
          copy[copy.length - 1] = { who: 'ai', text: reply, cite: ['§3'] };
          return copy;
        });
        setStreaming(false);
        return;
      }
      setMessages(m => {
        const copy = [...m];
        copy[copy.length - 1] = { who: 'ai', text: reply.slice(0, i), streaming: true };
        return copy;
      });
    }, 60);
  }

  return (
    <aside className="ai-panel" data-screen-label="ai-panel">
      <div className="ai-header">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div className="ai-title">
            <Icon.Sparkles />
            AI 助手
          </div>
          <button className="modal-close" onClick={onClose}><Icon.X /></button>
        </div>
        <div className="ai-tabs">
          <button className={`ai-tab${tab==='chat' ? ' active' : ''}`} onClick={() => setTab('chat')}>问答</button>
          <button className={`ai-tab${tab==='summary' ? ' active' : ''}`} onClick={() => setTab('summary')}>摘要</button>
          <button className={`ai-tab${tab==='polish' ? ' active' : ''}`} onClick={() => setTab('polish')}>润色</button>
        </div>
      </div>

      <div className="ai-body">
        {tab === 'chat' && <>
          <div className="ai-card" style={{background:'transparent',border:'1px dashed var(--line)'}}>
            <div className="ai-card-head">
              <span className="ai-card-title">基于本笔记 · RAG</span>
              <span style={{fontFamily:'var(--mono)',fontSize:10,color:'var(--ink-4)'}}>4 个分块已索引</span>
            </div>
            <div style={{fontSize:12,color:'var(--ink-3)',lineHeight:1.5}}>
              提问会自动检索当前笔记 + 你授权的相关笔记。回答中的 <span className="cite">§N</span> 是引用段落。
            </div>
          </div>
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.who}`}>
              <div className="who">{m.who === 'user' ? '你' : 'Quire AI'}</div>
              <div className={`bubble${m.streaming ? ' cursor-blink' : ''}`}>
                {m.text}
                {m.cite && !m.streaming && m.cite.map(c => <span key={c} className="cite">{c}</span>)}
              </div>
            </div>
          ))}
        </>}

        {tab === 'summary' && <>
          <div className="ai-card">
            <div className="ai-card-head">
              <span className="ai-card-title">本笔记摘要</span>
              <div className="ai-card-actions">
                <button className="ai-mini-btn" title="复制"><Icon.Copy /></button>
                <button className="ai-mini-btn" title="重新生成"><Icon.Refresh /></button>
              </div>
            </div>
            本周以"可靠性"为主线，落地三项动作：把 PDF 解析切到异步任务以脱离 HTTP 超时；明确 Yjs 协同与 baseUpdatedAt 离线冲突的分工，并让用户对合并方向有选择权；将 AI 摘要的 token 成本上报到管理后台。
          </div>
          <div className="ai-card">
            <div className="ai-card-head">
              <span className="ai-card-title">关键决议</span>
              <div className="ai-card-actions"><button className="ai-mini-btn"><Icon.Copy /></button></div>
            </div>
            <ul style={{margin:0,paddingLeft:18}}>
              <li>POST /pdf/jobs 作为默认路径，sync 上传转为兼容路径</li>
              <li>版本树视图替代线性历史</li>
              <li>分享邀请接入通知中心</li>
            </ul>
          </div>
          <div className="ai-card">
            <div className="ai-card-head">
              <span className="ai-card-title">建议追问</span>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              <button className="chip" style={{justifyContent:'flex-start',width:'100%'}}>异步任务的失败重试策略是什么？</button>
              <button className="chip" style={{justifyContent:'flex-start',width:'100%'}}>版本树视图的草图在哪里？</button>
              <button className="chip" style={{justifyContent:'flex-start',width:'100%'}}>token 成本上报字段建议</button>
            </div>
          </div>
        </>}

        {tab === 'polish' && <>
          <div className="ai-card" style={{background:'var(--accent-soft)', borderColor:'var(--accent)'}}>
            <div className="ai-card-title" style={{color:'var(--accent-ink)',marginBottom:6}}>选中文本</div>
            <div style={{fontSize:13,color:'var(--ink-2)',fontFamily:'var(--serif)',fontStyle:'italic',lineHeight:1.5}}>
              "CRDT 解决了同时写不冲突，并不代表语义上不冲突。"
            </div>
          </div>
          <div className="suggest-row">
            <button className="chip active"><Icon.Wand /> 更精炼</button>
            <button className="chip">更口语化</button>
            <button className="chip">更正式</button>
            <button className="chip">翻译为 EN</button>
          </div>
          <div className="ai-card">
            <div className="ai-card-head">
              <span className="ai-card-title">建议改写</span>
              <div className="ai-card-actions">
                <button className="ai-mini-btn"><Icon.Refresh /></button>
                <button className="ai-mini-btn"><Icon.Copy /></button>
              </div>
            </div>
            <p style={{margin:'0 0 8px',color:'var(--ink-2)',lineHeight:1.55,fontSize:13}}>
              "CRDT 处理的是并发写入不冲突，<span className="ai-highlight">语义层面的冲突仍需人来裁决</span>。"
            </p>
            <div style={{display:'flex',gap:6,marginTop:10}}>
              <button className="btn-primary" style={{height:28,fontSize:11,padding:'0 10px'}}><Icon.Check /> 应用</button>
              <button className="btn-secondary" style={{height:28,fontSize:11,padding:'0 10px'}}>丢弃</button>
            </div>
          </div>
        </>}
      </div>

      <div className="ai-input-wrap">
        <div className="ai-input">
          <textarea
            placeholder="问点什么…  或 / 调用动作"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
          />
          <div className="ai-input-row">
            <div className="left">
              <button className="chip active">@当前笔记</button>
              <button className="chip">+ 上下文</button>
            </div>
            <button className="send-btn" onClick={send} disabled={streaming}>
              <Icon.Send />
            </button>
          </div>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',marginTop:6,fontSize:10,color:'var(--ink-4)',fontFamily:'var(--mono)'}}>
          <span>deepseek-chat · provider: mock</span>
          <span>↩ 发送 · ⇧↩ 换行</span>
        </div>
      </div>
    </aside>
  );
}

// ============================================================
// MODALS
// ============================================================

function ShareModal({ onClose }) {
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>分享这篇笔记</h2>
            <div className="sub">邀请同事协作，或开启链接共享</div>
          </div>
          <button className="modal-close" onClick={onClose}><Icon.X /></button>
        </div>
        <div className="modal-body">
          <div className="share-input-row">
            <input className="input" placeholder="邮箱地址，多个用逗号分隔" defaultValue="lin@team.com"/>
            <select className="select"><option>可编辑</option><option>只读</option></select>
            <button className="btn-primary"><Icon.Send/> 邀请</button>
          </div>

          <div className="share-list-label">已分享 · 3 人</div>
          {[
            { name: '林小雨', email: 'lin@team.com', avatar:'L', color:'oklch(0.55 0.13 250)', perm: '可编辑' },
            { name: '徐子明', email: 'xu@team.com', avatar:'X', color:'oklch(0.55 0.13 150)', perm: '只读' },
            { name: '杨之衡', email: 'yang@team.com', avatar:'Y', color:'oklch(0.6 0.13 25)', perm: '可编辑' },
          ].map(p => (
            <div key={p.email} className="share-row">
              <div className="presence-avatar" style={{background:p.color,margin:0,width:30,height:30,fontSize:11,border:0}}>{p.avatar}</div>
              <div className="who">
                <div className="who-name">{p.name}</div>
                <div className="who-email">{p.email}</div>
              </div>
              <div className="share-perm">{p.perm}</div>
              <button className="icon-btn-sm"><Icon.More /></button>
            </div>
          ))}

          <div className="public-link">
            <div style={{display:'grid',placeItems:'center',width:28,height:28,borderRadius:6,background:'var(--paper)',border:'1px solid var(--line)'}}>
              <Icon.Link/>
            </div>
            <div className="url">quire.app/n/3f8c2a9b · 仅受邀可访问</div>
            <button className="btn-secondary" style={{height:30,padding:'0 10px',fontSize:12}}><Icon.Copy/> 复制</button>
          </div>
        </div>
        <div className="modal-foot">
          <span style={{fontSize:11,color:'var(--ink-4)',fontFamily:'var(--mono)'}}>权限变更立即生效</span>
          <button className="btn-secondary" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}

function VersionModal({ onClose }) {
  const [active, setActive] = useState(2);
  const versions = [
    { time: '14:32 今天',  label: '当前版本',          author: '朱明远', auto: false, snap: false },
    { time: '11:08 今天',  label: '林小雨 编辑',        author: '林小雨', auto: true },
    { time: '昨天 19:45',  label: '完成下周事项',       author: '朱明远', auto: false, snap: true },
    { time: '昨天 17:20',  label: 'AI 润色 · 应用',     author: '系统',   auto: true },
    { time: '昨天 14:02',  label: '初稿',               author: '朱明远', auto: false, snap: true },
    { time: '两天前 09:30', label: '从模板创建',         author: '朱明远', auto: true },
  ];

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>版本历史</h2>
            <div className="sub">协同自动快照 + 手动快照 · 保留 30 天</div>
          </div>
          <button className="modal-close" onClick={onClose}><Icon.X /></button>
        </div>
        <div className="version-grid">
          <div className="version-list">
            {versions.map((v, i) => (
              <div key={i} className={`version-item${active === i ? ' active' : ''}`} onClick={() => setActive(i)}>
                <div className="v-time">{v.time}</div>
                <div className="v-label">{v.label} {v.snap && <span className="v-auto">📌 手动</span>} {v.auto && <span className="v-auto">自动</span>}</div>
                <div className="v-author">{v.author}</div>
              </div>
            ))}
          </div>
          <div className="version-preview">
            <h2 style={{fontFamily:'var(--serif)',fontSize:22,margin:'0 0 16px',color:'var(--ink)',fontWeight:500}}>产品周会要点 · W34</h2>
            <p>本期目标围绕<span className="diff-removed">协同体验</span><span className="diff-added">协同性能与离线可靠性</span>展开。</p>
            <p>在解决了上周遗留的版本恢复死锁后，团队将精力集中到 PDF 异步任务和冲突体验<span className="diff-added">两条主线</span>上。</p>
            <h3 style={{fontFamily:'var(--serif)',fontSize:17,marginTop:24,color:'var(--ink)',fontWeight:500}}>架构调整</h3>
            <p>将 document-service 中的 PDF 同步上传路径标记为<span className="diff-added">兼容路径</span>，新接入的客户端默认走 POST /pdf/jobs 异步队列。<span className="diff-removed">原因详见下方。</span></p>
            <p style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--ink-4)',marginTop:24,padding:'10px 12px',background:'var(--paper-2)',borderRadius:8}}>
              +12 行 · −4 行 · 由 林小雨 创建于 11:08
            </p>
          </div>
        </div>
        <div className="modal-foot">
          <span style={{fontSize:11,color:'var(--ink-4)',fontFamily:'var(--mono)'}}>对照当前版本</span>
          <div style={{display:'flex',gap:8}}>
            <button className="btn-secondary" onClick={onClose}>取消</button>
            <button className="btn-primary"><Icon.Refresh/> 恢复此版本</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function UploadModal({ onClose }) {
  const [stage, setStage] = useState('drop'); // drop | uploading | parsing | done
  const [progress, setProgress] = useState(0);
  const [over, setOver] = useState(false);

  function startMock() {
    setStage('uploading');
    setProgress(0);
    let p = 0;
    const t = setInterval(() => {
      p += 8 + Math.random() * 12;
      if (p >= 100) {
        p = 100;
        clearInterval(t);
        setStage('parsing');
        setTimeout(() => {
          setStage('done');
        }, 1800);
      }
      setProgress(Math.min(100, p));
    }, 220);
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>上传 PDF 转为笔记</h2>
            <div className="sub">MinerU 解析 · 自动索引到向量库 · 支持公式与表格</div>
          </div>
          <button className="modal-close" onClick={onClose}><Icon.X /></button>
        </div>
        <div className="modal-body">
          {stage === 'drop' && (
            <div
              className={`pdf-drop${over ? ' over' : ''}`}
              onDragOver={e => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={e => { e.preventDefault(); setOver(false); startMock(); }}
              onClick={startMock}
            >
              <div className="icon"><Icon.Upload /></div>
              <h3>拖拽 PDF 到这里，或点击选择</h3>
              <p>单文件最大 50 MB · 支持中英文 · 解析约 30–90 秒</p>
            </div>
          )}
          {(stage === 'uploading' || stage === 'parsing' || stage === 'done') && (
            <div className="pdf-job">
              <div className="pdf-job-icon">PDF</div>
              <div className="pdf-job-main">
                <div className="pdf-job-name">DistributedSystems_LectureNotes.pdf</div>
                <div className="pdf-job-meta">
                  {stage === 'uploading' && <>上传中 · {Math.floor(progress)}%</>}
                  {stage === 'parsing' && <>解析中 · MinerU · pipeline 后端</>}
                  {stage === 'done' && <>已完成 · 索引 24 个分块 · 已创建笔记</>}
                </div>
                <div className="pdf-progress">
                  <div className="bar" style={{
                    width: stage === 'uploading' ? `${progress}%` : stage === 'parsing' ? '100%' : '100%',
                    background: stage === 'done' ? 'var(--ok)' : 'var(--accent)'
                  }}/>
                </div>
              </div>
              {stage === 'done' && (
                <button className="btn-primary" style={{padding:'0 10px',height:30,fontSize:12}}><Icon.ChevronRight /> 打开</button>
              )}
            </div>
          )}

          <div style={{marginTop:18,display:'flex',gap:8,flexWrap:'wrap'}}>
            <button className="chip"><Icon.Tag/> 自动标签</button>
            <button className="chip">中文 · ch</button>
            <button className="chip">提取公式</button>
            <button className="chip">保留版面</button>
          </div>
        </div>
        <div className="modal-foot">
          <span style={{fontSize:11,color:'var(--ink-4)',fontFamily:'var(--mono)'}}>
            {stage === 'done' ? '✓ 完成 · 可关闭窗口' : 'PDF 在 MinIO 中保留 30 天'}
          </span>
          <button className="btn-secondary" onClick={onClose}>{stage === 'done' ? '关闭' : '取消'}</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// LOGIN SCREEN
// ============================================================

function LoginScreen({ onLogin }) {
  return (
    <div className="auth-page" data-screen-label="login">
      <div className="auth-art">
        <div className="brand" style={{padding:0}}>
          <div className="brand-mark"><BrandMark size={28}/></div>
          <div className="brand-name">Quire <em>· 集册</em></div>
        </div>
        <div>
          <div className="quote">
            写作是思考的副产物。<br/>
            笔记是知识的<em>复利</em>。
          </div>
        </div>
        <div className="attrib">协作 · AI 增强 · 离线优先</div>
      </div>
      <div className="auth-form-wrap">
        <form className="auth-form" onSubmit={e => { e.preventDefault(); onLogin(); }}>
          <h1>登录</h1>
          <p className="sub">欢迎回来。继续你的笔记。</p>
          <div className="field">
            <label>邮箱</label>
            <input className="input" type="email" defaultValue="zhu@muffin.app" placeholder="your@email.com" />
          </div>
          <div className="field">
            <label>密码</label>
            <input className="input" type="password" defaultValue="passwordpassword" placeholder="••••••••" />
          </div>
          <button className="btn-primary-lg" type="submit">登录</button>
          <div className="divider-or"><span>或</span></div>
          <button className="btn-google" type="button">
            <svg width="16" height="16" viewBox="0 0 18 18"><path d="M17.64 9.2a8 8 0 00-.13-1.5H9v2.84h4.84a4.14 4.14 0 01-1.8 2.71v2.26h2.92a8.8 8.8 0 002.68-6.31z" fill="#4285F4"/><path d="M9 18a8.6 8.6 0 005.96-2.18l-2.92-2.26a5.4 5.4 0 01-8.04-2.83H.96v2.33A9 9 0 009 18z" fill="#34A853"/><path d="M3.96 10.71a5.4 5.4 0 010-3.44V4.95H.96a9 9 0 000 8.11l3-2.35z" fill="#FBBC05"/><path d="M9 3.58a4.86 4.86 0 013.44 1.35l2.58-2.59A8.6 8.6 0 009 0 9 9 0 00.96 4.95l3 2.34A5.4 5.4 0 019 3.58z" fill="#EA4335"/></svg>
            使用 Google 登录
          </button>
          <p className="auth-foot">还没有账号？<a href="#">立即注册</a></p>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// APP
// ============================================================

const ACCENT_MAP = {
  '#3b5b8f': { a: 'oklch(0.42 0.08 250)', s: 'oklch(0.94 0.03 250)', i: 'oklch(0.30 0.06 250)' },
  '#3d6850': { a: 'oklch(0.42 0.08 150)', s: 'oklch(0.94 0.03 150)', i: 'oklch(0.30 0.06 150)' },
  '#a85a32': { a: 'oklch(0.50 0.12 35)',  s: 'oklch(0.94 0.04 35)',  i: 'oklch(0.36 0.10 35)' },
  '#704a78': { a: 'oklch(0.42 0.10 320)', s: 'oklch(0.94 0.03 320)', i: 'oklch(0.30 0.07 320)' },
};

function App() {
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "theme": "light",
    "accent": "#3b5b8f",
    "screen": "editor",
    "aiOpen": true,
    "density": "comfortable"
  }/*EDITMODE-END*/;

  const [tw, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const [aiOpen, setAiOpen] = useState(tw.aiOpen);
  useEffect(() => { setAiOpen(tw.aiOpen); }, [tw.aiOpen]);

  const [showShare, setShowShare] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tw.theme);
    const c = ACCENT_MAP[tw.accent] || ACCENT_MAP['#3b5b8f'];
    document.documentElement.style.setProperty('--accent', c.a);
    document.documentElement.style.setProperty('--accent-soft', c.s);
    document.documentElement.style.setProperty('--accent-ink', c.i);
    document.documentElement.style.setProperty('--sidebar-w', tw.density === 'compact' ? '256px' : '288px');
  }, [tw.theme, tw.accent, tw.density]);

  if (tw.screen === 'login') {
    return <>
      <LoginScreen onLogin={() => setTweak('screen', 'editor')} />
      <TweaksUI tw={tw} setTweak={setTweak} />
    </>;
  }

  return (
    <>
      <div className={`app-shell${aiOpen ? ' has-ai' : ''}`}>
        <Sidebar filter={filter} setFilter={setFilter} />
        <Editor
          aiOpen={aiOpen}
          setAiOpen={setAiOpen}
          onShare={() => setShowShare(true)}
          onVersions={() => setShowVersions(true)}
          onUpload={() => setShowUpload(true)}
        />
        {aiOpen && <AIPanel onClose={() => setAiOpen(false)} />}
      </div>

      {showShare && <ShareModal onClose={() => setShowShare(false)} />}
      {showVersions && <VersionModal onClose={() => setShowVersions(false)} />}
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} />}

      <TweaksUI tw={tw} setTweak={setTweak} />
    </>
  );
}

function TweaksUI({ tw, setTweak }) {
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="视图" />
      <TweakRadio
        label="屏幕"
        value={tw.screen}
        onChange={v => setTweak('screen', v)}
        options={[
          { value: 'editor', label: '编辑器' },
          { value: 'login',  label: '登录页' },
        ]}
      />
      <TweakToggle label="AI 面板"  value={tw.aiOpen} onChange={v => setTweak('aiOpen', v)} />

      <TweakSection label="主题" />
      <TweakRadio
        label="模式"
        value={tw.theme}
        onChange={v => setTweak('theme', v)}
        options={[
          { value: 'light', label: '浅色' },
          { value: 'dark',  label: '深色' },
        ]}
      />
      <TweakColor
        label="强调色"
        value={tw.accent}
        onChange={v => setTweak('accent', v)}
        options={['#3b5b8f', '#3d6850', '#a85a32', '#704a78']}
      />
      <TweakRadio
        label="密度"
        value={tw.density}
        onChange={v => setTweak('density', v)}
        options={[
          { value: 'comfortable', label: '舒适' },
          { value: 'compact',     label: '紧凑' },
        ]}
      />
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
