import React, { useState, useRef, useEffect } from 'react';
import { useAiPanel } from '../contexts/AiPanelContext';

const SparkleIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" width="14" height="14">
    <path d="M9 2l1 2.5L12.5 5.5 10 6.5 9 9 8 6.5 5.5 5.5 8 4.5z" fill="currentColor" />
    <path d="M3.5 9.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="currentColor" />
  </svg>
);
const SendIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2L7.5 8.5M14 2l-5 12-2-5.5-5-2z" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" width="14" height="14">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);
const RefreshIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 4v3h3M14 12v-3h-3" />
    <path d="M3 8a5 5 0 019-2.5L14 7M13 8a5 5 0 01-9 2.5L2 9" />
  </svg>
);
const CopyIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    <rect x="5" y="5" width="9" height="9" rx="1.5" />
    <path d="M2 11V3a1 1 0 011-1h8" />
  </svg>
);
const StopIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor">
    <rect x="4" y="4" width="8" height="8" rx="1" />
  </svg>
);

interface AiPanelProps {
  onResizeStart?: (e: React.MouseEvent) => void;
}

export default function AiPanel({ onResizeStart }: AiPanelProps) {
  const {
    open,
    setOpen,
    tab,
    setTab,
    messages,
    aiLoading,
    aiError,
    summaryResult,
    summaryStreaming,
    summarySources,
    selectedText,
    polishResult,
    polishStreaming,
    cancelStream,
    runSummary,
    runChat,
    runPolish,
    insertResult,
  } = useAiPanel();

  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom on new message / streaming tick
  useEffect(() => {
    if (tab === 'chat' && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [tab, messages]);

  if (!open) return null;

  function handleSend() {
    if (!input.trim() || aiLoading) return;
    runChat(input.trim());
    setInput('');
  }

  function copyText(text: string) {
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  const summaryDisplay = summaryStreaming || summaryResult;
  const polishDisplay = polishStreaming || polishResult;
  const isChatStreaming = aiLoading === 'chat';

  return (
    <aside className="ai-panel">
      {onResizeStart && (
        <div className="ai-panel-resize-handle" onMouseDown={onResizeStart} />
      )}
      <div className="ai-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="ai-title">
            <span className="ai-title-icon"><SparkleIcon /></span>
            AI 助手
          </div>
          <button className="ai-mini-btn" onClick={() => setOpen(false)} title="关闭">
            <CloseIcon />
          </button>
        </div>
        <div className="ai-tabs">
          <button className={`ai-tab${tab === 'chat' ? ' active' : ''}`} onClick={() => setTab('chat')}>问答</button>
          <button className={`ai-tab${tab === 'summary' ? ' active' : ''}`} onClick={() => setTab('summary')}>摘要</button>
          <button className={`ai-tab${tab === 'polish' ? ' active' : ''}`} onClick={() => setTab('polish')}>润色</button>
        </div>
      </div>

      <div className="ai-body" ref={bodyRef}>
        {aiError && <div className="ai-error-inline">{aiError}</div>}

        {tab === 'chat' && (
          <>
            <div className="ai-card ai-card-dashed">
              <div className="ai-card-head">
                <span className="ai-card-title">基于本笔记 · RAG</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                提问会自动检索当前笔记 + 你授权的相关笔记。回答中的 <span className="cite">§N</span> 是引用段落。
              </div>
            </div>

            {messages.length === 0 && !isChatStreaming && (
              <div style={{ fontSize: 12, color: 'var(--ink-4)', textAlign: 'center', padding: '20px 0' }}>
                从下方输入问题开始对话
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`chat-msg ${m.who}`}>
                <div className="who">{m.who === 'user' ? '你' : 'Quire AI'}</div>
                <div className={`bubble${m.streaming ? ' cursor-blink' : ''}`}>
                  {m.text}
                  {m.sources && !m.streaming && m.sources.slice(0, 3).map((s, idx) => (
                    <span
                      key={`${s.sourceName}-${s.chunkIndex}-${idx}`}
                      className="cite"
                      title={s.textPreview || s.text}
                    >
                      §{s.chunkIndex + 1}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {tab === 'summary' && (
          <>
            <div className="ai-card">
              <div className="ai-card-head">
                <span className="ai-card-title">本笔记摘要</span>
                <div className="ai-card-actions">
                  <button
                    className="ai-mini-btn"
                    onClick={() => copyText(summaryDisplay)}
                    disabled={!summaryDisplay}
                    title="复制"
                  >
                    <CopyIcon />
                  </button>
                  <button
                    className="ai-mini-btn"
                    onClick={runSummary}
                    disabled={aiLoading !== null}
                    title="重新生成"
                  >
                    <RefreshIcon />
                  </button>
                </div>
              </div>

              {summaryDisplay ? (
                <div className={aiLoading === 'summary' ? 'cursor-blink' : ''} style={{ whiteSpace: 'pre-wrap' }}>
                  {summaryDisplay}
                </div>
              ) : (
                <div style={{ color: 'var(--ink-4)', fontSize: 12 }}>
                  {aiLoading === 'summary' ? '生成中…' : '点击右上角刷新按钮生成摘要。'}
                </div>
              )}

              {summarySources.length > 0 && aiLoading !== 'summary' && (
                <div style={{ marginTop: 10, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {summarySources.slice(0, 3).map((s, idx) => (
                    <span
                      key={`${s.sourceName}-${s.chunkIndex}-${idx}`}
                      className="cite"
                      title={s.textPreview || s.text}
                    >
                      §{s.chunkIndex + 1}
                    </span>
                  ))}
                </div>
              )}

              {summaryDisplay && aiLoading !== 'summary' && (
                <div style={{ marginTop: 10 }}>
                  <button className="chip" onClick={() => insertResult(summaryDisplay)}>插入笔记</button>
                </div>
              )}
            </div>

            {!summaryDisplay && aiLoading !== 'summary' && (
              <button
                className="chip active"
                style={{ width: '100%', justifyContent: 'center', padding: '6px 10px' }}
                onClick={runSummary}
              >
                ✦ 生成摘要
              </button>
            )}
          </>
        )}

        {tab === 'polish' && (
          <>
            <div className="ai-card" style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent)' }}>
              <div className="ai-card-title" style={{ color: 'var(--accent-ink)', marginBottom: 6 }}>选中文本</div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', fontFamily: 'var(--serif)', fontStyle: 'italic', lineHeight: 1.5 }}>
                {selectedText
                  ? `"${selectedText}"`
                  : <span style={{ color: 'var(--ink-4)', fontStyle: 'normal' }}>在编辑器中选中一段文字以开始润色</span>}
              </div>
            </div>

            {selectedText && (
              <div style={{ marginBottom: 10 }}>
                <button
                  className="chip active"
                  onClick={runPolish}
                  disabled={aiLoading !== null}
                  style={{ padding: '6px 12px' }}
                >
                  ✦ 润色
                </button>
              </div>
            )}

            {polishDisplay && (
              <div className="ai-card">
                <div className="ai-card-head">
                  <span className="ai-card-title">建议改写</span>
                  <div className="ai-card-actions">
                    <button
                      className="ai-mini-btn"
                      onClick={() => copyText(polishDisplay)}
                      disabled={!polishDisplay}
                      title="复制"
                    >
                      <CopyIcon />
                    </button>
                    <button
                      className="ai-mini-btn"
                      onClick={runPolish}
                      disabled={aiLoading !== null || !selectedText}
                      title="重新润色"
                    >
                      <RefreshIcon />
                    </button>
                  </div>
                </div>
                <div className={aiLoading === 'polish' ? 'cursor-blink' : ''} style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
                  {polishDisplay}
                </div>
                {aiLoading !== 'polish' && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button className="chip active" onClick={() => insertResult(polishDisplay)}>✓ 插入</button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="ai-input-wrap">
        <div className="ai-input">
          <textarea
            ref={textareaRef}
            placeholder={tab === 'chat' ? '问点什么…' : tab === 'summary' ? '问答 tab 可用输入' : '在编辑器中选中文字'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={1}
            disabled={tab !== 'chat'}
          />
          <div className="ai-input-row">
            <div className="left">
              <span className="chip active">@当前笔记</span>
            </div>
            {aiLoading ? (
              <button className="send-btn" onClick={cancelStream} title="停止生成" style={{ background: 'var(--ink-3)' }}>
                <StopIcon />
              </button>
            ) : (
              <button
                className="send-btn"
                onClick={handleSend}
                disabled={!input.trim() || tab !== 'chat'}
                title="发送"
              >
                <SendIcon />
              </button>
            )}
          </div>
        </div>
        <div className="ai-input-foot">
          <span>↩ 发送 · ⇧↩ 换行</span>
        </div>
      </div>
    </aside>
  );
}
