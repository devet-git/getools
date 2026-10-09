// Logic phiên Pomodoro: xen kẽ làm việc / nghỉ ngắn, nghỉ dài sau mỗi N phiên làm việc.

export type Phase = 'work' | 'short' | 'long';

export interface PomodoroConfig { workMin: number; shortMin: number; longMin: number; longEvery: number }

export const DEFAULT_CONFIG: PomodoroConfig = { workMin: 25, shortMin: 5, longMin: 15, longEvery: 4 };

export const PHASE_LABEL: Record<Phase, string> = { work: 'Tập trung', short: 'Nghỉ ngắn', long: 'Nghỉ dài' };

export function validateConfig(c: PomodoroConfig): string | null {
  const ok = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  if (!ok(c.workMin, 1, 180)) return 'Thời gian tập trung từ 1 đến 180 phút.';
  if (!ok(c.shortMin, 1, 60)) return 'Nghỉ ngắn từ 1 đến 60 phút.';
  if (!ok(c.longMin, 1, 120)) return 'Nghỉ dài từ 1 đến 120 phút.';
  if (!ok(c.longEvery, 2, 12)) return 'Nghỉ dài sau mỗi 2 đến 12 phiên.';
  return null;
}

export const phaseSeconds = (p: Phase, c: PomodoroConfig): number => 60 * (p === 'work' ? c.workMin : p === 'short' ? c.shortMin : c.longMin);

/** Phase kế tiếp, tính theo số phiên làm việc đã HOÀN THÀNH (đã gồm phiên vừa xong nếu `finished` là work). */
export function nextPhase(finished: Phase, completedWork: number, c: PomodoroConfig): Phase {
  if (finished !== 'work') return 'work';
  return completedWork > 0 && completedWork % c.longEvery === 0 ? 'long' : 'short';
}

export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`;
}
