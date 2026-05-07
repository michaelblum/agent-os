import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repo = new URL('../../', import.meta.url);

async function repoText(path) {
  return readFile(new URL(path, repo), 'utf8');
}

test('markdown preview presentation is shared by markdown and artifact bundle workbenches', async () => {
  const previewCss = await repoText('packages/toolkit/markdown/preview.css');
  const markdownHtml = await repoText('packages/toolkit/components/markdown-workbench/index.html');
  const markdownJs = await repoText('packages/toolkit/components/markdown-workbench/index.js');
  const markdownCss = await repoText('packages/toolkit/components/markdown-workbench/styles.css');
  const artifactHtml = await repoText('packages/toolkit/components/artifact-bundle-workbench/index.html');
  const artifactJs = await repoText('packages/toolkit/components/artifact-bundle-workbench/index.js');
  const artifactCss = await repoText('packages/toolkit/components/artifact-bundle-workbench/styles.css');

  assert.match(markdownHtml, /\.\.\/\.\.\/markdown\/preview\.css/);
  assert.match(artifactHtml, /\.\.\/\.\.\/markdown\/preview\.css/);
  assert.match(markdownJs, /class="aos-markdown-preview markdown-workbench-preview"/);
  assert.match(artifactJs, /class="aos-markdown-preview artifact-bundle-markdown-preview"/);
  assert.match(markdownJs, /data-aos-ref="markdown-workbench:preview"/);
  assert.match(artifactJs, /data-role="markdown-preview"/);

  assert.match(previewCss, /\.aos-markdown-preview\s*\{/);
  assert.match(previewCss, /--aos-markdown-preview-max-width/);
  assert.match(previewCss, /\.aos-markdown-preview :where\(h1,\s*h2,\s*h3\)/);
  assert.match(previewCss, /\.aos-markdown-preview :where\(p,\s*ul,\s*ol\)/);
  assert.match(previewCss, /\.aos-markdown-preview :where\(code\)/);
  assert.match(previewCss, /\.aos-markdown-preview :where\(pre\)/);
  assert.match(previewCss, /\.aos-markdown-preview :where\(a\)/);

  assert.doesNotMatch(markdownCss, /\.markdown-workbench-preview\s+h1/);
  assert.doesNotMatch(markdownCss, /\.markdown-workbench-preview\s+code/);
  assert.doesNotMatch(artifactCss, /\.artifact-bundle-markdown-preview\s+h1/);
  assert.doesNotMatch(artifactCss, /\.artifact-bundle-markdown-preview\s+code/);
  assert.match(artifactCss, /--aos-markdown-preview-min-height:\s*100%/);
});
