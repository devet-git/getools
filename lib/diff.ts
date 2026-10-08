export type DiffKind = 'equal' | 'add' | 'remove';

export interface DiffOptions {
  ignoreCase: boolean;
  ignoreWhitespace: boolean;
  ignoreBlankLines: boolean;
}

export const DEFAULT_DIFF_OPTIONS: DiffOptions = {
  ignoreCase: false,
  ignoreWhitespace: false,
  ignoreBlankLines: false,
};

export interface Segment {
  kind: DiffKind;
  text: string;
}

export interface DiffRow {
  kind: DiffKind;
  /** Số dòng bên trái (file gốc), null nếu dòng chỉ có ở bên phải */
  leftNo: number | null;
  /** Số dòng bên phải (file mới), null nếu dòng chỉ có ở bên trái */
  rightNo: number | null;
  text: string;
  /** Chi tiết khác biệt theo từ khi một dòng bị sửa (chỉ có khi ghép cặp remove/add) */
  segments?: Segment[];
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
  similarity: number;
}

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function normalize(line: string, opts: DiffOptions): string {
  let s = line;
  if (opts.ignoreWhitespace) s = s.replace(/\s+/g, ' ').trim();
  if (opts.ignoreCase) s = s.toLowerCase();
  return s;
}

/** LCS diff trên mảng khóa đã chuẩn hóa. Trả về danh sách thao tác theo chỉ số. */
function diffSequences(a: string[], b: string[]): { kind: DiffKind; ai: number; bi: number }[] {
  // Cắt phần đầu / cuối giống nhau để giảm kích thước bảng LCS
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ops: { kind: DiffKind; ai: number; bi: number }[] = [];
  for (let i = 0; i < start; i++) ops.push({ kind: 'equal', ai: i, bi: i });

  const n = endA - start;
  const m = endB - start;

  if (n * m > 25_000_000) {
    // Quá lớn cho LCS đầy đủ: coi toàn bộ phần giữa là thay thế
    for (let i = start; i < endA; i++) ops.push({ kind: 'remove', ai: i, bi: -1 });
    for (let j = start; j < endB; j++) ops.push({ kind: 'add', ai: -1, bi: j });
  } else {
    const w = m + 1;
    const table = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * w + j] =
          a[start + i] === b[start + j]
            ? table[(i + 1) * w + j + 1] + 1
            : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        ops.push({ kind: 'equal', ai: start + i, bi: start + j });
        i++;
        j++;
      } else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) {
        ops.push({ kind: 'remove', ai: start + i, bi: -1 });
        i++;
      } else {
        ops.push({ kind: 'add', ai: -1, bi: start + j });
        j++;
      }
    }
    while (i < n) ops.push({ kind: 'remove', ai: start + i++, bi: -1 });
    while (j < m) ops.push({ kind: 'add', ai: -1, bi: start + j++ });
  }

  for (let k = 0; endA + k < a.length; k++) {
    ops.push({ kind: 'equal', ai: endA + k, bi: endB + k });
  }
  return ops;
}

/** So sánh theo từ/khoảng trắng để làm nổi bật phần khác nhau trong một dòng bị sửa. */
function diffWords(left: string, right: string, opts: DiffOptions): { l: Segment[]; r: Segment[] } {
  const tokenize = (s: string) => s.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
  const ta = tokenize(left);
  const tb = tokenize(right);
  const keyA = ta.map((t) => normalize(t, opts));
  const keyB = tb.map((t) => normalize(t, opts));
  const ops = diffSequences(keyA, keyB);

  const l: Segment[] = [];
  const r: Segment[] = [];
  const push = (arr: Segment[], kind: DiffKind, text: string) => {
    const last = arr[arr.length - 1];
    if (last && last.kind === kind) last.text += text;
    else arr.push({ kind, text });
  };
  for (const op of ops) {
    if (op.kind === 'equal') {
      push(l, 'equal', ta[op.ai]);
      push(r, 'equal', tb[op.bi]);
    } else if (op.kind === 'remove') {
      push(l, 'remove', ta[op.ai]);
    } else {
      push(r, 'add', tb[op.bi]);
    }
  }
  return { l, r };
}

export function computeDiff(
  leftText: string,
  rightText: string,
  opts: DiffOptions = DEFAULT_DIFF_OPTIONS
): { rows: DiffRow[]; stats: DiffStats } {
  const left = splitLines(leftText);
  const right = splitLines(rightText);

  const keep = (line: string) => !(opts.ignoreBlankLines && line.trim() === '');
  const leftIdx = left.map((_, i) => i).filter((i) => keep(left[i]));
  const rightIdx = right.map((_, i) => i).filter((i) => keep(right[i]));

  const ops = diffSequences(
    leftIdx.map((i) => normalize(left[i], opts)),
    rightIdx.map((i) => normalize(right[i], opts))
  );

  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  let k = 0;
  while (k < ops.length) {
    const op = ops[k];
    if (op.kind === 'equal') {
      const li = leftIdx[op.ai];
      const ri = rightIdx[op.bi];
      rows.push({ kind: 'equal', leftNo: li + 1, rightNo: ri + 1, text: right[ri] });
      unchanged++;
      k++;
      continue;
    }
    // Gom một khối thay đổi liên tiếp rồi ghép cặp remove[i] <-> add[i]
    const removes: number[] = [];
    const adds: number[] = [];
    while (k < ops.length && ops[k].kind !== 'equal') {
      if (ops[k].kind === 'remove') removes.push(leftIdx[ops[k].ai]);
      else adds.push(rightIdx[ops[k].bi]);
      k++;
    }
    const paired = Math.min(removes.length, adds.length);
    const removeRows: DiffRow[] = removes.map((li) => ({
      kind: 'remove',
      leftNo: li + 1,
      rightNo: null,
      text: left[li],
    }));
    const addRows: DiffRow[] = adds.map((ri) => ({
      kind: 'add',
      leftNo: null,
      rightNo: ri + 1,
      text: right[ri],
    }));
    for (let p = 0; p < paired; p++) {
      const { l, r } = diffWords(removeRows[p].text, addRows[p].text, opts);
      // Chỉ hiển thị chi tiết từ khi hai dòng còn giống nhau một phần đáng kể
      const common = l.filter((s) => s.kind === 'equal').reduce((n, s) => n + s.text.length, 0);
      const longest = Math.max(removeRows[p].text.length, addRows[p].text.length);
      if (longest > 0 && common / longest >= 0.3) {
        removeRows[p].segments = l;
        addRows[p].segments = r;
      }
    }
    rows.push(...removeRows, ...addRows);
    removed += removes.length;
    added += adds.length;
  }

  const total = unchanged * 2 + added + removed;
  const similarity = total === 0 ? 100 : Math.round(((unchanged * 2) / total) * 1000) / 10;
  return { rows, stats: { added, removed, unchanged, similarity } };
}

/** Xuất diff dạng unified (giống `diff -u`) để sao chép / tải về. */
export function toUnifiedDiff(
  rows: DiffRow[],
  leftName: string,
  rightName: string,
  context = 3
): string {
  const out: string[] = [`--- ${leftName}`, `+++ ${rightName}`];
  const changed = rows.map((r) => r.kind !== 'equal');
  if (!changed.some(Boolean)) return out.join('\n') + '\n';

  const include = new Array(rows.length).fill(false);
  changed.forEach((c, i) => {
    if (!c) return;
    for (let d = -context; d <= context; d++) {
      if (i + d >= 0 && i + d < rows.length) include[i + d] = true;
    }
  });

  let i = 0;
  while (i < rows.length) {
    if (!include[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && include[j]) j++;
    const hunk = rows.slice(i, j);
    const leftRows = hunk.filter((r) => r.leftNo !== null);
    const rightRows = hunk.filter((r) => r.rightNo !== null);
    const lStart = leftRows.length ? leftRows[0].leftNo! : (rows[i].leftNo ?? 0);
    const rStart = rightRows.length ? rightRows[0].rightNo! : (rows[i].rightNo ?? 0);
    out.push(`@@ -${lStart},${leftRows.length} +${rStart},${rightRows.length} @@`);
    for (const r of hunk) {
      out.push((r.kind === 'add' ? '+' : r.kind === 'remove' ? '-' : ' ') + r.text);
    }
    i = j;
  }
  return out.join('\n') + '\n';
}
