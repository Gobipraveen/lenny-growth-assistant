import React, { useState, useEffect } from 'react';
import { FilePenLine, X, AlertTriangle, Sparkles, LoaderCircle } from 'lucide-react';

const PROVEN_APPROACHES = [
  { value: 'framework', label: 'Framework (Structured systems & mental models)' },
  { value: 'lessons', label: 'Lessons (Key insights & hard-earned takeaways)' },
  { value: 'mistakes', label: 'Mistakes (Common pitfalls to avoid)' },
  { value: 'steps', label: 'Steps (Sequential tactical implementation)' },
];

const FOUR_A_PATHS = [
  { value: 'actionable', label: 'Actionable (Concrete how-to playbook)' },
  { value: 'analytical', label: 'Analytical (Data-driven teardown & dynamics)' },
  { value: 'aspirational', label: 'Aspirational (Visionary transformation)' },
  { value: 'anthropological', label: 'Anthropological (Human & organizational behavior)' },
];

/**
 * Ship 30 for 30 Essay Creation Dialog.
 * Floating, accessible form gathering all parameters required by POST /api/sessions/{session_id}/essays.
 */
export function CreateEssayModal({
  isOpen = false,
  onClose,
  onSubmit,
  currentProvider = 'ollama',
  currentModel = 'qwen2.5:1.5b',
  isSubmitting = false,
}) {
  const [topic, setTopic] = useState('');
  const [audience, setAudience] = useState('Product Managers and Early-Stage Founders');
  const [intendedOutcome, setIntendedOutcome] = useState('');
  const [provenApproach, setProvenApproach] = useState('framework');
  const [fourAPath, setFourAPath] = useState('actionable');
  const [targetWordCount, setTargetWordCount] = useState(1250);
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

  const handleSubmit = (e) => {
    e.preventDefault();
    setFormError(null);

    const trimmedTopic = topic.trim();
    if (!trimmedTopic || trimmedTopic.length < 3) {
      setFormError('Essay topic is required and must be at least 3 characters.');
      return;
    }

    const words = parseInt(targetWordCount, 10);
    if (isNaN(words) || words < 500 || words > 3000) {
      setFormError('Target word count must be between 500 and 3,000 words.');
      return;
    }

    if (isSubmitting) return;

    onSubmit({
      topic: trimmedTopic,
      audience: audience.trim() || undefined,
      intended_outcome: intendedOutcome.trim() || undefined,
      proven_approach: provenApproach,
      four_a_path: fourAPath,
      target_word_count: words,
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
        className="create-essay-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-essay-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title-row">
            <span className="modal-icon" aria-hidden="true">
              <FilePenLine size={18} />
            </span>
            <div>
              <h3 id="create-essay-title" className="modal-title">
                New Ship 30 for 30 Essay
              </h3>
              <span className="modal-subtitle">
                ~1,250-word grounded long-form essay with narrative progression
              </span>
            </div>
          </div>

          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close essay creation dialog"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="modal-body">
            {formError && (
              <div className="form-error-banner" role="alert">
                <AlertTriangle size={14} aria-hidden="true" />
                <span>{formError}</span>
              </div>
            )}

            {/* Topic Input */}
            <div className="form-group">
              <label htmlFor="essay-topic-input" className="form-label required">
                Essay Topic
              </label>
              <input
                id="essay-topic-input"
                type="text"
                className="form-input"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Unscalable hospitality loops for early-stage customer retention"
                disabled={isSubmitting}
                autoFocus
                required
                minLength={3}
                maxLength={500}
              />
              <span className="form-hint">
                Must be covered in Lenny's Podcast transcripts for verified grounding.
              </span>
            </div>

            {/* Audience & Intended Outcome Row */}
            <div className="form-row-2">
              <div className="form-group">
                <label htmlFor="essay-audience-input" className="form-label">
                  Target Audience
                </label>
                <input
                  id="essay-audience-input"
                  type="text"
                  className="form-input"
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  placeholder="e.g. Founders, PMs, Growth Leads"
                  disabled={isSubmitting}
                  maxLength={255}
                />
              </div>

              <div className="form-group">
                <label htmlFor="essay-words-input" className="form-label">
                  Target Word Count
                </label>
                <input
                  id="essay-words-input"
                  type="number"
                  className="form-input"
                  value={targetWordCount}
                  onChange={(e) => setTargetWordCount(e.target.value)}
                  min={500}
                  max={3000}
                  step={50}
                  disabled={isSubmitting}
                />
                <span className="form-hint">Standard Ship 30 target: ~1,250 words</span>
              </div>
            </div>

            {/* Intended Outcome */}
            <div className="form-group">
              <label htmlFor="essay-outcome-input" className="form-label">
                Intended Reader Outcome (Optional)
              </label>
              <input
                id="essay-outcome-input"
                type="text"
                className="form-input"
                value={intendedOutcome}
                onChange={(e) => setIntendedOutcome(e.target.value)}
                placeholder="e.g. Reader understands how to run manual concierge MVP tests without writing code"
                disabled={isSubmitting}
                maxLength={500}
              />
            </div>

            {/* Proven Approach & 4A Writing Path */}
            <div className="form-row-2">
              <div className="form-group">
                <label htmlFor="essay-approach-select" className="form-label">
                  Proven Approach
                </label>
                <select
                  id="essay-approach-select"
                  className="form-select"
                  value={provenApproach}
                  onChange={(e) => setProvenApproach(e.target.value)}
                  disabled={isSubmitting}
                >
                  {PROVEN_APPROACHES.map((app) => (
                    <option key={app.value} value={app.value}>
                      {app.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="essay-path-select" className="form-label">
                  4A Editorial Lens
                </label>
                <select
                  id="essay-path-select"
                  className="form-select"
                  value={fourAPath}
                  onChange={(e) => setFourAPath(e.target.value)}
                  disabled={isSubmitting}
                >
                  {FOUR_A_PATHS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Provider Selection */}
            <div className="form-group">
              <label htmlFor="essay-provider-select" className="form-label">
                Model Provider
              </label>
              <select
                id="essay-provider-select"
                className="form-select"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                disabled={isSubmitting}
              >
                <option value="ollama">Ollama (Local model)</option>
                <option value="gemini">Google Gemini (Cloud)</option>
              </select>
            </div>
          </div>

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
              className={`btn-modal-submit ${isSubmitting ? 'submitting' : ''}`}
              disabled={isSubmitting || !topic.trim()}
            >
              {isSubmitting ? (
                <>
                  <LoaderCircle size={15} className="spin-slow" aria-hidden="true" />
                  <span>Initiating Draft…</span>
                </>
              ) : (
                <>
                  <Sparkles size={15} aria-hidden="true" />
                  <span>Generate Essay</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
