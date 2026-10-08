/**
 * So sánh JSON theo cấu trúc (không phụ thuộc thứ tự khóa / định dạng).
 * Sinh danh sách thay đổi, cây hợp nhất và JSON Patch (RFC 6902) hợp lệ khi áp dụng tuần tự.
 */
import { JsonType, PathSeg, parsePointer, toJsonPath, toPointer, typeOf } from './json-path';

export type ChangeKind = 'added' | 'removed' | 'changed' | 'type-changed' | 'moved';

export interface Change {
  kind: ChangeKind;
  path: PathSeg[];
  jsonPath: string;
  pointer: string;
  oldValue?: unknown;
  newValue?: unknown;
  hasOld: boolean;
  hasNew: boolean;
  oldType?: JsonType;
  newType?: JsonType;
  /** Với kind = 'moved': vị trí cũ trong mảng */
  fromJsonPath?: string;
  fromPointer?: string;
}

export interface PatchOp {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  from?: string;
  value?: unknown;
}

export type MergedStatus = 'same' | 'container' | 'added' | 'removed' | 'changed' | 'type-changed' | 'moved';

export interface MergedNode {
  key: PathSeg | null;
  status: MergedStatus;
  type: JsonType;
  oldType?: JsonType;
  oldValue?: unknown;
  newValue?: unknown;
  children?: MergedNode[];
  fromIndex?: number;
}

export interface DiffOptions {
  /** Coi mảng là tập hợp, bỏ qua thứ tự phần tử */
  ignoreArrayOrder: boolean;
  /** Khi bỏ qua thứ tự: ghép object theo khóa này (vd `id`) */
  arrayKey: string;
  /** Danh sách khóa/đường dẫn bỏ qua, ngăn cách bằng dấu phẩy, hỗ trợ `*` */
  ignoreKeys: string;
  /** Sai số tuyệt đối cho số */
  tolerance: number;
  caseInsensitive: boolean;
  trim: boolean;
  /** Khóa có giá trị null được coi như không tồn tại */
  nullAsMissing: boolean;
}

export const DEFAULT_DIFF_OPTIONS: DiffOptions = {
  ignoreArrayOrder: false,
  arrayKey: '',
  ignoreKeys: '',
  tolerance: 0,
  caseInsensitive: false,
  trim: false,
  nullAsMissing: false,
};

export interface DiffCounts {
  added: number;
  removed: number;
  changed: number;
  typeChanged: number;
  moved: number;
  total: number;
}

export interface DiffResult {
  changes: Change[];
  patch: PatchOp[];
  merged: MergedNode;
  counts: DiffCounts;
  /** Quá nhiều thay đổi: kết quả (và patch) chỉ là một phần */
  truncated: boolean;
  error?: string;
}

export const MAX_CHANGES = 20000;
const MAX_LCS_CELLS = 1_500_000;
const MAX_LCS_CELLS_SLOW = 250_000;
const MAX_MYERS_D = 1500;

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

class Early {}
class Stop {}
const EARLY = new Early();
const STOP = new Stop();

// ---------------------------------------------------------------------------
// Bỏ qua khóa
// ---------------------------------------------------------------------------

interface IgnoreSet {
  keys: RegExp[];
  paths: RegExp[];
}

function globToRegex(p: string): RegExp {
  const esc = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + esc + '$');
}

/** Chuẩn hóa: ['abc'] -> .abc, [3] -> [*]. */
function normalizePathPattern(p: string): string {
  return p.replace(/\[\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*\]/g, '.$1').replace(/\[\d+\]/g, '[*]');
}

export function compileIgnore(list: string): IgnoreSet {
  const set: IgnoreSet = { keys: [], paths: [] };
  for (const raw of list.split(',')) {
    const p = raw.trim();
    if (!p || p.length > 200) continue;
    if (p.startsWith('$')) set.paths.push(globToRegex(normalizePathPattern(p)));
    else if (/[.[]/.test(p)) set.paths.push(globToRegex(normalizePathPattern('$.' + p.replace(/^\./, ''))));
    else set.keys.push(globToRegex(p));
  }
  return set;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
function keySeg(k: string): string {
  return IDENT.test(k) ? '.' + k : `['${k.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`;
}

// ---------------------------------------------------------------------------
// Ngữ cảnh
// ---------------------------------------------------------------------------

interface Ctx {
  o: DiffOptions;
  tol: number;
  ign: IgnoreSet;
  dry: boolean;
  changes: Change[];
  ops: PatchOp[];
  count: number;
  truncated: boolean;
  counts: DiffCounts;
}

function mkCtx(o: DiffOptions, dry: boolean): Ctx {
  const tol = Number.isFinite(o.tolerance) && o.tolerance > 0 ? o.tolerance : 0;
  return {
    o,
    tol,
    ign: compileIgnore(o.ignoreKeys),
    dry,
    changes: [],
    ops: [],
    count: 0,
    truncated: false,
    counts: { added: 0, removed: 0, changed: 0, typeChanged: 0, moved: 0, total: 0 },
  };
}

function isIgnored(ctx: Ctx, key: string, pp: string): boolean {
  if (ctx.ign.keys.length === 0 && ctx.ign.paths.length === 0) return false;
  for (const r of ctx.ign.keys) if (r.test(key)) return true;
  if (ctx.ign.paths.length) {
    const full = pp + keySeg(key);
    for (const r of ctx.ign.paths) if (r.test(full)) return true;
  }
  return false;
}

function record(ctx: Ctx, ch: Change) {
  if (ctx.dry) throw EARLY;
  if (ctx.count >= MAX_CHANGES) {
    ctx.truncated = true;
    throw STOP;
  }
  ctx.count++;
  ctx.counts.total++;
  switch (ch.kind) {
    case 'added': ctx.counts.added++; break;
    case 'removed': ctx.counts.removed++; break;
    case 'changed': ctx.counts.changed++; break;
    case 'type-changed': ctx.counts.typeChanged++; break;
    case 'moved': ctx.counts.moved++; break;
  }
  ctx.changes.push(ch);
}

function mkChange(
  kind: ChangeKind,
  dp: PathSeg[],
  oldV: unknown,
  newV: unknown,
  hasOld: boolean,
  hasNew: boolean
): Change {
  return {
    kind,
    path: dp,
    jsonPath: toJsonPath(dp),
    pointer: toPointer(dp),
    oldValue: hasOld ? oldV : undefined,
    newValue: hasNew ? newV : undefined,
    hasOld,
    hasNew,
    oldType: hasOld ? typeOf(oldV) : undefined,
    newType: hasNew ? typeOf(newV) : undefined,
  };
}

function pushOp(ctx: Ctx, op: PatchOp) {
  if (!ctx.dry) ctx.ops.push(op);
}

// ---------------------------------------------------------------------------
// So sánh nguyên thủy / chuẩn hóa
// ---------------------------------------------------------------------------

function normStr(ctx: Ctx, s: string): string {
  if (ctx.o.trim) s = s.trim();
  if (ctx.o.caseInsensitive) s = s.toLowerCase();
  return s;
}

function leafEq(ctx: Ctx, a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b || (ctx.tol > 0 && Math.abs(a - b) <= ctx.tol);
  }
  if (typeof a === 'string' && typeof b === 'string') return a === b || normStr(ctx, a) === normStr(ctx, b);
  return a === b || (a == null && b == null);
}

function missing(ctx: Ctx, v: unknown): boolean {
  return v === undefined || (ctx.o.nullAsMissing && v === null);
}

/** Chuỗi chuẩn tắc để băm/so khớp (bỏ qua sai số số học). */
function canon(ctx: Ctx, v: unknown, pp: string): string {
  const t = typeOf(v);
  switch (t) {
    case 'null': return 'null';
    case 'boolean': return v ? 'true' : 'false';
    case 'number': return String(v);
    case 'string': return JSON.stringify(normStr(ctx, v as string));
    case 'array': {
      const parts = (v as unknown[]).map((x) => canon(ctx, x, pp + '[*]'));
      if (ctx.o.ignoreArrayOrder) parts.sort();
      return '[' + parts.join(',') + ']';
    }
    default: {
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o)
        .filter((k) => !isIgnored(ctx, k, pp) && !(ctx.o.nullAsMissing && o[k] === null))
        .sort();
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(ctx, o[k], pp + keySeg(k))).join(',') + '}';
    }
  }
}

function category(v: unknown): 'obj' | 'arr' | 'prim' {
  const t = typeOf(v);
  return t === 'object' ? 'obj' : t === 'array' ? 'arr' : 'prim';
}

function isEqualAt(ctx: Ctx, a: unknown, b: unknown, pp: string): boolean {
  const c2: Ctx = { ...ctx, dry: true };
  try {
    diffNode(a, b, c2, pp, [], [], null);
    return true;
  } catch (e) {
    if (e === EARLY) return false;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Căn chỉnh mảng
// ---------------------------------------------------------------------------

interface Entry {
  a?: number;
  b?: number;
  eq?: boolean;
  moved?: boolean; // mục bị xóa nhưng thực chất là di chuyển
  movedFrom?: number; // mục thêm vào thực chất di chuyển từ chỉ số này
}

function pairGap(gA: number[], gB: number[], A: unknown[], B: unknown[]): Entry[] {
  const out: Entry[] = [];
  let i = 0;
  let j = 0;
  while (i < gA.length && j < gB.length) {
    if (category(A[gA[i]]) === category(B[gB[j]])) out.push({ a: gA[i++], b: gB[j++] });
    else out.push({ a: gA[i++] });
  }
  while (i < gA.length) out.push({ a: gA[i++] });
  while (j < gB.length) out.push({ b: gB[j++] });
  return out;
}

function range(from: number, to: number): number[] {
  const r: number[] = [];
  for (let i = from; i < to; i++) r.push(i);
  return r;
}

/** Myers O(ND): trả về các cặp khớp (tăng dần) hoặc null nếu khoảng cách sửa > maxD. */
function myers(a: Int32Array, b: Int32Array, maxD: number): [number, number][] | null {
  const N = a.length;
  const M = b.length;
  const max = Math.min(N + M, maxD);
  const off = max + 1;
  let V = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(V.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }
      V[off + k] = x;
      if (x >= N && y >= M) {
        found = d;
        break;
      }
    }
  }
  V = new Int32Array(0);
  if (found < 0) return null;
  const out: [number, number][] = [];
  let x = N;
  let y = M;
  for (let d = found; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? k + 1 : k - 1;
    const px = v[off + prevK];
    const py = px - prevK;
    while (x > px && y > py) {
      out.push([x - 1, y - 1]);
      x--;
      y--;
    }
    if (d > 0) {
      x = px;
      y = py;
    }
  }
  return out.reverse();
}

function alignOrdered(ctx: Ctx, A: unknown[], B: unknown[], pp: string): Entry[] {
  const ep = pp + '[*]';
  let ids: { a: Int32Array; b: Int32Array } | null = null;
  if (ctx.tol === 0) {
    const m = new Map<string, number>();
    const idOf = (x: unknown) => {
      const c = canon(ctx, x, ep);
      let id = m.get(c);
      if (id === undefined) m.set(c, (id = m.size));
      return id;
    };
    ids = { a: Int32Array.from(A, idOf), b: Int32Array.from(B, idOf) };
  }
  const eq = (i: number, j: number) => (ids ? ids.a[i] === ids.b[j] : isEqualAt(ctx, A[i], B[j], ep));

  let pre = 0;
  const n = A.length;
  const m = B.length;
  while (pre < n && pre < m && eq(pre, pre)) pre++;
  let suf = 0;
  while (suf < n - pre && suf < m - pre && eq(n - 1 - suf, m - 1 - suf)) suf++;

  const nn = n - pre - suf;
  const mm = m - pre - suf;
  const matches: [number, number][] = [];
  for (let i = 0; i < pre; i++) matches.push([i, i]);
  const limit = ids ? MAX_LCS_CELLS : MAX_LCS_CELLS_SLOW;
  if (nn > 0 && mm > 0 && (nn + 1) * (mm + 1) <= limit) {
    const w = mm + 1;
    const L = new Uint16Array((nn + 1) * w);
    for (let i = nn - 1; i >= 0; i--) {
      for (let j = mm - 1; j >= 0; j--) {
        L[i * w + j] = eq(pre + i, pre + j)
          ? L[(i + 1) * w + j + 1] + 1
          : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < nn && j < mm) {
      if (eq(pre + i, pre + j) && L[i * w + j] === L[(i + 1) * w + j + 1] + 1) {
        matches.push([pre + i, pre + j]);
        i++;
        j++;
      } else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) i++;
      else j++;
    }
  }
  else if (ids && nn > 0 && mm > 0) {
    const mm2 = myers(ids.a.subarray(pre, n - suf), ids.b.subarray(pre, m - suf), MAX_MYERS_D);
    if (mm2) for (const [x, y] of mm2) matches.push([pre + x, pre + y]);
  }
  for (let k = 0; k < suf; k++) matches.push([n - suf + k, m - suf + k]);

  // trình tự mục: đảm bảo đơn điệu
  const entries: Entry[] = [];
  let ai = 0;
  let bj = 0;
  const emitGap = (toA: number, toB: number) => {
    if (ai < toA || bj < toB) entries.push(...pairGap(range(ai, toA), range(bj, toB), A, B));
  };
  // matches giữa prefix + giữa + suffix đã theo thứ tự tăng dần
  for (const [mi, mj] of matches) {
    emitGap(mi, mj);
    entries.push({ a: mi, b: mj, eq: true });
    ai = mi + 1;
    bj = mj + 1;
  }
  emitGap(n, m);
  detectMoves(ctx, entries, A, B, ep);
  return entries;
}

function detectMoves(ctx: Ctx, entries: Entry[], A: unknown[], B: unknown[], ep: string) {
  const rem = entries.filter((e) => e.a !== undefined && e.b === undefined);
  const add = entries.filter((e) => e.b !== undefined && e.a === undefined);
  if (!rem.length || !add.length) return;
  const map = new Map<string, Entry[]>();
  for (const e of rem) {
    const c = canon(ctx, A[e.a!], ep);
    const q = map.get(c);
    if (q) q.push(e);
    else map.set(c, [e]);
  }
  for (const e of add) {
    const q = map.get(canon(ctx, B[e.b!], ep));
    if (q && q.length) {
      const r = q.shift()!;
      r.moved = true;
      e.movedFrom = r.a;
    }
  }
}

function alignUnordered(ctx: Ctx, A: unknown[], B: unknown[], pp: string): Entry[] {
  const ep = pp + '[*]';
  const n = A.length;
  const m = B.length;
  const usedA = new Array<boolean>(n).fill(false);
  const matchB = new Array<number>(m).fill(-1);
  const eqFlag = new Array<boolean>(m).fill(false);
  const key = ctx.o.arrayKey.trim();
  const hasKey = (x: unknown) => key !== '' && typeOf(x) === 'object' && hasOwn(x as object, key);

  if (key) {
    const map = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      if (!hasKey(A[i])) continue;
      const kv = canon(ctx, (A[i] as Record<string, unknown>)[key], ep);
      const q = map.get(kv);
      if (q) q.push(i);
      else map.set(kv, [i]);
    }
    for (let j = 0; j < m; j++) {
      if (!hasKey(B[j])) continue;
      const q = map.get(canon(ctx, (B[j] as Record<string, unknown>)[key], ep));
      if (q && q.length) {
        const a = q.shift()!;
        matchB[j] = a;
        usedA[a] = true;
      }
    }
  }

  const restB = range(0, m).filter((j) => matchB[j] < 0);
  if (ctx.tol > 0 && restB.length * n <= MAX_LCS_CELLS_SLOW) {
    for (const j of restB) {
      for (let i = 0; i < n; i++) {
        if (!usedA[i] && isEqualAt(ctx, A[i], B[j], ep)) {
          matchB[j] = i;
          usedA[i] = true;
          eqFlag[j] = true;
          break;
        }
      }
    }
  } else {
    const map = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      if (usedA[i]) continue;
      const c = canon(ctx, A[i], ep);
      const q = map.get(c);
      if (q) q.push(i);
      else map.set(c, [i]);
    }
    for (const j of restB) {
      const q = map.get(canon(ctx, B[j], ep));
      if (q && q.length) {
        const a = q.shift()!;
        matchB[j] = a;
        usedA[a] = true;
        eqFlag[j] = true;
      }
    }
  }

  // ghép phần còn lại: container không có khóa
  const isFree = (x: unknown) => (category(x) !== 'prim') && !hasKey(x);
  const leftA = range(0, n).filter((i) => !usedA[i] && isFree(A[i]));
  const leftB = range(0, m).filter((j) => matchB[j] < 0 && isFree(B[j]));
  for (const e of pairGap(leftA, leftB, A, B)) {
    if (e.a !== undefined && e.b !== undefined) {
      matchB[e.b] = e.a;
      usedA[e.a] = true;
    }
  }

  const entries: Entry[] = [];
  for (let j = 0; j < m; j++) {
    if (matchB[j] >= 0) entries.push({ a: matchB[j], b: j, eq: eqFlag[j] });
    else entries.push({ b: j });
  }
  for (let i = 0; i < n; i++) if (!usedA[i]) entries.push({ a: i });
  return entries;
}

// ---------------------------------------------------------------------------
// Diff đệ quy
// ---------------------------------------------------------------------------

function same(key: PathSeg | null, v: unknown): MergedNode {
  return { key, status: 'same', type: typeOf(v), newValue: v };
}

function diffNode(
  a: unknown,
  b: unknown,
  ctx: Ctx,
  pp: string,
  dp: PathSeg[],
  pt: PathSeg[],
  key: PathSeg | null
): MergedNode {
  const ta = typeOf(a);
  const tb = typeOf(b);
  if (ta !== tb) {
    record(ctx, mkChange('type-changed', dp, a, b, true, true));
    pushOp(ctx, { op: 'replace', path: toPointer(pt), value: b });
    return { key, status: 'type-changed', type: tb, oldType: ta, oldValue: a, newValue: b };
  }
  if (ta === 'object') return diffObject(a as Record<string, unknown>, b as Record<string, unknown>, ctx, pp, dp, pt, key);
  if (ta === 'array') return diffArray(a as unknown[], b as unknown[], ctx, pp, dp, pt, key);
  if (leafEq(ctx, a, b)) return same(key, b);
  record(ctx, mkChange('changed', dp, a, b, true, true));
  pushOp(ctx, { op: 'replace', path: toPointer(pt), value: b });
  return { key, status: 'changed', type: tb, oldType: ta, oldValue: a, newValue: b };
}

function diffObject(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  ctx: Ctx,
  pp: string,
  dp: PathSeg[],
  pt: PathSeg[],
  key: PathSeg | null
): MergedNode {
  const before = ctx.count;
  const children: MergedNode[] = [];
  const seen = new Set<string>();
  const handle = (k: string) => {
    const inA = hasOwn(a, k);
    const inB = hasOwn(b, k);
    const av = inA ? a[k] : undefined;
    const bv = inB ? b[k] : undefined;
    const aMiss = !inA || missing(ctx, av);
    const bMiss = !inB || missing(ctx, bv);
    if (aMiss && bMiss) return;
    const kdp = [...dp, k];
    const kpt = [...pt, k];
    if (aMiss) {
      record(ctx, mkChange('added', kdp, undefined, bv, false, true));
      pushOp(ctx, { op: inA ? 'replace' : 'add', path: toPointer(kpt), value: bv });
      children.push({ key: k, status: 'added', type: typeOf(bv), newValue: bv });
    } else if (bMiss) {
      record(ctx, mkChange('removed', kdp, av, undefined, true, false));
      if (inB) pushOp(ctx, { op: 'replace', path: toPointer(kpt), value: bv });
      else pushOp(ctx, { op: 'remove', path: toPointer(kpt) });
      children.push({ key: k, status: 'removed', type: typeOf(av), oldValue: av });
    } else {
      children.push(diffNode(av, bv, ctx, pp + keySeg(k), kdp, kpt, k));
    }
  };
  for (const k of Object.keys(b)) {
    if (isIgnored(ctx, k, pp)) continue;
    seen.add(k);
    handle(k);
  }
  for (const k of Object.keys(a)) {
    if (seen.has(k) || isIgnored(ctx, k, pp)) continue;
    handle(k);
  }
  if (ctx.count === before) return same(key, b);
  return { key, status: 'container', type: 'object', newValue: b, children };
}

function diffArray(
  A: unknown[],
  B: unknown[],
  ctx: Ctx,
  pp: string,
  dp: PathSeg[],
  pt: PathSeg[],
  key: PathSeg | null
): MergedNode {
  const before = ctx.count;
  const ordered = !ctx.o.ignoreArrayOrder;
  const entries = ordered ? alignOrdered(ctx, A, B, pp) : alignUnordered(ctx, A, B, pp);
  const ep = pp + '[*]';
  const children: MergedNode[] = [];

  // Pha 1: xóa theo chỉ số giảm dần (không ảnh hưởng các chỉ số còn lại)
  const removedIdx = entries
    .filter((e) => e.a !== undefined && e.b === undefined)
    .map((e) => e.a!)
    .sort((x, y) => y - x);
  for (const i of removedIdx) pushOp(ctx, { op: 'remove', path: toPointer([...pt, i]) });

  // thứ hạng của mục giữ lại (chế độ không thứ tự)
  const removedAsc = [...removedIdx].reverse();
  const rankOf = (i: number) => {
    // số phần tử của removedAsc nhỏ hơn i (nhị phân)
    let lo = 0;
    let hi = removedAsc.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (removedAsc[mid] < i) lo = mid + 1;
      else hi = mid;
    }
    return i - lo;
  };

  const deferredAdds: PatchOp[] = [];
  for (const e of entries) {
    if (e.a !== undefined && e.b === undefined) {
      if (e.moved) continue;
      const v = A[e.a];
      record(ctx, mkChange('removed', [...dp, e.a], v, undefined, true, false));
      children.push({ key: e.a, status: 'removed', type: typeOf(v), oldValue: v });
    } else if (e.a === undefined && e.b !== undefined) {
      const v = B[e.b];
      const op: PatchOp = ordered
        ? { op: 'add', path: toPointer([...pt, e.b]), value: v }
        : { op: 'add', path: toPointer([...pt, '-']), value: v };
      if (ordered) pushOp(ctx, op);
      else deferredAdds.push(op);
      if (e.movedFrom !== undefined) {
        const ch = mkChange('moved', [...dp, e.b], A[e.movedFrom], v, true, true);
        ch.fromJsonPath = toJsonPath([...dp, e.movedFrom]);
        ch.fromPointer = toPointer([...dp, e.movedFrom]);
        record(ctx, ch);
        children.push({ key: e.b, status: 'moved', type: typeOf(v), newValue: v, fromIndex: e.movedFrom });
      } else {
        record(ctx, mkChange('added', [...dp, e.b], undefined, v, false, true));
        children.push({ key: e.b, status: 'added', type: typeOf(v), newValue: v });
      }
    } else {
      const bi = e.b!;
      if (e.eq) {
        children.push(same(bi, B[bi]));
      } else {
        const idx = ordered ? bi : rankOf(e.a!);
        children.push(diffNode(A[e.a!], B[bi], ctx, ep, [...dp, bi], [...pt, idx], bi));
      }
    }
  }
  for (const op of deferredAdds) pushOp(ctx, op);

  if (ctx.count === before) return same(key, B);
  return { key, status: 'container', type: 'array', newValue: B, children };
}

// ---------------------------------------------------------------------------
// API công khai
// ---------------------------------------------------------------------------

export function diffJson(a: unknown, b: unknown, options: Partial<DiffOptions> = {}): DiffResult {
  const o: DiffOptions = { ...DEFAULT_DIFF_OPTIONS, ...options };
  const ctx = mkCtx(o, false);
  let merged: MergedNode;
  try {
    merged = diffNode(a, b, ctx, '$', [], [], null);
  } catch (e) {
    if (e === STOP) {
      merged = { key: null, status: 'container', type: typeOf(b), newValue: b, children: [] };
    } else if (e instanceof RangeError) {
      return {
        changes: [],
        patch: [],
        merged: same(null, b),
        counts: ctx.counts,
        truncated: false,
        error: 'Dữ liệu lồng quá sâu để so sánh.',
      };
    } else throw e;
  }
  return { changes: ctx.changes, patch: ctx.ops, merged, counts: ctx.counts, truncated: ctx.truncated };
}

/** Hai giá trị có bằng nhau theo các tùy chọn không. */
export function isEqualJson(a: unknown, b: unknown, options: Partial<DiffOptions> = {}): boolean {
  const o: DiffOptions = { ...DEFAULT_DIFF_OPTIONS, ...options };
  const ctx = mkCtx(o, true);
  try {
    diffNode(a, b, ctx, '$', [], [], null);
    return true;
  } catch (e) {
    if (e === EARLY) return false;
    if (e instanceof RangeError) return false;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// RFC 6902: áp dụng patch
// ---------------------------------------------------------------------------

function cloneJson<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

function setKey(o: Record<string, unknown>, k: string, v: unknown) {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => deepEq(x, bb[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => hasOwn(b, k) && deepEq((a as never)[k], (b as never)[k]));
}

const ARR_IDX = /^(0|[1-9]\d*)$/;

export type ApplyResult = { ok: true; result: unknown } | { ok: false; error: string; index: number };

class PatchError extends Error {}

function locate(root: unknown, toks: string[]): { parent: unknown; last: string } {
  let cur = root;
  for (let i = 0; i < toks.length - 1; i++) {
    const t = toks[i];
    if (Array.isArray(cur)) {
      if (!ARR_IDX.test(t) || Number(t) >= cur.length) throw new PatchError(`Không tìm thấy đường dẫn tại "${t}"`);
      cur = cur[Number(t)];
    } else if (cur && typeof cur === 'object' && hasOwn(cur, t)) cur = (cur as Record<string, unknown>)[t];
    else throw new PatchError(`Không tìm thấy đường dẫn tại "${t}"`);
  }
  return { parent: cur, last: toks[toks.length - 1] };
}

function getAt(root: unknown, toks: string[]): unknown {
  if (toks.length === 0) return root;
  const { parent, last } = locate(root, toks);
  if (Array.isArray(parent)) {
    if (!ARR_IDX.test(last) || Number(last) >= parent.length) throw new PatchError(`Chỉ số mảng không hợp lệ: ${last}`);
    return parent[Number(last)];
  }
  if (parent && typeof parent === 'object' && hasOwn(parent, last)) return (parent as Record<string, unknown>)[last];
  throw new PatchError(`Không tìm thấy khóa "${last}"`);
}

function addAt(root: unknown, toks: string[], value: unknown): unknown {
  if (toks.length === 0) return value;
  const { parent, last } = locate(root, toks);
  if (Array.isArray(parent)) {
    if (last === '-') parent.push(value);
    else {
      if (!ARR_IDX.test(last) || Number(last) > parent.length) throw new PatchError(`Chỉ số mảng ngoài phạm vi: ${last}`);
      parent.splice(Number(last), 0, value);
    }
  } else if (parent && typeof parent === 'object') setKey(parent as Record<string, unknown>, last, value);
  else throw new PatchError('Không thể thêm vào giá trị nguyên thủy');
  return root;
}

function removeAt(root: unknown, toks: string[]): unknown {
  if (toks.length === 0) throw new PatchError('Không thể xóa gốc tài liệu');
  const { parent, last } = locate(root, toks);
  if (Array.isArray(parent)) {
    if (!ARR_IDX.test(last) || Number(last) >= parent.length) throw new PatchError(`Chỉ số mảng ngoài phạm vi: ${last}`);
    parent.splice(Number(last), 1);
  } else if (parent && typeof parent === 'object' && hasOwn(parent, last)) delete (parent as Record<string, unknown>)[last];
  else throw new PatchError(`Không tìm thấy khóa "${last}" để xóa`);
  return root;
}

/** Áp dụng JSON Patch (RFC 6902) tuần tự lên bản sao của `doc`. Không ném lỗi. */
export function applyPatch(doc: unknown, ops: PatchOp[]): ApplyResult {
  let cur: unknown = cloneJson(doc);
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    try {
      const toks = parsePointer(op.path);
      if (!toks) throw new PatchError(`JSON Pointer không hợp lệ: "${op.path}"`);
      switch (op.op) {
        case 'add':
          cur = addAt(cur, toks, cloneJson(op.value));
          break;
        case 'remove':
          cur = removeAt(cur, toks);
          break;
        case 'replace': {
          getAt(cur, toks); // phải tồn tại
          if (toks.length === 0) cur = cloneJson(op.value);
          else {
            const { parent, last } = locate(cur, toks);
            if (Array.isArray(parent)) parent[Number(last)] = cloneJson(op.value);
            else setKey(parent as Record<string, unknown>, last, cloneJson(op.value));
          }
          break;
        }
        case 'move':
        case 'copy': {
          const from = parsePointer(op.from ?? '');
          if (!from || op.from === undefined) throw new PatchError('Thiếu hoặc sai trường "from"');
          if (op.op === 'move' && toks.length > from.length && from.every((t, k) => toks[k] === t))
            throw new PatchError('Không thể di chuyển vào chính nó');
          const v = cloneJson(getAt(cur, from));
          if (op.op === 'move') cur = removeAt(cur, from);
          cur = addAt(cur, toks, v);
          break;
        }
        case 'test':
          if (!deepEq(getAt(cur, toks), op.value)) throw new PatchError('Giá trị kiểm tra không khớp');
          break;
        default:
          throw new PatchError(`Thao tác không hỗ trợ: ${String((op as PatchOp).op)}`);
      }
    } catch (e) {
      const msg = e instanceof PatchError ? e.message : 'Lỗi không xác định';
      return { ok: false, error: `Thao tác #${i + 1} (${op.op} ${op.path}): ${msg}`, index: i };
    }
  }
  return { ok: true, result: cur };
}

// ---------------------------------------------------------------------------
// Tóm tắt văn bản
// ---------------------------------------------------------------------------

export function previewValue(v: unknown, max = 100): string {
  let s: string;
  try {
    s = JSON.stringify(v) ?? 'undefined';
  } catch {
    s = String(v);
  }
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export function summarizeText(res: DiffResult): string {
  const c = res.counts;
  const lines: string[] = [];
  lines.push(
    `Tổng ${c.total} thay đổi: ${c.added} thêm, ${c.removed} xóa, ${c.changed} sửa, ${c.typeChanged} đổi kiểu, ${c.moved} di chuyển.`
  );
  if (res.truncated) lines.push(`(Đã cắt bớt: chỉ hiển thị ${MAX_CHANGES} thay đổi đầu tiên)`);
  for (const ch of res.changes) {
    switch (ch.kind) {
      case 'added':
        lines.push(`+ ${ch.jsonPath}: ${previewValue(ch.newValue)}`);
        break;
      case 'removed':
        lines.push(`- ${ch.jsonPath}: ${previewValue(ch.oldValue)}`);
        break;
      case 'changed':
        lines.push(`~ ${ch.jsonPath}: ${previewValue(ch.oldValue)} -> ${previewValue(ch.newValue)}`);
        break;
      case 'type-changed':
        lines.push(
          `! ${ch.jsonPath}: ${ch.oldType} -> ${ch.newType} (${previewValue(ch.oldValue, 60)} -> ${previewValue(ch.newValue, 60)})`
        );
        break;
      case 'moved':
        lines.push(`> ${ch.fromJsonPath} => ${ch.jsonPath}: ${previewValue(ch.newValue, 80)}`);
        break;
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Mẫu
// ---------------------------------------------------------------------------

export const SAMPLE_A = `{
  "name": "getools",
  "version": "1.0.0",
  "private": true,
  "tags": ["web", "tools", "vi"],
  "author": { "name": "An", "email": "an@example.com" },
  "users": [
    { "id": 1, "name": "An", "role": "admin", "score": 9.5 },
    { "id": 2, "name": "Bình", "role": "user", "score": 7 },
    { "id": 3, "name": "Chi", "role": "user", "score": 8 }
  ],
  "limit": 100,
  "debug": null
}`;

export const SAMPLE_B = `{
  "version": "1.1.0",
  "name": "getools",
  "tags": ["vi", "web", "tools", "dev"],
  "author": { "name": "An", "email": "an@getools.dev", "url": "https://getools.dev" },
  "users": [
    { "id": 3, "name": "Chi", "role": "user", "score": 8.0001 },
    { "id": 1, "name": "An", "role": "owner", "score": 9.5 },
    { "id": 4, "name": "Dũng", "role": "user", "score": 6 }
  ],
  "limit": "100",
  "private": true
}`;

// ---------------------------------------------------------------------------
// Chuẩn bị để hiển thị song song
// ---------------------------------------------------------------------------

/** Bỏ khóa bị ignore, sắp xếp khóa, (tùy chọn) sắp xếp mảng để so sánh văn bản trực quan. */
export function prepareForView(v: unknown, options: Partial<DiffOptions> = {}): unknown {
  const o: DiffOptions = { ...DEFAULT_DIFF_OPTIONS, ...options };
  const ctx = mkCtx(o, true);
  const walk = (x: unknown, pp: string, depth: number): unknown => {
    if (depth > 500) return x;
    if (Array.isArray(x)) {
      const items = x.map((e) => walk(e, pp + '[*]', depth + 1));
      if (o.ignoreArrayOrder) {
        const keyed = items.map((e) => [canon(ctx, e, pp + '[*]'), e] as const);
        keyed.sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0));
        return keyed.map((p) => p[1]);
      }
      return items;
    }
    if (x && typeof x === 'object') {
      const src = x as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(src).sort()) {
        if (isIgnored(ctx, k, pp)) continue;
        if (o.nullAsMissing && src[k] === null) continue;
        setKey(out, k, walk(src[k], pp + keySeg(k), depth + 1));
      }
      return out;
    }
    return x;
  };
  try {
    return walk(v, '$', 0);
  } catch {
    return v;
  }
}
