import React from 'react';
import { Sun, Moon } from 'lucide-react';

/**
 * Accessible Theme Toggle Button (Dark / Light).
 * Uses Lucide outline icons with smooth transitions.
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
        {isDark ? <Sun size={16} /> : <Moon size={16} />}
      </span>
      <span className="theme-toggle-label">
        {isDark ? 'Light' : 'Dark'}
      </span>
    </button>
  );
}
