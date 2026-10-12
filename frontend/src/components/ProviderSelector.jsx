import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';

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
    { provider: 'gemini', available: false, model: 'gemini-3.5-flash-lite', details: 'Google Gemini Cloud API' },
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
                {p.provider === 'ollama' ? 'Ollama (Local)' : 'Google Gemini (Cloud)'}
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
          <AlertTriangle size={14} aria-hidden="true" className="warning-icon" />
          <span>Node.js agent bridge is offline (expected on port 8001). Chat turns will fail until started.</span>
        </div>
      )}

      {selectedProvider === 'gemini' && !currentProviderInfo.available && (
        <div className="provider-notice" role="note">
          <Info size={14} aria-hidden="true" />
          <span>
            Google Gemini provider selected, but GEMINI_API_KEY is not configured in root .env. Local Ollama is recommended.
          </span>
        </div>
      )}
    </div>
  );
}
