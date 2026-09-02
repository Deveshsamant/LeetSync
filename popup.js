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
      mainPopup.style.display = 'flex';
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
        // Clicking the overlay (but not the dialog inside it) dismisses.
        modal.addEventListener('click', (event) => {
          if (event.target !== modal) return;
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

    // Driven off data-step rather than DOM order, so reordering the dots
    // cannot silently desynchronise them from the steps.
    const dots = document.querySelectorAll('.wizard-dot');
    dots.forEach(dot => {
      const n = Number(dot.dataset.step);
      dot.classList.toggle('done', n < step);
      dot.classList.toggle('active', n === step);
    });

    document.getElementById(`wizStep${step}`).classList.add('active');

    // The counter was static markup and never moved past "STEP 1 / 4".
    const counter = document.querySelector('.wizard-step-count');
    if (counter) counter.textContent = `STEP ${step} / ${dots.length}`;
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
            `<a href="${res.url}" target="_blank" style="color:var(--ac);font-size:13px;">📂 ${res.fullName}</a>`;
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
          `<a href="https://github.com/${repo}" target="_blank" style="color:var(--ac);font-size:13px;">📂 ${repo}</a>`;
        wizGoTo(4);
        btn.disabled = false;
        btn.textContent = 'Finish Setup ✨';
      });
    }
  });

  document.getElementById('wizDone').addEventListener('click', () => {
    wizardOverlay.style.display = 'none';
    mainPopup.style.display = 'flex';
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
    sheets: document.getElementById('tabSheets'),
    settings: document.getElementById('tabSettings'),
    battle: document.getElementById('tabBattle'),
  };

  function switchTab(tab, moveFocus) {
    if (!tabContents[tab]) return;
    tabBtns.forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      // Roving tabindex: only the selected tab is in the tab order, so Tab
      // moves past the bar rather than through every tab in it.
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      if (on && moveFocus) b.focus();
    });
    Object.entries(tabContents).forEach(([name, tc]) => tc.classList.toggle('active', name === tab));

    if (tab === 'problems') loadProblems();
    if (tab === 'dashboard') loadDashboard();
    if (tab === 'battle') loadBattle();
    if (tab === 'sheets') loadSheets();
  }

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Arrow keys move between tabs, Home/End jump to the ends — the pattern
  // screen readers and keyboard users expect from a tablist.
  document.querySelector('.tab-nav').addEventListener('keydown', (event) => {
    const order = [...tabBtns];
    const current = order.findIndex(b => b.dataset.tab === activeTabName());
    let next = null;
    if (event.key === 'ArrowRight') next = (current + 1) % order.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + order.length) % order.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = order.length - 1;
    if (next === null) return;
    event.preventDefault();
    switchTab(order[next].dataset.tab, true);
  });

  const activeTabName = () =>
    Object.keys(tabContents).find(n => tabContents[n].classList.contains('active')) || 'dashboard';

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

      // Pushes beyond the first for each problem are re-submissions.
      const pushSub = document.getElementById('statPushSub');
      if (pushSub) {
        const updates = Math.max(0, (response.pushCount || 0) - (response.solvedCount || 0));
        pushSub.textContent = updates === 1 ? '1 update' : `${updates} updates`;
      }
      refreshSyncCard();

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

  /**
   * The header's six "health" bars are the last six days of real solve
   * activity, scaled against the busiest of those days.
   */
  function renderHealthBars(solveCounts) {
    const wrap = document.getElementById('healthBars');
    if (!wrap) return;
    const bars = wrap.querySelectorAll('span');

    const days = [];
    for (let i = bars.length - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(solveCounts[d.toISOString().split('T')[0]] || 0);
    }

    const peak = Math.max(...days);
    bars.forEach((bar, i) => {
      const n = days[i];
      // 4px floor keeps empty days visible as a baseline tick
      bar.style.height = (peak ? 4 + Math.round((n / peak) * 18) : 4) + 'px';
      bar.className = n === 0 ? '' : (n === peak ? 'max' : 'on');
    });
    wrap.title = `Solves over the last 6 days: ${days.join(', ')}`;
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

      // Solved-this-month, derived from the stored problem dates.
      const solvedSub = document.getElementById('statSolvedSub');
      if (solvedSub) {
        const month = new Date().toISOString().slice(0, 7);
        const n = problems.filter(p => String(p.date || '').startsWith(month)).length;
        solvedSub.textContent = n ? `↑ ${n} this month` : 'none this month';
      }

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

      renderHealthBars(solveCounts);

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
  // Monoline glyphs on a 24×24 grid, stroked not filled, so they inherit the
  // theme accent and stay legible at 22px. Emoji rendered at the mercy of the
  // platform font and never matched the rest of the UI.
  const BADGE_ICONS = {
    flag:    '<path d="M6 21V3"/><path d="M6 4.5h11l-2.6 3.5L17 11.5H6"/>',
    flame:   '<path d="M12 3c3 3.8 5 6 5 9a5 5 0 0 1-10 0c0-2 .9-3.2 2-4.2.4 1.6 1.4 2.2 2 2.2.5-2-.6-4.8 1-7z"/>',
    bolt:    '<path d="M13.5 3 5.5 14H11l-.5 7 8-11h-5.5z"/>',
    crown:   '<path d="M4 8.5 7.5 12 12 5l4.5 7L20 8.5V18H4z"/>',
    target:  '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4"/>',
    medal:   '<circle cx="12" cy="14.5" r="5.5"/><path d="M9 3.5l2.2 5M15 3.5l-2.2 5"/>',
    trophy:  '<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H4.5v1.5A3 3 0 0 0 7.5 10.5M16.5 6h3v1.5a3 3 0 0 1-3 3"/><path d="M10 20h4M12 14v6"/>',
    stack:   '<path d="M4 12.5 12 17l8-4.5M4 8 12 12.5 20 8M4 3.5 12 8l8-4.5"/>',
    check:   '<circle cx="12" cy="12" r="8"/><path d="M8.5 12.2l2.4 2.4L15.6 10"/>',
    half:    '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>',
    shield:  '<path d="M12 3.2l8 3.4v5.6c0 4-3.4 6.5-8 8.1-4.6-1.6-8-4.1-8-8.1V6.6z"/>',
    globe:   '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4a12.5 12.5 0 0 1 0 16 12.5 12.5 0 0 1 0-16z"/>',
    moon:    '<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2z"/>',
    sunrise: '<path d="M12 3.5v3M5.2 9.2l2 2M18.8 9.2l-2 2M3 18.5h18M7.2 18.5a4.8 4.8 0 0 1 9.6 0"/>',
    layers:  '<path d="M4 7l8-3.2L20 7l-8 3.2z"/><path d="M4 12l8 3.2L20 12M4 16.6l8 3.2 8-3.2"/>',
  };

  const BADGE_DEFS = [
    { id: 'first_blood', icon: 'flag', name: 'First Blood', desc: 'Solve your 1st problem' },
    { id: 'on_fire', icon: 'flame', name: 'On Fire', desc: '3-day solving streak' },
    { id: 'unstoppable', icon: 'bolt', name: 'Unstoppable', desc: '7-day solving streak' },
    { id: 'month_king', icon: 'crown', name: 'Month King', desc: '30-day solving streak' },
    { id: 'deca', icon: 'target', name: 'Deca', desc: 'Solve 10 problems' },
    { id: 'quarter', icon: 'medal', name: 'Quarter', desc: 'Solve 25 problems' },
    { id: 'half_century', icon: 'trophy', name: 'Half Century', desc: 'Solve 50 problems' },
    { id: 'century', icon: 'stack', name: 'Century', desc: 'Solve 100 problems' },
    { id: 'easy_rider', icon: 'check', name: 'Easy Rider', desc: 'Solve 10 Easy' },
    { id: 'medium_rare', icon: 'half', name: 'Medium Rare', desc: 'Solve 10 Medium' },
    { id: 'hard_core', icon: 'shield', name: 'Hard Core', desc: 'Solve 5 Hard' },
    { id: 'polyglot', icon: 'globe', name: 'Polyglot', desc: 'Use 3+ languages' },
    { id: 'night_owl', icon: 'moon', name: 'Night Owl', desc: 'Solve after midnight' },
    { id: 'early_bird', icon: 'sunrise', name: 'Early Bird', desc: 'Solve before 7 AM' },
    { id: 'bookworm', icon: 'layers', name: 'Bookworm', desc: 'Solve 5 in one day' },
  ];

  function loadAchievements() {
    chrome.runtime.sendMessage({ type: 'GET_ACHIEVEMENTS' }, (data) => {
      if (chrome.runtime.lastError) return;
      const unlocked = data?.unlocked || {};
      const grid = document.getElementById('badgeGrid');
      grid.innerHTML = '';

      let count = 0;
      BADGE_DEFS.forEach((def, i) => {
        const isUnlocked = !!unlocked[def.id];
        if (isUnlocked) count++;

        const item = document.createElement('div');
        item.className = `badge-item ${isUnlocked ? 'unlocked' : 'locked'}`;
        item.title = `${def.name} — ${def.desc}${isUnlocked ? '' : ' (locked)'}`;
        // Staggered so the row resolves rather than snapping in together.
        if (isUnlocked) item.style.animationDelay = `${Math.min(i, 9) * 28}ms`;

        item.innerHTML =
          `<span class="badge-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" `
          + `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
          + `${BADGE_ICONS[def.icon] || BADGE_ICONS.target}</svg></span>`
          + `<span class="badge-name"></span>`;
        item.querySelector('.badge-name').textContent = def.name;
        grid.appendChild(item);
      });

      const meter = document.getElementById('badgeCount');
      if (meter) meter.textContent = `${count} / ${BADGE_DEFS.length}`;
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
      readmeThemeSelect.value = data?.theme || 'dark';
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
  const UI_THEMES = ['dark', 'light'];
  const DEFAULT_UI_THEME = 'dark';

  // Themes retired in the redesign (dark-pro, glassmorphic, gaming-arcade,
  // cyberpunk, ocean, sakura) fall back to dark.
  function normalizeUITheme(themeName) {
    return UI_THEMES.includes(themeName) ? themeName : DEFAULT_UI_THEME;
  }

  function applyUITheme(themeName) {
    const theme = normalizeUITheme(themeName);
    // Remove all theme classes from body
    document.body.className = document.body.className
      .replace(/\btheme-\S+/g, '').trim();
    // 'dark' is the :root baseline and needs no class
    if (theme !== DEFAULT_UI_THEME) {
      document.body.classList.add(`theme-${theme}`);
    }
    // Update active card
    document.querySelectorAll('.ui-theme-card').forEach(card => {
      card.classList.toggle('active', card.dataset.uiTheme === theme);
    });
    return theme;
  }

  function loadUITheme() {
    chrome.storage.sync.get(['uiTheme'], (data) => {
      const stored = data.uiTheme;
      const applied = applyUITheme(stored);
      // Migrate anyone still on a retired theme so the choice persists
      if (stored !== applied) chrome.storage.sync.set({ uiTheme: applied });
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

  // Fetched once per tab visit, then filtered in place so typing does not
  // hit the service worker on every keystroke.
  let allProblems = [];
  const problemFilters = { search: '', difficulty: 'all' };

  function loadProblems() {
    problemsList.innerHTML = '<div class="problems-empty">Loading…</div>';

    chrome.runtime.sendMessage({ type: 'GET_PROBLEMS' }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        problemsList.innerHTML = '<div class="problems-empty">Failed to load</div>';
        return;
      }
      allProblems = response.problems || [];
      applyProblemFilters();
    });
  }

  function applyProblemFilters() {
    const { search, difficulty } = problemFilters;
    const filtered = allProblems.filter(p => {
      if (difficulty !== 'all'
        && String(p.difficulty || '').toLowerCase() !== difficulty) return false;
      if (!search) return true;
      return String(p.title || '').toLowerCase().includes(search)
        || String(p.number || '').includes(search);
    });

    if (allProblems.length && !filtered.length) {
      problemsList.innerHTML =
        '<div class="problems-empty">No solved problems match these filters.</div>';
      return;
    }
    renderProblems(filtered);
  }

  document.getElementById('problemSearch').addEventListener('input', (event) => {
    problemFilters.search = event.target.value.trim().toLowerCase();
    applyProblemFilters();
  });

  document.querySelector('#tabProblems .filter-row').addEventListener('click', (event) => {
    const chip = event.target.closest('.filter-chip');
    if (!chip) return;
    document.querySelectorAll('#tabProblems .filter-chip')
      .forEach(c => c.classList.toggle('active', c === chip));
    problemFilters.difficulty = chip.dataset.filter;
    applyProblemFilters();
  });

  function renderProblems(problems) {
    if (!problems || problems.length === 0) {
      problemsList.innerHTML = '<div class="problems-empty">Nothing synced yet — solve a problem on LeetCode to get started.</div>';
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
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6,9 12,15 18,9"/></svg>
            </button>
            <button class="problem-delete-all" title="Delete problem">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4.5h6V7"/></svg>
            </button>
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
                problemsList.innerHTML = '<div class="problems-empty">Nothing synced yet — solve a problem on LeetCode to get started.</div>';
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
            <span class="solution-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14,3 14,8 19,8"/></svg></span>
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
                      problemsList.innerHTML = '<div class="problems-empty">Nothing synced yet — solve a problem on LeetCode to get started.</div>';
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
  // EXPORT / IMPORT
  //
  // Streak, achievements and sheet ticks exist only in this browser profile;
  // "Restore from GitHub" rebuilds solved problems from the repo but not
  // those. The token is deliberately excluded — a credential does not belong
  // in a file people email themselves.
  // ═══════════════════════════════════════════════════════════
  const LOCAL_KEYS = ['solvedProblems', 'streakData', 'achievements', 'pushCount', 'lastPush'];
  const SYNC_KEYS = ['githubRepo', 'uiTheme', 'readmeTheme', 'activeSheet', 'friends'];

  function showDataMessage(text, type = 'info') {
    const el = document.getElementById('dataMessage');
    el.textContent = text;
    el.className = `status-message status-${type}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 6000);
  }

  document.getElementById('exportBtn').addEventListener('click', async () => {
    const [local, sync, ticks] = await Promise.all([
      new Promise(r => chrome.storage.local.get(LOCAL_KEYS, d => r(d || {}))),
      new Promise(r => chrome.storage.sync.get(SYNC_KEYS, d => r(d || {}))),
      SheetProgress.load(),
    ]);

    // Pick the fields explicitly rather than trusting the query to have
    // filtered. A credential must not be able to reach this file by accident.
    const pick = (source, keys) => Object.fromEntries(
      keys.filter(k => source?.[k] !== undefined).map(k => [k, source[k]])
    );

    const payload = {
      app: 'leetsync',
      version: chrome.runtime?.getManifest?.().version || 'unknown',
      exportedAt: new Date().toISOString(),
      local: pick(local, LOCAL_KEYS),
      sync: pick(sync, SYNC_KEYS),
      sheetTicks: [...ticks],
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `leetsync-backup-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);

    const count = Object.keys(local.solvedProblems || {}).length;
    showDataMessage(`Exported ${count} problems and ${payload.sheetTicks.length} sheet ticks.`, 'success');
  });

  document.getElementById('importBtn')
    .addEventListener('click', () => document.getElementById('importFile').click());

  document.getElementById('importFile').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';               // allow re-picking the same file
    if (!file) return;

    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      return showDataMessage('That file is not valid JSON.', 'error');
    }
    if (payload?.app !== 'leetsync') {
      return showDataMessage('That is not a LeetSync backup.', 'error');
    }

    // Merge rather than replace: an import must not wipe problems solved on
    // this device since the backup was taken.
    const current = await new Promise(r => chrome.storage.local.get(LOCAL_KEYS, d => r(d || {})));
    const merged = {
      ...payload.local,
      solvedProblems: { ...(payload.local?.solvedProblems || {}), ...(current.solvedProblems || {}) },
      pushCount: Math.max(payload.local?.pushCount || 0, current.pushCount || 0),
    };

    await new Promise(r => chrome.storage.local.set(merged, r));
    if (payload.sync) {
      const safe = { ...payload.sync };
      delete safe.githubToken;             // never restore a credential
      await new Promise(r => chrome.storage.sync.set(safe, r));
    }
    if (Array.isArray(payload.sheetTicks)) {
      const ticks = await SheetProgress.load();
      payload.sheetTicks.forEach(t => ticks.add(t));
      await SheetProgress.save(ticks);
    }

    showDataMessage(
      `Imported ${Object.keys(payload.local?.solvedProblems || {}).length} problems. Reopen the popup to see them.`,
      'success'
    );
    loadDashboard();
    loadProblems();
  });

  // Version comes from the manifest so About cannot drift from what shipped.
  const aboutVersion = document.getElementById('aboutVersion');
  if (aboutVersion && chrome.runtime?.getManifest) {
    aboutVersion.textContent = `v${chrome.runtime.getManifest().version}`;
  }

  // ═══════════════════════════════════════════════════════════
  // REPO AUTO-SETUP
  //
  // The token already identifies its owner, so the repo can be found or
  // created without the user typing a name. background.js adopts it when it
  // exists and creates it when it does not.
  // ═══════════════════════════════════════════════════════════
  function runRepoSetup(btn, idleLabel, opts, done) {
    btn.disabled = true;
    btn.textContent = 'Checking GitHub…';
    chrome.runtime.sendMessage({ type: 'ENSURE_REPO', ...opts }, (res) => {
      btn.disabled = false;
      btn.textContent = idleLabel;
      if (chrome.runtime.lastError || !res?.success) {
        done(null, res?.error || chrome.runtime.lastError?.message || 'Could not reach GitHub.');
        return;
      }
      done(res, null);
    });
  }

  document.getElementById('autoRepoBtn').addEventListener('click', (event) => {
    runRepoSetup(event.currentTarget, 'Detect or create automatically',
      { repoName: repoInput.value.trim() },
      (res, err) => {
        if (err) return showMessage(err, 'error');
        repoInput.value = res.fullName;
        showMessage(
          res.created
            ? `Created <strong>${res.fullName}</strong>`
            : `Using existing <strong>${res.fullName}</strong>`,
          'success'
        );
        setStatus('connected', 'CONNECTED');
      });
  });

  document.getElementById('wizAutoRepo').addEventListener('click', (event) => {
    const wizError = document.getElementById('wizError');
    wizError.style.display = 'none';
    runRepoSetup(event.currentTarget, 'Set up automatically from my token',
      {
        repoName: document.getElementById('wizRepo').value.trim(),
        isPrivate: document.getElementById('wizRepoPrivate').checked,
      },
      (res, err) => {
        if (err) {
          wizError.textContent = err;
          wizError.style.display = 'block';
          return;
        }
        document.getElementById('wizRepoLink').innerHTML =
          `<a href="${res.url}" target="_blank" style="color:var(--ac);font-size:13px;">${res.fullName}</a>`;
        wizGoTo(4);
      });
  });

  // ═══════════════════════════════════════════════════════════
  // STUDY SHEETS
  //
  // sheets.json is built by scripts/fetch-sheets.mjs from LeetCode's own
  // APIs, so titles, slugs, difficulty and ids are authoritative. A question
  // is ticked when its LeetCode id appears in the solved set, which is the
  // same id background.js records on every push.
  // ═══════════════════════════════════════════════════════════
  const sheetPicker = document.getElementById('sheetPicker');
  const sheetList = document.getElementById('sheetList');
  let sheetData = null;
  let solvedIds = new Set();
  let manualDone = new Set();

  function getSolvedIds() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'GET_PROBLEMS' }, (res) => {
        if (chrome.runtime.lastError || !res?.success) return resolve(new Set());
        resolve(new Set((res.problems || []).map(p => Number(p.number)).filter(Boolean)));
      });
    });
  }

  // Ticks live in chrome.storage.sync via SheetProgress, chunked to stay
  // under the 8 KB per-item cap, so they survive a reinstall.
  const getManualDone = () => SheetProgress.load();

  const manualKey = (sheetId, q) => `${sheetId}|${q.title}`;

  // A popup is dismissed abruptly, so flush any debounced tick before it goes.
  window.addEventListener('pagehide', () => SheetProgress.flush());

  /** Auto-ticked from a real push, or ticked by hand for off-LeetCode rows. */
  function isDone(sheetId, q) {
    return (q.id != null && solvedIds.has(q.id)) || manualDone.has(manualKey(sheetId, q));
  }

  function questionUrl(q) {
    return q.slug ? `https://leetcode.com/problems/${q.slug}/` : (q.url || null);
  }

  async function loadSheets() {
    if (!sheetData) {
      try {
        // Bundled copy, upgraded to a newer published one when available.
        sheetData = await SheetData.load();
        if (!sheetData) throw new Error('no sheet data');
      } catch (error) {
        sheetList.innerHTML = '';
        const p = document.createElement('div');
        p.className = 'sheet-empty';
        p.textContent = 'Could not load study sheets.';
        sheetList.appendChild(p);
        return;
      }
      sheetPicker.innerHTML = '';
      sheetData.sheets.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.name} · ${s.count}`;
        sheetPicker.appendChild(opt);
      });
      const saved = await new Promise(r => chrome.storage.sync.get(['activeSheet'], d => r(d.activeSheet)));
      if (saved && sheetData.sheets.some(s => s.id === saved)) sheetPicker.value = saved;
    }

    [solvedIds, manualDone] = await Promise.all([getSolvedIds(), getManualDone()]);
    renderSheet(sheetPicker.value);
  }

  function renderSheet(sheetId) {
    const sheet = sheetData.sheets.find(s => s.id === sheetId) || sheetData.sheets[0];
    if (!sheet) return;

    const all = sheet.groups.flatMap(g => g.questions);
    const done = all.filter(q => isDone(sheet.id, q)).length;
    const pct = all.length ? Math.round((done / all.length) * 100) : 0;

    document.getElementById('sheetDone').textContent = done;
    document.getElementById('sheetTotal').textContent = all.length;
    document.getElementById('sheetPct').textContent = `${pct}%`;
    document.getElementById('sheetRemaining').textContent =
      done === all.length ? 'complete' : `${all.length - done} to go`;
    // Delayed so the width change animates rather than painting in place.
    setTimeout(() => { document.getElementById('sheetBarFill').style.width = `${pct}%`; }, 60);

    sheetList.innerHTML = '';
    sheet.groups.forEach((group, index) => {
      const wrap = document.createElement('div');
      wrap.className = 'sheet-group';

      const head = document.createElement('div');
      head.className = 'sheet-group-head';
      const name = document.createElement('span');
      name.className = 'sheet-group-name';
      name.textContent = group.name;
      const count = document.createElement('span');
      count.className = 'sheet-group-count';
      count.textContent = `${group.questions.filter(q => isDone(sheet.id, q)).length} / ${group.questions.length}`;
      head.append(name, count);

      const items = document.createElement('div');
      items.className = 'sheet-items';

      // Sheets run to 474 problems, so rows are built the first time a group
      // is opened rather than all at once.
      let built = false;
      const build = () => {
        if (built) return;
        built = true;
        group.questions.forEach(q => renderRow(items, sheet.id, q, count, group));
      };
      head.addEventListener('click', () => {
        build();
        wrap.classList.toggle('open');
      });
      if (index === 0) { build(); wrap.classList.add('open'); }

      wrap.append(head, items);
      sheetList.appendChild(wrap);
    });
  }

  function renderRow(container, sheetId, q, countEl, group) {
    const url = questionUrl(q);
    const row = document.createElement('div');
    row.className = 'sheet-item' + (isDone(sheetId, q) ? ' done' : '');

    const tick = document.createElement('button');
    tick.className = 'sheet-tick';
    tick.type = 'button';
    tick.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="4,12.5 9.5,18 20,6.5"></polyline></svg>';
    const auto = q.id != null && solvedIds.has(q.id);
    tick.title = auto ? 'Synced from your solutions' : 'Mark as done';
    tick.disabled = auto;
    tick.addEventListener('click', () => {
      const key = manualKey(sheetId, q);
      if (manualDone.has(key)) manualDone.delete(key); else manualDone.add(key);
      SheetProgress.schedule(manualDone);
      row.classList.toggle('done', isDone(sheetId, q));
      countEl.textContent =
        `${group.questions.filter(x => isDone(sheetId, x)).length} / ${group.questions.length}`;
      renderSheetTotals(sheetId);
    });

    const link = document.createElement(url ? 'a' : 'span');
    link.className = 'sheet-link';
    if (url) {
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    link.title = `${q.title} · ${q.difficulty}`;

    const num = document.createElement('span');
    num.className = 'sheet-num';
    num.textContent = q.id ?? '—';

    const title = document.createElement('span');
    title.className = 'sheet-title';
    title.textContent = q.title;

    const diff = document.createElement('span');
    diff.className = `difficulty-badge difficulty-${q.difficulty.toLowerCase()}`;
    diff.textContent = q.difficulty === 'Unknown' ? '?' : q.difficulty.slice(0, 1);

    link.append(num, title, diff);
    if (q.paid) {
      const paid = document.createElement('span');
      paid.className = 'sheet-paid';
      paid.textContent = 'PRO';
      link.appendChild(paid);
    }
    const open = document.createElement('span');
    open.className = 'sheet-open';
    open.textContent = url ? '↗' : '';
    link.appendChild(open);

    row.append(tick, link);
    container.appendChild(row);
  }

  function renderSheetTotals(sheetId) {
    const sheet = sheetData.sheets.find(s => s.id === sheetId);
    if (!sheet) return;
    const all = sheet.groups.flatMap(g => g.questions);
    const done = all.filter(q => isDone(sheet.id, q)).length;
    const pct = all.length ? Math.round((done / all.length) * 100) : 0;
    document.getElementById('sheetDone').textContent = done;
    document.getElementById('sheetPct').textContent = `${pct}%`;
    document.getElementById('sheetRemaining').textContent =
      done === all.length ? 'complete' : `${all.length - done} to go`;
    document.getElementById('sheetBarFill').style.width = `${pct}%`;
  }

  sheetPicker.addEventListener('change', () => {
    chrome.storage.sync.set({ activeSheet: sheetPicker.value });
    renderSheet(sheetPicker.value);
  });

  /**
   * The tracker opens as its own tab. Being an extension page it reads the
   * same storage as the popup, so it stays in sync without any messaging.
   */
  function openTracker(sheetId) {
    const url = chrome.runtime.getURL(`tracker.html${sheetId ? `#${sheetId}` : ''}`);
    if (chrome.tabs?.create) chrome.tabs.create({ url });
    else window.open(url, '_blank');
  }

  document.getElementById('sheetShowMore')
    .addEventListener('click', () => openTracker(sheetPicker.value));

  // The footer button had an id but no handler, so it did nothing.
  document.getElementById('openDashboardBtn')
    .addEventListener('click', () => openTracker());

  // ═══════════════════════════════════════════════════════════
  // SYNC FAILED SCREEN (design screen 04)
  // ═══════════════════════════════════════════════════════════
  const errorScreen = document.getElementById('errorScreen');

  function hideErrorScreen(forget) {
    errorScreen.style.display = 'none';
    if (forget) chrome.storage.local.remove('lastPushError');
  }

  function showErrorScreen(err) {
    const isAuth = err.kind === 'auth';
    const isNet = err.kind === 'network';
    const repo = (repoInput.value || '').trim() || 'your repository';

    document.getElementById('errBadge').textContent = isAuth ? 'AUTH EXPIRED' : 'SYNC FAILED';
    document.getElementById('errTitle').textContent = isAuth
      ? 'GitHub authentication expired'
      : isNet ? 'No connection to GitHub' : 'Push to GitHub failed';

    document.getElementById('errDesc').innerHTML = isAuth
      ? `Your personal access token was revoked or timed out, so the push to <strong>${repo}</strong> was rejected.`
      : isNet
        ? `LeetSync could not reach GitHub, so the push to <strong>${repo}</strong> did not complete.`
        : `The push to <strong>${repo}</strong> did not complete.`;

    const what = [err.title, err.language].filter(Boolean).join(' · ');
    document.getElementById('errSafeLabel').textContent = err.queued
      ? 'Nothing was lost'
      : 'This submission was not saved';
    document.getElementById('errQueued').textContent = err.queued
      ? `${what || 'Your submission'} is queued locally and will push the moment you reconnect.`
      : 'Re-submit on LeetCode once the problem below is resolved.';

    const at = new Date(err.at);
    document.getElementById('errCode').textContent =
      `${err.message} · ${isNaN(at) ? '' : at.toLocaleTimeString()}`;

    // Reconnecting is only the fix for an auth failure.
    document.getElementById('errReconnect').style.display = isAuth ? '' : 'none';

    errorScreen.style.display = 'flex';
  }

  chrome.storage.local.get(['lastPushError'], (data) => {
    if (chrome.runtime.lastError || !data.lastPushError) return;
    showErrorScreen(data.lastPushError);
  });

  document.getElementById('errReconnect').addEventListener('click', () => {
    hideErrorScreen(false);
    switchTab('settings');
    tokenInput.focus();
    tokenInput.select();
  });

  document.getElementById('errRetry').addEventListener('click', (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Retrying…';
    chrome.runtime.sendMessage({ type: 'PROCESS_QUEUE' }, (res) => {
      btn.disabled = false;
      if (chrome.runtime.lastError || !res?.success) {
        btn.textContent = 'Retry push';
        document.getElementById('errCode').textContent =
          res?.error || chrome.runtime.lastError?.message || 'Still failing — check the token.';
        return;
      }
      hideErrorScreen(true);
      loadDashboard();
      loadProblems();
    });
  });

  document.getElementById('errDismiss').addEventListener('click', () => hideErrorScreen(true));

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════
  function setStatus(type, text) {
    statusBadge.className = `status-badge status-${type}`;
    statusText.textContent = text;
    refreshSyncCard(type);
  }

  /**
   * Mirror the real connection state and repository into the dashboard's sync
   * card, so it never displays a state the extension isn't actually in.
   * Called with no argument to refresh the repo line only.
   */
  function refreshSyncCard(type) {
    const state = document.getElementById('syncState');
    const stateText = document.getElementById('syncStateText');
    const repoName = document.getElementById('statRepoName');

    if (state && stateText) {
      const next = type || state.dataset.state || 'disconnected';
      state.dataset.state = next;
      stateText.textContent =
        next === 'connected' ? 'Synchronized'
          : next === 'syncing' ? 'Syncing…'
            : 'Not connected';
    }
    const repo = (repoInput?.value || '').trim();
    if (repoName) {
      repoName.textContent = repo || 'No repository set';
    }

    // The row opens the repository on GitHub, but only once one is set —
    // otherwise it stays inert rather than linking to a 404.
    const row = document.getElementById('repoRow');
    if (row) {
      if (repo) {
        row.href = /^https?:\/\//.test(repo)
          ? repo
          : `https://github.com/${repo.replace(/^\/+|\/+$/g, '')}`;
        row.title = `Open ${repo} on GitHub`;
      } else {
        row.removeAttribute('href');
        row.removeAttribute('title');
      }
    }
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
      friendList.innerHTML = '<div class="problems-empty">No rivals yet. Add a GitHub username above to compare progress.</div>';
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


});
