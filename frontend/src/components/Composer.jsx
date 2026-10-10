import React, { useState, useRef, useEffect } from 'react';

/**
 * Message input composer with multi-line support, keyboard shortcuts, and submit guards.
 */
export function Composer({
  onSendMessage,
  isSubmitting = false,
  disabled = false,
  placeholder = 'Ask a question grounded in Lenny’s Podcast transcripts (e.g. Airbnb growth, product-market fit)...',
  presetText = '',
}) {
  const [text, setText] = useState('');
  const textareaRef = useRef(null);

  // Sync external preset text (e.g. when user clicks a suggestion prompt)
  useEffect(() => {
    if (presetText) {
      setText(presetText);
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }
  }, [presetText]);

  // Auto-resize textarea based on content
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
    }
  }, [text]);

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || isSubmitting || disabled) {
      return;
    }
    onSendMessage(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e) => {
    // Enter without Shift sends message
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isBlank = !text.trim();

  return (
    <form className="chat-composer-form" onSubmit={handleSubmit} aria-label="Message composer">
      <div className="composer-inner">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={disabled || isSubmitting}
          className="composer-textarea"
          aria-label="Ask Lenny Growth Assistant"
          maxLength={4000}
        />

        <div className="composer-actions">
          <span className="composer-hint">
            <kbd>Enter</kbd> to send, <kbd>Shift</kbd>+<kbd>Enter</kbd> for newline
          </span>

          <button
            type="submit"
            disabled={isBlank || isSubmitting || disabled}
            className={`btn-send ${isSubmitting ? 'submitting' : ''}`}
            aria-label="Send message"
          >
            {isSubmitting ? (
              <span className="send-spinner" aria-hidden="true">⏳</span>
            ) : (
              <span className="send-icon" aria-hidden="true">➤</span>
            )}
            <span>{isSubmitting ? 'Sending...' : 'Send'}</span>
          </button>
        </div>
      </div>
    </form>
  );
}
