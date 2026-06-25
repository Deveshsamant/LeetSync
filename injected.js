/* ============================================================
   injected.js — Runs in the PAGE's MAIN world (not isolated)
   
   This script intercepts the page's actual fetch/XHR calls
   to detect LeetCode submission events, and relays them
   to the content script via window.postMessage.
   
   IMPORTANT: Only /submit/ triggers a push. /interpret_solution/
   (Run Code) is intentionally ignored to prevent false pushes.
   ============================================================ */

(function () {
  'use strict';

  // Version-based guard: allows re-injection when extension updates
  const INJECTOR_VERSION = 3;
  if (window.__lcPusherVersion >= INJECTOR_VERSION) return;
  window.__lcPusherVersion = INJECTOR_VERSION;

  console.log(`[LeetSync] Main world interceptor v${INJECTOR_VERSION} loaded`);

  // ── Track pending REAL submissions ──────────────────────────
  // Only submission IDs from /submit/ are tracked.
  // /interpret_solution/ (Run Code) IDs are NOT tracked.
  // Stored on window so it persists across re-injections.
  if (!window.__lcPendingSubmissions) {
    window.__lcPendingSubmissions = new Set();
  }
  const pendingSubmissions = window.__lcPendingSubmissions;

  // Save the true original only once (survives re-injection)
  if (!window.__lcOriginalFetch) {
    window.__lcOriginalFetch = window.fetch;
  }
  const originalFetch = window.__lcOriginalFetch;

  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');

      // ── Detect REAL submission POST → /problems/{slug}/submit/ ──
      if (url.includes('/problems/') && url.includes('/submit/')) {
        const cloned = response.clone();
        cloned.json().then(data => {
          if (data && data.submission_id) {
            const sid = parseInt(data.submission_id, 10);
            console.log('[LeetSync] ✦ Real SUBMIT detected, ID:', sid);
            pendingSubmissions.add(sid);
            window.postMessage({
              type: '__LC_PUSHER_SUBMISSION__',
              submissionId: sid,
            }, '*');
          }
        }).catch(() => {});
      }

      // ── Detect submission check result → /submissions/detail/{id}/check/ ──
      if (url.includes('/submissions/detail/') && url.includes('/check/')) {
        // Extract submission ID from the URL (response body may not have it)
        const urlIdMatch = url.match(/\/submissions\/detail\/(\d+)\/check/);
        const urlSubId = urlIdMatch ? parseInt(urlIdMatch[1], 10) : null;

        const cloned = response.clone();
        cloned.json().then(data => {
          if (data && data.state === 'SUCCESS') {
            // Try: URL ID, response body ID, or response body submission_id
            const subId = urlSubId || data.submission_id || data.id;

            // ONLY process if this is a REAL submission (not Run Code)
            if (subId && pendingSubmissions.has(subId)) {
              console.log('[LeetSync] ✦ Real submission result:', data.status_msg, '(ID:', subId, ')');
              pendingSubmissions.delete(subId);
              // Attach the submission_id to the result data for content.js
              data.submission_id = subId;
              window.postMessage({
                type: '__LC_PUSHER_RESULT__',
                result: data,
              }, '*');
            } else {
              console.log('[LeetSync] ⊘ Ignoring non-submit result (ID:', subId, 'pending:', [...pendingSubmissions], ')');
            }
          }
        }).catch(() => {});
      }
    } catch (e) {
      // Silently ignore — don't break LeetCode
    }

    return response;
  };

  // ── Intercept XMLHttpRequest (fallback) ──────────────────
  if (!window.__lcOriginalXHROpen) {
    window.__lcOriginalXHROpen = XMLHttpRequest.prototype.open;
    window.__lcOriginalXHRSend = XMLHttpRequest.prototype.send;
  }
  const originalOpen = window.__lcOriginalXHROpen;
  const originalSend = window.__lcOriginalXHRSend;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__lcUrl = url;
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    const self = this;
    const url = self.__lcUrl || '';

    // ── Only track REAL submissions ──
    if (url.includes('/problems/') && url.includes('/submit/')) {
      self.addEventListener('load', function () {
        try {
          const data = JSON.parse(self.responseText);
          if (data && data.submission_id) {
            const sid = parseInt(data.submission_id, 10);
            console.log('[LeetSync] ✦ Real SUBMIT detected via XHR, ID:', sid);
            pendingSubmissions.add(sid);
            window.postMessage({
              type: '__LC_PUSHER_SUBMISSION__',
              submissionId: data.submission_id,
            }, '*');
          }
        } catch (e) {}
      });
    }

    // ── Only relay check results for REAL submissions ──
    if (url.includes('/submissions/detail/') && url.includes('/check/')) {
      const xhrUrlMatch = url.match(/\/submissions\/detail\/(\d+)\/check/);
      const xhrSubId = xhrUrlMatch ? parseInt(xhrUrlMatch[1], 10) : null;

      self.addEventListener('load', function () {
        try {
          const data = JSON.parse(self.responseText);
          if (data && data.state === 'SUCCESS') {
            const subId = xhrSubId || data.submission_id || data.id;
            if (subId && pendingSubmissions.has(subId)) {
              console.log('[LeetSync] ✦ Real submission result via XHR:', data.status_msg);
              pendingSubmissions.delete(subId);
              data.submission_id = subId;
              window.postMessage({
                type: '__LC_PUSHER_RESULT__',
                result: data,
              }, '*');
            } else {
              console.log('[LeetSync] ⊘ Ignoring non-submit result via XHR');
            }
          }
        } catch (e) {}
      });
    }

    return originalSend.apply(this, args);
  };

  console.log('[LeetSync] Fetch & XHR interceptors active (Submit only — Run Code ignored)');
})();
