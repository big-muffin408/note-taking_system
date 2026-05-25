import React, { createContext, useContext, useState, useRef, useCallback, useMemo, ReactNode, Dispatch, SetStateAction } from 'react';

export type AiTab = 'chat' | 'summary' | 'polish';
export type AiMode = 'summary' | 'chat' | 'polish';

export interface AiSource {
  score: number;
  text: string;
  textPreview?: string;
  sourceName: string;
  chunkIndex: number;
}

export interface AiChatMessage {
  who: 'user' | 'ai';
  text: string;
  streaming?: boolean;
  sources?: AiSource[];
}

interface AiPanelState {
  open: boolean;
  tab: AiTab;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setTab: (tab: AiTab) => void;

  // Chat
  messages: AiChatMessage[];
  appendMessage: (msg: AiChatMessage) => void;
  updateLastMessage: (updater: (last: AiChatMessage) => AiChatMessage) => void;
  clearMessages: () => void;

  // Loading state shared with editor (summary streamed into both modal-less card and editor insert)
  aiLoading: AiMode | null;
  setAiLoading: (mode: AiMode | null) => void;
  aiError: string;
  setAiError: (err: string) => void;

  // Streaming buffers (shared so editor can also "insert into note")
  summaryResult: string;
  summaryStreaming: string;
  setSummaryResult: Dispatch<SetStateAction<string>>;
  setSummaryStreaming: Dispatch<SetStateAction<string>>;
  summarySources: AiSource[];
  setSummarySources: Dispatch<SetStateAction<AiSource[]>>;

  // Polish state
  selectedText: string;
  setSelectedText: Dispatch<SetStateAction<string>>;
  polishResult: string;
  polishStreaming: string;
  setPolishResult: Dispatch<SetStateAction<string>>;
  setPolishStreaming: Dispatch<SetStateAction<string>>;

  // Stream cancel
  streamAbortRef: React.MutableRefObject<AbortController | null>;
  cancelStream: () => void;

  // Trigger requests — defined by EditorPage and registered here so AiPanel can call them
  runSummary: () => void;
  runChat: (question: string) => void;
  runPolish: () => void;
  insertResult: (text: string) => void;
  registerHandlers: (handlers: Partial<Pick<AiPanelState, 'runSummary' | 'runChat' | 'runPolish' | 'insertResult'>>) => void;
}

const AiPanelContext = createContext<AiPanelState | null>(null);

const noop = () => {};

export function AiPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<AiTab>('chat');
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [aiLoading, setAiLoading] = useState<AiMode | null>(null);
  const [aiError, setAiError] = useState('');
  const [summaryResult, setSummaryResult] = useState('');
  const [summaryStreaming, setSummaryStreaming] = useState('');
  const [summarySources, setSummarySources] = useState<AiSource[]>([]);
  const [selectedText, setSelectedText] = useState('');
  const [polishResult, setPolishResult] = useState('');
  const [polishStreaming, setPolishStreaming] = useState('');

  const streamAbortRef = useRef<AbortController | null>(null);
  const handlersRef = useRef({
    runSummary: noop as () => void,
    runChat: noop as (question: string) => void,
    runPolish: noop as () => void,
    insertResult: noop as (text: string) => void,
  });

  const appendMessage = useCallback((msg: AiChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);
  const updateLastMessage = useCallback((updater: (last: AiChatMessage) => AiChatMessage) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const copy = prev.slice();
      copy[copy.length - 1] = updater(copy[copy.length - 1]);
      return copy;
    });
  }, []);
  const clearMessages = useCallback(() => setMessages([]), []);

  const cancelStream = useCallback(() => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    setAiLoading(null);
  }, []);

  const toggleOpen = useCallback(() => setOpen((p) => !p), []);

  const registerHandlers = useCallback(
    (h: Partial<Pick<AiPanelState, 'runSummary' | 'runChat' | 'runPolish' | 'insertResult'>>) => {
      if (h.runSummary) handlersRef.current.runSummary = h.runSummary;
      if (h.runChat) handlersRef.current.runChat = h.runChat;
      if (h.runPolish) handlersRef.current.runPolish = h.runPolish;
      if (h.insertResult) handlersRef.current.insertResult = h.insertResult;
    },
    [],
  );

  const value = useMemo<AiPanelState>(
    () => ({
      open,
      tab,
      setOpen,
      toggleOpen,
      setTab,
      messages,
      appendMessage,
      updateLastMessage,
      clearMessages,
      aiLoading,
      setAiLoading,
      aiError,
      setAiError,
      summaryResult,
      summaryStreaming,
      setSummaryResult,
      setSummaryStreaming,
      summarySources,
      setSummarySources,
      selectedText,
      setSelectedText,
      polishResult,
      polishStreaming,
      setPolishResult,
      setPolishStreaming,
      streamAbortRef,
      cancelStream,
      runSummary: () => handlersRef.current.runSummary(),
      runChat: (q: string) => handlersRef.current.runChat(q),
      runPolish: () => handlersRef.current.runPolish(),
      insertResult: (t: string) => handlersRef.current.insertResult(t),
      registerHandlers,
    }),
    [
      open,
      tab,
      toggleOpen,
      messages,
      appendMessage,
      updateLastMessage,
      clearMessages,
      aiLoading,
      aiError,
      summaryResult,
      summaryStreaming,
      summarySources,
      selectedText,
      polishResult,
      polishStreaming,
      cancelStream,
      registerHandlers,
    ],
  );

  return <AiPanelContext.Provider value={value}>{children}</AiPanelContext.Provider>;
}

export function useAiPanel() {
  const ctx = useContext(AiPanelContext);
  if (!ctx) throw new Error('useAiPanel must be used inside AiPanelProvider');
  return ctx;
}
