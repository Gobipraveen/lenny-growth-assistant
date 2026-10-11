import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseMarkdownBlocks,
  renderSafeInline,
  isSafeUrl,
} from '../src/utils/markdown.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');

test('Task 08B-2: Chat Markdown Rendering Regression Suite', async (t) => {
  await t.test('1. Parses H3 headings, bold, and bulleted lists into semantic blocks', () => {
    const rawAnswer = `Based on the Lenny's Podcast transcripts, Brian Chesky shared some crucial insights into developing an exceptional customer experience.

### 1. **Emphasize Consistent, High-Quality Features:**
- **Key Principle:** Overhaul host tools to ensure listing accuracy.
- **Supporting Detail:** Great guest experience starts with great tools for hosts.

### 2. **Design with Guests at the Center:**
1. First, conduct deep user research.
2. Second, iterate on prototype testing.`;

    const blocks = parseMarkdownBlocks(rawAnswer);
    assert.ok(Array.isArray(blocks), 'Parsed blocks must be an array');
    assert.equal(blocks.length, 5);

    // Block 0: Paragraph
    assert.equal(blocks[0].type, 'paragraph');
    assert.ok(blocks[0].lines[0].includes("Brian Chesky"));

    // Block 1: Heading H3 for lesson 1
    assert.equal(blocks[1].type, 'heading');
    assert.equal(blocks[1].level, 3);
    assert.equal(blocks[1].text, '1. **Emphasize Consistent, High-Quality Features:**');

    // Block 2: Unordered list with 2 items
    assert.equal(blocks[2].type, 'ul');
    assert.equal(blocks[2].items.length, 2);
    assert.ok(blocks[2].items[0].includes('Key Principle'));
    assert.ok(blocks[2].items[1].includes('Supporting Detail'));

    // Block 3: Heading H3 for lesson 2
    assert.equal(blocks[3].type, 'heading');
    assert.equal(blocks[3].level, 3);
    assert.equal(blocks[3].text, '2. **Design with Guests at the Center:**');

    // Block 4: Ordered list with 2 items
    assert.equal(blocks[4].type, 'ol');
    assert.equal(blocks[4].items.length, 2);
    assert.ok(blocks[4].items[0].includes('First, conduct'));
    assert.ok(blocks[4].items[1].includes('Second, iterate'));
  });

  await t.test('2. Parses blockquotes, code blocks, and horizontal dividers', () => {
    const md = `> You cannot delegate understanding.
> Second line of quotation.

\`\`\`javascript
const retention = 1.25;
\`\`\`

---

Final summary paragraph.`;

    const blocks = parseMarkdownBlocks(md);
    assert.equal(blocks.length, 4);

    // Blockquote
    assert.equal(blocks[0].type, 'blockquote');
    assert.equal(blocks[0].lines.length, 2);

    // Code block
    assert.equal(blocks[1].type, 'code_block');
    assert.equal(blocks[1].lang, 'javascript');
    assert.ok(blocks[1].code.includes('const retention = 1.25;'));

    // Horizontal Rule
    assert.equal(blocks[2].type, 'hr');

    // Paragraph
    assert.equal(blocks[3].type, 'paragraph');
  });

  await t.test('3. Blocks unsafe Markdown URLs and preserves safe links in inline rendering', () => {
    const textWithLinks = 'Check out [Safe Substack](https://lenny.substack.com) and [Dangerous Link](javascript:alert(document.cookie)).';
    const inline = renderSafeInline(textWithLinks);

    const safeLink = inline.find((node) => node && node.type === 'a');
    assert.ok(safeLink, 'Safe link must render as an <a> tag');
    assert.equal(safeLink.props.href, 'https://lenny.substack.com');
    assert.equal(safeLink.props.target, '_blank');
    assert.equal(safeLink.props.rel, 'noopener noreferrer');

    const unsafeSpan = inline.find((node) => node && node.props?.className === 'md-unsafe-link');
    assert.ok(unsafeSpan, 'Dangerous link must be neutralized to a span without href');
    assert.equal(unsafeSpan.type, 'span');
    assert.equal(unsafeSpan.props.href, undefined);
  });

  await t.test('4. Security: No dangerouslySetInnerHTML anywhere in MessageList or MarkdownRenderer', () => {
    const messageListSrc = fs.readFileSync(path.join(srcDir, 'components/MessageList.jsx'), 'utf-8');
    const markdownRendererSrc = fs.readFileSync(path.join(srcDir, 'components/MarkdownRenderer.jsx'), 'utf-8');
    const formattedContentSrc = fs.readFileSync(path.join(srcDir, 'components/FormattedContent.jsx'), 'utf-8');

    assert.ok(!messageListSrc.includes('dangerouslySetInnerHTML'), 'MessageList must never use dangerouslySetInnerHTML');
    assert.ok(!markdownRendererSrc.includes('dangerouslySetInnerHTML'), 'MarkdownRenderer must never use dangerouslySetInnerHTML');
    assert.ok(!formattedContentSrc.includes('dangerouslySetInnerHTML'), 'FormattedContent must never use dangerouslySetInnerHTML');
  });

  await t.test('5. MessageList imports and uses MarkdownRenderer directly in message bubbles', () => {
    const messageListSrc = fs.readFileSync(path.join(srcDir, 'components/MessageList.jsx'), 'utf-8');
    assert.ok(messageListSrc.includes("import { MarkdownRenderer } from './MarkdownRenderer.jsx'"));
    assert.ok(messageListSrc.includes('<MarkdownRenderer markdown={msg.content}'));
  });

  await t.test('6. FormattedContent backward-compatibility wrapper delegates to MarkdownRenderer', () => {
    const formattedContentSrc = fs.readFileSync(path.join(srcDir, 'components/FormattedContent.jsx'), 'utf-8');
    assert.ok(formattedContentSrc.includes("import { MarkdownRenderer } from './MarkdownRenderer.jsx'"));
    assert.ok(formattedContentSrc.includes('<MarkdownRenderer markdown={content}'));
  });

  await t.test('7. Handles empty, whitespace, and null inputs safely', () => {
    assert.deepEqual(parseMarkdownBlocks(''), []);
    assert.deepEqual(parseMarkdownBlocks('   \n  \n'), []);
    assert.deepEqual(parseMarkdownBlocks(null), []);
    assert.deepEqual(parseMarkdownBlocks(undefined), []);
  });
});
