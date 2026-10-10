import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchSessions,
  createSession,
  fetchSessionMessages,
  postChatTurn,
  fetchChatStatus,
  ApiError,
} from './api/client.js';
import { Header } from './components/Header.jsx';
import { Sidebar, deriveSessionTitle } from './components/Sidebar.jsx';
import { MessageList } from './components/MessageList.jsx';
import { Composer } from './components/Composer.jsx';
import { ErrorBanner } from './components/ErrorBanner.jsx';

const LOCAL_STORAGE_SESSION_KEY = 'lenny_growth_selected_session_id';

export default function App() {
  // Application State
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(null);
  const [selectedProvider, setSelectedProvider] = useState('ollama');

  // Loading & submission flags
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Error & UI states
  const [error, setError] = useState(null);
  const [presetPrompt, setPresetPrompt] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [lastFailedMessage, setLastFailedMessage] = useState(null);

  // Concurrency refs
  const activeMessageFetchId = useRef(0);
  const initialFetchDone = useRef(false);

  // 1. Fetch system status & providers on mount
  useEffect(() => {
    let isMounted = true;
    async function loadStatus() {
      try {
        const statusData = await fetchChatStatus();
        if (isMounted && statusData) {
          setStatus(statusData);
          if (statusData.active_provider) {
            setSelectedProvider(statusData.active_provider);
          }
        }
      } catch (err) {
        // Status check failure is non-fatal for initial UI render
        console.warn('Failed to fetch provider status on startup:', err);
      }
    }
    loadStatus();
    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Load existing sessions on mount (avoiding duplicate creations in StrictMode)
  useEffect(() => {
    if (initialFetchDone.current) return;
    initialFetchDone.current = true;

    async function initSessions() {
      setIsLoadingSessions(true);
      try {
        const fetchedSessions = await fetchSessions(0, 50);
        setSessions(fetchedSessions);

        // Check if there is a preserved session ID in localStorage
        const savedId = localStorage.getItem(LOCAL_STORAGE_SESSION_KEY);
        const matched = savedId && fetchedSessions.find((s) => s.id === savedId);

        if (matched) {
          setCurrentSessionId(matched.id);
        } else if (fetchedSessions.length > 0) {
          setCurrentSessionId(fetchedSessions[0].id);
        } else {
          // No sessions exist yet; leave currentSessionId null until user sends first message or clicks New Chat
          setCurrentSessionId(null);
        }
      } catch (err) {
        console.error('Failed to load sessions:', err);
        setError({
          status: err.status || 0,
          message: err.message || 'Failed to load conversation history',
        });
      } finally {
        setIsLoadingSessions(false);
      }
    }

    initSessions();
  }, []);

  // 3. Load messages whenever currentSessionId changes (with race condition guard)
  useEffect(() => {
    if (!currentSessionId) {
      setMessages([]);
      return;
    }

    // Persist current session selection
    try {
      localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, currentSessionId);
    } catch {
      // Ignore storage quota errors
    }

    const fetchId = ++activeMessageFetchId.current;
    const abortController = new AbortController();

    async function loadMessages() {
      setIsLoadingMessages(true);
      setError(null);
      try {
        const msgs = await fetchSessionMessages(currentSessionId, 0, 100, abortController.signal);
        // Only update state if this is still the active request
        if (fetchId === activeMessageFetchId.current) {
          setMessages(msgs);
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (fetchId === activeMessageFetchId.current) {
          console.error(`Failed to load messages for session ${currentSessionId}:`, err);
          setError({
            status: err.status || 0,
            message: err.message || 'Failed to load session messages',
          });
        }
      } finally {
        if (fetchId === activeMessageFetchId.current) {
          setIsLoadingMessages(false);
        }
      }
    }

    loadMessages();

    return () => {
      abortController.abort();
    };
  }, [currentSessionId]);

  // Handle explicit "New Conversation" button
  const handleNewSession = useCallback(async () => {
    setError(null);
    setIsLoadingSessions(true);
    try {
      const newSess = await createSession({ title: null });
      setSessions((prev) => [newSess, ...prev]);
      setCurrentSessionId(newSess.id);
      setMessages([]);
      setSidebarOpen(false);
    } catch (err) {
      console.error('Failed to create new session:', err);
      setError({
        status: err.status || 0,
        message: err.message || 'Failed to create new session',
      });
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  // Select existing session
  const handleSelectSession = useCallback((sessionId) => {
    if (sessionId === currentSessionId) return;
    setError(null);
    setCurrentSessionId(sessionId);
    setSidebarOpen(false);
  }, [currentSessionId]);

  // Handle submitting a chat turn
  const handleSendMessage = useCallback(async (content) => {
    const trimmed = content.trim();
    if (!trimmed || isSubmitting) return;

    setError(null);
    setLastFailedMessage(null);
    setIsSubmitting(true);

    let targetSessionId = currentSessionId;

    // If no session exists yet, create one lazily
    if (!targetSessionId) {
      try {
        const newSess = await createSession({ title: null });
        targetSessionId = newSess.id;
        setSessions((prev) => [newSess, ...prev]);
        setCurrentSessionId(newSess.id);
      } catch (createErr) {
        setIsSubmitting(false);
        setError({
          status: createErr.status || 0,
          message: `Could not initialize new session: ${createErr.message}`,
        });
        return;
      }
    }

    // Optimistically show user message
    const tempUserId = `temp-${Date.now()}`;
    const optimisticUserMsg = {
      id: tempUserId,
      session_id: targetSessionId,
      role: 'user',
      content: trimmed,
      created_at: new Date().toISOString(),
      isOptimistic: true,
    };

    setMessages((prev) => [...prev, optimisticUserMsg]);

    try {
      const turnResponse = await postChatTurn(targetSessionId, {
        message: trimmed,
        provider: selectedProvider,
      });

      // Construct confirmed assistant message
      const assistantMsg = {
        id: turnResponse.assistant_message_id,
        session_id: targetSessionId,
        role: 'assistant',
        content: turnResponse.answer,
        citations: turnResponse.citations || [],
        structured_metadata: {
          citations: turnResponse.citations || [],
          provider: turnResponse.provider,
          model: turnResponse.model,
          trace_id: turnResponse.trace_id,
        },
        created_at: turnResponse.created_at || new Date().toISOString(),
      };

      // Replace optimistic message with confirmed user message, then append assistant message
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== tempUserId);
        const confirmedUserMsg = {
          ...optimisticUserMsg,
          id: turnResponse.user_message_id,
          isOptimistic: false,
        };
        return [...filtered, confirmedUserMsg, assistantMsg];
      });

      // Update session title in sidebar if it was untitled and this is the first turn
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === targetSessionId && !s.title) {
            return {
              ...s,
              first_message: trimmed,
              updated_at: new Date().toISOString(),
            };
          }
          return s;
        })
      );
    } catch (turnErr) {
      console.error('Chat turn failed:', turnErr);
      // Remove optimistic message so failed state is never permanently saved as confirmed
      setMessages((prev) => prev.filter((m) => m.id !== tempUserId));
      setLastFailedMessage(trimmed);

      setError({
        status: turnErr.status || 0,
        message: turnErr.message || 'Chat turn execution failed',
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [currentSessionId, isSubmitting, selectedProvider]);

  // Retry sending the last failed message
  const handleRetry = useCallback(() => {
    if (lastFailedMessage) {
      const msg = lastFailedMessage;
      setLastFailedMessage(null);
      handleSendMessage(msg);
    }
  }, [lastFailedMessage, handleSendMessage]);

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const currentTitle = currentSession ? deriveSessionTitle(currentSession) : 'New Conversation';

  return (
    <div className="app-container">
      <Header
        status={status}
        selectedProvider={selectedProvider}
        onSelectProvider={setSelectedProvider}
        onToggleMobileSidebar={() => setSidebarOpen((prev) => !prev)}
        disabled={isSubmitting}
      />

      <div className="app-workspace">
        {/* Sidebar */}
        <Sidebar
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          isLoading={isLoadingSessions}
          isOpen={sidebarOpen}
          onCloseMobile={() => setSidebarOpen(false)}
        />

        {/* Backdrop for mobile drawer */}
        {sidebarOpen && (
          <div
            className="sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Main Conversation Workspace */}
        <main className="main-chat-workspace" id="chat-workspace">
          {/* Conversation Sub-header */}
          <div className="workspace-header">
            <div className="workspace-title-box">
              <h2 className="current-session-title">{currentTitle}</h2>
              <span className="session-message-count">
                {messages.length} message{messages.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="workspace-actions">
              <span className="active-provider-badge">
                {selectedProvider === 'anthropic'
                  ? `Anthropic${status?.active_model ? ` (${status.active_model})` : ''}`
                  : `Ollama${status?.active_model ? ` (${status.active_model})` : ''}`}
              </span>
            </div>
          </div>

          {/* Error Banner */}
          <ErrorBanner
            error={error}
            onDismiss={() => setError(null)}
            onRetry={lastFailedMessage ? handleRetry : null}
          />

          {/* Message List */}
          <div className="workspace-messages-pane">
            {isLoadingMessages ? (
              <div className="messages-loading-state">
                <div className="loader-spinner" aria-hidden="true"></div>
                <p>Loading conversation messages...</p>
              </div>
            ) : (
              <MessageList
                messages={messages}
                isSubmitting={isSubmitting}
                onSelectSuggestion={(suggestion) => {
                  setPresetPrompt(suggestion);
                }}
              />
            )}
          </div>

          {/* Composer */}
          <div className="workspace-composer-pane">
            <Composer
              onSendMessage={handleSendMessage}
              isSubmitting={isSubmitting}
              disabled={isLoadingMessages}
              presetText={presetPrompt}
            />
          </div>
        </main>

        {/* Extensible Side-by-Side Artifact Slot (Ready for Milestone 05B / 06) */}
        <aside
          className="artifact-panel-slot"
          aria-label="Artifact viewer container"
          style={{ display: 'none' }}
        >
          {/* Will be populated with Markdown / HTML viewer in future task */}
        </aside>
      </div>

      <footer className="app-footer">
        <span>Oogway Labs Forward Deployed Engineering Assignment</span>
        <span>Milestone: Task 05A React Chat Interface Foundation</span>
      </footer>
    </div>
  );
}
