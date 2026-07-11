import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { WikiIndexEntry } from '../src/integrations/types.js';
import {
  buildWikiBrowserModel,
  defaultWikiBrowserState,
  reduceWikiBrowserState,
} from '../src/integrations/wiki-browser.js';

const index: WikiIndexEntry[] = [
  {
    name: 'Operator',
    description: 'Runtime operator identity.',
    path: 'aos/entities/operator.md',
    type: 'entity',
    tags: ['runtime', 'operator'],
  },
  {
    name: 'Command Surface',
    description: 'Canonical command surface.',
    path: 'aos/concepts/command-surface.md',
    type: 'concept',
    tags: ['commands', 'contract'],
  },
  {
    name: 'Daemon',
    description: 'Runtime service process.',
    path: 'aos/entities/daemon.md',
    type: 'entity',
    tags: ['runtime', 'daemon'],
  },
  {
    name: 'Self Check',
    description: 'Runtime diagnostic workflow.',
    path: 'aos/plugins/self-check/SKILL.md',
    plugin: 'self-check',
    type: 'workflow',
    tags: ['runtime', 'workflow'],
  },
];

describe('wiki-browser model', () => {
  it('defaults to the type tree', () => {
    const model = buildWikiBrowserModel(index, defaultWikiBrowserState());
    assert.equal(model.state.root, 'types');
    assert.equal(model.branches[0]?.id, 'concept');
    assert.equal(model.branches[1]?.id, 'entity');
  });

  it('reduces branch and entry navigation server-side', () => {
    const state = reduceWikiBrowserState(defaultWikiBrowserState(), {
      type: 'open-branch',
      branch: 'entity',
    });
    const model = buildWikiBrowserModel(index, state);
    assert.equal(model.activeBranch?.id, 'entity');
    assert.equal(model.entries.length, 2);

    const entryState = reduceWikiBrowserState(model.state, {
      type: 'open-entry',
      entryPath: 'aos/entities/operator.md',
    });
    const detailModel = buildWikiBrowserModel(index, entryState);
    assert.equal(detailModel.selectedEntry?.name, 'Operator');
    assert.equal(detailModel.breadcrumbs.map((crumb) => crumb.label).join(' -> '), 'Types -> Entity -> Operator');
  });

  it('switches roots and resets deeper state', () => {
    const state = reduceWikiBrowserState({
      root: 'types',
      branch: 'entity',
      entryPath: 'aos/entities/operator.md',
      page: 2,
    }, {
      type: 'set-root',
      root: 'tags',
    });
    assert.deepEqual(state, {
      root: 'tags',
      page: 0,
    });
    const model = buildWikiBrowserModel(index, state);
    assert.equal(model.state.root, 'tags');
    assert.equal(model.branches[0]?.id, 'runtime');
  });
});
