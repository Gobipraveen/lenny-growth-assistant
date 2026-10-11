import React from 'react';
import { renderSafeInline, parseMarkdownBlocks } from '../utils/markdown.js';

/**
 * Pure React Safe Markdown Document Renderer.
 * Converts structured Markdown into standard semantic React elements (H1-H4, Blockquotes, Lists, Tables, Code).
 * Guaranteed 100% XSS-immune: never injects raw HTML into the DOM.
 */
export function MarkdownRenderer({ markdown = '', className = '', emptyFallback = null }) {
  if (!markdown || typeof markdown !== 'string' || !markdown.trim()) {
    if (emptyFallback !== null) return emptyFallback;
    return <div className="md-empty-document">No document content available.</div>;
  }

  const blocks = parseMarkdownBlocks(markdown);

  return (
    <div className={`markdown-document-body ${className}`} role="document">
      {blocks.map((block) => {
        switch (block.type) {
          case 'heading': {
            const Tag = `h${block.level}`;
            return (
              <Tag key={block.id} className={`md-heading md-h${block.level}`}>
                {renderSafeInline(block.text, block.id)}
              </Tag>
            );
          }

          case 'paragraph': {
            return (
              <p key={block.id} className="md-paragraph">
                {block.lines.map((line, lIdx) => (
                  <React.Fragment key={`${block.id}-l${lIdx}`}>
                    {lIdx > 0 && <br />}
                    {renderSafeInline(line, `${block.id}-${lIdx}`)}
                  </React.Fragment>
                ))}
              </p>
            );
          }

          case 'blockquote': {
            return (
              <blockquote key={block.id} className="md-blockquote">
                {block.lines.map((l, qIdx) => (
                  <p key={`${block.id}-q${qIdx}`} className="md-quote-line">
                    {renderSafeInline(l, `${block.id}-q${qIdx}`)}
                  </p>
                ))}
              </blockquote>
            );
          }

          case 'ul': {
            return (
              <ul key={block.id} className="md-ul">
                {block.items.map((item, iIdx) => (
                  <li key={`${block.id}-li${iIdx}`} className="md-li">
                    {renderSafeInline(item, `${block.id}-li${iIdx}`)}
                  </li>
                ))}
              </ul>
            );
          }

          case 'ol': {
            return (
              <ol key={block.id} className="md-ol">
                {block.items.map((item, iIdx) => (
                  <li key={`${block.id}-oli${iIdx}`} className="md-li">
                    {renderSafeInline(item, `${block.id}-oli${iIdx}`)}
                  </li>
                ))}
              </ol>
            );
          }

          case 'table': {
            // Filter out delimiter row (e.g. |---|---|)
            const cleanRows = block.rows.filter((r) => !/^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(r));
            if (cleanRows.length === 0) return null;

            const headerCells = cleanRows[0]
              .split('|')
              .slice(1, -1)
              .map((c) => c.trim());
            const bodyRows = cleanRows.slice(1).map((r) =>
              r
                .split('|')
                .slice(1, -1)
                .map((c) => c.trim())
            );

            return (
              <div key={block.id} className="md-table-wrapper">
                <table className="md-table">
                  <thead>
                    <tr>
                      {headerCells.map((h, hIdx) => (
                        <th key={`th-${hIdx}`}>{renderSafeInline(h, `${block.id}-th${hIdx}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bodyRows.map((row, rIdx) => (
                      <tr key={`tr-${rIdx}`}>
                        {row.map((cell, cIdx) => (
                          <td key={`td-${rIdx}-${cIdx}`}>{renderSafeInline(cell, `${block.id}-td${rIdx}-${cIdx}`)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }

          case 'code_block': {
            return (
              <div key={block.id} className="md-code-block-container">
                {block.lang && <span className="md-code-lang">{block.lang}</span>}
                <pre className="md-pre">
                  <code>{block.code}</code>
                </pre>
              </div>
            );
          }

          case 'hr': {
            return <hr key={block.id} className="md-hr" />;
          }

          default:
            return null;
        }
      })}
    </div>
  );
}
