// Xuất Markdown -> tài liệu HTML độc lập (an toàn, không render HTML thô).
// Render qua react-dom/server để khớp với phần xem trước (react-markdown + remark-gfm).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Lấy tiêu đề từ heading đầu tiên (bỏ qua code fence), mặc định "Tài liệu Markdown". */
export function extractTitle(markdown: string, fallback = 'Tài liệu Markdown'): string {
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      const t = m[1]
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`~]/g, '')
        .trim();
      if (t) return t.slice(0, 120);
    }
  }
  return fallback;
}

/** Render phần thân (fragment HTML) từ Markdown. HTML thô trong Markdown bị bỏ qua/escape. */
export function markdownToHtmlBody(markdown: string): string {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, markdown),
  );
}

export const EXPORT_CSS = `
:root{color-scheme:light dark;--fg:#1e293b;--bg:#ffffff;--muted:#64748b;--line:#e2e8f0;--soft:#f1f5f9;--accent:#4f46e5;--code:#0f172a;--codefg:#f1f5f9}
@media (prefers-color-scheme:dark){:root{--fg:#e2e8f0;--bg:#0f172a;--muted:#94a3b8;--line:#334155;--soft:#1e293b;--accent:#818cf8;--code:#020617;--codefg:#e2e8f0}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:820px;margin:0 auto;padding:32px 20px 64px;overflow-wrap:break-word}
h1,h2,h3,h4,h5,h6{line-height:1.3;margin:1.6em 0 .6em;font-weight:700}
h1{font-size:2em;border-bottom:1px solid var(--line);padding-bottom:.3em;margin-top:0}
h2{font-size:1.5em;border-bottom:1px solid var(--line);padding-bottom:.25em}
h3{font-size:1.25em}h4{font-size:1.1em}h5,h6{font-size:1em;color:var(--muted)}
p,ul,ol,blockquote,pre,table{margin:0 0 1em}
a{color:var(--accent)}
ul,ol{padding-left:1.6em}
li>ul,li>ol{margin:.25em 0}
ul.contains-task-list{list-style:none;padding-left:.4em}
li.task-list-item input{margin-right:.5em}
blockquote{margin-left:0;padding:.1em 1em;border-left:4px solid var(--accent);color:var(--muted);background:var(--soft);border-radius:0 6px 6px 0}
code{font:.9em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--soft);padding:.15em .4em;border-radius:4px}
pre{background:var(--code);color:var(--codefg);padding:14px 16px;border-radius:8px;overflow:auto}
pre code{background:none;padding:0;color:inherit;font-size:.88em}
table{border-collapse:collapse;display:block;overflow:auto;max-width:100%}
th,td{border:1px solid var(--line);padding:6px 12px}
th{background:var(--soft);font-weight:700}
tr:nth-child(even) td{background:color-mix(in srgb,var(--soft) 50%,transparent)}
hr{border:0;border-top:1px solid var(--line);margin:2em 0}
img{max-width:100%;height:auto}
del{color:var(--muted)}
@media print{:root{--fg:#111;--bg:#fff;--muted:#555;--line:#ccc;--soft:#f3f4f6;--code:#f3f4f6;--codefg:#111}main{max-width:none;padding:0}pre{white-space:pre-wrap}}
`.trim();

export interface ExportOptions {
  title?: string;
  lang?: string;
}

/** Chuyển Markdown thành tài liệu HTML đầy đủ (doctype, CSS nhúng, không script). */
export function markdownToStandaloneHtml(markdown: string, options: ExportOptions = {}): string {
  const title = escapeHtml(options.title?.trim() || extractTitle(markdown));
  const lang = escapeHtml(options.lang || 'vi');
  const body = markdownToHtmlBody(markdown);
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${EXPORT_CSS}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}
