/**
 * API client for The Lenny Growth Assistant frontend.
 * Interacts strictly with FastAPI backend endpoints (/api/sessions/...).
 * Never accesses the internal Node.js agent service or private secrets directly.
 */

const API_BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL)
  ? import.meta.env.VITE_API_BASE_URL
  : '';

/**
 * Custom error class capturing HTTP status code and parsed backend detail.
 */
export class ApiError extends Error {
  constructor(status, detail, data = null) {
    let message = detail;
    if (typeof detail === 'object' && detail !== null) {
      if (Array.isArray(detail)) {
        // FastAPI validation errors (422)
        message = detail.map((e) => e.msg || JSON.stringify(e)).join(', ');
      } else if (detail.detail) {
        message = typeof detail.detail === 'string' ? detail.detail : JSON.stringify(detail.detail);
      } else {
        message = JSON.stringify(detail);
      }
    }
    super(message || `API request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.data = data;
  }
}

/**
 * Safe fetch wrapper that handles JSON deserialization and HTTP errors.
 */
async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const defaultHeaders = {
    'Accept': 'application/json',
  };

  if (options.body && typeof options.body === 'string') {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  };

  let response;
  try {
    response = await fetch(url, config);
  } catch (netErr) {
    throw new ApiError(
      0,
      `Network connection failed. Unable to reach backend server at ${url}: ${netErr.message}`
    );
  }

  let payload = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  } else {
    try {
      payload = await response.text();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const detail = payload && (typeof payload === 'object')
      ? (payload.detail || payload.message || payload)
      : (payload || response.statusText);
    throw new ApiError(response.status, detail, payload);
  }

  return payload;
}

/**
 * Fetch LLM provider and agent service status.
 * Endpoint: GET /api/sessions/status
 */
export async function fetchChatStatus() {
  const res = await request('/api/sessions/status');
  // Returns APIResponse[ChatStatusResponse]
  return res && res.data ? res.data : res;
}

/**
 * List chat sessions with pagination.
 * Endpoint: GET /api/sessions?skip={skip}&limit={limit}
 */
export async function fetchSessions(skip = 0, limit = 50) {
  const res = await request(`/api/sessions?skip=${skip}&limit=${limit}`);
  // Returns List[ChatSessionResponse]
  return Array.isArray(res) ? res : [];
}

/**
 * Create a new chat session.
 * Endpoint: POST /api/sessions
 */
export async function createSession({ title = null, userMetadata = {} } = {}) {
  const res = await request('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({
      title: title || null,
      user_metadata: userMetadata || {},
    }),
  });
  // Returns ChatSessionResponse
  return res;
}

/**
 * Retrieve messages for a given session.
 * Endpoint: GET /api/sessions/{session_id}/messages?skip={skip}&limit={limit}
 */
export async function fetchSessionMessages(sessionId, skip = 0, limit = 100, signal = null) {
  if (!sessionId) return [];
  const options = signal ? { signal } : {};
  const res = await request(`/api/sessions/${sessionId}/messages?skip=${skip}&limit=${limit}`, options);
  // Returns List[ChatMessageResponse]
  return Array.isArray(res) ? res : [];
}

/**
 * Post an AI chat turn to the agent bridge.
 * Endpoint: POST /api/sessions/{session_id}/chat
 * Request: ChatTurnRequest { message: string, provider?: string }
 * Response: APIResponse[ChatTurnResponse]
 */
export async function postChatTurn(sessionId, { message, provider = null }) {
  if (!sessionId) {
    throw new ApiError(400, 'Cannot send message without an active session ID');
  }

  const payload = {
    message: message.trim(),
  };
  if (provider) {
    payload.provider = provider.toLowerCase();
  }

  const res = await request(`/api/sessions/${sessionId}/chat`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  // Returns APIResponse[ChatTurnResponse] -> extract data
  return res && res.data ? res.data : res;
}
