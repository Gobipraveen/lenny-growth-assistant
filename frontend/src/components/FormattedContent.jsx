import React from 'react';

/**
 * Safely format text content containing paragraphs, code blocks, and bullet points.
 * NEVER uses dangerouslySetInnerHTML to ensure complete security against XSS.
 */
export function FormattedContent({ text = '' }) {
  if (!text) return null;

  // Split by code blocks first
  const parts = text.split(/(```[\s\S]*?```)/g);

  return (
    <div className="message-text-content">
      {parts.map((part, partIdx) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          // Extract language if specified on the first line
          const firstLineBreak = part.indexOf('\n');
          let codeContent = '';
          let language = '';
          if (firstLineBreak !== -1) {
            language = part.slice(3, firstLineBreak).trim();
            codeContent = part.slice(firstLineBreak + 1, -3);
          } else {
            codeContent = part.slice(3, -3);
          }

          return (
            <div key={partIdx} className="code-block-wrapper">
              {language && <div className="code-block-lang">{language}</div>}
              <pre className="code-block">
                <code>{codeContent}</code>
              </pre>
            </div>
          );
        }

        // Normal text: split into paragraphs by double newlines
        const paragraphs = part.split(/\n\n+/);
        return paragraphs.map((para, paraIdx) => {
          const trimmed = para.trim();
          if (!trimmed) return null;

          // Check if lines are bullet points
          const lines = trimmed.split('\n');
          const isBulletList = lines.every((line) => line.trim().startsWith('- ') || line.trim().startsWith('* '));

          if (isBulletList) {
            return (
              <ul key={`${partIdx}-${paraIdx}`} className="formatted-list">
                {lines.map((line, lineIdx) => {
                  const itemText = line.trim().replace(/^[-*]\s+/, '');
                  return <li key={lineIdx}>{renderInlineFormatting(itemText)}</li>;
                })}
              </ul>
            );
          }

          return (
            <p key={`${partIdx}-${paraIdx}`} className="formatted-paragraph">
              {lines.map((line, lineIdx) => (
                <React.Fragment key={lineIdx}>
                  {lineIdx > 0 && <br />}
                  {renderInlineFormatting(line)}
                </React.Fragment>
              ))}
            </p>
          );
        });
      })}
    </div>
  );
}

/**
 * Basic safe inline formatting: handles `inline code` and **bold**.
 */
function renderInlineFormatting(line) {
  // Match `code` and **bold**
  const tokens = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);

  return tokens.map((tok, i) => {
    if (tok.startsWith('`') && tok.endsWith('`') && tok.length > 2) {
      return (
        <code key={i} className="inline-code">
          {tok.slice(1, -1)}
        </code>
      );
    }
    if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) {
      return (
        <strong key={i} className="bold-text">
          {tok.slice(2, -2)}
        </strong>
      );
    }
    return tok;
  });
}
