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
