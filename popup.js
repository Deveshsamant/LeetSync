/* ============================================================
   popup.js — LeetSync v2 Popup Logic
   
   Features:
   - Onboarding wizard (4 steps)
   - Tab navigation (Dashboard / Problems / Settings)
   - Analytics dashboard (heatmap, difficulty bar, streak)
   - Animated stat counters
   - Achievement badge gallery
   - Offline queue status
   - Theme picker
   - Problem list with delete
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  // ═══════════════════════════════════════════════════════════
  // DOM References
  // ═══════════════════════════════════════════════════════════
  const wizardOverlay = document.getElementById('wizardOverlay');
  const mainPopup     = document.getElementById('mainPopup');

  // Settings
  const tokenInput    = document.getElementById('githubToken');
  const repoInput     = document.getElementById('githubRepo');
  const saveBtn       = document.getElementById('saveBtn');
  const verifyBtn     = document.getElementById('verifyBtn');
  const toggleBtn     = document.getElementById('toggleToken');
  const statusBadge   = document.getElementById('statusBadge');
  const statusText    = document.getElementById('statusText');
  const statusMessage = document.getElementById('statusMessage');

  // Stats
  const statPushCount   = document.getElementById('statPushCount');
  const statSolvedCount = document.getElementById('statSolvedCount');
  const statLastPush    = document.getElementById('statLastPush');

  // Streak
  const streakCount = document.getElementById('streakCount');
  const streakBest  = document.getElementById('streakBest');

  // Difficulty
  const diffEasyBar = document.getElementById('diffEasyBar');
  const diffMedBar  = document.getElementById('diffMedBar');
  const diffHardBar = document.getElementById('diffHardBar');
  const diffEasyNum = document.getElementById('diffEasyNum');
  const diffMedNum  = document.getElementById('diffMedNum');
  const diffHardNum = document.getElementById('diffHardNum');

  // ═══════════════════════════════════════════════════════════
  // Check if setup is needed → show wizard
  // ═══════════════════════════════════════════════════════════
  chrome.storage.sync.get(['githubToken', 'githubRepo'], (data) => {
    if (!data.githubToken || !data.githubRepo) {
      wizardOverlay.style.display = 'flex';
      mainPopup.style.display = 'none';
    } else {
      wizardOverlay.style.display = 'none';
      mainPopup.style.display = 'block';
      tokenInput.value = data.githubToken;
      repoInput.value = data.githubRepo;
      setStatus('connected', 'Connected');
      loadDashboard();
    }
  });

  // ═══════════════════════════════════════════════════════════
  // WIZARD LOGIC
  // ═══════════════════════════════════════════════════════════
  let wizCurrentStep = 1;

  function wizGoTo(step) {
    wizCurrentStep = step;
    document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.wizard-dot').forEach((d, i) => {
      d.classList.remove('active', 'done');
      if (i + 1 < step) d.classList.add('done');
      if (i + 1 === step) d.classList.add('active');
    });
    document.getElementById(`wizStep${step}`).classList.add('active');
  }

  document.getElementById('wizStart').addEventListener('click', () => wizGoTo(2));
  document.getElementById('wizBack2').addEventListener('click', () => wizGoTo(1));
  document.getElementById('wizBack3').addEventListener('click', () => wizGoTo(2));

  document.getElementById('wizNext2').addEventListener('click', () => {
    const token = document.getElementById('wizToken').value.trim();
    if (!token) {
      document.getElementById('wizToken').style.borderColor = 'var(--error)';
      return;
    }
    document.getElementById('wizToken').style.borderColor = '';
    chrome.storage.sync.set({ githubToken: token });
    wizGoTo(3);
  });

  // Repo choice toggle
  const radioExisting = document.getElementById('radioExisting');
  const radioCreate   = document.getElementById('radioCreate');
  radioExisting.addEventListener('click', () => {
    radioExisting.classList.add('active');
    radioCreate.classList.remove('active');
    document.getElementById('existingRepoGroup').style.display = 'block';
    document.getElementById('createRepoGroup').style.display = 'none';
  });
  radioCreate.addEventListener('click', () => {
    radioCreate.classList.add('active');
    radioExisting.classList.remove('active');
    document.getElementById('existingRepoGroup').style.display = 'none';
    document.getElementById('createRepoGroup').style.display = 'block';
  });

  document.getElementById('wizNext3').addEventListener('click', async () => {
    const wizError = document.getElementById('wizError');
    wizError.style.display = 'none';
    const btn = document.getElementById('wizNext3');
    btn.disabled = true;
    btn.textContent = 'Setting up...';

    const isCreate = radioCreate.classList.contains('active');

    if (isCreate) {
      const repoName = document.getElementById('wizNewRepoName').value.trim() || 'leetcode-solutions';
      const isPrivate = document.getElementById('wizRepoPrivate').checked;

      chrome.runtime.sendMessage({ type: 'CREATE_REPO', repoName, isPrivate }, (res) => {
        if (chrome.runtime.lastError || !res?.success) {
          wizError.textContent = res?.error || 'Failed to create repo';
          wizError.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Finish Setup ✨';
          return;
        }
        chrome.storage.sync.set({ githubRepo: res.fullName }, () => {
          document.getElementById('wizRepoLink').innerHTML =
            `<a href="${res.url}" target="_blank" style="color:var(--accent);font-size:13px;">📂 ${res.fullName}</a>`;
          wizGoTo(4);
          btn.disabled = false;
          btn.textContent = 'Finish Setup ✨';
        });
      });
    } else {
      const repo = document.getElementById('wizRepo').value.trim();
      if (!repo || !repo.includes('/')) {
        wizError.textContent = 'Enter repo as owner/repo-name';
        wizError.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Finish Setup ✨';
        return;
      }
      chrome.storage.sync.set({ githubRepo: repo }, () => {
        document.getElementById('wizRepoLink').innerHTML =
          `<a href="https://github.com/${repo}" target="_blank" style="color:var(--accent);font-size:13px;">📂 ${repo}</a>`;
        wizGoTo(4);
        btn.disabled = false;
        btn.textContent = 'Finish Setup ✨';
      });
    }
  });

  document.getElementById('wizDone').addEventListener('click', () => {
    wizardOverlay.style.display = 'none';
    mainPopup.style.display = 'block';
    chrome.storage.sync.get(['githubToken', 'githubRepo'], (data) => {
      tokenInput.value = data.githubToken || '';
      repoInput.value = data.githubRepo || '';
      setStatus('connected', 'Connected');
    });
    loadDashboard();
  });

  // ═══════════════════════════════════════════════════════════
  // TAB NAVIGATION
  // ═══════════════════════════════════════════════════════════
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = {
    dashboard: document.getElementById('tabDashboard'),
    problems: document.getElementById('tabProblems'),
    settings: document.getElementById('tabSettings'),
  };

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Object.values(tabContents).forEach(tc => tc.classList.remove('active'));
      tabContents[tab].classList.add('active');

      if (tab === 'problems') loadProblems();
      if (tab === 'dashboard') loadDashboard();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // ANIMATED COUNTER
  // ═══════════════════════════════════════════════════════════
  function animateCounter(element, target, duration = 800) {
    const start = parseInt(element.textContent) || 0;
    if (start === target) return;
    const range = target - start;
    const startTime = performance.now();

    function step(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      element.textContent = Math.round(start + range * ease);
      if (progress < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  // ═══════════════════════════════════════════════════════════
  // DASHBOARD LOADER
  // ═══════════════════════════════════════════════════════════
  function loadDashboard() {
    loadStats();
    loadStreak();
    loadDifficulty();
    loadHeatmap();
    loadAchievements();
    loadQueueStatus();
    loadTheme();
  }

  function loadStats() {
    chrome.runtime.sendMessage({ type: 'GET_STATS' }, (response) => {
      if (chrome.runtime.lastError || !response) return;

      animateCounter(statPushCount, response.pushCount || 0);
      animateCounter(statSolvedCount, response.solvedCount || 0);

      if (response.lastPush) {
        const date = new Date(response.lastPush);
        const now = new Date();
        const diffMs = now - date;
        const diffMin = Math.floor(diffMs / 60000);
        const diffHr = Math.floor(diffMs / 3600000);
        const diffDay = Math.floor(diffMs / 86400000);

        if (diffMin < 1) statLastPush.textContent = 'Just now';
        else if (diffMin < 60) statLastPush.textContent = `${diffMin}m ago`;
        else if (diffHr < 24) statLastPush.textContent = `${diffHr}h ago`;
        else statLastPush.textContent = `${diffDay}d ago`;
      } else {
        statLastPush.textContent = '—';
      }
    });
  }

  function loadStreak() {
    chrome.runtime.sendMessage({ type: 'GET_STREAK' }, (data) => {
      if (chrome.runtime.lastError || !data) return;
      animateCounter(streakCount, data.currentStreak || 0, 600);
      streakBest.textContent = data.longestStreak || 0;
    });
  }

  function loadDifficulty() {
    chrome.runtime.sendMessage({ type: 'GET_PROBLEMS' }, (res) => {
      if (chrome.runtime.lastError || !res?.success) return;
      const problems = res.problems || [];
      const total = problems.length || 1;
      const easy = problems.filter(p => p.difficulty === 'Easy').length;
      const med = problems.filter(p => p.difficulty === 'Medium').length;
      const hard = problems.filter(p => p.difficulty === 'Hard').length;

      diffEasyNum.textContent = easy;
      diffMedNum.textContent = med;
      diffHardNum.textContent = hard;

      setTimeout(() => {
        diffEasyBar.style.width = `${(easy / total) * 100}%`;
        diffMedBar.style.width = `${(med / total) * 100}%`;
        diffHardBar.style.width = `${(hard / total) * 100}%`;
      }, 100);
    });
  }

  function loadHeatmap() {
    chrome.runtime.sendMessage({ type: 'GET_STREAK' }, (data) => {
      if (chrome.runtime.lastError) return;
      const history = (data?.solveHistory || []);
      const grid = document.getElementById('heatmapGrid');
      grid.innerHTML = '';

      // Build a set of solve dates for quick lookup
      const solveSet = new Set(history);

      // Count solves per date
      const solveCounts = {};
      history.forEach(d => { solveCounts[d] = (solveCounts[d] || 0) + 1; });

      // Generate last 91 days (13 weeks)
      const today = new Date();
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 90);

      // Align to start of week (Sunday)
      while (startDate.getDay() !== 0) {
        startDate.setDate(startDate.getDate() - 1);
      }

      const endDate = new Date(today);
      const current = new Date(startDate);

      while (current <= endDate) {
        const dateStr = current.toISOString().split('T')[0];
        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';

        if (solveSet.has(dateStr)) {
          const count = solveCounts[dateStr] || 0;
          if (count >= 3) cell.classList.add('level-3');
          else if (count >= 2) cell.classList.add('level-2');
          else cell.classList.add('level-1');
        } else {
          cell.classList.add('level-0');
        }

        cell.title = `${dateStr}${solveSet.has(dateStr) ? ` — ${solveCounts[dateStr] || 1} problem(s)` : ''}`;
        grid.appendChild(cell);
        current.setDate(current.getDate() + 1);
      }
    });
  }

  // Achievement definitions (mirrored from background.js)
  const BADGE_DEFS = [
    { id: 'first_blood', emoji: '🩸', name: 'First Blood', desc: 'Solve your 1st problem' },
    { id: 'on_fire', emoji: '🔥', name: 'On Fire', desc: '3-day solving streak' },
    { id: 'unstoppable', emoji: '⚡', name: 'Unstoppable', desc: '7-day solving streak' },
    { id: 'month_king', emoji: '👑', name: 'Month King', desc: '30-day solving streak' },
    { id: 'deca', emoji: '🎯', name: 'Deca', desc: 'Solve 10 problems' },
    { id: 'quarter', emoji: '🏅', name: 'Quarter Century', desc: 'Solve 25 problems' },
    { id: 'half_century', emoji: '🥇', name: 'Half Century', desc: 'Solve 50 problems' },
    { id: 'century', emoji: '💯', name: 'Century', desc: 'Solve 100 problems' },
    { id: 'easy_rider', emoji: '🟢', name: 'Easy Rider', desc: 'Solve 10 Easy' },
    { id: 'medium_rare', emoji: '🟡', name: 'Medium Rare', desc: 'Solve 10 Medium' },
    { id: 'hard_core', emoji: '🔴', name: 'Hard Core', desc: 'Solve 5 Hard' },
    { id: 'polyglot', emoji: '🌐', name: 'Polyglot', desc: 'Use 3+ languages' },
    { id: 'night_owl', emoji: '🌙', name: 'Night Owl', desc: 'Solve after midnight' },
    { id: 'early_bird', emoji: '☀️', name: 'Early Bird', desc: 'Solve before 7 AM' },
    { id: 'bookworm', emoji: '📚', name: 'Bookworm', desc: 'Solve 5 in one day' },
  ];

  function loadAchievements() {
    chrome.runtime.sendMessage({ type: 'GET_ACHIEVEMENTS' }, (data) => {
      if (chrome.runtime.lastError) return;
      const unlocked = data?.unlocked || {};
      const grid = document.getElementById('badgeGrid');
      grid.innerHTML = '';

      BADGE_DEFS.forEach(def => {
        const item = document.createElement('div');
        const isUnlocked = !!unlocked[def.id];
        item.className = `badge-item ${isUnlocked ? 'unlocked' : 'locked'}`;
        item.title = `${def.name}\n${def.desc}${isUnlocked ? '\n✅ Unlocked!' : '\n🔒 Locked'}`;
        item.innerHTML = `
          <span class="badge-emoji">${isUnlocked ? def.emoji : '🔒'}</span>
          <span class="badge-name">${def.name}</span>
        `;
        grid.appendChild(item);
      });
    });
  }

  function loadQueueStatus() {
    chrome.runtime.sendMessage({ type: 'GET_QUEUE_STATUS' }, (data) => {
      if (chrome.runtime.lastError) return;
      const banner = document.getElementById('queueBanner');
      if (data?.queueLength > 0) {
        banner.style.display = 'flex';
        document.getElementById('queueText').textContent = `${data.queueLength} item${data.queueLength > 1 ? 's' : ''} queued — will auto-push when online`;
      } else {
        banner.style.display = 'none';
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // README THEME (dropdown)
  // ═══════════════════════════════════════════════════════════
  const readmeThemeSelect = document.getElementById('readmeTheme');

  function loadTheme() {
    // Load README theme
    chrome.runtime.sendMessage({ type: 'GET_THEME' }, (data) => {
      if (chrome.runtime.lastError) return;
      readmeThemeSelect.value = data?.theme || 'dark-pro';
    });
    // Load UI theme
    loadUITheme();
  }

  readmeThemeSelect.addEventListener('change', () => {
    chrome.runtime.sendMessage({ type: 'SET_THEME', theme: readmeThemeSelect.value });
  });

  // ═══════════════════════════════════════════════════════════
  // EXTENSION UI THEME (cards)
  // ═══════════════════════════════════════════════════════════
  function applyUITheme(themeName) {
    // Remove all theme classes from body
    document.body.className = document.body.className
      .replace(/\btheme-\S+/g, '').trim();
    if (themeName && themeName !== 'dark-pro') {
      document.body.classList.add(`theme-${themeName}`);
    }
    // Update active card
    document.querySelectorAll('.ui-theme-card').forEach(card => {
      card.classList.toggle('active', card.dataset.uiTheme === themeName);
    });
  }

  function loadUITheme() {
    chrome.storage.sync.get(['uiTheme'], (data) => {
      applyUITheme(data.uiTheme || 'dark-pro');
    });
  }

  // Apply UI theme immediately (before dashboard loads)
  loadUITheme();

  document.querySelectorAll('.ui-theme-card').forEach(card => {
    card.addEventListener('click', () => {
      const theme = card.dataset.uiTheme;
      applyUITheme(theme);
      chrome.storage.sync.set({ uiTheme: theme });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // PROBLEMS LIST
  // ═══════════════════════════════════════════════════════════
  const problemsList = document.getElementById('problemsList');

  function loadProblems() {
    problemsList.innerHTML = '<div class="problems-empty">Loading...</div>';

    chrome.runtime.sendMessage({ type: 'GET_PROBLEMS' }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        problemsList.innerHTML = '<div class="problems-empty">Failed to load</div>';
        return;
      }
      renderProblems(response.problems);
    });
  }

  function renderProblems(problems) {
    if (!problems || problems.length === 0) {
      problemsList.innerHTML = '<div class="problems-empty">No problems synced yet. Go solve some! 🚀</div>';
      return;
    }

    problemsList.innerHTML = '';

    problems.forEach(p => {
      const item = document.createElement('div');
      item.className = 'problem-card';

      const diffClass = `difficulty-${(p.difficulty || 'easy').toLowerCase()}`;
      const solCount = p.solutionCount || 1;

      item.innerHTML = `
        <div class="problem-header">
          <span class="problem-number">#${p.number}</span>
          <div class="problem-info">
            <div class="problem-title">${p.title}</div>
            <div class="problem-meta">
              <span class="difficulty-badge ${diffClass}">${p.difficulty || '?'}</span>
              <span class="problem-lang">${p.language || ''}</span>
              <span class="problem-sol-count">${solCount} sol${solCount > 1 ? 's' : ''}</span>
            </div>
          </div>
          <div class="problem-actions">
            <button class="problem-toggle" title="View solutions">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6,9 12,15 18,9"/></svg>
            </button>
            <button class="problem-delete-all" title="Delete problem">🗑️</button>
          </div>
        </div>
        <div class="solutions-panel" style="display:none;">
          <div class="solutions-loading">Loading solutions...</div>
        </div>
      `;

      let expanded = false;
      const toggleBtn = item.querySelector('.problem-toggle');
      const panel = item.querySelector('.solutions-panel');

      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        expanded = !expanded;
        toggleBtn.classList.toggle('open', expanded);
        panel.style.display = expanded ? 'block' : 'none';

        if (expanded) {
          loadSolutions(p, panel, item);
        }
      });

      // Delete entire problem
      const deleteAllBtn = item.querySelector('.problem-delete-all');
      let confirmTimeout = null;

      deleteAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        if (!deleteAllBtn.classList.contains('confirm')) {
          deleteAllBtn.classList.add('confirm');
          deleteAllBtn.textContent = 'Delete all?';
          confirmTimeout = setTimeout(() => {
            deleteAllBtn.classList.remove('confirm');
            deleteAllBtn.textContent = '🗑️';
          }, 3000);
          return;
        }

        clearTimeout(confirmTimeout);
        deleteAllBtn.classList.remove('confirm');
        deleteAllBtn.classList.add('deleting');
        deleteAllBtn.innerHTML = '<div class="spinner"></div>';

        chrome.runtime.sendMessage({
          type: 'DELETE_PROBLEM',
          problemNumber: p.number,
          folderName: p.folderName,
        }, (response) => {
          if (response?.success) {
            item.style.transition = 'all 0.3s ease';
            item.style.opacity = '0';
            item.style.maxHeight = '0';
            item.style.padding = '0';
            item.style.overflow = 'hidden';
            setTimeout(() => {
              item.remove();
              if (problemsList.children.length === 0) {
                problemsList.innerHTML = '<div class="problems-empty">No problems synced yet. Go solve some! 🚀</div>';
              }
            }, 300);
          } else {
            deleteAllBtn.classList.remove('deleting');
            deleteAllBtn.textContent = '🗑️';
          }
        });
      });

      problemsList.appendChild(item);
    });
  }

  function loadSolutions(problem, panel, card) {
    panel.innerHTML = '<div class="solutions-loading">Loading solutions...</div>';

    chrome.runtime.sendMessage({
      type: 'GET_SOLUTIONS',
      folderName: problem.folderName,
    }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        panel.innerHTML = '<div class="solutions-loading">Failed to load</div>';
        return;
      }

      const sols = response.solutions;
      if (sols.length === 0) {
        panel.innerHTML = '<div class="solutions-loading">No solution files found</div>';
        return;
      }

      panel.innerHTML = '';
      sols.forEach((sol, idx) => {
        const solItem = document.createElement('div');
        solItem.className = 'solution-item';

        const ext = sol.name.replace(/^sol\d+/, '');
        const displayNum = idx + 1;

        solItem.innerHTML = `
          <div class="solution-info">
            <span class="solution-icon">📄</span>
            <span class="solution-name">Solution ${displayNum}</span>
            <span class="solution-ext">${ext}</span>
          </div>
          <button class="solution-delete" title="Delete this solution">✕</button>
        `;

        const delBtn = solItem.querySelector('.solution-delete');
        let solConfirmTimeout = null;

        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();

          if (!delBtn.classList.contains('confirm')) {
            delBtn.classList.add('confirm');
            delBtn.textContent = 'Sure?';
            solConfirmTimeout = setTimeout(() => {
              delBtn.classList.remove('confirm');
              delBtn.textContent = '✕';
            }, 3000);
            return;
          }

          clearTimeout(solConfirmTimeout);
          delBtn.classList.remove('confirm');
          delBtn.innerHTML = '<div class="spinner"></div>';

          chrome.runtime.sendMessage({
            type: 'DELETE_SOLUTION',
            problemNumber: problem.number,
            folderName: problem.folderName,
            fileName: sol.name,
          }, (res) => {
            if (res?.success) {
              solItem.style.transition = 'all 0.25s ease';
              solItem.style.opacity = '0';
              solItem.style.maxHeight = '0';
              setTimeout(() => {
                solItem.remove();
                // If problem was fully deleted
                if (res.remaining <= 0 || panel.children.length === 0) {
                  card.style.transition = 'all 0.3s ease';
                  card.style.opacity = '0';
                  card.style.maxHeight = '0';
                  setTimeout(() => {
                    card.remove();
                    if (problemsList.children.length === 0) {
                      problemsList.innerHTML = '<div class="problems-empty">No problems synced yet. Go solve some! 🚀</div>';
                    }
                  }, 300);
                } else {
                  // Renumber displayed solutions
                  panel.querySelectorAll('.solution-name').forEach((el, i) => {
                    el.textContent = `Solution ${i + 1}`;
                  });
                  // Update count badge
                  const countBadge = card.querySelector('.problem-sol-count');
                  if (countBadge) {
                    const newCount = panel.children.length;
                    countBadge.textContent = `${newCount} sol${newCount > 1 ? 's' : ''}`;
                  }
                }
              }, 250);
            } else {
              delBtn.classList.remove('confirm');
              delBtn.textContent = '✕';
            }
          });
        });

        panel.appendChild(solItem);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // SETTINGS (Save, Verify, Token toggle)
  // ═══════════════════════════════════════════════════════════
  toggleBtn.addEventListener('click', () => {
    const isPassword = tokenInput.type === 'password';
    tokenInput.type = isPassword ? 'text' : 'password';
  });

  saveBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    const repo = repoInput.value.trim();

    if (!token && !repo) { showMessage('Please enter at least a token or repo.', 'error'); return; }
    if (token && !token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
      showMessage('Token should start with ghp_ or github_pat_', 'error');
      return;
    }
    if (repo && !repo.includes('/')) {
      showMessage('Repo format: owner/repo-name', 'error');
      return;
    }

    const toSave = {};
    if (token) toSave.githubToken = token;
    if (repo) toSave.githubRepo = repo;

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<div class="spinner"></div> Saving...';

    chrome.storage.sync.set(toSave, () => {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/></svg> Save Settings`;
      showMessage('✅ Settings saved!', 'success');
      if (toSave.githubToken && toSave.githubRepo) setStatus('connected', 'Connected');
    });
  });

  verifyBtn.addEventListener('click', () => {
    verifyBtn.disabled = true;
    verifyBtn.innerHTML = '<div class="spinner"></div> Verifying...';

    const repo = repoInput.value.trim();
    chrome.runtime.sendMessage({ type: 'TEST_CONNECTION', repo }, (response) => {
      verifyBtn.disabled = false;
      verifyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg> Verify`;

      if (chrome.runtime.lastError) {
        showMessage(`Error: ${chrome.runtime.lastError.message}`, 'error');
        setStatus('error', 'Error');
        return;
      }

      if (response?.success) {
        setStatus('connected', 'Connected');
        showMessage(`✅ Connected to <strong>${response.repoName || repo}</strong>`, 'success');
      } else {
        setStatus('error', 'Error');
        showMessage(`❌ ${response?.error || 'Verification failed'}`, 'error');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════
  function setStatus(type, text) {
    statusBadge.className = `status-badge status-${type}`;
    statusText.textContent = text;
  }

  function showMessage(text, type = 'info') {
    statusMessage.innerHTML = text;
    statusMessage.className = `status-message status-${type}`;
    statusMessage.style.display = 'block';
    setTimeout(() => { statusMessage.style.display = 'none'; }, 5000);
  }
});
