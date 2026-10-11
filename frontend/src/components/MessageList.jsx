import React, { useEffect, useRef } from 'react';
import { Sparkles, User, Bot, LoaderCircle, ArrowRight } from 'lucide-react';
import { Citations } from './Citations.jsx';
import { MarkdownRenderer } from './MarkdownRenderer.jsx';

const SUGGESTIONS = [
  'How did Airbnb find its first 1,000 guests and hosts?',
  'What are the key metrics for a marketplace business according to Brian Chesky?',
  'How should an early-stage B2B SaaS startup approach pricing and packaging?',
  'What is the difference between product-market fit and go-to-market fit?',
];

function formatTime(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function MessageList({
  messages = [],
  isSubmitting = false,
  pendingPrompt = '',
  onSelectSuggestion,
}) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSubmitting]);

  if (messages.length === 0 && !isSubmitting) {
    return (
      <div className="empty-chat-state" aria-label="Welcome view">
        <div className="welcome-card">
          <div className="welcome-avatar" aria-hidden="true">
            <Sparkles size={24} />
          </div>
          <h2>Turn Lenny's insights into growth strategies.</h2>
          <p className="welcome-desc">
            Ask any question about startup growth, product strategy, retention loops, or execution tactics. Every answer is grounded in verified Lenny's Podcast episode transcripts.
          </p>

          <div className="suggestions-container">
            <span className="suggestions-label">Try asking:</span>
            <div className="suggestions-grid">
              {SUGGESTIONS.map((text, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="suggestion-chip"
                  onClick={() => onSelectSuggestion && onSelectSuggestion(text)}
                >
                  <ArrowRight size={14} aria-hidden="true" className="suggestion-arrow" />
                  <span className="suggestion-text">{text}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="message-list-container" role="log" aria-live="polite" aria-label="Conversation messages">
      {messages.map((msg, index) => {
        const isUser = msg.role === 'user';
        const citations = msg.citations || msg.structured_metadata?.citations || [];
        const provider = msg.structured_metadata?.provider;
        const model = msg.structured_metadata?.model;
        const timeStr = formatTime(msg.created_at);

        return (
          <article
            key={msg.id || `msg-${index}`}
            className={`message-row ${isUser ? 'user-message-row' : 'assistant-message-row'}`}
          >
            <div className={`message-avatar ${isUser ? 'user-avatar' : 'assistant-avatar'}`} aria-hidden="true">
              {isUser ? <User size={15} /> : <Sparkles size={15} />}
            </div>

            <div className="message-bubble-container">
              <div className="message-header-meta">
                <span className="sender-name">{isUser ? 'You' : 'Lenny Assistant'}</span>
                {provider && model && (
                  <span className="provider-tag">
                    {provider} ({model})
                  </span>
                )}
                {timeStr && <span className="message-time">{timeStr}</span>}
                {msg.isOptimistic && <span className="optimistic-tag">Sending...</span>}
              </div>

              <div className={`message-bubble ${isUser ? 'user-bubble' : 'assistant-bubble'}`}>
                <MarkdownRenderer markdown={msg.content} className="chat-message-markdown" emptyFallback={null} />
              </div>

              {!isUser && citations.length > 0 && (
                <Citations citations={citations} />
              )}
            </div>
          </article>
        );
      })}

      {isSubmitting && (
        <article className="message-row assistant-message-row in-flight-row" aria-busy="true">
          <div className="message-avatar assistant-avatar" aria-hidden="true">
            <Sparkles size={15} />
          </div>
          <div className="message-bubble-container">
            <div className="message-header-meta">
              <span className="sender-name">Lenny Assistant</span>
              <span className="optimistic-tag">Researching transcripts...</span>
            </div>
            <div className="message-bubble assistant-bubble thinking-bubble">
              <div className="thinking-indicator">
                <LoaderCircle size={14} className="spin-slow" aria-hidden="true" />
                <span className="thinking-text">
                  Retrieving podcast evidence & synthesizing answer...
                </span>
              </div>
            </div>
          </div>
        </article>
      )}

      <div ref={bottomRef} className="scroll-anchor" aria-hidden="true" />
    </div>
  );
}
