/* ============================================================
   device-sync.js — one account, several machines.

   Two laptops signed into the same repo have to end up with the same
   progress, whichever one syncs first and whichever was offline longer.
   That rules out last-writer-wins on the whole document: the second laptop
   to sync would erase whatever the first had done.

   So the shared state is a set of independently merged fields, and merge()
   is commutative, associative and idempotent — merge(a,b) equals merge(b,a),
   and merging twice changes nothing. Both machines can therefore merge in
   any order and land on the same answer without a coordinator.

   Deletes are the part a plain union gets wrong. You can delete a solved
   problem, and you can untick a study-sheet row, and a union would simply
   resurrect them from the other machine on the next sync. Entries that can be
   removed therefore carry a timestamp and survive as tombstones, so a removal
   beats an older addition and an addition beats an older removal. Fields that
   genuinely cannot be undone — the days you solved on, achievements you
   earned — stay a plain union, because a tombstone for them would only be a
   way to lose data.

   The document lives at .leetsync/state.json in the user's own repository.
   Nothing here talks to the network; background.js does the reading and
   writing so this file stays pure and testable.
   ============================================================ */

const DeviceSync = (() => {
  const PATH = '.leetsync/state.json';
  const VERSION = 1;

  const MAX_DAYS = 1000;        // ~3 years of solve history
  const MAX_PROBLEMS = 5000;    // far past any real repo
  const MAX_SHEETS = 20000;     // 1,667 rows across the shipped sheets

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);

  /** An empty document. Also the shape every field below is merged against. */
  function empty() {
    return {
      v: VERSION,
      updatedAt: 0,
      devices: {},
      problems: {},
      achievements: {},
      sheets: {},
      days: [],
      bests: {},
    };
  }

  /**
   * Keep whichever entry was written last, so a delete on one machine is not
   * undone by an older copy on the other. Ties keep the surviving entry rather
   * than the tombstone: identical clocks mean we cannot tell the order, and
   * resurrecting is recoverable where deleting is not.
   */
  function lastWriteWins(a, b) {
    const out = {};
    for (const key of new Set([...Object.keys(obj(a)), ...Object.keys(obj(b))])) {
      const left = obj(a)[key];
      const right = obj(b)[key];
      if (!left) { out[key] = right; continue; }
      if (!right) { out[key] = left; continue; }
      const la = num(left.at);
      const ra = num(right.at);
      if (la === ra) out[key] = left.deleted ? right : left;
      else out[key] = la > ra ? left : right;
    }
    return out;
  }

  /** Union keeping the earliest timestamp — for things that cannot be undone. */
  function earliest(a, b) {
    const out = { ...obj(a) };
    for (const [key, ts] of Object.entries(obj(b))) {
      out[key] = key in out ? Math.min(num(out[key]) || num(ts), num(ts) || num(out[key])) : ts;
    }
    return out;
  }

  function highest(a, b) {
    const out = { ...obj(a) };
    for (const [key, value] of Object.entries(obj(b))) {
      out[key] = Math.max(num(out[key]), num(value));
    }
    return out;
  }

  /**
   * Merge two state documents. Commutative, associative and idempotent, which
   * is what lets both machines run it locally and still agree.
   */
  function merge(a, b) {
    const left = a && typeof a === 'object' ? a : empty();
    const right = b && typeof b === 'object' ? b : empty();

    const days = [...new Set([...arr(left.days), ...arr(right.days)])]
      .filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .slice(-MAX_DAYS);

    const problems = lastWriteWins(left.problems, right.problems);
    const sheets = lastWriteWins(left.sheets, right.sheets);

    return {
      v: VERSION,
      updatedAt: Math.max(num(left.updatedAt), num(right.updatedAt)),
      devices: (() => {
        const out = { ...obj(left.devices) };
        for (const [id, d] of Object.entries(obj(right.devices))) {
          out[id] = num(out[id] && out[id].lastSeen) >= num(d && d.lastSeen) ? out[id] : d;
        }
        return out;
      })(),
      problems: cap(problems, MAX_PROBLEMS),
      achievements: earliest(left.achievements, right.achievements),
      sheets: cap(sheets, MAX_SHEETS),
      days,
      bests: highest(left.bests, right.bests),
    };
  }

  /** Newest first, so a runaway map sheds its stalest entries rather than failing. */
  function cap(map, limit) {
    const keys = Object.keys(map);
    if (keys.length <= limit) return map;
    const out = {};
    for (const key of keys.sort((x, y) => num(map[y].at) - num(map[x].at)).slice(0, limit)) {
      out[key] = map[key];
    }
    return out;
  }

  /**
   * Streak from the merged day list rather than from either machine's counter.
   * Counters cannot be merged — solving on Monday here and Tuesday there is a
   * two-day streak, and no arithmetic on two "1"s produces that.
   */
  function deriveStreak(days, today) {
    const list = [...new Set(arr(days))].sort();
    if (!list.length) return { currentStreak: 0, longestStreak: 0, lastSolveDate: null };

    const dayNumber = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000);
    const now = dayNumber(today || new Date().toISOString().slice(0, 10));

    let longest = 1;
    let run = 1;
    for (let i = 1; i < list.length; i++) {
      run = dayNumber(list[i]) - dayNumber(list[i - 1]) === 1 ? run + 1 : 1;
      if (run > longest) longest = run;
    }

    // A streak is still alive if the last solve was today or yesterday; older
    // than that and it has lapsed, however long the run was.
    const last = list[list.length - 1];
    const gap = now - dayNumber(last);
    let current = 0;
    if (gap <= 1) {
      current = 1;
      for (let i = list.length - 1; i > 0; i--) {
        if (dayNumber(list[i]) - dayNumber(list[i - 1]) !== 1) break;
        current++;
      }
    }
    return { currentStreak: current, longestStreak: Math.max(longest, current), lastSolveDate: last };
  }

  /** Local storage -> the shared document. `at` defaults to now for entries that have no date. */
  function snapshot({ solvedProblems, streakData, achievements, pushCount, sheetTicks, deviceId }, now = Date.now()) {
    const state = empty();
    state.updatedAt = now;
    if (deviceId) state.devices[deviceId] = { lastSeen: now };

    for (const [key, p] of Object.entries(obj(solvedProblems))) {
      const at = Date.parse(p && (p.lastSolved || p.solvedAt || p.firstSolved)) || now;
      state.problems[key] = { ...p, at };
    }

    for (const [id, value] of Object.entries(obj(achievements))) {
      if (!value) continue;
      state.achievements[id] = typeof value === 'number' ? value
        : Date.parse(value && value.unlockedAt) || now;
    }

    for (const key of arr(sheetTicks)) state.sheets[key] = { at: now, done: true };

    const streak = obj(streakData);
    state.days = [...new Set(arr(streak.solveHistory))].sort().slice(-MAX_DAYS);
    state.bests = {
      longestStreak: Math.max(num(streak.longestStreak), num(streak.currentStreak)),
      pushes: num(pushCount),
    };
    return state;
  }

  /** The shared document -> what goes back into chrome.storage. */
  function apply(state, today) {
    const doc = state && typeof state === 'object' ? state : empty();

    const solvedProblems = {};
    for (const [key, entry] of Object.entries(obj(doc.problems))) {
      if (!entry || entry.deleted) continue;
      const { at, deleted, ...record } = entry;
      solvedProblems[key] = record;
    }

    const achievements = {};
    for (const [id, ts] of Object.entries(obj(doc.achievements))) achievements[id] = ts || true;

    const sheetTicks = Object.entries(obj(doc.sheets))
      .filter(([, entry]) => entry && entry.done && !entry.deleted)
      .map(([key]) => key);

    const streak = deriveStreak(doc.days, today);
    return {
      solvedProblems,
      achievements,
      sheetTicks,
      pushCount: num(obj(doc.bests).pushes),
      streakData: {
        currentStreak: streak.currentStreak,
        longestStreak: Math.max(streak.longestStreak, num(obj(doc.bests).longestStreak)),
        lastSolveDate: streak.lastSolveDate,
        solveHistory: arr(doc.days),
      },
    };
  }

  /** Mark an entry removed rather than dropping it, so the delete survives a merge. */
  function tombstone(state, field, key, now = Date.now()) {
    const doc = merge(state, empty());
    if (field !== 'problems' && field !== 'sheets') return doc;
    doc[field] = { ...obj(doc[field]), [key]: { at: now, deleted: true } };
    doc.updatedAt = now;
    return doc;
  }

  return {
    PATH, VERSION, empty, merge, snapshot, apply, deriveStreak, tombstone,
    MAX_DAYS, MAX_PROBLEMS, MAX_SHEETS,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { DeviceSync };
