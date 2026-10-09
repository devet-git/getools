/**
 * Hộp thoại thay cho alert / confirm mặc định của trình duyệt: gọi được từ bất cứ đâu, trả về Promise.
 * Giao diện do components/DialogHost.tsx vẽ (gắn một lần trong AppShell); các yêu cầu xếp hàng lần lượt.
 *
 *   await showAlert('Không thể tải file.');
 *   if (!(await showConfirm('Xóa danh sách?', { danger: true }))) return;
 */

export interface DialogRequest {
  id: number;
  kind: 'alert' | 'confirm';
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  /** Hành động phá hủy (xóa...): nút xác nhận màu đỏ */
  danger: boolean;
  resolve: (ok: boolean) => void;
}

export interface DialogOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

let queue: DialogRequest[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(kind: DialogRequest['kind'], message: string, opts: DialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [
      ...queue,
      {
        id: ++seq,
        kind,
        message,
        title: opts.title ?? (kind === 'alert' ? 'Thông báo' : 'Xác nhận'),
        confirmText: opts.confirmText ?? (kind === 'alert' ? 'Đã hiểu' : opts.danger ? 'Xóa' : 'Đồng ý'),
        cancelText: opts.cancelText ?? 'Hủy',
        danger: !!opts.danger,
        resolve,
      },
    ];
    emit();
  });
}

export function showAlert(message: string, opts: Omit<DialogOptions, 'cancelText' | 'danger'> = {}): Promise<void> {
  return push('alert', message, opts).then(() => undefined);
}

export function showConfirm(message: string, opts: DialogOptions = {}): Promise<boolean> {
  return push('confirm', message, opts);
}

/** Đóng hộp thoại đang hiện với kết quả `ok` */
export function settleDialog(id: number, ok: boolean) {
  const req = queue.find((d) => d.id === id);
  if (!req) return;
  queue = queue.filter((d) => d.id !== id);
  emit();
  req.resolve(ok);
}

export function subscribeDialogs(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const EMPTY: DialogRequest[] = [];
export const getDialogQueue = () => queue;
export const getServerDialogQueue = () => EMPTY;
