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
  const INJECTOR_VERSION = 4;
  if (window.__lcPusherVersion >= INJECTOR_VERSION) return;
  window.__lcPusherVersion = INJECTOR_VERSION;

  console.log(`[LeetSync] Main world interceptor v${INJECTOR_VERSION} loaded`);

  // ── Simple flag: was the last action a REAL Submit? ──────────
  // Set to true when /submit/ is called, false when result is processed.
  // This is simpler and more robust than trying to match submission IDs.
  window.__lcIsRealSubmit = false;

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
            console.log('[LeetSync] ✦ SUBMIT detected, ID:', data.submission_id);
            window.__lcIsRealSubmit = true;
            window.postMessage({
              type: '__LC_PUSHER_SUBMISSION__',
              submissionId: data.submission_id,
            }, '*');
          }
        }).catch(() => {});
      }

      // ── Detect Run Code POST → /problems/{slug}/interpret_solution/ ──
      if (url.includes('/problems/') && url.includes('/interpret_solution/')) {
        console.log('[LeetSync] ⊘ Run Code detected — will ignore results');
        window.__lcIsRealSubmit = false;
      }

      // ── Detect check result → /submissions/detail/{id}/check/ ──
      if (url.includes('/submissions/detail/') && url.includes('/check/')) {
        const cloned = response.clone();
        cloned.json().then(data => {
          if (data && data.state === 'SUCCESS') {
            if (window.__lcIsRealSubmit) {
              console.log('[LeetSync] ✦ Real submission result:', data.status_msg);
              window.__lcIsRealSubmit = false; // Reset flag
              window.postMessage({
                type: '__LC_PUSHER_RESULT__',
                result: data,
              }, '*');
            } else {
              console.log('[LeetSync] ⊘ Ignoring result (Run Code, not Submit)');
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

    // Track real submissions
    if (url.includes('/problems/') && url.includes('/submit/')) {
      self.addEventListener('load', function () {
        try {
          const data = JSON.parse(self.responseText);
          if (data && data.submission_id) {
            console.log('[LeetSync] ✦ SUBMIT detected via XHR, ID:', data.submission_id);
            window.__lcIsRealSubmit = true;
            window.postMessage({
              type: '__LC_PUSHER_SUBMISSION__',
              submissionId: data.submission_id,
            }, '*');
          }
        } catch (e) {}
      });
    }

    // Detect Run Code
    if (url.includes('/problems/') && url.includes('/interpret_solution/')) {
      console.log('[LeetSync] ⊘ Run Code detected via XHR');
      window.__lcIsRealSubmit = false;
    }

    // Check results — only forward if real submit
    if (url.includes('/submissions/detail/') && url.includes('/check/')) {
      self.addEventListener('load', function () {
        try {
          const data = JSON.parse(self.responseText);
          if (data && data.state === 'SUCCESS') {
            if (window.__lcIsRealSubmit) {
              console.log('[LeetSync] ✦ Real submission result via XHR:', data.status_msg);
              window.__lcIsRealSubmit = false;
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
