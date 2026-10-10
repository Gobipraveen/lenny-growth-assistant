import React, { useState } from 'react';

/**
 * Render verified citations from Lenny's Podcast transcripts.
 * Safely renders untrusted text without dangerouslySetInnerHTML.
 */
export function Citations({ citations }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!citations || !Array.isArray(citations) || citations.length === 0) {
    return null;
  }

  // Display initial preview of first citation or all if expanded
  const displayCitations = isExpanded ? citations : citations.slice(0, 2);

  return (
    <div className="citations-container" aria-label="Verified Source Citations">
      <div className="citations-header">
        <div className="citations-title">
          <span className="citations-icon" aria-hidden="true">🎙️</span>
          <span>Verified Podcast Sources ({citations.length})</span>
        </div>
        {citations.length > 2 && (
          <button
            type="button"
            className="citations-toggle-btn"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
          >
            {isExpanded ? 'Show fewer' : `Show all ${citations.length}`}
          </button>
        )}
      </div>

      <div className="citations-list">
        {displayCitations.map((cite, index) => {
          const timestampRange = cite.start_timestamp && cite.end_timestamp
            ? `${cite.start_timestamp} - ${cite.end_timestamp}`
            : cite.start_timestamp || cite.end_timestamp || null;

          return (
            <article key={cite.chunk_id || index} className="citation-card">
              <div className="citation-card-header">
                <span className="citation-badge">Source {index + 1}</span>
                <h4 className="citation-episode-title">{cite.episode_title}</h4>
              </div>

              <div className="citation-meta">
                {cite.guest && (
                  <span className="citation-meta-item">
                    <strong>Guest:</strong> {cite.guest}
                  </span>
                )}
                {cite.speaker && (
                  <span className="citation-meta-item">
                    <strong>Speaker:</strong> {cite.speaker}
                  </span>
                )}
                {timestampRange && (
                  <span className="citation-meta-item citation-timestamp">
                    <span aria-hidden="true">⏱️</span> {timestampRange}
                  </span>
                )}
              </div>

              {cite.snippet && (
                <blockquote className="citation-snippet">
                  "{cite.snippet}"
                </blockquote>
              )}

              {cite.source_url && (
                <div className="citation-footer">
                  <a
                    href={cite.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="citation-link"
                    title={`Watch "${cite.episode_title}" on YouTube`}
                  >
                    <span>Watch on YouTube</span>
                    <span aria-hidden="true"> ↗</span>
                  </a>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
