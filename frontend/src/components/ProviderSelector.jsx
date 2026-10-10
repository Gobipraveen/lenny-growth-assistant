import React from 'react';

/**
 * Provider and model selection component.
 * Displays provider availability, active model, and agent service connectivity.
 */
export function ProviderSelector({
  status,
  selectedProvider,
  onSelectProvider,
  disabled = false,
}) {
  const providers = (status && status.providers) || [
    { provider: 'ollama', available: false, model: status?.active_model || 'Local LLM', details: 'Local LLM instance' },
    { provider: 'anthropic', available: false, model: 'claude-3-5-sonnet-latest', details: 'Cloud LLM API' },
  ];

  const currentProviderInfo = providers.find((p) => p.provider === selectedProvider) || {
    provider: selectedProvider,
    model: status?.active_model || 'Local LLM',
    available: false,
  };

  const isAgentOnline = status?.agent_service_online ?? false;

  return (
    <div className="provider-selector-container">
      <div className="provider-info-row">
        <label htmlFor="provider-select" className="provider-label">
          Model Provider:
        </label>
        <div className="provider-controls">
          <select
            id="provider-select"
            className="provider-select"
            value={selectedProvider}
            onChange={(e) => onSelectProvider(e.target.value)}
            disabled={disabled}
            aria-label="Select LLM provider"
          >
            {providers.map((p) => (
              <option key={p.provider} value={p.provider}>
                {p.provider === 'ollama' ? 'Ollama (Local)' : 'Anthropic (Cloud)'}
                {p.available ? '' : ' - Not configured'}
              </option>
            ))}
          </select>

          <span
            className={`status-pill ${currentProviderInfo.available ? 'status-ready' : 'status-unready'}`}
            title={currentProviderInfo.details || (currentProviderInfo.available ? 'Ready' : 'Unavailable')}
          >
            <span className="status-dot" aria-hidden="true"></span>
            {currentProviderInfo.model || 'Default model'}
          </span>
        </div>
      </div>

      {!isAgentOnline && (
        <div className="agent-warning-banner" role="alert">
          <span className="warning-icon" aria-hidden="true">⚠️</span>
          <span>Node.js agent bridge is offline (expected on port 8001). Chat turns will fail until started.</span>
        </div>
      )}

      {selectedProvider === 'anthropic' && !currentProviderInfo.available && (
        <div className="provider-notice" role="note">
          <span aria-hidden="true">ℹ️</span>
          <span>
            Anthropic provider selected, but ANTHROPIC_API_KEY is not configured in root .env. Local Ollama is recommended.
          </span>
        </div>
      )}
    </div>
  );
}
