// Checklist lưu trên trình duyệt, kèm vài mẫu dựng sẵn.

export interface CheckItem { id: string; text: string; done: boolean }
export interface CheckList { id: string; title: string; items: CheckItem[] }

const KEY = 'getools_checklists';
const uid = () => Math.random().toString(36).slice(2, 10);

export const TEMPLATES: { name: string; items: string[] }[] = [
  { name: 'Đi du lịch', items: ['CCCD / hộ chiếu', 'Vé máy bay / tàu xe', 'Đặt phòng khách sạn', 'Sạc điện thoại, sạc dự phòng', 'Thuốc cá nhân', 'Quần áo theo thời tiết', 'Kem chống nắng, áo mưa', 'Tiền mặt & thẻ ngân hàng', 'Tắt điện, khóa nước, khóa cửa'] },
  { name: 'Chuyển nhà', items: ['Báo chủ nhà / hủy hợp đồng thuê', 'Đặt xe & người vận chuyển', 'Đóng gói đồ theo phòng, dán nhãn', 'Chuyển internet, điện, nước', 'Cập nhật địa chỉ (ngân hàng, giấy tờ)', 'Vệ sinh nhà cũ & bàn giao', 'Chụp ảnh nhà khi bàn giao'] },
  { name: 'Chuẩn bị họp', items: ['Chốt mục tiêu cuộc họp', 'Gửi agenda trước cho mọi người', 'Chuẩn bị tài liệu / slide', 'Kiểm tra phòng, link họp, micro', 'Phân công người ghi biên bản', 'Gửi biên bản & việc cần làm sau họp'] },
  { name: 'Đi chợ Tết', items: ['Bánh chưng / bánh tét', 'Thịt, giò chả', 'Rau củ, trái cây', 'Mứt, bánh kẹo', 'Hoa, cây cảnh', 'Lì xì', 'Nhang đèn, vàng mã'] },
];

export const newList = (title: string, items: string[] = []): CheckList => ({
  id: uid(), title, items: items.map((text) => ({ id: uid(), text, done: false })),
});
export const newItem = (text: string): CheckItem => ({ id: uid(), text, done: false });

export function progress(l: CheckList): { done: number; total: number; pct: number } {
  const done = l.items.filter((i) => i.done).length;
  return { done, total: l.items.length, pct: l.items.length ? Math.round((done / l.items.length) * 100) : 0 };
}

/** Dán nhiều dòng → nhiều mục (bỏ dòng trống và gạch đầu dòng / ô vuông ở đầu). */
export function parseBulk(text: string): string[] {
  return text.split('\n').map((s) => s.trim().replace(/^([-*•]\s*(\[[ xX]\]\s*)?|\d+[.)]\s+)/, '').trim()).filter(Boolean);
}

export function toText(l: CheckList): string {
  return [l.title, ...l.items.map((i) => `${i.done ? '[x]' : '[ ]'} ${i.text}`)].join('\n');
}

export function load(): CheckList[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    return v.filter((l) => l && typeof l.id === 'string' && typeof l.title === 'string' && Array.isArray(l.items))
      .map((l) => ({
        id: l.id, title: l.title,
        items: l.items.filter((i: unknown) => i && typeof (i as CheckItem).id === 'string' && typeof (i as CheckItem).text === 'string')
          .map((i: CheckItem) => ({ id: i.id, text: i.text, done: !!i.done })),
      }));
  } catch { return null; }
}

export function save(lists: CheckList[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(lists)); } catch { /* đầy bộ nhớ hoặc bị chặn */ }
}
