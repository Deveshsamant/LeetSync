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

  if (window.__lcPusherInjected) return;
  window.__lcPusherInjected = true;

  console.log('[LeetSync] Main world interceptor loaded');

  // ── Track pending REAL submissions ──────────────────────────
  // Only submission IDs from /submit/ are tracked.
  // /interpret_solution/ (Run Code) IDs are NOT tracked.
  const pendingSubmissions = new Set();

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
            console.log('[LeetSync] ✦ Real SUBMIT detected, ID:', data.submission_id);
            pendingSubmissions.add(data.submission_id);
            window.postMessage({
              type: '__LC_PUSHER_SUBMISSION__',
              submissionId: data.submission_id,
            }, '*');
          }
        }).catch(() => {});
      }

      // ── Detect submission check result → /submissions/detail/{id}/check/ ──
      if (url.includes('/submissions/detail/') && url.includes('/check/')) {
        const cloned = response.clone();
        cloned.json().then(data => {
          if (data && data.state === 'SUCCESS') {
            const subId = data.submission_id;

            // ONLY process if this is a REAL submission (not Run Code)
            if (subId && pendingSubmissions.has(subId)) {
              console.log('[LeetSync] ✦ Real submission result:', data.status_msg, '(ID:', subId, ')');
              pendingSubmissions.delete(subId); // Clean up
              window.postMessage({
                type: '__LC_PUSHER_RESULT__',
                result: data,
              }, '*');
            } else {
              // This is from Run Code / interpret_solution — ignore silently
              console.log('[LeetSync] ⊘ Ignoring Run Code result (not a real submit)');
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
            console.log('[LeetSync] ✦ Real SUBMIT detected via XHR, ID:', data.submission_id);
            pendingSubmissions.add(data.submission_id);
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
      self.addEventListener('load', function () {
        try {
          const data = JSON.parse(self.responseText);
          if (data && data.state === 'SUCCESS') {
            const subId = data.submission_id;
            if (subId && pendingSubmissions.has(subId)) {
              console.log('[LeetSync] ✦ Real submission result via XHR:', data.status_msg);
              pendingSubmissions.delete(subId);
              window.postMessage({
                type: '__LC_PUSHER_RESULT__',
                result: data,
              }, '*');
            } else {
              console.log('[LeetSync] ⊘ Ignoring Run Code result via XHR');
            }
          }
        } catch (e) {}
      });
    }

    return originalSend.apply(this, args);
  };

  console.log('[LeetSync] Fetch & XHR interceptors active (Submit only — Run Code ignored)');
})();
