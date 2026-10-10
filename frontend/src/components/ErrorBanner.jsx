import React from 'react';
import { getErrorGuidance } from '../utils/formatters.js';

export { getErrorGuidance };

export function ErrorBanner({ error, onDismiss, onRetry }) {
  if (!error) return null;

  const status = error.status || 0;
  const message = error.message || 'An error occurred';
  const guidance = getErrorGuidance(status);

  return (
    <div className="error-banner" role="alert" aria-live="assertive">
      <div className="error-banner-content">
        <span className="error-icon" aria-hidden="true">⚠️</span>
        <div className="error-texts">
          <div className="error-title-row">
            <strong className="error-title">
              {status > 0 ? `Error (${status})` : 'Connection Error'}
            </strong>
            <span className="error-message-text">{message}</span>
          </div>
          <p className="error-guidance-text">{guidance}</p>
        </div>
      </div>

      <div className="error-actions">
        {onRetry && (
          <button type="button" className="error-retry-btn" onClick={onRetry}>
            Retry
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            className="error-dismiss-btn"
            onClick={onDismiss}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
