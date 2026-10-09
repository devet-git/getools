/**
 * Store toàn cục cho đồng hồ chạy nền (Pomodoro / đếm ngược / bấm giờ): lưu localStorage (đồng bộ giữa các tab),
 * hẹn giờ đúng mốc kết thúc, báo chuông + thông báo hệ thống ở BẤT KỲ trang nào của app.
 * Dùng với useSyncExternalStore(subscribeClock, getClockSnapshot, getServerClockSnapshot).
 */
import {
  advanceClock,
  initialClock,
  localDay,
  nextDeadline,
  parseClock,
  type ClockEvent,
  type ClockState,
} from '@/lib/clock';
import { PHASE_LABEL } from '@/lib/pomodoro';

const KEY = 'getools_clock_v1';
/** Id các sự kiện đã báo (chung cho mọi tab) để nhiều tab đang mở không cùng kêu */
const FIRED_KEY = 'getools_clock_fired';
const LEGACY_DONE_KEY = 'getools_pomodoro_done';
/** Hết giờ từ lâu (vd. lúc tab đóng) thì không kêu nữa khi mở lại */
const STALE_MS = 90_000;

const SERVER_STATE = initialClock(0);
let state: ClockState = SERVER_STATE;
let loaded = false;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

/* ---------- lưu trữ ---------- */

function load(): ClockState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return parseClock(JSON.parse(raw));
    // Lần đầu: mang sang số phiên hôm nay của phiên bản cũ
    const s = initialClock();
    const old = JSON.parse(localStorage.getItem(LEGACY_DONE_KEY) || 'null');
    if (old && Number.isInteger(old.n) && old.date === new Date().toISOString().slice(0, 10)) {
      s.pomodoro = { ...s.pomodoro, done: old.n, doneDate: localDay(Date.now()) };
    }
    return s;
  } catch {
    return initialClock();
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* bị chặn / đầy bộ nhớ */
  }
}

function ensureLoaded() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  state = load();
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    state = load(); // tab khác vừa thao tác
    emit();
    schedule();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tickClock();
  });
  tickClock();
}

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeClock(l: () => void) {
  ensureLoaded();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export const getClockSnapshot = () => {
  ensureLoaded();
  return state;
};
export const getServerClockSnapshot = () => SERVER_STATE;

/** Áp dụng một thao tác (từ lib/clock.ts) lên trạng thái hiện tại */
export function updateClock(fn: (s: ClockState, now: number) => ClockState) {
  ensureLoaded();
  const next = fn(state, Date.now());
  if (next === state) return;
  state = next;
  save();
  emit();
  schedule();
}

/* ---------- hẹn giờ & tiến thời gian ---------- */

/** Xử lý các mốc đã đến: chuyển giai đoạn, báo chuông / thông báo */
export function tickClock() {
  const { state: next, events } = advanceClock(state, Date.now());
  if (next !== state) {
    state = next;
    save();
    emit();
  }
  events.forEach(fire);
  schedule();
}

function schedule() {
  clearTimeout(timer);
  const d = nextDeadline(state);
  if (d == null) return;
  // +30ms để chắc chắn đã qua mốc khi chạy; setTimeout đơn (không lặp) ít bị trình duyệt làm chậm khi tab chạy nền
  timer = setTimeout(tickClock, Math.max(0, d - Date.now()) + 30);
  scheduleChime(d);
}

/* ---------- âm thanh ---------- */

let audio: AudioContext | null = null;
let scheduled: { at: number; nodes: OscillatorNode[] } | null = null;

/** Gọi trong thao tác của người dùng (bấm Bắt đầu...) để trình duyệt cho phép phát âm thanh */
export function unlockClockAudio() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    audio ??= new AC();
    void audio.resume();
    const d = nextDeadline(state);
    if (d != null) scheduleChime(d);
  } catch {
    /* trình duyệt chặn âm thanh */
  }
}

function chimeAt(ctx: AudioContext, start: number): OscillatorNode[] {
  return [0, 0.25, 0.5].map((t) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, start + t);
    g.gain.exponentialRampToValueAtTime(0.25, start + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + t + 0.2);
    o.start(start + t);
    o.stop(start + t + 0.22);
    return o;
  });
}

/**
 * Hẹn chuông ngay trên luồng âm thanh (không bị làm chậm như setTimeout khi tab chạy nền) — chỉ ở tab
 * người dùng đã bấm Bắt đầu (có AudioContext đang chạy).
 */
function scheduleChime(deadline: number) {
  if (!audio || audio.state !== 'running') return;
  if (scheduled?.at === deadline) return;
  scheduled?.nodes.forEach((n) => {
    try {
      n.stop();
    } catch {
      /* đã dừng */
    }
  });
  const delay = Math.max(0, (deadline - Date.now()) / 1000);
  scheduled = { at: deadline, nodes: chimeAt(audio, audio.currentTime + delay) };
}

/** Bỏ chuông đã hẹn (khi tạm dừng / đặt lại) */
function cancelStaleChime() {
  if (!scheduled) return;
  const d = nextDeadline(state);
  if (d === scheduled.at) return;
  scheduled.nodes.forEach((n) => {
    try {
      n.stop();
    } catch {
      /* đã dừng */
    }
  });
  scheduled = null;
}
listeners.add(cancelStaleChime);

/* ---------- báo khi hết giờ ---------- */

function claim(id: string): boolean {
  try {
    const fired: string[] = JSON.parse(localStorage.getItem(FIRED_KEY) || '[]');
    if (fired.includes(id)) return false;
    localStorage.setItem(FIRED_KEY, JSON.stringify([...fired, id].slice(-30)));
    return true;
  } catch {
    return true;
  }
}

function fire(e: ClockEvent) {
  if (Date.now() - e.at > STALE_MS || !claim(e.id)) return;
  // Chuông đã hẹn sẵn cho đúng mốc này thì không kêu lại
  if (audio && audio.state === 'running' && scheduled?.at !== e.at) chimeAt(audio, audio.currentTime);
  if (scheduled?.at === e.at) scheduled = null;
  if (!state.notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const title =
    e.kind === 'countdown'
      ? `Hết giờ${e.label ? `: ${e.label}` : '!'}`
      : e.finished === 'work'
        ? 'Hết giờ tập trung, nghỉ thôi!'
        : 'Hết giờ nghỉ, vào việc!';
  const body = e.kind === 'countdown' ? 'Bộ đếm ngược đã kết thúc.' : `Tiếp theo: ${PHASE_LABEL[e.next]}${e.started ? ' (đã tự bắt đầu)' : ''}`;
  try {
    const n = new Notification(title, { body, tag: 'getools-clock' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* bị chặn */
  }
}

/** Bật / tắt thông báo hệ thống (xin quyền khi bật) */
export async function setClockNotify(on: boolean): Promise<boolean> {
  if (on && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') on = false;
  }
  updateClock((s) => (s.notify === on ? s : { ...s, notify: on }));
  return on;
}
