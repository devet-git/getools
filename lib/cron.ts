/**
 * Phân tích biểu thức cron (kiểu Vixie), giải thích tiếng Việt và tính các lần chạy kế tiếp.
 * Không phụ thuộc React.
 */
import { getWallParts, utcFromParts, wallExists, zonedToInstant } from './time-tools';

export type FieldKey = 'second' | 'minute' | 'hour' | 'dom' | 'month' | 'dow';

export const FIELD_LABEL: Record<FieldKey, string> = {
  second: 'Giây',
  minute: 'Phút',
  hour: 'Giờ',
  dom: 'Ngày trong tháng',
  month: 'Tháng',
  dow: 'Thứ trong tuần',
};

const FIELD_RANGE: Record<FieldKey, [number, number]> = {
  second: [0, 59],
  minute: [0, 59],
  hour: [0, 23],
  dom: [1, 31],
  month: [1, 12],
  dow: [0, 7],
};

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DOW_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DOW_VI = ['Chủ nhật', 'thứ Hai', 'thứ Ba', 'thứ Tư', 'thứ Năm', 'thứ Sáu', 'thứ Bảy'];

const ALIASES: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

export interface CronItem {
  from: number;
  to: number;
  step: number;
  kind: 'any' | 'single' | 'range' | 'step';
  raw: string;
}

export interface CronField {
  key: FieldKey;
  raw: string;
  items: CronItem[];
  values: number[]; // đã sắp xếp, dow đã chuẩn hoá 7 -> 0
  set: Set<number>;
  star: boolean; // bắt đầu bằng * hoặc ? (quy tắc Vixie cho dom/dow)
  isAll: boolean; // chứa mọi giá trị
}

export interface CronSpec {
  hasSeconds: boolean;
  second: CronField;
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
  expression: string; // sau khi mở alias
}

export interface CronError {
  field: FieldKey | 'all';
  message: string;
}

export type ParseResult = { ok: true; spec: CronSpec } | { ok: false; errors: CronError[] };

function parseValue(tok: string, key: FieldKey): number | null {
  const t = tok.toUpperCase();
  if (key === 'month') {
    const i = MONTH_NAMES.indexOf(t);
    if (i >= 0) return i + 1;
  }
  if (key === 'dow') {
    const i = DOW_NAMES.indexOf(t);
    if (i >= 0) return i;
  }
  if (!/^\d+$/.test(t)) return null;
  return parseInt(t, 10);
}

function parseField(raw: string, key: FieldKey, errors: CronError[]): CronField {
  const [lo, hi] = FIELD_RANGE[key];
  const label = FIELD_LABEL[key];
  const items: CronItem[] = [];
  const set = new Set<number>();
  const startErr = errors.length;

  if (raw === '') {
    errors.push({ field: key, message: `Trường "${label}" đang trống.` });
  }
  for (const part of raw.split(',')) {
    if (part === '') {
      errors.push({ field: key, message: `Trường "${label}" có phần tử rỗng (dấu phẩy thừa).` });
      continue;
    }
    const [rangePart, stepPart, ...extra] = part.split('/');
    if (extra.length > 0) {
      errors.push({ field: key, message: `"${part}" ở trường "${label}" có quá nhiều dấu "/".` });
      continue;
    }
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || parseInt(stepPart, 10) < 1) {
        errors.push({ field: key, message: `Bước nhảy "${stepPart}" ở trường "${label}" không hợp lệ (phải là số nguyên ≥ 1).` });
        continue;
      }
      step = parseInt(stepPart, 10);
    }
    let from: number, to: number;
    let kind: CronItem['kind'];
    if (rangePart === '*' || rangePart === '?') {
      if (rangePart === '?' && key !== 'dom' && key !== 'dow') {
        errors.push({ field: key, message: `Ký tự "?" chỉ dùng được ở trường ngày/thứ.` });
        continue;
      }
      from = lo;
      to = key === 'dow' ? 6 : hi;
      kind = stepPart !== undefined ? 'step' : 'any';
    } else if (rangePart.includes('-')) {
      const [a, b, ...more] = rangePart.split('-');
      const va = parseValue(a, key);
      const vb = parseValue(b ?? '', key);
      if (more.length > 0 || va === null || vb === null) {
        errors.push({ field: key, message: `Khoảng "${rangePart}" ở trường "${label}" không hợp lệ.` });
        continue;
      }
      if (va < lo || va > hi || vb < lo || vb > hi) {
        errors.push({ field: key, message: `Giá trị "${rangePart}" ngoài phạm vi ${lo}-${hi} của trường "${label}".` });
        continue;
      }
      if (va > vb) {
        errors.push({ field: key, message: `Khoảng "${rangePart}" ở trường "${label}" có đầu lớn hơn cuối.` });
        continue;
      }
      from = va;
      to = vb;
      kind = stepPart !== undefined ? 'step' : 'range';
    } else {
      const v = parseValue(rangePart, key);
      if (v === null) {
        errors.push({ field: key, message: `Giá trị "${rangePart}" ở trường "${label}" không hợp lệ.` });
        continue;
      }
      if (v < lo || v > hi) {
        errors.push({ field: key, message: `Giá trị ${v} ngoài phạm vi ${lo}-${hi} của trường "${label}".` });
        continue;
      }
      from = v;
      to = stepPart !== undefined ? (key === 'dow' ? 6 : hi) : v;
      kind = stepPart !== undefined ? 'step' : 'single';
    }
    items.push({ from, to, step, kind, raw: part });
    for (let v = from; v <= to; v += step) set.add(key === 'dow' && v === 7 ? 0 : v);
  }

  const total = key === 'dow' ? 7 : hi - lo + 1;
  const values = Array.from(set).sort((a, b) => a - b);
  return {
    key,
    raw,
    items: errors.length > startErr ? [] : items,
    values,
    set,
    star: raw.startsWith('*') || raw.startsWith('?'),
    isAll: values.length >= total,
  };
}

export function parseCron(input: string, hasSeconds = false): ParseResult {
  let expr = input.trim().replace(/\s+/g, ' ');
  if (!expr) return { ok: false, errors: [{ field: 'all', message: 'Hãy nhập biểu thức cron.' }] };
  if (expr.startsWith('@')) {
    const a = ALIASES[expr.toLowerCase()];
    if (!a) {
      return { ok: false, errors: [{ field: 'all', message: `Bí danh "${expr}" không được hỗ trợ (dùng @yearly, @monthly, @weekly, @daily, @hourly).` }] };
    }
    expr = hasSeconds ? `0 ${a}` : a;
  }
  const tokens = expr.split(' ');
  const need = hasSeconds ? 6 : 5;
  if (tokens.length !== need) {
    return {
      ok: false,
      errors: [{
        field: 'all',
        message: hasSeconds
          ? `Cron có giây cần đúng 6 trường (giây phút giờ ngày tháng thứ), hiện có ${tokens.length}.`
          : `Cron chuẩn cần đúng 5 trường (phút giờ ngày tháng thứ), hiện có ${tokens.length}.${
              tokens.length === 6 ? ' Nếu có trường giây, hãy bật "Có trường giây".' : ''
            }`,
      }],
    };
  }
  const errors: CronError[] = [];
  let i = 0;
  const secRaw = hasSeconds ? tokens[i++] : '0';
  const second = parseField(secRaw, 'second', errors);
  const minute = parseField(tokens[i++], 'minute', errors);
  const hour = parseField(tokens[i++], 'hour', errors);
  const dom = parseField(tokens[i++], 'dom', errors);
  const month = parseField(tokens[i++], 'month', errors);
  const dow = parseField(tokens[i++], 'dow', errors);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, spec: { hasSeconds, second, minute, hour, dom, month, dow, expression: expr } };
}

/* ---------------- Tính lần chạy kế tiếp ---------------- */

function dayMatches(spec: CronSpec, y: number, mo: number, d: number): boolean {
  const dow = new Date(utcFromParts(y, mo, d)).getUTCDay();
  const domOk = spec.dom.set.has(d);
  const dowOk = spec.dow.set.has(dow);
  // Vixie: nếu cả hai đều bị giới hạn (không bắt đầu bằng *) thì khớp khi MỘT TRONG HAI khớp.
  if (!spec.dom.star && !spec.dow.star) return domOk || dowOk;
  return domOk && dowOk;
}

/** Tìm giờ treo tường kế tiếp (dạng "UTC giả") lớn hơn `after`. */
function nextWall(spec: CronSpec, after: number): number | null {
  let t = Math.floor(after / 1000) * 1000 + 1000;
  const limit = after + 13 * 366 * 86400000;
  while (t <= limit) {
    const d = new Date(t);
    const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, day = d.getUTCDate();
    const h = d.getUTCHours(), mi = d.getUTCMinutes(), s = d.getUTCSeconds();
    if (!spec.month.set.has(mo)) { t = utcFromParts(y, mo + 1, 1); continue; }
    if (!dayMatches(spec, y, mo, day)) { t = utcFromParts(y, mo, day + 1); continue; }
    if (!spec.hour.set.has(h)) { t = utcFromParts(y, mo, day, h + 1); continue; }
    if (!spec.minute.set.has(mi)) { t = utcFromParts(y, mo, day, h, mi + 1); continue; }
    if (!spec.second.set.has(s)) { t = utcFromParts(y, mo, day, h, mi, s + 1); continue; }
    return t;
  }
  return null;
}

/**
 * Các lần chạy kế tiếp (ms epoch) sau `fromMs` (không tính chính nó) trong múi giờ tz.
 * Giờ rơi vào khoảng trống DST bị bỏ qua; giờ lặp khi lùi đồng hồ chỉ chạy một lần.
 */
export function nextRuns(spec: CronSpec, tz: string, fromMs: number, count: number): number[] {
  const out: number[] = [];
  const p = getWallParts(fromMs, tz);
  let wall = utcFromParts(p.year, p.month, p.day, p.hour, p.minute, p.second);
  let lastInst = fromMs;
  let guard = 0;
  while (out.length < count && guard++ < count * 400 + 2000) {
    const w = nextWall(spec, wall);
    if (w === null) break;
    wall = w;
    const d = new Date(w);
    const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, day = d.getUTCDate();
    const h = d.getUTCHours(), mi = d.getUTCMinutes(), s = d.getUTCSeconds();
    if (!wallExists(y, mo, day, h, mi, s, tz)) continue;
    const inst = zonedToInstant(y, mo, day, h, mi, s, tz);
    if (inst <= lastInst) continue;
    out.push(inst);
    lastInst = inst;
  }
  return out;
}

/* ---------------- Giải thích tiếng Việt ---------------- */

const pad2 = (n: number) => String(n).padStart(2, '0');

function joinVi(list: string[]): string {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} và ${list[list.length - 1]}`;
}

function isSingles(f: CronField): boolean {
  return f.items.length > 0 && f.items.every((i) => i.kind === 'single');
}

function describeItems(f: CronField, fmt: (v: number) => string, unit: string): string {
  const parts = f.items.map((it) => {
    switch (it.kind) {
      case 'any': return `mọi ${unit}`;
      case 'single': return fmt(it.from);
      case 'range': return `từ ${fmt(it.from)} đến ${fmt(it.to)}`;
      case 'step': {
        const full = it.from === FIELD_RANGE[f.key][0];
        return full
          ? `mỗi ${it.step} ${unit}`
          : `mỗi ${it.step} ${unit} từ ${fmt(it.from)} đến ${fmt(it.to)}`;
      }
    }
  });
  return joinVi(parts);
}

function hourPhrase(hour: CronField): string {
  const text = describeItems(hour, (v) => `${v}h`, 'giờ');
  return hour.items.length === 1 && hour.items[0].kind === 'step' ? text : `các giờ ${text}`;
}

function describeTime(spec: CronSpec): string {
  const { minute, hour, second } = spec;
  let secText = '';
  if (spec.hasSeconds) {
    if (second.raw === '0') secText = '';
    else if (second.isAll && second.items.length === 1 && second.items[0].kind === 'any') secText = 'mỗi giây';
    else secText = `giây ${describeItems(second, (v) => String(v), 'giây')}`;
  }
  const secClock = (m: number, h: number) =>
    spec.hasSeconds && second.raw !== '0' && isSingles(second) && second.values.length === 1
      ? `${pad2(h)}:${pad2(m)}:${pad2(second.values[0])}`
      : `${pad2(h)}:${pad2(m)}`;

  const minAny = minute.items.length === 1 && minute.items[0].kind === 'any';
  const hourAny = hour.items.length === 1 && hour.items[0].kind === 'any';

  let base: string;
  if (hourAny) {
    if (minAny) {
      base = spec.hasSeconds && secText ? (secText === 'mỗi giây' ? 'Mỗi giây' : `Mỗi phút, ${secText}`) : 'Mỗi phút';
      return base;
    }
    if (minute.items.length === 1 && minute.items[0].kind === 'step' && minute.items[0].from === 0) {
      base = `Mỗi ${minute.items[0].step} phút`;
    } else if (isSingles(minute) && minute.values.length === 1) {
      base = minute.values[0] === 0 ? 'Vào đầu mỗi giờ (phút 00)' : `Vào phút thứ ${minute.values[0]} của mỗi giờ`;
    } else {
      base = `Vào phút ${describeItems(minute, String, 'phút')} của mỗi giờ`;
    }
  } else if (isSingles(minute) && isSingles(hour) && minute.values.length * hour.values.length <= 8) {
    const times: string[] = [];
    for (const h of hour.values) for (const m of minute.values) times.push(secClock(m, h));
    return `Vào lúc ${joinVi(times)}${secText && !/^\d/.test(secText) && times[0].length === 5 ? `, ${secText}` : ''}`;
  } else if (minAny) {
    if (isSingles(hour) && hour.values.length === 1) {
      base = `Mỗi phút từ ${pad2(hour.values[0])}:00 đến ${pad2(hour.values[0])}:59`;
    } else {
      base = `Mỗi phút trong ${hourPhrase(hour)}`;
    }
  } else if (isSingles(minute) && minute.values.length === 1) {
    base = `Vào phút thứ ${minute.values[0]} của ${hourPhrase(hour)}`;
  } else {
    base = `Vào phút ${describeItems(minute, String, 'phút')} của ${hourPhrase(hour)}`;
  }
  if (secText) base += `, ${secText}`;
  return base;
}

function describeDow(f: CronField): string {
  const fmt = (v: number) => DOW_VI[v === 7 ? 0 : v];
  if (f.items.some((i) => i.kind === 'step')) {
    return joinVi(f.values.map((v) => fmt(v)));
  }
  return describeItems(f, fmt, 'ngày');
}

function describeDom(f: CronField): string {
  const fmt = (v: number) => `ngày ${v}`;
  const stepOnly = f.items.length === 1 && f.items[0].kind === 'step';
  if (stepOnly) {
    const it = f.items[0];
    return it.from === 1 ? `mỗi ${it.step} ngày` : `mỗi ${it.step} ngày từ ngày ${it.from} đến ngày ${it.to}`;
  }
  return describeItems(f, fmt, 'ngày');
}

function describeMonth(f: CronField): string {
  const fmt = (v: number) => `tháng ${v}`;
  if (f.items.some((i) => i.kind === 'step')) return joinVi(f.values.map((v) => fmt(v)));
  return describeItems(f, fmt, 'tháng');
}

export function describeCron(spec: CronSpec): string {
  const time = describeTime(spec);
  const bothRestricted = !spec.dom.star && !spec.dow.star;
  const orAll = bothRestricted && (spec.dom.isAll || spec.dow.isAll); // OR với "mọi giá trị" => mọi ngày
  const everyDom = spec.dom.isAll || orAll;
  const everyDow = spec.dow.isAll || orAll;
  const everyMonth = spec.month.isAll;
  const pieces: string[] = [time];

  if (!everyDom && !everyDow) {
    const joiner = bothRestricted ? 'hoặc vào' : 'và vào';
    pieces.push(`vào ${describeDom(spec.dom)} hằng tháng ${joiner} ${describeDow(spec.dow)}`);
  } else if (!everyDom) {
    pieces.push(`vào ${describeDom(spec.dom)} hằng tháng`);
  } else if (!everyDow) {
    pieces.push(describeDow(spec.dow));
  } else if (!/^Mỗi/.test(time)) {
    pieces.push('mỗi ngày');
  }
  if (!everyMonth) {
    const mt = describeMonth(spec.month);
    pieces.push(/^(từ|mỗi)/.test(mt) ? mt : `trong ${mt}`);
  }
  return pieces.join(', ');
}

export interface FieldBreakdown {
  key: FieldKey;
  label: string;
  raw: string;
  meaning: string;
  values: string;
}

export function breakdownCron(spec: CronSpec): FieldBreakdown[] {
  const keys: FieldKey[] = spec.hasSeconds
    ? ['second', 'minute', 'hour', 'dom', 'month', 'dow']
    : ['minute', 'hour', 'dom', 'month', 'dow'];
  return keys.map((key) => {
    const f = spec[key];
    let meaning: string;
    switch (key) {
      case 'dow': meaning = f.isAll ? 'mọi thứ trong tuần' : describeDow(f); break;
      case 'dom': meaning = f.isAll ? 'mọi ngày trong tháng' : describeDom(f); break;
      case 'month': meaning = f.isAll ? 'mọi tháng' : describeMonth(f); break;
      case 'hour': meaning = f.isAll ? 'mọi giờ' : describeItems(f, (v) => `${v} giờ`, 'giờ'); break;
      case 'minute': meaning = f.isAll ? 'mọi phút' : describeItems(f, (v) => `phút ${v}`, 'phút'); break;
      default: meaning = f.isAll ? 'mọi giây' : describeItems(f, (v) => `giây ${v}`, 'giây');
    }
    const fmt = (v: number) => (key === 'dow' ? DOW_VI[v] : String(v));
    const vs = f.values.map(fmt);
    const values = f.isAll ? 'tất cả' : vs.length > 14 ? `${vs.slice(0, 14).join(', ')}, … (${vs.length} giá trị)` : vs.join(', ');
    return { key, label: FIELD_LABEL[key], raw: f.raw, meaning, values };
  });
}

export const CRON_PRESETS: { label: string; expr: string; seconds?: boolean }[] = [
  { label: 'Mỗi phút', expr: '* * * * *' },
  { label: 'Mỗi 5 phút', expr: '*/5 * * * *' },
  { label: 'Mỗi 15 phút', expr: '*/15 * * * *' },
  { label: 'Mỗi giờ', expr: '0 * * * *' },
  { label: 'Hằng ngày 00:00', expr: '0 0 * * *' },
  { label: 'Hằng ngày 09:30', expr: '30 9 * * *' },
  { label: 'Thứ Hai–Sáu 09:00', expr: '0 9 * * 1-5' },
  { label: 'Thứ Hai 9h', expr: '0 9 * * 1' },
  { label: 'Cuối tuần 10h', expr: '0 10 * * 6,0' },
  { label: 'Đầu tháng', expr: '0 0 1 * *' },
  { label: 'Ngày 1 và 15', expr: '0 0 1,15 * *' },
  { label: 'Mỗi quý', expr: '0 0 1 1,4,7,10 *' },
  { label: 'Đầu năm', expr: '0 0 1 1 *' },
  { label: 'Ngày nhuận 29/2', expr: '0 0 29 2 *' },
  { label: 'Mỗi 10 giây', expr: '*/10 * * * * *', seconds: true },
];
