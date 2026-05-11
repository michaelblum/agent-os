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

test('renderMarkdown renders Mermaid fences as safe diagram containers', () => {
  const html = renderMarkdown('```mermaid\ngraph TD\n  A-->B\n```');
  assert.match(html, /class="aos-markdown-mermaid"/);
  assert.match(html, /data-markdown-diagram="mermaid"/);
  assert.match(html, /data-mermaid-source="graph TD/);
  assert.match(html, /A--&gt;B/);
});

test('renderMarkdown escapes unsafe Mermaid source content', () => {
  const html = renderMarkdown('```mermaid\ngraph TD\n  A[<script>alert(1)</script>]-->B\n```');
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('renderMarkdown strips source-authored script and link behavior in HTML expressions', () => {
  const html = renderMarkdown('<a href="javascript:alert(1)" onclick="alert(2)">bad</a>\n<script src="https://example.com/x.js"></script>');

  assert.doesNotMatch(html, /<a /);
  assert.doesNotMatch(html, /href="/);
  assert.doesNotMatch(html, /onclick="/);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&lt;a href=&quot;javascript:alert\(1\)&quot; onclick=&quot;alert\(2\)&quot;&gt;bad&lt;\/a&gt;/);
  assert.match(html, /&lt;script src=&quot;https:\/\/example\.com\/x\.js&quot;&gt;&lt;\/script&gt;/);
});
