import React from 'react';

/**
 * Accessible Theme Toggle Button (Dark / Light).
 * Displays golden/sunset neutral styling with smooth SVG icon transitions.
 */
export function ThemeToggle({ theme = 'dark', onToggleTheme, className = '' }) {
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      className={`theme-toggle-btn ${className}`}
      onClick={onToggleTheme}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      title={`Switch to ${isDark ? 'Light' : 'Dark'} Theme (Current: ${isDark ? 'Dark' : 'Light'})`}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        {isDark ? '☀️' : '🌙'}
      </span>
      <span className="theme-toggle-label">
        {isDark ? 'Light' : 'Dark'}
      </span>
    </button>
  );
}
