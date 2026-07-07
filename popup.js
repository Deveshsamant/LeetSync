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
  chrome.storage.sync.get(['githubToken', 'githubRepo', 'wizardStep'], (data) => {
    if (!data.githubToken || !data.githubRepo) {
      wizardOverlay.style.display = 'flex';
      mainPopup.style.display = 'none';

      // Restore wizard to saved step
      if (data.githubToken) {
        // Token saved but no repo yet → jump to step 3
        document.getElementById('wizToken').value = data.githubToken;
        wizGoTo(3);
      } else if (data.wizardStep && data.wizardStep > 1) {
        wizGoTo(data.wizardStep);
      }
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
  // 🔧 REMOTE CONFIG — Maintenance, Updates, Announcements
  // ═══════════════════════════════════════════════════════════
  chrome.storage.local.get(['remoteConfig', 'showWhatsNew', 'dismissedAnnouncement'], (data) => {
    const config = data.remoteConfig;
    if (!config) return;

    const currentVersion = chrome.runtime.getManifest().version;

    // ── Maintenance Banner ──
    if (config.maintenance && config.maintenance.active) {
      const banner = document.getElementById('maintenanceBanner');
      document.getElementById('maintMessage').textContent = config.maintenance.message || 'We\'ll be back soon!';
      banner.style.display = 'flex';

      if (config.maintenance.endsAt) {
        const endsAt = new Date(config.maintenance.endsAt);
        function updateCountdown() {
          const now = new Date();
          const diff = endsAt - now;
          if (diff <= 0) {
            document.getElementById('maintCountdown').textContent = 'Should be back any moment!';
            return;
          }
          const hrs = Math.floor(diff / 3600000);
          const mins = Math.floor((diff % 3600000) / 60000);
          document.getElementById('maintCountdown').textContent = `Back in ~${hrs}h ${mins}m`;
        }
        updateCountdown();
        setInterval(updateCountdown, 60000);
      }
    }

    // ── Announcement Banner ──
    if (config.announcement && config.announcement.active && config.announcement.message) {
      if (data.dismissedAnnouncement !== config.announcement.message) {
        const banner = document.getElementById('announceBanner');
        document.getElementById('announceText').textContent = config.announcement.message;
        banner.style.display = 'flex';
        banner.className = 'announce-banner announce-' + (config.announcement.type || 'info');

        document.getElementById('announceDismiss').addEventListener('click', () => {
          banner.style.display = 'none';
          chrome.storage.local.set({ dismissedAnnouncement: config.announcement.message });
        });
      }
    }

    // ── Update Available Banner ──
    if (config.latestVersion && config.latestVersion !== currentVersion) {
      // Simple version comparison (works for semver like 1.0.0 < 1.1.0)
      const latest = config.latestVersion.split('.').map(Number);
      const current = currentVersion.split('.').map(Number);
      let isNewer = false;
      for (let i = 0; i < 3; i++) {
        if ((latest[i] || 0) > (current[i] || 0)) { isNewer = true; break; }
        if ((latest[i] || 0) < (current[i] || 0)) break;
      }
      if (isNewer) {
        const banner = document.getElementById('updateBanner');
        document.getElementById('updateText').textContent = `v${config.latestVersion} available! Update from Chrome Web Store.`;
        banner.style.display = 'flex';
      }
    }

    // ── What's New Modal ──
    if (data.showWhatsNew && config.changelog) {
      const changes = config.changelog[currentVersion];
      if (changes && changes.length > 0) {
        const modal = document.getElementById('whatsNewModal');
        document.getElementById('whatsNewVersion').textContent = 'v' + currentVersion;
        const list = document.getElementById('whatsNewList');
        list.innerHTML = '';
        changes.forEach(item => {
          const li = document.createElement('li');
          li.textContent = item;
          list.appendChild(li);
        });
        modal.style.display = 'flex';

        document.getElementById('whatsNewClose').addEventListener('click', () => {
          modal.style.display = 'none';
          chrome.storage.local.set({ showWhatsNew: false });
        });
        document.querySelector('.whatsnew-backdrop').addEventListener('click', () => {
          modal.style.display = 'none';
          chrome.storage.local.set({ showWhatsNew: false });
        });
      } else {
        chrome.storage.local.set({ showWhatsNew: false });
      }
    }
  });

  // ═══════════════════════════════════════════════════════════
  // WIZARD LOGIC
  // ═══════════════════════════════════════════════════════════
  let wizCurrentStep = 1;

  function wizGoTo(step) {
    wizCurrentStep = step;
    chrome.storage.sync.set({ wizardStep: step });
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
    chrome.storage.sync.remove('wizardStep');
    chrome.storage.sync.get(['githubToken', 'githubRepo'], (data) => {
      tokenInput.value = data.githubToken || '';
      repoInput.value = data.githubRepo || '';
      setStatus('connected', 'Connected');

      // Auto-sync from GitHub to restore any existing data
      if (data.githubRepo) {
        chrome.runtime.sendMessage({ type: 'SYNC_STATS', repo: data.githubRepo }, (res) => {
          if (chrome.runtime.lastError) return;
          if (res?.success) {
            console.log('[LeetSync] Auto-sync complete:', res);
          }
          // Reload everything after sync
          loadDashboard();
          loadProblems();
        });
      }
    });
    loadDashboard();
    loadProblems();
  });

  // ═══════════════════════════════════════════════════════════
  // TAB NAVIGATION
  // ═══════════════════════════════════════════════════════════
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = {
    dashboard: document.getElementById('tabDashboard'),
    problems: document.getElementById('tabProblems'),
    settings: document.getElementById('tabSettings'),
    battle: document.getElementById('tabBattle'),
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
      if (tab === 'battle') loadBattle();
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
            <button class="problem-share" title="Share showcase card">📸</button>
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

      // Share showcase card
      const shareBtn = item.querySelector('.problem-share');
      shareBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openShowcaseModal(p);
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

  // ── Manual Sync from GitHub button ──
  document.getElementById('syncFromGitHubBtn').addEventListener('click', () => {
    const syncBtn = document.getElementById('syncFromGitHubBtn');
    const syncStatus = document.getElementById('syncStatus');
    const repo = repoInput.value.trim();

    if (!repo) {
      syncStatus.innerHTML = '❌ Enter your repository name first';
      syncStatus.className = 'status-message status-error';
      syncStatus.style.display = 'block';
      return;
    }

    syncBtn.disabled = true;
    syncBtn.innerHTML = '<div class="spinner"></div> Syncing from GitHub...';
    syncStatus.innerHTML = '⏳ Fetching problems, commits & streak data...';
    syncStatus.className = 'status-message status-info';
    syncStatus.style.display = 'block';

    chrome.runtime.sendMessage({ type: 'SYNC_STATS', repo }, (res) => {
      syncBtn.disabled = false;
      syncBtn.innerHTML = '🔄 Sync from GitHub (Restore Data)';

      if (chrome.runtime.lastError) {
        syncStatus.innerHTML = `❌ ${chrome.runtime.lastError.message}`;
        syncStatus.className = 'status-message status-error';
        return;
      }

      if (res?.success) {
        syncStatus.innerHTML = `✅ Restored: <strong>${res.solvedCount}</strong> problems, <strong>${res.pushCount}</strong> pushes, <strong>${res.currentStreak}</strong>-day streak, <strong>${res.heatmapDays}</strong> heatmap days`;
        syncStatus.className = 'status-message status-success';
        // Reload everything
        loadDashboard();
        loadProblems();
      } else {
        syncStatus.innerHTML = `❌ ${res?.error || 'Sync failed'}`;
        syncStatus.className = 'status-message status-error';
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

  // ═══════════════════════════════════════════════════════════
  // ⚔️ FRIEND BATTLE SYSTEM
  // ═══════════════════════════════════════════════════════════
  const friendList = document.getElementById('friendList');
  const friendInput = document.getElementById('friendUsername');
  const addFriendBtn = document.getElementById('addFriendBtn');
  const friendError = document.getElementById('friendError');

  function showFriendError(msg) {
    friendError.textContent = msg;
    friendError.style.display = 'block';
    setTimeout(() => { friendError.style.display = 'none'; }, 4000);
  }

  function loadBattle() {
    chrome.storage.sync.get(['friends'], (data) => {
      const friends = data.friends || [];
      renderFriendCards(friends);
      updateWeeklyChallenge(friends);
    });
  }

  addFriendBtn.addEventListener('click', () => {
    const username = friendInput.value.trim();
    const repoInput = document.getElementById('friendRepo');
    const repoName = repoInput.value.trim();
    if (!username) { showFriendError('Enter a GitHub username'); return; }

    addFriendBtn.disabled = true;
    addFriendBtn.innerHTML = '<div class="spinner"></div>';

    chrome.runtime.sendMessage({ type: 'ADD_FRIEND', username, repoName }, (res) => {
      addFriendBtn.disabled = false;
      addFriendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg> Add';

      if (chrome.runtime.lastError) {
        showFriendError(chrome.runtime.lastError.message);
        return;
      }

      if (!res?.success) {
        showFriendError(res?.error || 'Failed to add friend');
        return;
      }

      friendInput.value = '';
      repoInput.value = '';
      loadBattle();
    });
  });

  friendInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addFriendBtn.click();
  });

  function renderFriendCards(friends) {
    if (!friends || friends.length === 0) {
      friendList.innerHTML = '<div class="problems-empty">No rivals yet. Add one above! ⚔️</div>';
      return;
    }

    friendList.innerHTML = '';

    // Get your stats for comparison
    chrome.storage.local.get(['solvedProblems', 'pushCount'], (myData) => {
      const myCount = Object.keys(myData.solvedProblems || {}).length;

      friends.forEach(friend => {
        const card = document.createElement('div');
        card.className = 'friend-card';

        const friendCount = friend.solvedCount || 0;
        const maxCount = Math.max(myCount, friendCount, 1);
        const myPct = Math.round((myCount / maxCount) * 100);
        const friendPct = Math.round((friendCount / maxCount) * 100);
        const winning = myCount > friendCount ? 'you' : myCount < friendCount ? 'them' : 'tie';

        const vsEmoji = winning === 'you' ? '💪' : winning === 'them' ? '😤' : '🤝';

        card.innerHTML = `
          <div class="friend-header">
            <img class="friend-avatar" src="https://github.com/${friend.username}.png?size=40" alt="${friend.username}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22><rect fill=%22%23333%22 width=%2240%22 height=%2240%22/><text x=%2220%22 y=%2226%22 text-anchor=%22middle%22 fill=%22%23888%22 font-size=%2216%22>?</text></svg>'">
            <div class="friend-info">
              <span class="friend-name">${friend.username}</span>
              <span class="friend-repo">${friend.repo || 'No LeetSync repo'}</span>
            </div>
            <div class="friend-vs">${vsEmoji}</div>
            <button class="friend-remove" data-username="${friend.username}" title="Remove rival">✕</button>
          </div>
          <div class="friend-comparison">
            <div class="compare-row">
              <span class="compare-label you-label">You</span>
              <div class="compare-bar-track">
                <div class="compare-bar-fill you-bar" style="width:${myPct}%"></div>
              </div>
              <span class="compare-value">${myCount}</span>
            </div>
            <div class="compare-row">
              <span class="compare-label them-label">${friend.username.substring(0, 8)}</span>
              <div class="compare-bar-track">
                <div class="compare-bar-fill them-bar" style="width:${friendPct}%"></div>
              </div>
              <span class="compare-value">${friendCount}</span>
            </div>
          </div>
          <div class="friend-footer">
            <span class="friend-stat">${friend.languages || 'Unknown'}</span>
            <span class="friend-updated">${friend.lastFetched ? 'Updated ' + timeAgo(friend.lastFetched) : ''}</span>
          </div>
        `;

        // Remove friend handler
        card.querySelector('.friend-remove').addEventListener('click', (e) => {
          e.stopPropagation();
          chrome.runtime.sendMessage({ type: 'REMOVE_FRIEND', username: friend.username }, () => {
            card.style.transition = 'all 0.3s ease';
            card.style.opacity = '0';
            card.style.maxHeight = '0';
            setTimeout(() => { card.remove(); loadBattle(); }, 300);
          });
        });

        friendList.appendChild(card);
      });
    });
  }

  function updateWeeklyChallenge(friends) {
    chrome.storage.local.get(['solvedProblems'], (data) => {
      const problems = Object.values(data.solvedProblems || {});
      const now = new Date();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      monday.setHours(0, 0, 0, 0);
      const mondayStr = monday.toISOString().split('T')[0];

      const yourWeekly = problems.filter(p => p.date >= mondayStr).length;
      document.getElementById('yourWeeklyScore').textContent = yourWeekly;

      const maxWeekly = Math.max(yourWeekly, 1);
      document.getElementById('yourWeeklyBar').style.width = Math.round((yourWeekly / maxWeekly) * 100) + '%';

      // Add friend bars to weekly
      const weeklyBars = document.getElementById('weeklyBars');
      // Remove old friend bars (keep only the "You" row)
      weeklyBars.querySelectorAll('.friend-weekly-row').forEach(el => el.remove());

      friends.forEach(f => {
        const row = document.createElement('div');
        row.className = 'weekly-bar-row friend-weekly-row';
        const fScore = f.weeklyCount || 0;
        const fPct = Math.round((fScore / Math.max(yourWeekly, fScore, 1)) * 100);

        // Recalculate your bar with new max
        const newMax = Math.max(yourWeekly, fScore, 1);
        document.getElementById('yourWeeklyBar').style.width = Math.round((yourWeekly / newMax) * 100) + '%';

        row.innerHTML = `
          <span class="weekly-name">${f.username.substring(0, 8)}</span>
          <div class="weekly-bar-track">
            <div class="weekly-bar-fill them-fill" style="width:${fPct}%"></div>
          </div>
          <span class="weekly-score">${fScore}</span>
        `;
        weeklyBars.appendChild(row);
      });

      // Days until Monday reset
      const daysLeft = (7 - ((now.getDay() + 6) % 7)) % 7 || 7;
      document.getElementById('weeklyReset').textContent = daysLeft === 7 ? 'Resets today!' : `Resets in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`;
    });
  }

  function timeAgo(isoStr) {
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
  }

  // ═══════════════════════════════════════════════════════════
  // 📸 SHOWCASE CARD SYSTEM
  // ═══════════════════════════════════════════════════════════
  const showcaseModal = document.getElementById('showcaseModal');
  const showcaseCanvas = document.getElementById('showcaseCanvas');
  const showcaseClose = document.getElementById('showcaseClose');
  const showcaseCopy = document.getElementById('showcaseCopy');
  const showcaseDownload = document.getElementById('showcaseDownload');
  let currentShowcaseProblem = null;

  function openShowcaseModal(problem) {
    currentShowcaseProblem = problem;
    showcaseModal.style.display = 'flex';
    renderShowcaseCard(problem);
  }

  function closeShowcaseModal() {
    showcaseModal.style.display = 'none';
    currentShowcaseProblem = null;
  }

  showcaseClose.addEventListener('click', closeShowcaseModal);
  document.querySelector('.showcase-backdrop').addEventListener('click', closeShowcaseModal);

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function renderShowcaseCard(p) {
    const canvas = showcaseCanvas;
    const ctx = canvas.getContext('2d');
    const W = 600, H = 340;
    const dpr = 2;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);

    const diffColors = {
      Easy:   { main: '#00b8a3', bg: '#0a2e2a', glow: 'rgba(0,184,163,0.3)' },
      Medium: { main: '#ffa116', bg: '#2e2210', glow: 'rgba(255,161,22,0.3)' },
      Hard:   { main: '#ef4743', bg: '#2e1010', glow: 'rgba(239,71,67,0.3)' },
    };
    const diff = diffColors[p.difficulty] || diffColors.Easy;

    // Background
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, '#0d1117');
    bgGrad.addColorStop(0.5, '#161b22');
    bgGrad.addColorStop(1, '#0d1117');
    ctx.fillStyle = bgGrad;
    roundRect(ctx, 0, 0, W, H, 16);
    ctx.fill();

    // Border
    ctx.strokeStyle = diff.main;
    ctx.lineWidth = 2;
    roundRect(ctx, 1, 1, W - 2, H - 2, 16);
    ctx.stroke();

    // Top accent bar
    ctx.fillStyle = diff.main;
    ctx.fillRect(16, 0, W - 32, 4);

    // Problem number badge
    ctx.fillStyle = diff.bg;
    roundRect(ctx, 24, 22, 70, 36, 8);
    ctx.fill();
    ctx.strokeStyle = diff.main + '60';
    ctx.lineWidth = 1;
    roundRect(ctx, 24, 22, 70, 36, 8);
    ctx.stroke();
    ctx.fillStyle = diff.main;
    ctx.font = 'bold 16px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('#' + p.number, 59, 46);

    // Title
    ctx.fillStyle = '#f0f6fc';
    ctx.font = 'bold 20px Inter, sans-serif';
    ctx.textAlign = 'left';
    const title = p.title.length > 28 ? p.title.substring(0, 26) + '...' : p.title;
    ctx.fillText(title, 108, 48);

    // Difficulty badge
    const diffText = (p.difficulty || 'Easy').toUpperCase();
    ctx.font = 'bold 11px Inter, sans-serif';
    const diffW = ctx.measureText(diffText).width + 16;
    ctx.fillStyle = diff.main + '20';
    roundRect(ctx, 24, 70, diffW, 22, 4);
    ctx.fill();
    ctx.fillStyle = diff.main;
    ctx.textAlign = 'left';
    ctx.fillText(diffText, 32, 85);

    // Language badge
    if (p.language) {
      ctx.fillStyle = 'rgba(139,148,158,0.15)';
      const langW = ctx.measureText(p.language).width + 16;
      roundRect(ctx, 28 + diffW, 70, langW, 22, 4);
      ctx.fill();
      ctx.fillStyle = '#8b949e';
      ctx.fillText(p.language, 36 + diffW, 85);
    }

    // Motivational quote
    const quotes = {
      Easy: ['Clean solve! 🎯', 'Warmed up! 💪', 'Easy peasy! ✅'],
      Medium: ['Nice grind! 🔥', 'Big brain move! 🧠', 'Level up! ⬆️'],
      Hard: ['ABSOLUTE BEAST! 🐉', 'Galaxy brain! 🌌', 'Legendary! 👑'],
    };
    const quoteList = quotes[p.difficulty] || quotes.Easy;
    const quote = quoteList[Math.floor(Math.random() * quoteList.length)];
    ctx.fillStyle = diff.main;
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(quote, W - 24, 48);

    // Divider
    ctx.strokeStyle = 'rgba(48,54,61,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(24, 106);
    ctx.lineTo(W - 24, 106);
    ctx.stroke();

    // Stats boxes — hide runtime/memory when not available (synced cards)
    const hasPerf = p.bestRuntime || p.bestMemory;
    const stats = hasPerf
      ? [
          { label: 'SOLUTIONS', value: String(p.solutionCount || 1), icon: '📝' },
          { label: 'RUNTIME', value: p.bestRuntime ? p.bestRuntime + 'ms' : 'N/A', icon: '⚡' },
          { label: 'MEMORY', value: p.bestMemory ? p.bestMemory + 'MB' : 'N/A', icon: '💾' },
        ]
      : [
          { label: 'SOLUTIONS', value: String(p.solutionCount || 1), icon: '📝' },
          { label: 'SOLVED', value: p.date || '—', icon: '📅' },
        ];
    const statW = (W - 48) / stats.length;
    stats.forEach((s, i) => {
      const x = 24 + i * statW;
      ctx.fillStyle = 'rgba(22,27,34,0.8)';
      roundRect(ctx, x + 4, 118, statW - 8, 72, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(48,54,61,0.4)';
      ctx.lineWidth = 1;
      roundRect(ctx, x + 4, 118, statW - 8, 72, 8);
      ctx.stroke();

      ctx.font = '18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f0f6fc';
      ctx.fillText(s.icon, x + statW / 2, 143);

      ctx.fillStyle = '#f0f6fc';
      ctx.font = 'bold 18px Inter, sans-serif';
      // Shrink font for long date values
      if (s.value.length > 6) ctx.font = 'bold 14px Inter, sans-serif';
      ctx.fillText(s.value, x + statW / 2, 166);

      ctx.fillStyle = '#484f58';
      ctx.font = '600 9px Inter, sans-serif';
      ctx.fillText(s.label, x + statW / 2, 181);
    });

    // Date (only show when we have performance data — otherwise it's already in the stats box)
    if (hasPerf) {
      ctx.fillStyle = '#484f58';
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Solved: ' + (p.date || 'Unknown'), 28, 216);
    }

    // Dot grid decoration
    ctx.fillStyle = 'rgba(48,54,61,0.2)';
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 20; col++) {
        ctx.beginPath();
        ctx.arc(28 + col * 14, 236 + row * 14, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Bottom branding
    const brandGrad = ctx.createLinearGradient(0, H - 50, 0, H);
    brandGrad.addColorStop(0, 'rgba(13,17,23,0)');
    brandGrad.addColorStop(1, 'rgba(13,17,23,0.95)');
    ctx.fillStyle = brandGrad;
    ctx.fillRect(0, H - 50, W, 50);

    ctx.fillStyle = '#ffa116';
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('⚡ LeetSync', 24, H - 16);

    chrome.storage.sync.get(['githubRepo'], (data) => {
      if (data.githubRepo) {
        ctx.fillStyle = '#484f58';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('github.com/' + data.githubRepo, W - 24, H - 16);
      }
    });
  }

  // Copy card to clipboard
  showcaseCopy.addEventListener('click', async () => {
    try {
      const blob = await new Promise(resolve => showcaseCanvas.toBlob(resolve, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showcaseCopy.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20,6 9,17 4,12"/></svg> Copied!';
      setTimeout(() => {
        showcaseCopy.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy Image';
      }, 2000);
    } catch (err) {
      showcaseCopy.textContent = '❌ Failed';
      setTimeout(() => {
        showcaseCopy.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy Image';
      }, 2000);
    }
  });

  // Download card as PNG
  showcaseDownload.addEventListener('click', () => {
    const p = currentShowcaseProblem;
    if (!p) return;
    const link = document.createElement('a');
    link.download = 'leetsync-' + p.number + '-' + p.title.replace(/\s+/g, '-').toLowerCase() + '.png';
    link.href = showcaseCanvas.toDataURL('image/png');
    link.click();
  });

});
