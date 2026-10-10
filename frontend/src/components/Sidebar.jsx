import React from 'react';
import { formatSessionDate, deriveSessionTitle } from '../utils/formatters.js';

export { deriveSessionTitle };

/**
 * Sidebar component listing past sessions and new session button.
 */
export function Sidebar({
  sessions = [],
  currentSessionId,
  onSelectSession,
  onNewSession,
  isLoading = false,
  isOpen = false,
  onCloseMobile,
}) {
  return (
    <aside className={`app-sidebar ${isOpen ? 'sidebar-open' : ''}`} aria-label="Conversation History">
      <div className="sidebar-header">
        <button
          type="button"
          className="btn-new-chat"
          onClick={onNewSession}
          disabled={isLoading}
          aria-label="Start new conversation"
        >
          <span className="btn-icon" aria-hidden="true">+</span>
          <span>New Conversation</span>
        </button>

        {onCloseMobile && (
          <button
            type="button"
            className="mobile-close-btn"
            onClick={onCloseMobile}
            aria-label="Close conversation drawer"
          >
            ✕
          </button>
        )}
      </div>

      <div className="sidebar-section-title">
        <span>Recent Conversations</span>
        <span className="badge-count">{sessions.length}</span>
      </div>

      <div className="sidebar-sessions-list" role="navigation" aria-label="Past conversations">
        {isLoading && sessions.length === 0 ? (
          <div className="sidebar-loading">
            <div className="skeleton-item"></div>
            <div className="skeleton-item"></div>
            <div className="skeleton-item"></div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="sidebar-empty">
            <span aria-hidden="true">💬</span>
            <p>No conversations yet</p>
            <span className="sidebar-subtext">Click "New Conversation" to start</span>
          </div>
        ) : (
          sessions.map((sess) => {
            const isSelected = sess.id === currentSessionId;
            const title = deriveSessionTitle(sess);
            const dateStr = formatSessionDate(sess.updated_at || sess.created_at);

            return (
              <button
                key={sess.id}
                type="button"
                className={`sidebar-session-item ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  onSelectSession(sess.id);
                  if (onCloseMobile) onCloseMobile();
                }}
                aria-current={isSelected ? 'true' : undefined}
                title={title}
              >
                <div className="session-item-row">
                  <span className="session-item-icon" aria-hidden="true">💭</span>
                  <span className="session-item-title">{title}</span>
                </div>
                {dateStr && <span className="session-item-date">{dateStr}</span>}
              </button>
            );
          })
        )}
      </div>

      <div className="sidebar-footer">
        <span className="version-tag">Pi Agent Bridge v0.1.0</span>
      </div>
    </aside>
  );
}
