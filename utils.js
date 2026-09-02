/* ============================================================
   utils.js — helpers for the LeetCode content script.

   Only what content.js actually calls lives here. README and SVG generation
   belongs to readme.js, which background.js loads; copies of it previously
   sat in this file too, went stale after the redesign, and shipped to every
   LeetCode page for nothing.
   ============================================================ */
/**
 * Maps LeetCode language identifiers to file extensions.
 */
const LANGUAGE_MAP = {
  'python':      { ext: '.py',     name: 'Python'     },
  'python3':     { ext: '.py',     name: 'Python'     },
  'c':           { ext: '.c',      name: 'C'          },
  'cpp':         { ext: '.cpp',    name: 'C++'        },
  'java':        { ext: '.java',   name: 'Java'       },
  'javascript':  { ext: '.js',     name: 'JavaScript' },
  'typescript':  { ext: '.ts',     name: 'TypeScript' },
  'csharp':      { ext: '.cs',     name: 'C#'         },
  'go':          { ext: '.go',     name: 'Go'         },
  'golang':      { ext: '.go',     name: 'Go'         },
  'ruby':        { ext: '.rb',     name: 'Ruby'       },
  'swift':       { ext: '.swift',  name: 'Swift'      },
  'kotlin':      { ext: '.kt',    name: 'Kotlin'     },
  'scala':       { ext: '.scala',  name: 'Scala'      },
  'rust':        { ext: '.rs',     name: 'Rust'       },
  'php':         { ext: '.php',    name: 'PHP'        },
  'dart':        { ext: '.dart',   name: 'Dart'       },
  'racket':      { ext: '.rkt',    name: 'Racket'     },
  'erlang':      { ext: '.erl',    name: 'Erlang'     },
  'elixir':      { ext: '.ex',     name: 'Elixir'     },
  'mysql':       { ext: '.sql',    name: 'MySQL'      },
  'mssql':       { ext: '.sql',    name: 'MS SQL'     },
  'oraclesql':   { ext: '.sql',    name: 'Oracle SQL' },
  'postgresql':  { ext: '.sql',    name: 'PostgreSQL' },
  'pandas':      { ext: '.py',     name: 'Pandas'     },
};

/**
 * Get file extension for a LeetCode language slug.
 * @param {string} lang - Language slug from LeetCode (e.g., 'python3', 'cpp')
 * @returns {{ ext: string, name: string }}
 */
function getLanguageInfo(lang) {
  const key = lang.toLowerCase().replace(/\s+/g, '');
  return LANGUAGE_MAP[key] || { ext: '.txt', name: lang };
}

/**
 * Simple HTML to Markdown converter.
 * Handles the most common HTML elements found in LeetCode problem descriptions.
 * @param {string} html
 * @returns {string}
 */
function htmlToMarkdown(html) {
  if (!html) return '';

  let md = html;

  // Remove <style> and <script> blocks
  md = md.replace(/<style[\s\S]*?<\/style>/gi, '');
  md = md.replace(/<script[\s\S]*?<\/script>/gi, '');

  // Convert headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n');

  // Convert bold and italic
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');

  // Convert code blocks
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```\n\n');
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '```\n$1\n```\n\n');
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // Convert superscript (common in constraints like 10^4)
  md = md.replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, '^$1');

  // Convert subscript
  md = md.replace(/<sub[^>]*>([\s\S]*?)<\/sub>/gi, '_$1');

  // Convert lists
  md = md.replace(/<ul[^>]*>/gi, '\n');
  md = md.replace(/<\/ul>/gi, '\n');
  md = md.replace(/<ol[^>]*>/gi, '\n');
  md = md.replace(/<\/ol>/gi, '\n');
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');

  // Convert paragraphs and line breaks
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '$1\n');

  // Convert links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Convert images
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');

  // Remove remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, ' ');
  md = md.replace(/&le;/g, '≤');
  md = md.replace(/&ge;/g, '≥');
  md = md.replace(/&ne;/g, '≠');
  md = md.replace(/&times;/g, '×');
  md = md.replace(/&divide;/g, '÷');
  md = md.replace(/&minus;/g, '−');
  md = md.replace(/&plusmn;/g, '±');
  md = md.replace(/&infin;/g, '∞');
  md = md.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code));

  // Clean up excessive whitespace
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();

  return md;
}
