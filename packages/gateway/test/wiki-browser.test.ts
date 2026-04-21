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
    name: 'Sigil',
    description: 'Avatar presence system.',
    path: 'aos/entities/sigil.md',
    type: 'entity',
    tags: ['sigil', 'avatar'],
  },
  {
    name: 'Sigil Default App Model',
    description: 'Default app experience.',
    path: 'aos/concepts/sigil-default-app-model.md',
    type: 'concept',
    tags: ['sigil', 'app-model'],
  },
  {
    name: 'Employer Brand Profile',
    description: 'Canonical profile artifact.',
    path: 'aos/entities/employer-brand-profile.md',
    type: 'entity',
    tags: ['employer-brand', 'profile'],
  },
  {
    name: 'Employer Brand Intake',
    description: 'Plugin intake workflow.',
    path: 'aos/plugins/employer-brand-profile-intake/references/intake.md',
    plugin: 'employer-brand-profile-intake',
    type: 'workflow',
    tags: ['employer-brand', 'workflow'],
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
      entryPath: 'aos/entities/sigil.md',
    });
    const detailModel = buildWikiBrowserModel(index, entryState);
    assert.equal(detailModel.selectedEntry?.name, 'Sigil');
    assert.equal(detailModel.breadcrumbs.map((crumb) => crumb.label).join(' -> '), 'Types -> Entity -> Sigil');
  });

  it('switches roots and resets deeper state', () => {
    const state = reduceWikiBrowserState({
      root: 'types',
      branch: 'entity',
      entryPath: 'aos/entities/sigil.md',
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
    assert.equal(model.branches[0]?.id, 'employer-brand');
  });
});
