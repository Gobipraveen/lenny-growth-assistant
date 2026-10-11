import React, { useState, useCallback, useMemo } from 'react';
import {
  Eye,
  Code2,
  Copy,
  Check,
  Download,
  Maximize2,
  Minimize2,
  X,
  RefreshCw,
  AlertTriangle,
  ShieldAlert,
  BookOpen,
  Clock,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  FileText,
  FilePenLine,
  Sparkles,
  LoaderCircle,
} from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer.jsx';
import { slugify } from '../utils/markdown.js';
import { prepareSandboxedSrcDoc, isGeneratingStatus } from '../utils/artifact.js';

export { prepareSandboxedSrcDoc };

/**
 * Three-Panel Workspace Artifact Viewer (Right Panel).
 * Polymorphic minimal viewer supporting:
 * 1. Ship 30 for 30 Markdown Essays (~1,250 words)
 * 2. Generic Markdown Strategic Reports & Playbooks
 * 3. Rendered HTML/CSS Visual Layouts & Dashboards in a strict sandboxed iframe
 */
export function ArtifactViewer({
  isOpen = false,
  onClose,
  artifact = null,
  isGenerating = false,
  isPollingTimedOut = false,
  onRefreshStatus = null,
  onOpenCreateEssay,
  onOpenCreateArtifact,
  onRetryGeneration,
}) {
  const [activeTab, setActiveTab] = useState('preview'); // 'preview' | 'code'
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isWarningsExpanded, setIsWarningsExpanded] = useState(false);

  // Determine artifact category & content
  const isEssay = Boolean(artifact?.essay_id || (!artifact?.artifact_type && artifact?.markdown));
  const artifactType = isEssay ? 'markdown' : (artifact?.artifact_type || 'markdown');
  const isHtml = artifactType === 'html';
  const rawContent = isEssay ? (artifact?.markdown || '') : (artifact?.source_content || '');
  const hasContent = Boolean(rawContent && rawContent.trim().length > 0);

  const title = artifact?.title || artifact?.topic || (isEssay ? 'Ship 30 for 30 Essay' : 'Growth Artifact');
  const status = artifact?.generation_status || (isGenerating ? 'generating' : 'empty');
  const isGeneratingState = isGeneratingStatus(status) || isGenerating;
  const wordCount = artifact?.word_count || 0;
  const targetWords = artifact?.target_word_count || 1250;
  const citations = artifact?.citations || [];
  const validationResults = artifact?.validation_results || {};
  const validationErrors = validationResults.errors || [];
  const validationWarnings = validationResults.warnings || [];

  // Deduplicate advisory warnings visually while maintaining counts
  const uniqueWarnings = useMemo(() => {
    if (!validationWarnings || validationWarnings.length === 0) return [];
    const counts = new Map();
    for (const w of validationWarnings) {
      counts.set(w, (counts.get(w) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([message, count]) => ({
      message,
      count,
    }));
  }, [validationWarnings]);

  // Generate trusted sandboxed iframe srcDoc
  const sandboxedSrcDoc = useMemo(() => {
    if (!isHtml || !hasContent || status === 'validation_failed' || status === 'failed') {
      return '';
    }
    return prepareSandboxedSrcDoc(rawContent);
  }, [isHtml, hasContent, status, rawContent]);

  // Copy raw content to clipboard
  const handleCopy = useCallback(() => {
    if (!hasContent) return;
    navigator.clipboard.writeText(rawContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [hasContent, rawContent]);

  // Export / Download file
  const handleDownload = useCallback(() => {
    if (!hasContent) return;
    const baseSlug = slugify(title || 'growth-artifact');
    const extension = isHtml ? 'html' : 'md';
    const mimeType = isHtml ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8';
    const filename = `${baseSlug}.${extension}`;

    const blob = new Blob([rawContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [hasContent, isHtml, title, rawContent]);

  if (!isOpen) return null;

  return (
    <aside
      className={`artifact-panel-shell ${isFullscreen ? 'fullscreen-mode' : ''}`}
      aria-label="Artifact viewer workspace"
      id="artifact-viewer-panel"
    >
      {/* Responsive Two-Tier Minimal Header Bar */}
      <div className="artifact-header">
        <div className="artifact-header-top">
          <div className="artifact-header-title-group">
            <span className="artifact-badge-icon" aria-hidden="true">
              {isHtml ? <Code2 size={16} /> : isEssay ? <FilePenLine size={16} /> : <FileText size={16} />}
            </span>
            <h3 className="artifact-title" title={title}>
              {title}
            </h3>
          </div>

          <div className="artifact-header-top-actions">
            {/* Fullscreen Toggle */}
            <button
              type="button"
              className={`artifact-action-btn btn-fullscreen-toggle ${isFullscreen ? 'active' : ''}`}
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? 'Exit full-screen mode' : 'Enter full-screen mode'}
              aria-label={isFullscreen ? 'Exit full-screen mode' : 'Enter full-screen mode'}
            >
              {isFullscreen ? (
                <Minimize2 size={14} aria-hidden="true" className="action-icon" />
              ) : (
                <Maximize2 size={14} aria-hidden="true" className="action-icon" />
              )}
              <span className="action-label desktop-only-label">{isFullscreen ? 'Exit' : 'Full'}</span>
            </button>

            {/* Close Panel Button */}
            <button
              type="button"
              className="artifact-close-btn"
              onClick={onClose}
              aria-label="Close artifact viewer panel"
              title="Close artifact panel"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="artifact-header-bottom">
          <div className="artifact-meta-row">
            <span className={`status-pill status-${status}`}>
              <span className="status-dot" aria-hidden="true" />
              {status === 'generating'
                ? 'Generating…'
                : status === 'completed'
                ? 'Completed'
                : status === 'validation_failed'
                ? 'Flagged'
                : status === 'insufficient_evidence'
                ? 'No Evidence'
                : status === 'failed'
                ? 'Failed'
                : 'Ready'}
            </span>

            <span className="artifact-type-pill">
              {isHtml ? 'HTML/CSS' : isEssay ? 'Ship 30' : 'Markdown'}
            </span>

            {isEssay && hasContent && (
              <span className="word-count-badge" title={`Target: ${targetWords} words`}>
                {wordCount} / {targetWords} w
              </span>
            )}
          </div>

          <div className="artifact-header-controls">
            {/* View Mode Toggle: Preview | Code */}
            {hasContent && (
              <div className="artifact-header-mode-toggle" role="tablist" aria-label="View mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'preview'}
                  className={`mode-toggle-btn ${activeTab === 'preview' ? 'active' : ''}`}
                  onClick={() => setActiveTab('preview')}
                  title={isHtml ? 'Visual Preview' : 'Formatted Document'}
                >
                  <Eye size={13} aria-hidden="true" />
                  <span>Preview</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'code'}
                  className={`mode-toggle-btn ${activeTab === 'code' ? 'active' : ''}`}
                  onClick={() => setActiveTab('code')}
                  title={isHtml ? 'HTML Source Code' : 'Markdown Source Code'}
                >
                  <Code2 size={13} aria-hidden="true" />
                  <span>Code</span>
                </button>
              </div>
            )}

            {/* Header Actions */}
            <div className="artifact-header-actions">
              {/* Copy Button */}
              <button
                type="button"
                className={`artifact-action-btn ${copied ? 'copied' : ''}`}
                onClick={handleCopy}
                disabled={!hasContent}
                title={copied ? 'Copied to clipboard!' : `Copy raw ${isHtml ? 'HTML' : 'Markdown'} to clipboard`}
                aria-label={`Copy ${isHtml ? 'HTML' : 'Markdown'} content`}
              >
                {copied ? (
                  <Check size={13} aria-hidden="true" className="action-icon text-success" />
                ) : (
                  <Copy size={13} aria-hidden="true" className="action-icon" />
                )}
                <span className="action-label desktop-only-label">{copied ? 'Copied' : 'Copy'}</span>
              </button>

              {/* Refresh Status Button */}
              {onRefreshStatus && isGeneratingState && (
                <button
                  type="button"
                  className="artifact-action-btn btn-refresh-header"
                  onClick={onRefreshStatus}
                  title="Refresh generation status from server"
                  aria-label="Refresh artifact status"
                >
                  <RefreshCw size={13} aria-hidden="true" className="action-icon" />
                  <span className="action-label desktop-only-label">Status</span>
                </button>
              )}

              {/* Download Button */}
              <button
                type="button"
                className="artifact-action-btn"
                onClick={handleDownload}
                disabled={!hasContent}
                title={`Download as .${isHtml ? 'html' : 'md'} file`}
                aria-label={`Download ${isHtml ? 'HTML' : 'Markdown'} file`}
              >
                <Download size={13} aria-hidden="true" className="action-icon" />
                <span className="action-label desktop-only-label">Export</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Artifact Viewport Area */}
      <div className="artifact-viewport" id="artifact-tabpanel" role="tabpanel">
        {/* State 1: Active In-Flight Generation (pending or generating) */}
        {isGeneratingState ? (
          <div className="artifact-generating-state" aria-live="polite">
            <div className="generating-pulse-icon" aria-hidden="true">
              <LoaderCircle size={28} className="spin-slow" />
            </div>
            <h4 className="generating-title">
              {status === 'pending'
                ? 'Generation Queued…'
                : isHtml
                ? 'Generating HTML/CSS layout…'
                : isEssay
                ? 'Generating Ship 30 essay…'
                : 'Generating artifact…'}
            </h4>
            <p className="generating-desc">
              {status === 'pending'
                ? 'Job is queued in the background agent service and will begin synthesizing shortly.'
                : isHtml
                ? 'Synthesizing responsive semantic HTML with embedded styling.'
                : "Drafting structured sections grounded in Lenny's Podcast transcripts."}
            </p>
            <div className="generating-steps-list">
              <div className={`step-item ${isGeneratingState ? 'active' : ''}`}>1. Searching podcast transcripts for evidence passages</div>
              <div className={`step-item ${status === 'generating' ? 'active' : ''}`}>
                {isHtml ? '2. Structuring semantic markup and self-contained CSS' : '2. Synthesizing narrative progression and framework'}
              </div>
              <div className="step-item">3. Validating security constraints & authentic citation provenance</div>
            </div>
            <div className="generating-polling-row">
              <span className="generating-note">
                {isPollingTimedOut
                  ? 'Auto-checking paused after limit. Server background job may still be finishing.'
                  : 'Observation active: polling status every 2.5s.'}
              </span>
              {onRefreshStatus && (
                <button
                  type="button"
                  className="btn-refresh-status"
                  onClick={onRefreshStatus}
                  title="Check latest status from server"
                >
                  <RefreshCw size={13} aria-hidden="true" /> Check Status Now
                </button>
              )}
            </div>
          </div>
        ) : status === 'failed' ? (
          /* State 2: Generation Failed */
          <div className="artifact-failed-card" role="alert">
            <AlertTriangle size={24} className="failure-icon" aria-hidden="true" />
            <h4>Generation Job Failed</h4>
            <p className="failure-message">{artifact?.error || 'Artifact generation encountered an unrecoverable error.'}</p>
            {onRetryGeneration && (
              <button
                type="button"
                className="btn-retry-generation"
                onClick={() => onRetryGeneration(artifact)}
              >
                Retry Generation
              </button>
            )}
          </div>
        ) : status === 'insufficient_evidence' ? (
          /* State 3: Insufficient Evidence */
          <div className="artifact-insufficient-card" role="alert">
            <BookOpen size={24} className="insufficient-icon" aria-hidden="true" />
            <h4>Insufficient Transcript Evidence</h4>
            <p>
              {artifact?.error || "We could not find sufficient verified transcript passages in Lenny's Podcast index to ground this topic."}
            </p>
            <div className="insufficient-tips">
              <strong>Tips for better retrieval:</strong>
              <ul>
                <li>Use topics covered by recurring Lenny's Podcast guests (e.g. Brian Chesky, Elena Verna, Shreyas Doshi).</li>
                <li>Focus on specific product growth themes: retention loops, pricing, marketplace liquidity, unscalable customer discovery.</li>
              </ul>
            </div>
            {onOpenCreateArtifact && (
              <button
                type="button"
                className="btn-rephrase-essay"
                onClick={onOpenCreateArtifact}
              >
                Try a Different Topic
              </button>
            )}
          </div>
        ) : hasContent ? (
          /* State 4: Content Ready (completed or validation_failed) */
          <div className="artifact-document-wrapper">
            {/* Prominent Fatal Security Validation Error Banner */}
            {(status === 'validation_failed' || validationErrors.length > 0) && (
              <div className="validation-alert-banner alert-danger" role="alert">
                <div className="alert-header">
                  <ShieldAlert size={16} aria-hidden="true" />
                  <strong>Security Validation Issues Flagged</strong>
                </div>
                <ul className="validation-issues-list">
                  {validationErrors.map((err, idx) => (
                    <li key={`err-${idx}`}><strong>Security Flag:</strong> {err}</li>
                  ))}
                </ul>
                {status === 'validation_failed' && isHtml && (
                  <p className="validation-mitigation-note">
                    Visual rendering has been disabled for safety. You can inspect the unexecuted markup in the Code tab.
                  </p>
                )}
              </div>
            )}

            {/* Collapsible Advisory Warnings Panel */}
            {validationWarnings.length > 0 && (
              <div className="validation-warnings-collapsible">
                <button
                  type="button"
                  className="warnings-toggle-btn"
                  onClick={() => setIsWarningsExpanded((prev) => !prev)}
                  aria-expanded={isWarningsExpanded}
                >
                  <span className="warnings-toggle-left">
                    <AlertTriangle size={14} className="warning-icon" aria-hidden="true" />
                    <span>Validation warnings ({validationWarnings.length})</span>
                  </span>
                  {isWarningsExpanded ? (
                    <ChevronDown size={14} aria-hidden="true" />
                  ) : (
                    <ChevronRight size={14} aria-hidden="true" />
                  )}
                </button>
                {isWarningsExpanded && (
                  <ul className="validation-warnings-list">
                    {uniqueWarnings.map(({ message, count }, idx) => (
                      <li key={`warn-${idx}`}>
                        <span className="warning-msg-text">{message}</span>
                        {count > 1 && (
                          <span className="warning-count-pill" title={`${count} occurrences`}>
                            ×{count}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Document Content View */}
            {activeTab === 'preview' ? (
              isHtml ? (
                status === 'validation_failed' ? (
                  <div className="unsafe-preview-blocker" role="alert">
                    <ShieldAlert size={28} className="blocker-icon" aria-hidden="true" />
                    <h4>Visual Preview Blocked by Security Policy</h4>
                    <p>
                      This generated HTML document contains forbidden elements or unsafe constructs and cannot be rendered.
                    </p>
                    <button
                      type="button"
                      className="btn-view-code-instead"
                      onClick={() => setActiveTab('code')}
                    >
                      Inspect Raw Markup in Code Tab
                    </button>
                  </div>
                ) : (
                  <div className="iframe-container">
                    <iframe
                      className="artifact-sandbox-iframe"
                      sandbox=""
                      title={title}
                      srcDoc={sandboxedSrcDoc}
                      aria-label="Sandboxed HTML artifact preview"
                    />
                  </div>
                )
              ) : (
                <div className="document-canvas">
                  <MarkdownRenderer markdown={rawContent} />
                </div>
              )
            ) : (
              <div className="code-canvas">
                <pre className="source-code-pre">
                  <code>{rawContent}</code>
                </pre>
              </div>
            )}

            {/* Verified Citations Drawer */}
            {citations.length > 0 && (
              <div className="artifact-citations-section">
                <div className="citations-section-header">
                  <BookOpen size={16} className="citations-icon" aria-hidden="true" />
                  <h4>
                    {status === 'validation_failed'
                      ? `Transcript Citations (${citations.length})`
                      : `Verified Evidence Citations (${citations.length})`}
                  </h4>
                </div>

                <div className="artifact-citations-grid">
                  {citations.map((cite, index) => {
                    const timestampRange = cite.start_timestamp && cite.end_timestamp
                      ? `${cite.start_timestamp} - ${cite.end_timestamp}`
                      : cite.start_timestamp || null;

                    return (
                      <article key={cite.chunk_id || index} className="artifact-citation-card">
                        <div className="citation-header-line">
                          <span className="cite-badge">Evidence #{index + 1}</span>
                          <strong className="cite-episode">{cite.episode_title}</strong>
                        </div>

                        <div className="cite-meta-line">
                          {cite.guest && <span><strong>Guest:</strong> {cite.guest}</span>}
                          {cite.speaker && <span><strong>Speaker:</strong> {cite.speaker}</span>}
                          {timestampRange && (
                            <span className="cite-time">
                              <Clock size={12} aria-hidden="true" /> {timestampRange}
                            </span>
                          )}
                        </div>

                        {cite.snippet && (
                          <blockquote className="cite-snippet">
                            "{cite.snippet}"
                          </blockquote>
                        )}

                        {cite.source_url && (
                          <a
                            href={cite.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="cite-youtube-link"
                          >
                            <span>Watch on YouTube</span>
                            <ExternalLink size={12} aria-hidden="true" />
                          </a>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* State 5: Empty Workspace */
          <div className="artifact-empty-state">
            <div className="empty-state-card">
              <div className="empty-state-icon" aria-hidden="true">
                <Sparkles size={28} />
              </div>

              <h4 className="empty-state-title">No Artifact Selected</h4>

              <p className="empty-state-desc">
                Generate an HTML/CSS visual dashboard, a strategic Markdown playbook, or a Ship 30 essay to inspect, copy, or export in this dedicated canvas.
              </p>

              <div className="artifact-features-list">
                <div className="feature-item">
                  <span className="feature-bullet" aria-hidden="true">
                    <Code2 size={16} />
                  </span>
                  <div>
                    <strong>Interactive HTML/CSS Artifacts</strong>
                    <p>Visual KPI cards, pricing tables, and growth dashboards isolated in a zero-privilege sandboxed iframe.</p>
                  </div>
                </div>

                <div className="feature-item">
                  <span className="feature-bullet" aria-hidden="true">
                    <FilePenLine size={16} />
                  </span>
                  <div>
                    <strong>Ship 30 for 30 Essays & Playbooks</strong>
                    <p>~1,250-word bounded essays with Hook, Trap, Breakthrough, Execution, and Framework sections.</p>
                  </div>
                </div>

                <div className="feature-item">
                  <span className="feature-bullet" aria-hidden="true">
                    <BookOpen size={16} />
                  </span>
                  <div>
                    <strong>Podcast Grounded</strong>
                    <p>Claims and insights are backed by Lenny's Podcast guest transcripts with real chunk citations.</p>
                  </div>
                </div>
              </div>

              <div className="empty-state-action-row">
                {onOpenCreateArtifact && (
                  <button
                    type="button"
                    className="btn-trigger-artifact-create"
                    onClick={onOpenCreateArtifact}
                  >
                    <Code2 size={14} aria-hidden="true" />
                    <span>Generate Visual HTML / Markdown</span>
                  </button>
                )}

                {onOpenCreateEssay && (
                  <button
                    type="button"
                    className="btn-trigger-essay-create"
                    onClick={onOpenCreateEssay}
                  >
                    <FilePenLine size={14} aria-hidden="true" />
                    <span>Draft Ship 30 Essay</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Artifact Footer */}
      <div className="artifact-footer">
        <span className="footer-tag">
          {artifact?.provider ? `Provider: ${artifact.provider}` : 'Artifact Engine'}
        </span>
        <span className="footer-status">
          {status === 'generating'
            ? 'In-Flight Generation…'
            : status === 'completed'
            ? 'Verified Output'
            : status === 'validation_failed'
            ? 'Validation Flagged'
            : status === 'insufficient_evidence'
            ? 'Insufficient Evidence'
            : status === 'failed'
            ? 'Generation Failed'
            : 'Standby'}
        </span>
      </div>
    </aside>
  );
}
