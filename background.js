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
async function generateRootReadme(problems) {
  const themeData = await chrome.storage.sync.get(['readmeTheme']);
  const theme = themeData.readmeTheme || 'dark-pro';
  return README_THEMES[theme]?.(problems) || README_THEMES['dark-pro'](problems);
}

// ── Theme: Dark Pro (original) ──
const README_THEMES = {
  'dark-pro': function(problems) {
    const sorted = [...problems].sort((a, b) => a.number - b.number);
    const total = sorted.length;
    const today = new Date().toISOString().split('T')[0];
    const counts = { Easy: 0, Medium: 0, Hard: 0 };
    const langCount = {};
    sorted.forEach(p => {
      if (counts[p.difficulty] !== undefined) counts[p.difficulty]++;
      langCount[p.language] = (langCount[p.language] || 0) + 1;
    });
    const topLangs = Object.entries(langCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const totalBadge   = `![Problems](https://img.shields.io/badge/Total%20Solved-${total}-6c5ce7?style=for-the-badge&labelColor=1a1a2e)`;
    const easyBadge    = `![Easy](https://img.shields.io/badge/Easy-${counts.Easy}-00b8a3?style=for-the-badge&labelColor=1a1a2e)`;
    const mediumBadge  = `![Medium](https://img.shields.io/badge/Medium-${counts.Medium}-ffa116?style=for-the-badge&labelColor=1a1a2e)`;
    const hardBadge    = `![Hard](https://img.shields.io/badge/Hard-${counts.Hard}-ef4743?style=for-the-badge&labelColor=1a1a2e)`;
    const updatedBadge = `![Updated](https://img.shields.io/badge/Last%20Updated-${encodeURIComponent(today)}-0984e3?style=flat-square&labelColor=1a1a2e)`;
    const autoSyncBadge = `![Auto](https://img.shields.io/badge/Auto--Synced%20by-LeetSync-ffa116?style=flat-square&logo=google-chrome&logoColor=white)`;

    let c = '';
    c += `<div align="center">\n\n`;
    c += `<h1>⚡ LeetCode Solutions</h1>\n`;
    c += `<p><em>Automatically synced with every accepted submission</em></p>\n\n`;
    c += `${totalBadge} ${easyBadge} ${mediumBadge} ${hardBadge}\n\n`;
    c += `${updatedBadge} ${autoSyncBadge}\n\n`;
    c += `</div>\n\n`;
    c += `---\n\n`;

    c += `## 📊 Progress Dashboard\n\n`;
    c += `\`\`\`\n`;
    c += `  Total Solved   ${String(total).padStart(4)}  ${'█'.repeat(Math.min(total, 40))}\n\n`;
    c += `  🟢 Easy       ${String(counts.Easy).padStart(4)}  ${progressBar(counts.Easy, total, 30)}\n`;
    c += `  🟡 Medium     ${String(counts.Medium).padStart(4)}  ${progressBar(counts.Medium, total, 30)}\n`;
    c += `  🔴 Hard       ${String(counts.Hard).padStart(4)}  ${progressBar(counts.Hard, total, 30)}\n`;
    c += `\`\`\`\n\n`;

    if (topLangs.length > 0) {
      c += `## 🛠️ Languages Used\n\n`;
      c += `\`\`\`\n`;
      topLangs.forEach(([lang, cnt]) => {
        c += `  ${lang.padEnd(14)} ${String(cnt).padStart(3)}  ${progressBar(cnt, total, 25)}\n`;
      });
      c += `\`\`\`\n\n`;
    }

    c += `## 🎯 Quick Stats\n\n`;
    c += `| 📈 Stat | Value |\n|---------|-------|\n`;
    c += `| Total Solved | **${total}** |\n`;
    c += `| Easy | 🟢 ${counts.Easy} |\n| Medium | 🟡 ${counts.Medium} |\n| Hard | 🔴 ${counts.Hard} |\n`;
    c += `| Languages | ${topLangs.map(([l]) => l).join(', ') || 'N/A'} |\n`;
    c += `| Last Solved | ${sorted[sorted.length - 1]?.title || 'N/A'} |\n| Last Push | ${today} |\n\n`;
    c += `---\n\n`;
    c += buildProblemsTable(sorted, today);
    c += buildFooter();
    return c;
  },

  // ── Theme: Clean Light ──
  'clean-light': function(problems) {
    const sorted = [...problems].sort((a, b) => a.number - b.number);
    const total = sorted.length;
    const today = new Date().toISOString().split('T')[0];
    const counts = { Easy: 0, Medium: 0, Hard: 0 };
    sorted.forEach(p => { if (counts[p.difficulty] !== undefined) counts[p.difficulty]++; });

    let c = '';
    c += `# LeetCode Solutions\n\n`;
    c += `> ${total} problems solved | Last updated: ${today}\n\n`;
    c += `![Total](https://img.shields.io/badge/solved-${total}-blue?style=flat-square) `;
    c += `![Easy](https://img.shields.io/badge/easy-${counts.Easy}-brightgreen?style=flat-square) `;
    c += `![Medium](https://img.shields.io/badge/medium-${counts.Medium}-orange?style=flat-square) `;
    c += `![Hard](https://img.shields.io/badge/hard-${counts.Hard}-red?style=flat-square)\n\n`;
    c += `---\n\n`;
    c += buildProblemsTable(sorted, today);
    c += `\n---\n\n`;
    c += `*Auto-synced by [LeetSync](https://github.com/Deveshsamant/LeetSync)*\n`;
    return c;
  },

  // ── Theme: Colorful ──
  'colorful': function(problems) {
    const sorted = [...problems].sort((a, b) => a.number - b.number);
    const total = sorted.length;
    const today = new Date().toISOString().split('T')[0];
    const counts = { Easy: 0, Medium: 0, Hard: 0 };
    const langCount = {};
    sorted.forEach(p => {
      if (counts[p.difficulty] !== undefined) counts[p.difficulty]++;
      langCount[p.language] = (langCount[p.language] || 0) + 1;
    });

    let c = '';
    c += `<div align="center">\n\n`;
    c += `# 🌈 My LeetCode Journey 🚀\n\n`;
    c += `### ✨ ${total} Problems Conquered! ✨\n\n`;
    c += `![](https://img.shields.io/badge/🟢_Easy-${counts.Easy}-00b894?style=for-the-badge) `;
    c += `![](https://img.shields.io/badge/🟡_Medium-${counts.Medium}-fdcb6e?style=for-the-badge) `;
    c += `![](https://img.shields.io/badge/🔴_Hard-${counts.Hard}-e17055?style=for-the-badge)\n\n`;
    c += `</div>\n\n`;

    c += `## 🎮 Progress\n\n`;
    c += `| 🏆 Milestone | Status |\n|---|---|\n`;
    c += `| First 10 | ${total >= 10 ? '✅ Done!' : `⏳ ${total}/10`} |\n`;
    c += `| First 25 | ${total >= 25 ? '✅ Done!' : `⏳ ${total}/25`} |\n`;
    c += `| First 50 | ${total >= 50 ? '✅ Done!' : `⏳ ${total}/50`} |\n`;
    c += `| First 100 | ${total >= 100 ? '✅ Done!' : `⏳ ${total}/100`} |\n`;
    c += `| First 200 | ${total >= 200 ? '✅ Done!' : `⏳ ${total}/200`} |\n\n`;

    c += `## 💻 Languages\n\n`;
    Object.entries(langCount).sort((a, b) => b[1] - a[1]).forEach(([lang, cnt]) => {
      const pct = Math.round((cnt / total) * 100);
      c += `- **${lang}**: ${cnt} solutions (${pct}%) ${'🟩'.repeat(Math.ceil(pct / 10))}\n`;
    });
    c += `\n`;

    c += `---\n\n`;
    c += buildProblemsTable(sorted, today);
    c += buildFooter();
    return c;
  },

  // ── Theme: Minimal ──
  'minimal': function(problems) {
    const sorted = [...problems].sort((a, b) => a.number - b.number);
    const today = new Date().toISOString().split('T')[0];

    let c = `# LeetCode\n\n`;
    c += `${sorted.length} solutions. Updated ${today}.\n\n`;
    c += buildProblemsTable(sorted, today);
    c += `\n---\n*Synced by LeetSync*\n`;
    return c;
  },

  // ── Theme: Stats Heavy ──
  'stats-heavy': function(problems) {
    const sorted = [...problems].sort((a, b) => a.number - b.number);
    const total = sorted.length;
    const today = new Date().toISOString().split('T')[0];
    const counts = { Easy: 0, Medium: 0, Hard: 0 };
    const langCount = {};
    const monthCount = {};
    sorted.forEach(p => {
      if (counts[p.difficulty] !== undefined) counts[p.difficulty]++;
      langCount[p.language] = (langCount[p.language] || 0) + 1;
      const month = p.date?.substring(0, 7) || 'unknown';
      monthCount[month] = (monthCount[month] || 0) + 1;
    });
    const topLangs = Object.entries(langCount).sort((a, b) => b[1] - a[1]);

    let c = '';
    c += `<div align="center">\n\n`;
    c += `# 📊 LeetCode Analytics\n\n`;
    c += `![](https://img.shields.io/badge/Total-${total}-blueviolet?style=for-the-badge) `;
    c += `![](https://img.shields.io/badge/Easy-${counts.Easy}-success?style=for-the-badge) `;
    c += `![](https://img.shields.io/badge/Medium-${counts.Medium}-warning?style=for-the-badge) `;
    c += `![](https://img.shields.io/badge/Hard-${counts.Hard}-critical?style=for-the-badge)\n\n`;
    c += `</div>\n\n`;

    c += `## 📈 Detailed Statistics\n\n`;
    c += `\`\`\`\n`;
    c += ` ┌──────────────────────────────────────────┐\n`;
    c += ` │  DIFFICULTY DISTRIBUTION                  │\n`;
    c += ` ├──────────────────────────────────────────┤\n`;
    c += ` │  🟢 Easy    ${String(counts.Easy).padStart(3)}  ${progressBar(counts.Easy, total, 25)}  ${Math.round(counts.Easy/total*100)}% │\n`;
    c += ` │  🟡 Medium  ${String(counts.Medium).padStart(3)}  ${progressBar(counts.Medium, total, 25)}  ${Math.round(counts.Medium/total*100)}% │\n`;
    c += ` │  🔴 Hard    ${String(counts.Hard).padStart(3)}  ${progressBar(counts.Hard, total, 25)}  ${Math.round(counts.Hard/total*100)}% │\n`;
    c += ` └──────────────────────────────────────────┘\n`;
    c += `\`\`\`\n\n`;

    c += `## 💻 Language Breakdown\n\n`;
    c += `| Language | Count | % | Bar |\n|----------|:-----:|:-:|-----|\n`;
    topLangs.forEach(([lang, cnt]) => {
      const pct = Math.round((cnt / total) * 100);
      c += `| ${lang} | ${cnt} | ${pct}% | ${'█'.repeat(Math.ceil(pct / 5))} |\n`;
    });
    c += `\n`;

    c += `## 📅 Monthly Activity\n\n`;
    c += `| Month | Solved |\n|-------|:------:|\n`;
    Object.entries(monthCount).sort().reverse().slice(0, 6).forEach(([month, cnt]) => {
      c += `| ${month} | ${cnt} ${'🟩'.repeat(Math.min(cnt, 10))} |\n`;
    });
    c += `\n`;

    c += `---\n\n`;
    c += buildProblemsTable(sorted, today);
    c += buildFooter();
    return c;
  },
};

// ── Shared helpers for themes ──
function buildProblemsTable(sorted, today) {
  let c = `## 📚 All Solutions\n\n`;
  c += `| # | Problem | Difficulty | Language | Date |\n`;
  c += `|:---:|---------|:----------:|:--------:|:----:|\n`;
  sorted.forEach(p => {
    const num = p.number || parseInt(p.folderName?.match(/^(\d+)/)?.[1], 10) || '?';
    const folder = p.folderName || buildFolderName(num, p.title);
    const link = `[${p.title}](problems/${folder})`;
    const diffEmoji = { Easy: '🟢', Medium: '🟡', Hard: '🔴' }[p.difficulty] || '⚪';
    const diff = `${diffEmoji} ${p.difficulty}`;
    const date = p.date || today;
    c += `| ${num} | ${link} | ${diff} | \`${p.language}\` | ${date} |\n`;
  });
  c += `\n`;
  return c;
}

function buildFooter() {
  let c = `---\n\n`;
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
    number,
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

  console.log(`[LeetSync] Root README updated with ${problems.length} total problems`);
}

// ── Message Listener ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PUSH_TO_GITHUB') {
    pushToGitHub(message.data)
      .then((result) => {
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
        if (isNetworkError) {
          await addToOfflineQueue(message.data);
          sendResponse({
            success: false,
            queued: true,
            error: '📡 No connection — queued for later! Will auto-push when online.',
          });
        } else {
          sendResponse({ success: false, error: error.message });
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

  // Create a new GitHub repo
  if (message.type === 'CREATE_REPO') {
    createGitHubRepo(message.repoName, message.isPrivate)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Get selected theme
  if (message.type === 'GET_THEME') {
    chrome.storage.sync.get(['readmeTheme'], (data) => {
      sendResponse({ theme: data.readmeTheme || 'dark-pro' });
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
async function deleteProblemFromGitHub(problemNumber, folderName) {
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

  if (problem) {
    const oldCount = problem.solutionCount || 1;
    const newCount = oldCount - 1;

    if (newCount <= 0) {
      // No more solutions → delete the whole problem
      return deleteProblemFromGitHub(problemNumber, folderName);
    }

    problem.solutionCount = newCount;
    solvedProblems[problemNumber] = problem;
    const newPushCount = Math.max(0, (local.pushCount || 0) - 1);
    await chrome.storage.local.set({ solvedProblems, pushCount: newPushCount });
  }

  console.log(`[LeetSync] ✅ Solution ${fileName} deleted and renumbered`);
  return { success: true, remaining: (problem?.solutionCount || 1) - 1 };
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
});

// Also re-inject when the service worker starts
reinjectIntoLeetCodeTabs();

// ── Alarm Handler ────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'processQueue') {
    processOfflineQueue().catch(e => console.warn('[LeetSync] Queue processing failed:', e));
  }
  if (alarm.name === 'streakReminder') {
    checkStreakReminder();
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
