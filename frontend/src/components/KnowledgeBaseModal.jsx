import React, { useState, useEffect } from 'react';
import { fetchKnowledgeStatus } from '../api/client.js';

/**
 * Knowledge Base Information Modal.
 * Binds dynamically to GET /api/knowledge/status to show truthful indexed statistics.
 * Never displays invented or hardcoded numbers.
 */
export function KnowledgeBaseModal({ isOpen = false, onClose }) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    async function loadStats() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetchKnowledgeStatus();
        if (isMounted) {
          setData(res);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Unable to retrieve knowledge base statistics');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadStats();

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      isMounted = false;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="presentation"
      aria-hidden={!isOpen}
    >
      <div
        className="knowledge-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kb-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title-row">
            <span className="modal-icon" aria-hidden="true">🎙️</span>
            <div>
              <h3 id="kb-modal-title" className="modal-title">
                Lenny's Podcast Transcript Index
              </h3>
              <span className="modal-subtitle">
                PostgreSQL Evidence Base & Provenance
              </span>
            </div>
          </div>

          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close knowledge base dialog"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          {isLoading ? (
            <div className="kb-loading-state" aria-live="polite">
              <div className="loader-spinner" aria-hidden="true" />
              <p>Querying PostgreSQL transcript index status...</p>
            </div>
          ) : error ? (
            <div className="kb-error-card" role="alert">
              <span className="error-icon" aria-hidden="true">⚠️</span>
              <div className="kb-error-texts">
                <strong>Status Unavailable</strong>
                <p>{error}</p>
              </div>
              <button
                type="button"
                className="btn-retry-stats"
                onClick={async () => {
                  setIsLoading(true);
                  setError(null);
                  try {
                    const res = await fetchKnowledgeStatus();
                    setData(res);
                  } catch (err) {
                    setError(err.message || 'Unable to retrieve knowledge base statistics');
                  } finally {
                    setIsLoading(false);
                  }
                }}
              >
                Retry
              </button>
            </div>
          ) : data ? (
            <>
              {/* Actual Statistics Grid from Server */}
              <div className="kb-stats-grid">
                <div className="kb-stat-box">
                  <span className="stat-value">{data.total_transcripts}</span>
                  <span className="stat-label">Episodes Ingested</span>
                </div>
                <div className="kb-stat-box">
                  <span className="stat-value">{data.total_chunks}</span>
                  <span className="stat-label">Indexed Passages</span>
                </div>
                <div className="kb-stat-box">
                  <span className="stat-value">
                    {data.search_engine === 'postgresql_full_text' ? 'Full-Text' : data.search_engine}
                  </span>
                  <span className="stat-label">Search Engine</span>
                </div>
              </div>

              {/* Ingested Episodes List / Empty State */}
              <div className="kb-section">
                <h4 className="kb-section-title">
                  Indexed Transcripts in Database ({data.episodes ? data.episodes.length : 0})
                </h4>
                {data.episodes && data.episodes.length > 0 ? (
                  <div className="kb-episodes-list">
                    {data.episodes.map((ep) => (
                      <div key={ep.slug} className="kb-episode-item">
                        <div className="ep-info">
                          <strong className="ep-title">{ep.title}</strong>
                          {ep.guest && <span className="ep-guest">Guest: {ep.guest}</span>}
                        </div>
                        <span className="ep-chunks-badge">{ep.chunk_count} chunks</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="kb-empty-notice">
                    <p>
                      <strong>No transcripts currently ingested into PostgreSQL.</strong>
                    </p>
                    <span className="empty-subtext">
                      The upstream transcript collection requires running the ingestion pipeline to index episodes into the local database.
                    </span>
                  </div>
                )}
              </div>

              {/* Protocol Grounding Section */}
              <div className="kb-section">
                <h4 className="kb-section-title">🛡️ Evidence Grounding Protocol</h4>
                <ul className="kb-principles-list">
                  <li>
                    <strong>Fail-Closed Retrieval:</strong> If the database contains insufficient evidence for an essay topic, generation halts immediately with an <em>insufficient_evidence</em> status.
                  </li>
                  <li>
                    <strong>Deterministic Provenance:</strong> Claims cite verified passage chunks and authentic YouTube timestamps from Lenny's Podcast.
                  </li>
                  <li>
                    <strong>Database Isolation:</strong> Background workers open dedicated database sessions to guarantee data integrity.
                  </li>
                </ul>
              </div>
            </>
          ) : null}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-note">
            Status via FastAPI /api/knowledge/status
          </span>
          <button type="button" className="btn-modal-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
