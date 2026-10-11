import React, { useState, useEffect } from 'react';

const QUICK_START_TEMPLATES = [
  {
    id: 'growth-playbook',
    title: 'Growth Playbook',
    format: 'markdown',
    badge: 'Playbook',
    topic: 'Product-Led Growth Retention Loops',
    instructions:
      "Synthesize an actionable growth playbook based on Lenny's Podcast episodes with Elena Verna and Brian Balfour. Detail virality, freemium mechanics, retention loops, and self-serve expansion.",
  },
  {
    id: 'strategy-report',
    title: 'Product Strategy Report',
    format: 'markdown',
    badge: 'Strategy',
    topic: 'Marketplace Liquidity and Cold Start Strategy',
    instructions:
      "Create an executive product strategy report analyzing atomic networks, cold start dynamics, and competitive moats based on Lenny's interviews with Andrew Chen and Brian Chesky.",
  },
  {
    id: 'growth-dashboard',
    title: 'Growth Strategy Dashboard',
    format: 'html',
    badge: 'Dashboard',
    topic: 'B2B SaaS Growth Metrics & Retention Breakdown',
    instructions:
      'Build a responsive Retro Sunset Neutral visual dashboard comparing product-led vs sales-led growth metrics. Include KPI cards, cohort retention breakdown table, and takeaway summary with illustrative numbers explicitly labeled as sample data.',
  },
  {
    id: 'launch-landing-page',
    title: 'Product Launch Landing Page',
    format: 'html',
    badge: 'Landing Page',
    topic: 'Product Launch Pricing and Feature Showcase',
    instructions:
      'Build a high-converting product launch landing page with hero section, clear value proposition, social proof quotes, feature comparison grid, and CTA styling in semantic HTML and clean CSS.',
  },
];

/**
 * Generic Artifact Creation Dialog (Markdown or HTML/CSS).
 * Collects parameters for POST /api/sessions/{session_id}/artifacts.
 */
export function CreateArtifactModal({
  isOpen = false,
  onClose,
  onSubmit,
  currentProvider = 'ollama',
  currentModel = 'qwen2.5:1.5b',
  isSubmitting = false,
}) {
  const [artifactType, setArtifactType] = useState('html'); // 'html' | 'markdown'
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [instructions, setInstructions] = useState('');
  const [provider, setProvider] = useState(currentProvider);
  const [formError, setFormError] = useState(null);

  // Sync provider with parent workspace
  useEffect(() => {
    if (currentProvider) {
      setProvider(currentProvider);
    }
  }, [currentProvider]);

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const handleApplyTemplate = (tmpl) => {
    setArtifactType(tmpl.format);
    setTitle(tmpl.title);
    setTopic(tmpl.topic);
    setInstructions(tmpl.instructions);
    setFormError(null);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setFormError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle || trimmedTitle.length < 2) {
      setFormError('Artifact title is required and must be at least 2 characters.');
      return;
    }

    const trimmedInstructions = instructions.trim();
    if (!trimmedInstructions || trimmedInstructions.length < 3) {
      setFormError('Instructions are required and must be at least 3 characters.');
      return;
    }

    if (isSubmitting) return;

    onSubmit({
      title: trimmedTitle,
      artifact_type: artifactType,
      instructions: trimmedInstructions,
      topic: topic.trim() || undefined,
      provider,
    });
  };

  return (
    <div
      className="modal-backdrop"
      onClick={isSubmitting ? undefined : onClose}
      role="presentation"
      aria-hidden={!isOpen}
    >
      <div
        className="create-essay-modal-card create-artifact-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-artifact-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="modal-header-row">
          <div className="modal-header-title-box">
            <span className="modal-header-icon" aria-hidden="true">
              {artifactType === 'html' ? '🌐' : '📝'}
            </span>
            <div>
              <h3 id="create-artifact-title" className="modal-heading">
                Generate Growth Artifact
              </h3>
              <p className="modal-subheading">
                Generate semantic HTML/CSS visual layouts or structured Markdown playbooks grounded in Lenny's Podcast.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Quick-Start Templates */}
        <div className="quick-start-section">
          <div className="quick-start-label">
            <span aria-hidden="true">⚡</span> Quick-Start Templates:
          </div>
          <div className="quick-start-grid">
            {QUICK_START_TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.id}
                type="button"
                className={`quick-start-chip ${artifactType === tmpl.format && title === tmpl.title ? 'active' : ''}`}
                onClick={() => handleApplyTemplate(tmpl)}
                disabled={isSubmitting}
              >
                <span className="tmpl-badge">{tmpl.badge}</span>
                <span className="tmpl-title">{tmpl.title}</span>
              </button>
            ))}
          </div>
        </div>

        {formError && (
          <div className="form-error-callout" role="alert">
            <span aria-hidden="true">⚠️</span>
            <span>{formError}</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="create-essay-form">
          {/* Format Selector */}
          <div className="form-field-group">
            <label className="form-field-label">
              <span>Artifact Format:</span>
            </label>
            <div className="artifact-format-selector" role="radiogroup" aria-label="Artifact format selector">
              <button
                type="button"
                role="radio"
                aria-checked={artifactType === 'html'}
                className={`format-toggle-btn ${artifactType === 'html' ? 'active' : ''}`}
                onClick={() => setArtifactType('html')}
                disabled={isSubmitting}
              >
                <span aria-hidden="true">🌐</span>
                <div>
                  <strong>HTML / CSS Layout</strong>
                  <span className="format-desc">Visual dashboards, product cards, or comparison tables</span>
                </div>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={artifactType === 'markdown'}
                className={`format-toggle-btn ${artifactType === 'markdown' ? 'active' : ''}`}
                onClick={() => setArtifactType('markdown')}
                disabled={isSubmitting}
              >
                <span aria-hidden="true">📝</span>
                <div>
                  <strong>Markdown Report</strong>
                  <span className="format-desc">Structured playbooks, teardowns, and strategic frameworks</span>
                </div>
              </button>
            </div>
          </div>

          {/* Title */}
          <div className="form-field-group">
            <label htmlFor="artifact-title-input" className="form-field-label">
              <span>Artifact Title:</span>
              <span className="required-indicator">*</span>
            </label>
            <input
              id="artifact-title-input"
              type="text"
              className="form-text-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. B2B SaaS Growth & Monetization Dashboard"
              maxLength={500}
              disabled={isSubmitting}
              required
            />
          </div>

          {/* Retrieval Topic */}
          <div className="form-field-group">
            <label htmlFor="artifact-topic-input" className="form-field-label">
              <span>Transcript Evidence Topic (Optional):</span>
              <span className="optional-tag">Used to search 50+ podcast episodes</span>
            </label>
            <input
              id="artifact-topic-input"
              type="text"
              className="form-text-input"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Elena Verna on B2B product-led loops and self-serve monetization"
              maxLength={500}
              disabled={isSubmitting}
            />
          </div>

          {/* Instructions */}
          <div className="form-field-group">
            <label htmlFor="artifact-instructions-input" className="form-field-label">
              <span>Design & Content Instructions:</span>
              <span className="required-indicator">*</span>
            </label>
            <textarea
              id="artifact-instructions-input"
              className="form-text-area"
              rows={4}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={
                artifactType === 'html'
                  ? 'Detail visual components, KPI cards, tables, or product comparison sections. Avoid external images and remote scripts.'
                  : 'Specify strategic pillars, sections, takeaways, and framework structure.'
              }
              maxLength={5000}
              disabled={isSubmitting}
              required
            />
          </div>

          {/* Active Model / Provider Indicator */}
          <div className="modal-engine-info-row">
            <div className="engine-info-item">
              <span className="info-label">Active Provider:</span>
              <span className="info-val">{provider === 'anthropic' ? 'Anthropic Claude' : 'Ollama Local LLM'}</span>
            </div>
            <div className="engine-info-item">
              <span className="info-label">Model:</span>
              <span className="info-val">{currentModel || (provider === 'anthropic' ? 'Claude 3.5 Sonnet' : 'qwen2.5:1.5b')}</span>
            </div>
            <div className="engine-info-item">
              <span className="info-label">Security Sandbox:</span>
              <span className="info-val secure">Empty Iframe + Strict CSP</span>
            </div>
          </div>

          {/* Form Actions */}
          <div className="modal-actions-row">
            <button
              type="button"
              className="btn-modal-cancel"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-modal-submit"
              disabled={isSubmitting || !title.trim() || !instructions.trim()}
            >
              {isSubmitting ? (
                <>
                  <span className="spinner-dots" aria-hidden="true" />
                  <span>Drafting Artifact…</span>
                </>
              ) : (
                <>
                  <span aria-hidden="true">{artifactType === 'html' ? '🌐' : '📝'}</span>
                  <span>Generate {artifactType === 'html' ? 'HTML/CSS' : 'Markdown'} Artifact</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
