/**
 * Logic thuần của các đồng hồ chạy nền (Pomodoro, đếm ngược, bấm giờ) — không phụ thuộc trình duyệt.
 * Mọi thứ lưu bằng MỐC THỜI GIAN (kết thúc lúc nào / bắt đầu lúc nào), không đếm lùi từng giây, nên đúng giờ dù
 * người dùng chuyển trang, tải lại hay đóng tab rồi mở lại; `advanceClock` tính bù những gì đã xảy ra trong lúc vắng.
 */
import { DEFAULT_CONFIG, nextPhase, phaseSeconds, validateConfig, type Phase, type PomodoroConfig } from '@/lib/pomodoro';

export interface PomodoroState {
  cfg: PomodoroConfig;
  phase: Phase;
  /** Đang chạy: mốc kết thúc (ms). Tạm dừng: null */
  endAt: number | null;
  /** Thời gian còn lại khi tạm dừng (ms) */
  remainingMs: number;
  /** Tự chạy giai đoạn kế tiếp khi hết giờ */
  auto: boolean;
  /** Số phiên tập trung đã xong trong ngày `doneDate` (YYYY-MM-DD giờ địa phương) */
  done: number;
  doneDate: string;
}

export interface CountdownState {
  durationMs: number;
  endAt: number | null;
  remainingMs: number;
  label: string;
}

export interface StopwatchState {
  /** Đang chạy: mốc bắt đầu đoạn chạy hiện tại. Dừng: null */
  startedAt: number | null;
  /** Tổng thời gian của các đoạn đã dừng */
  accumulatedMs: number;
  /** Mốc tổng thời gian tại mỗi lần bấm vòng */
  laps: number[];
}

export interface ClockState {
  pomodoro: PomodoroState;
  countdown: CountdownState;
  stopwatch: StopwatchState;
  /** Gửi thông báo hệ thống khi hết giờ */
  notify: boolean;
}

export type ClockEvent =
  | { kind: 'pomodoro'; id: string; at: number; finished: Phase; next: Phase; started: boolean }
  | { kind: 'countdown'; id: string; at: number; label: string };

export const localDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function initialClock(now = Date.now()): ClockState {
  return {
    pomodoro: { cfg: DEFAULT_CONFIG, phase: 'work', endAt: null, remainingMs: phaseSeconds('work', DEFAULT_CONFIG) * 1000, auto: true, done: 0, doneDate: localDay(now) },
    countdown: { durationMs: 10 * 60_000, endAt: null, remainingMs: 10 * 60_000, label: '' },
    stopwatch: { startedAt: null, accumulatedMs: 0, laps: [] },
    notify: false,
  };
}

/* ---------- đọc giá trị hiển thị ---------- */

export const pomodoroRemaining = (p: PomodoroState, now: number) => (p.endAt != null ? Math.max(0, p.endAt - now) : p.remainingMs);
export const countdownRemaining = (c: CountdownState, now: number) => (c.endAt != null ? Math.max(0, c.endAt - now) : c.remainingMs);
export const stopwatchElapsed = (s: StopwatchState, now: number) => s.accumulatedMs + (s.startedAt != null ? Math.max(0, now - s.startedAt) : 0);
export const doneToday = (p: PomodoroState, now: number) => (p.doneDate === localDay(now) ? p.done : 0);

/** Mốc gần nhất cần xử lý (để hẹn giờ chính xác); null nếu không có gì đang đếm ngược */
export function nextDeadline(s: ClockState): number | null {
  const list = [s.pomodoro.endAt, s.countdown.endAt].filter((x): x is number => x != null);
  return list.length ? Math.min(...list) : null;
}

/* ---------- thao tác ---------- */

export function pomodoroToggle(s: ClockState, now: number): ClockState {
  const p = s.pomodoro;
  if (validateConfig(p.cfg)) return s;
  const pomodoro = p.endAt != null
    ? { ...p, endAt: null, remainingMs: Math.max(0, p.endAt - now) }
    : { ...p, endAt: now + (p.remainingMs > 0 ? p.remainingMs : phaseSeconds(p.phase, p.cfg) * 1000) };
  return { ...s, pomodoro };
}

export function pomodoroReset(s: ClockState): ClockState {
  const p = s.pomodoro;
  return { ...s, pomodoro: { ...p, phase: 'work', endAt: null, remainingMs: phaseSeconds('work', p.cfg) * 1000 } };
}

/** Kết thúc giai đoạn hiện tại ngay (bỏ qua), tính như đã xong nếu là phiên tập trung */
export function pomodoroSkip(s: ClockState, now: number): ClockState {
  const p = s.pomodoro;
  return { ...s, pomodoro: finishPhase(p, now, p.endAt != null).p };
}

export function pomodoroSetConfig(s: ClockState, cfg: PomodoroConfig): ClockState {
  const p = s.pomodoro;
  // Đang chạy thì áp dụng từ giai đoạn sau; đang dừng ở đầu giai đoạn thì cập nhật luôn thời lượng
  const atStart = p.endAt == null && p.remainingMs === phaseSeconds(p.phase, p.cfg) * 1000;
  const remainingMs = atStart && !validateConfig(cfg) ? phaseSeconds(p.phase, cfg) * 1000 : p.remainingMs;
  return { ...s, pomodoro: { ...p, cfg, remainingMs } };
}

function finishPhase(p: PomodoroState, endedAt: number, keepRunning: boolean): { p: PomodoroState; next: Phase } {
  const day = localDay(endedAt);
  let done = p.doneDate === day ? p.done : 0;
  if (p.phase === 'work') done += 1;
  const next = nextPhase(p.phase, done, p.cfg);
  const ms = phaseSeconds(next, p.cfg) * 1000;
  // Tự chạy tiếp: giai đoạn sau bắt đầu ĐÚNG lúc giai đoạn trước kết thúc (bù cả khi tab bị đóng)
  const endAt = keepRunning ? endedAt + ms : null;
  return { p: { ...p, phase: next, done, doneDate: day, endAt, remainingMs: ms }, next };
}

export function countdownStart(s: ClockState, now: number): ClockState {
  const c = s.countdown;
  if (c.endAt != null) return s;
  const ms = c.remainingMs > 0 ? c.remainingMs : c.durationMs;
  return ms > 0 ? { ...s, countdown: { ...c, endAt: now + ms } } : s;
}
export function countdownPause(s: ClockState, now: number): ClockState {
  const c = s.countdown;
  return c.endAt == null ? s : { ...s, countdown: { ...c, endAt: null, remainingMs: Math.max(0, c.endAt - now) } };
}
export function countdownReset(s: ClockState): ClockState {
  return { ...s, countdown: { ...s.countdown, endAt: null, remainingMs: s.countdown.durationMs } };
}
export function countdownSet(s: ClockState, durationMs: number, label: string): ClockState {
  const ms = Math.max(1000, Math.min(durationMs, 24 * 3600_000));
  return { ...s, countdown: { durationMs: ms, endAt: null, remainingMs: ms, label: label.slice(0, 60) } };
}

export function stopwatchToggle(s: ClockState, now: number): ClockState {
  const w = s.stopwatch;
  return {
    ...s,
    stopwatch: w.startedAt != null
      ? { ...w, startedAt: null, accumulatedMs: w.accumulatedMs + Math.max(0, now - w.startedAt) }
      : { ...w, startedAt: now },
  };
}
export function stopwatchLap(s: ClockState, now: number): ClockState {
  const w = s.stopwatch;
  if (w.startedAt == null) return s;
  return { ...s, stopwatch: { ...w, laps: [...w.laps, stopwatchElapsed(w, now)].slice(-200) } };
}
export function stopwatchReset(s: ClockState): ClockState {
  return { ...s, stopwatch: { startedAt: null, accumulatedMs: 0, laps: [] } };
}

/* ---------- tiến thời gian ---------- */

/** Số giai đoạn tối đa được bù khi tab đóng lâu (tránh vòng lặp dài) */
const MAX_CATCH_UP = 48;

/**
 * Xử lý mọi mốc đã qua tính đến `now`: chuyển giai đoạn Pomodoro (bù nhiều giai đoạn nếu vắng lâu),
 * kết thúc đếm ngược. Trả về trạng thái mới và các sự kiện để báo chuông / thông báo.
 */
export function advanceClock(s: ClockState, now: number): { state: ClockState; events: ClockEvent[] } {
  const events: ClockEvent[] = [];
  let p = s.pomodoro;
  for (let i = 0; i < MAX_CATCH_UP && p.endAt != null && p.endAt <= now; i++) {
    const endedAt: number = p.endAt;
    const finished = p.phase;
    const r = finishPhase(p, endedAt, p.auto);
    p = r.p;
    events.push({ kind: 'pomodoro', id: `pomodoro:${endedAt}`, at: endedAt, finished, next: r.next, started: p.endAt != null });
  }
  if (p.endAt != null && p.endAt <= now) p = { ...p, endAt: null, remainingMs: phaseSeconds(p.phase, p.cfg) * 1000 };

  let c = s.countdown;
  if (c.endAt != null && c.endAt <= now) {
    events.push({ kind: 'countdown', id: `countdown:${c.endAt}`, at: c.endAt, label: c.label });
    c = { ...c, endAt: null, remainingMs: 0 };
  }
  if (p === s.pomodoro && c === s.countdown) return { state: s, events };
  return { state: { ...s, pomodoro: p, countdown: c }, events };
}

/* ---------- đọc dữ liệu đã lưu (phòng thủ) ---------- */

const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseClock(raw: unknown, now = Date.now()): ClockState {
  const d = initialClock(now);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, Record<string, unknown>>;
  const pr = r.pomodoro ?? {};
  const cfgRaw = (pr.cfg ?? {}) as Record<string, unknown>;
  const cfg: PomodoroConfig = {
    workMin: num(cfgRaw.workMin, d.pomodoro.cfg.workMin),
    shortMin: num(cfgRaw.shortMin, d.pomodoro.cfg.shortMin),
    longMin: num(cfgRaw.longMin, d.pomodoro.cfg.longMin),
    longEvery: num(cfgRaw.longEvery, d.pomodoro.cfg.longEvery),
  };
  const phase: Phase = pr.phase === 'short' || pr.phase === 'long' ? pr.phase : 'work';
  const cr = r.countdown ?? {};
  const sr = r.stopwatch ?? {};
  return {
    pomodoro: {
      cfg,
      phase,
      endAt: numOrNull(pr.endAt),
      remainingMs: num(pr.remainingMs, phaseSeconds(phase, validateConfig(cfg) ? DEFAULT_CONFIG : cfg) * 1000),
      auto: pr.auto !== false,
      done: Math.max(0, Math.floor(num(pr.done, 0))),
      doneDate: typeof pr.doneDate === 'string' ? pr.doneDate : d.pomodoro.doneDate,
    },
    countdown: {
      durationMs: num(cr.durationMs, d.countdown.durationMs),
      endAt: numOrNull(cr.endAt),
      remainingMs: num(cr.remainingMs, d.countdown.remainingMs),
      label: typeof cr.label === 'string' ? cr.label.slice(0, 60) : '',
    },
    stopwatch: {
      startedAt: numOrNull(sr.startedAt),
      accumulatedMs: num(sr.accumulatedMs, 0),
      laps: Array.isArray(sr.laps) ? sr.laps.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).slice(-200) : [],
    },
    notify: (raw as { notify?: unknown }).notify === true,
  };
}
