import React from 'react';
import { ProviderSelector } from './ProviderSelector.jsx';

export function Header({
  status,
  selectedProvider,
  onSelectProvider,
  onToggleMobileSidebar,
  disabled = false,
}) {
  return (
    <header className="app-header">
      <div className="header-left">
        <button
          type="button"
          className="mobile-menu-btn"
          onClick={onToggleMobileSidebar}
          aria-label="Toggle conversation history"
        >
          <span className="hamburger-bar"></span>
          <span className="hamburger-bar"></span>
          <span className="hamburger-bar"></span>
        </button>

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
        <ProviderSelector
          status={status}
          selectedProvider={selectedProvider}
          onSelectProvider={onSelectProvider}
          disabled={disabled}
        />
      </div>
    </header>
  );
}
