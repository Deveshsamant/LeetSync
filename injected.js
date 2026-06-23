/* ============================================================
   injected.js — Runs in the PAGE's MAIN world (not isolated)
   
   This script intercepts the page's actual fetch/XHR calls
   to detect LeetCode submission events, and relays them
   to the content script via window.postMessage.
   ============================================================ */

(function () {
  'use strict';

  if (window.__lcPusherInjected) return;
  window.__lcPusherInjected = true;

  console.log('[LeetSync] Main world interceptor loaded');

  // Save the true original only once (survives re-injection)
  if (!window.__lcOriginalFetch) {
    window.__lcOriginalFetch = window.fetch;
  }
  const originalFetch = window.__lcOriginalFetch;

  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');

      // Detect submission POST → /problems/{slug}/submit/
      if (url.includes('/problems/') && url.includes('/submit/')) {
        const cloned = response.clone();
        cloned.json().then(data => {
          if (data && data.submission_id) {
            console.log('[LeetCode Pusher] ✦ Submission detected via fetch, ID:', data.submission_id);
            window.postMessage({
              type: '__LC_PUSHER_SUBMISSION__',
              submissionId: data.submission_id,
            }, '*');
          }
        }).catch(() => {});
      }

      // Detect submission check result → /submissions/detail/{id}/check/
      if (url.includes('/submissions/detail/') && url.includes('/check/')) {
        const cloned = response.clone();
        cloned.json().then(data => {
          if (data && data.state === 'SUCCESS') {
            console.log('[LeetCode Pusher] ✦ Submission result via fetch:', data.status_msg);
            window.postMessage({
              type: '__LC_PUSHER_RESULT__',
              result: data,
            }, '*');
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

    if (url.includes('/problems/') && url.includes('/submit/')) {
      self.addEventListener('load', function () {
        try {
          const data = JSON.parse(self.responseText);
          if (data && data.submission_id) {
            console.log('[LeetCode Pusher] ✦ Submission detected via XHR, ID:', data.submission_id);
            window.postMessage({
              type: '__LC_PUSHER_SUBMISSION__',
              submissionId: data.submission_id,
            }, '*');
          }
        } catch (e) {}
      });
    }

    if (url.includes('/submissions/detail/') && url.includes('/check/')) {
      self.addEventListener('load', function () {
        try {
          const data = JSON.parse(self.responseText);
          if (data && data.state === 'SUCCESS') {
            console.log('[LeetCode Pusher] ✦ Submission result via XHR:', data.status_msg);
            window.postMessage({
              type: '__LC_PUSHER_RESULT__',
              result: data,
            }, '*');
          }
        } catch (e) {}
      });
    }

    return originalSend.apply(this, args);
  };

  console.log('[LeetSync] Fetch & XHR interceptors active in MAIN world');
})();
