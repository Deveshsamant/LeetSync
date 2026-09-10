/* ============================================================
   token-kind.js — which sort of GitHub credential this is.

   GitHub gives every token it issues a fixed prefix, so the kinds can be told
   apart locally and instantly: no request, and before one is even possible.

   That matters for one reason. Only a classic token may create a repository —
   GitHub's create endpoint takes classic and OAuth tokens and refuses
   fine-grained ones with a 403. Reading the prefix turns that from a round
   trip ending in an error into something the interface can say up front.

   Loaded by both the popup and the service worker, which is why it is its own
   file rather than a copy in each.
   ============================================================ */

(function (root) {
  'use strict';

  const PREFIXES = [
    ['github_pat_', 'fine-grained'],
    ['ghp_', 'classic'],
    ['gho_', 'oauth'],
  ];

  /**
   * 'classic' | 'fine-grained' | 'oauth' | 'unknown'
   *
   * 'unknown' covers the tokens GitHub issued before it prefixed them, and
   * anything it starts issuing next. Every caller treats it as "try it and
   * see" rather than refusing it — guessing wrong must not lock somebody out
   * of their own repository.
   */
  function of(token) {
    const value = String(token || '').trim();
    for (const [prefix, kind] of PREFIXES) {
      if (value.startsWith(prefix)) return kind;
    }
    return 'unknown';
  }

  /** False only where we are certain: a fine-grained token cannot create one. */
  function canCreateRepo(token) {
    return of(token) !== 'fine-grained';
  }

  /** One line for the setup screen, or null when there is nothing useful to say. */
  function describe(token) {
    switch (of(token)) {
      case 'classic':
        return { kind: 'classic', text: 'Classic token — it can create the repository for you.' };
      case 'fine-grained':
        return {
          kind: 'fine-grained',
          text: 'Fine-grained token — safer, but GitHub does not let it create a '
            + 'repository. If yours does not exist yet, LeetSync will open GitHub '
            + 'so you can make it, then adopt it.',
        };
      case 'oauth':
        return { kind: 'oauth', text: 'OAuth token — it can create the repository for you.' };
      default:
        return null;
    }
  }

  const TokenKind = { of, canCreateRepo, describe };

  root.TokenKind = TokenKind;
  if (typeof module !== 'undefined' && module.exports) module.exports = { TokenKind };
}(typeof self !== 'undefined' ? self : globalThis));
