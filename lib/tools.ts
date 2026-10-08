import type { ComponentType } from 'react';
import {
  FolderDown, Code2, Package, Link2, SearchCode, FileMinus, GitBranch, GitCommitHorizontal,
  Volume2, Mic, Sparkles, ScanText, FileSpreadsheet,
  GitCompare, Braces, Table, Type, BookOpenText, Regex, Binary, CalendarClock, Timer,
  ImageDown, QrCode, Palette, FileArchive,
} from 'lucide-react';

export interface ToolDef {
  /** Duy nhất, dùng làm key cho "gần đây / yêu thích" */
  id: string;
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
  /** Từ khóa phụ cho tìm kiếm (Ctrl+K), viết thường, có thể không dấu */
  keywords?: string[];
  badge?: string;
}

export interface ToolCategory {
  title: string;
  items: ToolDef[];
}

/** Tên mục chứa các tool Git (có nút cài đặt token + Bookmarks/Lịch sử trong sidebar) */
export const GIT_CATEGORY_TITLE = 'Công cụ Git & Mã nguồn';

export const TOOL_CATEGORIES: ToolCategory[] = [
  {
    title: GIT_CATEGORY_TITLE,
    items: [
      { id: 'download', name: 'Tải File / Thư mục', href: '/download', icon: FolderDown,
        description: 'Tải thư mục con, file lẻ hoặc file nén tùy chỉnh', keywords: ['download', 'zip', 'tai', 'github'] },
      { id: 'group-repos', name: 'GitHub Org & GitLab Group', href: '/group-repos', icon: Code2,
        description: 'Quét và clone hàng loạt kho mã nguồn', keywords: ['clone', 'org', 'group', 'repos'] },
      { id: 'releases', name: 'GitHub Releases', href: '/releases', icon: Package,
        description: 'Tìm kiếm & tải asset phiên bản đóng gói', keywords: ['release', 'asset'] },
      { id: 'link-converter', name: 'Chuyển đổi link GitHub', href: '/link-converter', icon: Link2,
        description: 'Đổi link sang raw, ZIP, git clone, curl, jsDelivr', keywords: ['raw', 'cdn', 'curl', 'clone'] },
      { id: 'repo-viewer', name: 'Xem nhanh Repo', href: '/repo-viewer', icon: SearchCode,
        description: 'Cây thư mục, dung lượng, ngôn ngữ, README mà không cần clone', keywords: ['repo', 'tree', 'readme', 'language'], badge: 'Mới' },
      { id: 'gitignore', name: '.gitignore & LICENSE', href: '/gitignore', icon: FileMinus,
        description: 'Tạo .gitignore và LICENSE từ mẫu chính thức', keywords: ['gitignore', 'license', 'mit', 'apache'], badge: 'Mới' },
      { id: 'git-cheatsheet', name: 'Cheat sheet lệnh Git', href: '/git-cheatsheet', icon: GitBranch,
        description: 'Tra cứu lệnh Git theo tình huống, có nút sao chép', keywords: ['git', 'command', 'lenh', 'undo', 'rebase'], badge: 'Mới' },
      { id: 'ai-commit', name: 'Commit message & mô tả PR (AI)', href: '/ai-commit', icon: GitCommitHorizontal,
        description: 'Sinh commit message / mô tả PR từ diff bằng AI', keywords: ['commit', 'pr', 'diff', 'conventional', 'ai'], badge: 'Mới' },
    ],
  },
  {
    title: 'AI & Đa phương tiện',
    items: [
      { id: 'tts', name: 'Chuyển văn bản thành giọng nói (TTS)', href: '/tts', icon: Volume2,
        description: 'Đọc văn bản 5 ngôn ngữ: Anh, Trung, Hàn, Nhật, Việt', keywords: ['tts', 'speech', 'giong noi'], badge: 'TTS' },
      { id: 'stt', name: 'Chuyển giọng nói thành văn bản (STT)', href: '/stt', icon: Mic,
        description: 'Ghi âm Micro & nhận diện giọng nói sang văn bản', keywords: ['stt', 'micro', 'ghi am'] },
      { id: 'ai-text', name: 'Tóm tắt / Dịch / Giải thích code (AI)', href: '/ai-text', icon: Sparkles,
        description: 'Tóm tắt, dịch văn bản và giải thích đoạn code bằng AI', keywords: ['summarize', 'translate', 'explain', 'tom tat', 'dich', 'ai'], badge: 'Mới' },
      { id: 'ai-ocr', name: 'Đọc chữ từ ảnh (OCR)', href: '/ai-ocr', icon: ScanText,
        description: 'Trích xuất văn bản từ ảnh / ảnh chụp màn hình sang Markdown', keywords: ['ocr', 'image', 'anh', 'text'], badge: 'Mới' },
    ],
  },
  {
    title: 'Tiện ích văn bản & dữ liệu',
    items: [
      { id: 'compare', name: 'So sánh File', href: '/compare', icon: GitCompare,
        description: 'So sánh hai file hoặc văn bản, làm nổi bật điểm khác nhau', keywords: ['diff', 'compare', 'so sanh'] },
      { id: 'json-yaml', name: 'JSON / YAML', href: '/json-yaml', icon: Braces,
        description: 'Định dạng, kiểm tra lỗi và chuyển đổi JSON ⇄ YAML', keywords: ['json', 'yaml', 'format', 'minify'] },
      { id: 'html-to-markdown', name: 'HTML / Text sang Markdown', href: '/html-to-markdown', icon: FileSpreadsheet,
        description: 'Chuyển đổi HTML & bảng Excel/Sheets sang Markdown GFM', keywords: ['html', 'markdown', 'excel', 'table'] },
      { id: 'data-convert', name: 'CSV ⇄ JSON ⇄ Bảng Markdown', href: '/data-convert', icon: Table,
        description: 'Chuyển đổi dữ liệu bảng giữa CSV, TSV, JSON và Markdown', keywords: ['csv', 'tsv', 'json', 'markdown', 'table', 'bang'], badge: 'Mới' },
      { id: 'text-tools', name: 'Đếm & làm sạch văn bản', href: '/text-tools', icon: Type,
        description: 'Đếm từ/ký tự, xóa dòng trùng, sắp xếp, đổi kiểu chữ, tạo slug', keywords: ['count', 'dem', 'slug', 'camelcase', 'snake', 'bo dau', 'duplicate'], badge: 'Mới' },
      { id: 'markdown-preview', name: 'Xem trước Markdown', href: '/markdown-preview', icon: BookOpenText,
        description: 'Soạn và xem Markdown song song, xuất HTML', keywords: ['markdown', 'preview', 'editor', 'html'], badge: 'Mới' },
      { id: 'regex', name: 'Regex Tester', href: '/regex', icon: Regex,
        description: 'Thử biểu thức chính quy, tô sáng match và nhóm bắt', keywords: ['regex', 'regexp', 'bieu thuc'] },
      { id: 'encode', name: 'Mã hóa / Giải mã', href: '/encode', icon: Binary,
        description: 'Base64, URL, HTML entities, JWT, hash, UUID', keywords: ['base64', 'jwt', 'hash', 'md5', 'sha', 'uuid', 'password', 'url'] },
      { id: 'time-tools', name: 'Thời gian & Timestamp', href: '/time-tools', icon: CalendarClock,
        description: 'Đổi timestamp, múi giờ, tính khoảng cách và cộng trừ ngày', keywords: ['timestamp', 'unix', 'timezone', 'date', 'mui gio', 'ngay'], badge: 'Mới' },
      { id: 'cron', name: 'Cron Expression', href: '/cron', icon: Timer,
        description: 'Giải thích cron bằng tiếng Việt, hiện các lần chạy kế tiếp', keywords: ['cron', 'schedule', 'lich'], badge: 'Mới' },
    ],
  },
  {
    title: 'File & Hình ảnh',
    items: [
      { id: 'image-tools', name: 'Nén / Đổi cỡ / Đổi định dạng ảnh', href: '/image-tools', icon: ImageDown,
        description: 'PNG, JPG, WebP: nén, đổi kích thước và chuyển định dạng', keywords: ['image', 'compress', 'resize', 'webp', 'png', 'jpg', 'anh'], badge: 'Mới' },
      { id: 'qr', name: 'Mã QR', href: '/qr', icon: QrCode,
        description: 'Tạo mã QR (văn bản, URL, Wi-Fi) và đọc mã QR từ ảnh', keywords: ['qr', 'barcode', 'wifi'], badge: 'Mới' },
      { id: 'color-tools', name: 'Màu sắc & Gradient', href: '/color-tools', icon: Palette,
        description: 'Chọn màu, đổi HEX/RGB/HSL, kiểm tra tương phản, tạo gradient CSS', keywords: ['color', 'colour', 'hex', 'rgb', 'hsl', 'contrast', 'gradient', 'mau'], badge: 'Mới' },
      { id: 'file-tools', name: 'PDF & ZIP', href: '/file-tools', icon: FileArchive,
        description: 'Gộp / tách PDF và xem nội dung file ZIP trước khi giải nén', keywords: ['pdf', 'merge', 'split', 'zip', 'gop', 'tach'], badge: 'Mới' },
    ],
  },
];

export const ALL_TOOLS: ToolDef[] = TOOL_CATEGORIES.flatMap((c) => c.items);

export function findToolByHref(pathname: string): ToolDef | undefined {
  return ALL_TOOLS.find((t) => t.href === pathname);
}
