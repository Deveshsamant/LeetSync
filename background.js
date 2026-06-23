/* ============================================================
   background.js — Service Worker for GitHub API integration
   
   Handles:
   1. Receiving problem data from the content script
   2. Pushing solution files to GitHub via the Contents API
   3. Maintaining the root README.md with a problem index
   ============================================================ */

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

// ── GitHub API Helpers ───────────────────────────────────────

/**
 * Make an authenticated GitHub API request.
 */
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
  const maxRetries = 2; // 1 retry max — keeps verify fast

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
      break; // success
    } catch (fetchError) {
      const isTimeout = fetchError.name === 'AbortError';
      console.error(`[LeetSync] Fetch attempt ${attempt}/${maxRetries} failed:`, isTimeout ? 'Timeout' : fetchError.message);
      if (attempt === maxRetries) {
        throw new Error(isTimeout
          ? 'Request timed out. Check your internet connection.'
          : `Network error: ${fetchError.message}`);
      }
      await new Promise(r => setTimeout(r, 800));
    }
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
 */
async function putFile(repo, path, content, message, sha = null) {
  const body = {
    message,
    content: unicodeToBase64(content),
  };

  if (sha) {
    body.sha = sha;
  }

  return githubAPI(`/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

// ── Language Mapping (duplicated from utils.js for service worker) ──

const LANGUAGE_MAP = {
  'python':      { ext: '.py',     name: 'Python'     },
  'python3':     { ext: '.py',     name: 'Python'     },
  'c':           { ext: '.c',      name: 'C'          },
  'cpp':         { ext: '.cpp',    name: 'C++'        },
  'java':        { ext: '.java',   name: 'Java'       },
  'javascript':  { ext: '.js',     name: 'JavaScript' },
  'typescript':  { ext: '.ts',     name: 'TypeScript' },
  'csharp':      { ext: '.cs',     name: 'C#'         },
  'go':          { ext: '.go',     name: 'Go'         },
  'golang':      { ext: '.go',     name: 'Go'         },
  'ruby':        { ext: '.rb',     name: 'Ruby'       },
  'swift':       { ext: '.swift',  name: 'Swift'      },
  'kotlin':      { ext: '.kt',     name: 'Kotlin'     },
  'scala':       { ext: '.scala',  name: 'Scala'      },
  'rust':        { ext: '.rs',     name: 'Rust'       },
  'php':         { ext: '.php',    name: 'PHP'        },
  'dart':        { ext: '.dart',   name: 'Dart'       },
  'racket':      { ext: '.rkt',    name: 'Racket'     },
  'erlang':      { ext: '.erl',    name: 'Erlang'     },
  'elixir':      { ext: '.ex',     name: 'Elixir'     },
  'mysql':       { ext: '.sql',    name: 'MySQL'      },
  'mssql':       { ext: '.sql',    name: 'MS SQL'     },
  'oraclesql':   { ext: '.sql',    name: 'Oracle SQL' },
  'postgresql':  { ext: '.sql',    name: 'PostgreSQL' },
  'pandas':      { ext: '.py',     name: 'Pandas'     },
};

function getLanguageInfo(lang) {
  const key = (lang || '').toLowerCase().replace(/\s+/g, '');
  return LANGUAGE_MAP[key] || { ext: '.txt', name: lang || 'Unknown' };
}

function slugify(title) {
  return title.trim().replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-');
}

function padNumber(num) {
  return String(num).padStart(4, '0');
}

function buildFolderName(num, title) {
  return `${padNumber(num)}-${slugify(title)}`;
}

function difficultyBadge(difficulty) {
  const colors = { 'Easy': '🟢', 'Medium': '🟡', 'Hard': '🔴' };
  return `${colors[difficulty] || '⚪'} ${difficulty}`;
}

// ── README Generators ────────────────────────────────────────

/**
 * Difficulty badge using shields.io
 */
function difficultyShieldBadge(difficulty) {
  const map = {
    'Easy':   { label: 'Easy',   color: '00b8a3' },
    'Medium': { label: 'Medium', color: 'ffa116' },
    'Hard':   { label: 'Hard',   color: 'ef4743' },
  };
  const d = map[difficulty] || { label: difficulty, color: '888888' };
  const encoded = encodeURIComponent(d.label);
  return `![Difficulty](https://img.shields.io/badge/Difficulty-${encoded}-${d.color}?style=for-the-badge&labelColor=1a1a2e)`;
}

/**
 * Language badge using shields.io
 */
function languageShieldBadge(language) {
  const encoded = encodeURIComponent(language || 'Unknown');
  return `![Language](https://img.shields.io/badge/Language-${encoded}-6c5ce7?style=for-the-badge&labelColor=1a1a2e&logo=code)`;
}

/**
 * Generate a text-based horizontal progress bar.
 * e.g. ▓▓▓▓▓▓▓░░░ 70%
 */
function progressBar(value, total, width = 20) {
  if (total === 0) return '░'.repeat(width) + ' 0%';
  const filled = Math.round((value / total) * width);
  const empty = width - filled;
  const pct = Math.round((value / total) * 100);
  return '▓'.repeat(filled) + '░'.repeat(empty) + ` ${pct}%`;
}

/**
 * Build per-problem README — clean, minimal, with badges + best stats.
 */
function generateProblemReadme(problem) {
  const {
    number, title, difficulty, tags, description, url, language,
    runtime, memory, solutionNumber, solutionLabel, bestRuntime,
    bestMemory, isNewBestTime, isNewBestMemory, isFirstSolution,
  } = problem;

  const langInfo = getLanguageInfo(language || '');
  const tagsList = (tags && tags.length)
    ? tags.map(t => `\`${t}\``).join(' ')
    : '`None`';
  const date = new Date().toISOString().split('T')[0];
  const solNum = solutionNumber || 1;

  let c = '';

  // ── Header ──
  c += `<div align="center">\n\n`;
  c += `# ${number}. ${title}\n\n`;
  c += `${difficultyShieldBadge(difficulty)}\xa0\xa0`;
  c += `${languageShieldBadge(langInfo.name)}\xa0\xa0`;
  c += `![Solutions](https://img.shields.io/badge/Solutions-${solNum}-6c5ce7?style=for-the-badge&labelColor=1a1a2e)\xa0\xa0`;
  c += `![Date](https://img.shields.io/badge/Date-${encodeURIComponent(date)}-0984e3?style=for-the-badge&labelColor=1a1a2e)\n\n`;
  c += `[![LeetCode](https://img.shields.io/badge/View%20on-LeetCode-ffa116?style=flat-square&logo=leetcode&logoColor=ffa116)](${url})\n\n`;
  c += `</div>\n\n`;
  c += `---\n\n`;

  // ── Tags ──
  c += `## 🏷️ Topics\n\n`;
  c += `${tagsList}\n\n`;

  // ── Best Stats (updated across all attempts) ──
  c += `## 🏆 Best Performance\n\n`;
  c += `| Metric | This Attempt | All-time Best |\n`;
  c += `|--------|:-----------:|:------------:|\n`;
  const runtimeFlag = isNewBestTime  ? ' 🆕' : '';
  const memoryFlag  = isNewBestMemory ? ' 🆕' : '';
  c += `| ⚡ Runtime | ${runtime || 'N/A'} | **${bestRuntime || runtime || 'N/A'}**${runtimeFlag} |\n`;
  c += `| 💾 Memory  | ${memory  || 'N/A'} | **${bestMemory  || memory  || 'N/A'}**${memoryFlag} |\n\n`;

  if (isNewBestTime || isNewBestMemory) {
    c += `> 🎉 **New personal best!** ${[isNewBestTime && 'Runtime', isNewBestMemory && 'Memory'].filter(Boolean).join(' & ')} improved!\n\n`;
  }

  // ── Solutions Index ──
  c += `## 💡 Solutions (${solNum} total)\n\n`;
  c += `| # | File | Language | Date |\n`;
  c += `|:-:|------|:--------:|:----:|\n`;
  // List all existing solutions up to current
  for (let i = 1; i <= solNum; i++) {
    const isThis = i === solNum;
    const fname = `sol${i}${langInfo.ext}`;
    const link = `[${fname}](./${fname})`;
    const tag = isThis ? ' ← **latest**' : '';
    c += `| ${i} | ${link} | \`${langInfo.name}\` | ${date}${tag} |\n`;
  }
  c += `\n`;
  c += `---\n\n`;

  // ── Problem Description ──
  c += `## 📋 Problem Description\n\n`;
  c += `${description}\n\n`;
  c += `---\n\n`;

  c += `<p align="right">\n`;
  c += `  <sub>🤖 Auto-pushed by <a href="https://deveshsamant.in/">Devesh Samant</a>'s <strong>LeetSync</strong> extension</sub>\n`;
  c += `</p>\n`;

  return c;
}

/**
 * Build the root README — a stunning dashboard of all solved problems.
 */
function generateRootReadme(problems) {
  const sorted = [...problems].sort((a, b) => a.number - b.number);
  const total = sorted.length;
  const today = new Date().toISOString().split('T')[0];

  // Stats
  const counts = { Easy: 0, Medium: 0, Hard: 0 };
  const langCount = {};
  sorted.forEach(p => {
    if (counts[p.difficulty] !== undefined) counts[p.difficulty]++;
    langCount[p.language] = (langCount[p.language] || 0) + 1;
  });

  const topLangs = Object.entries(langCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Shields.io badge URLs
  const totalBadge   = `![Problems](https://img.shields.io/badge/Total%20Solved-${total}-6c5ce7?style=for-the-badge&labelColor=1a1a2e)`;
  const easyBadge    = `![Easy](https://img.shields.io/badge/Easy-${counts.Easy}-00b8a3?style=for-the-badge&labelColor=1a1a2e)`;
  const mediumBadge  = `![Medium](https://img.shields.io/badge/Medium-${counts.Medium}-ffa116?style=for-the-badge&labelColor=1a1a2e)`;
  const hardBadge    = `![Hard](https://img.shields.io/badge/Hard-${counts.Hard}-ef4743?style=for-the-badge&labelColor=1a1a2e)`;
  const updatedBadge = `![Updated](https://img.shields.io/badge/Last%20Updated-${encodeURIComponent(today)}-0984e3?style=flat-square&labelColor=1a1a2e)`;
  const autoSyncBadge = `![Auto](https://img.shields.io/badge/Auto--Synced%20by-LeetSync-ffa116?style=flat-square&logo=google-chrome&logoColor=white)`;

  let c = '';

  // ── Banner ──
  c += `<div align="center">\n\n`;
  c += `<h1>⚡ LeetCode Solutions</h1>\n`;
  c += `<p><em>Automatically synced with every accepted submission</em></p>\n\n`;
  c += `${totalBadge} ${easyBadge} ${mediumBadge} ${hardBadge}\n\n`;
  c += `${updatedBadge} ${autoSyncBadge}\n\n`;
  c += `</div>\n\n`;
  c += `---\n\n`;

  // ── Progress Dashboard ──
  c += `## 📊 Progress Dashboard\n\n`;
  c += `\`\`\`\n`;
  c += `  Total Solved   ${String(total).padStart(4)}  ${'█'.repeat(Math.min(total, 40))}\n`;
  c += `\n`;
  c += `  🟢 Easy       ${String(counts.Easy).padStart(4)}  ${progressBar(counts.Easy, total, 30)}\n`;
  c += `  🟡 Medium     ${String(counts.Medium).padStart(4)}  ${progressBar(counts.Medium, total, 30)}\n`;
  c += `  🔴 Hard       ${String(counts.Hard).padStart(4)}  ${progressBar(counts.Hard, total, 30)}\n`;
  c += `\`\`\`\n\n`;

  // ── Language Stats ──
  if (topLangs.length > 0) {
    c += `## 🛠️ Languages Used\n\n`;
    c += `\`\`\`\n`;
    topLangs.forEach(([lang, cnt]) => {
      const bar = progressBar(cnt, total, 25);
      c += `  ${lang.padEnd(14)} ${String(cnt).padStart(3)}  ${bar}\n`;
    });
    c += `\`\`\`\n\n`;
  }

  // ── Quick Stats Row ──
  c += `## 🎯 Quick Stats\n\n`;
  c += `| 📈 Stat | Value |\n`;
  c += `|---------|-------|\n`;
  c += `| Total Solved | **${total}** |\n`;
  c += `| Easy | 🟢 ${counts.Easy} |\n`;
  c += `| Medium | 🟡 ${counts.Medium} |\n`;
  c += `| Hard | 🔴 ${counts.Hard} |\n`;
  c += `| Languages | ${topLangs.map(([l]) => l).join(', ') || 'N/A'} |\n`;
  c += `| Last Solved | ${sorted[sorted.length - 1]?.title || 'N/A'} |\n`;
  c += `| Last Push | ${today} |\n\n`;

  // ── Problems Table ──
  c += `---\n\n`;
  c += `## 📚 All Solutions\n\n`;
  c += `| # | Problem | Difficulty | Language | Date |\n`;
  c += `|:---:|---------|:----------:|:--------:|:----:|\n`;

  sorted.forEach(p => {
    const link = `[${p.title}](problems/${p.folderName})`;
    const diffEmoji = { Easy: '🟢', Medium: '🟡', Hard: '🔴' }[p.difficulty] || '⚪';
    const diff = `${diffEmoji} ${p.difficulty}`;
    const date = p.date || today;
    c += `| ${p.number} | ${link} | ${diff} | \`${p.language}\` | ${date} |\n`;
  });

  c += `\n---\n\n`;

  // ── Footer ──
  c += `<div align="center">\n\n`;
  c += `<sub>🤖 Auto-synced by <strong>LeetSync</strong> Chrome Extension</sub>\n\n`;
  c += `<sub>Built with ❤️ by <a href="https://deveshsamant.in/">Devesh Samant</a></sub>\n\n`;
  c += `</div>\n`;

  return c;
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

  solvedProblems[number] = {
    title,
    difficulty,
    language: langInfo.name,
    date: new Date().toISOString().split('T')[0],
    folderName,
    solutionCount: nextSolNum,
    bestRuntime,
    bestMemory,
  };

  await chrome.storage.local.set({
    pushCount,
    lastPush: new Date().toISOString(),
    solvedProblems,
  });

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
  const readmeContent = generateRootReadme(problems);

  await putFile(
    repo,
    'README.md',
    readmeContent,
    'Update README with solved problems index',
    existingReadme?.sha || null
  );

  console.log(`[LeetSync] Root README updated with ${problems.length} total problems`);
}

// ── Message Listener ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PUSH_TO_GITHUB') {
    pushToGitHub(message.data)
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        console.error('[LeetCode Pusher] Push failed:', error);
        sendResponse({ success: false, error: error.message });
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
});

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
 * Sync local stats from the GitHub README.
 * Reads the existing README, parses the problems table,
 * and updates local storage so the popup shows correct counts
 * on any device.
 */
async function syncStatsFromGitHub(repo) {
  const existingReadme = await getFile(repo, 'README.md');
  let parsedProblems = {};

  if (existingReadme) {
    try {
      const content = atob(existingReadme.content.replace(/\n/g, ''));

      // Parse table rows from the README
      const tableRowRegex = /\|\s*(\d+)\s*\|\s*\[([^\]]+)\]\(problems\/([^)]+)\)\s*\|\s*[🟢🟡🔴⚪]\s*(\w+)\s*\|\s*`([^`]+)`\s*\|\s*(\S+)\s*\|/g;
      let match;
      while ((match = tableRowRegex.exec(content)) !== null) {
        const num = parseInt(match[1], 10);
        parsedProblems[num] = {
          number: num,
          title: match[2],
          folderName: match[3],
          difficulty: match[4],
          language: match[5],
          date: match[6],
        };
      }
    } catch (e) {
      console.warn('[LeetSync] Could not parse README for stats:', e.message);
    }
  }

  // Merge with existing local data (keep richer local data, add missing from GitHub)
  const local = await chrome.storage.local.get(['solvedProblems', 'pushCount']);
  const localProblems = local.solvedProblems || {};
  const merged = { ...parsedProblems, ...localProblems };

  const solvedCount = Object.keys(merged).length;
  const pushCount = Math.max(local.pushCount || 0, solvedCount);

  await chrome.storage.local.set({
    solvedProblems: merged,
    pushCount: pushCount,
  });

  console.log(`[LeetSync] Stats synced: ${solvedCount} problems, ${pushCount} pushes`);

  return { success: true, solvedCount, pushCount };
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
});

// Also re-inject when the service worker starts (covers manual reload via chrome://extensions)
reinjectIntoLeetCodeTabs();
