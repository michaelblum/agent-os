import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repo = new URL('../../', import.meta.url);

async function repoText(path) {
  return readFile(new URL(path, repo), 'utf8');
}

function cssRule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`, 's'))?.[0] || '';
}

test('markdown workbench embeds wiki graph as the primary pane', async () => {
  const js = await repoText('packages/toolkit/components/markdown-workbench/index.js');
  const css = await repoText('packages/toolkit/components/markdown-workbench/styles.css');
  const html = await repoText('packages/toolkit/components/markdown-workbench/index.html');
  const wikiJs = await repoText('packages/toolkit/components/wiki-kb/index.js');
  const wikiCss = await repoText('packages/toolkit/components/wiki-kb/styles.css');

  assert.match(js, /import WikiKB from '\.\.\/wiki-kb\/index\.js'/);
  assert.match(js, /createMarkdownOpenRequestFromWikiSelection/);
  assert.match(js, /WIKI_SUBJECT_SELECTION_TYPE/);
  assert.match(html, /\.\.\/wiki-kb\/styles\.css/);
  assert.match(html, /\.\.\/\.\.\/markdown\/preview\.css/);
  assert.match(html, /maximize:\s*true/);
  assert.match(html, /resizable:\s*true/);
  assert.match(html, /minWidth:\s*760/);
  assert.match(js, /class="aos-workbench-preview-pane markdown-workbench-graph-pane"/);
  assert.match(js, /data-role="graph"/);
  assert.match(js, /WikiKB\(\{ chrome: 'embedded', views: \['graph'\] \}\)/);
  assert.match(js, /collapseEmbeddedGraphControls/);
  assert.match(js, /scheduleEmbeddedGraphFit/);
  assert.match(js, /type:\s*'fit-view'/);
  assert.match(js, /embeddedWikiGraphPayload/);
  assert.match(js, /labelMode:\s*'hover'/);
  assert.match(js, /collapsed:\s*true/);
  assert.match(wikiJs, /accepts:\s*\[[^\]]*'fit-view'/s);
  assert.match(wikiJs, /createWikiSubjectSelectionPayload/);
  assert.match(wikiJs, /WIKI_SUBJECT_SELECTION_TYPE/);
  assert.match(wikiJs, /type:\s*node\.type \|\| 'unknown'/);
  assert.match(wikiJs, /entry_handle:\s*payload\?\.entry_handle/);
  assert.match(wikiJs, /emits:\s*\[[^\]]*WIKI_SUBJECT_SELECTION_TYPE/s);
  assert.match(wikiJs, /wiki-kb-compact-chrome/);
  assert.match(wikiCss, /\.wiki-kb-graph-main\s*\{/);
  assert.match(wikiCss, /\.wiki-kb-root\[data-chrome="embedded"\]\s+\.wiki-kb-controls-shell/);
  assert.match(wikiCss, /\.wiki-kb-root\[data-chrome="embedded"\]\s+\.wiki-kb-controls-shell\.collapsed\s+\.wiki-kb-controls-toggle/);
  assert.match(wikiCss, /\.wiki-kb-controls-panel\[hidden\]\s*\{\s*display:\s*none/);
  assert.doesNotMatch(wikiJs, /wiki-kb-graph-stats/);
  assert.doesNotMatch(wikiCss, /\.wiki-kb-root\[data-chrome="embedded"\]\s+\.wiki-kb-graph-view:has/);
  assert.match(wikiCss, /\.wiki-kb-floating-status\s*\{[\s\S]*top:\s*10px/);
  assert.match(js, /import \{ createSplitPane \} from '\.\.\/\.\.\/panel\/layouts\/split-pane\.js'/);
  assert.match(js, /splitPane = createSplitPane\(\{/);
  assert.match(js, /startPane:\s*root\.querySelector\('\.markdown-workbench-graph-pane'\)/);
  assert.match(js, /endPane:\s*dom\.documentPane/);
  assert.match(js, /splitPane\?\.openPane\('end'/);
  assert.match(js, /splitPane\?\.closePane\('end'/);
  assert.match(css, /\.markdown-workbench-main\s*\{[\s\S]*display:\s*flex/);
  assert.doesNotMatch(css, /\.markdown-workbench-main\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*0fr\)/);
});

test('wiki graph controls reflow the graph stage through fixed sidebar primitive', async () => {
  const graphJs = await repoText('packages/toolkit/components/wiki-kb/views/graph.js');
  const graphCss = await repoText('packages/toolkit/components/wiki-kb/styles.css');

  assert.match(graphJs, /import \{ createFixedSidebarPane \} from '\.\.\/\.\.\/\.\.\/panel\/layouts\/split-pane\.js'/);
  assert.match(graphJs, /createFixedSidebarPane\(\{/);
  assert.match(graphJs, /mainPane:\s*dom\.graphMainEl/);
  assert.match(graphJs, /sidebarPane:\s*dom\.controlsShellEl/);
  assert.match(graphJs, /side:\s*'start'/);
  assert.match(graphJs, /openSize:\s*304/);
  assert.match(graphJs, /closedSize:\s*42/);
  assert.match(graphJs, /resizeCanvasToContainer\(canvas,\s*dom\.graphMainEl \|\| rootEl\)/);
  assert.match(graphJs, /class="wiki-kb-graph-main"/);
  assert.match(graphJs, /class="wiki-kb-controls-shell aos-sidebar-rail"/);
  assert.match(graphJs, /class="wiki-kb-controls-top aos-sidebar-rail-top"/);
  assert.match(graphJs, /class="wiki-kb-controls-toggle aos-sidebar-rail-toggle"/);
  assert.match(graphJs, /class="wiki-kb-controls-panel aos-sidebar-rail-content"/);
  assert.match(graphCss, /\.wiki-kb-controls-shell\s*\{[^}]*background:/s);
  assert.doesNotMatch(cssRule(graphCss, '.wiki-kb-controls-shell'), /position:\s*absolute/);
  assert.doesNotMatch(
    cssRule(graphCss, '.wiki-kb-root[data-chrome="embedded"] .wiki-kb-controls-toggle'),
    /position:\s*absolute/,
  );
});

test('markdown workbench toggles source and preview in the content pane', async () => {
  const js = await repoText('packages/toolkit/components/markdown-workbench/index.js');

  const documentPane = js.match(/<section class="aos-workbench-controls-pane markdown-workbench-document-pane"[\s\S]*?<\/section>\s*<\/main>/)?.[0] || '';

  assert.match(js, /data-view-mode="preview"/);
  assert.match(js, /data-view-mode="source"/);
  assert.match(js, /aria-label="Preview" title="Preview"/);
  assert.match(js, /aria-label="Edit" title="Edit"/);
  assert.match(js, /markdown-workbench-mode-icon/);
  assert.match(js, /markdown-workbench-code-icon/);
  assert.match(js, /class="markdown-workbench-icon-button" data-action="toggle-outline" aria-label="Index" title="Index"/);
  assert.match(documentPane, /data-role="path"/);
  assert.doesNotMatch(documentPane, /data-role="dirty"/);
  assert.match(js, /dom\.saveButton\.disabled = !state\.dirty/);
  assert.match(documentPane, /markdown-workbench-document-toolbar/);
  assert.match(documentPane, /aos-markdown-preview markdown-workbench-preview/);
  assert.match(js, /syncViewMode/);
  assert.match(js, /dom\.previewPane\.hidden = !previewActive/);
  assert.match(js, /dom\.sourcePane\.hidden = previewActive/);
  assert.doesNotMatch(js, /markdown-workbench-toolbar/);
  assert.doesNotMatch(js, /markdown-workbench-pane-toolbar/);
});

test('markdown workbench folds index into the content pane and can close it', async () => {
  const js = await repoText('packages/toolkit/components/markdown-workbench/index.js');
  const css = await repoText('packages/toolkit/components/markdown-workbench/styles.css');

  assert.match(js, /class="markdown-workbench-outline-panel"/);
  assert.match(js, /data-action="toggle-outline"/);
  assert.match(js, /data-action="close-content"/);
  assert.match(js, /class="aos-window-button aos-window-close markdown-workbench-close-content"/);
  assert.match(js, /splitOpen = false/);
  assert.match(css, /\.markdown-workbench-outline-panel\s*\{/);
  assert.doesNotMatch(js, /markdown-workbench-inspector/);
});

test('markdown workbench renders annotation badges, notes, metadata, and anchors', async () => {
  const js = await repoText('packages/toolkit/components/markdown-workbench/index.js');
  const css = await repoText('packages/toolkit/components/markdown-workbench/styles.css');
  const renderJs = await repoText('packages/toolkit/markdown/render.js');

  assert.match(js, /buildAnnotationProjectionResult/);
  assert.match(js, /markdown_workbench\.annotations\.replace/);
  assert.match(js, /markdown_workbench\.annotations\.clear/);
  assert.match(js, /markdown_workbench\.annotations\.show/);
  assert.match(js, /markdown_workbench\.annotations\.hide/);
  assert.match(js, /markdown_workbench\.annotations\.toggle/);
  assert.match(js, /data-action="toggle-annotations"/);
  assert.match(js, /data-role="annotation-panel"/);
  assert.match(js, /data-role="annotation-list"/);
  assert.match(js, /data-role="annotation-overlay"/);
  assert.match(js, /String\(annotation\.ordinal\)/);
  assert.match(js, /markdown-workbench-annotation-note', annotation\.note/);
  assert.match(js, /annotation\.actor\.role.*annotation\.actor\.id.*annotation\.status.*view\.anchor_summary/s);
  assert.match(js, /sourceLineProjection/);
  assert.match(js, /previewLineProjection/);
  assert.match(js, /renderOverlayDecorator/);
  assert.match(js, /annotation_projection/);
  assert.match(js, /window\.__markdownWorkbenchState = \{/);
  assert.match(js, /dom\.editor\.addEventListener\('scroll'/);
  assert.match(js, /dom\.previewPane\.addEventListener\('scroll'/);
  assert.match(js, /window\.addEventListener\('resize'/);
  assert.match(renderJs, /data-source-line/);
  assert.match(css, /\.markdown-workbench-annotation-badge\s*\{/);
  assert.match(css, /\.markdown-workbench-annotation-card\.secondary\s*\{/);
  assert.match(css, /\.markdown-workbench-annotation-overlay\s*\{/);
  assert.match(css, /\.markdown-workbench-annotation-popover\s*\{/);
  assert.match(css, /hover \.markdown-workbench-annotation-popover/);
  assert.doesNotMatch(js, /data-role="annotation-rail"/);
});

test('markdown source editor leaves native undo and redo key chords alone', async () => {
  const js = await repoText('packages/toolkit/components/markdown-workbench/index.js');
  const keydownBody = js.match(/function handleEditorKeydown\(event\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(js, /import \{ createTextarea \} from '..\/..\/controls\/textarea\.js'/);
  assert.match(js, /createTextarea\(\{[\s\S]*ariaLabel: 'Markdown source editor'/);
  assert.match(js, /semanticTargetId: 'source-editor'/);
  assert.match(keydownBody, /key === 's'/);
  assert.match(keydownBody, /event\.key !== 'Tab'/);
  assert.doesNotMatch(keydownBody, /key === 'z'/);
  assert.doesNotMatch(keydownBody, /key === 'y'/);
  assert.doesNotMatch(keydownBody, /undo/i);
  assert.doesNotMatch(keydownBody, /redo/i);
});
