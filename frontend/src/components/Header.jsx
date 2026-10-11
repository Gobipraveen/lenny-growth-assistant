import React from 'react';
import { Sparkles, PanelLeftOpen, PanelLeftClose, FileText, Menu } from 'lucide-react';
import { ProviderSelector } from './ProviderSelector.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';

/**
 * Top Application Header.
 * Minimal, elegant header with app branding, provider selector, artifact toggle, and theme switch.
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
          aria-label="Toggle navigation drawer"
        >
          <Menu size={18} aria-hidden="true" />
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
            <PanelLeftOpen size={18} aria-hidden="true" />
            <span className="btn-text">Sidebar</span>
          </button>
        )}

        {/* Application branding */}
        <div className="branding">
          <span className="brand-logo" aria-hidden="true">
            <Sparkles size={18} />
          </span>
          <div>
            <h1 className="brand-title">Lenny Growth Assistant</h1>
            <span className="brand-subtitle">
              Product & Growth Intelligence
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
            <FileText size={16} aria-hidden="true" className="toggle-icon" />
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
