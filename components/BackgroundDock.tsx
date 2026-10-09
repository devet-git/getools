'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertCircle, CheckCircle2, Hourglass, Loader2, Pause, Play, Timer, Watch, X } from 'lucide-react';
import { useNow } from '@/hooks/use-now';
import { countdownPause, countdownRemaining, pomodoroRemaining, pomodoroToggle, stopwatchElapsed, stopwatchToggle } from '@/lib/clock';
import { getClockSnapshot, getServerClockSnapshot, subscribeClock, unlockClockAudio, updateClock } from '@/lib/clock-store';
import { PHASE_LABEL, formatClock } from '@/lib/pomodoro';
import { getTool, toolHref } from '@/lib/tools';
import { dismissJob, getJobsSnapshot, getServerJobsSnapshot, subscribeJobs, type BackgroundJob } from '@/lib/background-jobs';

const CLOCK_HREF = toolHref('pomodoro');

/** Bấm giờ: hiện tới phần mười giây */
export function formatStopwatch(ms: number): string {
  const tenth = Math.floor((ms % 1000) / 100);
  return `${formatClock(Math.floor(ms / 1000))}.${tenth}`;
}

function Pill({ icon: Icon, label, time, running, onToggle, tone }: {
  icon: typeof Timer;
  label: string;
  time: string;
  running: boolean;
  onToggle: () => void;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white pl-1 pr-1 py-1 shadow-lg">
      <Link
        href={CLOCK_HREF}
        data-tooltip="Mở Pomodoro & bấm giờ"
        className="flex items-center gap-2 rounded-full px-2 py-0.5 hover:bg-slate-50"
      >
        <Icon className={`h-4 w-4 ${tone}`} />
        <span className="text-[11px] font-semibold text-slate-500">{label}</span>
        <span className="font-mono text-sm font-bold tabular-nums text-slate-900">{time}</span>
      </Link>
      <button
        type="button"
        onClick={onToggle}
        aria-label={running ? 'Tạm dừng' : 'Tiếp tục'}
        data-tooltip={running ? 'Tạm dừng' : 'Tiếp tục'}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200"
      >
        {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

/** Tác vụ xong tự ẩn sau chừng này; tác vụ lỗi giữ lại tới khi người dùng đóng */
const DONE_HIDE_MS = 6000;

function JobCard({ job }: { job: BackgroundJob }) {
  const tool = getTool(job.toolId);
  useEffect(() => {
    if (job.status !== 'done') return;
    const t = setTimeout(() => dismissJob(job.id), DONE_HIDE_MS);
    return () => clearTimeout(t);
  }, [job.id, job.status]);
  const Icon = job.status === 'running' ? Loader2 : job.status === 'done' ? CheckCircle2 : AlertCircle;
  const tone = job.status === 'running' ? 'text-indigo-600 animate-spin' : job.status === 'done' ? 'text-emerald-600' : 'text-red-600';
  return (
    <div role="status" className="w-72 rounded-xl border border-slate-200 bg-white p-2.5 shadow-lg">
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
        <div className="min-w-0 flex-1">
          {tool ? (
            <Link href={tool.href} className="block truncate text-xs font-semibold text-slate-800 hover:text-indigo-600" data-tooltip={`Mở ${tool.name}`}>{job.title}</Link>
          ) : (
            <div className="truncate text-xs font-semibold text-slate-800">{job.title}</div>
          )}
          <div className={`truncate text-[11px] ${job.status === 'error' ? 'text-red-600' : 'text-slate-500'}`} data-tooltip={job.message}>{job.message}</div>
        </div>
        {job.status !== 'running' && (
          <button type="button" onClick={() => dismissJob(job.id)} aria-label="Đóng" className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {job.status === 'running' && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
          {job.percent == null ? (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-indigo-400" />
          ) : (
            <div className="h-full rounded-full bg-indigo-500 transition-[width] duration-300" style={{ width: `${job.percent}%` }} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Khu nổi ở góc dưới: đồng hồ đang chạy và tác vụ nền (tải repo, asset...) khi người dùng ở trang khác — bấm để
 * quay lại tool; đồng thời cập nhật tiêu đề tab theo thời gian còn lại. Gắn một lần trong AppShell — việc đếm/báo giờ do lib/clock-store lo.
 */
export function BackgroundDock() {
  const pathname = usePathname();
  const clock = useSyncExternalStore(subscribeClock, getClockSnapshot, getServerClockSnapshot);
  const { pomodoro: p, countdown: c, stopwatch: w } = clock;
  const allJobs = useSyncExternalStore(subscribeJobs, getJobsSnapshot, getServerJobsSnapshot);
  // Đang ở chính trang của tool thì trang đó đã hiện tiến trình
  const jobs = allJobs.filter((j) => getTool(j.toolId)?.href !== pathname);
  const anyRunning = p.endAt != null || c.endAt != null || w.startedAt != null;
  const now = useNow(anyRunning, w.startedAt != null ? 100 : 500);

  // Tiêu đề tab: thời gian còn lại của Pomodoro / đếm ngược đang chạy
  const baseTitle = useRef<string | null>(null);
  const titleText =
    p.endAt != null
      ? `${formatClock(pomodoroRemaining(p, now) / 1000)} · ${PHASE_LABEL[p.phase]}`
      : c.endAt != null
        ? `${formatClock(countdownRemaining(c, now) / 1000)} · ${c.label || 'Đếm ngược'}`
        : null;
  useEffect(() => {
    if (!titleText) {
      if (baseTitle.current != null) {
        document.title = baseTitle.current;
        baseTitle.current = null;
      }
      return;
    }
    baseTitle.current ??= document.title;
    const apply = () => {
      document.title = `${titleText} — GeTools`;
    };
    apply();
    // Next đặt lại tiêu đề theo metadata ngay sau khi chuyển trang: gán lại để không bị mất ~1 giây
    const t = setTimeout(apply, 60);
    return () => clearTimeout(t);
  }, [titleText, pathname]);

  const act = (fn: Parameters<typeof updateClock>[0]) => {
    unlockClockAudio();
    updateClock(fn);
  };

  // Ở chính trang đồng hồ thì giao diện đầy đủ đã hiện, không cần widget
  const showClocks = anyRunning && pathname !== CLOCK_HREF;
  if (!showClocks && jobs.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2" aria-label="Tác vụ đang chạy">
      {jobs.map((j) => <JobCard key={j.id} job={j} />)}
      {showClocks && (
        <>
      {p.endAt != null && (
        <Pill icon={Timer} tone={p.phase === 'work' ? 'text-indigo-600' : 'text-emerald-600'} label={PHASE_LABEL[p.phase]}
          time={formatClock(pomodoroRemaining(p, now) / 1000)} running onToggle={() => act(pomodoroToggle)} />
      )}
      {c.endAt != null && (
        <Pill icon={Hourglass} tone="text-amber-600" label={c.label || 'Đếm ngược'}
          time={formatClock(countdownRemaining(c, now) / 1000)} running onToggle={() => act(countdownPause)} />
      )}
      {w.startedAt != null && (
        <Pill icon={Watch} tone="text-sky-600" label="Bấm giờ" time={formatStopwatch(stopwatchElapsed(w, now))} running
          onToggle={() => act(stopwatchToggle)} />
      )}
        </>
      )}
    </div>
  );
}
