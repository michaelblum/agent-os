import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  applyHtmlFileSaveResult,
  buildHtmlFileSaveRequest,
  createHtmlFileWorkbenchState,
  htmlFileWorkbenchSnapshot,
  openHtmlFile,
  reloadHtmlFilePreview,
  revertHtmlFile,
  setHtmlFileContent,
} from '../../packages/toolkit/components/html-file-workbench/model.js';

const repo = new URL('../../', import.meta.url);

async function repoText(path) {
  return readFile(new URL(path, repo), 'utf8');
}

test('HTML file workbench state opens, dirties, previews, reverts, and saves', () => {
  const state = createHtmlFileWorkbenchState();
  const opened = openHtmlFile(state, {
    type: 'html_file.open',
    path: '/tmp/demo.html',
    content: '<!doctype html><html><body><h1>Demo</h1></body></html>',
  });

  assert.equal(opened.status, 'opened');
  assert.equal(state.path, '/tmp/demo.html');
  assert.equal(state.dirty, false);
  assert.equal(state.previewRevision, 1);

  setHtmlFileContent(state, '<!doctype html><html><body><h1>Changed</h1></body></html>');
  assert.equal(state.dirty, true);
  assert.equal(state.previewContent.includes('Demo'), true);

  const preview = reloadHtmlFilePreview(state);
  assert.equal(preview.status, 'reloaded');
  assert.equal(state.previewContent.includes('Changed'), true);

  const request = buildHtmlFileSaveRequest(state);
  assert.equal(request.type, 'html_file.save.request');
  assert.equal(request.path, '/tmp/demo.html');
  assert.equal(request.content.includes('Changed'), true);

  const result = applyHtmlFileSaveResult(state, {
    type: 'html_file.save.result',
    request_id: request.request_id,
    status: 'saved',
    path: '/tmp/demo.html',
  });
  assert.equal(result.status, 'saved');
  assert.equal(state.dirty, false);

  setHtmlFileContent(state, '<!doctype html><html><body><h1>Unsaved</h1></body></html>');
  revertHtmlFile(state);
  assert.equal(state.content.includes('Changed'), true);
  assert.equal(state.dirty, false);
});

test('HTML file workbench snapshot exposes smoke-test state', () => {
  const state = createHtmlFileWorkbenchState({
    path: '/tmp/demo.html',
    content: '<html></html>',
    dirty: true,
  });
  const snapshot = htmlFileWorkbenchSnapshot(state);

  assert.equal(snapshot.surface, 'html-file-workbench');
  assert.equal(snapshot.path, '/tmp/demo.html');
  assert.equal(snapshot.dirty, true);
  assert.equal(snapshot.content, '<html></html>');
  assert.equal(snapshot.content_length, 13);
  assert.equal(snapshot.preview_mode, 'srcdoc');
  assert.equal(snapshot.last_result, null);
});

test('HTML file workbench component contract uses panel, iframe sandbox, and expected events', async () => {
  const js = await repoText('packages/toolkit/components/html-file-workbench/index.js');
  const html = await repoText('packages/toolkit/components/html-file-workbench/index.html');
  const css = await repoText('packages/toolkit/components/html-file-workbench/styles.css');
  const launch = await repoText('packages/toolkit/components/html-file-workbench/launch.sh');
  const save = await repoText('packages/toolkit/components/html-file-workbench/save-current.sh');

  assert.match(html, /mountPanel/);
  assert.match(html, /Single\(HtmlFileWorkbench\)/);
  assert.match(html, /maximize:\s*true/);
  assert.match(html, /resizable:\s*true/);
  assert.match(js, /name:\s*'html-file-workbench'/);
  assert.match(js, /accepts:\s*\[[^\]]*HTML_FILE_OPEN_TYPE[^\]]*HTML_FILE_SAVE_RESULT_TYPE/s);
  assert.match(js, /emits:\s*\[[^\]]*'html-file-workbench\/save\.requested'/s);
  assert.match(js, /window\.__htmlFileWorkbenchState = htmlFileWorkbenchSnapshot\(state\)/);
  assert.match(js, /createTextarea\(\{[\s\S]*ariaLabel: 'HTML source editor'/);
  assert.match(js, /dom\.previewFrame\.srcdoc = state\.previewContent/);
  assert.match(js, /sandbox', 'allow-scripts allow-forms allow-modals allow-pointer-lock allow-popups'/);
  assert.doesNotMatch(js, /allow-same-origin/);
  assert.match(js, /data-action="reload-preview"/);
  assert.match(js, /data-action="revert"/);
  assert.match(js, /data-action="save"/);
  assert.match(js, /data-action="close"/);
  assert.match(css, /\.html-file-workbench-main\s*\{[\s\S]*grid-template-columns:/);
  assert.match(css, /\.html-file-workbench-preview-frame\s*\{[\s\S]*border:\s*0/);
  assert.match(launch, /MAX_BYTES/);
  assert.match(launch, /html_file\.open/);
  assert.match(launch, /--manifest html-file-workbench/);
  assert.match(save, /window\.__htmlFileWorkbenchState/);
  assert.match(save, /html_file\.save\.result/);
  assert.match(save, /endswith\(\(".html", ".htm"\)\)/);
});
