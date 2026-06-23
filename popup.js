/* ============================================================
   popup.js — Extension popup logic
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  // ── DOM Elements ─────────────────────────────────────────
  const tokenInput    = document.getElementById('githubToken');
  const repoInput     = document.getElementById('githubRepo');
  const saveBtn       = document.getElementById('saveBtn');
  const verifyBtn     = document.getElementById('verifyBtn');
  const toggleBtn     = document.getElementById('toggleToken');
  const statusBadge   = document.getElementById('statusBadge');
  const statusText    = document.getElementById('statusText');
  const statusMessage = document.getElementById('statusMessage');
  const statPushCount   = document.getElementById('statPushCount');
  const statSolvedCount = document.getElementById('statSolvedCount');
  const statLastPush    = document.getElementById('statLastPush');

  // ── Load saved settings ──────────────────────────────────
  chrome.storage.sync.get(['githubToken', 'githubRepo'], (data) => {
    if (data.githubToken) {
      tokenInput.value = data.githubToken;
    }
    if (data.githubRepo) {
      repoInput.value = data.githubRepo;
    }

    // If both are set, show connected status
    if (data.githubToken && data.githubRepo) {
      setStatus('connected', 'Connected');
    }
  });

  // Load stats
  loadStats();

  // ── Token visibility toggle ──────────────────────────────
  toggleBtn.addEventListener('click', () => {
    const isPassword = tokenInput.type === 'password';
    tokenInput.type = isPassword ? 'text' : 'password';
    toggleBtn.title = isPassword ? 'Hide token' : 'Show token';
  });

  // ── Save Settings ────────────────────────────────────────
  saveBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    const repo = repoInput.value.trim();

    if (!token) {
      showMessage('Please enter your GitHub Personal Access Token.', 'error');
      tokenInput.focus();
      return;
    }

    if (!repo) {
      showMessage('Please enter your repository name (owner/repo).', 'error');
      repoInput.focus();
      return;
    }

    // Validate repo format
    if (!repo.includes('/') || repo.split('/').length !== 2) {
      showMessage('Repository must be in "owner/repo" format.', 'error');
      repoInput.focus();
      return;
    }

    // Save to storage
    setButtonLoading(saveBtn, true);

    chrome.storage.sync.set({ githubToken: token, githubRepo: repo }, () => {
      setButtonLoading(saveBtn, false);
      showMessage('✅ Settings saved successfully!', 'success');
      setStatus('connected', 'Connected');
    });
  });

  // ── Verify Connection ────────────────────────────────────
  verifyBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    const repo = repoInput.value.trim();

    if (!token || !repo) {
      showMessage('Please fill in both fields first.', 'error');
      return;
    }

    setButtonLoading(verifyBtn, true);

    // Temporarily save the token for the API call
    chrome.storage.sync.set({ githubToken: token, githubRepo: repo }, () => {
      chrome.runtime.sendMessage(
        { type: 'TEST_CONNECTION', repo },
        (response) => {
          setButtonLoading(verifyBtn, false);

          if (chrome.runtime.lastError) {
            showMessage(`Extension error: ${chrome.runtime.lastError.message}`, 'error');
            setStatus('error', 'Error');
            return;
          }

          if (response && response.success) {
            const visibility = response.private ? '🔒 Private' : '🌐 Public';
            showMessage(
              `✅ Connected to <strong>${response.repoName}</strong> (${visibility})`,
              'success'
            );
            setStatus('connected', 'Connected');
          } else {
            const error = response?.error || 'Could not connect';
            showMessage(`❌ ${error}`, 'error');
            setStatus('error', 'Error');
          }
        }
      );
    });
  });

  // ── Helper Functions ─────────────────────────────────────

  function setStatus(state, text) {
    statusBadge.className = `status-badge status-${state}`;
    statusText.textContent = text;
  }

  function showMessage(html, type) {
    statusMessage.innerHTML = html;
    statusMessage.className = `status-message status-${type}`;
    statusMessage.style.display = 'block';

    // Auto-hide after 5 seconds
    clearTimeout(statusMessage._hideTimeout);
    statusMessage._hideTimeout = setTimeout(() => {
      statusMessage.style.display = 'none';
    }, 5000);
  }

  function setButtonLoading(btn, loading) {
    if (loading) {
      btn.disabled = true;
      btn._originalHTML = btn.innerHTML;
      btn.innerHTML = '<div class="spinner"></div> Working...';
    } else {
      btn.disabled = false;
      btn.innerHTML = btn._originalHTML;
    }
  }

  function loadStats() {
    chrome.runtime.sendMessage({ type: 'GET_STATS' }, (response) => {
      if (chrome.runtime.lastError || !response) return;

      statPushCount.textContent = response.pushCount || 0;
      statSolvedCount.textContent = response.solvedCount || 0;

      if (response.lastPush) {
        const date = new Date(response.lastPush);
        const now = new Date();
        const diffMs = now - date;
        const diffMin = Math.floor(diffMs / 60000);
        const diffHr = Math.floor(diffMs / 3600000);
        const diffDay = Math.floor(diffMs / 86400000);

        if (diffMin < 1) {
          statLastPush.textContent = 'Just now';
        } else if (diffMin < 60) {
          statLastPush.textContent = `${diffMin}m ago`;
        } else if (diffHr < 24) {
          statLastPush.textContent = `${diffHr}h ago`;
        } else {
          statLastPush.textContent = `${diffDay}d ago`;
        }
      } else {
        statLastPush.textContent = '—';
      }
    });
  }
});
