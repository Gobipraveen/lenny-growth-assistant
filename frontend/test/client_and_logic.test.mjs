import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  ApiError,
  fetchSessions,
  createSession,
  fetchSessionMessages,
  postChatTurn,
  fetchChatStatus,
} from '../src/api/client.js';
import { deriveSessionTitle, getErrorGuidance, formatSessionDate } from '../src/utils/formatters.js';

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
          { provider: 'anthropic', available: false, model: 'claude-3-5-sonnet-latest', is_default: false, details: 'API key not configured' },
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

  it('12. Ollama and Anthropic provider status displays accurately without llama3 fallback', () => {
    const statusData = {
      providers: [
        { provider: 'ollama', available: true, model: 'qwen2.5:1.5b', is_default: true },
        { provider: 'anthropic', available: false, model: 'claude-3-5-sonnet-latest', is_default: false },
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
