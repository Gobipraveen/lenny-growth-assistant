import React from 'react';

/**
 * Protocol validator to prevent XSS via dangerous URL schemes (e.g. javascript:, data:, vbscript:).
 * Only allows http:, https:, mailto:, and anchor links (#).
 */
export function isSafeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:') || trimmed.startsWith('vbscript:')) {
    return false;
  }
  return (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('/')
  );
}

/**
 * Turn an essay title into a safe, alphanumeric filename.
 */
export function slugify(text) {
  if (!text || typeof text !== 'string') return 'ship30-essay';
  const clean = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return clean ? clean.slice(0, 50) : 'ship30-essay';
}

/**
 * Safely parse inline markdown formatting into React elements:
 * - Links: [label](url) with safe URL validation
 * - Bold: **text** or __text__
 * - Italics: *text* or _text_
 * - Inline code: `code`
 * - Citation tags: [chunk_id: xxx]
 * NEVER uses dangerouslySetInnerHTML.
 */
export function renderSafeInline(text, keyPrefix = '') {
  if (!text) return null;

  // Tokenize by links, inline code, bold, italics, citation tags
  // Regex captures:
  // 1: link markdown [text](url)
  // 2: inline code `code`
  // 3: bold **text**
  // 4: italics *text*
  // 5: citation tag [chunk_id: ...]
  const tokenRegex = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[(?:chunk_id|chunk)[^\]]+\])/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, idx) => {
    const key = `${keyPrefix}-${idx}`;
    if (!part) return null;

    // 1. Link [label](url)
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const [, label, rawUrl] = linkMatch;
      const safe = isSafeUrl(rawUrl);
      if (safe) {
        return React.createElement(
          'a',
          {
            key,
            href: rawUrl,
            target: '_blank',
            rel: 'noopener noreferrer',
            className: 'md-link',
          },
          label
        );
      }
      // Unsafe link: render label text only (neutralize dangerous protocols like javascript: or data:)
      return React.createElement('span', { key, className: 'md-unsafe-link' }, label);
    }

    // 2. Inline code `code`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return React.createElement(
        'code',
        { key, className: 'md-inline-code' },
        part.slice(1, -1)
      );
    }

    // 3. Bold **text**
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return React.createElement(
        'strong',
        { key, className: 'md-bold' },
        renderSafeInline(part.slice(2, -2), `${key}-b`)
      );
    }

    // 4. Italics *text*
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2 && !part.startsWith('**')) {
      return React.createElement(
        'em',
        { key, className: 'md-italic' },
        part.slice(1, -1)
      );
    }

    // 5. Citation tag [chunk_id: xxx]
    const citeMatch = part.match(/^\[(?:chunk_id|chunk)(?::|=|\s+is\s+|:\s*)["']?([a-zA-Z0-9_-]+)["']?\]$/i);
    if (citeMatch) {
      return React.createElement(
        'span',
        { key, className: 'md-citation-pill', title: `Transcript Evidence Chunk: ${citeMatch[1]}` },
        React.createElement('span', { key: 'icon', className: 'pill-icon', 'aria-hidden': true }, '🎙️'),
        React.createElement('span', { key: 'text' }, ' Source Chunk')
      );
    }

    return part;
  });
}

/**
 * Parses markdown into structured semantic block tokens:
 * - heading (level 1-4, text)
 * - paragraph (lines)
 * - blockquote (lines)
 * - ul (items)
 * - ol (items)
 * - table (rows)
 * - code_block (lang, code)
 * - hr
 */
export function parseMarkdownBlocks(markdown = '') {
  if (!markdown || typeof markdown !== 'string') {
    return [];
  }

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

  return blocks;
}
