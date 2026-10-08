/**
 * CSS tools: Flexbox / Grid generator, clamp() fluid, đổi đơn vị, shadow builder, specificity.
 * Thuần logic (không React). Mọi hàm không ném lỗi với dữ liệu sai: trả về lỗi/giá trị an toàn.
 */

export type Decl = [prop: string, value: string];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Định dạng số gọn: tối đa `prec` chữ số thập phân, bỏ số 0 thừa, tránh "-0". */
export function fmtNum(n: number, prec = 4): string {
  if (!Number.isFinite(n)) return '0';
  const s = n.toFixed(prec);
  const t = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  return t === '-0' ? '0' : t;
}

export function declsToCss(selector: string, decls: Decl[], indent = '  '): string {
  if (decls.length === 0) return `${selector} {\n}`;
  return `${selector} {\n${decls.map(([p, v]) => `${indent}${p}: ${v};`).join('\n')}\n}`;
}

/** Chuyển `[prop, value]` thành object style React (camelCase; giữ nguyên custom property). */
export function declsToStyle(decls: Decl[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [p, v] of decls) {
    const key = p.startsWith('--') ? p : p.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    o[key] = v;
  }
  return o;
}

/** Giá trị cho class Tailwind arbitrary: khoảng trắng -> "_". */
export const twArb = (v: string) => v.replace(/\s+/g, '_');

/* ------------------------------------------------------------------ */
/* FLEXBOX                                                             */
/* ------------------------------------------------------------------ */

export type FlexDirection = 'row' | 'row-reverse' | 'column' | 'column-reverse';
export type FlexWrap = 'nowrap' | 'wrap' | 'wrap-reverse';
export type FlexJustify = 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
export type FlexAlignItems = 'stretch' | 'flex-start' | 'flex-end' | 'center' | 'baseline';
export type FlexAlignContent = 'normal' | 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly' | 'stretch';
export type FlexAlignSelf = 'auto' | 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch';

export interface FlexContainer {
  direction: FlexDirection;
  wrap: FlexWrap;
  justify: FlexJustify;
  alignItems: FlexAlignItems;
  alignContent: FlexAlignContent;
  rowGap: number;
  colGap: number;
  width: string; // 'auto' | '100%' | '400px' ...
  height: string;
}

export interface FlexItem {
  id: number;
  grow: number;
  shrink: number;
  basis: string; // 'auto' | '120px' | '30%' ...
  alignSelf: FlexAlignSelf;
  order: number;
  width: string; // 'auto' | '80px'
  height: string;
}

export const DEFAULT_FLEX_CONTAINER: FlexContainer = {
  direction: 'row',
  wrap: 'nowrap',
  justify: 'flex-start',
  alignItems: 'stretch',
  alignContent: 'normal',
  rowGap: 8,
  colGap: 8,
  width: '100%',
  height: '220px',
};

export function newFlexItem(id: number): FlexItem {
  return { id, grow: 0, shrink: 1, basis: 'auto', alignSelf: 'auto', order: 0, width: '80px', height: 'auto' };
}

/** Chỉ chấp nhận độ dài CSS đơn giản; không hợp lệ -> fallback. */
export function sanitizeLength(v: string, fallback: string, allowAuto = true): string {
  const s = (v ?? '').trim().toLowerCase();
  if (allowAuto && s === 'auto') return 'auto';
  if (/^-?(\d+\.?\d*|\.\d+)(px|%|rem|em|vw|vh|ch|vmin|vmax)$/.test(s)) return s;
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(s) && Number(s) === 0) return '0';
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return `${s}px`;
  return fallback;
}

const finite = (n: number, d = 0) => (Number.isFinite(n) ? n : d);

export function flexContainerDecls(c: FlexContainer): Decl[] {
  const d: Decl[] = [['display', 'flex']];
  if (c.direction !== 'row') d.push(['flex-direction', c.direction]);
  if (c.wrap !== 'nowrap') d.push(['flex-wrap', c.wrap]);
  if (c.justify !== 'flex-start') d.push(['justify-content', c.justify]);
  if (c.alignItems !== 'stretch') d.push(['align-items', c.alignItems]);
  if (c.alignContent !== 'normal') d.push(['align-content', c.alignContent]);
  const rg = Math.max(0, finite(c.rowGap));
  const cg = Math.max(0, finite(c.colGap));
  if (rg === cg) {
    if (rg > 0) d.push(['gap', `${fmtNum(rg)}px`]);
  } else {
    d.push(['gap', `${rg ? fmtNum(rg) + 'px' : '0'} ${cg ? fmtNum(cg) + 'px' : '0'}`]);
  }
  const w = sanitizeLength(c.width, 'auto');
  const h = sanitizeLength(c.height, 'auto');
  if (w !== 'auto') d.push(['width', w]);
  if (h !== 'auto') d.push(['height', h]);
  return d;
}

export function flexItemDecls(it: FlexItem): Decl[] {
  const d: Decl[] = [];
  const grow = Math.max(0, finite(it.grow));
  const shrink = Math.max(0, finite(it.shrink, 1));
  const basis = sanitizeLength(it.basis, 'auto');
  if (grow !== 0 || shrink !== 1 || basis !== 'auto') {
    d.push(['flex', `${fmtNum(grow)} ${fmtNum(shrink)} ${basis}`]);
  }
  if (it.alignSelf !== 'auto') d.push(['align-self', it.alignSelf]);
  const order = Math.trunc(finite(it.order));
  if (order !== 0) d.push(['order', String(order)]);
  const w = sanitizeLength(it.width, 'auto');
  const h = sanitizeLength(it.height, 'auto');
  if (w !== 'auto') d.push(['width', w]);
  if (h !== 'auto') d.push(['height', h]);
  return d;
}

export function flexCss(c: FlexContainer, items: FlexItem[]): string {
  const parts = [declsToCss('.container', flexContainerDecls(c))];
  items.forEach((it, i) => {
    const decls = flexItemDecls(it);
    if (decls.length) parts.push(declsToCss(`.item-${i + 1}`, decls));
  });
  return parts.join('\n\n');
}

const TW_JUSTIFY: Record<string, string> = {
  'flex-start': 'justify-start',
  'flex-end': 'justify-end',
  center: 'justify-center',
  'space-between': 'justify-between',
  'space-around': 'justify-around',
  'space-evenly': 'justify-evenly',
  start: 'justify-start',
  end: 'justify-end',
  stretch: 'justify-stretch',
};
const TW_ITEMS: Record<string, string> = {
  'flex-start': 'items-start',
  'flex-end': 'items-end',
  center: 'items-center',
  baseline: 'items-baseline',
  stretch: 'items-stretch',
  start: 'items-start',
  end: 'items-end',
};
const TW_CONTENT: Record<string, string> = {
  'flex-start': 'content-start',
  'flex-end': 'content-end',
  center: 'content-center',
  'space-between': 'content-between',
  'space-around': 'content-around',
  'space-evenly': 'content-evenly',
  stretch: 'content-stretch',
  start: 'content-start',
  end: 'content-end',
};
const TW_SELF: Record<string, string> = {
  'flex-start': 'self-start',
  'flex-end': 'self-end',
  center: 'self-center',
  baseline: 'self-baseline',
  stretch: 'self-stretch',
};

function twSize(prefix: string, v: string): string {
  const s = sanitizeLength(v, 'auto');
  if (s === 'auto') return '';
  if (s === '100%') return `${prefix}-full`;
  return `${prefix}-[${twArb(s)}]`;
}

function twGap(rg: number, cg: number): string[] {
  const r = Math.max(0, finite(rg));
  const c = Math.max(0, finite(cg));
  if (r === 0 && c === 0) return [];
  if (r === c) return [`gap-[${fmtNum(r)}px]`];
  return [`gap-x-[${fmtNum(c)}px]`, `gap-y-[${fmtNum(r)}px]`];
}

export function flexContainerTailwind(c: FlexContainer): string {
  const k = ['flex'];
  if (c.direction !== 'row') k.push(`flex-${c.direction === 'column' ? 'col' : c.direction === 'column-reverse' ? 'col-reverse' : 'row-reverse'}`);
  if (c.wrap === 'wrap') k.push('flex-wrap');
  if (c.wrap === 'wrap-reverse') k.push('flex-wrap-reverse');
  if (c.justify !== 'flex-start') k.push(TW_JUSTIFY[c.justify]);
  if (c.alignItems !== 'stretch') k.push(TW_ITEMS[c.alignItems]);
  if (c.alignContent !== 'normal') k.push(TW_CONTENT[c.alignContent]);
  k.push(...twGap(c.rowGap, c.colGap));
  const w = twSize('w', c.width);
  const h = twSize('h', c.height);
  if (w) k.push(w);
  if (h) k.push(h);
  return k.filter(Boolean).join(' ');
}

export function flexItemTailwind(it: FlexItem): string {
  const k: string[] = [];
  const grow = Math.max(0, finite(it.grow));
  const shrink = Math.max(0, finite(it.shrink, 1));
  if (grow === 1) k.push('grow');
  else if (grow !== 0) k.push(`grow-[${fmtNum(grow)}]`);
  if (shrink === 0) k.push('shrink-0');
  else if (shrink !== 1) k.push(`shrink-[${fmtNum(shrink)}]`);
  const basis = sanitizeLength(it.basis, 'auto');
  if (basis !== 'auto') k.push(basis === '100%' ? 'basis-full' : `basis-[${twArb(basis)}]`);
  if (it.alignSelf !== 'auto') k.push(TW_SELF[it.alignSelf]);
  const order = Math.trunc(finite(it.order));
  if (order !== 0) k.push(`order-[${order}]`);
  const w = twSize('w', it.width);
  const h = twSize('h', it.height);
  if (w) k.push(w);
  if (h) k.push(h);
  return k.join(' ');
}

export function flexTailwind(c: FlexContainer, items: FlexItem[]): string {
  const lines = [`Container: ${flexContainerTailwind(c)}`];
  items.forEach((it, i) => {
    const t = flexItemTailwind(it);
    if (t) lines.push(`Item ${i + 1}: ${t}`);
  });
  return lines.join('\n');
}

export function flexHtml(c: FlexContainer, items: FlexItem[]): string {
  void c;
  return `<div class="container">\n${items.map((_, i) => `  <div class="item-${i + 1}">${i + 1}</div>`).join('\n')}\n</div>`;
}

/* ------------------------------------------------------------------ */
/* GRID                                                                */
/* ------------------------------------------------------------------ */

export type TrackKind = 'fr' | 'px' | '%' | 'auto' | 'min-content' | 'max-content' | 'minmax' | 'repeat';

export interface Track {
  kind: TrackKind;
  v: number; // fr/px/%
  min: string; // minmax / repeat
  max: string;
  rep: string; // 'auto-fit' | 'auto-fill' | số lần lặp
}

export const newTrack = (kind: TrackKind = 'fr', v = 1): Track => ({ kind, v, min: '100px', max: '1fr', rep: 'auto-fit' });

const SIZE_RE = /^(auto|min-content|max-content|0|(\d+\.?\d*|\.\d+)(px|%|fr|rem|em|vw|vh|ch)?|fit-content\(\s*(\d+\.?\d*|\.\d+)(px|%|rem|em)\s*\))$/;

/** Chuẩn hóa độ dài track nhập tay. `isMin`: cận dưới của minmax không được là fr. */
export function sanitizeTrackSize(v: string, fallback: string, isMin = false): string {
  let s = (v ?? '').trim().toLowerCase();
  if (!SIZE_RE.test(s)) return fallback;
  if (/^(\d+\.?\d*|\.\d+)$/.test(s) && Number(s) !== 0) s += 'px';
  if (isMin && s.endsWith('fr')) return '0';
  return s;
}

export function trackToCss(t: Track): string {
  const num = Math.max(0, finite(t.v));
  switch (t.kind) {
    case 'fr':
      return `${fmtNum(num)}fr`;
    case 'px':
      return `${fmtNum(num)}px`;
    case '%':
      return `${fmtNum(num)}%`;
    case 'auto':
    case 'min-content':
    case 'max-content':
      return t.kind;
    case 'minmax':
      return `minmax(${sanitizeTrackSize(t.min, '0', true)}, ${sanitizeTrackSize(t.max, '1fr')})`;
    case 'repeat': {
      const rep = t.rep === 'auto-fit' || t.rep === 'auto-fill' ? t.rep : String(Math.min(24, Math.max(1, Math.trunc(Number(t.rep)) || 1)));
      return `repeat(${rep}, minmax(${sanitizeTrackSize(t.min, '0', true)}, ${sanitizeTrackSize(t.max, '1fr')}))`;
    }
  }
}

export const tracksToCss = (ts: Track[]): string => ts.map(trackToCss).join(' ');

/** Số track "tường minh" mà bộ vẽ vùng (areas) dùng; repeat auto-* không thể ánh xạ. */
export function hasAutoRepeat(ts: Track[]): boolean {
  return ts.some((t) => t.kind === 'repeat' && (t.rep === 'auto-fit' || t.rep === 'auto-fill'));
}

export type GridAlign = 'stretch' | 'start' | 'end' | 'center';
export type GridContentAlign = 'normal' | 'start' | 'end' | 'center' | 'stretch' | 'space-between' | 'space-around' | 'space-evenly';

export interface GridContainer {
  cols: Track[];
  rows: Track[];
  rowGap: number;
  colGap: number;
  justifyItems: GridAlign;
  alignItems: GridAlign;
  justifyContent: GridContentAlign;
  alignContent: GridContentAlign;
  autoRows: string; // '' = bỏ qua
  autoFlow: 'row' | 'column' | 'row dense' | 'column dense';
  height: string;
}

export interface GridItem {
  id: number;
  area: string; // '' = đặt tường minh
  colStart: number; // 0 = auto
  colSpan: number;
  rowStart: number;
  rowSpan: number;
}

export const DEFAULT_GRID: GridContainer = {
  cols: [newTrack('fr', 1), newTrack('fr', 1), newTrack('fr', 1)],
  rows: [newTrack('auto'), newTrack('auto')],
  rowGap: 8,
  colGap: 8,
  justifyItems: 'stretch',
  alignItems: 'stretch',
  justifyContent: 'normal',
  alignContent: 'normal',
  autoRows: '',
  autoFlow: 'row',
  height: 'auto',
};

export function newGridItem(id: number): GridItem {
  return { id, area: '', colStart: 0, colSpan: 1, rowStart: 0, rowSpan: 1 };
}

export const AREA_NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
export const sanitizeAreaName = (s: string) => {
  const t = s.trim().replace(/[^A-Za-z0-9_-]/g, '');
  return AREA_NAME_RE.test(t) ? t : '';
};

/** Ma trận tên vùng (''= ô trống). Đổi kích thước giữ nguyên nội dung cũ. */
export function resizeAreas(cells: string[][], rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => cells[r]?.[c] ?? ''));
}

export interface AreaValidation {
  ok: boolean;
  names: string[];
  errors: string[];
  rects: Record<string, { r1: number; r2: number; c1: number; c2: number }>;
}

/** Mỗi vùng phải là một hình chữ nhật đặc (yêu cầu của grid-template-areas). */
export function validateAreas(cells: string[][]): AreaValidation {
  const rects: AreaValidation['rects'] = {};
  const counts: Record<string, number> = {};
  cells.forEach((row, r) =>
    row.forEach((n, c) => {
      if (!n) return;
      counts[n] = (counts[n] ?? 0) + 1;
      const x = rects[n];
      if (!x) rects[n] = { r1: r, r2: r, c1: c, c2: c };
      else {
        x.r1 = Math.min(x.r1, r);
        x.r2 = Math.max(x.r2, r);
        x.c1 = Math.min(x.c1, c);
        x.c2 = Math.max(x.c2, c);
      }
    })
  );
  const errors: string[] = [];
  for (const [n, x] of Object.entries(rects)) {
    const area = (x.r2 - x.r1 + 1) * (x.c2 - x.c1 + 1);
    if (area !== counts[n]) errors.push(`Vùng "${n}" không phải hình chữ nhật liền khối.`);
  }
  return { ok: errors.length === 0, names: Object.keys(rects), errors, rects };
}

export function areasToCss(cells: string[][]): string {
  return cells.map((row) => `"${row.map((n) => n || '.').join(' ')}"`).join(' ');
}

const gridAlignDecl = (d: Decl[], prop: string, v: string) => {
  if (v !== 'stretch' && v !== 'normal') d.push([prop, v]);
};

/** `areas`: ma trận đã validate hoặc null nếu không dùng. */
export function gridContainerDecls(g: GridContainer, areas: string[][] | null): Decl[] {
  const d: Decl[] = [['display', 'grid']];
  if (g.cols.length) d.push(['grid-template-columns', tracksToCss(g.cols)]);
  if (g.rows.length) d.push(['grid-template-rows', tracksToCss(g.rows)]);
  if (areas && areas.some((r) => r.some(Boolean))) {
    d.push(['grid-template-areas', areas.map((row) => `"${row.map((n) => n || '.').join(' ')}"`).join('\n    ')]);
  }
  const rg = Math.max(0, finite(g.rowGap));
  const cg = Math.max(0, finite(g.colGap));
  if (rg === cg) {
    if (rg > 0) d.push(['gap', `${fmtNum(rg)}px`]);
  } else {
    d.push(['gap', `${rg ? fmtNum(rg) + 'px' : '0'} ${cg ? fmtNum(cg) + 'px' : '0'}`]);
  }
  gridAlignDecl(d, 'justify-items', g.justifyItems);
  gridAlignDecl(d, 'align-items', g.alignItems);
  gridAlignDecl(d, 'justify-content', g.justifyContent);
  gridAlignDecl(d, 'align-content', g.alignContent);
  if (g.autoFlow !== 'row') d.push(['grid-auto-flow', g.autoFlow]);
  const ar = g.autoRows.trim() ? sanitizeTrackSize(g.autoRows, '') : '';
  if (ar) d.push(['grid-auto-rows', ar]);
  const h = sanitizeLength(g.height, 'auto');
  if (h !== 'auto') d.push(['height', h]);
  return d;
}

function span(start: number, n: number): string | null {
  const s = Math.max(0, Math.trunc(finite(start)));
  const sp = Math.max(1, Math.trunc(finite(n, 1)));
  if (s === 0 && sp === 1) return null;
  if (s === 0) return `span ${sp}`;
  if (sp === 1) return String(s);
  return `${s} / span ${sp}`;
}

export function gridItemDecls(it: GridItem, validAreas: string[]): Decl[] {
  if (it.area && validAreas.includes(it.area)) return [['grid-area', it.area]];
  const d: Decl[] = [];
  const c = span(it.colStart, it.colSpan);
  const r = span(it.rowStart, it.rowSpan);
  if (c) d.push(['grid-column', c]);
  if (r) d.push(['grid-row', r]);
  return d;
}

export const gridItemClass = (it: GridItem, i: number, validAreas: string[]) =>
  it.area && validAreas.includes(it.area) ? it.area : `item-${i + 1}`;

export function gridCss(g: GridContainer, items: GridItem[], areas: string[][] | null): string {
  const names = areas ? validateAreas(areas).names : [];
  const parts = [declsToCss('.grid-container', gridContainerDecls(g, areas))];
  const seen = new Set<string>();
  items.forEach((it, i) => {
    const cls = gridItemClass(it, i, names);
    const decls = gridItemDecls(it, names);
    if (!decls.length || seen.has(cls)) return;
    seen.add(cls);
    parts.push(declsToCss(`.${cls}`, decls));
  });
  return parts.join('\n\n');
}

const TW_GRID_ALIGN: Record<string, [string, string]> = {
  start: ['justify-items-start', 'items-start'],
  end: ['justify-items-end', 'items-end'],
  center: ['justify-items-center', 'items-center'],
};

export function gridTailwind(g: GridContainer, items: GridItem[], areas: string[][] | null): string {
  const names = areas ? validateAreas(areas).names : [];
  const k = ['grid'];
  if (g.cols.length) k.push(`grid-cols-[${twArb(tracksToCss(g.cols))}]`);
  if (g.rows.length) k.push(`grid-rows-[${twArb(tracksToCss(g.rows))}]`);
  if (areas && areas.some((r) => r.some(Boolean))) {
    k.push(`[grid-template-areas:${areas.map((row) => `'${row.map((n) => n || '.').join('_')}'`).join('_')}]`);
  }
  k.push(...twGap(g.rowGap, g.colGap));
  if (g.justifyItems !== 'stretch') k.push(TW_GRID_ALIGN[g.justifyItems]?.[0] ?? 'justify-items-stretch');
  if (g.alignItems !== 'stretch') k.push(TW_GRID_ALIGN[g.alignItems]?.[1] ?? 'items-stretch');
  if (g.justifyContent !== 'normal') k.push(TW_JUSTIFY[g.justifyContent] ?? '');
  if (g.alignContent !== 'normal') k.push(TW_CONTENT[g.alignContent] ?? '');
  if (g.autoFlow !== 'row') k.push(`grid-flow-${g.autoFlow === 'column' ? 'col' : g.autoFlow === 'row dense' ? 'row-dense' : 'col-dense'}`);
  const ar = g.autoRows.trim() ? sanitizeTrackSize(g.autoRows, '') : '';
  if (ar) k.push(`auto-rows-[${twArb(ar)}]`);
  const h = twSize('h', g.height);
  if (h) k.push(h);
  const lines = [`Container: ${k.filter(Boolean).join(' ')}`];
  items.forEach((it, i) => {
    const t: string[] = [];
    if (it.area && names.includes(it.area)) t.push(`[grid-area:${it.area}]`);
    else {
      const cs = Math.max(0, Math.trunc(finite(it.colStart)));
      const rs = Math.max(0, Math.trunc(finite(it.rowStart)));
      const cn = Math.max(1, Math.trunc(finite(it.colSpan, 1)));
      const rn = Math.max(1, Math.trunc(finite(it.rowSpan, 1)));
      if (cs > 0) t.push(`col-start-${cs}`);
      if (cn > 1) t.push(`col-span-${cn}`);
      if (rs > 0) t.push(`row-start-${rs}`);
      if (rn > 1) t.push(`row-span-${rn}`);
    }
    if (t.length) lines.push(`Item ${i + 1}: ${t.join(' ')}`);
  });
  if (g.cols.some((t) => t.kind === 'repeat' && t.rep === 'auto-fit')) {
    lines.push('Mẹo: với repeat(auto-fit, minmax()) Tailwind chỉ dùng được dạng giá trị tùy ý như trên.');
  }
  return lines.join('\n');
}

export function gridHtml(items: GridItem[], names: string[]): string {
  const rows = items.map((it, i) => `  <div class="${gridItemClass(it, i, names)}">${i + 1}</div>`);
  return `<div class="grid-container">\n${rows.join('\n')}\n</div>`;
}

/* ------------------------------------------------------------------ */
/* CLAMP() FLUID                                                       */
/* ------------------------------------------------------------------ */

export interface FluidInput {
  minSize: number; // px
  maxSize: number; // px
  minVw: number; // px
  maxVw: number; // px
  rootPx: number;
  unit: 'rem' | 'px';
}

export interface FluidOk {
  ok: true;
  css: string;
  slope: number; // px trên mỗi px viewport
  slopeVw: number; // = slope * 100
  interceptPx: number;
  loPx: number;
  hiPx: number;
}
export type FluidResult = FluidOk | { ok: false; error: string };

export function fluidClamp(i: FluidInput): FluidResult {
  const vals = [i.minSize, i.maxSize, i.minVw, i.maxVw, i.rootPx];
  if (vals.some((v) => !Number.isFinite(v))) return { ok: false, error: 'Vui lòng nhập số hợp lệ.' };
  if (i.minVw <= 0 || i.maxVw <= 0 || i.rootPx <= 0) return { ok: false, error: 'Viewport và root font-size phải lớn hơn 0.' };
  if (i.minSize < 0 || i.maxSize < 0) return { ok: false, error: 'Kích thước không được âm.' };
  if (i.maxVw <= i.minVw) return { ok: false, error: 'Viewport lớn nhất phải lớn hơn viewport nhỏ nhất.' };
  const slope = (i.maxSize - i.minSize) / (i.maxVw - i.minVw);
  const intercept = i.minSize - slope * i.minVw;
  const loPx = Math.min(i.minSize, i.maxSize);
  const hiPx = Math.max(i.minSize, i.maxSize);
  const u = i.unit;
  const conv = (px: number) => (u === 'rem' ? px / i.rootPx : px);
  const fmtU = (px: number) => `${fmtNum(conv(px))}${u}`;
  if (i.minSize === i.maxSize) {
    return { ok: true, css: fmtU(i.minSize), slope: 0, slopeVw: 0, interceptPx: i.minSize, loPx, hiPx };
  }
  const slopeVw = slope * 100;
  const interceptStr = fmtNum(conv(intercept));
  const slopeStr = fmtNum(slopeVw);
  let expr: string;
  if (interceptStr === '0') expr = `${slopeStr}vw`;
  else if (slopeVw < 0) expr = `${interceptStr}${u} - ${fmtNum(Math.abs(slopeVw))}vw`;
  else expr = `${interceptStr}${u} + ${slopeStr}vw`;
  return { ok: true, css: `clamp(${fmtU(loPx)}, ${expr}, ${fmtU(hiPx)})`, slope, slopeVw, interceptPx: intercept, loPx, hiPx };
}

/** Giá trị (px) tại viewport `vwPx` theo công thức chính xác (chưa làm tròn). */
export function evalFluid(r: FluidOk, vwPx: number): number {
  return Math.min(r.hiPx, Math.max(r.loPx, r.interceptPx + r.slope * vwPx));
}

/** Tính lại giá trị px từ CHUỖI clamp() đã sinh (đã làm tròn) để kiểm chứng; null nếu không đọc được. */
export function evalClampCss(css: string, vwPx: number, rootPx: number): number | null {
  const toPx = (n: number, unit: string) => (unit === 'rem' ? n * rootPx : unit === 'vw' ? (n * vwPx) / 100 : n);
  const plain = /^\s*(-?[\d.]+)(px|rem)\s*$/.exec(css);
  if (plain) return toPx(Number(plain[1]), plain[2]);
  const m = /^\s*clamp\(\s*(-?[\d.]+)(px|rem)\s*,(.+),\s*(-?[\d.]+)(px|rem)\s*\)\s*$/.exec(css);
  if (!m) return null;
  const lo = toPx(Number(m[1]), m[2]);
  const hi = toPx(Number(m[4]), m[5]);
  const expr = m[3].trim();
  const re = /([+-]?)\s*(-?[\d.]+)(px|rem|vw)/g;
  let total = 0;
  let found = 0;
  let consumed = '';
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(expr))) {
    const sign = mm[1] === '-' ? -1 : 1;
    total += sign * toPx(Number(mm[2]), mm[3]);
    found++;
    consumed += mm[0];
  }
  if (!found || consumed.replace(/\s/g, '') !== expr.replace(/\s/g, '')) return null;
  return Math.min(hi, Math.max(lo, total));
}

export const COMMON_BREAKPOINTS = [320, 375, 480, 640, 768, 1024, 1280, 1440, 1920];

export const SCALE_RATIOS: { label: string; value: number }[] = [
  { label: '1.125 – Major second', value: 1.125 },
  { label: '1.2 – Minor third', value: 1.2 },
  { label: '1.25 – Major third', value: 1.25 },
  { label: '1.333 – Perfect fourth', value: 1.333 },
  { label: '1.414 – Augmented fourth', value: 1.414 },
  { label: '1.5 – Perfect fifth', value: 1.5 },
  { label: '1.618 – Golden ratio', value: 1.618 },
];

export interface ScaleInput {
  baseMin: number;
  baseMax: number;
  ratioMin: number;
  ratioMax: number;
  minVw: number;
  maxVw: number;
  rootPx: number;
  unit: 'rem' | 'px';
  down: number; // số bước nhỏ hơn base
  up: number; // số bước lớn hơn base
  prefix: string;
}

export interface ScaleStep {
  step: number;
  name: string;
  minPx: number;
  maxPx: number;
  css: string;
}

export function typeScale(s: ScaleInput): { ok: true; steps: ScaleStep[]; cssVars: string } | { ok: false; error: string } {
  if (![s.baseMin, s.baseMax, s.ratioMin, s.ratioMax].every((v) => Number.isFinite(v) && v > 0)) {
    return { ok: false, error: 'Cỡ chữ gốc và tỉ lệ phải là số dương.' };
  }
  const down = Math.min(6, Math.max(0, Math.trunc(s.down)));
  const up = Math.min(10, Math.max(0, Math.trunc(s.up)));
  const prefix = s.prefix.replace(/[^a-zA-Z0-9_-]/g, '') || 'step';
  const steps: ScaleStep[] = [];
  for (let k = -down; k <= up; k++) {
    const minPx = s.baseMin * Math.pow(s.ratioMin, k);
    const maxPx = s.baseMax * Math.pow(s.ratioMax, k);
    const r = fluidClamp({ minSize: minPx, maxSize: maxPx, minVw: s.minVw, maxVw: s.maxVw, rootPx: s.rootPx, unit: s.unit });
    if (!r.ok) return { ok: false, error: r.error };
    steps.push({ step: k, name: `--${prefix}-${k}`, minPx, maxPx, css: r.css });
  }
  const cssVars = `:root {\n${steps.map((x) => `  ${x.name}: ${x.css};`).join('\n')}\n}`;
  return { ok: true, steps, cssVars };
}

/* ------------------------------------------------------------------ */
/* ĐỔI ĐƠN VỊ                                                          */
/* ------------------------------------------------------------------ */

export type CssUnit = 'px' | 'rem' | 'em' | 'vw' | 'vh' | '%' | 'pt';
export const CSS_UNITS: CssUnit[] = ['px', 'rem', 'em', 'vw', 'vh', '%', 'pt'];

export interface UnitCtx {
  rootPx: number; // font-size gốc (rem)
  emPx: number; // font-size phần tử cha (em)
  vwPx: number; // chiều rộng viewport
  vhPx: number; // chiều cao viewport
  percentBasePx: number; // 100% = bao nhiêu px
}

export const DEFAULT_UNIT_CTX: UnitCtx = { rootPx: 16, emPx: 16, vwPx: 1440, vhPx: 900, percentBasePx: 1440 };

function unitPx(u: CssUnit, c: UnitCtx): number {
  switch (u) {
    case 'px': return 1;
    case 'rem': return c.rootPx;
    case 'em': return c.emPx;
    case 'vw': return c.vwPx / 100;
    case 'vh': return c.vhPx / 100;
    case '%': return c.percentBasePx / 100;
    case 'pt': return 96 / 72;
  }
}

/** Đổi `v` từ đơn vị `from` sang `to`; null nếu tham số không hợp lệ (chia cho 0). */
export function convertUnit(v: number, from: CssUnit, to: CssUnit, c: UnitCtx): number | null {
  const a = unitPx(from, c);
  const b = unitPx(to, c);
  if (!Number.isFinite(v) || !Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return (v * a) / b;
}

export interface BulkOptions {
  mode: 'px2rem' | 'rem2px';
  rootPx: number;
  precision: number;
  convertMedia: boolean; // false: giữ nguyên trong @media / @container
  keepThinPx: boolean; // px2rem: giữ nguyên giá trị |x| <= 1px (viền mảnh)
}

const NUM_UNIT_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(px|rem)(?![A-Za-z0-9_%-])/iy;

/** Viết lại px<->rem trong CSS, bỏ qua url(), chuỗi, comment, (tùy chọn) media query. */
export function convertCssUnits(css: string, o: BulkOptions): { out: string; count: number } {
  const root = o.rootPx > 0 && Number.isFinite(o.rootPx) ? o.rootPx : 16;
  const prec = Math.min(8, Math.max(0, Math.trunc(o.precision)));
  const from = o.mode === 'px2rem' ? 'px' : 'rem';
  const n = css.length;
  let out = '';
  let i = 0;
  let count = 0;
  const skipQuoted = (start: number): number => {
    const q = css[start];
    let j = start + 1;
    while (j < n && css[j] !== q) {
      if (css[j] === '\\') j++;
      j++;
    }
    return Math.min(n, j + 1);
  };
  while (i < n) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      out += css.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = skipQuoted(i);
      out += css.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '@' && !o.convertMedia && /^@(media|container)\b/i.test(css.slice(i, i + 12))) {
      let j = i;
      while (j < n && css[j] !== '{' && css[j] !== ';') {
        if (css[j] === '"' || css[j] === "'") j = skipQuoted(j);
        else j++;
      }
      out += css.slice(i, j);
      i = j;
      continue;
    }
    if ((ch === 'u' || ch === 'U') && /^url\(/i.test(css.slice(i, i + 4)) && (i === 0 || !/[\w-]/.test(css[i - 1]))) {
      let j = i + 4;
      while (j < n && css[j] !== ')') {
        if (css[j] === '"' || css[j] === "'") j = skipQuoted(j);
        else j++;
      }
      const end = Math.min(n, j + 1);
      out += css.slice(i, end);
      i = end;
      continue;
    }
    if (/[0-9.+-]/.test(ch) && (i === 0 || !/[A-Za-z0-9_.#%$\\-]/.test(css[i - 1]))) {
      NUM_UNIT_RE.lastIndex = i;
      const m = NUM_UNIT_RE.exec(css);
      if (m && m[1].toLowerCase() === from) {
        const val = parseFloat(m[0]);
        const keep = o.mode === 'px2rem' && o.keepThinPx && Math.abs(val) <= 1 && val !== 0;
        if (!keep) {
          if (o.mode === 'px2rem') out += `${fmtNum(val / root, prec)}rem`;
          else out += `${fmtNum(val * root, prec)}px`;
          count++;
        } else out += m[0];
        i += m[0].length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return { out, count };
}

/* ------------------------------------------------------------------ */
/* SHADOW / RADIUS                                                     */
/* ------------------------------------------------------------------ */

export interface ShadowLayer {
  inset: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string; // #rrggbb
  alpha: number; // 0..1
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = (hex ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

export function colorWithAlpha(hex: string, alpha: number, compact = false): string {
  const { r, g, b } = hexToRgb(hex);
  const a = clamp01(finite(alpha, 1));
  const sep = compact ? ',' : ', ';
  return `rgba(${r}${sep}${g}${sep}${b}${sep}${fmtNum(a, 3)})`;
}

const len = (n: number) => (Math.round(n * 100) === 0 ? '0' : `${fmtNum(n, 2)}px`);

function layerCss(l: ShadowLayer, kind: 'box' | 'text', compact: boolean): string {
  const parts: string[] = [];
  if (kind === 'box' && l.inset) parts.push('inset');
  parts.push(len(finite(l.x)), len(finite(l.y)), len(Math.max(0, finite(l.blur))));
  if (kind === 'box' && finite(l.spread) !== 0) parts.push(len(finite(l.spread)));
  parts.push(compact ? colorWithAlpha(l.color, l.alpha, true) : colorWithAlpha(l.color, l.alpha));
  return parts.join(' ');
}

export function shadowValue(layers: ShadowLayer[], kind: 'box' | 'text'): string {
  if (!layers.length) return 'none';
  return layers.map((l) => layerCss(l, kind, false)).join(', ');
}

export function shadowTailwind(layers: ShadowLayer[], kind: 'box' | 'text'): string {
  if (!layers.length) return kind === 'box' ? 'shadow-none' : '[text-shadow:none]';
  const v = layers.map((l) => twArb(layerCss(l, kind, true))).join(',');
  return kind === 'box' ? `shadow-[${v}]` : `[text-shadow:${v}]`;
}

export type RadiusUnit = 'px' | '%';
export interface Radius {
  tl: number;
  tr: number;
  br: number;
  bl: number;
  unit: RadiusUnit;
}

export function radiusValue(r: Radius): string {
  const f = (n: number) => (n === 0 ? '0' : `${fmtNum(Math.max(0, finite(n)), 2)}${r.unit}`);
  const [a, b, c, d] = [r.tl, r.tr, r.br, r.bl].map((n) => Math.max(0, finite(n)));
  if (a === b && b === c && c === d) return f(a);
  if (a === c && b === d) return `${f(a)} ${f(b)}`;
  if (b === d) return `${f(a)} ${f(b)} ${f(c)}`;
  return `${f(a)} ${f(b)} ${f(c)} ${f(d)}`;
}

export function radiusTailwind(r: Radius): string {
  return `rounded-[${twArb(radiusValue(r))}]`;
}

const L = (x: number, y: number, blur: number, spread: number, color: string, alpha: number, inset = false): ShadowLayer => ({
  inset, x, y, blur, spread, color, alpha,
});

export const SHADOW_PRESETS: { name: string; layers: ShadowLayer[]; dark?: boolean }[] = [
  { name: 'Mềm (soft)', layers: [L(0, 4, 12, 0, '#000000', 0.12)] },
  {
    name: 'Nhiều lớp mượt (smooth)',
    layers: [
      L(0, 1, 1, 0, '#000000', 0.08),
      L(0, 2, 2, 0, '#000000', 0.08),
      L(0, 4, 4, 0, '#000000', 0.08),
      L(0, 8, 8, 0, '#000000', 0.08),
      L(0, 16, 16, 0, '#000000', 0.08),
    ],
  },
  { name: 'Nâng cao (elevated)', layers: [L(0, 10, 15, -3, '#000000', 0.1), L(0, 4, 6, -4, '#000000', 0.1)] },
  {
    name: 'Neumorphism',
    layers: [L(8, 8, 16, 0, '#a3b1c6', 1), L(-8, -8, 16, 0, '#ffffff', 1)],
  },
  { name: 'Glow tím', layers: [L(0, 0, 20, 2, '#6366f1', 0.7), L(0, 0, 40, 6, '#6366f1', 0.35)], dark: true },
  { name: 'Glow xanh lá', layers: [L(0, 0, 16, 0, '#10b981', 0.8)], dark: true },
  { name: 'Cứng (brutalist)', layers: [L(6, 6, 0, 0, '#000000', 1)] },
  { name: 'Lõm (inset)', layers: [L(0, 2, 6, 0, '#000000', 0.25, true)] },
];

export const TEXT_SHADOW_PRESETS: { name: string; layers: ShadowLayer[]; dark?: boolean }[] = [
  { name: 'Nhẹ', layers: [L(0, 1, 2, 0, '#000000', 0.3)] },
  { name: 'Nổi (long)', layers: [L(1, 1, 0, 0, '#000000', 0.2), L(2, 2, 0, 0, '#000000', 0.2), L(3, 3, 0, 0, '#000000', 0.2)] },
  { name: 'Neon', layers: [L(0, 0, 4, 0, '#ffffff', 1), L(0, 0, 12, 0, '#6366f1', 1), L(0, 0, 24, 0, '#6366f1', 0.8)], dark: true },
  { name: 'Viền chữ', layers: [L(-1, -1, 0, 0, '#000000', 1), L(1, -1, 0, 0, '#000000', 1), L(-1, 1, 0, 0, '#000000', 1), L(1, 1, 0, 0, '#000000', 1)] },
];

/* ------------------------------------------------------------------ */
/* SPECIFICITY                                                         */
/* ------------------------------------------------------------------ */

export type Spec = [a: number, b: number, c: number];

export interface SpecPart {
  text: string;
  kind: 'a' | 'b' | 'c' | 'zero';
  note: string;
}

export interface SpecResult {
  selector: string;
  spec: Spec;
  parts: SpecPart[];
  error?: string;
}

export function compareSpec(x: Spec, y: Spec): number {
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

const maxSpec = (list: Spec[]): Spec => list.reduce<Spec>((m, s) => (compareSpec(s, m) > 0 ? s : m), [0, 0, 0]);

const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);
const SELECTOR_ARG_PSEUDOS = new Set(['is', 'not', 'matches', '-webkit-any', '-moz-any', 'has']);

class SpecError extends Error {}

/** Tách danh sách selector theo dấu phẩy ở mức ngoài cùng (bỏ qua trong (), [], chuỗi). */
export function splitSelectorList(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let q = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (ch === '\\' && i + 1 < s.length) cur += s[++i];
      else if (ch === q) q = '';
      continue;
    }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '\\' && i + 1 < s.length) { cur += ch + s[++i]; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const isIdentChar = (ch: string) => /[A-Za-z0-9_\u0080-￿-]/.test(ch);

function readIdent(s: string, i: number): [string, number] {
  let j = i;
  while (j < s.length) {
    if (s[j] === '\\' && j + 1 < s.length) j += 2;
    else if (isIdentChar(s[j])) j++;
    else break;
  }
  return [s.slice(i, j), j];
}

function readBalanced(s: string, i: number, open: string, close: string): [string, number] {
  // s[i] === open
  let depth = 0;
  let q = '';
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (q) {
      if (ch === '\\') j++;
      else if (ch === q) q = '';
      continue;
    }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === '\\') j++;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return [s.slice(i + 1, j), j + 1];
    }
  }
  throw new SpecError(`Thiếu dấu đóng "${close}".`);
}

function analyzeCompound(sel: string, parts: SpecPart[], depth: number): Spec {
  if (depth > 8) throw new SpecError('Selector lồng quá sâu.');
  const total: Spec = [0, 0, 0];
  const add = (k: 'a' | 'b' | 'c', text: string, note: string, by: Spec | null = null) => {
    if (by) {
      total[0] += by[0]; total[1] += by[1]; total[2] += by[2];
    } else total[k === 'a' ? 0 : k === 'b' ? 1 : 2] += 1;
    parts.push({ text, kind: k, note });
  };
  let i = 0;
  while (i < sel.length) {
    const ch = sel[i];
    if (/\s/.test(ch) || ch === '>' || ch === '+' || ch === '~') { i++; continue; }
    if (ch === '*') { parts.push({ text: '*', kind: 'zero', note: 'Selector phổ quát: không tính.' }); i++; continue; }
    if (ch === '&') { parts.push({ text: '&', kind: 'zero', note: 'CSS nesting: tính theo selector cha (chưa cộng ở đây).' }); i++; continue; }
    if (ch === '|') { i++; continue; }
    if (ch === '#') {
      const [id, j] = readIdent(sel, i + 1);
      if (!id) throw new SpecError('Thiếu tên sau "#".');
      add('a', `#${id}`, 'ID selector (a +1).');
      i = j; continue;
    }
    if (ch === '.') {
      const [cl, j] = readIdent(sel, i + 1);
      if (!cl) throw new SpecError('Thiếu tên class sau ".".');
      add('b', `.${cl}`, 'Class selector (b +1).');
      i = j; continue;
    }
    if (ch === '[') {
      const [inner, j] = readBalanced(sel, i, '[', ']');
      add('b', `[${inner}]`, 'Attribute selector (b +1).');
      i = j; continue;
    }
    if (ch === ':') {
      const dbl = sel[i + 1] === ':';
      const [name, j0] = readIdent(sel, i + (dbl ? 2 : 1));
      if (!name) throw new SpecError('Thiếu tên pseudo sau ":".');
      const lname = name.toLowerCase();
      let args: string | null = null;
      let j = j0;
      if (sel[j] === '(') {
        [args, j] = readBalanced(sel, j, '(', ')');
      }
      const text = `${dbl ? '::' : ':'}${name}${args !== null ? `(${args})` : ''}`;
      if (dbl || LEGACY_PSEUDO_ELEMENTS.has(lname)) {
        let by: Spec = [0, 0, 1];
        let note = 'Pseudo-element (c +1).';
        if (dbl && args !== null && lname === 'slotted') {
          const inner = analyzeList(args, depth + 1);
          by = [inner[0], inner[1], inner[2] + 1];
          note = 'Pseudo-element ::slotted() (c +1) cộng độ ưu tiên của selector bên trong.';
        }
        add('c', text, note, by);
      } else if (args !== null && lname === 'where') {
        analyzeList(args, depth + 1);
        parts.push({ text, kind: 'zero', note: ':where() luôn có độ ưu tiên 0, bất kể nội dung bên trong.' });
      } else if (args !== null && SELECTOR_ARG_PSEUDOS.has(lname)) {
        const inner = analyzeList(args, depth + 1);
        const k: 'a' | 'b' | 'c' = inner[0] ? 'a' : inner[1] ? 'b' : 'c';
        const sp = inner[0] || inner[1] || inner[2] ? inner : ([0, 0, 0] as Spec);
        add(k, text, `:${lname}() không tự tính; lấy selector có độ ưu tiên cao nhất bên trong: (${sp.join(',')}).`, sp);
      } else if (args !== null && (lname === 'nth-child' || lname === 'nth-last-child')) {
        const m = /\sof\s([\s\S]+)$/i.exec(args);
        const inner = m ? analyzeList(m[1], depth + 1) : ([0, 0, 0] as Spec);
        add('b', text, `Pseudo-class (b +1)${m ? ' cộng selector sau "of"' : ''}.`, [inner[0], inner[1] + 1, inner[2]]);
      } else if (args !== null && (lname === 'host' || lname === 'host-context')) {
        const inner = analyzeList(args, depth + 1);
        add('b', text, 'Pseudo-class (b +1) cộng selector bên trong.', [inner[0], inner[1] + 1, inner[2]]);
      } else {
        add('b', text, 'Pseudo-class (b +1).');
      }
      i = j; continue;
    }
    if (isIdentChar(ch) || ch === '\\') {
      const [id, j] = readIdent(sel, i);
      if (sel[j] === '|' && sel[j + 1] !== '=') { i = j + 1; continue; } // namespace
      add('c', id, 'Type selector (c +1).');
      i = j; continue;
    }
    throw new SpecError(`Ký tự không hợp lệ: "${ch}".`);
  }
  return total;
}

function analyzeList(list: string, depth: number): Spec {
  const items = splitSelectorList(list);
  const specs = items.map((s) => analyzeCompound(s, [], depth));
  return maxSpec(specs);
}

export function specificityOf(selector: string): SpecResult {
  const sel = selector.trim();
  const parts: SpecPart[] = [];
  try {
    if (!sel) throw new SpecError('Selector rỗng.');
    if (sel.length > 2000) throw new SpecError('Selector quá dài (tối đa 2000 ký tự).');
    const spec = analyzeCompound(sel, parts, 0);
    return { selector: sel, spec, parts };
  } catch (e) {
    return { selector: sel, spec: [0, 0, 0], parts, error: e instanceof SpecError ? e.message : 'Không phân tích được selector.' };
  }
}

/** Lấy danh sách selector từ văn bản dán vào: mỗi dòng/dấu phẩy là một selector, hoặc từ các rule CSS `sel { ... }`. */
export function extractSelectors(text: string, max = 300): string[] {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, ' ').slice(0, 200000);
  const out: string[] = [];
  if (src.includes('{')) {
    let cur = '';
    let depth = 0;
    let q = '';
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (q) { cur += ch; if (ch === '\\') cur += src[++i] ?? ''; else if (ch === q) q = ''; continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
      if (depth === 0 && ch === '{') {
        const prelude = cur.trim();
        if (prelude && !prelude.startsWith('@')) out.push(...splitSelectorList(prelude));
        cur = '';
      } else if (depth === 0 && (ch === '}' || ch === ';')) cur = '';
      else cur += ch;
      if (out.length >= max) break;
    }
  } else {
    for (const line of src.split(/\n/)) out.push(...splitSelectorList(line));
  }
  return out.slice(0, max);
}

export function rankSelectors(selectors: string[]): { result: SpecResult; index: number }[] {
  return selectors
    .map((s, index) => ({ result: specificityOf(s), index }))
    .sort((x, y) => compareSpec(y.result.spec, x.result.spec) || x.index - y.index);
}
