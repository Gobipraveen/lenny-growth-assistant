import React from 'react';
import { MarkdownRenderer } from './MarkdownRenderer.jsx';

/**
 * Backward-compatible FormattedContent component.
 * Delegates directly to MarkdownRenderer for full Markdown support:
 * headings (H1-H4), unordered and ordered lists, blockquotes, code blocks,
 * bold, italics, inline code, and safe links without raw HTML injection.
 */
export function FormattedContent({ text = '', markdown = '', className = '' }) {
  const content = markdown || text || '';
  return <MarkdownRenderer markdown={content} className={className} emptyFallback={null} />;
}
