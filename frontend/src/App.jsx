import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchSessions,
  createSession,
  fetchSessionMessages,
  postChatTurn,
  fetchChatStatus,
  fetchKnowledgeStatus,
  createEssay,
  fetchEssays,
  fetchEssay,
  createArtifact,
  fetchArtifacts,
  fetchArtifact,
} from './api/client.js';
import { Header } from './components/Header.jsx';
import { Sidebar, deriveSessionTitle } from './components/Sidebar.jsx';
import { MessageList } from './components/MessageList.jsx';
import { Composer } from './components/Composer.jsx';
import { ErrorBanner } from './components/ErrorBanner.jsx';
import { ArtifactViewer } from './components/ArtifactViewer.jsx';
import { PanelDivider } from './components/PanelDivider.jsx';
import { KnowledgeBaseModal } from './components/KnowledgeBaseModal.jsx';
import { CreateEssayModal } from './components/CreateEssayModal.jsx';
import { CreateArtifactModal } from './components/CreateArtifactModal.jsx';
import { FileText } from 'lucide-react';
import { ARTIFACT_POLLING_CONFIG, isGeneratingStatus } from './utils/artifact.js';

const LOCAL_STORAGE_SESSION_KEY = 'lenny_growth_selected_session_id';
const LOCAL_STORAGE_THEME_KEY = 'lenny_growth_theme';
const LOCAL_STORAGE_SIDEBAR_WIDTH_KEY = 'lenny_growth_sidebar_width';
const LOCAL_STORAGE_ARTIFACT_WIDTH_KEY = 'lenny_growth_artifact_width';
const LOCAL_STORAGE_SIDEBAR_OPEN_KEY = 'lenny_growth_sidebar_open';
const LOCAL_STORAGE_ARTIFACT_OPEN_KEY = 'lenny_growth_artifact_open';

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 420;
const DEFAULT_SIDEBAR_WIDTH = 270;

const MIN_ARTIFACT_WIDTH = 300;
const MAX_ARTIFACT_WIDTH = 700;
const DEFAULT_ARTIFACT_WIDTH = 420;

const MIN_CHAT_WIDTH = 380;

/**
 * Determine initial theme safely from localStorage or system preference.
 */
function getInitialTheme() {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_THEME_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
  } catch {
    // Ignore storage errors
  }
  return 'dark'; // Dark theme default
}

/**
 * Get initial panel widths and visibility from localStorage.
 */
function getInitialWidth(key, defaultVal, min, max) {
  try {
    const saved = parseInt(localStorage.getItem(key), 10);
    if (!isNaN(saved) && saved >= min && saved <= max) {
      return saved;
    }
  } catch {}
  return defaultVal;
}

export default function App() {
  // Theme state
  const [theme, setTheme] = useState(getInitialTheme);

  // Application Chat State
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(null);
  const [knowledgeStats, setKnowledgeStats] = useState(null);
  const [selectedProvider, setSelectedProvider] = useState('ollama');

  // Loading & submission flags
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Ship 30 Essays State
  const [essays, setEssays] = useState([]);
  const [isCreateEssayOpen, setIsCreateEssayOpen] = useState(false);
  const [isSubmittingEssay, setIsSubmittingEssay] = useState(false);

  // Generic Artifacts State (HTML & Markdown)
  const [artifacts, setArtifacts] = useState([]);
  const [activeArtifact, setActiveArtifact] = useState(null);
  const [isCreateArtifactOpen, setIsCreateArtifactOpen] = useState(false);
  const [isSubmittingArtifact, setIsSubmittingArtifact] = useState(false);
  const [isPollingTimedOut, setIsPollingTimedOut] = useState(false);

  // Error & UI states
  const [error, setError] = useState(null);
  const [presetPrompt, setPresetPrompt] = useState('');
  const [lastFailedMessage, setLastFailedMessage] = useState(null);

  // Three-panel layout states
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    getInitialWidth(LOCAL_STORAGE_SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH)
  );
  const [artifactWidth, setArtifactWidth] = useState(() =>
    getInitialWidth(LOCAL_STORAGE_ARTIFACT_WIDTH_KEY, DEFAULT_ARTIFACT_WIDTH, MIN_ARTIFACT_WIDTH, MAX_ARTIFACT_WIDTH)
  );

  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_SIDEBAR_OPEN_KEY);
      if (saved !== null) return JSON.parse(saved);
    } catch {}
    return true; // Default open on desktop
  });

  const [isArtifactPanelOpen, setIsArtifactPanelOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_ARTIFACT_OPEN_KEY);
      if (saved !== null) return JSON.parse(saved);
    } catch {}
    return false; // Default closed until requested
  });

  // Mobile drawer overlay & Modal states
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isKnowledgeBaseOpen, setIsKnowledgeBaseOpen] = useState(false);

  // Concurrency and Session reference guards
  const activeMessageFetchId = useRef(0);
  const initialFetchDone = useRef(false);
  const currentSessionIdRef = useRef(null);
  currentSessionIdRef.current = currentSessionId;

  // Apply theme to document element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(LOCAL_STORAGE_THEME_KEY, theme);
    } catch {}
  }, [theme]);

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  // 1. Fetch system status & knowledge status on mount
  useEffect(() => {
    let isMounted = true;
    async function loadInitialMetadata() {
      try {
        const [statusData, kbData] = await Promise.allSettled([
          fetchChatStatus(),
          fetchKnowledgeStatus(),
        ]);

        if (!isMounted) return;

        if (statusData.status === 'fulfilled' && statusData.value) {
          setStatus(statusData.value);
          if (statusData.value.active_provider) {
            setSelectedProvider(statusData.value.active_provider);
          }
        }

        if (kbData.status === 'fulfilled' && kbData.value) {
          setKnowledgeStats(kbData.value);
        }
      } catch (err) {
        console.warn('Failed to load initial status metadata:', err);
      }
    }
    loadInitialMetadata();
    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Load existing sessions on mount
  useEffect(() => {
    if (initialFetchDone.current) return;
    initialFetchDone.current = true;

    async function initSessions() {
      setIsLoadingSessions(true);
      try {
        const fetchedSessions = await fetchSessions(0, 50);
        setSessions(fetchedSessions);

        const savedId = localStorage.getItem(LOCAL_STORAGE_SESSION_KEY);
        const matched = savedId && fetchedSessions.find((s) => s.id === savedId);

        if (matched) {
          setCurrentSessionId(matched.id);
        } else if (fetchedSessions.length > 0) {
          setCurrentSessionId(fetchedSessions[0].id);
        } else {
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

  // 3. Load messages, essays, and generic artifacts whenever currentSessionId changes
  useEffect(() => {
    if (!currentSessionId) {
      setMessages([]);
      setEssays([]);
      setArtifacts([]);
      setActiveArtifact(null);
      return;
    }

    try {
      localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, currentSessionId);
    } catch {}

    const fetchId = ++activeMessageFetchId.current;
    const abortController = new AbortController();

    async function loadSessionData() {
      setIsLoadingMessages(true);
      setError(null);
      try {
        // Fetch messages, session essays, and generic artifacts concurrently
        const [msgsResult, essaysResult, artifactsResult] = await Promise.allSettled([
          fetchSessionMessages(currentSessionId, 0, 100, abortController.signal),
          fetchEssays(currentSessionId),
          fetchArtifacts(currentSessionId),
        ]);

        if (fetchId !== activeMessageFetchId.current) return;

        if (msgsResult.status === 'fulfilled') {
          setMessages(msgsResult.value);
        } else if (msgsResult.reason?.name !== 'AbortError') {
          console.error(`Failed to load messages for session ${currentSessionId}:`, msgsResult.reason);
          setError({
            status: msgsResult.reason?.status || 0,
            message: msgsResult.reason?.message || 'Failed to load session messages',
          });
        }

        const loadedEssays = essaysResult.status === 'fulfilled' ? (essaysResult.value || []) : [];
        const loadedArtifacts = artifactsResult.status === 'fulfilled' ? (artifactsResult.value || []) : [];
        setEssays(loadedEssays);
        setArtifacts(loadedArtifacts);

        // Restore previously selected artifact or essay in this session if saved
        const savedArtifactKey = `lenny_growth_selected_artifact_${currentSessionId}`;
        const savedLegacyEssayKey = `lenny_growth_selected_essay_${currentSessionId}`;
        const savedSelectedId = localStorage.getItem(savedArtifactKey) || localStorage.getItem(savedLegacyEssayKey);

        let selectedItem = null;
        if (savedSelectedId) {
          const matchedArt = loadedArtifacts.find((a) => a.artifact_id === savedSelectedId);
          if (matchedArt) {
            try {
              selectedItem = await fetchArtifact(currentSessionId, matchedArt.artifact_id);
            } catch {}
          }
          if (!selectedItem) {
            const matchedEssay = loadedEssays.find((e) => e.essay_id === savedSelectedId);
            if (matchedEssay) {
              try {
                selectedItem = await fetchEssay(currentSessionId, matchedEssay.essay_id);
              } catch {}
            }
          }
        }

        // Fallback to most recent artifact or essay
        if (!selectedItem) {
          if (loadedArtifacts.length > 0) {
            try {
              selectedItem = await fetchArtifact(currentSessionId, loadedArtifacts[0].artifact_id);
            } catch {}
          } else if (loadedEssays.length > 0) {
            try {
              selectedItem = await fetchEssay(currentSessionId, loadedEssays[0].essay_id);
            } catch {}
          }
        }

        if (fetchId === activeMessageFetchId.current) {
          setActiveArtifact(selectedItem || null);
        }
      } finally {
        if (fetchId === activeMessageFetchId.current) {
          setIsLoadingMessages(false);
        }
      }
    }

    loadSessionData();

    return () => {
      abortController.abort();
    };
  }, [currentSessionId]);

  // 4. Bounded Polling Lifecycle for In-Flight Generating Artifact or Essay
  useEffect(() => {
    if (!activeArtifact || !isGeneratingStatus(activeArtifact.generation_status) || !currentSessionId) {
      return;
    }

    const targetSessionId = currentSessionId;
    const isGeneric = Boolean(activeArtifact.artifact_id);
    const targetId = isGeneric ? activeArtifact.artifact_id : activeArtifact.essay_id;
    let pollCount = 0;
    const maxPolls = ARTIFACT_POLLING_CONFIG.MAX_ATTEMPTS;
    const pollInterval = ARTIFACT_POLLING_CONFIG.INTERVAL_MS;
    let timerId = null;

    async function poll() {
      // Guard against session switches or unmount
      if (currentSessionIdRef.current !== targetSessionId) return;

      pollCount++;
      try {
        const updated = isGeneric
          ? await fetchArtifact(targetSessionId, targetId)
          : await fetchEssay(targetSessionId, targetId);

        if (currentSessionIdRef.current !== targetSessionId) return;

        setActiveArtifact(updated);

        // Update item in respective summary list
        if (isGeneric) {
          setArtifacts((prev) =>
            prev.map((a) =>
              a.artifact_id === targetId
                ? {
                    ...a,
                    title: updated.title || a.title,
                    generation_status: updated.generation_status,
                  }
                : a
            )
          );
        } else {
          setEssays((prev) =>
            prev.map((e) =>
              e.essay_id === targetId
                ? {
                    ...e,
                    title: updated.title || e.title,
                    word_count: updated.word_count || e.word_count,
                    generation_status: updated.generation_status,
                  }
                : e
            )
          );
        }

        // If completed, failed, or insufficient_evidence, stop polling
        if (!isGeneratingStatus(updated.generation_status)) {
          // Synchronize complete session list on completion
          if (updated.generation_status === 'completed') {
            if (isGeneric) {
              fetchArtifacts(targetSessionId)
                .then((fresh) => {
                  if (currentSessionIdRef.current === targetSessionId) setArtifacts(fresh);
                })
                .catch(() => {});
            } else {
              fetchEssays(targetSessionId)
                .then((fresh) => {
                  if (currentSessionIdRef.current === targetSessionId) setEssays(fresh);
                })
                .catch(() => {});
            }
          }
          return;
        }
      } catch (err) {
        console.warn(`Polling error for artifact ${targetId}:`, err);
      }

      if (pollCount < maxPolls && currentSessionIdRef.current === targetSessionId) {
        timerId = setTimeout(poll, pollInterval);
      } else if (pollCount >= maxPolls && currentSessionIdRef.current === targetSessionId) {
        // Bounded observation timeout reached; do not alter backend state
        setIsPollingTimedOut(true);
      }
    }

    timerId = setTimeout(poll, pollInterval);

    return () => {
      if (timerId) clearTimeout(timerId);
    };
  }, [activeArtifact?.artifact_id, activeArtifact?.essay_id, activeArtifact?.generation_status, currentSessionId]);

  // Handle explicit "New Conversation" button
  const handleNewSession = useCallback(async () => {
    setError(null);
    setIsLoadingSessions(true);
    try {
      const newSess = await createSession({ title: null });
      setSessions((prev) => [newSess, ...prev]);
      setCurrentSessionId(newSess.id);
      setMessages([]);
      setEssays([]);
      setArtifacts([]);
      setActiveArtifact(null);
      setMobileSidebarOpen(false);
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
    setIsPollingTimedOut(false);
    setCurrentSessionId(sessionId);
    setMobileSidebarOpen(false);
  }, [currentSessionId]);

  // Select existing Ship 30 essay in active session
  const handleSelectEssay = useCallback(
    async (essayId) => {
      if (!currentSessionId || !essayId) return;
      setError(null);
      setIsPollingTimedOut(false);

      try {
        localStorage.setItem(`lenny_growth_selected_artifact_${currentSessionId}`, essayId);
      } catch {}

      try {
        const full = await fetchEssay(currentSessionId, essayId);
        setActiveArtifact(full);
        setIsArtifactPanelOpen(true);
      } catch (err) {
        console.error('Failed to load essay details:', err);
        setError({
          status: err.status || 0,
          message: err.message || 'Failed to load essay content',
        });
      }
    },
    [currentSessionId]
  );

  // Select existing generic artifact (HTML or Markdown) in active session
  const handleSelectArtifact = useCallback(
    async (artifactId) => {
      if (!currentSessionId || !artifactId) return;
      setError(null);
      setIsPollingTimedOut(false);

      try {
        localStorage.setItem(`lenny_growth_selected_artifact_${currentSessionId}`, artifactId);
      } catch {}

      try {
        const full = await fetchArtifact(currentSessionId, artifactId);
        setActiveArtifact(full);
        setIsArtifactPanelOpen(true);
      } catch (err) {
        console.error('Failed to load artifact details:', err);
        setError({
          status: err.status || 0,
          message: err.message || 'Failed to load artifact content',
        });
      }
    },
    [currentSessionId]
  );

  // Manual status refresh for active artifact or essay
  const handleRefreshActiveArtifact = useCallback(async () => {
    if (!activeArtifact || !currentSessionId) return;
    const isGeneric = Boolean(activeArtifact.artifact_id);
    const targetId = isGeneric ? activeArtifact.artifact_id : activeArtifact.essay_id;
    try {
      const refreshed = isGeneric
        ? await fetchArtifact(currentSessionId, targetId)
        : await fetchEssay(currentSessionId, targetId);

      if (currentSessionIdRef.current === currentSessionId) {
        setActiveArtifact(refreshed);
        setIsPollingTimedOut(false);
        if (isGeneric) {
          setArtifacts((prev) =>
            prev.map((a) =>
              a.artifact_id === targetId
                ? { ...a, title: refreshed.title || a.title, generation_status: refreshed.generation_status }
                : a
            )
          );
        } else {
          setEssays((prev) =>
            prev.map((e) =>
              e.essay_id === targetId
                ? {
                    ...e,
                    title: refreshed.title || e.title,
                    word_count: refreshed.word_count || e.word_count,
                    generation_status: refreshed.generation_status,
                  }
                : e
            )
          );
        }
      }
    } catch (err) {
      console.warn(`Manual status refresh failed for ${targetId}:`, err);
    }
  }, [activeArtifact, currentSessionId]);

  // Submit new Ship 30 essay generation
  const handleCreateEssaySubmit = useCallback(
    async (payload) => {
      let targetSessionId = currentSessionId;
      setError(null);
      setIsSubmittingEssay(true);

      // Create session lazily if none active
      if (!targetSessionId) {
        try {
          const newSess = await createSession({ title: `Essay: ${payload.topic.slice(0, 30)}` });
          targetSessionId = newSess.id;
          setSessions((prev) => [newSess, ...prev]);
          setCurrentSessionId(newSess.id);
        } catch (createErr) {
          setIsSubmittingEssay(false);
          setError({
            status: createErr.status || 0,
            message: `Could not create session for essay: ${createErr.message}`,
          });
          return;
        }
      }

      try {
        const createdEssay = await createEssay(targetSessionId, payload);
        setActiveArtifact(createdEssay);

        // Prepend to essays summary list
        setEssays((prev) => [
          {
            essay_id: createdEssay.essay_id,
            session_id: targetSessionId,
            topic: createdEssay.topic,
            title: createdEssay.title,
            word_count: createdEssay.word_count,
            generation_status: createdEssay.generation_status,
            provider: createdEssay.provider,
            created_at: createdEssay.created_at,
          },
          ...prev,
        ]);

        // Open artifact viewer immediately to show in-flight progress
        setIsArtifactPanelOpen(true);
        setIsCreateEssayOpen(false);

        try {
          localStorage.setItem(`lenny_growth_selected_artifact_${targetSessionId}`, createdEssay.essay_id);
        } catch {}
      } catch (err) {
        console.error('Failed to initiate essay generation:', err);
        setError({
          status: err.status || 0,
          message: err.message || 'Failed to start Ship 30 essay generation',
        });
      } finally {
        setIsSubmittingEssay(false);
      }
    },
    [currentSessionId]
  );

  // Submit new generic artifact generation (HTML or Markdown)
  const handleCreateArtifactSubmit = useCallback(
    async (payload) => {
      let targetSessionId = currentSessionId;
      setError(null);
      setIsSubmittingArtifact(true);

      // Create session lazily if none active
      if (!targetSessionId) {
        try {
          const newSess = await createSession({ title: `Artifact: ${payload.title.slice(0, 30)}` });
          targetSessionId = newSess.id;
          setSessions((prev) => [newSess, ...prev]);
          setCurrentSessionId(newSess.id);
        } catch (createErr) {
          setIsSubmittingArtifact(false);
          setError({
            status: createErr.status || 0,
            message: `Could not create session for artifact: ${createErr.message}`,
          });
          return;
        }
      }

      try {
        const createdArtifact = await createArtifact(targetSessionId, payload);
        setActiveArtifact(createdArtifact);

        // Prepend to artifacts summary list
        setArtifacts((prev) => [
          {
            artifact_id: createdArtifact.artifact_id,
            session_id: targetSessionId,
            title: createdArtifact.title,
            artifact_type: createdArtifact.artifact_type,
            generation_status: createdArtifact.generation_status,
            provider: createdArtifact.provider,
            created_at: createdArtifact.created_at,
            updated_at: createdArtifact.updated_at,
          },
          ...prev,
        ]);

        setIsArtifactPanelOpen(true);
        setIsCreateArtifactOpen(false);

        try {
          localStorage.setItem(`lenny_growth_selected_artifact_${targetSessionId}`, createdArtifact.artifact_id);
        } catch {}
      } catch (err) {
        console.error('Failed to initiate artifact generation:', err);
        setError({
          status: err.status || 0,
          message: err.message || 'Failed to start artifact generation',
        });
      } finally {
        setIsSubmittingArtifact(false);
      }
    },
    [currentSessionId]
  );

  // Retry generation for active artifact or essay
  const handleRetryGeneration = useCallback(
    (item) => {
      if (!item) return;
      if (item.artifact_id) {
        handleCreateArtifactSubmit({
          title: item.title,
          artifact_type: item.artifact_type,
          instructions: item.meta_info?.instructions || `Regenerate ${item.title}`,
          topic: item.meta_info?.topic,
          provider: item.provider,
          model: item.model,
        });
      } else if (item.essay_id) {
        handleCreateEssaySubmit({
          topic: item.topic,
          audience: item.audience,
          intended_outcome: item.intended_outcome,
          proven_approach: item.proven_approach,
          four_a_path: item.four_a_path,
          target_word_count: item.target_word_count,
          provider: item.provider,
          model: item.model,
        });
      }
    },
    [handleCreateArtifactSubmit, handleCreateEssaySubmit]
  );

  // Handle submitting a chat turn
  const handleSendMessage = useCallback(
    async (content) => {
      const trimmed = content.trim();
      if (!trimmed || isSubmitting) return;

      setError(null);
      setLastFailedMessage(null);
      setIsSubmitting(true);

      let targetSessionId = currentSessionId;

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

        setMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== tempUserId);
          const confirmedUserMsg = {
            ...optimisticUserMsg,
            id: turnResponse.user_message_id,
            isOptimistic: false,
          };
          return [...filtered, confirmedUserMsg, assistantMsg];
        });

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
        setMessages((prev) => prev.filter((m) => m.id !== tempUserId));
        setLastFailedMessage(trimmed);

        setError({
          status: turnErr.status || 0,
          message: turnErr.message || 'Chat turn execution failed',
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [currentSessionId, isSubmitting, selectedProvider]
  );

  // Retry sending last failed message
  const handleRetry = useCallback(() => {
    if (lastFailedMessage) {
      const msg = lastFailedMessage;
      setLastFailedMessage(null);
      handleSendMessage(msg);
    }
  }, [lastFailedMessage, handleSendMessage]);

  // Sidebar resize callback with boundary checks
  const handleResizeSidebar = useCallback(
    (requestedWidth) => {
      const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
      const currentArtifactSpace = isArtifactPanelOpen ? artifactWidth : 0;
      const maxAllowed = Math.min(MAX_SIDEBAR_WIDTH, windowWidth - currentArtifactSpace - MIN_CHAT_WIDTH);

      const clamped = Math.max(MIN_SIDEBAR_WIDTH, Math.min(requestedWidth, maxAllowed));
      setSidebarWidth(clamped);
    },
    [artifactWidth, isArtifactPanelOpen]
  );

  const handleSidebarResizeEnd = useCallback(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
    } catch {}
  }, [sidebarWidth]);

  // Artifact panel resize callback with boundary checks
  const handleResizeArtifact = useCallback(
    (requestedWidth) => {
      const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
      const currentSidebarSpace = isSidebarOpen ? sidebarWidth : 0;
      const maxAllowed = Math.min(MAX_ARTIFACT_WIDTH, windowWidth - currentSidebarSpace - MIN_CHAT_WIDTH);

      const clamped = Math.max(MIN_ARTIFACT_WIDTH, Math.min(requestedWidth, maxAllowed));
      setArtifactWidth(clamped);
    },
    [isSidebarOpen, sidebarWidth]
  );

  const handleArtifactResizeEnd = useCallback(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_ARTIFACT_WIDTH_KEY, artifactWidth.toString());
    } catch {}
  }, [artifactWidth]);

  // Sidebar toggle
  const handleToggleDesktopSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LOCAL_STORAGE_SIDEBAR_OPEN_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  // Artifact panel toggle
  const handleToggleArtifactPanel = useCallback(() => {
    setIsArtifactPanelOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LOCAL_STORAGE_ARTIFACT_OPEN_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const currentTitle = currentSession ? deriveSessionTitle(currentSession) : 'New Conversation';

  return (
    <div className="app-container">
      {/* Top Application Header */}
      <Header
        status={status}
        selectedProvider={selectedProvider}
        onSelectProvider={setSelectedProvider}
        onToggleMobileSidebar={() => setMobileSidebarOpen((prev) => !prev)}
        onToggleDesktopSidebar={handleToggleDesktopSidebar}
        isSidebarOpen={isSidebarOpen}
        onToggleArtifactPanel={handleToggleArtifactPanel}
        isArtifactPanelOpen={isArtifactPanelOpen}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        disabled={isSubmitting}
      />

      {/* Main Three-Panel Workspace */}
      <div className="app-workspace" id="three-panel-workspace">
        {/* Left Panel: Sidebar */}
        {isSidebarOpen && (
          <div
            className="sidebar-panel-wrapper"
            style={{ width: `${sidebarWidth}px`, flexShrink: 0 }}
          >
            <Sidebar
              sessions={sessions}
              currentSessionId={currentSessionId}
              onSelectSession={handleSelectSession}
              onNewSession={handleNewSession}
              isLoading={isLoadingSessions}
              isOpen={false}
              onToggleArtifactPanel={handleToggleArtifactPanel}
              isArtifactPanelOpen={isArtifactPanelOpen}
              onOpenKnowledgeBase={() => setIsKnowledgeBaseOpen(true)}
              knowledgeEpisodeCount={knowledgeStats?.total_transcripts ?? null}
              essays={essays}
              currentEssayId={activeArtifact?.essay_id ?? null}
              onSelectEssay={handleSelectEssay}
              onOpenCreateEssay={() => setIsCreateEssayOpen(true)}
              artifacts={artifacts}
              currentArtifactId={activeArtifact?.artifact_id ?? null}
              onSelectArtifact={handleSelectArtifact}
              onOpenCreateArtifact={() => setIsCreateArtifactOpen(true)}
              theme={theme}
              onToggleTheme={handleToggleTheme}
              onCollapseSidebar={handleToggleDesktopSidebar}
            />
          </div>
        )}

        {/* Mobile drawer version of sidebar if desktop sidebar is closed */}
        {!isSidebarOpen && mobileSidebarOpen && (
          <Sidebar
            sessions={sessions}
            currentSessionId={currentSessionId}
            onSelectSession={handleSelectSession}
            onNewSession={handleNewSession}
            isLoading={isLoadingSessions}
            isOpen={mobileSidebarOpen}
            onCloseMobile={() => setMobileSidebarOpen(false)}
            onToggleArtifactPanel={handleToggleArtifactPanel}
            isArtifactPanelOpen={isArtifactPanelOpen}
            onOpenKnowledgeBase={() => setIsKnowledgeBaseOpen(true)}
            knowledgeEpisodeCount={knowledgeStats?.total_transcripts ?? null}
            essays={essays}
            currentEssayId={activeArtifact?.essay_id ?? null}
            onSelectEssay={handleSelectEssay}
            onOpenCreateEssay={() => setIsCreateEssayOpen(true)}
            artifacts={artifacts}
            currentArtifactId={activeArtifact?.artifact_id ?? null}
            onSelectArtifact={handleSelectArtifact}
            onOpenCreateArtifact={() => setIsCreateArtifactOpen(true)}
            theme={theme}
            onToggleTheme={handleToggleTheme}
          />
        )}

        {/* Left Resizing Divider (Desktop only, between Sidebar and Center Workspace) */}
        {isSidebarOpen && (
          <PanelDivider
            id="left-panel-divider"
            side="left"
            currentValue={sidebarWidth}
            min={MIN_SIDEBAR_WIDTH}
            max={MAX_SIDEBAR_WIDTH}
            onResize={handleResizeSidebar}
            onResizeEnd={handleSidebarResizeEnd}
            ariaLabel="Resize sidebar panel"
          />
        )}

        {/* Mobile backdrop overlay */}
        {mobileSidebarOpen && (
          <div
            className="sidebar-backdrop"
            onClick={() => setMobileSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Center Panel: Conversation Workspace */}
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
              <button
                type="button"
                className={`workspace-artifact-btn ${isArtifactPanelOpen ? 'active' : ''}`}
                onClick={handleToggleArtifactPanel}
                title={isArtifactPanelOpen ? 'Hide Artifact Panel' : 'Show Artifact Panel'}
              >
                <FileText size={15} aria-hidden="true" />
                <span>{isArtifactPanelOpen ? 'Hide Artifacts' : 'Artifacts'}</span>
              </button>

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

          {/* Message Stream */}
          <div className="workspace-messages-pane">
            {isLoadingMessages ? (
              <div className="messages-loading-state">
                <div className="loader-spinner" aria-hidden="true" />
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

          {/* Message Composer */}
          <div className="workspace-composer-pane">
            <Composer
              onSendMessage={handleSendMessage}
              isSubmitting={isSubmitting}
              disabled={isLoadingMessages}
              presetText={presetPrompt}
            />
          </div>
        </main>

        {/* Right Resizing Divider (Desktop only, between Center Workspace and Artifact Viewer) */}
        {isArtifactPanelOpen && (
          <PanelDivider
            id="right-panel-divider"
            side="right"
            currentValue={artifactWidth}
            min={MIN_ARTIFACT_WIDTH}
            max={MAX_ARTIFACT_WIDTH}
            onResize={handleResizeArtifact}
            onResizeEnd={handleArtifactResizeEnd}
            ariaLabel="Resize artifact panel"
          />
        )}

        {/* Right Panel: Artifact Viewer */}
        {isArtifactPanelOpen && (
          <div
            className="artifact-panel-wrapper"
            style={{ width: `${artifactWidth}px`, flexShrink: 0 }}
          >
            <ArtifactViewer
              isOpen={isArtifactPanelOpen}
              onClose={() => setIsArtifactPanelOpen(false)}
              artifact={activeArtifact}
              isGenerating={isGeneratingStatus(activeArtifact?.generation_status)}
              isPollingTimedOut={isPollingTimedOut}
              onRefreshStatus={handleRefreshActiveArtifact}
              onOpenCreateEssay={() => setIsCreateEssayOpen(true)}
              onOpenCreateArtifact={() => setIsCreateArtifactOpen(true)}
              onRetryGeneration={handleRetryGeneration}
            />
          </div>
        )}
      </div>

      {/* Knowledge Base Info Dialog */}
      <KnowledgeBaseModal
        isOpen={isKnowledgeBaseOpen}
        onClose={() => setIsKnowledgeBaseOpen(false)}
      />

      {/* Create Ship 30 Essay Floating Dialog */}
      <CreateEssayModal
        isOpen={isCreateEssayOpen}
        onClose={() => setIsCreateEssayOpen(false)}
        onSubmit={handleCreateEssaySubmit}
        currentProvider={selectedProvider}
        currentModel={status?.active_model || 'qwen2.5:1.5b'}
        isSubmitting={isSubmittingEssay}
      />

      {/* Create Generic Artifact Floating Dialog */}
      <CreateArtifactModal
        isOpen={isCreateArtifactOpen}
        onClose={() => setIsCreateArtifactOpen(false)}
        onSubmit={handleCreateArtifactSubmit}
        currentProvider={selectedProvider}
        currentModel={status?.active_model || 'qwen2.5:1.5b'}
        isSubmitting={isSubmittingArtifact}
      />
    </div>
  );
}
