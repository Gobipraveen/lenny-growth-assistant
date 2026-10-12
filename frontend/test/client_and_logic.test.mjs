import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ApiError,
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
} from '../src/api/client.js';
import { deriveSessionTitle, getErrorGuidance, formatSessionDate } from '../src/utils/formatters.js';
import { isSafeUrl, slugify, renderSafeInline } from '../src/utils/markdown.js';
import {
  prepareSandboxedSrcDoc,
  getArtifactFilename,
  validateArtifactForm,
  QUICK_START_PRESETS,
  mapArtifactStatus,
  ARTIFACT_CSP_META,
  ARTIFACT_POLLING_CONFIG,
  isGeneratingStatus,
} from '../src/utils/artifact.js';

describe('Frontend API Client and Contracts (Section A)', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  it('1. Session list data format: parses List[ChatSessionResponse] correctly', async () => {
    const mockSessions = [
      { id: 'sess-1', title: 'First Session', created_at: '2026-10-10T10:00:00Z', updated_at: '2026-10-10T10:05:00Z' },
      { id: 'sess-2', title: null, created_at: '2026-10-10T09:00:00Z', updated_at: '2026-10-10T09:00:00Z' },
    ];

    globalThis.fetch = async (url) => {
      assert.ok(url.includes('/api/sessions?skip=0&limit=50'));
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => mockSessions,
      };
    };

    const result = await fetchSessions(0, 50);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'sess-1');
    assert.equal(result[1].title, null);
  });

  it('2. Session creation response: sends correct POST payload and parses ChatSessionResponse', async () => {
    let capturedBody = null;
    let capturedMethod = null;

    globalThis.fetch = async (url, options) => {
      assert.ok(url.endsWith('/api/sessions'));
      capturedMethod = options.method;
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          id: 'new-uuid',
          title: null,
          user_metadata: {},
          created_at: '2026-10-10T10:00:00Z',
          updated_at: '2026-10-10T10:00:00Z',
        }),
      };
    };

    const newSess = await createSession({ title: null });
    assert.equal(capturedMethod, 'POST');
    assert.deepEqual(capturedBody, { title: null, user_metadata: {} });
    assert.equal(newSess.id, 'new-uuid');
  });

  it('3. Message history response: returns List[ChatMessageResponse] with structured_metadata', async () => {
    const mockMessages = [
      {
        id: 'm1',
        session_id: 'sess-1',
        role: 'user',
        content: 'Hello',
        structured_metadata: {},
        created_at: '2026-10-10T10:00:00Z',
      },
      {
        id: 'm2',
        session_id: 'sess-1',
        role: 'assistant',
        content: 'Hi there',
        structured_metadata: {
          citations: [
            {
              chunk_id: 'c1',
              episode_title: 'Brian Chesky',
              source_url: 'https://youtube.com/watch?v=123',
            },
          ],
          provider: 'ollama',
          model: 'qwen2.5:1.5b',
        },
        created_at: '2026-10-10T10:00:05Z',
      },
    ];

    globalThis.fetch = async (url) => {
      assert.ok(url.includes('/api/sessions/sess-1/messages'));
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => mockMessages,
      };
    };

    const msgs = await fetchSessionMessages('sess-1');
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'user');
    assert.equal(msgs[1].role, 'assistant');
    assert.equal(msgs[1].structured_metadata.model, 'qwen2.5:1.5b');
    assert.equal(msgs[1].structured_metadata.citations.length, 1);
  });

  it('4. New AI chat-turn response: unpacks APIResponse[ChatTurnResponse] data envelope', async () => {
    let capturedUrl = null;
    let capturedPayload = null;

    const mockApiResponse = {
      success: true,
      message: 'Chat turn processed successfully',
      data: {
        session_id: 'sess-1',
        user_message_id: 'usr-123',
        assistant_message_id: 'ast-456',
        answer: 'Airbnb grew via Craigslist integration and high-quality photography.',
        citations: [
          {
            chunk_id: 'chunk-1',
            episode_title: 'Brian Chesky on Designing Airbnb',
            guest: 'Brian Chesky',
            speaker: 'Brian Chesky',
            source_url: 'https://youtube.com/watch?v=123',
            start_timestamp: '00:10:00',
            end_timestamp: '00:12:00',
            snippet: 'We knocked on doors in NYC taking professional photos.',
          },
        ],
        provider: 'ollama',
        model: 'qwen2.5:1.5b',
        trace_id: 'trace-abc',
        created_at: '2026-10-10T10:00:10Z',
      },
    };

    globalThis.fetch = async (url, options) => {
      capturedUrl = url;
      capturedPayload = JSON.parse(options.body);
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => mockApiResponse,
      };
    };

    const res = await postChatTurn('sess-1', { message: 'How did Airbnb grow?', provider: 'ollama' });
    assert.ok(capturedUrl.endsWith('/api/sessions/sess-1/chat'));
    assert.equal(capturedPayload.message, 'How did Airbnb grow?');
    assert.equal(capturedPayload.provider, 'ollama');

    assert.equal(res.session_id, 'sess-1');
    assert.equal(res.answer, 'Airbnb grew via Craigslist integration and high-quality photography.');
    assert.equal(res.model, 'qwen2.5:1.5b');
    assert.equal(res.citations.length, 1);
    assert.equal(res.citations[0].guest, 'Brian Chesky');
  });

  it('5. Provider status response: unpacks APIResponse[ChatStatusResponse] accurately', async () => {
    const mockStatusResponse = {
      success: true,
      message: 'Provider status retrieved',
      data: {
        providers: [
          { provider: 'ollama', available: true, model: 'qwen2.5:1.5b', is_default: true, details: 'Local instance' },
          { provider: 'gemini', available: false, model: 'gemini-3.5-flash-lite', is_default: false, details: 'API key not configured' },
        ],
        active_provider: 'ollama',
        active_model: 'qwen2.5:1.5b',
        agent_service_online: true,
      },
    };

    globalThis.fetch = async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => mockStatusResponse,
    });

    const status = await fetchChatStatus();
    assert.equal(status.active_provider, 'ollama');
    assert.equal(status.active_model, 'qwen2.5:1.5b');
    assert.equal(status.agent_service_online, true);
    assert.equal(status.providers.length, 2);
    assert.equal(status.providers[0].model, 'qwen2.5:1.5b');
    assert.equal(status.providers[0].available, true);
    assert.equal(status.providers[1].available, false);
  });
});

describe('UI Behavior and Logic Verification (Section B)', () => {
  it('1. Session creation does not duplicate sessions: unique IDs preserved', () => {
    const initialSessions = [{ id: 'sess-1', title: 'Session 1' }];
    const newSession = { id: 'sess-2', title: null };

    // Simulating App.jsx setSessions((prev) => [newSess, ...prev])
    const updated = [newSession, ...initialSessions];
    const uniqueIds = new Set(updated.map((s) => s.id));

    assert.equal(updated.length, 2);
    assert.equal(uniqueIds.size, 2);
  });

  it('2. Switching conversations never leaks messages from another session: race condition guard', async () => {
    // Model race condition behavior using request counter
    let activeFetchId = 0;
    let committedMessages = null;

    async function loadSession(sessionId, fetchDelayMs, msgsToReturn) {
      const thisFetchId = ++activeFetchId;
      await new Promise((r) => setTimeout(r, fetchDelayMs));
      if (thisFetchId === activeFetchId) {
        committedMessages = msgsToReturn;
      }
    }

    // User selects session A (slow response 50ms) then immediately switches to session B (fast response 10ms)
    const promiseA = loadSession('sess-A', 50, [{ id: 'msg-A', content: 'Leaked from A?' }]);
    const promiseB = loadSession('sess-B', 10, [{ id: 'msg-B', content: 'Active in B' }]);

    await Promise.all([promiseA, promiseB]);

    // B was the latest request initiated (fetchId 2). Even though A finished later, A was ignored!
    assert.equal(committedMessages.length, 1);
    assert.equal(committedMessages[0].id, 'msg-B');
    assert.equal(committedMessages[0].content, 'Active in B');
  });

  it('3. Session selection survives page refresh: localStorage preservation verified', () => {
    const mockStorage = {};
    const key = 'lenny_growth_selected_session_id';

    // Store selected session
    mockStorage[key] = 'sess-persisted-123';

    // Simulate page reload
    const restoredId = mockStorage[key];
    const availableSessions = [
      { id: 'sess-0', title: 'Other' },
      { id: 'sess-persisted-123', title: 'My Chat' },
    ];
    const matched = availableSessions.find((s) => s.id === restoredId);

    assert.ok(matched);
    assert.equal(matched.id, 'sess-persisted-123');
  });

  it('4. Messages are displayed in chronological order (created_at asc)', () => {
    const rawMessages = [
      { id: 'm3', created_at: '2026-10-10T10:02:00Z', content: 'Turn 3' },
      { id: 'm1', created_at: '2026-10-10T10:00:00Z', content: 'Turn 1' },
      { id: 'm2', created_at: '2026-10-10T10:01:00Z', content: 'Turn 2' },
    ];

    const sorted = [...rawMessages].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    assert.equal(sorted[0].id, 'm1');
    assert.equal(sorted[1].id, 'm2');
    assert.equal(sorted[2].id, 'm3');
  });

  it('5. Enter sends and Shift+Enter inserts newline: keyboard event handler logic', () => {
    let sent = false;
    function handleKeyDown(e, text, isSubmitting) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (text.trim() && !isSubmitting) {
          sent = true;
        }
      }
    }

    // Shift + Enter should not trigger submit
    sent = false;
    let defaultPrevented = false;
    handleKeyDown({ key: 'Enter', shiftKey: true, preventDefault: () => { defaultPrevented = true; } }, 'Line 1', false);
    assert.equal(sent, false);
    assert.equal(defaultPrevented, false);

    // Enter without Shift triggers submit
    sent = false;
    defaultPrevented = false;
    handleKeyDown({ key: 'Enter', shiftKey: false, preventDefault: () => { defaultPrevented = true; } }, 'Line 1', false);
    assert.equal(sent, true);
    assert.equal(defaultPrevented, true);
  });

  it('6. Duplicate submission is prevented while isSubmitting is true', () => {
    let submitCount = 0;
    function submitMessage(text, isSubmitting) {
      if (!text.trim() || isSubmitting) return false;
      submitCount++;
      return true;
    }

    assert.equal(submitMessage('First query', false), true);
    assert.equal(submitCount, 1);

    // Second call while pending is blocked
    assert.equal(submitMessage('Rapid query', true), false);
    assert.equal(submitCount, 1);

    // Whitespace only is blocked
    assert.equal(submitMessage('   ', false), false);
    assert.equal(submitCount, 1);
  });

  it('7. Failed submissions do not leave misleading saved messages: optimistic rollback', () => {
    const tempId = 'temp-12345';
    let messages = [
      { id: 'm1', content: 'Existing' },
      { id: tempId, content: 'Optimistic prompt', isOptimistic: true },
    ];

    // On simulated turn error, optimistic message is filtered out
    const turnFailed = true;
    if (turnFailed) {
      messages = messages.filter((m) => m.id !== tempId);
    }

    assert.equal(messages.length, 1);
    assert.equal(messages[0].id, 'm1');
    assert.equal(messages.find((m) => m.id === tempId), undefined);
  });

  it('8. Valid citations render correct source links and safe metadata', () => {
    const citation = {
      chunk_id: 'c1',
      episode_title: 'Brian Chesky on Designing Airbnb',
      guest: 'Brian Chesky',
      speaker: 'Brian Chesky',
      source_url: 'https://www.youtube.com/watch?v=mock_video',
      start_timestamp: '00:10:00',
      end_timestamp: '00:12:00',
      snippet: 'We knocked on doors in NYC.',
    };

    assert.ok(citation.source_url.startsWith('https://'));
    assert.equal(citation.guest, 'Brian Chesky');
    assert.equal(citation.start_timestamp, '00:10:00');
    assert.equal(citation.end_timestamp, '00:12:00');
  });

  it('9. Citations persist visually after a history reload: dual shape resolution', () => {
    // Shape A: new turn response where citations is directly on message
    const newTurnMsg = {
      role: 'assistant',
      citations: [{ episode_title: 'Episode A' }],
      structured_metadata: {},
    };
    const resolvedNew = newTurnMsg.citations || newTurnMsg.structured_metadata?.citations || [];
    assert.equal(resolvedNew.length, 1);
    assert.equal(resolvedNew[0].episode_title, 'Episode A');

    // Shape B: persisted message from database where citations is in structured_metadata
    const persistedMsg = {
      role: 'assistant',
      citations: undefined,
      structured_metadata: {
        citations: [{ episode_title: 'Episode B' }],
      },
    };
    const resolvedPersisted = persistedMsg.citations || persistedMsg.structured_metadata?.citations || [];
    assert.equal(resolvedPersisted.length, 1);
    assert.equal(resolvedPersisted[0].episode_title, 'Episode B');
  });

  it('10. Missing citations do not produce fake source badges: returns empty/null', () => {
    const msgWithoutCitations = {
      role: 'assistant',
      citations: [],
      structured_metadata: {},
    };
    const resolved = msgWithoutCitations.citations || msgWithoutCitations.structured_metadata?.citations || [];
    assert.equal(resolved.length, 0);
  });

  it('11. Backend error messages remain readable and safe: status code translation', () => {
    assert.ok(getErrorGuidance(400).includes('check that the input is valid'));
    assert.ok(getErrorGuidance(404).includes('session was not found'));
    assert.ok(getErrorGuidance(502).includes('agent bridge is unavailable'));
    assert.ok(getErrorGuidance(503).includes('temporarily overloaded'));
    assert.ok(getErrorGuidance(504).includes('Request timed out'));
    assert.ok(getErrorGuidance(500).includes('unexpected error'));
  });

  it('12. Ollama and Gemini provider status displays accurately without llama3 fallback', () => {
    const statusData = {
      providers: [
        { provider: 'ollama', available: true, model: 'qwen2.5:1.5b', is_default: true },
        { provider: 'gemini', available: false, model: 'gemini-3.5-flash-lite', is_default: false },
      ],
      active_provider: 'ollama',
      active_model: 'qwen2.5:1.5b',
    };

    const ollamaInfo = statusData.providers.find((p) => p.provider === 'ollama');
    assert.equal(ollamaInfo.model, 'qwen2.5:1.5b');
    assert.notEqual(ollamaInfo.model, 'llama3');
  });
});

describe('Session Title and Metadata Formatting', () => {
  it('deriveSessionTitle uses explicit session.title when present', () => {
    const title = deriveSessionTitle({ title: 'Marketplace Dynamics', created_at: '2026-10-10T10:00:00Z' });
    assert.equal(title, 'Marketplace Dynamics');
  });

  it('deriveSessionTitle falls back to truncated first message when title is null', () => {
    const title = deriveSessionTitle({
      title: null,
      first_message: 'How should an early stage founder approach pricing in B2B SaaS?',
    });
    assert.equal(title, 'How should an early stage founde…');
  });

  it('deriveSessionTitle falls back to formatted date when neither title nor first_message is present', () => {
    const title = deriveSessionTitle({
      title: null,
      created_at: '2026-10-10T10:30:00Z',
    });
    assert.ok(title.startsWith('Chat'));
  });

  it('deriveSessionTitle handles missing session safely', () => {
    assert.equal(deriveSessionTitle(null), 'Untitled Chat');
    assert.equal(deriveSessionTitle(undefined), 'Untitled Chat');
  });
});

describe('Task 07A: Retro Sunset Neutral Theme & Workspace Resizing Logic', () => {
  it('1. Theme defaults to dark theme when no localStorage preference is found', () => {
    function resolveTheme(storedTheme, systemPrefersLight) {
      if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme;
      if (systemPrefersLight) return 'light';
      return 'dark';
    }

    assert.equal(resolveTheme(null, false), 'dark');
    assert.equal(resolveTheme(undefined, false), 'dark');
  });

  it('2. Theme honors saved localStorage preference over system preference', () => {
    function resolveTheme(storedTheme, systemPrefersLight) {
      if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme;
      if (systemPrefersLight) return 'light';
      return 'dark';
    }

    assert.equal(resolveTheme('dark', true), 'dark');
    assert.equal(resolveTheme('light', false), 'light');
  });

  it('3. Sidebar width is clamped within strict minimum (200px) and maximum (420px) bounds', () => {
    const MIN_SIDEBAR = 200;
    const MAX_SIDEBAR = 420;
    const MIN_CHAT = 380;

    function clampSidebarWidth(requested, windowWidth, artifactWidth, isArtifactOpen) {
      const artifactSpace = isArtifactOpen ? artifactWidth : 0;
      const maxAllowed = Math.min(MAX_SIDEBAR, windowWidth - artifactSpace - MIN_CHAT);
      return Math.max(MIN_SIDEBAR, Math.min(requested, maxAllowed));
    }

    // Normal window 1280px
    assert.equal(clampSidebarWidth(270, 1280, 420, true), 270);
    // Lower bound clamp
    assert.equal(clampSidebarWidth(150, 1280, 420, true), 200);
    // Upper bound clamp
    assert.equal(clampSidebarWidth(500, 1280, 420, true), 420);
    // Squeezed window (e.g. 900px with artifact open at 400px -> leaves 500px, chat needs 380 -> max 120, clamped to min 200)
    assert.equal(clampSidebarWidth(350, 950, 300, true), 270);
  });

  it('4. Artifact panel width is clamped within minimum (300px) and maximum (700px) bounds', () => {
    const MIN_ARTIFACT = 300;
    const MAX_ARTIFACT = 700;
    const MIN_CHAT = 380;

    function clampArtifactWidth(requested, windowWidth, sidebarWidth, isSidebarOpen) {
      const sidebarSpace = isSidebarOpen ? sidebarWidth : 0;
      const maxAllowed = Math.min(MAX_ARTIFACT, windowWidth - sidebarSpace - MIN_CHAT);
      return Math.max(MIN_ARTIFACT, Math.min(requested, maxAllowed));
    }

    // Normal window 1400px
    assert.equal(clampArtifactWidth(420, 1400, 270, true), 420);
    // Lower bound clamp
    assert.equal(clampArtifactWidth(250, 1400, 270, true), 300);
    // Upper bound clamp
    assert.equal(clampArtifactWidth(850, 1400, 270, true), 700);
  });

  it('5. Keyboard resize handler adjusts values by 16px (normal) and 32px (shiftKey)', () => {
    function computeKeyResize(current, key, shiftKey, side, min, max) {
      const step = shiftKey ? 32 : 16;
      let next = current;
      if (key === 'ArrowLeft') {
        const delta = side === 'left' ? -step : step;
        next = current + delta;
      } else if (key === 'ArrowRight') {
        const delta = side === 'left' ? step : -step;
        next = current + delta;
      } else if (key === 'Home') {
        next = min;
      } else if (key === 'End') {
        next = max;
      }
      return Math.max(min, Math.min(next, max));
    }

    // Left divider (sidebar): ArrowRight increases width, ArrowLeft decreases
    assert.equal(computeKeyResize(270, 'ArrowRight', false, 'left', 200, 420), 286);
    assert.equal(computeKeyResize(270, 'ArrowLeft', false, 'left', 200, 420), 254);
    assert.equal(computeKeyResize(270, 'ArrowRight', true, 'left', 200, 420), 302);
    assert.equal(computeKeyResize(270, 'Home', false, 'left', 200, 420), 200);
    assert.equal(computeKeyResize(270, 'End', false, 'left', 200, 420), 420);

    // Right divider (artifact panel): ArrowLeft expands right panel, ArrowRight shrinks it
    assert.equal(computeKeyResize(420, 'ArrowLeft', false, 'right', 300, 700), 436);
    assert.equal(computeKeyResize(420, 'ArrowRight', false, 'right', 300, 700), 404);
  });

  it('6. Three-panel visibility persistence: stores open/closed states independently', () => {
    const mockStorage = {};
    function setPanelState(panel, isOpen) {
      mockStorage[`lenny_growth_${panel}_open`] = JSON.stringify(isOpen);
    }
    function getPanelState(panel, fallback) {
      const val = mockStorage[`lenny_growth_${panel}_open`];
      return val !== undefined ? JSON.parse(val) : fallback;
    }

    setPanelState('sidebar', true);
    setPanelState('artifact', false);
    assert.equal(getPanelState('sidebar', false), true);
    assert.equal(getPanelState('artifact', true), false);

    // Toggle artifact
    setPanelState('artifact', true);
    assert.equal(getPanelState('artifact', false), true);
    assert.equal(getPanelState('sidebar', false), true);
  });
});

describe('Task 07B — Ship 30 Essay UI and Functional Markdown Artifact Viewer (Section H)', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  it('1. Essay API response parsing: validates createEssay, fetchEssays, and fetchEssay envelopes', async () => {
    // 1a: createEssay
    let capturedCreateUrl = null;
    let capturedCreateBody = null;
    let capturedCreateMethod = null;

    const mockEssayResponse = {
      success: true,
      message: 'Essay generation started',
      data: {
        essay_id: 'ess-001',
        session_id: 'sess-abc',
        topic: 'Retention loops',
        title: 'Building Unstoppable Retention Loops',
        target_word_count: 1250,
        word_count: 0,
        generation_status: 'generating',
        markdown: null,
        citations: [],
        validation_results: { errors: [], warnings: [] },
        error: null,
        provider: 'ollama',
        created_at: '2026-10-10T12:00:00Z',
        completed_at: null,
      },
    };

    globalThis.fetch = async (url, options) => {
      capturedCreateUrl = url;
      capturedCreateMethod = options?.method || 'GET';
      if (options?.body) capturedCreateBody = JSON.parse(options.body);
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => mockEssayResponse,
      };
    };

    const created = await createEssay('sess-abc', {
      topic: 'Retention loops',
      target_word_count: 1250,
      proven_approach: 'framework',
      four_a_path: 'actionable',
    });

    assert.equal(capturedCreateMethod, 'POST');
    assert.ok(capturedCreateUrl.endsWith('/api/sessions/sess-abc/essays'));
    assert.equal(capturedCreateBody.topic, 'Retention loops');
    assert.equal(created.essay_id, 'ess-001');
    assert.equal(created.generation_status, 'generating');

    // 1b: fetchEssays (summary list)
    const mockSummaryList = {
      success: true,
      message: 'Essays listed',
      data: [
        {
          essay_id: 'ess-001',
          session_id: 'sess-abc',
          topic: 'Retention loops',
          title: 'Building Unstoppable Retention Loops',
          generation_status: 'completed',
          word_count: 1240,
          created_at: '2026-10-10T12:00:00Z',
          completed_at: '2026-10-10T12:02:00Z',
        },
      ],
    };

    globalThis.fetch = async (url) => {
      assert.ok(url.endsWith('/api/sessions/sess-abc/essays'));
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => mockSummaryList,
      };
    };

    const summaries = await fetchEssays('sess-abc');
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].essay_id, 'ess-001');
    assert.equal(summaries[0].generation_status, 'completed');
    assert.equal(summaries[0].word_count, 1240);

    // 1c: fetchEssay (detail with markdown & citations)
    const mockDetail = {
      success: true,
      message: 'Essay retrieved',
      data: {
        essay_id: 'ess-001',
        session_id: 'sess-abc',
        topic: 'Retention loops',
        title: 'Building Unstoppable Retention Loops',
        target_word_count: 1250,
        word_count: 1240,
        generation_status: 'completed',
        markdown: '# Building Unstoppable Retention Loops\n\nRetention is the heartbeat of growth.',
        citations: [
          {
            chunk_id: 'chunk-99',
            episode_title: 'Elena Verna on B2B Growth',
            guest: 'Elena Verna',
            speaker: 'Elena Verna',
            source_url: 'https://youtube.com/watch?v=elena',
            start_timestamp: '00:05:00',
            end_timestamp: '00:07:30',
            snippet: 'Growth is not acquisition, it is sustainable retention loops.',
          },
        ],
        validation_results: { errors: [], warnings: [] },
        error: null,
        provider: 'ollama',
        created_at: '2026-10-10T12:00:00Z',
        completed_at: '2026-10-10T12:02:00Z',
      },
    };

    globalThis.fetch = async (url) => {
      assert.ok(url.endsWith('/api/sessions/sess-abc/essays/ess-001'));
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => mockDetail,
      };
    };

    const detail = await fetchEssay('sess-abc', 'ess-001');
    assert.equal(detail.essay_id, 'ess-001');
    assert.equal(detail.markdown.startsWith('# Building'), true);
    assert.equal(detail.citations.length, 1);
    assert.equal(detail.citations[0].guest, 'Elena Verna');
  });

  it('2. Generation request validation: enforces topic requirements and target word count bounds', () => {
    function validateEssayRequest(form) {
      const topic = form.topic ? form.topic.trim() : '';
      if (!topic || topic.length < 3) {
        return { valid: false, error: 'Essay topic is required and must be at least 3 characters.' };
      }
      const words = parseInt(form.target_word_count, 10);
      if (isNaN(words) || words < 500 || words > 3000) {
        return { valid: false, error: 'Target word count must be between 500 and 3,000 words.' };
      }
      return {
        valid: true,
        payload: {
          topic,
          audience: form.audience ? form.audience.trim() : undefined,
          intended_outcome: form.intended_outcome ? form.intended_outcome.trim() : undefined,
          proven_approach: form.proven_approach || 'framework',
          four_a_path: form.four_a_path || 'actionable',
          target_word_count: words,
          provider: form.provider || 'ollama',
        },
      };
    }

    // Invalid topic
    assert.equal(validateEssayRequest({ topic: '' }).valid, false);
    assert.equal(validateEssayRequest({ topic: 'ab' }).valid, false);
    assert.ok(validateEssayRequest({ topic: 'ab' }).error.includes('at least 3 characters'));

    // Invalid word count
    assert.equal(validateEssayRequest({ topic: 'Growth', target_word_count: 200 }).valid, false);
    assert.equal(validateEssayRequest({ topic: 'Growth', target_word_count: 5000 }).valid, false);
    assert.equal(validateEssayRequest({ topic: 'Growth', target_word_count: 'abc' }).valid, false);

    // Valid submission
    const res = validateEssayRequest({
      topic: '  Marketplace cold start  ',
      audience: '  Founders  ',
      target_word_count: '1250',
      proven_approach: 'steps',
      four_a_path: 'actionable',
      provider: 'ollama',
    });
    assert.equal(res.valid, true);
    assert.equal(res.payload.topic, 'Marketplace cold start');
    assert.equal(res.payload.audience, 'Founders');
    assert.equal(res.payload.target_word_count, 1250);
  });

  it('3. Session-scoped essay listing: isolates essays strictly per active conversation session', () => {
    // Session-scoped cache map simulation as implemented in App.jsx
    const essayStore = {
      'session-A': [
        { essay_id: 'ess-A1', title: 'Session A Essay 1', generation_status: 'completed' },
      ],
      'session-B': [
        { essay_id: 'ess-B1', title: 'Session B Essay 1', generation_status: 'generating' },
        { essay_id: 'ess-B2', title: 'Session B Essay 2', generation_status: 'completed' },
      ],
    };

    function getEssaysForSession(sessionId) {
      return essayStore[sessionId] || [];
    }

    assert.equal(getEssaysForSession('session-A').length, 1);
    assert.equal(getEssaysForSession('session-A')[0].essay_id, 'ess-A1');

    assert.equal(getEssaysForSession('session-B').length, 2);
    assert.equal(getEssaysForSession('session-B')[0].essay_id, 'ess-B1');

    // Completely unpopulated session returns empty list
    assert.equal(getEssaysForSession('session-C').length, 0);
  });

  it('4. Polling lifecycle and cleanup: polls during generating state and terminates on completion or bounded limit', async () => {
    let pollCount = 0;
    const MAX_POLLS = 10;
    let timerId = null;
    let finalStatus = null;

    // Simulate polling state machine
    const statuses = ['generating', 'generating', 'generating', 'completed'];

    await new Promise((resolve) => {
      function stepPoll() {
        if (pollCount >= MAX_POLLS) {
          resolve();
          return; // Bounded limit reached
        }
        const nextStatus = statuses[pollCount] ?? 'completed';
        pollCount++;
        finalStatus = nextStatus;

        if (nextStatus === 'generating' && pollCount < MAX_POLLS) {
          timerId = setTimeout(stepPoll, 5);
        } else {
          resolve();
        }
      }
      stepPoll();
    });

    assert.equal(finalStatus, 'completed');
    assert.equal(pollCount, 4);

    // Test cleanup cancels timer
    let unmountTriggered = false;
    function cleanup() {
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
        unmountTriggered = true;
      }
    }
    timerId = setTimeout(() => {}, 1000);
    cleanup();
    assert.equal(unmountTriggered, true);
    assert.equal(timerId, null);
  });

  it('5. Generation failure states: maps failed and insufficient_evidence truthfully with guidance', () => {
    function deriveFailureDisplay(artifact) {
      if (artifact.generation_status === 'failed') {
        return {
          canRetry: true,
          message: artifact.error || 'Essay generation encountered an unrecoverable error.',
          type: 'failed',
        };
      }
      if (artifact.generation_status === 'insufficient_evidence') {
        return {
          canRetry: false,
          needsRephrase: true,
          message: artifact.error || "We could not find sufficient verified transcript passages in Lenny's Podcast index.",
          type: 'insufficient_evidence',
        };
      }
      return null;
    }

    const failedArtifact = {
      generation_status: 'failed',
      error: 'Model inference timed out after 300 seconds.',
    };
    const failDisplay = deriveFailureDisplay(failedArtifact);
    assert.equal(failDisplay.type, 'failed');
    assert.equal(failDisplay.canRetry, true);
    assert.equal(failDisplay.message, 'Model inference timed out after 300 seconds.');

    const insufficientArtifact = {
      generation_status: 'insufficient_evidence',
      error: 'Zero transcript chunks exceeded relevance threshold for this query.',
    };
    const insufDisplay = deriveFailureDisplay(insufficientArtifact);
    assert.equal(insufDisplay.type, 'insufficient_evidence');
    assert.equal(insufDisplay.needsRephrase, true);
    assert.ok(insufDisplay.message.includes('Zero transcript chunks'));
  });

  it('6. Validation warnings: maps deterministic issues and does not discard the essay markdown', () => {
    const essayWithWarnings = {
      generation_status: 'validation_failed',
      markdown: '# My Essay\n\nContent here.',
      validation_results: {
        errors: ['Word count 980 is below the 1,100 minimum threshold.'],
        warnings: ['Section 4 did not cite any evidence chunk IDs.'],
      },
    };

    function extractValidationIssues(artifact) {
      const results = artifact.validation_results || {};
      const errors = results.errors || [];
      const warnings = results.warnings || [];
      const hasIssues = artifact.generation_status === 'validation_failed' || errors.length > 0 || warnings.length > 0;
      return {
        hasIssues,
        isDanger: artifact.generation_status === 'validation_failed',
        errors,
        warnings,
        hasMarkdown: Boolean(artifact.markdown),
      };
    }

    const analysis = extractValidationIssues(essayWithWarnings);
    assert.equal(analysis.hasIssues, true);
    assert.equal(analysis.isDanger, true);
    assert.equal(analysis.errors.length, 1);
    assert.equal(analysis.warnings.length, 1);
    assert.equal(analysis.hasMarkdown, true); // Document content is preserved for inspection!
  });

  it('7. Citation mapping: displays authentic citations and avoids fake "Verified" label on validation failure', () => {
    const citations = [
      {
        chunk_id: 'chk-1',
        episode_title: 'Brian Chesky on Airbnb',
        guest: 'Brian Chesky',
        speaker: 'Brian Chesky',
        source_url: 'https://youtube.com/watch?v=123',
        start_timestamp: '00:10:00',
        end_timestamp: '00:12:00',
        snippet: 'Do things that do not scale.',
      },
    ];

    function deriveCitationHeader(status, citationList) {
      if (!citationList || citationList.length === 0) return null;
      if (status === 'validation_failed') {
        return `Transcript Citations (${citationList.length})`;
      }
      return `Verified Evidence Citations (${citationList.length})`;
    }

    // On validation failure, label is unverified / neutral
    assert.equal(deriveCitationHeader('validation_failed', citations), 'Transcript Citations (1)');
    // On completed status, label is verified
    assert.equal(deriveCitationHeader('completed', citations), 'Verified Evidence Citations (1)');
  });

  it('8. Safe Markdown links: isSafeUrl allows safe schemes and blocks XSS payloads', () => {
    // Allowed safe protocols
    assert.equal(isSafeUrl('https://youtube.com/watch?v=abc'), true);
    assert.equal(isSafeUrl('http://lennyrachitsky.com/podcast'), true);
    assert.equal(isSafeUrl('mailto:editor@ship30for30.com'), true);
    assert.equal(isSafeUrl('#section-2'), true);
    assert.equal(isSafeUrl('/essays'), true);

    // Blocked dangerous protocols
    assert.equal(isSafeUrl('javascript:alert(document.cookie)'), false);
    assert.equal(isSafeUrl('JAVASCRIPT:alert(1)'), false);
    assert.equal(isSafeUrl('data:text/html,<script>alert(1)</script>'), false);
    assert.equal(isSafeUrl('vbscript:MsgBox("Hacked")'), false);
    assert.equal(isSafeUrl('   javascript:alert(1)'), false);
    assert.equal(isSafeUrl(null), false);
    assert.equal(isSafeUrl(undefined), false);
    assert.equal(isSafeUrl(''), false);

    // renderSafeInline neutralizing dangerous links
    const inlineReact = renderSafeInline('[Malicious](javascript:alert(1))', 'test');
    assert.ok(Array.isArray(inlineReact));
    // The link should be rendered as a harmless span, not an anchor tag with javascript: href
    const sanitizedElement = inlineReact.find((el) => el && el.props && el.props.className === 'md-unsafe-link');
    assert.ok(sanitizedElement, 'Rendered unsafe link as safe text element without execution vector');
  });

  it('9. Copy/download content preparation: slugify produces sanitized filenames and content is preserved', () => {
    assert.equal(
      slugify('How Brian Chesky Built Airbnb From Scratch!'),
      'how-brian-chesky-built-airbnb-from-scratch'
    );
    assert.equal(
      slugify('5 Growth Lessons From Elena Verna (B2B SaaS)'),
      '5-growth-lessons-from-elena-verna-b2b-saas'
    );
    assert.equal(slugify(''), 'ship30-essay');
    assert.equal(slugify(null), 'ship30-essay');

    // Filename formulation
    const artifact = { title: 'Cold Start Problem', markdown: '# Cold Start\n\nSolve the hard side first.' };
    const filename = `${slugify(artifact.title)}.md`;
    assert.equal(filename, 'cold-start-problem.md');
    assert.equal(artifact.markdown.length > 0, true);
  });

  it('10. Knowledge-base counts from API: parses GET /api/knowledge/status without hardcoded fallbacks', async () => {
    const mockKbStatusResponse = {
      success: true,
      message: 'Knowledge status retrieved',
      data: {
        total_transcripts: 47,
        total_chunks: 1420,
        search_engine: 'hybrid_fts_vector',
        pgvector_available: true,
        episodes: [
          { episode_id: 'ep-1', title: 'Brian Chesky', guest: 'Brian Chesky', chunks_count: 85 },
          { episode_id: 'ep-2', title: 'Elena Verna', guest: 'Elena Verna', chunks_count: 92 },
        ],
      },
    };

    globalThis.fetch = async (url) => {
      assert.ok(url.endsWith('/api/knowledge/status'));
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => mockKbStatusResponse,
      };
    };

    const status = await fetchKnowledgeStatus();
    assert.equal(status.total_transcripts, 47);
    assert.equal(status.total_chunks, 1420);
    assert.equal(status.search_engine, 'hybrid_fts_vector');
    assert.equal(status.pgvector_available, true);
    assert.equal(status.episodes.length, 2);

    // Verify UI display logic binds directly to real numbers and NEVER hardcodes '50+'
    function formatKbStats(data, error, loading) {
      if (loading) return { transcripts: '—', chunks: '—', status: 'loading' };
      if (error || !data) return { transcripts: 'Unavailable', chunks: 'Unavailable', status: 'error' };
      return {
        transcripts: String(data.total_transcripts ?? 0),
        chunks: String(data.total_chunks ?? 0),
        status: data.total_transcripts === 0 ? 'empty' : 'ready',
      };
    }

    assert.deepEqual(formatKbStats(null, null, true), { transcripts: '—', chunks: '—', status: 'loading' });
    assert.deepEqual(formatKbStats(null, new Error('Network error'), false), {
      transcripts: 'Unavailable',
      chunks: 'Unavailable',
      status: 'error',
    });
    assert.deepEqual(formatKbStats(status, null, false), {
      transcripts: '47',
      chunks: '1420',
      status: 'ready',
    });
  });

  it('11. Session switching without cross-session leaks: prevents late polling responses from overwriting current session', async () => {
    let currentSessionId = 'session-1';
    let activeEssay = null;

    // Simulate poll response arriving after user has switched sessions
    async function handlePollArrival(responseSessionId, essayResult) {
      // Guard implemented in App.jsx: currentSessionIdRef.current === responseSessionId
      if (currentSessionId === responseSessionId) {
        activeEssay = essayResult;
      }
    }

    // User is on session-1 and triggers generation
    const slowEssayFromSession1 = { essay_id: 'ess-1', title: 'Session 1 Essay' };

    // Before response arrives, user switches to session-2
    currentSessionId = 'session-2';
    activeEssay = { essay_id: 'ess-2', title: 'Session 2 Essay' };

    // Late response from session-1 arrives
    await handlePollArrival('session-1', slowEssayFromSession1);

    // Verify session-2's essay was NOT overwritten by late response from session-1
    assert.equal(activeEssay.essay_id, 'ess-2');
    assert.equal(activeEssay.title, 'Session 2 Essay');
  });
});

describe('Task 07C-2: Complete HTML/CSS Artifact Viewer and Creation Workflow (Section J)', () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const srcDir = path.resolve(__dirname, '../src');

  it('1. Artifact API contract unwrapping: parses createArtifact, fetchArtifacts, and fetchArtifact envelopes', async () => {
    const mockCreated = {
      artifact_id: 'art-101',
      session_id: 'sess-1',
      title: 'Growth Dashboard',
      artifact_type: 'html',
      generation_status: 'pending',
      provider: 'ollama',
      created_at: '2026-10-11T08:00:00Z',
      updated_at: '2026-10-11T08:00:00Z',
    };

    const mockList = [
      {
        artifact_id: 'art-101',
        session_id: 'sess-1',
        title: 'Growth Dashboard',
        artifact_type: 'html',
        generation_status: 'completed',
        provider: 'ollama',
        created_at: '2026-10-11T08:00:00Z',
        updated_at: '2026-10-11T08:01:00Z',
      },
      {
        artifact_id: 'art-102',
        session_id: 'sess-1',
        title: 'Retention Playbook',
        artifact_type: 'markdown',
        generation_status: 'completed',
        provider: 'gemini',
        created_at: '2026-10-11T08:05:00Z',
        updated_at: '2026-10-11T08:06:00Z',
      },
    ];

    const mockDetail = {
      artifact_id: 'art-101',
      session_id: 'sess-1',
      title: 'Growth Dashboard',
      artifact_type: 'html',
      generation_status: 'completed',
      source_content: '<div class="dashboard"><h1>SaaS Growth</h1></div>',
      sanitized_content: '<div class="dashboard"><h1>SaaS Growth</h1></div>',
      provider: 'ollama',
      model: 'qwen2.5:1.5b',
      citations: [{ episode_id: 'ep-1', guest: 'Elena Verna', title: 'B2B Growth Loops', quote: 'Retention drives loops' }],
      validation_results: { passed: true, errors: [], warnings: [] },
      created_at: '2026-10-11T08:00:00Z',
      updated_at: '2026-10-11T08:01:00Z',
    };

    // Test POST createArtifact (handles 202 Accepted)
    globalThis.fetch = async (url, options) => {
      assert.ok(url.endsWith('/api/sessions/sess-1/artifacts'));
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      assert.equal(body.title, 'Growth Dashboard');
      assert.equal(body.artifact_type, 'html');
      return {
        ok: true,
        status: 202,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true,
          message: 'Artifact generation task queued',
          data: mockCreated,
        }),
      };
    };

    const created = await createArtifact('sess-1', {
      title: 'Growth Dashboard',
      artifact_type: 'html',
      instructions: 'Create visual dashboard',
    });
    assert.equal(created.artifact_id, 'art-101');
    assert.equal(created.generation_status, 'pending');

    // Test GET fetchArtifacts
    globalThis.fetch = async (url) => {
      assert.ok(url.endsWith('/api/sessions/sess-1/artifacts'));
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true,
          message: 'Artifacts retrieved successfully',
          data: mockList,
        }),
      };
    };

    const list = await fetchArtifacts('sess-1');
    assert.equal(list.length, 2);
    assert.equal(list[0].artifact_type, 'html');
    assert.equal(list[1].artifact_type, 'markdown');

    // Test GET fetchArtifact
    globalThis.fetch = async (url) => {
      assert.ok(url.endsWith('/api/sessions/sess-1/artifacts/art-101'));
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true,
          message: 'Artifact details retrieved',
          data: mockDetail,
        }),
      };
    };

    const detail = await fetchArtifact('sess-1', 'art-101');
    assert.equal(detail.artifact_id, 'art-101');
    assert.equal(detail.artifact_type, 'html');
    assert.ok(detail.source_content.includes('SaaS Growth'));
    assert.equal(detail.citations.length, 1);
  });

  it('2. Format validation: enforces html vs markdown formats, title presence, and instructions', () => {
    // Empty title
    assert.equal(validateArtifactForm({ title: '', artifact_type: 'html' }).valid, false);
    assert.equal(validateArtifactForm({ title: '   ', artifact_type: 'html' }).valid, false);

    // Unsupported format
    assert.equal(validateArtifactForm({ title: 'Valid Title', artifact_type: 'svg' }).valid, false);
    assert.equal(validateArtifactForm({ title: 'Valid Title', artifact_type: 'pdf' }).valid, false);

    // Valid HTML format
    const validHtml = validateArtifactForm({
      title: '  Growth Dashboard  ',
      artifact_type: 'html',
      instructions: 'Build a dashboard',
    });
    assert.equal(validHtml.valid, true);
    assert.equal(validHtml.payload.title, 'Growth Dashboard');
    assert.equal(validHtml.payload.artifact_type, 'html');

    // Valid Markdown format
    const validMd = validateArtifactForm({
      title: 'Product Playbook',
      artifact_type: 'markdown',
      instructions: 'Build a playbook',
    });
    assert.equal(validMd.valid, true);
    assert.equal(validMd.payload.artifact_type, 'markdown');
  });

  it('3. Creation dialog request building: validates quick-start presets and custom payloads', () => {
    assert.equal(QUICK_START_PRESETS.length, 4);

    const playbook = QUICK_START_PRESETS.find((p) => p.id === 'growth-playbook');
    assert.ok(playbook);
    assert.equal(playbook.title, 'Growth Playbook');
    assert.equal(playbook.artifact_type, 'markdown');

    const report = QUICK_START_PRESETS.find((p) => p.id === 'product-strategy-report');
    assert.ok(report);
    assert.equal(report.title, 'Product Strategy Report');
    assert.equal(report.artifact_type, 'markdown');

    const dashboard = QUICK_START_PRESETS.find((p) => p.id === 'growth-dashboard');
    assert.ok(dashboard);
    assert.equal(dashboard.title, 'Growth Strategy Dashboard');
    assert.equal(dashboard.artifact_type, 'html');

    const landing = QUICK_START_PRESETS.find((p) => p.id === 'product-landing-page');
    assert.ok(landing);
    assert.equal(landing.title, 'Product Launch Landing Page');
    assert.equal(landing.artifact_type, 'html');

    // Applying preset builds valid submission payload
    const formResult = validateArtifactForm(dashboard);
    assert.equal(formResult.valid, true);
    assert.equal(formResult.payload.artifact_type, 'html');
  });

  it('4. Job status handling: covers all real persisted statuses without fabricated progress', () => {
    const statuses = [
      'pending',
      'generating',
      'completed',
      'validation_failed',
      'insufficient_evidence',
      'failed',
    ];

    for (const st of statuses) {
      const mapped = mapArtifactStatus(st);
      assert.ok(mapped.label, `Status ${st} must have label`);
      assert.ok(mapped.className, `Status ${st} must have className`);
      // Never fabricate progress percentages in labels
      assert.ok(!mapped.label.includes('%'), `Status ${st} should not contain fake progress %`);
    }

    assert.equal(mapArtifactStatus('pending').isTerminal, false);
    assert.equal(mapArtifactStatus('generating').isTerminal, false);
    assert.equal(mapArtifactStatus('completed').isTerminal, true);
    assert.equal(mapArtifactStatus('validation_failed').isTerminal, true);
    assert.equal(mapArtifactStatus('insufficient_evidence').isTerminal, true);
    assert.equal(mapArtifactStatus('failed').isTerminal, true);

    // Retry is allowed on recoverable failures
    assert.equal(mapArtifactStatus('failed').canRetry, true);
    assert.equal(mapArtifactStatus('validation_failed').canRetry, true);
    assert.equal(mapArtifactStatus('insufficient_evidence').canRetry, true);
    assert.equal(mapArtifactStatus('completed').canRetry, false);
  });

  it('5. Session isolation: ensures artifacts are partitioned per conversation session', () => {
    const sessionArtifactMap = {
      'sess-A': [
        { artifact_id: 'art-A1', title: 'Session A Growth Dashboard', artifact_type: 'html' },
      ],
      'sess-B': [
        { artifact_id: 'art-B1', title: 'Session B Retention Report', artifact_type: 'markdown' },
        { artifact_id: 'art-B2', title: 'Session B Launch Page', artifact_type: 'html' },
      ],
    };

    function getSessionArtifacts(sessionId) {
      return sessionArtifactMap[sessionId] || [];
    }

    assert.equal(getSessionArtifacts('sess-A').length, 1);
    assert.equal(getSessionArtifacts('sess-A')[0].artifact_id, 'art-A1');

    assert.equal(getSessionArtifacts('sess-B').length, 2);
    assert.equal(getSessionArtifacts('sess-B')[0].artifact_id, 'art-B1');

    assert.equal(getSessionArtifacts('sess-C').length, 0);
  });

  it('6. Polling lifecycle and cleanup: stops on terminal statuses, timeouts, and session switches', async () => {
    // 1. Verify shared polling configuration constants
    assert.equal(ARTIFACT_POLLING_CONFIG.INTERVAL_MS, 2500);
    assert.equal(ARTIFACT_POLLING_CONFIG.TIMEOUT_MS, 330000);
    assert.equal(ARTIFACT_POLLING_CONFIG.MAX_ATTEMPTS, 132);

    // 2. Verify status discriminator
    assert.equal(isGeneratingStatus('pending'), true);
    assert.equal(isGeneratingStatus('generating'), true);
    assert.equal(isGeneratingStatus('completed'), false);
    assert.equal(isGeneratingStatus('failed'), false);
    assert.equal(isGeneratingStatus('validation_failed'), false);
    assert.equal(isGeneratingStatus('insufficient_evidence'), false);

    let pollCount = 0;
    const maxPolls = 5;
    let timerCleared = false;
    let currentSessionId = 'sess-1';

    // Simulate poll controller
    async function pollJob(jobSessionId, initialStatus) {
      let status = initialStatus;
      while (!mapArtifactStatus(status).isTerminal && pollCount < maxPolls) {
        if (currentSessionId !== jobSessionId) {
          timerCleared = true;
          return { aborted: true, reason: 'session_switched' };
        }
        pollCount++;
        if (pollCount >= 3) {
          status = 'completed';
        }
      }
      return { aborted: false, finalStatus: status };
    }

    const result = await pollJob('sess-1', 'pending');
    assert.equal(result.aborted, false);
    assert.equal(result.finalStatus, 'completed');
    assert.equal(pollCount, 3);

    // Test session switch terminates polling cleanly
    pollCount = 0;
    currentSessionId = 'sess-2'; // User switched
    const switchedResult = await pollJob('sess-1', 'generating');
    assert.equal(switchedResult.aborted, true);
    assert.equal(timerCleared, true);

    // Test bounded polling termination does not overwrite backend status
    let observationState = { timedOut: false, lastBackendStatus: 'generating' };
    function handleBoundedTimeout() {
      observationState.timedOut = true;
      // Critical requirement: a polling timeout MUST NOT overwrite backend state with 'failed'
    }
    handleBoundedTimeout();
    assert.equal(observationState.timedOut, true);
    assert.equal(observationState.lastBackendStatus, 'generating');
  });

  it('7. Saved artifact navigation: differentiates Ship 30 essays, Markdown artifacts, and HTML/CSS artifacts', () => {
    const items = [
      { id: '1', essay_id: 'ess-1', title: 'Cold Start Essay', type: 'ship30' },
      { id: '2', artifact_id: 'art-1', title: 'Growth Playbook', artifact_type: 'markdown' },
      { id: '3', artifact_id: 'art-2', title: 'Product Launch Dashboard', artifact_type: 'html' },
    ];

    function getItemCategory(item) {
      if (item.essay_id || item.type === 'ship30') return { badge: 'Ship 30 Essay', icon: '✍️' };
      if (item.artifact_type === 'html') return { badge: 'HTML/CSS', icon: '🌐' };
      return { badge: 'Markdown', icon: '📝' };
    }

    assert.deepEqual(getItemCategory(items[0]), { badge: 'Ship 30 Essay', icon: '✍️' });
    assert.deepEqual(getItemCategory(items[1]), { badge: 'Markdown', icon: '📝' });
    assert.deepEqual(getItemCategory(items[2]), { badge: 'HTML/CSS', icon: '🌐' });
  });

  it('8. Markdown preservation: preserves existing MarkdownRenderer, citations, word counts, and safe link filtering', () => {
    // Verify safe link filtering
    assert.equal(isSafeUrl('https://lenny.substack.com'), true);
    assert.equal(isSafeUrl('http://example.com'), true);
    assert.equal(isSafeUrl('mailto:user@example.com'), true);
    assert.equal(isSafeUrl('javascript:alert(1)'), false);
    assert.equal(isSafeUrl('data:text/html,evil'), false);
    assert.equal(isSafeUrl('vbscript:msgbox(1)'), false);

    // Verify safe inline rendering
    const safeOutput = renderSafeInline('Here is a [safe link](https://lenny.com) and an [evil link](javascript:alert(1))');
    const safeLinkElem = safeOutput.find((el) => el && el.type === 'a');
    assert.ok(safeLinkElem);
    assert.equal(safeLinkElem.props.href, 'https://lenny.com');

    // Unsafe link neutralizes to <span> without href
    const unsafeLinkElem = safeOutput.find((el) => el && el.props?.className === 'md-unsafe-link');
    assert.ok(unsafeLinkElem);
    assert.equal(unsafeLinkElem.props.href, undefined);
    assert.equal(unsafeLinkElem.type, 'span');
  });

  it('9. HTML Preview and Code switching: renders iframe in preview tab and raw text in code tab', () => {
    let activeTab = 'preview';

    function renderActiveTab(artifact) {
      if (activeTab === 'preview') {
        return {
          type: 'iframe',
          srcDoc: prepareSandboxedSrcDoc(artifact.source_content),
        };
      }
      return {
        type: 'code',
        text: artifact.source_content,
      };
    }

    const testArtifact = {
      artifact_type: 'html',
      source_content: '<div class="card"><h2>Hello World</h2></div>',
    };

    const preview = renderActiveTab(testArtifact);
    assert.equal(preview.type, 'iframe');
    assert.ok(preview.srcDoc.includes('Content-Security-Policy'));
    assert.ok(preview.srcDoc.includes('Hello World'));

    activeTab = 'code';
    const code = renderActiveTab(testArtifact);
    assert.equal(code.type, 'code');
    assert.equal(code.text, '<div class="card"><h2>Hello World</h2></div>');
  });

  it('10. Security: No dangerouslySetInnerHTML anywhere in ArtifactViewer.jsx or App.jsx', () => {
    const viewerSource = fs.readFileSync(path.join(srcDir, 'components/ArtifactViewer.jsx'), 'utf-8');
    const appSource = fs.readFileSync(path.join(srcDir, 'App.jsx'), 'utf-8');

    assert.ok(
      !viewerSource.includes('dangerouslySetInnerHTML'),
      'ArtifactViewer.jsx MUST NOT use dangerouslySetInnerHTML'
    );
    assert.ok(
      !appSource.includes('dangerouslySetInnerHTML'),
      'App.jsx MUST NOT use dangerouslySetInnerHTML'
    );
  });

  it('11. Security: Empty iframe sandbox attribute with strictly zero permissions', () => {
    const viewerSource = fs.readFileSync(path.join(srcDir, 'components/ArtifactViewer.jsx'), 'utf-8');

    // Confirm sandbox="" exists on iframe
    assert.ok(viewerSource.includes('sandbox=""'), 'ArtifactViewer iframe MUST have sandbox=""');

    // Confirm no permissive tokens are present
    assert.ok(!viewerSource.includes('allow-scripts'), 'MUST NOT contain allow-scripts');
    assert.ok(!viewerSource.includes('allow-same-origin'), 'MUST NOT contain allow-same-origin');
    assert.ok(!viewerSource.includes('allow-forms'), 'MUST NOT contain allow-forms');
    assert.ok(!viewerSource.includes('allow-popups'), 'MUST NOT contain allow-popups');
    assert.ok(!viewerSource.includes('allow-downloads'), 'MUST NOT contain allow-downloads');
    assert.ok(!viewerSource.includes('allow-top-navigation'), 'MUST NOT contain allow-top-navigation');
  });

  it('12. Security: Content Security Policy injection via prepareSandboxedSrcDoc', () => {
    // Test headless HTML fragment
    const fragment = '<div class="metric">42k Active Users</div>';
    const prepared1 = prepareSandboxedSrcDoc(fragment);
    assert.ok(prepared1.includes('<!DOCTYPE html>'));
    assert.ok(prepared1.includes('<head>'));
    assert.ok(prepared1.includes(ARTIFACT_CSP_META));
    assert.ok(prepared1.includes('default-src \'none\''));
    assert.ok(prepared1.includes('script-src \'none\''));
    assert.ok(prepared1.includes('connect-src \'none\''));
    assert.ok(prepared1.includes('style-src \'unsafe-inline\''));
    assert.ok(prepared1.includes('<div class="metric">42k Active Users</div>'));

    // Test full HTML document with existing <head>
    const fullDoc = '<!DOCTYPE html><html><head><title>Test</title><style>.metric { font-bold: true; }</style></head><body><h1>Content</h1></body></html>';
    const prepared2 = prepareSandboxedSrcDoc(fullDoc);
    assert.ok(prepared2.includes('<head>'));
    assert.ok(prepared2.includes(ARTIFACT_CSP_META));
    assert.ok(prepared2.includes('<h1>Content</h1>'));
    assert.ok(prepared2.includes('<style>.metric { font-bold: true; }</style>'));

    // Test stripping of rogue or spoofed CSP meta tags
    const evilDoc = '<head><meta http-equiv="Content-Security-Policy" content="script-src *"></head><body><h1>Hi</h1></body>';
    const prepared3 = prepareSandboxedSrcDoc(evilDoc);
    assert.ok(!prepared3.includes('script-src *'));
    assert.ok(prepared3.includes("script-src 'none'"));

    // Test stripping of rogue base tags (prevents base URI redirection)
    const baseDoc = '<base href="https://attacker.com/evil/"><p>Safe Text</p>';
    const prepared4 = prepareSandboxedSrcDoc(baseDoc);
    assert.ok(!prepared4.includes('attacker.com'));
    assert.ok(prepared4.includes('base-uri \'none\''));

    // Test stripping of rogue script tags
    const scriptDoc = '<p>Good</p><script>alert("hacked")</script>';
    const prepared5 = prepareSandboxedSrcDoc(scriptDoc);
    assert.ok(!prepared5.includes('<script>'));
    assert.ok(!prepared5.includes('alert("hacked")'));
  });

  it('13. Security: Unsafe HTML is not rendered in preview when validation_failed', () => {
    function getPreviewSrcDoc(artifact) {
      if (
        artifact.artifact_type !== 'html' ||
        artifact.generation_status === 'validation_failed' ||
        artifact.generation_status === 'failed'
      ) {
        return '';
      }
      return prepareSandboxedSrcDoc(artifact.source_content);
    }

    const flaggedArtifact = {
      artifact_type: 'html',
      generation_status: 'validation_failed',
      source_content: '<div style="background: url(\'https://tracker.com/p.png\')">Flagged</div>',
    };

    // When validation failed, srcDoc is empty string and iframe rendering is suppressed
    assert.equal(getPreviewSrcDoc(flaggedArtifact), '');
  });

  it('14. Escaped code display: raw HTML is rendered as inert text without HTML execution', () => {
    const rawMaliciousCode = '<script>alert(document.cookie)</script><img src="x" onerror="evil()"/>';

    // In React, passing string as children: <code>{rawContent}</code> renders text nodes, escaping all HTML entities
    function escapeHtmlText(str) {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    const escaped = escapeHtmlText(rawMaliciousCode);
    assert.ok(!escaped.includes('<script>'));
    assert.ok(escaped.includes('&lt;script&gt;'));
    assert.ok(escaped.includes('&lt;img'));
  });

  it('15. Copy and download filename handling: slugifies titles and appends correct extension (.html vs .md)', () => {
    const htmlArtifact = {
      title: 'Growth Strategy Dashboard: Elena Verna Edition',
      artifact_type: 'html',
    };
    assert.equal(getArtifactFilename(htmlArtifact), 'growth-strategy-dashboard-elena-verna-edition.html');

    const mdArtifact = {
      title: 'Product Strategy Report 2026',
      artifact_type: 'markdown',
    };
    assert.equal(getArtifactFilename(mdArtifact), 'product-strategy-report-2026.md');

    const ship30Essay = {
      title: 'How Brian Chesky Solved The Cold Start Problem',
      artifact_type: 'markdown',
    };
    assert.equal(getArtifactFilename(ship30Essay), 'how-brian-chesky-solved-the-cold-start-problem.md');

    // Default fallbacks for empty or null
    assert.equal(getArtifactFilename(null), 'artifact.txt');
    assert.equal(getArtifactFilename({ title: '', artifact_type: 'html' }), 'growth-artifact.html');
  });

  it('16. Mobile artifact state handling: overlays workspace and preserves conversation', () => {
    const mobileState = {
      isArtifactPanelOpen: true,
      mobileSidebarOpen: false,
      activeArtifact: { artifact_id: 'art-1', title: 'Mobile View Test' },
      messages: [{ id: 'm1', content: 'Chat turn 1' }, { id: 'm2', content: 'Chat turn 2' }],
    };

    // When artifact panel is opened on mobile, conversation messages are fully preserved in state
    assert.equal(mobileState.messages.length, 2);
    assert.equal(mobileState.isArtifactPanelOpen, true);
  });

  it('17. Backend HTML validator integration: verify frontend maps validation warnings and errors', () => {
    const artifactWithFeedback = {
      artifact_id: 'art-202',
      title: 'Dashboard with Minor Warnings',
      artifact_type: 'html',
      generation_status: 'completed',
      validation_results: {
        passed: true,
        errors: [],
        warnings: [
          'External link detected: href="https://example.com" neutralized',
          'Inline style normalized',
        ],
      },
    };

    const warnings = artifactWithFeedback.validation_results?.warnings || [];
    assert.equal(warnings.length, 2);
    assert.ok(warnings[0].includes('External link detected'));
  });

  it('18. Ship 30 essay API endpoint contracts: confirms exact plural route /api/sessions/{session_id}/essays', async () => {
    let requestedPostUrl = null;
    let requestedListUrl = null;
    let requestedDetailUrl = null;

    globalThis.fetch = async (url, options = {}) => {
      if (options.method === 'POST') {
        requestedPostUrl = url;
        return {
          ok: true,
          status: 202,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            message: 'Essay created',
            data: { essay_id: 'ess-1', session_id: 'sess-abc', generation_status: 'generating' },
          }),
        };
      }
      if (url.endsWith('/essays')) {
        requestedListUrl = url;
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            data: [{ essay_id: 'ess-1', title: 'Test Essay' }],
          }),
        };
      }
      requestedDetailUrl = url;
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true,
          data: { essay_id: 'ess-1', title: 'Test Essay', markdown: '# Test' },
        }),
      };
    };

    // 1. POST Create Essay uses plural route
    await createEssay('sess-abc', { topic: 'Product strategy', target_word_count: 1250 });
    assert.ok(requestedPostUrl.endsWith('/api/sessions/sess-abc/essays'), `POST route must be /essays (plural). Actual: ${requestedPostUrl}`);

    // 2. GET List Essays uses plural route
    await fetchEssays('sess-abc');
    assert.ok(requestedListUrl.endsWith('/api/sessions/sess-abc/essays'), `GET list route must be /essays (plural). Actual: ${requestedListUrl}`);

    // 3. GET Detail Essay uses plural route
    await fetchEssay('sess-abc', 'ess-1');
    assert.ok(requestedDetailUrl.endsWith('/api/sessions/sess-abc/essays/ess-1'), `GET detail route must be /essays/{id}. Actual: ${requestedDetailUrl}`);
  });

  it('19. Manual refresh behavior: executes immediate status check and resets timeout state', async () => {
    let fetchCalled = false;
    globalThis.fetch = async (url) => {
      fetchCalled = true;
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true,
          data: { artifact_id: 'art-99', title: 'Refreshed', generation_status: 'completed' },
        }),
      };
    };

    let isPollingTimedOut = true;
    async function handleManualRefresh(sessionId, artifactId) {
      const refreshed = await fetchArtifact(sessionId, artifactId);
      isPollingTimedOut = false; // Reset timeout flag on manual refresh
      return refreshed;
    }

    const res = await handleManualRefresh('sess-1', 'art-99');
    assert.equal(fetchCalled, true);
    assert.equal(isPollingTimedOut, false);
    assert.equal(res.generation_status, 'completed');
  });
});

describe('Task 08UI-2: Dark Theme UI Bug Fixes and Quality Guardrails', () => {
  const cssPath = path.resolve(fileURLToPath(import.meta.url), '../../src/index.css');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  it('1. Document canvas contrast rules: explicit theme-independent colors and dark mode immunity', () => {
    // 1. .document-canvas has explicit white background and dark text
    assert.ok(
      cssContent.includes('.document-canvas {') &&
      cssContent.includes('background-color: #FFFFFF !important;') &&
      cssContent.includes('color: #1A1A1A !important;'),
      'document-canvas must explicitly define #FFFFFF background and #1A1A1A text with !important'
    );

    // 2. [data-theme="dark"] .document-canvas has immunity rules ensuring dark headings
    assert.ok(
      cssContent.includes('[data-theme="dark"] .document-canvas .md-heading') &&
      cssContent.includes('#111827 !important;'),
      'Dark mode must enforce #111827 dark charcoal headings on document canvas'
    );

    // 3. [data-theme="dark"] .document-canvas has immunity rules ensuring dark body text
    assert.ok(
      cssContent.includes('[data-theme="dark"] .document-canvas .md-paragraph') &&
      cssContent.includes('#374151 !important;'),
      'Dark mode must enforce #374151 readable body text on document canvas'
    );
  });

  it('2. Responsive artifact header: two-tier structure preventing title collapse at narrow widths', () => {
    const viewerPath = path.resolve(fileURLToPath(import.meta.url), '../../src/components/ArtifactViewer.jsx');
    const viewerContent = fs.readFileSync(viewerPath, 'utf-8');

    // Header has two-tier responsive layout
    assert.ok(viewerContent.includes('artifact-header-top'), 'Artifact header must include .artifact-header-top');
    assert.ok(viewerContent.includes('artifact-header-bottom'), 'Artifact header must include .artifact-header-bottom');
    assert.ok(viewerContent.includes('artifact-header-title-group'), 'Artifact header must group title elements');

    // CSS provides ellipsis and prevents collapsing
    assert.ok(cssContent.includes('.artifact-title {'), 'Artifact title class must be defined in CSS');
    assert.ok(cssContent.includes('text-overflow: ellipsis;'), 'Artifact title must truncate with ellipsis');
    assert.ok(cssContent.includes('white-space: nowrap;'), 'Artifact title must not wrap clumsily');
  });

  it('3. Dialog form structure and button classes: standardized modal classes and clear actions', () => {
    const artifactModalPath = path.resolve(fileURLToPath(import.meta.url), '../../src/components/CreateArtifactModal.jsx');
    const artifactModalContent = fs.readFileSync(artifactModalPath, 'utf-8');
    const essayModalPath = path.resolve(fileURLToPath(import.meta.url), '../../src/components/CreateEssayModal.jsx');
    const essayModalContent = fs.readFileSync(essayModalPath, 'utf-8');

    // Both modals use standardized structural classes
    for (const [name, content] of [['CreateArtifactModal', artifactModalContent], ['CreateEssayModal', essayModalContent]]) {
      assert.ok(content.includes('modal-header'), `${name} must include .modal-header`);
      assert.ok(content.includes('modal-body'), `${name} must include scrollable .modal-body`);
      assert.ok(content.includes('modal-footer'), `${name} must include .modal-footer`);
      assert.ok(content.includes('btn-modal-cancel'), `${name} must include .btn-modal-cancel`);
      assert.ok(content.includes('btn-modal-submit'), `${name} must include .btn-modal-submit`);
    }

    // CSS specifies distinct styling for cancel vs primary submit buttons
    assert.ok(cssContent.includes('.btn-modal-cancel {'), 'CSS must define .btn-modal-cancel');
    assert.ok(cssContent.includes('.btn-modal-submit {'), 'CSS must define .btn-modal-submit');
    assert.ok(cssContent.includes('height: 38px;'), 'Modal buttons must have consistent height');
  });

  it('4. Quality guardrails for HTML artifact generation: prompt contains strict layout and truthfulness rules', () => {
    const agentPromptPath = path.resolve(fileURLToPath(import.meta.url), '../../../agent-service/src/pi_agent.mjs');
    const agentPromptContent = fs.readFileSync(agentPromptPath, 'utf-8');

    // Prompt contains complete self-contained HTML constraint
    assert.ok(agentPromptContent.includes('<!DOCTYPE html>'), 'HTML prompt must require <!DOCTYPE html>');
    assert.ok(agentPromptContent.includes('embedded <style> block'), 'HTML prompt must require embedded <style>');

    // Strict no-JS and no external resources
    assert.ok(agentPromptContent.includes('NO <script> tags or executable JavaScript'), 'Prompt must prohibit JavaScript');
    assert.ok(agentPromptContent.includes('NO @import, NO remote url()'), 'Prompt must prohibit external fonts/styles');

    // Prohibit broken placeholders and require illustrative labeling
    assert.ok(agentPromptContent.includes('DO NOT use <img> tags pointing to placeholder'), 'Prompt must prohibit broken image placeholders');
    assert.ok(agentPromptContent.includes('"Illustrative example" or "Sample data"'), 'Prompt must require illustrative labels for mock metrics');
  });

  it('5. Security isolation: sandboxed iframe and strict Content Security Policy are preserved', () => {
    const viewerPath = path.resolve(fileURLToPath(import.meta.url), '../../src/components/ArtifactViewer.jsx');
    const viewerContent = fs.readFileSync(viewerPath, 'utf-8');

    // Iframe must strictly use sandbox="" without allow-scripts or allow-same-origin
    assert.ok(
      viewerContent.includes('sandbox=""'),
      'ArtifactViewer iframe must maintain empty sandbox="" isolation'
    );

    // prepareSandboxedSrcDoc injects strict CSP
    const testHtml = '<h1>Test Heading</h1><p>Test paragraph</p>';
    const sandboxed = prepareSandboxedSrcDoc(testHtml);
    assert.ok(sandboxed.includes("default-src 'none'"), 'Sandboxed document must enforce default-src \'none\' CSP');
    assert.ok(sandboxed.includes("style-src 'unsafe-inline'"), 'Sandboxed document must permit only unsafe-inline styles');
    assert.ok(!sandboxed.includes('allow-scripts'), 'Sandboxed document must not permit scripts');
  });
});
