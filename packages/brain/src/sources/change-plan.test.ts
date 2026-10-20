import assert from 'node:assert/strict';
import test from 'node:test';

import { planChanges, type SourceObservation } from './change-plan.ts';

const R = (n: number) => n.toString(16).padStart(64, '0');
const present = (path: string, revision: string): SourceObservation => ({
  kind: 'present',
  path,
  revision,
});
const missing = (path: string): SourceObservation => ({ kind: 'missing', path });

await test('additions, modifications (including frontmatter/newline-only edits) and unchanged paths', () => {
  const indexed = new Map([
    ['same.md', R(1)],
    ['frontmatter.md', R(2)],
    ['newline.md', R(3)],
  ]);

  const plan = planChanges(
    indexed,
    [
      present('same.md', R(1)),
      present('frontmatter.md', R(20)),
      present('newline.md', R(30)),
      present('new.md', R(4)),
    ],
    { complete: false },
  );

  assert.deepEqual(plan.added, [{ path: 'new.md', revision: R(4) }]);
  assert.deepEqual(plan.modified, [
    { path: 'frontmatter.md', revision: R(20), previous: R(2) },
    { path: 'newline.md', revision: R(30), previous: R(3) },
  ]);
  assert.deepEqual(plan.unchanged, ['same.md']);
  assert.deepEqual(plan.deleted, []);
});

await test('only a confirmed missing path or a complete scan deletes', () => {
  const indexed = new Map([
    ['gone.md', R(1)],
    ['unseen.md', R(2)],
    ['kept.md', R(3)],
  ]);
  const observations = [missing('gone.md'), present('kept.md', R(3))];

  const partial = planChanges(indexed, observations, { complete: false });
  const complete = planChanges(indexed, [present('kept.md', R(3))], { complete: true });

  assert.deepEqual(partial.deleted, [{ path: 'gone.md', previous: R(1) }]);
  assert.deepEqual(complete.deleted, [
    { path: 'gone.md', previous: R(1) },
    { path: 'unseen.md', previous: R(2) },
  ]);
  // A failed or partial resync with no observations deletes nothing.
  assert.deepEqual(planChanges(indexed, [], { complete: false }).deleted, []);
});

await test('a unique revision pair is a rename or cross-folder move', () => {
  const plan = planChanges(
    new Map([
      ['inbox/idea.md', R(7)],
      ['other.md', R(8)],
    ]),
    [missing('inbox/idea.md'), present('projects/idea.md', R(7)), present('other.md', R(8))],
    { complete: false },
  );

  assert.deepEqual(plan.renamed, [
    { from: 'inbox/idea.md', to: 'projects/idea.md', revision: R(7) },
  ]);
  assert.deepEqual(plan.added, []);
  assert.deepEqual(plan.deleted, []);
});

await test('ambiguous pairs stay delete + add (identical content does not prove a rename)', () => {
  // Two deletions share the revision.
  const twoGone = planChanges(
    new Map([
      ['a.md', R(5)],
      ['b.md', R(5)],
    ]),
    [missing('a.md'), missing('b.md'), present('c.md', R(5))],
    { complete: false },
  );
  // Two additions share the revision.
  const twoNew = planChanges(
    new Map([['a.md', R(5)]]),
    [missing('a.md'), present('c.md', R(5)), present('d.md', R(5))],
    { complete: false },
  );
  // Another indexed note still holds the same content.
  const duplicate = planChanges(
    new Map([
      ['a.md', R(5)],
      ['copy.md', R(5)],
    ]),
    [missing('a.md'), present('c.md', R(5)), present('copy.md', R(5))],
    { complete: false },
  );

  for (const plan of [twoGone, twoNew, duplicate]) {
    assert.deepEqual(plan.renamed, []);
    assert.ok(plan.deleted.length >= 1 && plan.added.length >= 1);
  }
});

await test('refused paths are reported, never silently deleted', () => {
  const plan = planChanges(
    new Map([['link.md', R(1)]]),
    [{ kind: 'refused', path: 'link.md', reason: 'symlink' }],
    { complete: false },
  );

  assert.deepEqual(plan.refused, [{ path: 'link.md', reason: 'symlink' }]);
  assert.deepEqual(plan.deleted, []);
});

await test('output is sorted and independent of observation order', () => {
  const indexed = new Map([
    ['b.md', R(1)],
    ['a.md', R(2)],
  ]);
  const observations = [
    present('z.md', R(9)),
    present('m.md', R(8)),
    present('b.md', R(10)),
    present('a.md', R(11)),
  ];

  const forward = planChanges(indexed, observations, { complete: true });
  const reverse = planChanges(indexed, [...observations].reverse(), { complete: true });

  assert.deepEqual(forward, reverse);
  assert.deepEqual(
    forward.added.map((entry) => entry.path),
    ['m.md', 'z.md'],
  );
  assert.deepEqual(
    forward.modified.map((entry) => entry.path),
    ['a.md', 'b.md'],
  );
});
