const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Runs the real service worker in a sandbox.
 *
 * Every other test here reads the source as text, and that is how 2.2.0
 * shipped a push path that threw on every new user's first solve: the
 * notification helper was named `notify`, and checkAchievements already had a
 * parameter called `notify`, so inside it `notify(...)` called a boolean.
 * Nothing that only reads text would ever see that. So this file loads
 * background.js as Chrome would -- importScripts and all -- against a stub of
 * the extension APIs, and calls the functions for real.
 */

const { makeChrome, loadWorker, fakeGitHub, loadWorkerWithGitHub, firstSolve, twoSum } =
  require('./helpers/worker.js');

test('a new user s first solve unlocks achievements without throwing', async () => {
  // The exact 2.2.0-2.2.3 failure: nothing unlocked yet, one problem solved,
  // notifications on. Before the fix this rejected with
  // "notify is not a function" -- after the commit had already landed.
  const env = makeChrome(firstSolve());
  const worker = loadWorker(env);

  const unlocked = await worker.checkAchievements();
  assert.ok(Array.isArray(unlocked) && unlocked.length > 0,
    'expected a first solve to unlock at least one achievement');

  const announced = env.calls.filter(c => c.path === 'chrome.notifications.create');
  assert.equal(announced.length, unlocked.length,
    'each newly unlocked achievement should be announced once');
  assert.ok(Object.keys(env.local.achievements || {}).length >= unlocked.length,
    'the unlocks must be saved');
});

test('restores unlock silently, and a second run unlocks nothing new', async () => {
  const env = makeChrome(firstSolve());
  const worker = loadWorker(env);

  const first = await worker.checkAchievements({ notify: false });
  assert.ok(first.length > 0);
  assert.equal(env.calls.filter(c => c.path === 'chrome.notifications.create').length, 0,
    'notify:false must not announce anything');

  const again = await worker.checkAchievements();
  assert.equal(again.length, 0, 'nothing is unlocked twice');
});

test('without the notifications permission, unlocking still succeeds', async () => {
  // chrome.notifications is undefined until the optional permission is
  // granted. The helper must check rather than assume.
  const env = makeChrome(firstSolve());
  delete env.chrome.notifications;
  const bare = new Proxy(env.chrome, {
    get: (t, key) => (key === 'notifications' ? undefined : t[key]),
  });
  const worker = loadWorker({ ...env, chrome: bare });
  const unlocked = await worker.checkAchievements();
  assert.ok(unlocked.length > 0);
});


test('a brand-new user s first push succeeds, commits, and unlocks', async () => {
  // Nothing solved, nothing unlocked, an empty repository: the first thing
  // every new user does. 2.2.0-2.2.3 committed the files here and then
  // reported failure, because the achievement it had just unlocked threw.
  const env = makeChrome({}, { githubToken: 'ghp_test', githubRepo: 'someone/leetcode-solutions' });
  const gh = fakeGitHub();
  const worker = loadWorkerWithGitHub(env, gh);

  const result = await worker.pushToGitHub(twoSum);

  assert.equal(result.success, true, 'the push must report success');
  assert.ok(gh.commits.some(c => /problems\/0001-Two-Sum\/sol1\./.test(c.file)),
    'the solution file was not committed: ' + gh.commits.map(c => c.file).join(', '));
  assert.ok(env.local.solvedProblems && env.local.solvedProblems[1], 'the solve is recorded locally');
  assert.ok(Object.keys(env.local.achievements || {}).length > 0,
    'a first solve unlocks something, and the unlock is saved');
});

test('a fault after the commit does not turn the push into a failure', async () => {
  // Whatever goes wrong in bookkeeping, the file is already on GitHub, and
  // "This submission was not saved" would be false.
  const env = makeChrome({}, { githubToken: 'ghp_test', githubRepo: 'someone/leetcode-solutions' });
  const gh = fakeGitHub();
  const worker = loadWorkerWithGitHub(env, gh);
  worker.checkAchievements = async () => { throw new Error('bookkeeping exploded'); };

  const result = await worker.pushToGitHub(twoSum);
  assert.equal(result.success, true);
  assert.ok(gh.commits.length > 0);
});

// ── Setups that pass a read and fail a write ──────────────────
//
// A user on 2.2.4 finished setup and then failed every push, two seconds in,
// as push_fail/other. A classic token without the repo scope reads any public
// repository and gets 404 on every write; so does a repository that was typed
// wrong, or one a fine-grained token was never granted. Setup let all three
// through, and the 404 was filed as "other" -- not queued, so the solve was
// lost.

const ghEnv = (token = 'ghp_test') =>
  makeChrome({}, { githubToken: token, githubRepo: 'someone/leetcode-solutions' });

test('a write GitHub refuses is explained, and the solve is kept', async () => {
  const env = ghEnv();
  const gh = fakeGitHub({ scopes: 'read:user', writable: false });
  const worker = loadWorkerWithGitHub(env, gh);

  const error = await worker.pushToGitHub(twoSum).then(() => null, e => e);
  assert.ok(error, 'the push should fail');
  assert.equal(error.reason, 'write');
  assert.match(error.message, /repo scope/, 'a missing scope should be named as the cause');

  const failure = worker.classifyPushError(error);
  assert.equal(failure.kind, 'auth');
  assert.equal(failure.status, '404');
  assert.equal(failure.recoverable, true, 'the solve must be queued, not dropped');
});

test('a write to a repository the token cannot see says so', async () => {
  // Fine-grained: no scope header, so the message cannot blame the scope.
  const env = ghEnv('github_pat_test');
  const gh = fakeGitHub({ writable: false });
  const worker = loadWorkerWithGitHub(env, gh);
  const error = await worker.pushToGitHub(twoSum).then(() => null, e => e);
  assert.equal(error.reason, 'write');
  assert.match(error.message, /does not exist|not allowed to write/);
  assert.equal(worker.classifyPushError(error).recoverable, true);
});

test('setup refuses a repository the token cannot write to', async () => {
  const cases = [
    // [token, fake options, expected success, expected reason]
    ['ghp_x', { scopes: 'read:user' }, false, 'scope'],
    ['ghp_x', { scopes: '' }, false, 'scope'],
    ['ghp_x', { scopes: 'repo:status' }, false, 'scope'],   // not "repo"
    ['ghp_x', { scopes: 'repo, read:user' }, true, null],
    ['ghp_x', { scopes: 'public_repo' }, true, null],        // public repository
    ['ghp_x', { scopes: 'public_repo', isPrivate: true }, false, 'scope'],
    ['github_pat_x', {}, true, null],                        // write grant unknowable here
    ['ghp_x', { scopes: 'repo', exists: false }, false, 'missing'],
    ['github_pat_x', { exists: false }, false, 'missing'],
  ];
  for (const [token, opts, ok, reason] of cases) {
    const env = ghEnv(token);
    const worker = loadWorkerWithGitHub(env, fakeGitHub(opts));
    const result = await worker.verifyRepoAccess('someone/leetcode-solutions');
    const label = `${token} ${JSON.stringify(opts)}`;
    assert.equal(result.success, ok, `${label}: ${result.error || 'ok'}`);
    if (!ok) {
      assert.equal(result.reason, reason, label);
      assert.ok(result.error && result.error.length > 20, `${label}: the error must say what to do`);
    }
  }
});

test('setup does not accept a malformed repository name', async () => {
  const worker = loadWorkerWithGitHub(ghEnv(), fakeGitHub({ scopes: 'repo' }));
  for (const bad of ['', 'leetcode-solutions', 'a/b/c', 'owner/ repo']) {
    const result = await worker.verifyRepoAccess(bad);
    assert.equal(result.success, false, `accepted ${JSON.stringify(bad)}`);
  }
});

test('the automatic setup will not adopt a repository it cannot write to', async () => {
  // Classic token with no scopes, and leetcode-solutions already exists and is
  // public: 2.2.4 adopted it on a successful read.
  const env = ghEnv();
  const worker = loadWorkerWithGitHub(env, fakeGitHub({ scopes: '' }));
  const result = await worker.ensureRepo('leetcode-solutions');
  assert.equal(result.success, false);
  assert.equal(result.reason, 'scope');
  assert.equal(env.sync.githubRepo, 'someone/leetcode-solutions',
    'the stored repo is only the preset; ensureRepo must not have re-saved it');
});

test('failures are classified with a status, and timeouts are queued', () => {
  const worker = loadWorker(makeChrome());
  const c = (msg, extra = {}) => worker.classifyPushError(Object.assign(new Error(msg), extra));

  assert.deepEqual(
    (({ kind, status, recoverable }) => ({ kind, status, recoverable }))(c('Request timed out. Check your internet connection.')),
    { kind: 'network', status: 'net', recoverable: true },
    'a timeout used to be filed as other and dropped');
  assert.equal(c('GitHub API error (422): Invalid request').kind, 'other');
  assert.equal(c('GitHub API error (422): Invalid request').status, '422');
  assert.equal(c('GitHub API error (422): Invalid request').recoverable, false);
  assert.equal(c('GitHub refused the request (403). Check the token').kind, 'auth');
  assert.equal(c('GitHub rate limit reached. Try again shortly.').status, 'rate');
  assert.equal(c("Cannot read properties of undefined (reading 'x')").status, 'js');
});
