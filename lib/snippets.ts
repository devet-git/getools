/**
 * Kho Snippet & Lịch sử đầu ra của các tool, lưu trong localStorage.
 * Mọi truy cập storage đều được bọc try/catch; không hàm nào ném lỗi.
 */
import { subscribeStorageSync, notifyStorageSync } from '@/lib/storage';

export const SNIPPETS_STORAGE_KEY = 'getools_snippets';

export type SnippetKind = 'saved' | 'history';

export interface Snippet {
  id: string;
  toolId: string;
  title: string;
  text: string;
  pinned: boolean;
  kind: SnippetKind;
  createdAt: number;
  updatedAt: number;
}

export interface SnippetStore {
  v: 1;
  items: Snippet[];
}

export const MAX_SAVED = 300;
export const MAX_HISTORY_PER_TOOL = 5;
export const MAX_HISTORY_TOTAL = 60;
export const MAX_TEXT_CHARS = 200_000;
export const MAX_STORAGE_CHARS = 3_000_000;
export const MAX_TITLE_CHARS = 120;

export type SnippetResult<T = Snippet> =
  | { ok: true; item?: T }
  | { ok: false; error: string };

/** Snapshot dùng cho server render / khi chưa có dữ liệu. */
export const SERVER_SNIPPETS_SNAPSHOT = '';

export function getServerSnippetsSnapshot(): string {
  return SERVER_SNIPPETS_SNAPSHOT;
}

/** Chuỗi thô trong localStorage (ổn định giữa các lần gọi nếu dữ liệu không đổi). */
export function getSnippetsSnapshot(): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem(SNIPPETS_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function subscribeSnippets(callback: () => void): () => void {
  return subscribeStorageSync(callback);
}

function isSnippet(x: unknown): x is Snippet {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === 'string' && o.id !== '' &&
    typeof o.toolId === 'string' &&
    typeof o.title === 'string' &&
    typeof o.text === 'string' &&
    (o.kind === 'saved' || o.kind === 'history') &&
    typeof o.createdAt === 'number' &&
    typeof o.updatedAt === 'number'
  );
}

/** Phân tích chuỗi JSON; dữ liệu hỏng/không hợp lệ cho ra danh sách rỗng. */
export function parseSnippets(raw: string | null | undefined): Snippet[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object') return [];
    const items = (data as { items?: unknown }).items;
    if (!Array.isArray(items)) return [];
    const seen = new Set<string>();
    const out: Snippet[] = [];
    for (const it of items) {
      if (!isSnippet(it) || seen.has(it.id)) continue;
      seen.add(it.id);
      out.push({
        id: it.id, toolId: it.toolId, title: it.title, text: it.text,
        pinned: it.pinned === true, kind: it.kind, createdAt: it.createdAt, updatedAt: it.updatedAt,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function load(): Snippet[] {
  return parseSnippets(getSnippetsSnapshot());
}

function serialize(items: Snippet[]): string {
  return JSON.stringify({ v: 1, items } satisfies SnippetStore);
}

function persist(items: Snippet[]): { ok: true } | { ok: false; error: string } {
  let json: string;
  try {
    json = serialize(items);
  } catch {
    return { ok: false, error: 'Không thể lưu dữ liệu.' };
  }
  if (json.length > MAX_STORAGE_CHARS) {
    return { ok: false, error: 'Kho Snippet đã đầy (vượt quá 3 MB). Hãy xóa bớt mục cũ rồi thử lại.' };
  }
  try {
    if (typeof localStorage === 'undefined') return { ok: false, error: 'Trình duyệt không cho phép lưu trữ cục bộ.' };
    localStorage.setItem(SNIPPETS_STORAGE_KEY, json);
  } catch {
    return { ok: false, error: 'Không thể ghi vào bộ nhớ trình duyệt (đã đầy hoặc bị chặn).' };
  }
  try { notifyStorageSync(); } catch { /* bỏ qua */ }
  return { ok: true };
}

let counter = 0;
function newId(): string {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanTitle(title: string, text: string): string {
  const t = title.replace(/\s+/g, ' ').trim();
  if (t) return t.slice(0, MAX_TITLE_CHARS);
  return defaultTitle(text);
}

/** Tiêu đề mặc định: dòng đầu tiên không rỗng, cắt ngắn. */
export function defaultTitle(text: string, max = 60): string {
  const first = (text.split('\n').find((l) => l.trim()) || '').replace(/\s+/g, ' ').trim();
  if (!first) return 'Không có tiêu đề';
  return first.length > max ? first.slice(0, max - 1) + '…' : first;
}

function trimText(text: string): string {
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}

/** Lưu thủ công một snippet. */
export function addSnippet(input: { toolId: string; title?: string; text: string; pinned?: boolean }): SnippetResult {
  try {
    const text = trimText(String(input.text ?? ''));
    if (!text.trim()) return { ok: false, error: 'Không có nội dung để lưu.' };
    const items = load();
    if (items.filter((i) => i.kind === 'saved').length >= MAX_SAVED) {
      return { ok: false, error: `Đã đạt giới hạn ${MAX_SAVED} snippet. Hãy xóa bớt trước khi lưu thêm.` };
    }
    const now = Date.now();
    const item: Snippet = {
      id: newId(), toolId: input.toolId, title: cleanTitle(input.title ?? '', text), text,
      pinned: !!input.pinned, kind: 'saved', createdAt: now, updatedAt: now,
    };
    const res = persist([item, ...items]);
    return res.ok ? { ok: true, item } : res;
  } catch {
    return { ok: false, error: 'Không thể lưu snippet.' };
  }
}

/**
 * Ghi vào lịch sử: bỏ qua nếu trùng văn bản liền trước của cùng tool,
 * giữ 5 mục mới nhất mỗi tool và 60 mục tổng cộng.
 */
export function addHistory(toolId: string, text: string): SnippetResult {
  try {
    const t = trimText(String(text ?? ''));
    if (!t.trim()) return { ok: false, error: 'Không có nội dung.' };
    let items = load();
    const latest = items.filter((i) => i.kind === 'history' && i.toolId === toolId)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (latest && latest.text === t) return { ok: true, item: latest };
    const now = Date.now();
    const item: Snippet = {
      id: newId(), toolId, title: defaultTitle(t), text: t,
      pinned: false, kind: 'history', createdAt: now, updatedAt: now,
    };
    items = [item, ...items];
    items = trimHistory(items);
    // Nếu vượt dung lượng, bỏ dần lịch sử cũ nhất (không đụng tới snippet đã lưu).
    let res = persist(items);
    while (!res.ok && items.some((i) => i.kind === 'history' && i.id !== item.id)) {
      const oldest = items.filter((i) => i.kind === 'history' && i.id !== item.id)
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      items = items.filter((i) => i.id !== oldest.id);
      res = persist(items);
    }
    return res.ok ? { ok: true, item } : res;
  } catch {
    return { ok: false, error: 'Không thể ghi lịch sử.' };
  }
}

function trimHistory(items: Snippet[]): Snippet[] {
  const hist = items.filter((i) => i.kind === 'history').sort((a, b) => b.createdAt - a.createdAt || 0);
  const perTool = new Map<string, number>();
  const keep = new Set<string>();
  for (const h of hist) {
    const n = (perTool.get(h.toolId) || 0) + 1;
    perTool.set(h.toolId, n);
    if (n <= MAX_HISTORY_PER_TOOL && keep.size < MAX_HISTORY_TOTAL) keep.add(h.id);
  }
  return items.filter((i) => i.kind !== 'history' || keep.has(i.id));
}

function mutate(id: string, fn: (s: Snippet) => Snippet | null): SnippetResult {
  try {
    const items = load();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return { ok: false, error: 'Không tìm thấy mục này.' };
    const next = fn(items[idx]);
    const out = items.slice();
    let item: Snippet | undefined;
    if (next === null) out.splice(idx, 1);
    else { out[idx] = next; item = next; }
    const res = persist(out);
    return res.ok ? { ok: true, item } : res;
  } catch {
    return { ok: false, error: 'Không thể cập nhật.' };
  }
}

export function renameSnippet(id: string, title: string): SnippetResult {
  return mutate(id, (s) => ({ ...s, title: cleanTitle(title, s.text), updatedAt: Date.now() }));
}

export function togglePin(id: string): SnippetResult {
  return mutate(id, (s) => ({ ...s, pinned: !s.pinned }));
}

export function removeSnippet(id: string): SnippetResult {
  return mutate(id, () => null);
}

/** Xóa toàn bộ lịch sử (giữ snippet đã lưu). */
export function clearHistory(): SnippetResult {
  try {
    const items = load();
    const kept = items.filter((i) => i.kind !== 'history');
    if (kept.length === items.length) return { ok: true };
    const res = persist(kept);
    return res.ok ? { ok: true } : res;
  } catch {
    return { ok: false, error: 'Không thể xóa lịch sử.' };
  }
}

/** Chuyển một mục lịch sử thành snippet đã lưu. */
export function promoteHistory(id: string): SnippetResult {
  try {
    const items = load();
    const cur = items.find((i) => i.id === id);
    if (!cur) return { ok: false, error: 'Không tìm thấy mục này.' };
    if (cur.kind === 'saved') return { ok: true, item: cur };
    if (items.filter((i) => i.kind === 'saved').length >= MAX_SAVED) {
      return { ok: false, error: `Đã đạt giới hạn ${MAX_SAVED} snippet. Hãy xóa bớt trước khi lưu thêm.` };
    }
  } catch {
    return { ok: false, error: 'Không thể cập nhật.' };
  }
  return mutate(id, (s) => ({ ...s, kind: 'saved', updatedAt: Date.now() }));
}
