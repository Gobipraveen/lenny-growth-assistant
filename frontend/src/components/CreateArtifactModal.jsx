import React, { useState, useEffect } from 'react';
import { Code2, FileText, X, Sparkles, AlertTriangle, LoaderCircle } from 'lucide-react';

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
        <div className="modal-header">
          <div className="modal-title-row">
            <span className="modal-icon" aria-hidden="true">
              {artifactType === 'html' ? <Code2 size={18} /> : <FileText size={18} />}
            </span>
            <div>
              <h3 id="create-artifact-title" className="modal-title">
                Generate Growth Artifact
              </h3>
              <span className="modal-subtitle">
                Semantic HTML/CSS layouts or structured Markdown playbooks grounded in Lenny's Podcast
              </span>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="modal-body">
            {/* Quick-Start Templates */}
            <div className="quick-start-section">
              <div className="quick-start-label">
                <Sparkles size={14} aria-hidden="true" /> Quick-Start Templates:
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
              <div className="form-error-banner" role="alert">
                <AlertTriangle size={14} aria-hidden="true" />
                <span>{formError}</span>
              </div>
            )}

            {/* Format Selector */}
            <div className="form-group">
              <label className="form-label">
                Artifact Format
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
                  <Code2 size={16} aria-hidden="true" />
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
                  <FileText size={16} aria-hidden="true" />
                  <div>
                    <strong>Markdown Report</strong>
                    <span className="format-desc">Structured playbooks, teardowns, and strategic frameworks</span>
                  </div>
                </button>
              </div>
            </div>

            {/* Title */}
            <div className="form-group">
              <label htmlFor="artifact-title-input" className="form-label required">
                Artifact Title
              </label>
              <input
                id="artifact-title-input"
                type="text"
                className="form-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. B2B SaaS Growth & Monetization Dashboard"
                maxLength={500}
                disabled={isSubmitting}
                required
              />
            </div>

            {/* Retrieval Topic */}
            <div className="form-group">
              <label htmlFor="artifact-topic-input" className="form-label">
                Transcript Evidence Topic (Optional)
              </label>
              <input
                id="artifact-topic-input"
                type="text"
                className="form-input"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Elena Verna on B2B product-led loops and self-serve monetization"
                maxLength={500}
                disabled={isSubmitting}
              />
              <span className="form-hint">Used to search 50+ podcast episodes for grounding passages.</span>
            </div>

            {/* Instructions */}
            <div className="form-group">
              <label htmlFor="artifact-instructions-input" className="form-label required">
                Design & Content Instructions
              </label>
              <textarea
                id="artifact-instructions-input"
                className="form-textarea"
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
          </div>

          {/* Form Actions Footer */}
          <div className="modal-footer">
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
                  <LoaderCircle size={15} className="spin-slow" aria-hidden="true" />
                  <span>Drafting Artifact…</span>
                </>
              ) : (
                <>
                  {artifactType === 'html' ? <Code2 size={15} aria-hidden="true" /> : <FileText size={15} aria-hidden="true" />}
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
