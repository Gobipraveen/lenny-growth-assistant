/**
 * Utility formatting functions for sessions, dates, and errors.
 */

export function formatSessionDate(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

export function deriveSessionTitle(session) {
  if (!session) return 'Untitled Chat';
  if (session.title && typeof session.title === 'string' && session.title.trim()) {
    return session.title.trim();
  }
  if (session.first_message && typeof session.first_message === 'string' && session.first_message.trim()) {
    const trimmed = session.first_message.trim();
    return trimmed.length > 32 ? `${trimmed.slice(0, 32)}…` : trimmed;
  }
  if (session.created_at) {
    const d = new Date(session.created_at);
    if (!isNaN(d.getTime())) {
      return `Chat ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    }
  }
  return 'Conversation';
}

export function getErrorGuidance(status) {
  switch (status) {
    case 400:
      return 'The message could not be processed. Please check that the input is valid.';
    case 404:
      return 'The active conversation session was not found on the server. Try starting a new conversation.';
    case 502:
      return 'The Node.js Pi agent bridge is unavailable. Ensure agent-service is running on port 8001.';
    case 503:
      return 'Service temporarily overloaded. Please try again in a moment.';
    case 504:
      return 'Request timed out. The local LLM inference took longer than expected under current memory load.';
    default:
      return 'An unexpected error occurred. Please check system logs or retry.';
  }
}
