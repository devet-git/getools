#!/usr/bin/env node
/**
 * Sinh phần CSS chế độ tối trong app/globals.css.
 *
 * Giao diện dùng trực tiếp các lớp màu của Tailwind (bg-white, text-slate-700, bg-emerald-50/60, hover:bg-indigo-100,
 * [&_th]:bg-slate-100 ...). Thay vì đảo biến màu (sẽ làm hỏng text-white / header tối), script này QUÉT mã nguồn,
 * tìm mọi lớp màu đang được dùng và sinh quy tắc `.dark ...` tương ứng. Chạy lại khi thêm lớp màu mới:
 *     npm run gen:dark
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const theme = fs.readFileSync(path.join(root, 'node_modules/tailwindcss/theme.css'), 'utf8');
const oklch = (n, s) => { const m = theme.match(new RegExp('--color-' + n + '-' + s + ':\\s*(oklch\\([^)]*\\))')); if (!m) throw new Error('no color ' + n + '-' + s); return m[1]; };
const withAlpha = (c, a) => c.replace(')', ' / ' + (+a.toFixed(3)) + ')');
const mixA = (c, pct) => `color-mix(in oklab, ${c} ${pct}%, transparent)`;

const NEUTRAL = ['slate', 'gray', 'zinc', 'neutral', 'stone'];
const COLORS = ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'];
const SURFACE = 'var(--surface)';

// bảng cho nhóm trung tính (slate/gray/zinc/...)
const N_BG = { 50: '#0a1020', 100: '#162033', 200: '#1f2b40', 300: '#2c3a52', 800: '#2a3750', 900: '#1e293b' };
const N_BORDER = { 100: '#1a2438', 200: '#26334a', 300: '#34435c' };
const N_TEXT = { 500: '#a0aec2', 600: '#b4c0d1', 700: '#cbd5e1', 800: '#e2e8f0', 900: '#f1f5f9', 950: '#f8fafc' };
// nhóm có màu: độ đậm nền/viền (alpha của màu 500) và ánh xạ chữ
const C_BG_A = { 50: 0.10, 100: 0.16, 200: 0.26, 300: 0.35 };
const C_BD_A = { 50: 0.14, 100: 0.2, 200: 0.3, 300: 0.4 };
const C_TEXT = { 500: 400, 600: 400, 700: 300, 800: 200, 900: 200, 950: 200 };

const PROP_KIND = { bg: 'bg', text: 'text', placeholder: 'text', fill: 'text', stroke: 'text', outline: 'text', decoration: 'text', accent: 'text', caret: 'text', border: 'border', divide: 'border', ring: 'border', from: 'bg', via: 'bg', to: 'bg' };

/** Trả về giá trị màu tối (chuỗi CSS) hoặc null nếu giữ nguyên. alpha: 0..1 hoặc null. */
function darkColor(kind, color, shade, alpha) {
  const A = alpha == null ? 1 : alpha;
  if (color === 'white') {
    if (kind === 'text') return null;
    return A === 1 ? SURFACE : mixA(SURFACE, A * 100);
  }
  if (color === 'black') return null;
  if (NEUTRAL.includes(color)) {
    const table = kind === 'bg' ? N_BG : kind === 'border' ? N_BORDER : N_TEXT;
    const v = table[shade];
    if (!v) return null;
    return A === 1 ? v : mixA(v, A * 100);
  }
  if (COLORS.includes(color)) {
    if (kind === 'text') { const s = C_TEXT[shade]; if (!s) return null; const v = oklch(color, s); return A === 1 ? v : mixA(v, A * 100); }
    const a = (kind === 'bg' ? C_BG_A : C_BD_A)[shade];
    if (a == null) return null;
    return withAlpha(oklch(color, 500), a * A);
  }
  return null;
}

function declFor(prop, v, kind) {
  switch (prop) {
    case 'bg': return `background-color:${v}`;
    case 'text': case 'placeholder': return `color:${v}`;
    case 'border': case 'divide': return `border-color:${v}`;
    case 'ring': return `--tw-ring-color:${v}`;
    case 'from': return `--tw-gradient-from:${v}`;
    case 'via': return `--tw-gradient-via:${v}`;
    case 'to': return `--tw-gradient-to:${v}`;
    case 'fill': return `fill:${v}`;
    case 'stroke': return `stroke:${v}`;
    case 'outline': return `outline-color:${v}`;
    case 'decoration': return `text-decoration-color:${v}`;
    case 'accent': return `accent-color:${v}`;
    case 'caret': return `caret-color:${v}`;
  }
  return null;
}

const cssEsc = (s) => s.replace(/[^A-Za-z0-9_-]/g, (c) => '\\' + c);

// ---- phân tích biến thể (variant) của một lớp ----
function splitVariants(prefix) {
  // prefix như "hover:" / "[&_tr:nth-child(even)]:" / "lg:hover:" -> mảng biến thể
  const out = []; let i = 0;
  while (i < prefix.length) {
    if (prefix[i] === '[') { const j = prefix.indexOf(']', i); if (j < 0) return null; out.push(prefix.slice(i, j + 1)); i = j + 1; if (prefix[i] === ':') i++; }
    else { const j = prefix.indexOf(':', i); if (j < 0) return null; out.push(prefix.slice(i, j)); i = j + 1; }
  }
  return out;
}
const PSEUDO = { hover: ':hover', focus: ':focus', 'focus-visible': ':focus-visible', 'focus-within': ':focus-within', active: ':active', disabled: ':disabled', checked: ':checked', first: ':first-child', last: ':last-child', odd: ':nth-child(odd)', even: ':nth-child(even)' };
const unsupported = new Set();

function buildSelector(token, variants) {
  let sel = '.' + cssEsc(token); let group = false; let after = ''; let pseudoEl = '';
  for (const v of variants) {
    if (v === 'dark') return null;
    if (/^(sm|md|lg|xl|2xl)$/.test(v)) return { skip: true };
    if (PSEUDO[v]) { sel += PSEUDO[v]; continue; }
    if (v === 'group-hover') { group = true; continue; }
    if (v === 'placeholder') { pseudoEl = '::placeholder'; continue; }
    if (v === 'file') { pseudoEl = '::file-selector-button'; continue; }
    const m = v.match(/^\[&(.*)\]$/);
    if (m) { after += ' ' + m[1].replace(/_/g, ' ').trim(); continue; }
    unsupported.add(v); return null;
  }
  const core = sel + after + pseudoEl;
  return group ? `.dark .group:hover ${core}` : `.dark ${core}`;
}

// ---- quét mã nguồn ----
function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'applet') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc); else if (/\.(tsx|ts|jsx|js|css)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const files = ['app', 'components', 'lib'].flatMap((d) => walk(path.join(root, d), []));
const PROPS = Object.keys(PROP_KIND).join('|');
const ALLC = [...NEUTRAL, ...COLORS].join('|');
const TOKEN = new RegExp(`^((?:\\[[^\\]]+\\]:|[a-z0-9-]+:)*)(${PROPS})-((?:${ALLC})-\\d{2,3}|white|black)(?:/(\\d{1,3}))?$`);

const found = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (let chunk of src.split(/[\s"'`{}<>]+/)) {
    chunk = chunk.replace(/[,;]+$/, '');
    if (chunk.length < 5 || chunk.length > 90 || !chunk.includes('-')) continue;
    if (TOKEN.test(chunk.replace(/^!|!$/g, ''))) found.add(chunk);
  }
}
// bộ cơ sở: mọi thang màu (không alpha) kèm hover/focus để bắt cả lớp ghép động như `bg-${c}-100`
for (const prop of ['bg', 'text', 'border']) {
  for (const c of [...NEUTRAL, ...COLORS]) {
    for (const s of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
      for (const v of ['', 'hover:', 'focus:']) found.add(`${v}${prop}-${c}-${s}`);
    }
  }
}
for (const v of ['', 'hover:', 'focus:']) for (const p of ['bg', 'border']) found.add(`${v}${p}-white`);

// màu chữ viết tay (text-[#rrggbb]) quá tối thì làm sáng lên (vd. liên kết xanh đậm kiểu Google/Slack trong khung xem trước)
const relLum = (hex) => { const h = hex.slice(1); const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const arbitraryText = new Set();
for (const f of files) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?<![\w\-:])text-\[(#[0-9a-fA-F]{6})\]/g)) if (relLum(m[1]) < 0.2) arbitraryText.add(m[1].toLowerCase());
}

const rules = new Map();
for (const hex of arbitraryText) {
  const sel = `.dark .${cssEsc('text-[' + hex + ']')}`;
  rules.set(sel, `${sel}{color:color-mix(in oklab, ${hex} 38%, white)}`);
}
for (const token of [...found].sort()) {
  const important = /^!|!$/.test(token);
  const m = token.replace(/^!|!$/g, '').match(TOKEN); if (!m) continue;
  const variants = splitVariants(m[1]); if (!variants) continue;
  const [, , prop, colorSpec, alphaStr] = m;
  const [color, shade] = colorSpec.includes('-') ? [colorSpec.replace(/-\d+$/, ''), +colorSpec.match(/-(\d+)$/)[1]] : [colorSpec, 0];
  const kind = PROP_KIND[prop];
  const v = darkColor(kind, color, shade, alphaStr ? +alphaStr / 100 : null);
  if (!v) continue;
  let decl = declFor(prop, v, kind); if (!decl) continue;
  if (important) decl += ' !important';
  const sel = buildSelector(token, variants);
  if (!sel || sel.skip) continue;
  let full = sel;
  if (prop === 'divide') full = sel.replace(/(\.[^ ]+)(?=$| )/, '$1>:not(:last-child)');
  rules.set(full + '|' + decl, `${full}{${decl}}`);
}

const header = `/* ===== Dark mode (TỰ SINH bởi scripts/gen-dark-theme.js — đừng sửa tay; chạy: npm run gen:dark) =====
   Quét mọi lớp màu Tailwind đang dùng trong mã nguồn và ghi đè khi có class .dark trên <html>.
   Không đảo biến màu để giữ nguyên text-white / header tối. */`;
const statics = `.dark { color-scheme: dark; --surface: #0f172a; }
.dark body { background-color: #0a1020; }
.dark ::selection { background: rgb(99 102 241 / 0.4); }
.dark input::placeholder, .dark textarea::placeholder { color: #64748b; }
.dark { --color-slate-50: #0a1020; ${COLORS.map((c) => `--color-${c}-50: ${withAlpha(oklch(c, 500), 0.1)};`).join(' ')} }`;
const body = [...rules.values()].join('\n');
const out = `\n${header}\n${statics}\n${body}\n`;

const cssPath = path.join(root, 'app/globals.css');
let css = fs.readFileSync(cssPath, 'utf8');
const start = css.indexOf('/* ===== Dark mode');
if (start < 0) throw new Error('Không thấy mốc "/* ===== Dark mode" trong app/globals.css');
css = css.slice(0, start).replace(/\s+$/, '\n') + out;
fs.writeFileSync(cssPath, css);
console.log(`gen-dark-theme: ${files.length} file, ${found.size} lớp màu -> ${rules.size} quy tắc`);
if (unsupported.size) console.log('Biến thể chưa hỗ trợ (bỏ qua):', [...unsupported].join(', '));
