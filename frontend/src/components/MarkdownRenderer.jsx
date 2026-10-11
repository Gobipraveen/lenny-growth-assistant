import React from 'react';
import { renderSafeInline } from '../utils/markdown.js';

/**
 * Pure React Safe Markdown Document Renderer.
 * Converts structured Markdown into standard semantic React elements (H1-H4, Blockquotes, Lists, Tables, Code).
 * Guaranteed 100% XSS-immune: never uses dangerouslySetInnerHTML or unescaped HTML injection.
 */
export function MarkdownRenderer({ markdown = '', className = '' }) {
  if (!markdown || typeof markdown !== 'string') {
    return <div className="md-empty-document">No document content available.</div>;
  }

  // 1. Separate code blocks from text to avoid false-matching markdown syntax inside code
  const blocks = [];
  const rawSections = markdown.split(/(```[\s\S]*?```)/g);

  rawSections.forEach((section, sIdx) => {
    if (section.startsWith('```') && section.endsWith('```')) {
      const firstLineBreak = section.indexOf('\n');
      let lang = '';
      let code = '';
      if (firstLineBreak !== -1) {
        lang = section.slice(3, firstLineBreak).trim();
        code = section.slice(firstLineBreak + 1, -3);
      } else {
        code = section.slice(3, -3);
      }
      blocks.push({
        type: 'code_block',
        id: `code-${sIdx}`,
        lang,
        code,
      });
      return;
    }

    // Process normal prose lines
    const rawLines = section.split('\n');
    let currentBlock = null;

    const flushCurrent = () => {
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = null;
      }
    };

    let idx = 0;
    while (idx < rawLines.length) {
      const line = rawLines[idx];
      const trimmed = line.trim();

      // Empty line closes active paragraph or lists
      if (!trimmed) {
        flushCurrent();
        idx++;
        continue;
      }

      // Horizontal Rule
      if (/^(?:---|\*\*\*|___)$/.test(trimmed)) {
        flushCurrent();
        blocks.push({ type: 'hr', id: `hr-${sIdx}-${idx}` });
        idx++;
        continue;
      }

      // Headings: H1 - H4
      const hMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (hMatch) {
        flushCurrent();
        const level = hMatch[1].length;
        blocks.push({
          type: 'heading',
          level,
          id: `h-${sIdx}-${idx}`,
          text: hMatch[2].trim(),
        });
        idx++;
        continue;
      }

      // Blockquote
      if (trimmed.startsWith('>')) {
        const quoteText = trimmed.replace(/^>\s*/, '');
        if (currentBlock && currentBlock.type === 'blockquote') {
          currentBlock.lines.push(quoteText);
        } else {
          flushCurrent();
          currentBlock = {
            type: 'blockquote',
            id: `quote-${sIdx}-${idx}`,
            lines: [quoteText],
          };
        }
        idx++;
        continue;
      }

      // Table line
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        if (currentBlock && currentBlock.type === 'table') {
          currentBlock.rows.push(trimmed);
        } else {
          flushCurrent();
          currentBlock = {
            type: 'table',
            id: `tbl-${sIdx}-${idx}`,
            rows: [trimmed],
          };
        }
        idx++;
        continue;
      }

      // Unordered List item (- or *)
      const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
      if (ulMatch) {
        if (currentBlock && currentBlock.type === 'ul') {
          currentBlock.items.push(ulMatch[1]);
        } else {
          flushCurrent();
          currentBlock = {
            type: 'ul',
            id: `ul-${sIdx}-${idx}`,
            items: [ulMatch[1]],
          };
        }
        idx++;
        continue;
      }

      // Ordered List item (1. )
      const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
      if (olMatch) {
        if (currentBlock && currentBlock.type === 'ol') {
          currentBlock.items.push(olMatch[1]);
        } else {
          flushCurrent();
          currentBlock = {
            type: 'ol',
            id: `ol-${sIdx}-${idx}`,
            items: [olMatch[1]],
          };
        }
        idx++;
        continue;
      }

      // Standard Paragraph line
      if (currentBlock && currentBlock.type === 'paragraph') {
        currentBlock.lines.push(line);
      } else {
        flushCurrent();
        currentBlock = {
          type: 'paragraph',
          id: `p-${sIdx}-${idx}`,
          lines: [line],
        };
      }
      idx++;
    }
    flushCurrent();
  });

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
