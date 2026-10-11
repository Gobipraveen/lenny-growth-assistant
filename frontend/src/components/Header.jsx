import React from 'react';
import { ProviderSelector } from './ProviderSelector.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';

/**
 * Top Application Header.
 * Houses branding, provider controls, artifact toggle, and theme switch.
 */
export function Header({
  status,
  selectedProvider,
  onSelectProvider,
  onToggleMobileSidebar,
  onToggleDesktopSidebar,
  isSidebarOpen = true,
  onToggleArtifactPanel,
  isArtifactPanelOpen = false,
  theme = 'dark',
  onToggleTheme,
  disabled = false,
}) {
  return (
    <header className="app-header">
      <div className="header-left">
        {/* Mobile drawer toggle */}
        <button
          type="button"
          className="mobile-menu-btn"
          onClick={onToggleMobileSidebar}
          aria-label="Toggle conversation history drawer"
        >
          <span className="hamburger-bar" />
          <span className="hamburger-bar" />
          <span className="hamburger-bar" />
        </button>

        {/* Desktop sidebar expand button if sidebar is collapsed */}
        {!isSidebarOpen && onToggleDesktopSidebar && (
          <button
            type="button"
            className="sidebar-expand-btn desktop-only"
            onClick={onToggleDesktopSidebar}
            aria-label="Expand sidebar panel"
            title="Open sidebar panel"
          >
            <span aria-hidden="true">▶</span>
            <span className="btn-text">Sidebar</span>
          </button>
        )}

        {/* Application branding */}
        <div className="branding">
          <span className="brand-logo" aria-hidden="true">🚀</span>
          <div>
            <h1 className="brand-title">Lenny Growth Assistant</h1>
            <span className="brand-subtitle">
              Podcast-Grounded Product & Growth Intelligence
            </span>
          </div>
        </div>
      </div>

      <div className="header-right">
        {/* Provider and model selector */}
        <ProviderSelector
          status={status}
          selectedProvider={selectedProvider}
          onSelectProvider={onSelectProvider}
          disabled={disabled}
        />

        {/* Artifact Viewer Toggle */}
        {onToggleArtifactPanel && (
          <button
            type="button"
            className={`btn-artifact-toggle ${isArtifactPanelOpen ? 'active' : ''}`}
            onClick={onToggleArtifactPanel}
            aria-label={`${isArtifactPanelOpen ? 'Close' : 'Open'} artifact viewer`}
            title={`${isArtifactPanelOpen ? 'Hide' : 'Show'} Artifact Viewer (Right Panel)`}
          >
            <span className="toggle-icon" aria-hidden="true">📜</span>
            <span className="toggle-label">Artifacts</span>
            {isArtifactPanelOpen && <span className="active-dot" aria-hidden="true" />}
          </button>
        )}

        {/* Theme Toggle in Header */}
        <ThemeToggle
          theme={theme}
          onToggleTheme={onToggleTheme}
          className="header-theme-toggle"
        />
      </div>
    </header>
  );
}
