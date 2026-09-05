/* ============================================================
   background.js — Service Worker for GitHub API integration
   
   Handles:
   1. Receiving problem data from the content script
   2. Pushing solution files to GitHub via the Contents API
   3. Maintaining the root README.md with a problem index
   ============================================================ */

// Pure README/SVG generation lives in readme.js (unit tested in test/).
// importScripts runs synchronously and shares this global scope, so the
// generators are available to every function below.
importScripts('readme.js', 'analytics.js', 'sheet-progress.js', 'device-sync.js');

// ── Base64 Encoding (Unicode-safe) ───────────────────────────

/**
 * Encode a string to base64, handling Unicode characters properly.
 * Standard btoa() fails on non-Latin1 characters.
 */
function unicodeToBase64(str) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decode base64 from the GitHub API. atob alone mangles multi-byte
 * characters, and GitHub wraps its base64 in newlines.
 */
function base64ToUnicode(b64) {
  const raw = atob(String(b64 || '').replace(/\n/g, ''));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

// ── GitHub API Helpers ───────────────────────────────────────

/**
 * How long to wait before retrying a throttled GitHub response, or null when
 * the response isn't a rate limit at all.
 *
 * GitHub signals throttling three ways: a Retry-After header (secondary
 * limits, which writes to the same repo hit easily), x-ratelimit-remaining: 0
 * with a reset timestamp (primary limit), or a 403 whose body mentions the
 * secondary limit. Waits are capped at 60s because an MV3 service worker can
 * be terminated while idling — beyond that it is better to fail with a clear
 * message than to hang.
 */
function rateLimitDelayMs(response) {
  if (response.status !== 403 && response.status !== 429) return null;

  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter, 60) * 1000;
  }

  if (response.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    if (Number.isFinite(reset)) {
      return Math.max(1000, Math.min(reset * 1000 - Date.now(), 60000));
    }
    return 5000;
  }

  return null;
}

async function githubAPI(endpoint, options = {}) {
  const settings = await chrome.storage.sync.get(['githubToken']);
  const token = settings.githubToken;

  if (!token) {
    throw new Error('GitHub token not configured. Click the extension icon to set up.');
  }

  const url = endpoint.startsWith('https://')
    ? endpoint
    : `https://api.github.com${endpoint}`;

  let response;
  const maxRetries = 3; // one network retry, plus room to wait out a throttle

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 8-second timeout per request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'LeetSync-Chrome-Extension',
          ...(options.headers || {}),
        },
      });
      clearTimeout(timeoutId);
    } catch (fetchError) {
      const isTimeout = fetchError.name === 'AbortError';
      console.error(`[LeetSync] Fetch attempt ${attempt}/${maxRetries} failed:`, isTimeout ? 'Timeout' : fetchError.message);
      if (attempt === maxRetries) {
        throw new Error(isTimeout
          ? 'Request timed out. Check your internet connection.'
          : `Network error: ${fetchError.message}`);
      }
      await new Promise(r => setTimeout(r, 800));
      continue;
    }

    // Throttled? Wait it out rather than surfacing a bare 403.
    const wait = rateLimitDelayMs(response);
    if (wait !== null && attempt < maxRetries) {
      console.warn(`[LeetSync] Rate limited — retrying in ${Math.round(wait / 1000)}s`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    break;
  }

  if (!response.ok) {
    const errorBody = await response.text();
    let errorMsg;
    try {
      const errorJson = JSON.parse(errorBody);
      errorMsg = errorJson.message || errorBody;
    } catch {
      errorMsg = errorBody;
    }

    // A 403 is ambiguous: throttling, or a token without the right scope.
    if (rateLimitDelayMs(response) !== null) {
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      const when = Number.isFinite(reset)
        ? ` Try again after ${new Date(reset * 1000).toLocaleTimeString()}.`
        : ' Try again shortly.';
      throw new Error(`GitHub rate limit reached.${when}`);
    }
    if (response.status === 403) {
      throw new Error(`GitHub refused the request (403). Check the token has Contents: Read and write on this repository. ${errorMsg}`);
    }
    throw new Error(`GitHub API error (${response.status}): ${errorMsg}`);
  }

  // 204 No Content
  if (response.status === 204) return null;

  return response.json();
}

/**
 * Get a file from the repository. Returns null if the file doesn't exist.
 */
async function getFile(repo, path) {
  try {
    return await githubAPI(`/repos/${repo}/contents/${path}`);
  } catch (error) {
    if (error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

/**
 * Create or update a file in the repository.
 * Automatically handles 409 SHA conflicts by re-fetching and retrying.
 */
async function putFile(repo, path, content, message, sha = null) {
  const encodedContent = unicodeToBase64(content);

  for (let attempt = 1; attempt <= 2; attempt++) {
    const body = { message, content: encodedContent };
    if (sha) body.sha = sha;

    try {
      return await githubAPI(`/repos/${repo}/contents/${path}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    } catch (error) {
      // 409 = SHA conflict (file changed since we last read it)
      // 422 = SHA missing (file exists but we didn't provide SHA)
      if (attempt === 1 && (error.message.includes('409') || error.message.includes('422'))) {
        console.warn(`[LeetSync] SHA conflict on ${path}, re-fetching and retrying...`);
        const freshFile = await getFile(repo, path);
        sha = freshFile?.sha || null;
        continue;
      }
      throw error;
    }
  }
}

/**
 * Build the root README — a stunning dashboard of all solved problems.
 */
async function generateRootReadme(problems) {
  const themeData = await chrome.storage.sync.get(['readmeTheme']);
  // Retired themes (dark-pro, clean-light, colorful, minimal, stats-heavy)
  // fall back to dark.
  const theme = README_THEMES[themeData.readmeTheme] ? themeData.readmeTheme : 'dark';
  return README_THEMES[theme](problems);
}


// ── Core Push Logic ──────────────────────────────────────────

/**
 * Push an accepted submission to GitHub.
 * @param {object} problemData - Full problem data from content script
 */
async function pushToGitHub(problemData) {
  const settings = await chrome.storage.sync.get(['githubRepo', 'githubToken']);
  const repo = settings.githubRepo;

  if (!repo || !settings.githubToken) {
    throw new Error('Extension not configured. Click the extension icon to set up your GitHub token and repo.');
  }

  const {
    number,
    title,
    difficulty,
    tags,
    description,
    url,
    language,
    code,
    runtime,
    memory,
    timestamp,
  } = problemData;

  const langInfo = getLanguageInfo(language);
  const folderName = buildFolderName(number, title);
  const basePath = `problems/${folderName}`;

  console.log(`[LeetSync] Pushing ${number}. ${title} to ${repo}/${basePath}`);

  // ── Step 1: Check existing solutions in the folder ──────────
  // List the folder contents to see what solution files already exist
  // so we can number this one correctly (sol1, sol2, sol3...)
  let existingSolutions = [];
  try {
    const folderContents = await githubAPI(`/repos/${repo}/contents/${basePath}`);
    if (Array.isArray(folderContents)) {
      existingSolutions = folderContents
        .filter(f => f.name.startsWith('sol') && !f.name.startsWith('solution'))
        .map(f => f.name);
    }
  } catch (e) {
    // Folder doesn't exist yet — first solution for this problem
    existingSolutions = [];
  }

  // Determine next solution number
  const solNums = existingSolutions
    .map(n => parseInt(n.replace(/^sol(\d+).*/, '$1')))
    .filter(n => !isNaN(n));
  const nextSolNum = solNums.length > 0 ? Math.max(...solNums) + 1 : 1;
  const isFirstSolution = nextSolNum === 1;
  const solutionLabel = `sol${nextSolNum}`;

  console.log(`[LeetSync] Solution #${nextSolNum} for problem ${number}`);

  // ── Step 2: Fetch existing problem stats (for best-tracking) ──
  // Load existing stats from local storage for this problem
  const existingStats = await chrome.storage.local.get(['solvedProblems']);
  const allSolved = existingStats.solvedProblems || {};
  const existingProblemData = allSolved[number] || {};

  // Parse runtime ms for comparison (e.g. "3 ms" → 3)
  function parseMs(str) {
    if (!str) return Infinity;
    const m = String(str).match(/(\d+(\.\d+)?)\s*ms/);
    return m ? parseFloat(m[1]) : Infinity;
  }
  function parseMb(str) {
    if (!str) return Infinity;
    const m = String(str).match(/(\d+(\.\d+)?)\s*m[bB]/);
    return m ? parseFloat(m[1]) : Infinity;
  }

  const prevBestRuntime = existingProblemData.bestRuntime || null;
  const prevBestMemory  = existingProblemData.bestMemory  || null;

  const newRuntimeMs  = parseMs(runtime);
  const prevRuntimeMs = parseMs(prevBestRuntime);
  const newMemoryMb   = parseMb(memory);
  const prevMemoryMb  = parseMb(prevBestMemory);

  const bestRuntime = (newRuntimeMs <= prevRuntimeMs) ? runtime : prevBestRuntime;
  const bestMemory  = (newMemoryMb  <= prevMemoryMb)  ? memory  : prevBestMemory;
  const isNewBestTime   = newRuntimeMs < prevRuntimeMs;
  const isNewBestMemory = newMemoryMb  < prevMemoryMb;

  // ── Step 3: Push the README.md ─────────────────────────────
  // Pass all solution info + best stats to the README generator
  const enrichedProblemData = {
    ...problemData,
    solutionNumber: nextSolNum,
    solutionLabel,
    bestRuntime,
    bestMemory,
    isNewBestTime,
    isNewBestMemory,
    isFirstSolution,
  };

  const problemReadmeContent = generateProblemReadme(enrichedProblemData);
  const readmePath = `${basePath}/README.md`;

  const existingReadme = await getFile(repo, readmePath);
  await putFile(
    repo,
    readmePath,
    problemReadmeContent,
    isFirstSolution
      ? `Add problem: ${number}. ${title}`
      : `Update README: ${number}. ${title} — solution ${nextSolNum} added`,
    existingReadme?.sha || null
  );

  console.log(`[LeetSync] ✅ Problem README pushed`);

  // Panels the problem README's <picture> points at. Both themes ship so
  // GitHub switches on the reader's setting. Failures here are logged and
  // skipped: the README and solution matter more than its artwork.
  await Promise.all(['light', 'dark'].map(async (themeName) => {
    const panelPath = `${basePath}/${PROBLEM_SVG[themeName]}`;
    try {
      const existing = await getFile(repo, panelPath);
      await putFile(
        repo,
        panelPath,
        buildProblemSvg(enrichedProblemData, themeName),
        `Update ${themeName} panel: ${number}. ${title}`,
        existing?.sha || null
      );
    } catch (error) {
      console.warn(`[LeetSync] Could not publish ${panelPath}:`, error.message);
    }
  }));

  // ── Step 4: Push the solution file ────────────────────────
  const solutionFileName = `${solutionLabel}${langInfo.ext}`;
  const solutionPath = `${basePath}/${solutionFileName}`;

  // Rich header comment for the solution file
  const commentChar = ['.py', '.rb'].includes(langInfo.ext) ? '#' : ['.sql'].includes(langInfo.ext) ? '--' : '//';
  const sep = commentChar === '#' ? `# ${'='.repeat(58)}` : commentChar === '--' ? `-- ${'='.repeat(56)}` : `// ${'='.repeat(58)}`;
  const headerLines = [
    sep,
    `${commentChar} ${number}. ${title}`,
    `${commentChar} Difficulty : ${difficulty}`,
    `${commentChar} Language   : ${langInfo.name}`,
    `${commentChar} Solution   : #${nextSolNum}`,
    runtime ? `${commentChar} Runtime    : ${runtime}` : null,
    memory  ? `${commentChar} Memory     : ${memory}`  : null,
    `${commentChar} Link       : ${url}`,
    sep,
    '',
  ].filter(l => l !== null).join('\n');

  const fullCode = headerLines + '\n' + code;

  // Check if file exists (edge case: re-push from different device)
  const existingSol = await getFile(repo, solutionPath);
  await putFile(
    repo,
    solutionPath,
    fullCode,
    existingSol
      ? `Update sol${nextSolNum}: ${number}. ${title} (${langInfo.name})`
      : `Add sol${nextSolNum}: ${number}. ${title} (${langInfo.name})`,
    existingSol?.sha || null
  );

  console.log(`[LeetSync] ✅ Solution file pushed: ${solutionFileName}`);

  // ── Step 5: Update the root README.md ────────────────────
  await updateRootReadme(repo, {
    number,
    title,
    difficulty,
    language: langInfo.name,
    folderName,
    date: new Date().toISOString().split('T')[0],
  });

  console.log(`[LeetSync] ✅ Root README updated`);

  // ── Step 6: Update local stats ────────────────────────────
  const stats2 = await chrome.storage.local.get(['pushCount', 'lastPush', 'solvedProblems']);
  const pushCount = (stats2.pushCount || 0) + 1;
  const solvedProblems = stats2.solvedProblems || {};

  const previous = solvedProblems[number] || {};
  solvedProblems[number] = {
    number,
    title,
    difficulty,
    language: langInfo.name,
    date: new Date().toISOString().split('T')[0],
    folderName,
    solutionCount: nextSolNum,
    bestRuntime,
    bestMemory,
    // Kept so the popup can group by topic and build a revision queue without
    // re-fetching anything from LeetCode. `slug` is also what links a record
    // back to its attempt log.
    slug: problemData.titleSlug || previous.slug || null,
    tags: Array.isArray(problemData.tags) ? problemData.tags : (previous.tags || []),
    attempts: Number.isFinite(problemData.attempts) ? problemData.attempts : previous.attempts || 1,
    // The first solve is what "not revisited since" is measured from, so it
    // must survive later re-pushes of the same problem.
    firstSolvedOn: previous.firstSolvedOn || new Date().toISOString().split('T')[0],
  };

  await chrome.storage.local.set({
    pushCount,
    lastPush: new Date().toISOString(),
    solvedProblems,
  });

  // Update streak and check achievements
  await updateStreak();
  await checkAchievements();

  return {
    success: true,
    solutionNumber: nextSolNum,
    solutionLabel,
    isNewBestTime,
    isNewBestMemory,
    bestRuntime,
    bestMemory,
  };
}

/**
 * Update the root README.md with the index of all solved problems.
 * 
 * IMPORTANT: To support multiple devices, we read the existing README
 * from GitHub and parse the problems table to get the current list,
 * then merge the new problem in. This way we never lose problems
 * that were pushed from a different laptop.
 */
async function updateRootReadme(repo, newProblem) {
  // Step 1: Fetch the existing README from GitHub
  const existingReadme = await getFile(repo, 'README.md');
  let existingProblems = {};

  // Step 2: Parse the problem table from the existing README (if any)
  if (existingReadme) {
    try {
      // Decode the base64 content
      const content = atob(existingReadme.content.replace(/\n/g, ''));
      
      // Parse table rows: | 1 | [Two Sum](problems/0001-Two-Sum) | 🟢 Easy | `Java` | 2026-06-23 |
      const tableRowRegex = /\|\s*(\d+)\s*\|\s*\[([^\]]+)\]\(problems\/([^)]+)\)\s*\|\s*[🟢🟡🔴⚪]\s*(\w+)\s*\|\s*`([^`]+)`\s*\|\s*(\S+)\s*\|/g;
      let match;
      while ((match = tableRowRegex.exec(content)) !== null) {
        const num = parseInt(match[1], 10);
        existingProblems[num] = {
          number: num,
          title: match[2],
          folderName: match[3],
          difficulty: match[4],
          language: match[5],
          date: match[6],
        };
      }
      console.log(`[LeetSync] Parsed ${Object.keys(existingProblems).length} problems from existing README`);
    } catch (parseError) {
      console.warn('[LeetSync] Could not parse existing README, will rebuild:', parseError.message);
    }
  }

  // Step 3: Also merge with local storage (catches any that might have been missed)
  const stats = await chrome.storage.local.get(['solvedProblems']);
  const localProblems = stats.solvedProblems || {};
  
  // Merge: GitHub README problems + local problems + new problem
  // GitHub README is the source of truth, local fills gaps, new problem overwrites
  const mergedProblems = { ...existingProblems, ...localProblems };
  mergedProblems[newProblem.number] = newProblem;

  // Step 4: Save merged list back to local storage (sync this device)
  await chrome.storage.local.set({ solvedProblems: mergedProblems });

  // Step 5: Generate and push the new README
  const problems = Object.values(mergedProblems);
  const readmeContent = await generateRootReadme(problems);

  await putFile(
    repo,
    'README.md',
    readmeContent,
    'Update README with solved problems index',
    existingReadme?.sha || null
  );

  // Step 6: Publish the light/dark stat panels the README's <picture> points
  // at. Both always ship so GitHub can switch on the reader's system theme.
  // A failure here must not lose the README push that already succeeded.
  const panels = [];
  for (const themeName of ['light', 'dark']) {
    panels.push([SVG_PATH[themeName], buildStatsSvg(problems, themeName), `${themeName} stat panels`]);
    panels.push([CAL_PATH[themeName], buildCalendarSvg(problems, themeName), `${themeName} solve calendar`]);
  }
  await Promise.all(panels.map(async ([path, content, label]) => {
    try {
      const existing = await getFile(repo, path);
      await putFile(repo, path, content, `Update ${label}`, existing?.sha || null);
    } catch (error) {
      console.warn(`[LeetSync] Could not publish ${path}:`, error.message);
    }
  }));

  console.log(`[LeetSync] Root README updated with ${problems.length} total problems`);
}

/**
 * Record an event and send it straight away.
 *
 * The periodic alarm on its own meant an event could sit on the device for up
 * to half an hour before it went anywhere, which reads as "the dashboard is
 * broken" the first time you try it. Both calls are no-ops when consent is
 * off, and flush() does nothing when the queue is empty, so this stays quiet
 * for anyone who has not opted in. The alarm remains as the retry path for
 * whatever was queued while offline.
 */
function report(event, fields = {}) {
  Analytics.track(event, fields)
    .then(() => Analytics.flush())
    .then(() => Analytics.heartbeat())
    .catch(() => {});
}

// ── Message Listener ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PUSH_TO_GITHUB') {
    pushToGitHub(message.data)
      .then((result) => {
        // A successful push clears any recovery state the popup was showing.
        chrome.storage.local.remove('lastPushError');
        report('push_ok', {
          slug: slugFromLeetCodeUrl(message.data?.url),
          title: message.data?.title,
          difficulty: message.data?.difficulty,
          language: message.data?.language,
          codeLen: typeof message.data?.code === 'string' ? message.data.code.length : undefined,
          // Offered, not sent: pick() drops `code` unless the separate
          // code-sharing consent is on. Runtime and memory ride the
          // `submission` event instead, so they are not repeated here.
          code: message.data?.code,
        });
        // On success, also try processing any queued items
        processOfflineQueue().catch(() => {});
        sendResponse(result);
      })
      .catch(async (error) => {
        console.error('[LeetSync] Push failed:', error);
        // Check if it's a network error — queue for later
        const isNetworkError = error.message.includes('Failed to fetch') ||
                               error.message.includes('NetworkError') ||
                               error.message.includes('network') ||
                               error.message.includes('timeout') ||
                               error.message.includes('aborted');
        // 401/403 and rate limits are recoverable once the user reconnects, so
        // the submission is queued rather than dropped.
        const isAuthError = /\(401\)|\(403\)|rate limit|bad credentials/i.test(error.message);
        const recoverable = isNetworkError || isAuthError;

        if (recoverable) await addToOfflineQueue(message.data);

        // Only the category, never the message: GitHub errors embed the
        // repository path, which must not leave the device.
        report('push_fail', {
          detail: isAuthError ? 'auth' : isNetworkError ? 'network' : 'other',
          difficulty: message.data?.difficulty,
          language: message.data?.language,
        });

        // Persisted so the popup can offer recovery instead of a bare message.
        await chrome.storage.local.set({
          lastPushError: {
            message: error.message,
            title: message.data?.title || null,
            language: message.data?.language || null,
            kind: isAuthError ? 'auth' : isNetworkError ? 'network' : 'other',
            queued: recoverable,
            at: new Date().toISOString(),
          },
        });

        if (isNetworkError) {
          sendResponse({
            success: false,
            queued: true,
            error: '📡 No connection — queued for later! Will auto-push when online.',
          });
        } else {
          sendResponse({ success: false, error: error.message, queued: recoverable });
        }
      });

    // Return true to indicate we'll send an async response
    return true;
  }

  if (message.type === 'TEST_CONNECTION') {
    testGitHubConnection(message.repo)
      .then(async (result) => {
        // On successful verify, sync stats from GitHub README
        if (result.success) {
          try {
            const synced = await syncStatsFromGitHub(message.repo);
            result.pushCount = synced.pushCount;
            result.solvedCount = synced.solvedCount;
          } catch (e) {
            console.warn('[LeetSync] Could not sync stats:', e.message);
          }
        }
        sendResponse(result);
      })
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_STATS') {
    chrome.storage.local.get(['pushCount', 'lastPush', 'solvedProblems'], (data) => {
      sendResponse({
        pushCount: data.pushCount || 0,
        lastPush: data.lastPush || null,
        solvedCount: Object.keys(data.solvedProblems || {}).length,
      });
    });
    return true;
  }

  if (message.type === 'SYNC_STATS') {
    syncStatsFromGitHub(message.repo)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Merge this device with whatever the repo holds, in both directions.
  if (message.type === 'SYNC_DEVICES') {
    syncDevices({ write: message.write !== false })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'LOGOUT') {
    logout()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_SYNC_STATUS') {
    chrome.storage.local.get([LAST_SYNC_KEY], (data) => {
      sendResponse({ lastSync: data[LAST_SYNC_KEY] || null });
    });
    return true;
  }

  // Return list of all synced problems
  if (message.type === 'GET_PROBLEMS') {
    chrome.storage.local.get(['solvedProblems'], (data) => {
      const problems = data.solvedProblems || {};
      const list = Object.entries(problems).map(([key, p]) => ({
        number: p.number || parseInt(key, 10),
        title: p.title,
        difficulty: p.difficulty,
        language: p.language,
        folderName: p.folderName,
        date: p.date,
        solutionCount: p.solutionCount || 1,
      }));
      // Sort by number
      list.sort((a, b) => a.number - b.number);
      sendResponse({ success: true, problems: list });
    });
    return true;
  }

  // Delete a problem from GitHub and local storage
  if (message.type === 'DELETE_PROBLEM') {
    deleteProblemFromGitHub(message.problemNumber, message.folderName)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Get solution files for a specific problem
  if (message.type === 'GET_SOLUTIONS') {
    getSolutionFiles(message.folderName)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Delete a single solution and renumber remaining
  if (message.type === 'DELETE_SOLUTION') {
    deleteSingleSolution(message.problemNumber, message.folderName, message.fileName)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Get streak data
  if (message.type === 'GET_STREAK') {
    chrome.storage.local.get(['streakData'], (data) => {
      sendResponse(data.streakData || { currentStreak: 0, longestStreak: 0, lastSolveDate: null, solveHistory: [] });
    });
    return true;
  }

  // Get achievements
  if (message.type === 'GET_ACHIEVEMENTS') {
    chrome.storage.local.get(['achievements', 'solvedProblems', 'streakData'], (data) => {
      sendResponse({
        unlocked: data.achievements || {},
        solvedProblems: data.solvedProblems || {},
        streakData: data.streakData || { currentStreak: 0, longestStreak: 0 },
      });
    });
    return true;
  }

  // Get offline queue status
  if (message.type === 'GET_QUEUE_STATUS') {
    chrome.storage.local.get(['offlineQueue'], (data) => {
      const queue = data.offlineQueue || [];
      sendResponse({ queueLength: queue.length, items: queue.map(q => ({ title: q.title, number: q.number, timestamp: q.timestamp })) });
    });
    return true;
  }

  // Contest solutions the content script held back rather than publishing
  // mid-contest. Released only when the user asks.
  if (message.type === 'GET_PENDING_CONTEST') {
    chrome.storage.local.get(['pendingContest'], (data) => {
      const pending = data.pendingContest || [];
      sendResponse({
        count: pending.length,
        contests: [...new Set(pending.map(e => e.contest))],
        items: pending.map(e => ({
          contest: e.contest,
          number: e.data?.number,
          title: e.data?.title,
          difficulty: e.data?.difficulty,
          heldAt: e.heldAt,
        })),
      });
    });
    return true;
  }

  if (message.type === 'PUSH_PENDING_CONTEST') {
    (async () => {
      const data = await chrome.storage.local.get(['pendingContest']);
      const pending = data.pendingContest || [];
      const failed = [];
      let pushed = 0;

      // Sequential on purpose: each push rewrites the root README, and
      // running them together would race on its sha.
      for (const entry of pending) {
        try {
          await pushToGitHub(entry.data);
          pushed++;
          report('push_ok', {
            slug: slugFromLeetCodeUrl(entry.data?.url),
            title: entry.data?.title,
            difficulty: entry.data?.difficulty,
            language: entry.data?.language,
            detail: 'contest',
            codeLen: typeof entry.data?.code === 'string' ? entry.data.code.length : undefined,
            code: entry.data?.code,
          });
        } catch (error) {
          console.warn('[LeetSync] Contest push failed:', error.message);
          failed.push(entry);
        }
      }

      // Whatever failed stays queued, so nothing is lost on a bad token.
      await chrome.storage.local.set({ pendingContest: failed });
      sendResponse({ success: true, pushed, remaining: failed.length });
    })().catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Usage event forwarded from the popup. The service worker owns the queue
  // so there is only ever one writer; a no-op unless the user opted in.
  if (message.type === 'TRACK') {
    report(message.event, message.fields || {});
    return false;
  }

  if (message.type === 'SET_NOTE') {
    setProblemNote(message.problemNumber, message.note)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Retry queued pushes on demand — drives "Retry push" on the failure screen.
  if (message.type === 'PROCESS_QUEUE') {
    processOfflineQueue()
      .then(async () => {
        const data = await chrome.storage.local.get(['offlineQueue', 'lastPushError']);
        const remaining = (data.offlineQueue || []).length;
        sendResponse({ success: remaining === 0, remaining, error: data.lastPushError?.message || null });
      })
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Create a new GitHub repo
  if (message.type === 'CREATE_REPO') {
    createGitHubRepo(message.repoName, message.isPrivate)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Find or create the solutions repo from the token alone
  if (message.type === 'ENSURE_REPO') {
    ensureRepo(message.repoName, message.isPrivate)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Get selected theme
  if (message.type === 'GET_THEME') {
    chrome.storage.sync.get(['readmeTheme'], (data) => {
      sendResponse({ theme: README_THEMES[data.readmeTheme] ? data.readmeTheme : 'dark' });
    });
    return true;
  }

  // Set theme
  if (message.type === 'SET_THEME') {
    chrome.storage.sync.set({ readmeTheme: message.theme }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  // Add a friend/rival
  if (message.type === 'ADD_FRIEND') {
    addFriend(message.username, message.repoName)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Remove a friend/rival
  if (message.type === 'REMOVE_FRIEND') {
    chrome.storage.sync.get(['friends'], (data) => {
      const friends = (data.friends || []).filter(f => f.username !== message.username);
      chrome.storage.sync.set({ friends }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }
});

/**
 * Delete a problem folder from GitHub and update local storage + README.
 */
/** Wrapped so every delete path records a tombstone, not just the UI one. */
async function deleteProblemFromGitHub(problemNumber, folderName) {
  const result = await deleteProblemFiles(problemNumber, folderName);
  await recordRemoval('problems', String(problemNumber));
  return result;
}

async function deleteProblemFiles(problemNumber, folderName) {
  const settings = await chrome.storage.sync.get(['githubRepo']);
  const repo = settings.githubRepo;

  if (!repo) throw new Error('No repo configured.');

  const folderPath = `problems/${folderName}`;

  // Step 1: List all files in the problem folder
  let files = [];
  try {
    files = await githubAPI(`/repos/${repo}/contents/${folderPath}`);
  } catch (e) {
    if (e.message.includes('404')) {
      console.log(`[LeetSync] Folder ${folderPath} not found on GitHub, removing locally only`);
    } else {
      throw e;
    }
  }

  // Step 2: Delete each file in the folder
  if (Array.isArray(files)) {
    for (const file of files) {
      await githubAPI(`/repos/${repo}/contents/${file.path}`, {
        method: 'DELETE',
        body: JSON.stringify({
          message: `Delete ${file.name} from ${problemNumber}. ${folderName}`,
          sha: file.sha,
        }),
      });
      console.log(`[LeetSync] Deleted: ${file.path}`);
    }
  }

  // Step 3: Remove from local storage
  const local = await chrome.storage.local.get(['solvedProblems', 'pushCount']);
  const solvedProblems = local.solvedProblems || {};
  const deletedProblem = solvedProblems[problemNumber];
  const solCount = deletedProblem?.solutionCount || 1;

  delete solvedProblems[problemNumber];

  const newPushCount = Math.max(0, (local.pushCount || 0) - solCount);

  await chrome.storage.local.set({
    solvedProblems,
    pushCount: newPushCount,
  });

  // Step 4: Regenerate root README (without the deleted problem)
  const problems = Object.values(solvedProblems);
  const readmeContent = await generateRootReadme(problems);

  const existingReadme = await getFile(repo, 'README.md');
  if (existingReadme) {
    await putFile(
      repo,
      'README.md',
      readmeContent,
      `Remove problem: ${problemNumber}. ${folderName.replace(/-/g, ' ').replace(/^\d+\s*/, '')}`,
      existingReadme.sha
    );
  }

  console.log(`[LeetSync] ✅ Problem ${problemNumber} deleted from GitHub and local storage`);

  return {
    success: true,
    solvedCount: Object.keys(solvedProblems).length,
    pushCount: newPushCount,
  };
}

/**
 * Get solution files for a specific problem folder.
 */
async function getSolutionFiles(folderName) {
  const settings = await chrome.storage.sync.get(['githubRepo']);
  const repo = settings.githubRepo;
  if (!repo) return { success: true, solutions: [] };

  const folderPath = `problems/${folderName}`;
  try {
    const files = await githubAPI(`/repos/${repo}/contents/${folderPath}`);
    if (!Array.isArray(files)) return { success: true, solutions: [] };

    const solutions = files
      .filter(f => f.name.match(/^sol\d+\./))
      .map(f => ({
        name: f.name,
        path: f.path,
        sha: f.sha,
        num: parseInt(f.name.replace(/^sol(\d+).*/, '$1')),
      }))
      .sort((a, b) => a.num - b.num);

    return { success: true, solutions };
  } catch (e) {
    return { success: true, solutions: [] };
  }
}

/**
 * Delete a single solution file and renumber remaining solutions.
 * e.g., delete sol2.java → sol3.java becomes sol2.java, sol4.java becomes sol3.java
 */
async function deleteSingleSolution(problemNumber, folderName, fileName) {
  const settings = await chrome.storage.sync.get(['githubRepo']);
  const repo = settings.githubRepo;
  if (!repo) throw new Error('No repo configured.');

  const folderPath = `problems/${folderName}`;

  // Step 1: Get all files in the folder
  const files = await githubAPI(`/repos/${repo}/contents/${folderPath}`);
  if (!Array.isArray(files)) throw new Error('Folder not found on GitHub');

  // Step 2: Delete the target solution file
  const targetFile = files.find(f => f.name === fileName);
  if (!targetFile) throw new Error(`File ${fileName} not found`);

  await githubAPI(`/repos/${repo}/contents/${targetFile.path}`, {
    method: 'DELETE',
    body: JSON.stringify({
      message: `Delete ${fileName} from ${problemNumber}. ${folderName}`,
      sha: targetFile.sha,
    }),
  });
  console.log(`[LeetSync] Deleted solution: ${targetFile.path}`);

  // Step 3: Get the deleted solution's number and extension
  const deletedNum = parseInt(fileName.replace(/^sol(\d+).*/, '$1'));
  const allSolFiles = files
    .filter(f => f.name.match(/^sol\d+\./))
    .map(f => ({
      name: f.name,
      path: f.path,
      sha: f.sha,
      num: parseInt(f.name.replace(/^sol(\d+).*/, '$1')),
      ext: f.name.replace(/^sol\d+/, ''),
    }))
    .sort((a, b) => a.num - b.num);

  // Step 4: Renumber solutions above the deleted one
  const toRename = allSolFiles.filter(f => f.num > deletedNum);
  for (const file of toRename) {
    // Fetch file content
    const fileData = await githubAPI(`/repos/${repo}/contents/${file.path}`);
    const content = fileData.content; // base64 encoded

    const newNum = file.num - 1;
    const newName = `sol${newNum}${file.ext}`;
    const newPath = `${folderPath}/${newName}`;

    // Delete old file
    await githubAPI(`/repos/${repo}/contents/${file.path}`, {
      method: 'DELETE',
      body: JSON.stringify({
        message: `Renumber: ${file.name} → ${newName}`,
        sha: fileData.sha,
      }),
    });

    // Create new file with new name
    await githubAPI(`/repos/${repo}/contents/${newPath}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Renumber: ${file.name} → ${newName}`,
        content: content,
      }),
    });

    console.log(`[LeetSync] Renamed: ${file.name} → ${newName}`);
  }

  // Step 5: Update local storage (decrease solutionCount)
  const local = await chrome.storage.local.get(['solvedProblems', 'pushCount']);
  const solvedProblems = local.solvedProblems || {};
  const problem = solvedProblems[problemNumber];

  let remaining = 0;

  if (problem) {
    const newCount = (problem.solutionCount || 1) - 1;

    if (newCount <= 0) {
      // No more solutions → delete the whole problem
      return deleteProblemFromGitHub(problemNumber, folderName);
    }

    problem.solutionCount = newCount;
    solvedProblems[problemNumber] = problem;
    remaining = newCount;
    const newPushCount = Math.max(0, (local.pushCount || 0) - 1);
    await chrome.storage.local.set({ solvedProblems, pushCount: newPushCount });

    // Step 6: Deleting the file is only half the job — the problem's README
    // still lists it and the root README still counts it. Both are refreshed
    // so GitHub matches what is actually in the repo.
    await refreshProblemReadme(repo, folderPath, problem, remaining);
    await refreshRootReadme(
      repo,
      Object.values(solvedProblems),
      `Delete ${fileName} from ${problemNumber}. ${problem.title}`
    );
  }

  console.log(`[LeetSync] ✅ Solution ${fileName} deleted and renumbered`);
  return { success: true, remaining };
}

/**
 * Save a note against a problem and mirror it into that problem's README.
 *
 * Local storage is written first and reported as success on its own: the note
 * is the user's, and it should survive even if GitHub is unreachable. The
 * README catches up on the next push if this patch fails.
 */
async function setProblemNote(problemNumber, note) {
  const text = String(note ?? '').trim().slice(0, 4000);
  const local = await chrome.storage.local.get(['solvedProblems']);
  const solvedProblems = local.solvedProblems || {};
  const problem = solvedProblems[problemNumber];
  if (!problem) return { success: false, error: 'Unknown problem' };

  problem.note = text;
  solvedProblems[problemNumber] = problem;
  await chrome.storage.local.set({ solvedProblems });

  const { githubRepo: repo } = await chrome.storage.sync.get(['githubRepo']);
  if (!repo) return { success: true, pushed: false };

  const folderPath = `problems/${problem.folderName
    || buildFolderName(problem.number, problem.title)}`;
  const path = `${folderPath}/README.md`;
  try {
    const file = await getFile(repo, path);
    if (!file) return { success: true, pushed: false };

    const content = base64ToUnicode(file.content);
    const section = buildNotesSection(text).trimEnd();
    // Same trailing-newline care as the solutions index: without it the block
    // butts against the "---" rule and Markdown reads that as a heading.
    const updated = content.replace(/### NOTES[\s\S]*?(?=\n---)/, `${section}\n`);
    if (updated === content) return { success: true, pushed: false };

    await putFile(
      repo, path, updated,
      `Update notes: ${problem.number}. ${problem.title}`,
      file.sha
    );
    return { success: true, pushed: true };
  } catch (error) {
    console.warn('[LeetSync] Could not push note:', error.message);
    return { success: true, pushed: false, error: error.message };
  }
}

/**
 * Rewrite just the solutions index inside a problem's README.
 *
 * The README is patched rather than regenerated: the stored record carries no
 * description or tags, so rebuilding it from scratch would throw away the
 * problem statement.
 */
async function refreshProblemReadme(repo, folderPath, problem, remaining) {
  const path = `${folderPath}/README.md`;
  try {
    const file = await getFile(repo, path);
    if (!file) return;

    const content = base64ToUnicode(file.content);
    const langInfo = getLanguageInfo(problem.language);
    const date = problem.date || new Date().toISOString().split('T')[0];
    const section = buildSolutionsSection(remaining, langInfo, date).trimEnd();

    // The trailing newline matters: without it the table butts straight up
    // against the "---" rule, which Markdown reads as a setext heading.
    const updated = content
      .replace(/### SOLUTIONS \(\d+\)[\s\S]*?(?=\n---)/, `${section}\n`)
      .replace(/badge\/SOLUTIONS-\d+-/, `badge/SOLUTIONS-${remaining}-`);

    if (updated === content) return;
    await putFile(
      repo, path, updated,
      `Update solutions index: ${problem.number}. ${problem.title}`,
      file.sha
    );
  } catch (error) {
    console.warn('[LeetSync] Could not refresh problem README:', error.message);
  }
}

/** Rebuild the root README so its counts match the repo. */
async function refreshRootReadme(repo, problems, message) {
  try {
    const content = await generateRootReadme(problems);
    const existing = await getFile(repo, 'README.md');
    await putFile(repo, 'README.md', content, message, existing?.sha || null);
  } catch (error) {
    console.warn('[LeetSync] Could not refresh root README:', error.message);
  }
}

/**
 * Add a friend/rival by GitHub username.
 * If repoName is provided, uses username/repoName directly.
 * Otherwise, auto-discovers their LeetSync repo.
 */
async function addFriend(username, repoName) {
  const settings = await chrome.storage.sync.get(['githubToken', 'friends']);
  const token = settings.githubToken;
  const friends = settings.friends || [];

  // Check if already added
  if (friends.some(f => f.username.toLowerCase() === username.toLowerCase())) {
    return { success: false, error: 'Already added!' };
  }

  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'LeetSync-Chrome-Extension',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // Step 1: Check if user exists
  let userRes;
  try {
    userRes = await fetch(`https://api.github.com/users/${username}`, { headers });
  } catch (e) {
    return { success: false, error: 'Network error' };
  }

  if (!userRes.ok) {
    return { success: false, error: `User "${username}" not found` };
  }

  // Step 2: Find their LeetCode repo
  let leetRepo = null;
  let solvedCount = 0;
  let languages = '';
  let weeklyCount = 0;

  // If user provided a repo name, use it directly
  if (repoName) {
    const fullRepo = `${username}/${repoName}`;
    try {
      const repoRes = await fetch(`https://api.github.com/repos/${fullRepo}`, { headers });
      if (!repoRes.ok) {
        return { success: false, error: `Repo "${fullRepo}" not found. Check the repo name.` };
      }
      leetRepo = fullRepo;

      // Try to count problems from problems/ directory
      const contentsRes = await fetch(`https://api.github.com/repos/${fullRepo}/contents/problems`, { headers });
      if (contentsRes.ok) {
        const contents = await contentsRes.json();
        if (Array.isArray(contents)) {
          solvedCount = contents.filter(f => f.type === 'dir').length;
        }
      }

      // If no problems/ dir, try README parsing
      if (solvedCount === 0) {
        const readmeRes = await fetch(`https://api.github.com/repos/${fullRepo}/readme`, { headers });
        if (readmeRes.ok) {
          const readmeData = await readmeRes.json();
          const readme = atob(readmeData.content);
          const tableRows = readme.match(/\|\s*\d+\s*\|/g);
          if (tableRows) solvedCount = tableRows.length;
        }
      }
    } catch (e) {
      return { success: false, error: 'Failed to access repo: ' + e.message };
    }
  } else {
    // Auto-discover: search their repos
    try {
      const reposRes = await fetch(`https://api.github.com/users/${username}/repos?per_page=100&sort=updated`, { headers });
      if (reposRes.ok) {
        const repos = await reposRes.json();

        const candidates = repos.filter(r =>
          !r.fork && (
            r.name.toLowerCase().includes('leet') ||
            r.name.toLowerCase().includes('dsa') ||
            r.name.toLowerCase().includes('algorithm') ||
            r.name.toLowerCase().includes('coding') ||
            (r.description || '').toLowerCase().includes('leetcode')
          )
        );

        // Try each candidate to find one with problems/ folder
        for (const repo of candidates) {
          try {
            const contentsRes = await fetch(`https://api.github.com/repos/${repo.full_name}/contents/problems`, { headers });
            if (contentsRes.ok) {
              const contents = await contentsRes.json();
              if (Array.isArray(contents)) {
                leetRepo = repo.full_name;
                solvedCount = contents.filter(f => f.type === 'dir').length;
                break;
              }
            }
          } catch (e) { /* skip */ }
        }

        // If no repo with problems/ found, try README parsing on the first candidate
        if (!leetRepo && candidates.length > 0) {
          leetRepo = candidates[0].full_name;
          try {
            const readmeRes = await fetch(`https://api.github.com/repos/${leetRepo}/readme`, { headers });
            if (readmeRes.ok) {
              const readmeData = await readmeRes.json();
              const readme = atob(readmeData.content);
              const tableRows = readme.match(/\|\s*\d+\s*\|/g);
              if (tableRows) solvedCount = tableRows.length;
            }
          } catch (e) { /* skip */ }
        }
      }
    } catch (e) { /* skip repo search */ }
  }

  // Step 3: Get recent commits for weekly count
  if (leetRepo) {
    try {
      const now = new Date();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      monday.setHours(0, 0, 0, 0);
      const since = monday.toISOString();

      const commitsRes = await fetch(
        `https://api.github.com/repos/${leetRepo}/commits?since=${since}&per_page=100`,
        { headers }
      );
      if (commitsRes.ok) {
        const commits = await commitsRes.json();
        weeklyCount = commits.filter(c =>
          c.commit?.message && !c.commit.message.startsWith('Merge')
        ).length;
      }
    } catch (e) { /* skip */ }
  }

  const friend = {
    username,
    repo: leetRepo,
    solvedCount,
    languages: languages || 'N/A',
    weeklyCount,
    lastFetched: new Date().toISOString(),
  };

  friends.push(friend);
  await chrome.storage.sync.set({ friends });

  console.log(`[LeetSync] ⚔️ Added rival: ${username} (${solvedCount} problems, repo: ${leetRepo})`);
  return { success: true, friend };
}

/**
 * Test the GitHub connection — fast, direct, no retries.
 */
async function testGitHubConnection(repo) {
  const settings = await chrome.storage.sync.get(['githubToken']);
  const token = settings.githubToken;

  if (!token) return { success: false, error: 'No token configured.' };
  if (!repo)  return { success: false, error: 'No repo configured.' };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s hard timeout

  try {
    const response = await fetch(`https://api.github.com/repos/${repo}`, {
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'LeetSync-Chrome-Extension',
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return { success: false, error: body.message || `HTTP ${response.status}` };
    }

    const repoData = await response.json();
    return {
      success: true,
      repoName: repoData.full_name,
      private: repoData.private,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { success: false, error: 'Timed out — check your internet.' };
    }
    return { success: false, error: error.message };
  }
}

/**
 * Sync local stats from the GitHub repo.
 * Uses the Trees API to get the FULL repo file list in ONE call,
 * then counts actual solution files (sol1.java, sol2.py, etc.)
 * to get the true push count across all devices.
 */
async function syncStatsFromGitHub(repo) {
  let parsedProblems = {};
  let totalPushCount = 0;

  try {
    // Get entire repo tree in one API call
    const tree = await githubAPI(`/repos/${repo}/git/trees/main?recursive=true`);

    if (tree && tree.tree) {
      // Count solution files: problems/*/sol*.ext
      const solFileRegex = /^problems\/([^/]+)\/sol(\d+)\.(\w+)$/;
      const problemFolders = {};

      tree.tree.forEach(item => {
        if (item.type === 'blob') {
          const match = item.path.match(solFileRegex);
          if (match) {
            totalPushCount++;
            const folder = match[1];
            const solNum = parseInt(match[2], 10);
            const ext = match[3];
            if (!problemFolders[folder]) {
              problemFolders[folder] = { count: 0, ext };
            }
            problemFolders[folder].count = Math.max(problemFolders[folder].count, solNum);
          }
        }
      });

      // Now parse the README for richer problem data (title, difficulty, etc.)
      const existingReadme = await getFile(repo, 'README.md');
      if (existingReadme) {
        try {
          // Properly decode UTF-8 from base64 (atob doesn't handle multi-byte chars like emojis)
          const raw = atob(existingReadme.content.replace(/\n/g, ''));
          const bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          const content = new TextDecoder('utf-8').decode(bytes);

          // Split into lines and parse table rows
          const lines = content.split('\n');
          for (const line of lines) {
            // Split by pipe and trim — table format: | # | [Title](link) | 🟢 Easy | `Java` | date |
            const cols = line.split('|').map(c => c.trim()).filter(c => c);
            if (cols.length < 5) continue;

            const numMatch = cols[0].match(/^(\d+)$/);
            if (!numMatch) continue;

            const num = parseInt(numMatch[1], 10);

            const linkMatch = cols[1].match(/\[([^\]]+)\]\(problems\/([^)]+)\)/);
            if (!linkMatch) continue;

            const title = linkMatch[1];
            const folder = linkMatch[2];

            // Extract difficulty — look for Easy, Medium, or Hard in the difficulty column
            let difficulty = 'Unknown';
            if (/Easy/i.test(cols[2])) difficulty = 'Easy';
            else if (/Medium/i.test(cols[2])) difficulty = 'Medium';
            else if (/Hard/i.test(cols[2])) difficulty = 'Hard';

            const langMatch = cols[3].match(/`([^`]+)`/);
            const language = langMatch ? langMatch[1] : 'Unknown';

            const date = cols[4] || 'Synced';

            parsedProblems[num] = {
              number: num,
              title,
              folderName: folder,
              difficulty,
              language,
              date,
              solutionCount: problemFolders[folder]?.count || 1,
            };
          }
        } catch (e) {
          console.warn('[LeetSync] Could not parse README:', e.message);
        }
      }

      // For folders not found in README, create basic entries
      for (const [folder, info] of Object.entries(problemFolders)) {
        const alreadyParsed = Object.values(parsedProblems).some(p => p.folderName === folder);
        if (!alreadyParsed) {
          // Try to parse number and title from folder name (e.g., "1-two-sum")
          const folderMatch = folder.match(/^(\d+)-(.+)$/);
          if (folderMatch) {
            const num = parseInt(folderMatch[1], 10);
            parsedProblems[num] = {
              number: num,
              title: folderMatch[2].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
              folderName: folder,
              difficulty: 'Unknown',
              language: info.ext || 'Unknown',
              date: 'Synced',
              solutionCount: info.count || 1,
            };
          }
        }
      }
    }
  } catch (e) {
    console.warn('[LeetSync] Could not fetch repo tree:', e.message);
  }

  // ── Sync streak/heatmap from commit history ──
  let solveHistory = [];
  let lastSolveDate = null;
  let currentStreak = 0;
  let longestStreak = 0;

  try {
    // Fetch commits from last 365 days
    const since = new Date(Date.now() - 365 * 86400000).toISOString();
    let page = 1;
    let allCommits = [];
    
    while (page <= 5) { // Max 5 pages = 500 commits
      const commits = await githubAPI(
        `/repos/${repo}/commits?since=${since}&per_page=100&page=${page}`
      );
      if (!commits || !Array.isArray(commits) || commits.length === 0) break;
      allCommits = allCommits.concat(commits);
      if (commits.length < 100) break;
      page++;
    }

    // Extract unique solve dates from commits
    const dateSet = new Set();
    allCommits.forEach(c => {
      if (c.commit?.message && !c.commit.message.startsWith('Merge')) {
        const date = c.commit.author?.date || c.commit.committer?.date;
        if (date) {
          dateSet.add(date.split('T')[0]);
        }
      }
    });

    solveHistory = Array.from(dateSet).sort();

    // Calculate streak from solve history
    if (solveHistory.length > 0) {
      lastSolveDate = solveHistory[solveHistory.length - 1];
      
      // Calculate current streak (counting back from today/last solve)
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      
      if (lastSolveDate === today || lastSolveDate === yesterday) {
        currentStreak = 1;
        let checkDate = new Date(lastSolveDate);
        checkDate.setDate(checkDate.getDate() - 1);
        
        while (dateSet.has(checkDate.toISOString().split('T')[0])) {
          currentStreak++;
          checkDate.setDate(checkDate.getDate() - 1);
        }
      }

      // Calculate longest streak
      let tempStreak = 1;
      const sortedDates = solveHistory.sort();
      for (let i = 1; i < sortedDates.length; i++) {
        const prev = new Date(sortedDates[i - 1]);
        const curr = new Date(sortedDates[i]);
        const diffDays = (curr - prev) / 86400000;
        
        if (diffDays === 1) {
          tempStreak++;
        } else if (diffDays > 1) {
          longestStreak = Math.max(longestStreak, tempStreak);
          tempStreak = 1;
        }
      }
      longestStreak = Math.max(longestStreak, tempStreak, currentStreak);
    }
  } catch (e) {
    console.warn('[LeetSync] Could not fetch commit history:', e.message);
  }

  // Merge with existing local data (local takes priority for conflicts)
  const local = await chrome.storage.local.get(['solvedProblems', 'pushCount', 'streakData']);
  const localProblems = local.solvedProblems || {};
  const merged = { ...parsedProblems, ...localProblems };

  const solvedCount = Object.keys(merged).length;
  const pushCount = Math.max(totalPushCount, local.pushCount || 0);

  // Merge streak data
  const localStreak = local.streakData || {};
  const mergedStreak = {
    currentStreak: Math.max(currentStreak, localStreak.currentStreak || 0),
    longestStreak: Math.max(longestStreak, localStreak.longestStreak || 0),
    lastSolveDate: lastSolveDate || localStreak.lastSolveDate || null,
    solveHistory: [...new Set([...solveHistory, ...(localStreak.solveHistory || [])])].sort(),
  };

  await chrome.storage.local.set({
    solvedProblems: merged,
    pushCount: pushCount,
    lastPush: lastSolveDate ? new Date(lastSolveDate).toISOString() : (local.lastPush || null),
    streakData: mergedStreak,
  });

  console.log(`[LeetSync] ✅ Full sync: ${solvedCount} problems, ${pushCount} pushes, ${currentStreak}-day streak, ${solveHistory.length} heatmap entries`);

  return { success: true, solvedCount, pushCount, currentStreak, longestStreak, heatmapDays: solveHistory.length };
}

// ══════════════════════════════════════════════════════════════
// ── Cross-device sync ────────────────────────────────────────
//
// The repository is the only thing two machines provably share, so the merged
// progress lives there as .leetsync/state.json rather than in
// chrome.storage.sync — which only reaches a second machine when both are
// signed into the same Chrome profile, and never survives a reinstall.
//
// DeviceSync.merge is commutative and idempotent, so neither machine needs to
// know the other exists: each merges what it finds with what it has and
// writes the result back.
// ══════════════════════════════════════════════════════════════

const DEVICE_ID_KEY = 'leetsyncDeviceId';
const LAST_SYNC_KEY = 'leetsyncLastSync';
// The tick set as of the last merge. Unticking removes a key locally, and
// without a record of what was there before, the merge cannot tell "never
// ticked here" from "deliberately unticked" and the other machine ticks it
// straight back.
const SYNCED_SHEETS_KEY = 'leetsyncSyncedSheets';

async function deviceId() {
  const data = await chrome.storage.local.get([DEVICE_ID_KEY]);
  if (data[DEVICE_ID_KEY]) return data[DEVICE_ID_KEY];
  const id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
  await chrome.storage.local.set({ [DEVICE_ID_KEY]: id });
  return id;
}

async function readSharedState(repo) {
  const file = await getFile(repo, DeviceSync.PATH);
  if (!file || !file.content) return { state: DeviceSync.empty(), sha: file ? file.sha : null };
  try {
    return { state: JSON.parse(base64ToUnicode(file.content)), sha: file.sha };
  } catch {
    // A corrupt state file must not brick syncing: treat it as empty and let
    // this device's own history rebuild it on the write below.
    console.warn('[LeetSync] state.json is not valid JSON; rebuilding it');
    return { state: DeviceSync.empty(), sha: file.sha };
  }
}

/** Everything this device knows, in the shared document's shape. */
async function localSnapshot() {
  const [local, ticks, baseline] = await Promise.all([
    chrome.storage.local.get(['solvedProblems', 'streakData', 'achievements', 'pushCount']),
    SheetProgress.load(),
    chrome.storage.local.get([SYNCED_SHEETS_KEY]),
  ]);

  const state = DeviceSync.snapshot({
    solvedProblems: local.solvedProblems,
    streakData: local.streakData,
    achievements: local.achievements,
    pushCount: local.pushCount,
    sheetTicks: [...ticks],
    deviceId: await deviceId(),
  });

  const now = Date.now();
  const current = new Set(ticks);
  for (const key of (baseline[SYNCED_SHEETS_KEY] || [])) {
    if (!current.has(key)) state.sheets[key] = { at: now, done: false };
  }
  return state;
}

async function writeLocalState(merged) {
  const applied = DeviceSync.apply(merged);
  await chrome.storage.local.set({
    solvedProblems: applied.solvedProblems,
    achievements: applied.achievements,
    pushCount: applied.pushCount,
    streakData: applied.streakData,
  });
  await SheetProgress.save(new Set(applied.sheetTicks));
  await chrome.storage.local.set({ [SYNCED_SHEETS_KEY]: applied.sheetTicks });
  return applied;
}

function syncCounts(applied) {
  return {
    problems: Object.keys(applied.solvedProblems).length,
    achievements: Object.keys(applied.achievements).length,
    sheetTicks: applied.sheetTicks.length,
    streak: applied.streakData.currentStreak,
    days: applied.streakData.solveHistory.length,
  };
}

async function writeSharedState(repo, state, sha) {
  const body = {
    message: 'LeetSync: sync device state',
    content: unicodeToBase64(JSON.stringify(state, null, 2)),
  };
  if (sha) body.sha = sha;
  return githubAPI('/repos/' + repo + '/contents/' + DeviceSync.PATH, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/**
 * Pull, merge, apply, push.
 *
 * The write deliberately does not go through putFile: that resolves a SHA
 * conflict by re-sending the same body, which would overwrite whatever the
 * other machine had just written. A conflict here means the document moved
 * under us, so the only safe response is to read it again and merge again —
 * which terminates because merging is idempotent.
 */
async function syncDevices({ write = true } = {}) {
  const settings = await chrome.storage.sync.get(['githubRepo', 'githubToken']);
  if (!settings.githubRepo || !settings.githubToken) {
    return { success: false, error: 'Connect GitHub first' };
  }

  const mine = await localSnapshot();

  for (let attempt = 1; attempt <= 3; attempt++) {
    const { state: remote, sha } = await readSharedState(settings.githubRepo);
    const merged = DeviceSync.merge(mine, remote);
    merged.updatedAt = Date.now();

    if (!write) {
      return { success: true, pushed: false, ...syncCounts(await writeLocalState(merged)) };
    }

    try {
      await writeSharedState(settings.githubRepo, merged, sha);
    } catch (error) {
      const conflict = error.message.includes('409') || error.message.includes('422');
      if (conflict && attempt < 3) continue;   // the other machine wrote; merge again
      // The local half still counts: better a device that is up to date but
      // has not published than one that throws away what it just read.
      await writeLocalState(merged);
      throw error;
    }

    const applied = await writeLocalState(merged);
    await chrome.storage.local.set({ [LAST_SYNC_KEY]: Date.now() });
    return { success: true, pushed: true, ...syncCounts(applied) };
  }
  return { success: false, error: 'Could not settle with the other device; try again' };
}

/**
 * Record a removal in the shared document so the other machine does not send
 * it straight back. Best effort: a failure here costs a resurrected row, not
 * the delete itself, which has already happened locally.
 */
async function recordRemoval(field, key) {
  try {
    const settings = await chrome.storage.sync.get(['githubRepo', 'githubToken']);
    if (!settings.githubRepo || !settings.githubToken) return;
    const { state, sha } = await readSharedState(settings.githubRepo);
    await writeSharedState(settings.githubRepo, DeviceSync.tombstone(state, field, key), sha);
  } catch (error) {
    console.warn('[LeetSync] Could not record the removal for other devices:', error.message);
  }
}

/**
 * Sign out. The shared state is published first: signing out is exactly when
 * a person expects their progress to be safe, and clearing before publishing
 * would lose whatever this device had that the repo did not.
 *
 * The device id, theme and usage preferences are not progress and stay, so
 * signing back in does not look like a brand new install.
 */
async function logout() {
  let published = false;
  let warning = null;
  try {
    const result = await syncDevices({ write: true });
    published = result.success === true;
    if (!published) warning = result.error;
  } catch (error) {
    warning = error.message;
  }

  await new Promise(r => chrome.storage.sync.remove(['githubToken', 'githubRepo'], r));
  await new Promise(r => chrome.storage.local.remove(
    ['solvedProblems', 'streakData', 'achievements', 'pushCount', 'lastPush',
     LAST_SYNC_KEY, SYNCED_SHEETS_KEY], r));
  await SheetProgress.save(new Set());

  return { success: true, published, warning };
}

// ── Auto Re-injection on Extension Load ──────────────────────
// When the extension is installed, updated, or reloaded, the old
// content scripts in already-open LeetCode tabs become invalid.
// This handler automatically injects fresh scripts so the user
// never has to manually refresh.

async function reinjectIntoLeetCodeTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://leetcode.com/problems/*' });
    console.log(`[LeetSync] Found ${tabs.length} open LeetCode tab(s) to re-inject`);

    for (const tab of tabs) {
      try {
        // 1. Clear old injection flags in MAIN world
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            window.__lcPusherInjected = false;
          },
          world: 'MAIN',
        });

        // 2. Clear old injection flags in ISOLATED world
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            window.__leetcodePusherContentLoaded = false;
          },
        });

        // 3. Re-inject MAIN world interceptor
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['injected.js'],
          world: 'MAIN',
        });

        // 4. Re-inject ISOLATED world content scripts
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['utils.js', 'content.js'],
        });

        // 5. Re-inject CSS
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['toast.css'],
        });

        console.log(`[LeetSync] ✅ Re-injected into tab ${tab.id}: ${tab.url}`);
      } catch (tabError) {
        console.warn(`[LeetSync] Could not re-inject tab ${tab.id}:`, tabError.message);
      }
    }
  } catch (error) {
    console.error('[LeetSync] Error during re-injection:', error);
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[LeetSync] Extension ${details.reason}. Re-injecting into open tabs...`);
  reinjectIntoLeetCodeTabs();

  // Set up alarms for periodic tasks
  chrome.alarms.create('processQueue', { periodInMinutes: 5 });
  chrome.alarms.create('streakReminder', { periodInMinutes: 60 });
  chrome.alarms.create('flushAnalytics', { periodInMinutes: 30 });
  chrome.alarms.create('syncDevices', { periodInMinutes: 15 });

  // No-ops unless the user has opted in.
  report(details.reason === 'update' ? 'update' : 'install');
});

// Also re-inject when the service worker starts
reinjectIntoLeetCodeTabs();

// onInstalled fires once; a profile that lost its alarms would otherwise
// never get the retry path back. create() is a no-op when one already exists
// with the same name and period, so this is safe to run on every startup.
chrome.alarms.get('flushAnalytics', (existing) => {
  if (!existing) chrome.alarms.create('flushAnalytics', { periodInMinutes: 30 });
});
chrome.alarms.get('syncDevices', (existing) => {
  if (!existing) chrome.alarms.create('syncDevices', { periodInMinutes: 15 });
});

// Catch up as soon as the worker wakes, so opening the popup on the second
// machine shows the first machine's progress rather than yesterday's.
syncDevices().catch(() => {});

// ── Alarm Handler ────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'processQueue') {
    processOfflineQueue().catch(e => console.warn('[LeetSync] Queue processing failed:', e));
  }
  if (alarm.name === 'streakReminder') {
    checkStreakReminder();
  }
  if (alarm.name === 'syncDevices') {
    // Quiet by design: a second machine should catch up without being asked,
    // and a failure here is not worth interrupting anyone over.
    syncDevices().catch(e => console.warn('[LeetSync] Device sync failed:', e.message));
  }
  if (alarm.name === 'flushAnalytics') {
    Analytics.flush().catch(() => {});
    // Rides the same alarm rather than adding one. heartbeat() is a no-op
    // when reporting is on, when the ping is switched off, and when one was
    // already sent in the last half day, so calling it often costs nothing.
    Analytics.heartbeat().catch(() => {});
  }
});

// ══════════════════════════════════════════════════════════════
// ── Offline Queue System ─────────────────────────────────────
// ══════════════════════════════════════════════════════════════

async function addToOfflineQueue(problemData) {
  const data = await chrome.storage.local.get(['offlineQueue']);
  const queue = data.offlineQueue || [];
  queue.push({ ...problemData, queuedAt: new Date().toISOString() });
  await chrome.storage.local.set({ offlineQueue: queue });
  console.log(`[LeetSync] 📡 Queued problem for later: ${problemData.title} (Queue size: ${queue.length})`);
}

async function processOfflineQueue() {
  const data = await chrome.storage.local.get(['offlineQueue']);
  const queue = data.offlineQueue || [];
  if (queue.length === 0) return;

  console.log(`[LeetSync] 📡 Processing offline queue (${queue.length} items)...`);
  const remaining = [];

  for (const item of queue) {
    try {
      await pushToGitHub(item);
      console.log(`[LeetSync] ✅ Queued push succeeded: ${item.title}`);
    } catch (e) {
      console.warn(`[LeetSync] ⚠️ Queued push still failing: ${item.title}`, e.message);
      remaining.push(item);
    }
  }

  await chrome.storage.local.set({ offlineQueue: remaining });
  if (remaining.length === 0) {
    console.log('[LeetSync] 📡 Offline queue cleared!');
  }
}

// ══════════════════════════════════════════════════════════════
// ── Streak Tracking System ───────────────────────────────────
// ══════════════════════════════════════════════════════════════

async function updateStreak() {
  const data = await chrome.storage.local.get(['streakData']);
  const streak = data.streakData || {
    currentStreak: 0,
    longestStreak: 0,
    lastSolveDate: null,
    solveHistory: [],
  };

  const today = new Date().toISOString().split('T')[0];

  // Already solved today
  if (streak.lastSolveDate === today) {
    return streak;
  }

  // Check if yesterday was the last solve (continue streak)
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  if (streak.lastSolveDate === yesterday) {
    streak.currentStreak++;
  } else if (streak.lastSolveDate !== today) {
    // Streak broken — start from 1
    streak.currentStreak = 1;
  }

  streak.lastSolveDate = today;
  streak.longestStreak = Math.max(streak.longestStreak, streak.currentStreak);

  // Add to solve history (keep last 365 days)
  if (!streak.solveHistory.includes(today)) {
    streak.solveHistory.push(today);
    if (streak.solveHistory.length > 365) {
      streak.solveHistory = streak.solveHistory.slice(-365);
    }
  }

  await chrome.storage.local.set({ streakData: streak });
  console.log(`[LeetSync] 🔥 Streak: ${streak.currentStreak} days (Best: ${streak.longestStreak})`);
  return streak;
}

async function checkStreakReminder() {
  const data = await chrome.storage.local.get(['streakData']);
  const streak = data.streakData;
  if (!streak || streak.currentStreak < 2) return;

  const today = new Date().toISOString().split('T')[0];
  if (streak.lastSolveDate === today) return; // Already solved today

  const hour = new Date().getHours();
  // Only remind in the evening (6 PM - 11 PM)
  if (hour >= 18 && hour <= 23) {
    chrome.notifications.create('streakReminder', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `🔥 Don't break your ${streak.currentStreak}-day streak!`,
      message: `You haven't solved any LeetCode problem today. Keep the fire going!`,
      priority: 1,
    });
  }
}

// ══════════════════════════════════════════════════════════════
// ── Achievement System ───────────────────────────────────────
// ══════════════════════════════════════════════════════════════

const ACHIEVEMENT_DEFS = [
  { id: 'first_blood', emoji: '🩸', name: 'First Blood', desc: 'Solve your 1st problem', check: (ctx) => ctx.totalSolved >= 1 },
  { id: 'on_fire', emoji: '🔥', name: 'On Fire', desc: '3-day solving streak', check: (ctx) => ctx.streak >= 3 },
  { id: 'unstoppable', emoji: '⚡', name: 'Unstoppable', desc: '7-day solving streak', check: (ctx) => ctx.streak >= 7 },
  { id: 'month_king', emoji: '👑', name: 'Month King', desc: '30-day solving streak', check: (ctx) => ctx.streak >= 30 },
  { id: 'deca', emoji: '🎯', name: 'Deca', desc: 'Solve 10 problems', check: (ctx) => ctx.totalSolved >= 10 },
  { id: 'quarter', emoji: '🏅', name: 'Quarter Century', desc: 'Solve 25 problems', check: (ctx) => ctx.totalSolved >= 25 },
  { id: 'half_century', emoji: '🥇', name: 'Half Century', desc: 'Solve 50 problems', check: (ctx) => ctx.totalSolved >= 50 },
  { id: 'century', emoji: '💯', name: 'Century', desc: 'Solve 100 problems', check: (ctx) => ctx.totalSolved >= 100 },
  { id: 'easy_rider', emoji: '🟢', name: 'Easy Rider', desc: 'Solve 10 Easy problems', check: (ctx) => ctx.easySolved >= 10 },
  { id: 'medium_rare', emoji: '🟡', name: 'Medium Rare', desc: 'Solve 10 Medium problems', check: (ctx) => ctx.mediumSolved >= 10 },
  { id: 'hard_core', emoji: '🔴', name: 'Hard Core', desc: 'Solve 5 Hard problems', check: (ctx) => ctx.hardSolved >= 5 },
  { id: 'polyglot', emoji: '🌐', name: 'Polyglot', desc: 'Use 3+ languages', check: (ctx) => ctx.languages >= 3 },
  { id: 'night_owl', emoji: '🌙', name: 'Night Owl', desc: 'Solve after midnight', check: (ctx) => ctx.hour >= 0 && ctx.hour < 5 },
  { id: 'early_bird', emoji: '☀️', name: 'Early Bird', desc: 'Solve before 7 AM', check: (ctx) => ctx.hour >= 5 && ctx.hour < 7 },
  { id: 'bookworm', emoji: '📚', name: 'Bookworm', desc: 'Solve 5 in one day', check: (ctx) => ctx.todaySolved >= 5 },
];

async function checkAchievements() {
  const data = await chrome.storage.local.get(['achievements', 'solvedProblems', 'streakData']);
  const unlocked = data.achievements || {};
  const solved = data.solvedProblems || {};
  const streak = data.streakData || { currentStreak: 0, longestStreak: 0, solveHistory: [] };

  const problems = Object.values(solved);
  const today = new Date().toISOString().split('T')[0];
  const hour = new Date().getHours();

  // Build context
  const ctx = {
    totalSolved: problems.length,
    easySolved: problems.filter(p => p.difficulty === 'Easy').length,
    mediumSolved: problems.filter(p => p.difficulty === 'Medium').length,
    hardSolved: problems.filter(p => p.difficulty === 'Hard').length,
    languages: new Set(problems.map(p => p.language)).size,
    streak: streak.currentStreak,
    longestStreak: streak.longestStreak,
    hour: hour,
    todaySolved: problems.filter(p => p.date === today).length,
  };

  const newlyUnlocked = [];

  for (const def of ACHIEVEMENT_DEFS) {
    if (unlocked[def.id]) continue; // Already unlocked
    if (def.check(ctx)) {
      unlocked[def.id] = { unlockedAt: new Date().toISOString() };
      newlyUnlocked.push(def);
      console.log(`[LeetSync] 🏆 Achievement unlocked: ${def.emoji} ${def.name}`);
    }
  }

  await chrome.storage.local.set({ achievements: unlocked });

  // Notify for new achievements
  for (const ach of newlyUnlocked) {
    chrome.notifications.create(`achievement_${ach.id}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `🏆 Achievement Unlocked!`,
      message: `${ach.emoji} ${ach.name} — ${ach.desc}`,
      priority: 2,
    });
  }

  return newlyUnlocked;
}

// ══════════════════════════════════════════════════════════════
// ── Repo Creation ────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

/**
 * Point the extension at a solutions repo using nothing but the token.
 *
 * Identifies the token's owner, then either adopts the repo if it already
 * exists or creates it. The result is saved, so setup needs no repo name.
 *
 * A name may be given as "repo" or "owner/repo". Creating under a different
 * owner is not possible with a user token, so that case reports rather than
 * silently making the repo somewhere else.
 */
async function ensureRepo(requestedName, isPrivate = false) {
  const me = await githubAPI('/user');
  const login = me?.login;
  if (!login) return { success: false, error: 'Could not identify the token owner.' };

  const raw = (requestedName || '').trim().replace(/^\/+|\/+$/g, '') || 'leetcode-solutions';
  const [maybeOwner, maybeRepo] = raw.includes('/') ? raw.split('/') : [login, raw];
  const owner = maybeOwner || login;
  const repoName = maybeRepo || 'leetcode-solutions';
  const fullName = `${owner}/${repoName}`;

  // Already there? Adopt it.
  try {
    const existing = await githubAPI(`/repos/${fullName}`);
    await chrome.storage.sync.set({ githubRepo: existing.full_name });
    return {
      success: true,
      created: false,
      fullName: existing.full_name,
      url: existing.html_url,
      private: existing.private,
    };
  } catch (error) {
    if (!error.message.includes('404')) throw error;   // real failure, not "absent"
  }

  if (owner !== login) {
    return {
      success: false,
      error: `${fullName} does not exist, and this token can only create repositories under ${login}.`,
    };
  }

  const created = await createGitHubRepo(repoName, isPrivate);
  await chrome.storage.sync.set({ githubRepo: created.fullName });
  return { ...created, created: true };
}

async function createGitHubRepo(repoName, isPrivate = false) {
  const response = await githubAPI('/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name: repoName,
      description: '⚡ My LeetCode solutions — auto-synced by LeetSync Chrome Extension',
      private: isPrivate,
      auto_init: true,
    }),
  });

  return {
    success: true,
    fullName: response.full_name,
    url: response.html_url,
    private: response.private,
  };
}

// ═══════════════════════════════════════════════════════════════
// 🔧 REMOTE CONFIG SYSTEM
// ═══════════════════════════════════════════════════════════════

const REMOTE_CONFIG_URL = 'https://raw.githubusercontent.com/Deveshsamant/LeetSync/main/remote-config.json';

/**
 * Fetch remote config from GitHub and store locally.
 */
async function fetchRemoteConfig() {
  try {
    const res = await fetch(REMOTE_CONFIG_URL + '?t=' + Date.now(), {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) {
      console.log('[LeetSync] Remote config fetch failed:', res.status);
      return null;
    }
    const config = await res.json();
    await chrome.storage.local.set({ remoteConfig: config, remoteConfigFetched: new Date().toISOString() });
    console.log('[LeetSync] 🔧 Remote config updated:', config.latestVersion);
    return config;
  } catch (e) {
    console.log('[LeetSync] Remote config fetch error:', e.message);
    return null;
  }
}

// ── Alarm: check remote config every 6 hours ──
chrome.alarms.create('checkRemoteConfig', { periodInMinutes: 360 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkRemoteConfig') {
    fetchRemoteConfig();
  }
});

// ── On Install / Update: detect version changes ──
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[LeetSync] 🎉 Extension installed!');
    chrome.storage.local.set({
      installedVersion: chrome.runtime.getManifest().version,
      installDate: new Date().toISOString(),
    });
    fetchRemoteConfig();
  }

  if (details.reason === 'update') {
    const newVersion = chrome.runtime.getManifest().version;
    const prevVersion = details.previousVersion;
    console.log(`[LeetSync] 🆕 Updated from ${prevVersion} → ${newVersion}`);
    chrome.storage.local.set({
      installedVersion: newVersion,
      previousVersion: prevVersion,
      showWhatsNew: true,
      updateDate: new Date().toISOString(),
    });
    fetchRemoteConfig();
  }
});

// Fetch config on service worker startup
fetchRemoteConfig();
