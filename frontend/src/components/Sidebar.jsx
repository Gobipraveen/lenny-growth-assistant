import React from 'react';
import {
  Sparkles,
  Plus,
  MessageCircle,
  FileText,
  FilePenLine,
  Code2,
  Database,
  PanelLeftClose,
  X,
  LoaderCircle,
} from 'lucide-react';
import { formatSessionDate, deriveSessionTitle } from '../utils/formatters.js';
import { ThemeToggle } from './ThemeToggle.jsx';

export { deriveSessionTitle };

/**
 * Sidebar component (Left Panel) with Premium Minimal AI Workspace styling:
 * - Minimal branding & collapse
 * - New Chat action
 * - Quick nav: Artifacts, Knowledge Base
 * - Session Artifacts & Ship 30 essays
 * - Recent conversations plain-text list
 * - Bottom theme switcher
 */
export function Sidebar({
  sessions = [],
  currentSessionId,
  onSelectSession,
  onNewSession,
  isLoading = false,
  isOpen = false,
  onCloseMobile,
  onToggleArtifactPanel,
  isArtifactPanelOpen = false,
  onOpenKnowledgeBase,
  knowledgeEpisodeCount = null,
  essays = [],
  currentEssayId = null,
  onSelectEssay,
  onOpenCreateEssay,
  artifacts = [],
  currentArtifactId = null,
  onSelectArtifact,
  onOpenCreateArtifact,
  theme = 'dark',
  onToggleTheme,
  onCollapseSidebar,
}) {
  const totalArtifactCount = essays.length + artifacts.length;

  return (
    <aside
      className={`app-sidebar ${isOpen ? 'sidebar-open' : ''}`}
      aria-label="Conversation and Navigation Sidebar"
      id="app-sidebar"
    >
      {/* Brand & Desktop Collapse Bar */}
      <div className="sidebar-brand-box">
        <div className="sidebar-brand-logo-row">
          <span className="sidebar-brand-icon" aria-hidden="true">
            <Sparkles size={16} />
          </span>
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-title">Lenny Assistant</span>
          </div>
        </div>

        {onCollapseSidebar && (
          <button
            type="button"
            className="sidebar-collapse-btn desktop-only"
            onClick={onCollapseSidebar}
            aria-label="Collapse sidebar panel"
            title="Collapse sidebar"
          >
            <PanelLeftClose size={16} aria-hidden="true" />
          </button>
        )}

        {isOpen && onCloseMobile && (
          <button
            type="button"
            className="mobile-close-btn mobile-only"
            onClick={onCloseMobile}
            aria-label="Close conversation drawer"
            title="Close drawer"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Primary Action: New Chat */}
      <div className="sidebar-action-box">
        <button
          type="button"
          className="btn-new-chat"
          onClick={onNewSession}
          disabled={isLoading}
          aria-label="Start new conversation"
        >
          <Plus size={16} aria-hidden="true" className="btn-icon" />
          <span>New Conversation</span>
        </button>
      </div>

      {/* Nav Entries: Artifacts & Knowledge Base */}
      <div className="sidebar-quick-nav" role="navigation" aria-label="Workspace tools">
        <button
          type="button"
          className={`sidebar-nav-item ${isArtifactPanelOpen ? 'active' : ''}`}
          onClick={onToggleArtifactPanel}
          title="Toggle Artifact Viewer panel (Right panel)"
        >
          <FileText size={16} aria-hidden="true" className="nav-item-icon" />
          <span className="nav-item-label">Artifact Viewer</span>
          <span className="nav-item-pill">{isArtifactPanelOpen ? 'Open' : 'View'}</span>
        </button>

        <button
          type="button"
          className="sidebar-nav-item"
          onClick={onOpenKnowledgeBase}
          title="View indexed podcast statistics & grounding info"
        >
          <Database size={16} aria-hidden="true" className="nav-item-icon" />
          <span className="nav-item-label">Knowledge Base</span>
          <span className="nav-item-pill">
            {knowledgeEpisodeCount !== null ? `${knowledgeEpisodeCount} eps` : 'Stats'}
          </span>
        </button>
      </div>

      {/* Unified Session Artifacts & Essays Section */}
      <div className="sidebar-essays-section">
        <div className="sidebar-section-title">
          <span>Session Artifacts</span>
          <div className="section-title-actions">
            <span className="badge-count">{totalArtifactCount}</span>
            {onOpenCreateArtifact && (
              <button
                type="button"
                className="btn-create-essay-inline"
                onClick={onOpenCreateArtifact}
                title="Create HTML or Markdown artifact"
                aria-label="Create new artifact"
              >
                <Plus size={14} aria-hidden="true" />
              </button>
            )}
            {onOpenCreateEssay && (
              <button
                type="button"
                className="btn-create-essay-inline btn-create-ship30-inline"
                onClick={onOpenCreateEssay}
                title="Draft a Ship 30 essay"
                aria-label="Draft new Ship 30 essay"
              >
                <FilePenLine size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <div className="sidebar-essays-list" role="navigation" aria-label="Session artifacts and essays">
          {totalArtifactCount === 0 ? (
            <div className="sidebar-essays-empty">
              <span>No artifacts in this chat yet.</span>
              <div className="sidebar-empty-actions">
                {onOpenCreateArtifact && (
                  <button
                    type="button"
                    className="btn-draft-first-essay"
                    onClick={onOpenCreateArtifact}
                  >
                    <Plus size={12} aria-hidden="true" /> New Artifact
                  </button>
                )}
                {onOpenCreateEssay && (
                  <button
                    type="button"
                    className="btn-draft-first-essay btn-draft-secondary"
                    onClick={onOpenCreateEssay}
                  >
                    <FilePenLine size={12} aria-hidden="true" /> Ship 30 Essay
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Generic Artifacts (HTML/CSS & Markdown) */}
              {artifacts.map((art) => {
                const isSelected = art.artifact_id === currentArtifactId;
                const displayTitle = art.title || 'Untitled Artifact';
                const isGen = art.generation_status === 'generating';
                const isHtml = art.artifact_type === 'html';

                return (
                  <button
                    key={art.artifact_id}
                    type="button"
                    className={`sidebar-essay-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      if (onSelectArtifact) onSelectArtifact(art.artifact_id);
                      if (onCloseMobile) onCloseMobile();
                    }}
                    title={displayTitle}
                  >
                    <div className="essay-item-title-row">
                      <span className="essay-icon" aria-hidden="true">
                        {isGen ? (
                          <LoaderCircle size={14} className="spin-slow" />
                        ) : isHtml ? (
                          <Code2 size={14} />
                        ) : (
                          <FileText size={14} />
                        )}
                      </span>
                      <span className="essay-title-text">{displayTitle}</span>
                    </div>

                    <div className="essay-item-meta-row">
                      <span className={`mini-status-dot status-${art.generation_status}`} />
                      <span className="essay-status-label">
                        {isGen ? 'generating…' : art.generation_status}
                      </span>
                      <span className="artifact-type-mini-badge">
                        {isHtml ? 'HTML' : 'MD'}
                      </span>
                    </div>
                  </button>
                );
              })}

              {/* Ship 30 Essays */}
              {essays.map((essay) => {
                const isSelected = essay.essay_id === currentEssayId;
                const displayTitle = essay.title || essay.topic;
                const isGen = essay.generation_status === 'generating';

                return (
                  <button
                    key={essay.essay_id}
                    type="button"
                    className={`sidebar-essay-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      if (onSelectEssay) onSelectEssay(essay.essay_id);
                      if (onCloseMobile) onCloseMobile();
                    }}
                    title={displayTitle}
                  >
                    <div className="essay-item-title-row">
                      <span className="essay-icon" aria-hidden="true">
                        {isGen ? (
                          <LoaderCircle size={14} className="spin-slow" />
                        ) : (
                          <FilePenLine size={14} />
                        )}
                      </span>
                      <span className="essay-title-text">{displayTitle}</span>
                    </div>

                    <div className="essay-item-meta-row">
                      <span className={`mini-status-dot status-${essay.generation_status}`} />
                      <span className="essay-status-label">
                        {isGen ? 'generating…' : essay.generation_status}
                      </span>
                      <span className="artifact-type-mini-badge">
                        Ship 30
                      </span>
                      {essay.word_count ? (
                        <span className="essay-word-count">{essay.word_count}w</span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* Section Divider: Conversations */}
      <div className="sidebar-section-title">
        <span>Recent Conversations</span>
        <span className="badge-count">{sessions.length}</span>
      </div>

      {/* Sessions List */}
      <div
        className="sidebar-sessions-list"
        role="navigation"
        aria-label="Past conversations"
      >
        {isLoading && sessions.length === 0 ? (
          <div className="sidebar-loading">
            <div className="skeleton-item" />
            <div className="skeleton-item" />
            <div className="skeleton-item" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="sidebar-empty">
            <MessageCircle size={20} aria-hidden="true" className="empty-icon" />
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
                  <MessageCircle size={14} aria-hidden="true" className="session-item-icon" />
                  <span className="session-item-title">{title}</span>
                </div>
                {dateStr && <span className="session-item-date">{dateStr}</span>}
              </button>
            );
          })
        )}
      </div>

      {/* Footer & Settings / Theme Switch */}
      <div className="sidebar-footer">
        <div className="sidebar-footer-controls">
          <ThemeToggle
            theme={theme}
            onToggleTheme={onToggleTheme}
            className="sidebar-theme-toggle"
          />
        </div>
      </div>
    </aside>
  );
}
