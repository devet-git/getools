'use client';

import { useState, useSyncExternalStore } from 'react';
import { Timer as TimerIcon, Play, Pause, SkipForward, RotateCcw, Bell, BellOff, Flag, Hourglass, Watch } from 'lucide-react';
import { ToolHeader } from '@/components/ToolHeader';
import { formatStopwatch } from '@/components/BackgroundDock';
import { useNow } from '@/hooks/use-now';
import {
  countdownPause, countdownRemaining, countdownReset, countdownSet, countdownStart, doneToday,
  pomodoroRemaining, pomodoroReset, pomodoroSetConfig, pomodoroSkip, pomodoroToggle,
  stopwatchElapsed, stopwatchLap, stopwatchReset, stopwatchToggle, type ClockState,
} from '@/lib/clock';
import { getClockSnapshot, getServerClockSnapshot, setClockNotify, subscribeClock, unlockClockAudio, updateClock } from '@/lib/clock-store';
import { PHASE_LABEL, formatClock, phaseSeconds, validateConfig, type Phase, type PomodoroConfig } from '@/lib/pomodoro';

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5';
const field = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500';
const btnPrimary = 'px-5 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5';
const btn = 'px-3 py-2 rounded-lg text-sm border border-slate-200 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5';
const TONE: Record<Phase, string> = { work: 'text-indigo-600', short: 'text-emerald-600', long: 'text-sky-600' };

type Tab = 'pomodoro' | 'countdown' | 'stopwatch';
const TABS: { id: Tab; label: string; icon: typeof TimerIcon }[] = [
  { id: 'pomodoro', label: 'Pomodoro', icon: TimerIcon },
  { id: 'countdown', label: 'Đếm ngược', icon: Hourglass },
  { id: 'stopwatch', label: 'Bấm giờ', icon: Watch },
];
const PRESETS = [1, 3, 5, 10, 15, 30, 60];

/** Thao tác của người dùng: mở khóa âm thanh (cần cử chỉ người dùng) rồi cập nhật store */
const act = (fn: (s: ClockState, now: number) => ClockState) => {
  unlockClockAudio();
  updateClock(fn);
};

function Progress({ pct, tone = 'bg-indigo-500' }: { pct: number; tone?: string }) {
  const v = Math.min(100, Math.max(0, pct));
  return (
    <div className="h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full ${tone} transition-[width] duration-300`} style={{ width: `${v}%` }} />
    </div>
  );
}

function PomodoroPanel({ s, now }: { s: ClockState; now: number }) {
  const p = s.pomodoro;
  const running = p.endAt != null;
  const remaining = pomodoroRemaining(p, now);
  const total = phaseSeconds(p.phase, p.cfg) * 1000;
  const cfgError = validateConfig(p.cfg);
  const done = doneToday(p, now);
  const changeCfg = (k: keyof PomodoroConfig, v: string) => updateClock((st) => pomodoroSetConfig(st, { ...st.pomodoro.cfg, [k]: Number(v) }));

  return (
    <div className="grid lg:grid-cols-2 gap-3.5 items-start">
      <section className={`${card} text-center space-y-4`}>
        <div className={`text-sm font-bold uppercase tracking-widest ${TONE[p.phase]}`}>{PHASE_LABEL[p.phase]}</div>
        <div className="text-7xl font-bold font-mono tabular-nums text-slate-900">{formatClock(remaining / 1000)}</div>
        <Progress pct={total > 0 ? ((total - remaining) / total) * 100 : 0} />
        <div className="flex justify-center gap-2">
          <button onClick={() => act(pomodoroToggle)} disabled={!!cfgError} className={btnPrimary}>
            {running ? <><Pause className="h-4 w-4" /> Tạm dừng</> : <><Play className="h-4 w-4" /> {remaining < total ? 'Tiếp tục' : 'Bắt đầu'}</>}
          </button>
          <button onClick={() => act(pomodoroSkip)} className={btn} data-tooltip="Kết thúc giai đoạn này, chuyển sang giai đoạn sau"><SkipForward className="h-4 w-4" /> Bỏ qua</button>
          <button onClick={() => updateClock(pomodoroReset)} className={btn}><RotateCcw className="h-4 w-4" /> Đặt lại</button>
        </div>
        <p className="text-sm text-slate-600">Hôm nay: <b className="text-slate-900">{done}</b> phiên tập trung{done > 0 && <> (~{Math.round((done * p.cfg.workMin) / 6) / 10} giờ)</>}</p>
      </section>
      <section className={`${card} space-y-3`}>
        <h2 className="text-sm font-bold text-slate-800">Cài đặt Pomodoro</h2>
        <div className="grid grid-cols-2 gap-2">
          {([['workMin', 'Tập trung (phút)'], ['shortMin', 'Nghỉ ngắn (phút)'], ['longMin', 'Nghỉ dài (phút)'], ['longEvery', 'Nghỉ dài sau (phiên)']] as const).map(([k, l]) => (
            <label key={k} className="block text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1">{l}<input inputMode="numeric" value={p.cfg[k]} onChange={(e) => changeCfg(k, e.target.value)} className={field} /></label>
          ))}
        </div>
        {cfgError && <p className="text-sm text-red-600">{cfgError}</p>}
        {running && !cfgError && <p className="text-xs text-slate-500">Thay đổi thời lượng áp dụng từ giai đoạn kế tiếp.</p>}
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={p.auto} onChange={(e) => updateClock((st) => ({ ...st, pomodoro: { ...st.pomodoro, auto: e.target.checked } }))} />
          Tự chạy giai đoạn kế tiếp
        </label>
      </section>
    </div>
  );
}

function CountdownPanel({ s, now }: { s: ClockState; now: number }) {
  const c = s.countdown;
  const running = c.endAt != null;
  const remaining = countdownRemaining(c, now);
  const [h, setH] = useState(() => String(Math.floor(c.durationMs / 3600_000)));
  const [m, setM] = useState(() => String(Math.floor((c.durationMs % 3600_000) / 60_000)));
  const [sec, setSec] = useState(() => String(Math.floor((c.durationMs % 60_000) / 1000)));
  const [label, setLabel] = useState(c.label);
  const ms = ((Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(sec) || 0)) * 1000;
  const finished = !running && remaining === 0;

  const apply = (durationMs: number, lbl = label) => {
    const hh = Math.floor(durationMs / 3600_000);
    setH(String(hh)); setM(String(Math.floor((durationMs % 3600_000) / 60_000))); setSec(String(Math.floor((durationMs % 60_000) / 1000)));
    act((st, t) => countdownStart(countdownSet(st, durationMs, lbl), t));
  };

  return (
    <div className="grid lg:grid-cols-2 gap-3.5 items-start">
      <section className={`${card} text-center space-y-4`}>
        <div className="text-sm font-bold uppercase tracking-widest text-amber-600">{c.label || 'Đếm ngược'}</div>
        <div className={`text-7xl font-bold font-mono tabular-nums ${finished ? 'text-red-600' : 'text-slate-900'}`}>{formatClock(remaining / 1000)}</div>
        <Progress pct={c.durationMs > 0 ? ((c.durationMs - remaining) / c.durationMs) * 100 : 0} tone="bg-amber-500" />
        <div className="flex justify-center gap-2">
          {running ? (
            <button onClick={() => updateClock(countdownPause)} className={btnPrimary}><Pause className="h-4 w-4" /> Tạm dừng</button>
          ) : (
            <button onClick={() => act(finished ? (st, t) => countdownStart(countdownReset(st), t) : countdownStart)} className={btnPrimary}>
              <Play className="h-4 w-4" /> {finished ? 'Chạy lại' : remaining < c.durationMs ? 'Tiếp tục' : 'Bắt đầu'}
            </button>
          )}
          <button onClick={() => updateClock(countdownReset)} className={btn}><RotateCcw className="h-4 w-4" /> Đặt lại</button>
        </div>
        {finished && <p className="text-sm font-semibold text-red-600">Hết giờ!</p>}
      </section>
      <section className={`${card} space-y-3`}>
        <h2 className="text-sm font-bold text-slate-800">Hẹn giờ</h2>
        <div className="grid grid-cols-3 gap-2">
          {([['Giờ', h, setH], ['Phút', m, setM], ['Giây', sec, setSec]] as const).map(([l, v, set]) => (
            <label key={l} className="block text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1">{l}<input inputMode="numeric" value={v} onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, 3))} className={field} /></label>
          ))}
        </div>
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1">Nhãn (tùy chọn)<input value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder="vd. Luộc trứng, Họp kết thúc…" className={field} /></label>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((min) => (
            <button key={min} onClick={() => apply(min * 60_000)} className="px-2.5 py-1 rounded-full text-xs border border-slate-200 hover:bg-amber-50 hover:border-amber-300">{min < 60 ? `${min} phút` : '1 giờ'}</button>
          ))}
        </div>
        <button onClick={() => apply(ms)} disabled={ms < 1000 || ms > 24 * 3600_000} className={btn}><Play className="h-4 w-4" /> Đặt & bắt đầu</button>
        {ms > 24 * 3600_000 && <p className="text-sm text-red-600">Tối đa 24 giờ.</p>}
      </section>
    </div>
  );
}

function StopwatchPanel({ s, now }: { s: ClockState; now: number }) {
  const w = s.stopwatch;
  const running = w.startedAt != null;
  const elapsed = stopwatchElapsed(w, now);
  const laps = w.laps.map((total, i) => ({ n: i + 1, total, split: total - (i > 0 ? w.laps[i - 1] : 0) }));
  const splits = laps.map((l) => l.split);
  const best = splits.length > 1 ? Math.min(...splits) : -1;
  const worst = splits.length > 1 ? Math.max(...splits) : -1;

  return (
    <div className="grid lg:grid-cols-2 gap-3.5 items-start">
      <section className={`${card} text-center space-y-4`}>
        <div className="text-sm font-bold uppercase tracking-widest text-sky-600">Bấm giờ</div>
        <div className="text-7xl font-bold font-mono tabular-nums text-slate-900">{formatStopwatch(elapsed)}</div>
        <div className="flex justify-center gap-2">
          <button onClick={() => act(stopwatchToggle)} className={btnPrimary}>
            {running ? <><Pause className="h-4 w-4" /> Dừng</> : <><Play className="h-4 w-4" /> {elapsed > 0 ? 'Tiếp tục' : 'Bắt đầu'}</>}
          </button>
          <button onClick={() => updateClock(stopwatchLap)} disabled={!running} className={btn}><Flag className="h-4 w-4" /> Vòng</button>
          <button onClick={() => updateClock(stopwatchReset)} disabled={running || elapsed === 0} className={btn}><RotateCcw className="h-4 w-4" /> Đặt lại</button>
        </div>
      </section>
      <section className={`${card} space-y-2`}>
        <h2 className="text-sm font-bold text-slate-800">Các vòng ({laps.length})</h2>
        {laps.length === 0 ? (
          <p className="text-sm text-slate-500">Bấm &quot;Vòng&quot; khi đang chạy để ghi lại thời gian từng chặng.</p>
        ) : (
          <ol className="max-h-80 overflow-y-auto divide-y divide-slate-100 text-sm font-mono tabular-nums">
            {[...laps].reverse().map((l) => (
              <li key={l.n} className={`flex justify-between px-1 py-1.5 ${l.split === best ? 'text-emerald-600' : l.split === worst ? 'text-red-600' : 'text-slate-700'}`}>
                <span>Vòng {l.n}</span>
                <span>{formatStopwatch(l.split)}</span>
                <span className="text-slate-400">{formatStopwatch(l.total)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

export default function PomodoroPage() {
  const s = useSyncExternalStore(subscribeClock, getClockSnapshot, getServerClockSnapshot);
  const running = s.pomodoro.endAt != null || s.countdown.endAt != null || s.stopwatch.startedAt != null;
  const now = useNow(running, s.stopwatch.startedAt != null ? 100 : 250);
  const [tab, setTab] = useState<Tab>('pomodoro');

  return (
    <div className="space-y-3.5">
      <ToolHeader icon={TimerIcon} title="Pomodoro & bấm giờ" desc="Pomodoro, đếm ngược và bấm giờ chạy nền: chuyển sang công cụ khác, tải lại hay đóng tab vẫn đếm đúng giờ.">
        <button
          onClick={() => void setClockNotify(!s.notify)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 flex items-center gap-1.5 disabled:opacity-50"
        >
          {s.notify ? <><Bell className="h-3.5 w-3.5" /> Đang bật thông báo</> : <><BellOff className="h-3.5 w-3.5" /> Bật thông báo hệ thống</>}
        </button>
      </ToolHeader>

      <div role="tablist" aria-label="Chế độ" className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          const live = id === 'pomodoro' ? s.pomodoro.endAt != null : id === 'countdown' ? s.countdown.endAt != null : s.stopwatch.startedAt != null;
          return (
            <button key={id} role="tab" aria-selected={active} onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold flex items-center gap-1.5 ${active ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              <Icon className="h-4 w-4" /> {label}
              {live && <span className={`h-2 w-2 rounded-full ${active ? 'bg-white' : 'bg-emerald-500'}`} aria-label="đang chạy" />}
            </button>
          );
        })}
      </div>

      {tab === 'pomodoro' && <PomodoroPanel s={s} now={now} />}
      {tab === 'countdown' && <CountdownPanel s={s} now={now} />}
      {tab === 'stopwatch' && <StopwatchPanel s={s} now={now} />}

      <p className="text-xs text-slate-500">
        Cả ba chế độ chạy độc lập và tiếp tục khi bạn sang công cụ khác (hiện ở góc dưới màn hình) hoặc đóng tab. Chuông và
        thông báo phát từ bất kỳ trang nào của GeTools đang mở; nếu tab đã đóng lúc hết giờ, mở lại sẽ thấy giai đoạn đã chuyển đúng.
      </p>
    </div>
  );
}
