import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderMarkdown,
  safeExternalHref,
} from '../../packages/toolkit/markdown/render.js';

test('renderMarkdown escapes HTML and strips unsafe links', () => {
  const html = renderMarkdown('Hello <script>alert(1)</script>\n[good](https://example.com)\n[bad](javascript:alert(1))');
  assert.match(html, /Hello &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, />bad</);
});

test('safeExternalHref allows explicit safe protocols only', () => {
  assert.equal(safeExternalHref('https://example.com/test'), 'https://example.com/test');
  assert.equal(safeExternalHref('aos://toolkit/components/wiki-kb/index.html'), 'aos://toolkit/components/wiki-kb/index.html');
  assert.equal(safeExternalHref('/wiki/aos/page.md'), '/wiki/aos/page.md');
  assert.equal(safeExternalHref('javascript:alert(1)'), '');
});
