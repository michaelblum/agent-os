import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderWorkbenchPaneHeader,
  renderWorkbenchReadout,
  renderWorkbenchSectionTitle,
  renderWorkbenchStatusBar,
  renderWorkbenchSummaryRows,
  renderWorkbenchToolbar,
  renderWorkbenchToolbarSection,
} from '../../packages/toolkit/shell/index.js';

test('renderWorkbenchToolbar renders shell toolbar wrappers with raw attributes', () => {
  const html = renderWorkbenchToolbar({
    content: '<button type="button">Run</button>',
    className: 'compact',
    attributes: { role: 'toolbar', 'aria-label': 'Tools' },
    rawAttributes: ['data-density="compact"'],
  });

  assert.equal(
    html,
    '<div role="toolbar" aria-label="Tools" class="aos-workbench-toolbar compact" data-density="compact"><button type="button">Run</button></div>',
  );
});

test('renderWorkbenchToolbarSection renders section wrappers', () => {
  const html = renderWorkbenchToolbarSection({
    content: 'Controls',
    attributes: { 'aria-label': 'Map zoom' },
    dataset: { align: 'end' },
  });

  assert.equal(
    html,
    '<section aria-label="Map zoom" class="aos-workbench-toolbar-section" data-align="end">Controls</section>',
  );
});

test('renderWorkbenchReadout escapes label and value text', () => {
  const html = renderWorkbenchReadout({
    label: 'Surface',
    value: '<none>',
    rawAttributes: ['data-role="surface-readout"'],
  });

  assert.equal(
    html,
    '<span class="toolbar-readout" data-role="surface-readout"><strong>Surface</strong> &lt;none&gt;</span>',
  );
});

test('renderWorkbenchPaneHeader renders title, subtitle, and action chrome', () => {
  const html = renderWorkbenchPaneHeader({
    title: 'Inspector',
    subtitle: 'Selected <target>',
    actions: '<button type="button">Pin</button>',
    className: 'secondary-header',
  });

  assert.equal(
    html,
    '<header class="pane-header secondary-header"><div><h2>Inspector</h2><span>Selected &lt;target&gt;</span></div><button type="button">Pin</button></header>',
  );
});

test('renderWorkbenchSectionTitle and status bar render structural chrome', () => {
  assert.equal(
    renderWorkbenchSectionTitle({
      title: 'Execution Map <JSON>',
      baseClassName: 'work-record-section-title',
    }),
    '<div class="work-record-section-title">Execution Map &lt;JSON&gt;</div>',
  );

  assert.equal(
    renderWorkbenchStatusBar({
      content: '<span data-role="stats"></span>',
      className: 'markdown-workbench-document-status',
      attributes: { 'aria-label': 'Document status' },
    }),
    '<footer aria-label="Document status" class="aos-workbench-status markdown-workbench-document-status"><span data-role="stats"></span></footer>',
  );
});

test('renderWorkbenchSummaryRows renders escaped shell summary rows', () => {
  const html = renderWorkbenchSummaryRows({
    rowClassName: 'work-record-summary-row',
    rows: [
      ['Record', 'wr-1'],
      ['Mode', 'read <only>'],
    ],
  });

  assert.equal(
    html,
    '<div class="work-record-summary-row"><span>Record</span><strong>wr-1</strong></div><div class="work-record-summary-row"><span>Mode</span><strong>read &lt;only&gt;</strong></div>',
  );
});
