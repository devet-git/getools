'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Timer as TimerIcon, Play, Pause, SkipForward, RotateCcw, Bell } from 'lucide-react';
import { ToolHeader } from '@/components/ToolHeader';
import { DEFAULT_CONFIG, PHASE_LABEL, formatClock, nextPhase, phaseSeconds, validateConfig, type Phase, type PomodoroConfig } from '@/lib/pomodoro';

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5';
const field = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500';
const TONE: Record<Phase, string> = { work: 'text-indigo-600', short: 'text-emerald-600', long: 'text-sky-600' };
const DONE_KEY = 'getools_pomodoro_done';
const todayKey = () => new Date().toISOString().slice(0, 10);

function readDone(): number {
  try { const v = JSON.parse(localStorage.getItem(DONE_KEY) || '{}'); return v.date === todayKey() && Number.isInteger(v.n) ? v.n : 0; } catch { return 0; }
}
function writeDone(n: number) { try { localStorage.setItem(DONE_KEY, JSON.stringify({ date: todayKey(), n })); } catch { /* bị chặn */ } }

function beep(ctxRef: { current: AudioContext | null }) {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = ctxRef.current ?? (ctxRef.current = new AC());
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.2);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.22);
    });
  } catch { /* trình duyệt chặn âm thanh */ }
}

export default function PomodoroPage() {
  const [cfg, setCfg] = useState<PomodoroConfig>(DEFAULT_CONFIG);
  const [phase, setPhase] = useState<Phase>('work');
  const [remaining, setRemaining] = useState(phaseSeconds('work', DEFAULT_CONFIG));
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [auto, setAuto] = useState(true);
  const [notify, setNotify] = useState(false);
  const endAt = useRef(0);
  const audio = useRef<AudioContext | null>(null);
  const doneRef = useRef(0);
  const cfgError = validateConfig(cfg);

  useEffect(() => {
    const n = readDone();
    doneRef.current = n;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDone(n);
  }, []);

  const goNext = useCallback((finished: Phase, startNow: boolean) => {
    let completed = doneRef.current;
    if (finished === 'work') { completed += 1; doneRef.current = completed; setDone(completed); writeDone(completed); }
    const next = nextPhase(finished, completed, cfg);
    const secs = phaseSeconds(next, cfg);
    setPhase(next); setRemaining(secs);
    if (startNow) { endAt.current = Date.now() + secs * 1000; setRunning(true); } else setRunning(false);
    return next;
  }, [cfg]);

  // Đếm theo mốc thời gian thật (không cộng dồn mỗi tick) nên không trôi khi tab bị trình duyệt làm chậm.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const left = Math.round((endAt.current - Date.now()) / 1000);
      if (left > 0) { setRemaining(left); return; }
      beep(audio);
      const finished = phase;
      const next = goNext(finished, auto);
      if (notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try { new Notification(finished === 'work' ? 'Hết giờ tập trung, nghỉ thôi!' : 'Hết giờ nghỉ, vào việc!', { body: `Tiếp theo: ${PHASE_LABEL[next]}` }); } catch { /* bị chặn */ }
      }
    }, 250);
    return () => clearInterval(id);
  }, [running, phase, auto, notify, goNext]);

  useEffect(() => {
    document.title = running ? `${formatClock(remaining)} · ${PHASE_LABEL[phase]}` : 'GeTools';
    return () => { document.title = 'GeTools'; };
  }, [running, remaining, phase]);

  const toggle = () => {
    if (cfgError) return;
    if (running) { setRunning(false); return; }
    endAt.current = Date.now() + remaining * 1000;
    setRunning(true);
    audio.current?.resume?.();
  };
  const reset = () => { setRunning(false); setPhase('work'); setRemaining(phaseSeconds('work', cfg)); };
  const skip = () => { goNext(phase, running); };
  const enableNotify = async () => {
    if (typeof Notification === 'undefined') return;
    const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    setNotify(p === 'granted');
  };
  const changeCfg = (k: keyof PomodoroConfig, v: string) => {
    const next = { ...cfg, [k]: Number(v) };
    setCfg(next);
    if (!running && validateConfig(next) === null) setRemaining(phaseSeconds(phase, next));
  };
  const total = phaseSeconds(phase, cfg);
  const pct = total > 0 ? Math.min(100, Math.max(0, ((total - remaining) / total) * 100)) : 0;

  return (
    <div className="space-y-3.5">
      <ToolHeader icon={TimerIcon} title="Pomodoro & bấm giờ" desc="Làm việc tập trung theo chu kỳ 25/5 phút, có chuông báo, thông báo trình duyệt và đếm số phiên trong ngày." />
      <div className="grid lg:grid-cols-2 gap-3.5 items-start">
        <section className={`${card} text-center space-y-4`}>
          <div className={`text-sm font-bold uppercase tracking-widest ${TONE[phase]}`}>{PHASE_LABEL[phase]}</div>
          <div className="text-7xl font-bold font-mono tabular-nums text-slate-900" aria-live="off">{formatClock(remaining)}</div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-indigo-500 transition-[width] duration-300" style={{ width: `${pct}%` }} /></div>
          <div className="flex justify-center gap-2">
            <button onClick={toggle} disabled={!!cfgError} className="px-5 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">{running ? <><Pause className="h-4 w-4" /> Tạm dừng</> : <><Play className="h-4 w-4" /> Bắt đầu</>}</button>
            <button onClick={skip} className="px-3 py-2 rounded-lg text-sm border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5" title="Bỏ qua giai đoạn này"><SkipForward className="h-4 w-4" /> Bỏ qua</button>
            <button onClick={reset} className="px-3 py-2 rounded-lg text-sm border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5"><RotateCcw className="h-4 w-4" /> Đặt lại</button>
          </div>
          <p className="text-sm text-slate-600">Hôm nay: <b className="text-slate-900">{done}</b> phiên tập trung{done > 0 && <> (~{Math.round((done * cfg.workMin) / 6) / 10} giờ)</>}</p>
        </section>
        <section className={`${card} space-y-3`}>
          <h2 className="text-sm font-bold text-slate-800">Cài đặt</h2>
          <div className="grid grid-cols-2 gap-2">
            {([['workMin', 'Tập trung (phút)'], ['shortMin', 'Nghỉ ngắn (phút)'], ['longMin', 'Nghỉ dài (phút)'], ['longEvery', 'Nghỉ dài sau (phiên)']] as const).map(([k, l]) => (
              <label key={k} className="block text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1">{l}<input inputMode="numeric" value={cfg[k]} onChange={(e) => changeCfg(k, e.target.value)} className={field} /></label>
            ))}
          </div>
          {cfgError && <p className="text-sm text-red-600">{cfgError}</p>}
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Tự chạy giai đoạn kế tiếp</label>
          <button onClick={enableNotify} disabled={typeof Notification === 'undefined'} className="px-3 py-1.5 rounded-lg text-sm border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-50"><Bell className="h-4 w-4" /> {notify ? 'Đã bật thông báo' : 'Bật thông báo trình duyệt'}</button>
          <p className="text-xs text-slate-500">Hãy để tab này mở. Thời gian đếm theo đồng hồ thật nên không bị trễ khi tab chạy nền, và tiêu đề tab hiện thời gian còn lại. Chuông cần bạn đã bấm &quot;Bắt đầu&quot; ít nhất một lần.</p>
        </section>
      </div>
    </div>
  );
}
