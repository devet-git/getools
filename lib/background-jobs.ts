/**
 * Tác vụ nền: việc chạy lâu (tải repo, tải asset...) tách khỏi vòng đời của trang. Người dùng chuyển sang công cụ
 * khác thì việc vẫn chạy, tiến trình hiện ở khu nổi góc màn hình (components/BackgroundDock.tsx).
 * Chỉ sống trong tab hiện tại: đóng / tải lại tab sẽ dừng (app hỏi xác nhận trước — xem lib/leave-guard.ts).
 */

export type JobStatus = 'running' | 'done' | 'error';

export interface BackgroundJob {
  id: string;
  /** Tool tạo ra việc (để trang đó hiện lại tiến trình khi người dùng quay lại) */
  toolId: string;
  /** Khóa nhận diện trong tool (vd. id asset) để trang biết mục nào đang chạy */
  key?: string;
  title: string;
  status: JobStatus;
  /** 0–100, null = chưa biết tiến độ */
  percent: number | null;
  message: string;
  startedAt: number;
  endedAt: number | null;
}

export interface JobContext {
  report: (p: { percent?: number | null; message?: string }) => void;
}

let jobs: BackgroundJob[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function patch(id: string, p: Partial<BackgroundJob>) {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...p } : j));
  emit();
}

/**
 * Chạy `task` như một tác vụ nền. Trả về Promise kết thúc cùng tác vụ (reject nếu lỗi) để nơi gọi vẫn xử lý
 * tiếp được khi còn ở trang; nếu đã rời trang thì kết quả vẫn hiện ở khu nổi.
 */
export function runJob(toolId: string, title: string, task: (ctx: JobContext) => Promise<string | void>, key?: string): Promise<string | void> {
  const id = `job-${Date.now()}-${++seq}`;
  jobs = [...jobs, { id, toolId, key, title, status: 'running', percent: null, message: 'Đang bắt đầu…', startedAt: Date.now(), endedAt: null }];
  emit();
  const report: JobContext['report'] = ({ percent, message }) => {
    const j = jobs.find((x) => x.id === id);
    if (!j || j.status !== 'running') return;
    patch(id, {
      ...(percent !== undefined ? { percent: percent == null ? null : Math.max(0, Math.min(100, Math.round(percent))) } : {}),
      ...(message !== undefined ? { message } : {}),
    });
  };
  return task({ report }).then(
    (msg) => {
      patch(id, { status: 'done', percent: 100, message: msg || 'Hoàn tất', endedAt: Date.now() });
      return msg;
    },
    (err: unknown) => {
      patch(id, { status: 'error', message: err instanceof Error ? err.message : 'Có lỗi xảy ra', endedAt: Date.now() });
      throw err;
    },
  );
}

export function dismissJob(id: string) {
  jobs = jobs.filter((j) => j.id !== id || j.status === 'running');
  emit();
}

export const hasRunningJobs = () => jobs.some((j) => j.status === 'running');

export function subscribeJobs(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const EMPTY: BackgroundJob[] = [];
export const getJobsSnapshot = () => jobs;
export const getServerJobsSnapshot = () => EMPTY;
