const test = require('node:test');
const assert = require('node:assert/strict');
const { DeviceSync } = require('../device-sync.js');

/**
 * The merge is the whole feature. Two laptops sync in whatever order they
 * happen to come online, so anything that depends on who went first is a bug
 * that shows up as one machine quietly erasing the other's progress.
 *
 * These check the three properties that make that safe — commutative,
 * associative, idempotent — and then the two cases a naive union gets wrong:
 * deletes coming back from the dead, and streaks that cannot be added up.
 */

const day = (iso) => iso;

test('merge is commutative — sync order cannot change the result', () => {
  const a = {
    v: 1, updatedAt: 10, devices: { d1: { lastSeen: 10 } },
    problems: { '1': { at: 10, title: 'Two Sum' } },
    achievements: { first: 5 }, sheets: { 'a2z|Arrays': { at: 10, done: true } },
    days: ['2026-09-01'], bests: { longestStreak: 3, pushes: 4 },
  };
  const b = {
    v: 1, updatedAt: 20, devices: { d2: { lastSeen: 20 } },
    problems: { '2': { at: 20, title: 'Jump Game' } },
    achievements: { first: 9, second: 20 }, sheets: { 'a2z|Strings': { at: 20, done: true } },
    days: ['2026-09-02'], bests: { longestStreak: 1, pushes: 9 },
  };
  assert.deepEqual(DeviceSync.merge(a, b), DeviceSync.merge(b, a));
});

test('merge is idempotent — syncing twice changes nothing', () => {
  const a = DeviceSync.snapshot({
    solvedProblems: { '1': { title: 'Two Sum', lastSolved: '2026-09-01T10:00:00Z' } },
    streakData: { solveHistory: ['2026-09-01'], longestStreak: 1 },
    achievements: { first: true }, pushCount: 2, sheetTicks: ['a2z|Arrays'], deviceId: 'd1',
  }, 1000);
  const once = DeviceSync.merge(a, a);
  assert.deepEqual(DeviceSync.merge(once, a), once);
});

test('merge is associative', () => {
  const mk = (id, at, dayIso) => ({
    v: 1, updatedAt: at, devices: { [id]: { lastSeen: at } },
    problems: { [id]: { at, title: id } }, achievements: {}, sheets: {},
    days: [dayIso], bests: { pushes: at },
  });
  const a = mk('a', 1, '2026-09-01');
  const b = mk('b', 2, '2026-09-02');
  const c = mk('c', 3, '2026-09-03');
  assert.deepEqual(
    DeviceSync.merge(DeviceSync.merge(a, b), c),
    DeviceSync.merge(a, DeviceSync.merge(b, c)),
  );
});

test('a delete is not resurrected by the other machine s older copy', () => {
  const laptop = DeviceSync.merge(DeviceSync.empty(), {
    problems: { '42': { at: 100, title: 'Trapping Rain Water' } },
  });
  // Deleted here at t=200, while the other machine still holds the t=100 add.
  const afterDelete = DeviceSync.tombstone(laptop, 'problems', '42', 200);
  const merged = DeviceSync.merge(afterDelete, laptop);

  assert.equal(merged.problems['42'].deleted, true, 'the delete lost to a stale add');
  assert.equal(DeviceSync.apply(merged).solvedProblems['42'], undefined);
});

test('re-solving after a delete wins over the tombstone', () => {
  const deleted = DeviceSync.tombstone(DeviceSync.empty(), 'problems', '42', 100);
  const resolved = { problems: { '42': { at: 300, title: 'Trapping Rain Water' } } };
  const merged = DeviceSync.merge(deleted, resolved);

  assert.equal(merged.problems['42'].deleted, undefined);
  assert.equal(DeviceSync.apply(merged).solvedProblems['42'].title, 'Trapping Rain Water');
});

test('unticking a sheet row survives a merge with a machine that still has it ticked', () => {
  const ticked = { sheets: { 'a2z|Arrays': { at: 100, done: true } } };
  const unticked = { sheets: { 'a2z|Arrays': { at: 200, done: false } } };
  const merged = DeviceSync.merge(ticked, unticked);
  assert.deepEqual(DeviceSync.apply(merged).sheetTicks, []);
});

test('solve days union across machines instead of overwriting', () => {
  const a = { days: ['2026-09-01', '2026-09-03'] };
  const b = { days: ['2026-09-02', '2026-09-03'] };
  assert.deepEqual(DeviceSync.merge(a, b).days,
    ['2026-09-01', '2026-09-02', '2026-09-03']);
});

test('a streak spanning two machines is the merged run, not either counter', () => {
  // Monday on the laptop, Tuesday on the desktop. Both think their streak is 1.
  const laptop = DeviceSync.snapshot({
    streakData: { solveHistory: ['2026-09-01'], currentStreak: 1, longestStreak: 1 },
  }, 1000);
  const desktop = DeviceSync.snapshot({
    streakData: { solveHistory: ['2026-09-02'], currentStreak: 1, longestStreak: 1 },
  }, 2000);

  const applied = DeviceSync.apply(DeviceSync.merge(laptop, desktop), '2026-09-02');
  assert.equal(applied.streakData.currentStreak, 2, 'the two days did not join up');
  assert.equal(applied.streakData.longestStreak, 2);
});

test('a lapsed streak reads zero but keeps the best', () => {
  const s = DeviceSync.deriveStreak(['2026-08-01', '2026-08-02', '2026-08-03'], '2026-09-05');
  assert.equal(s.currentStreak, 0, 'a month-old run should not count as current');
  assert.equal(s.longestStreak, 3);
  assert.equal(s.lastSolveDate, '2026-08-03');
});

test('yesterday still counts as an unbroken streak', () => {
  const s = DeviceSync.deriveStreak(['2026-09-03', '2026-09-04'], '2026-09-05');
  assert.equal(s.currentStreak, 2);
});

test('achievements keep the earliest unlock and are never revoked', () => {
  const merged = DeviceSync.merge({ achievements: { streak7: 900 } },
                                  { achievements: { streak7: 100, first: 50 } });
  assert.equal(merged.achievements.streak7, 100);
  assert.equal(merged.achievements.first, 50);
});

test('counters take the higher of the two rather than summing', () => {
  // Summing would double-count on every repeat sync.
  const merged = DeviceSync.merge({ bests: { pushes: 12 } }, { bests: { pushes: 7 } });
  assert.equal(merged.bests.pushes, 12);
  assert.equal(DeviceSync.merge(merged, merged).bests.pushes, 12);
});

test('snapshot then apply round-trips the local shapes', () => {
  const local = {
    solvedProblems: { '1': { title: 'Two Sum', difficulty: 'Easy', lastSolved: '2026-09-01T10:00:00Z' } },
    streakData: { solveHistory: ['2026-09-01'], currentStreak: 1, longestStreak: 5 },
    achievements: { first: true },
    pushCount: 3,
    sheetTicks: ['a2z|Arrays'],
    deviceId: 'd1',
  };
  const back = DeviceSync.apply(DeviceSync.snapshot(local, 1000), '2026-09-01');

  assert.equal(back.solvedProblems['1'].title, 'Two Sum');
  assert.equal(back.solvedProblems['1'].at, undefined, 'sync bookkeeping leaked into storage');
  assert.deepEqual(back.sheetTicks, ['a2z|Arrays']);
  assert.equal(back.pushCount, 3);
  assert.equal(back.streakData.longestStreak, 5, 'a best longer than the kept history was lost');
});

test('garbage in any field cannot throw', () => {
  for (const junk of [null, undefined, 42, 'nope', [], { days: 'no', problems: 7 }]) {
    assert.doesNotThrow(() => DeviceSync.apply(DeviceSync.merge(junk, DeviceSync.empty())));
  }
});
