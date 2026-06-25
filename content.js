/* ============================================================
   content.js — Content script (ISOLATED world)
   
   Listens for submission events from injected.js (MAIN world)
   via window.postMessage, then:
   1. Scrapes problem metadata via LeetCode GraphQL
   2. Captures the submitted code
   3. Sends everything to background.js for GitHub push
   ============================================================ */

(function () {
  'use strict';

  // Version-based guard: allows re-injection when extension updates
  const CONTENT_VERSION = 2;
  if (window.__leetcodePusherContentVersion >= CONTENT_VERSION) return;
  window.__leetcodePusherContentVersion = CONTENT_VERSION;

  console.log(`[LeetSync] Content script v${CONTENT_VERSION} loaded (ISOLATED world)`);

  // ── Extension Context Guard ────────────────────────────────
  // After reloading the extension, the old content script's chrome
  // APIs become invalid. Detect this and warn the user to refresh.
  function isExtensionContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch (e) {
      return false;
    }
  }

  function requireValidContext() {
    if (!isExtensionContextValid()) {
      showRefreshBanner();
      return false;
    }
    return true;
  }

  // Shows a sticky, impossible-to-miss banner at the top of the page
  function showRefreshBanner() {
    if (document.getElementById('lc-pusher-refresh-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'lc-pusher-refresh-banner';
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999999',
      'background:linear-gradient(90deg,#ff6b35,#ffa116)',
      'color:#0d1117', 'font-family:Inter,sans-serif', 'font-size:13px',
      'font-weight:600', 'padding:10px 20px', 'text-align:center',
      'display:flex', 'align-items:center', 'justify-content:center', 'gap:12px',
      'box-shadow:0 2px 12px rgba(0,0,0,0.4)',
    ].join(';');
    banner.innerHTML = `
      <span>⚡ LeetSync was reloaded — please</span>
      <button onclick="location.reload()" style="
        background:#0d1117;color:#ffa116;border:none;border-radius:6px;
        padding:5px 14px;font-size:12px;font-weight:700;cursor:pointer;
        font-family:inherit;transition:opacity 0.2s
      " onmouseover="this.style.opacity=0.8" onmouseout="this.style.opacity=1">
        🔄 Refresh Page
      </button>
      <span>to re-activate</span>
    `;
    document.body.prepend(banner);
  }

  // ── State ──────────────────────────────────────────────────
  let isProcessing = false;
  let isConfigured = false;

  // ── Toast Notification System ──────────────────────────────
  function showToast(message, type = 'info', duration = 4000) {
    // Remove existing toasts
    document.querySelectorAll('.lc-pusher-toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `lc-pusher-toast lc-pusher-toast-${type}`;

    const iconMap = {
      success: '✅',
      error: '❌',
      info: '🔄',
      warning: '⚠️',
    };

    toast.innerHTML = `
      <div class="lc-pusher-toast-icon">${iconMap[type] || 'ℹ️'}</div>
      <div class="lc-pusher-toast-content">
        <div class="lc-pusher-toast-title">LeetSync</div>
        <div class="lc-pusher-toast-message">${message}</div>
      </div>
      <button class="lc-pusher-toast-close" aria-label="Close">&times;</button>
    `;

    document.body.appendChild(toast);

    // Trigger slide-in animation
    requestAnimationFrame(() => toast.classList.add('lc-pusher-toast-show'));

    const closeBtn = toast.querySelector('.lc-pusher-toast-close');
    closeBtn.addEventListener('click', () => {
      toast.classList.remove('lc-pusher-toast-show');
      setTimeout(() => toast.remove(), 300);
    });

    if (duration > 0) {
      setTimeout(() => {
        if (toast.parentNode) {
          toast.classList.remove('lc-pusher-toast-show');
          setTimeout(() => toast.remove(), 300);
        }
      }, duration);
    }

    return toast;
  }

  // ── Problem Data Extraction ────────────────────────────────

  /**
   * Extract the problem slug from the current URL.
   */
  function getProblemSlug() {
    const match = window.location.pathname.match(/\/problems\/([^/]+)/);
    return match ? match[1] : null;
  }

  /**
   * Fetch full problem details using LeetCode's public GraphQL API.
   */
  async function fetchProblemDetails(slug) {
    const query = `
      query questionData($titleSlug: String!) {
        question(titleSlug: $titleSlug) {
          questionId
          questionFrontendId
          title
          titleSlug
          content
          difficulty
          topicTags {
            name
          }
        }
      }
    `;

    const response = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { titleSlug: slug },
      }),
    });

    const data = await response.json();
    return data?.data?.question || null;
  }

  // ── Submission Result Handling ─────────────────────────────

  /**
   * Called when injected.js detects an accepted submission result.
   * This is the main flow — scrape data and push to GitHub.
   */
  async function handleAcceptedResult(resultData) {
    if (isProcessing) {
      console.log('[LeetCode Pusher] Already processing, skipping duplicate');
      return;
    }

    isProcessing = true;

    try {
      showToast('Solution accepted! Pushing to GitHub...', 'info', 0);

      const slug = getProblemSlug();
      if (!slug) {
        showToast('Could not determine problem slug from URL.', 'error');
        isProcessing = false;
        return;
      }

      // Fetch full problem details via GraphQL
      const problemDetails = await fetchProblemDetails(slug);
      if (!problemDetails) {
        showToast('Could not fetch problem details from LeetCode.', 'error');
        isProcessing = false;
        return;
      }

      // Get language from the result data
      let language = resultData.lang || null;
      if (language) {
        language = language.toLowerCase().replace(/\s+/g, '');
      }

      // Get the submitted code from the result data
      let code = resultData.code || null;

      // If code is missing, try fetching the submission detail API
      if (!code && resultData.submission_id) {
        try {
          const resp = await fetch(`https://leetcode.com/api/submissions/${resultData.submission_id}`);
          if (resp.ok) {
            const detail = await resp.json();
            code = detail.code || code;
            if (!language) language = (detail.lang || '').toLowerCase();
          }
        } catch (e) {
          console.warn('[LeetCode Pusher] Could not fetch submission detail:', e);
        }
      }

      // Fallback: try extracting code from the editor DOM
      if (!code) {
        code = extractCodeFromEditor();
      }

      if (!code) {
        showToast('Could not capture submitted code. Try reloading the page and submitting again.', 'error');
        isProcessing = false;
        return;
      }

      // Build the runtime/memory stats strings
      let runtimeStr = null;
      if (resultData.status_runtime) {
        runtimeStr = resultData.status_runtime;
        if (resultData.runtime_percentile) {
          runtimeStr += ` (Beats ${Math.round(resultData.runtime_percentile)}%)`;
        }
      }

      let memoryStr = null;
      if (resultData.status_memory) {
        memoryStr = resultData.status_memory;
        if (resultData.memory_percentile) {
          memoryStr += ` (Beats ${Math.round(resultData.memory_percentile)}%)`;
        }
      }

      // Assemble the full problem payload
      const problemData = {
        number: parseInt(problemDetails.questionFrontendId, 10),
        title: problemDetails.title,
        titleSlug: problemDetails.titleSlug,
        difficulty: problemDetails.difficulty,
        tags: problemDetails.topicTags.map(t => t.name),
        description: htmlToMarkdown(problemDetails.content),
        url: `https://leetcode.com/problems/${slug}/`,
        language: language,
        code: code,
        runtime: runtimeStr,
        memory: memoryStr,
        submissionId: resultData.submission_id,
        timestamp: new Date().toISOString(),
      };

      console.log('[LeetCode Pusher] Pushing:', problemData.number, problemData.title);

      // Send to background service worker for GitHub push
      if (!requireValidContext()) {
        isProcessing = false;
        return;
      }

      try {
        chrome.runtime.sendMessage(
          { type: 'PUSH_TO_GITHUB', data: problemData },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error('[LeetCode Pusher] Runtime error:', chrome.runtime.lastError);
              showToast(`Extension error: ${chrome.runtime.lastError.message}`, 'error');
              isProcessing = false;
              return;
            }

            if (response && response.success) {
              const solNum = response.solutionNumber || 1;
              const newBest = (response.isNewBestTime || response.isNewBestMemory)
                ? ' 🎉 New best!' : '';
              showToast(
                `Pushed to GitHub! 🎉 <strong>${problemData.number}. ${problemData.title}</strong><br>` +
                `📂 Saved as <code>sol${solNum}${getLanguageInfo(problemData.language || '').ext}</code>${newBest}`,
                'success',
                7000
              );
            } else {
              const errorMsg = response?.error || 'Unknown error';
              showToast(`Failed to push: ${errorMsg}`, 'error', 8000);
            }
            isProcessing = false;
          }
        );
      } catch (e) {
        showToast('Extension context lost — please <strong>refresh this page</strong>.', 'warning', 0);
        isProcessing = false;
      }
    } catch (error) {
      console.error('[LeetCode Pusher] Error:', error);
      showToast(`Error: ${error.message}`, 'error');
      isProcessing = false;
    }
  }

  /**
   * Fallback: extract code from the Monaco editor DOM.
   */
  function extractCodeFromEditor() {
    // Method 1: Monaco editor view-lines
    const viewLines = document.querySelector('.monaco-editor .view-lines');
    if (viewLines) {
      const lines = viewLines.querySelectorAll('.view-line');
      if (lines.length > 0) {
        return Array.from(lines).map(line => line.textContent).join('\n');
      }
    }

    // Method 2: CodeMirror (older UI)
    const cm = document.querySelector('.CodeMirror');
    if (cm && cm.CodeMirror) {
      return cm.CodeMirror.getValue();
    }

    return null;
  }

  // ── Listen for Messages from MAIN World ────────────────────

  /**
   * The injected.js script (MAIN world) sends us submission events
   * via window.postMessage since it can intercept the page's fetch calls
   * but can't access chrome.runtime APIs.
   */
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    const msg = event.data;
    if (!msg?.type?.startsWith('__LC_PUSHER_')) return;

    // ── Guard: extension context must be valid ──
    if (!isExtensionContextValid()) {
      showRefreshBanner();
      return;
    }

    // Submission was created (user clicked Submit)
    if (msg.type === '__LC_PUSHER_SUBMISSION__') {
      console.log('[LeetSync] Received submission event, ID:', msg.submissionId);
      if (!isProcessing) {
        showToast('Monitoring submission result...', 'info', 0);
      }
    }

    // Submission result is ready
    if (msg.type === '__LC_PUSHER_RESULT__') {
      const result = msg.result;
      console.log('[LeetSync] Received result:', result?.status_msg);

      if (result?.status_msg === 'Accepted') {
        console.log('[LeetSync] ✅ ACCEPTED — starting GitHub push');
        handleAcceptedResult(result);
      } else {
        const statusMsg = result?.status_msg || 'Unknown';
        console.log('[LeetSync] ❌ Not accepted:', statusMsg);
        if (statusMsg === 'Wrong Answer') {
          showToast('HAHHAHAHAA Fool TRY AGAIN 🤡', 'error', 5000);
        } else {
          showToast(`Submission: ${statusMsg}. Not pushing to GitHub.`, 'warning');
        }
      }
    }
  });

  // ── Initialization ─────────────────────────────────────────

  function init() {
    if (!isExtensionContextValid()) {
      console.warn('[LeetSync] Extension context invalid on init — skipping setup.');
      showRefreshBanner();
      return;
    }

    chrome.storage.sync.get(['githubToken', 'githubRepo'], (settings) => {
      if (chrome.runtime.lastError || !settings.githubToken || !settings.githubRepo) {
        console.log('[LeetSync] Not configured — click the extension icon to set up.');
        return;
      }

      isConfigured = true;
      console.log('[LeetSync] ✅ Configured and active. Listening for accepted submissions.');
    });
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
