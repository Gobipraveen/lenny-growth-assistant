import { slugify } from './markdown.js';

/**
 * Strict Content Security Policy meta tag for the sandboxed iframe preview.
 * Allows only inline styles needed for document rendering.
 * Disallows scripts, remote connections, images, fonts, media, objects, frames, form actions, and base URIs.
 */
export const ARTIFACT_CSP_META = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; connect-src \'none\'; img-src \'none\'; font-src \'none\'; media-src \'none\'; object-src \'none\'; frame-src \'none\'; form-action \'none\'; base-uri \'none\'; style-src \'unsafe-inline\';">';

/**
 * Polling configuration for observing in-progress generation jobs.
 * Supports the full 300s backend execution limit + 30s buffer.
 */
export const ARTIFACT_POLLING_CONFIG = {
  INTERVAL_MS: 2500, // 2.5 seconds per poll attempt
  TIMEOUT_MS: 330000, // 330 seconds total (300s backend execution + 30s network buffer)
  get MAX_ATTEMPTS() {
    return Math.ceil(this.TIMEOUT_MS / this.INTERVAL_MS); // 132 attempts
  },
};

/**
 * Checks if artifact generation status is in an active (in-progress) state.
 */
export function isGeneratingStatus(status) {
  return status === 'pending' || status === 'generating';
}

/**
 * Prepares trusted srcDoc content with an injected strict Content Security Policy.
 * Uses a trusted outer HTML5 document skeleton to ensure CSP and sandbox rules cannot
 * be bypassed, displaced, or neutralized by malformed or adversarial inner HTML.
 *
 * 1. Strips any rogue meta tags (including spoofed CSP and refresh directives).
 * 2. Strips any base tags (preventing base-URI redirection).
 * 3. Strips any script tags (defense-in-depth before iframe sandbox).
 * 4. Extracts style blocks and safely nests them in the trusted <head>.
 * 5. Places the cleaned body content into the trusted <body>.
 *
 * @param {string} htmlContent - Raw HTML content to sandbox
 * @returns {string} Sandboxed HTML content inside a trusted outer document with strict CSP
 */
export function prepareSandboxedSrcDoc(htmlContent) {
  if (!htmlContent || typeof htmlContent !== 'string') {
    return '';
  }

  // 1. Strip any meta tags (prevents CSP spoofing, refresh tags, charset switching)
  let cleaned = htmlContent.replace(/<meta[^>]*>/gi, '');

  // 2. Strip any base tags (prevents base URI redirection)
  cleaned = cleaned.replace(/<base[^>]*>/gi, '');

  // 3. Strip any script tags as defense-in-depth
  cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // 4. Extract <style> blocks from untrusted content
  const styleBlocks = [];
  cleaned = cleaned.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (match) => {
    styleBlocks.push(match);
    return '';
  });

  // 5. Extract body content or clean document tags
  let bodyContent = cleaned;
  const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    bodyContent = bodyMatch[1];
  } else {
    // If no body tags, strip any outer html / head / doctype wrapper tags
    bodyContent = bodyContent
      .replace(/<!DOCTYPE[^>]*>/gi, '')
      .replace(/<\/?html[^>]*>/gi, '')
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
      .replace(/<\/?body[^>]*>/gi, '');
  }

  const combinedStyles = styleBlocks.join('\n    ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    ${ARTIFACT_CSP_META}
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${combinedStyles}
</head>
<body>
${bodyContent.trim()}
</body>
</html>`;
}

/**
 * Derives a safe downloadable filename for an artifact or essay.
 *
 * @param {Object} artifact - Artifact or essay object
 * @returns {string} Sanitized filename with appropriate extension (.html or .md)
 */
export function getArtifactFilename(artifact) {
  if (!artifact) return 'artifact.txt';

  const rawTitle = artifact.title || artifact.topic || 'growth-artifact';
  const baseName = slugify(rawTitle);

  const isHtml = artifact.artifact_type === 'html';
  const ext = isHtml ? 'html' : 'md';

  return `${baseName}.${ext}`;
}

/**
 * Validates artifact creation form state.
 *
 * @param {Object} form - Form values { title, artifact_type, instructions, topic }
 * @returns {{ valid: boolean, error?: string, payload?: Object }} Validation result
 */
export function validateArtifactForm(form) {
  if (!form) {
    return { valid: false, error: 'Form data is missing.' };
  }

  const title = (form.title || '').trim();
  if (!title) {
    return { valid: false, error: 'Artifact title or topic is required.' };
  }
  if (title.length < 2) {
    return { valid: false, error: 'Title must be at least 2 characters.' };
  }

  const format = (form.artifact_type || 'markdown').toLowerCase();
  if (format !== 'html' && format !== 'markdown') {
    return { valid: false, error: 'Invalid format. Supported formats are Markdown and HTML/CSS.' };
  }

  const instructions = (form.instructions || '').trim();

  return {
    valid: true,
    payload: {
      title,
      artifact_type: format,
      instructions: instructions || `Create a detailed ${format === 'html' ? 'HTML/CSS dashboard' : 'Markdown guide'} for: ${title}`,
      topic: form.topic ? form.topic.trim() : title,
      provider: form.provider || 'ollama',
      model: form.model || undefined,
    },
  };
}

/**
 * Quick-start templates consistent with Lenny Growth Assistant requirements.
 */
export const QUICK_START_PRESETS = [
  {
    id: 'growth-playbook',
    title: 'Growth Playbook',
    artifact_type: 'markdown',
    badge: 'Markdown',
    description: 'Comprehensive, actionable growth playbook with frameworks, tactics, and metrics.',
    instructions: 'Create a comprehensive Growth Playbook synthesizing podcast insights into actionable acquisition, retention, and monetization strategies.',
  },
  {
    id: 'product-strategy-report',
    title: 'Product Strategy Report',
    artifact_type: 'markdown',
    badge: 'Markdown',
    description: 'Structured strategic analysis covering market opportunity, positioning, and execution.',
    instructions: 'Draft an executive Product Strategy Report outlining core ICP, value proposition, competitive defensibility, and roadmap milestones.',
  },
  {
    id: 'growth-dashboard',
    title: 'Growth Strategy Dashboard',
    artifact_type: 'html',
    badge: 'HTML/CSS',
    description: 'Visual executive dashboard with KPI metric cards, funnel breakdown, and growth loops.',
    instructions: 'Design an executive Growth Strategy Dashboard using clean semantic HTML and modern inline CSS with dark mode styling, metric cards, funnel stages, and strategic priorities.',
  },
  {
    id: 'product-landing-page',
    title: 'Product Launch Landing Page',
    artifact_type: 'html',
    badge: 'HTML/CSS',
    description: 'High-converting launch landing page layout with hero, social proof, and feature highlights.',
    instructions: 'Build a high-converting Product Launch Landing Page with hero section, clear value proposition, social proof quotes, feature grid, and CTA styling in semantic HTML and clean CSS.',
  },
];

/**
 * Maps artifact generation status to user-friendly label, badge class, and status details.
 *
 * @param {string} status - Raw status enum value
 * @returns {{ label: string, className: string, isTerminal: boolean, canRetry: boolean }}
 */
export function mapArtifactStatus(status) {
  switch (status) {
    case 'pending':
      return {
        label: 'Queued',
        className: 'status-pending',
        isTerminal: false,
        canRetry: false,
        description: 'Artifact generation request queued and awaiting agent pickup.',
      };
    case 'generating':
      return {
        label: 'Generating...',
        className: 'status-generating',
        isTerminal: false,
        canRetry: false,
        description: 'Agent is retrieving evidence and synthesizing artifact content.',
      };
    case 'completed':
      return {
        label: 'Completed',
        className: 'status-completed',
        isTerminal: true,
        canRetry: false,
        description: 'Artifact generated and verified successfully.',
      };
    case 'validation_failed':
      return {
        label: 'Security Check Failed',
        className: 'status-failed',
        isTerminal: true,
        canRetry: true,
        description: 'Artifact was generated but did not pass automated HTML security inspection.',
      };
    case 'insufficient_evidence':
      return {
        label: 'Insufficient Evidence',
        className: 'status-insufficient',
        isTerminal: true,
        canRetry: true,
        description: 'Not enough grounded podcast evidence was found for this specific topic.',
      };
    case 'failed':
      return {
        label: 'Generation Failed',
        className: 'status-failed',
        isTerminal: true,
        canRetry: true,
        description: 'Artifact generation failed due to a processing error.',
      };
    default:
      return {
        label: status || 'Unknown',
        className: 'status-unknown',
        isTerminal: false,
        canRetry: false,
        description: '',
      };
  }
}
