import type { ComponentType } from 'react';
import {
  FolderDown, Code2, Package, Link2, SearchCode, FileMinus, GitBranch, GitCommitHorizontal,
  Volume2, Mic, Sparkles, ScanText, FileSpreadsheet,
  GitCompare, Braces, Table, Type, BookOpenText, Regex, Binary, CalendarClock, Timer,
  ImageDown, QrCode, Palette, FileArchive,
  FileJson2, Terminal, GitCompareArrows, ListTree, Database, Container, FileCog, Dices, Calculator,
  Globe, Tags, KeyRound, FileLock, FolderTree, NotebookText, ScrollText, AppWindow, LayoutGrid, BookMarked,
  CalendarDays, Percent, LockKeyhole, HeartPulse, Shuffle, Zap, ShieldCheck, FileText, FilePen, CalendarPlus, ListChecks, Receipt, Wallet, Landmark, ArrowLeftRight, Speech, Fingerprint, FileBadge, Workflow, Server, ChartNoAxesCombined, Coins, ImagePlus, Boxes,
  Coffee, Images, FileOutput,
} from 'lucide-react';

/**
 * Danh mục công cụ — nguồn dữ liệu duy nhất cho sidebar, trang chủ, Ctrl+K, Smart Paste...
 *
 * URL của mỗi tool được sinh theo nhóm: `/<id nhóm>/<id tool>` (vd. `/dev/json-to-code`),
 * khớp với thư mục `app/<id nhóm>/<id tool>/page.tsx`.
 *
 * Thêm tool mới: tạo `app/<nhóm>/<id>/page.tsx` rồi khai báo một mục trong `CATEGORY_SPECS`.
 * Thêm nhóm mới: thêm id vào `CategoryId`, khai báo nhóm trong `CATEGORY_SPECS` và tạo
 * `app/<nhóm>/page.tsx` (trang tổng quan nhóm).
 */

export type CategoryId = 'git' | 'dev' | 'web' | 'text' | 'media' | 'ai' | 'finance' | 'life';

type Icon = ComponentType<{ className?: string }>;

export interface ToolDef {
  /** Duy nhất, dùng làm slug trên URL và làm key cho "gần đây / yêu thích", snippet, handoff */
  id: string;
  name: string;
  /** Sinh tự động: `/<nhóm>/<id>` */
  href: string;
  /** Nhóm chứa tool */
  category: CategoryId;
  icon: Icon;
  description: string;
  /** Từ khóa phụ cho tìm kiếm (Ctrl+K), viết thường, có thể không dấu */
  keywords?: string[];
  badge?: string;
  /** Tool bắt buộc có khóa AI: 'any' = khóa của nhà cung cấp đang chọn; 'gemini' = chỉ Gemini (vd. TTS) */
  requiresAi?: 'any' | 'gemini';
  /** Tool dùng được miễn phí (tính năng của trình duyệt / xử lý cục bộ); thêm khóa AI sẽ mở thêm tính năng nâng cao */
  aiEnhanced?: boolean;
}

export interface ToolCategory {
  id: CategoryId;
  title: string;
  /** Mô tả ngắn, hiện ở trang tổng quan nhóm */
  description: string;
  icon: Icon;
  /** Sinh tự động: `/<id>` — trang tổng quan của nhóm */
  href: string;
  /** Nhóm dành cho mọi người dùng (không cần kiến thức lập trình) — hiện khi bật chế độ "Phổ thông" ở trang chủ */
  general?: boolean;
  items: ToolDef[];
}

type ToolSpec = Omit<ToolDef, 'href' | 'category'>;
type CategorySpec = Omit<ToolCategory, 'href' | 'items'> & { items: ToolSpec[] };

const CATEGORY_SPECS: CategorySpec[] = [
  {
    id: 'git',
    title: 'Git & Mã nguồn',
    description: 'Tải file/thư mục, clone hàng loạt, xem và phân tích repo, viết README, commit message và .gitignore',
    icon: GitBranch,
    items: [
      { id: 'download', name: 'Tải File / Thư mục', icon: FolderDown,
        description: 'Tải thư mục con, file lẻ hoặc file nén tùy chỉnh', keywords: ['download', 'zip', 'tai', 'github'] },
      { id: 'group-repos', name: 'GitHub Org & GitLab Group', icon: Code2,
        description: 'Quét và clone hàng loạt kho mã nguồn', keywords: ['clone', 'org', 'group', 'repos'] },
      { id: 'releases', name: 'GitHub Releases', icon: Package,
        description: 'Tìm kiếm & tải asset phiên bản đóng gói', keywords: ['release', 'asset'] },
      { id: 'link-converter', name: 'Chuyển đổi link GitHub', icon: Link2,
        description: 'Đổi link sang raw, ZIP, git clone, curl, jsDelivr', keywords: ['raw', 'cdn', 'curl', 'clone'] },
      { id: 'repo-viewer', name: 'Xem nhanh Repo', icon: SearchCode,
        description: 'Cây thư mục, dung lượng, ngôn ngữ, README mà không cần clone', keywords: ['repo', 'tree', 'readme', 'language'], badge: 'Mới' },
      { id: 'repo-analytics', name: 'Phân tích Repo', icon: ChartNoAxesCombined,
        description: 'Người đóng góp, biểu đồ nhiệt commit, tốc độ phát hành, issue/PR tồn đọng', keywords: ['analytics', 'contributors', 'commits', 'heatmap', 'insights', 'github', 'thong ke'], badge: 'Mới' },
      { id: 'ai-commit', name: 'Commit message & mô tả PR', icon: GitCommitHorizontal,
        description: 'Phân tích diff để sinh commit message, mô tả PR và cảnh báo rủi ro (miễn phí); thêm khóa AI để viết lại và review', keywords: ['commit', 'pr', 'diff', 'conventional', 'ai'], badge: 'Mới', aiEnhanced: true },
      { id: 'gitignore', name: '.gitignore & LICENSE', icon: FileMinus,
        description: 'Tạo .gitignore và LICENSE từ mẫu chính thức', keywords: ['gitignore', 'license', 'mit', 'apache'], badge: 'Mới' },
      { id: 'readme-builder', name: 'Tạo README & Badge', icon: NotebookText,
        description: 'Dựng README từ mẫu, thêm badge shields.io và mục lục', keywords: ['readme', 'badge', 'shields', 'markdown', 'docs'], badge: 'Mới' },
      { id: 'tree-gen', name: 'Sơ đồ cây thư mục', icon: FolderTree,
        description: 'Biến danh sách đường dẫn / thụt lề thành cây ├── └── cho README', keywords: ['tree', 'folder', 'directory', 'ascii', 'structure', 'readme'], badge: 'Mới' },
      { id: 'git-cheatsheet', name: 'Cheat sheet lệnh Git', icon: GitBranch,
        description: 'Tra cứu lệnh Git theo tình huống, có nút sao chép', keywords: ['git', 'command', 'lenh', 'undo', 'rebase'], badge: 'Mới' },
    ],
  },
  {
    id: 'dev',
    title: 'Developer & DevOps',
    description: 'Sinh code, xử lý JSON/SQL/URL/log, cấu hình Docker, Nginx, CI/CD, chứng chỉ và bảo mật',
    icon: Terminal,
    items: [
      { id: 'json-to-code', name: 'JSON → Code (TS, Go, Python...)', icon: FileJson2,
        description: 'Sinh interface/struct/class từ JSON: TypeScript, Go, Python, Kotlin, Rust, Zod, JSON Schema', keywords: ['typescript', 'interface', 'struct', 'pydantic', 'zod', 'schema', 'quicktype', 'type'], badge: 'Mới' },
      { id: 'curl-converter', name: 'cURL → Code', icon: Terminal,
        description: 'Đổi lệnh cURL sang fetch, axios, Python requests, Go, PHP, HTTPie', keywords: ['curl', 'fetch', 'axios', 'requests', 'http', 'api'], badge: 'Mới' },
      { id: 'json-diff', name: 'So sánh JSON (theo cấu trúc)', icon: GitCompareArrows,
        description: 'So sánh hai JSON theo đường dẫn, bỏ qua thứ tự khóa, xuất JSON Patch', keywords: ['json', 'diff', 'patch', 'compare', 'rfc6902'], badge: 'Mới' },
      { id: 'json-explorer', name: 'JSON Explorer & JSONPath', icon: ListTree,
        description: 'Duyệt JSON dạng cây, tìm kiếm, truy vấn JSONPath, chép đường dẫn', keywords: ['json', 'jsonpath', 'tree', 'query', 'jq', 'path'], badge: 'Mới' },
      { id: 'sql-tools', name: 'SQL Formatter', icon: Database,
        description: 'Định dạng, nén và làm đẹp câu lệnh SQL (nhiều dialect)', keywords: ['sql', 'format', 'beautify', 'mysql', 'postgres', 'query'], badge: 'Mới' },
      { id: 'mock-data', name: 'Sinh dữ liệu giả', icon: Dices,
        description: 'Tạo dữ liệu mẫu (tên, email, SĐT VN, địa chỉ...) ra JSON, CSV, SQL', keywords: ['mock', 'fake', 'faker', 'seed', 'lorem', 'sample', 'data'], badge: 'Mới' },
      { id: 'url-tools', name: 'URL Parser & Query Builder', icon: Globe,
        description: 'Phân tích URL, sửa query dạng bảng, mã hóa và dựng lại URL', keywords: ['url', 'query', 'params', 'parse', 'encode', 'uri'], badge: 'Mới' },
      { id: 'number-tools', name: 'Hệ cơ số, Bit & IEEE-754', icon: Calculator,
        description: 'Đổi cơ số, xem/bật tắt từng bit, phân tích số thực IEEE-754, đổi đơn vị dung lượng', keywords: ['binary', 'hex', 'bit', 'float', 'ieee', 'base', 'bytes', 'kib'], badge: 'Mới' },
      { id: 'cron', name: 'Cron Expression', icon: Timer,
        description: 'Giải thích cron bằng tiếng Việt, hiện các lần chạy kế tiếp', keywords: ['cron', 'schedule', 'lich'], badge: 'Mới' },
      { id: 'log-viewer', name: 'Log Viewer', icon: ScrollText,
        description: 'Dán log, lọc theo mức độ / regex, đếm theo thời gian, gập stack trace', keywords: ['log', 'logs', 'stacktrace', 'error', 'filter', 'debug'], badge: 'Mới' },
      { id: 'dev-reference', name: 'Tra cứu nhanh cho Dev', icon: BookMarked,
        description: 'HTTP status, header, cổng mạng thông dụng, MIME, bảng ASCII, HTML entities', keywords: ['http', 'status', 'port', 'mime', 'ascii', 'entities', 'reference', 'header'], badge: 'Mới' },
      // DevOps
      { id: 'docker-tools', name: 'Docker run ⇄ Compose', icon: Container,
        description: 'Đổi lệnh docker run sang docker-compose.yml và ngược lại', keywords: ['docker', 'compose', 'container', 'yaml', 'run'], badge: 'Mới' },
      { id: 'dockerfile', name: 'Dockerfile Generator & Linter', icon: Boxes,
        description: 'Sinh Dockerfile multi-stage theo ngôn ngữ và cảnh báo thực hành xấu', keywords: ['docker', 'dockerfile', 'lint', 'multistage', 'container', 'hadolint'], badge: 'Mới' },
      { id: 'env-tools', name: '.env & Config', icon: FileCog,
        description: '.env ⇄ JSON ⇄ YAML ⇄ cờ docker -e ⇄ Kubernetes ConfigMap/Secret', keywords: ['env', 'dotenv', 'kubernetes', 'secret', 'configmap', 'base64'], badge: 'Mới' },
      { id: 'nginx-config', name: 'Nginx Config Generator', icon: Server,
        description: 'Reverse proxy, SSL, gzip, SPA fallback, rate limit, header bảo mật', keywords: ['nginx', 'proxy', 'ssl', 'https', 'gzip', 'spa', 'rate limit', 'server'], badge: 'Mới' },
      { id: 'github-actions', name: 'GitHub Actions Builder', icon: Workflow,
        description: 'Dựng file workflow CI/CD: ngôn ngữ, cache, matrix, deploy; kiểm tra lỗi cơ bản', keywords: ['actions', 'workflow', 'ci', 'cd', 'yaml', 'github', 'pipeline'], badge: 'Mới' },
      { id: 'chmod', name: 'Chmod & Quyền Unix', icon: FileLock,
        description: 'Máy tính chmod: rwx ⇄ số bát phân ⇄ lệnh, umask, setuid/setgid/sticky', keywords: ['chmod', 'permission', 'umask', 'unix', 'linux', 'rwx'], badge: 'Mới' },
      // Bảo mật
      { id: 'jwt-tools', name: 'JWT Sign & Verify', icon: KeyRound,
        description: 'Tạo, ký và xác minh JWT (HS256/384/512, RS256) ngay trên trình duyệt', keywords: ['jwt', 'token', 'hmac', 'rsa', 'sign', 'verify'], badge: 'Mới' },
      { id: 'totp', name: 'TOTP / Mã 2FA', icon: Fingerprint,
        description: 'Sinh mã 6 số từ secret (RFC 6238), tạo mã QR provisioning để thử và debug 2FA', keywords: ['totp', 'otp', '2fa', 'authenticator', 'hotp', 'secret', 'base32'], badge: 'Mới' },
      { id: 'x509', name: 'Chứng chỉ X.509 / PEM', icon: FileBadge,
        description: 'Đọc chủ thể, hạn dùng, SAN, vân tay và chuỗi chứng chỉ từ PEM', keywords: ['certificate', 'ssl', 'tls', 'pem', 'x509', 'csr', 'chung chi', 'fingerprint'], badge: 'Mới' },
    ],
  },
  {
    id: 'web',
    title: 'Web & Thiết kế',
    description: 'SEO & meta tags, ảnh chia sẻ mạng xã hội, favicon, CSS layout và màu sắc',
    icon: Palette,
    items: [
      { id: 'meta-tags', name: 'Meta Tags & Social Preview', icon: Tags,
        description: 'Sinh thẻ SEO / Open Graph / Twitter Card và xem trước thẻ chia sẻ', keywords: ['seo', 'og', 'opengraph', 'twitter', 'meta', 'html', 'head'], badge: 'Mới' },
      { id: 'og-image', name: 'Tạo ảnh Open Graph', icon: ImagePlus,
        description: 'Tạo ảnh social card 1200×630 từ mẫu, xuất PNG/JPEG cho meta tag', keywords: ['og', 'opengraph', 'social', 'card', 'thumbnail', 'twitter', 'share', 'banner'], badge: 'Mới' },
      { id: 'favicon-gen', name: 'Favicon & App Icon', icon: AppWindow,
        description: 'Tạo bộ favicon (ICO, PNG, Apple Touch) và manifest từ một ảnh, tải về ZIP', keywords: ['favicon', 'icon', 'ico', 'apple-touch', 'pwa', 'manifest'], badge: 'Mới' },
      { id: 'css-playground', name: 'CSS Flex / Grid & Tiện ích', icon: LayoutGrid,
        description: 'Sân chơi Flexbox/Grid sinh CSS, clamp() fluid, px ⇄ rem, box-shadow', keywords: ['css', 'flexbox', 'grid', 'clamp', 'rem', 'shadow', 'layout'], badge: 'Mới' },
      { id: 'color-tools', name: 'Màu sắc & Gradient', icon: Palette,
        description: 'Chọn màu, đổi HEX/RGB/HSL, kiểm tra tương phản, tạo gradient CSS', keywords: ['color', 'colour', 'hex', 'rgb', 'hsl', 'contrast', 'gradient', 'mau'], badge: 'Mới' },
    ],
  },
  {
    id: 'text',
    title: 'Văn bản & Dữ liệu',
    description: 'So sánh, định dạng và chuyển đổi văn bản, JSON/YAML/CSV/Markdown, regex, mã hóa và thời gian',
    icon: Type,
    items: [
      { id: 'compare', name: 'So sánh File', icon: GitCompare,
        description: 'So sánh hai file hoặc văn bản, làm nổi bật điểm khác nhau', keywords: ['diff', 'compare', 'so sanh'] },
      { id: 'json-yaml', name: 'JSON / YAML', icon: Braces,
        description: 'Định dạng, kiểm tra lỗi và chuyển đổi JSON ⇄ YAML', keywords: ['json', 'yaml', 'format', 'minify'] },
      { id: 'data-convert', name: 'CSV ⇄ JSON ⇄ Bảng Markdown', icon: Table,
        description: 'Chuyển đổi dữ liệu bảng giữa CSV, TSV, JSON và Markdown', keywords: ['csv', 'tsv', 'json', 'markdown', 'table', 'bang'], badge: 'Mới' },
      { id: 'html-to-markdown', name: 'HTML / Text sang Markdown', icon: FileSpreadsheet,
        description: 'Chuyển đổi HTML & bảng Excel/Sheets sang Markdown GFM', keywords: ['html', 'markdown', 'excel', 'table'] },
      { id: 'markdown-preview', name: 'Xem trước Markdown', icon: BookOpenText,
        description: 'Soạn và xem Markdown song song, xuất HTML', keywords: ['markdown', 'preview', 'editor', 'html'], badge: 'Mới' },
      { id: 'text-tools', name: 'Đếm & làm sạch văn bản', icon: Type,
        description: 'Đếm từ/ký tự, xóa dòng trùng, sắp xếp, đổi kiểu chữ, tạo slug', keywords: ['count', 'dem', 'slug', 'camelcase', 'snake', 'bo dau', 'duplicate'], badge: 'Mới' },
      { id: 'regex', name: 'Regex Tester', icon: Regex,
        description: 'Thử biểu thức chính quy, tô sáng match và nhóm bắt', keywords: ['regex', 'regexp', 'bieu thuc'] },
      { id: 'encode', name: 'Mã hóa / Giải mã', icon: Binary,
        description: 'Base64, URL, HTML entities, JWT, hash, UUID', keywords: ['base64', 'jwt', 'hash', 'md5', 'sha', 'uuid', 'password', 'url'] },
      { id: 'time-tools', name: 'Thời gian & Timestamp', icon: CalendarClock,
        description: 'Đổi timestamp, múi giờ, tính khoảng cách và cộng trừ ngày', keywords: ['timestamp', 'unix', 'timezone', 'date', 'mui gio', 'ngay'], badge: 'Mới' },
    ],
  },
  {
    id: 'media',
    title: 'File & Hình ảnh',
    description: 'Chuyển đổi định dạng file, nén/đổi cỡ ảnh, biên tập PDF, xem ZIP và mã QR',
    icon: Images,
    general: true,
    items: [
      { id: 'file-convert', name: 'Chuyển đổi định dạng file', icon: FileOutput,
        description: 'Ảnh, PDF, Word, Excel, CSV/JSON/YAML, Markdown, âm thanh → định dạng khác, xử lý ngay trên trình duyệt', keywords: ['convert', 'chuyen doi', 'doi dinh dang', 'doi duoi', 'docx', 'word', 'excel', 'xlsx', 'csv', 'pdf sang anh', 'png', 'jpg', 'webp', 'heic', 'ico', 'mp3', 'wav', 'yaml', 'markdown', 'converter'], badge: 'Mới' },
      { id: 'image-tools', name: 'Nén / Đổi cỡ / Đổi định dạng ảnh', icon: ImageDown,
        description: 'PNG, JPG, WebP: nén, đổi kích thước và chuyển định dạng', keywords: ['image', 'compress', 'resize', 'webp', 'png', 'jpg', 'anh'], badge: 'Mới' },
      { id: 'pdf-edit', name: 'Biên tập PDF', icon: FilePen,
        description: 'Đánh số trang, thêm watermark, xoay / xóa / sắp xếp trang, ghép ảnh thành PDF và chuyển PDF thành ảnh ngay trên trình duyệt', keywords: ['pdf to image', 'pdf sang anh', 'chuyen pdf thanh anh', 'pdf', 'danh so trang', 'watermark', 'xoay', 'xoa trang', 'sap xep', 'anh sang pdf', 'image to pdf', 'page number'], badge: 'Mới' },
      { id: 'file-tools', name: 'PDF & ZIP', icon: FileArchive,
        description: 'Gộp / tách PDF và xem nội dung file ZIP trước khi giải nén', keywords: ['pdf', 'merge', 'split', 'zip', 'gop', 'tach'], badge: 'Mới' },
      { id: 'qr', name: 'Mã QR', icon: QrCode,
        description: 'Tạo mã QR (văn bản, URL, Wi-Fi) và đọc mã QR từ ảnh', keywords: ['qr', 'barcode', 'wifi'], badge: 'Mới' },
    ],
  },
  {
    id: 'ai',
    title: 'AI & Đa phương tiện',
    description: 'Giọng nói ⇄ văn bản, OCR, tóm tắt/dịch và ước tính chi phí LLM',
    icon: Sparkles,
    general: true,
    items: [
      { id: 'tts', name: 'Chuyển văn bản thành giọng nói (TTS)', icon: Volume2,
        description: 'Đọc văn bản bằng giọng của trình duyệt (miễn phí, có chuẩn hóa số/ngày tiếng Việt); thêm khóa Gemini để dùng giọng AI', keywords: ['tts', 'speech', 'giong noi'], badge: 'TTS', aiEnhanced: true },
      { id: 'stt', name: 'Chuyển giọng nói thành văn bản (STT)', icon: Mic,
        description: 'Ghi âm và nhận diện giọng nói (miễn phí) với lệnh dấu câu, xuất phụ đề; thêm khóa AI để làm sạch, tóm tắt, biên bản', keywords: ['stt', 'micro', 'ghi am'], aiEnhanced: true },
      { id: 'ai-text', name: 'Tóm tắt / Dịch / Giải thích code', icon: Sparkles,
        description: 'Tóm tắt, dịch và phân tích code ngay trên trình duyệt (miễn phí); thêm khóa AI để nâng cao chất lượng', keywords: ['summarize', 'translate', 'explain', 'tom tat', 'dich', 'ai'], badge: 'Mới', aiEnhanced: true },
      { id: 'ai-ocr', name: 'Đọc chữ từ ảnh (OCR)', icon: ScanText,
        description: 'Đọc chữ từ ảnh / ảnh chụp màn hình ngay trên trình duyệt (miễn phí); thêm khóa AI để giữ bảng và sửa lỗi OCR', keywords: ['ocr', 'image', 'anh', 'text'], badge: 'Mới', aiEnhanced: true },
      { id: 'llm-tokens', name: 'Đếm token & chi phí LLM', icon: Coins,
        description: 'Ước tính số token và chi phí cho nhiều model (GPT, Claude, Gemini...)', keywords: ['token', 'tokenizer', 'cost', 'price', 'gpt', 'claude', 'gemini', 'llm', 'prompt', 'chi phi'], badge: 'Mới' },
    ],
  },
  {
    id: 'finance',
    title: 'Tài chính & Văn phòng',
    description: 'Lương Gross/Net, vay & tiết kiệm, chia tiền, báo giá – hóa đơn, VietQR, tiền điện nước, VAT',
    icon: Wallet,
    general: true,
    items: [
      { id: 'salary', name: 'Lương Gross ⇄ Net', icon: Wallet,
        description: 'Tính lương thực nhận sau bảo hiểm và thuế TNCN, hoặc tính ngược từ lương Net', keywords: ['luong', 'gross', 'net', 'thue', 'tncn', 'bao hiem', 'bhxh', 'giam tru'], badge: 'Mới' },
      { id: 'loan-savings', name: 'Vay & Tiết kiệm', icon: Landmark,
        description: 'Lịch trả nợ vay ngân hàng / trả góp và tính lãi kép khi gửi tiết kiệm', keywords: ['vay', 'lai suat', 'tra gop', 'tiet kiem', 'lai kep', 'ngan hang', 'loan', 'mortgage'], badge: 'Mới' },
      { id: 'split-bill', name: 'Chia tiền nhóm', icon: Receipt,
        description: 'Ghi các khoản chi chung, tự tính ai nợ ai và đề xuất chuyển khoản ít lần nhất', keywords: ['chia tien', 'split', 'bill', 'nhom', 'an uong', 'du lich', 'hoa don', 'tra tien'], badge: 'Mới' },
      { id: 'invoice', name: 'Báo giá, hóa đơn & phiếu thu', icon: FileText,
        description: 'Soạn phiếu báo giá, hóa đơn bán hàng, phiếu thu có đọc số tiền bằng chữ, in hoặc lưu PDF', keywords: ['bao gia', 'hoa don', 'phieu thu', 'invoice', 'quotation', 'receipt', 'pdf', 'in an'], badge: 'Mới' },
      { id: 'vietqr', name: 'Mã QR chuyển khoản VietQR', icon: QrCode,
        description: 'Tạo mã QR chuẩn VietQR để nhận tiền: ngân hàng, số tài khoản, số tiền và nội dung', keywords: ['vietqr', 'qr', 'chuyen khoan', 'ngan hang', 'tai khoan', 'napas', 'nhan tien', 'bank'], badge: 'Mới' },
      { id: 'utility-bill', name: 'Tính tiền điện & nước', icon: Zap,
        description: 'Tính hóa đơn điện, nước theo bậc thang (biểu giá chỉnh được) hoặc suy ngược số đã dùng từ số tiền đã trả', keywords: ['tien dien', 'tien nuoc', 'evn', 'bac thang', 'kwh', 'hoa don dien', 'utility', 'electricity', 'water'], badge: 'Mới' },
      { id: 'percent-calc', name: 'Phần trăm, giảm giá & VAT', icon: Percent,
        description: 'Tính phần trăm, giảm giá nhiều lớp, thêm/tách VAT và biên lợi nhuận', keywords: ['phan tram', 'percent', 'giam gia', 'discount', 'vat', 'thue gtgt', 'loi nhuan', 'margin', 'markup', 'sale'], badge: 'Mới' },
      { id: 'unit-currency', name: 'Đổi đơn vị & tiền tệ', icon: ArrowLeftRight,
        description: 'Đổi đơn vị đo (kể cả lượng vàng, sào, mẫu) và quy đổi ngoại tệ', keywords: ['doi don vi', 'tien te', 'ty gia', 'usd', 'vang', 'luong vang', 'sao', 'nhiet do', 'convert'], badge: 'Mới' },
      { id: 'number-words', name: 'Đọc số thành chữ', icon: Speech,
        description: 'Viết số tiền bằng chữ cho hợp đồng, phiếu chi (tiếng Việt / tiếng Anh)', keywords: ['doc so', 'so thanh chu', 'bang chu', 'viet so tien', 'hop dong', 'number to words'], badge: 'Mới' },
    ],
  },
  {
    id: 'life',
    title: 'Đời sống & Tiện ích',
    description: 'Pomodoro, checklist, lịch hẹn, tính ngày & tuổi, sức khỏe, bốc thăm, mật khẩu và kiểm tra giấy tờ',
    icon: Coffee,
    general: true,
    items: [
      { id: 'pomodoro', name: 'Pomodoro & bấm giờ', icon: Timer,
        description: 'Pomodoro, đếm ngược và bấm giờ (có vòng) chạy nền — sang công cụ khác hay đóng tab vẫn đếm, có chuông và thông báo', keywords: ['pomodoro', 'tap trung', 'bam gio', 'hen gio', 'dem nguoc', 'timer', 'stopwatch', 'countdown', 'focus', 'nghi ngoi', 'hoc tap', 'lap'], badge: 'Mới' },
      { id: 'checklist', name: 'Checklist', icon: ListChecks,
        description: 'Danh sách việc cần làm lưu trên trình duyệt, có mẫu dựng sẵn cho du lịch, chuyển nhà, họp, đi chợ Tết', keywords: ['checklist', 'viec can lam', 'todo', 'to do', 'danh sach', 'du lich', 'chuyen nha', 'ghi chu'], badge: 'Mới' },
      { id: 'calendar-event', name: 'Tạo lịch hẹn (.ics)', icon: CalendarPlus,
        description: 'Tạo file lịch để thêm sự kiện vào Google, Apple hoặc Outlook Calendar, có lặp lại và nhắc trước', keywords: ['lich hen', 'ics', 'calendar', 'su kien', 'google calendar', 'outlook', 'nhac lich', 'event'], badge: 'Mới' },
      { id: 'date-calc', name: 'Tuổi, đếm ngược & ngày làm việc', icon: CalendarDays,
        description: 'Tính tuổi, đếm ngược sự kiện, ngày làm việc trừ lễ Việt Nam và đổi âm ↔ dương lịch', keywords: ['tuoi', 'sinh nhat', 'dem nguoc', 'ngay lam viec', 'ngay le', 'am lich', 'duong lich', 'tet', 'age', 'countdown', 'lunar', 'holiday'], badge: 'Mới' },
      { id: 'health-calc', name: 'BMI & nhu cầu calo', icon: HeartPulse,
        description: 'Tính BMI theo chuẩn người châu Á, BMR và lượng calo mỗi ngày (TDEE) — chỉ để tham khảo', keywords: ['bmi', 'calo', 'calorie', 'tdee', 'bmr', 'can nang', 'chieu cao', 'suc khoe', 'giam can', 'beo phi'], badge: 'Mới' },
      { id: 'random-picker', name: 'Bốc thăm & chia nhóm', icon: Shuffle,
        description: 'Bốc thăm ngẫu nhiên, chia nhóm, xáo thứ tự hoặc quay số công bằng', keywords: ['boc tham', 'chia nhom', 'ngau nhien', 'random', 'quay so', 'xao tron', 'shuffle', 'team', 'lucky draw'], badge: 'Mới' },
      { id: 'password-gen', name: 'Tạo mật khẩu & cụm từ bảo mật', icon: LockKeyhole,
        description: 'Sinh mật khẩu ngẫu nhiên hoặc cụm từ dễ nhớ và kiểm tra độ mạnh, chạy ngay trên trình duyệt', keywords: ['mat khau', 'password', 'passphrase', 'random', 'bao mat', 'do manh', 'generator'], badge: 'Mới' },
      { id: 'vn-id-check', name: 'Kiểm tra MST, CCCD & SĐT', icon: ShieldCheck,
        description: 'Kiểm tra cấu trúc mã số thuế, CCCD 12 số và số di động Việt Nam, ngay trên trình duyệt', keywords: ['mst', 'ma so thue', 'cccd', 'can cuoc', 'so dien thoai', 'sdt', 'nha mang', 'validate', 'kiem tra'], badge: 'Mới' },
    ],
  },
];


export const TOOL_CATEGORIES: ToolCategory[] = CATEGORY_SPECS.map(({ items, ...cat }) => ({
  ...cat,
  href: `/${cat.id}`,
  items: items.map((t) => ({ ...t, category: cat.id, href: `/${cat.id}/${t.id}` })),
}));

export const ALL_TOOLS: ToolDef[] = TOOL_CATEGORIES.flatMap((c) => c.items);

const TOOL_BY_ID = new Map(ALL_TOOLS.map((t) => [t.id, t]));
const TOOL_BY_HREF = new Map(ALL_TOOLS.map((t) => [t.href, t]));
const CATEGORY_BY_ID = new Map(TOOL_CATEGORIES.map((c) => [c.id, c]));

export function getTool(id: string): ToolDef | undefined {
  return TOOL_BY_ID.get(id);
}

export function getCategory(id: string): ToolCategory | undefined {
  return CATEGORY_BY_ID.get(id as CategoryId);
}

/** URL của tool theo id, kèm query tùy chọn — dùng thay cho việc viết cứng đường dẫn. */
export function toolHref(id: string, query?: Record<string, string>): string {
  const tool = TOOL_BY_ID.get(id);
  if (!tool) throw new Error(`Không có công cụ "${id}" trong lib/tools.ts`);
  const qs = query ? new URLSearchParams(query).toString() : '';
  return qs ? `${tool.href}?${qs}` : tool.href;
}

function trimSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

/** Tool ứng với đường dẫn hiện tại (bỏ qua dấu `/` ở cuối). */
export function findToolByPath(pathname: string): ToolDef | undefined {
  return TOOL_BY_HREF.get(trimSlash(pathname));
}

/** Nhóm ứng với đường dẫn hiện tại: trang tổng quan `/<nhóm>` hoặc tool `/<nhóm>/<id>`. */
export function findCategoryByPath(pathname: string): ToolCategory | undefined {
  return CATEGORY_BY_ID.get(trimSlash(pathname).split('/')[1] as CategoryId);
}

/**
 * Nhóm cũ của các tool đã chuyển nhóm: URL `/<nhóm cũ>/<id>` vẫn chuyển hướng về URL mới.
 * Khi chuyển một tool sang nhóm khác, thêm nhóm hiện tại của nó vào đây.
 */
const PREVIOUS_CATEGORIES: Record<string, CategoryId[]> = {
  'color-tools': ['media'],
  'cron': ['text'],
  'css-playground': ['dev'],
  'favicon-gen': ['dev'],
  'invoice': ['life'],
  'loan-savings': ['life'],
  'meta-tags': ['dev'],
  'number-words': ['life'],
  'og-image': ['media'],
  'percent-calc': ['life'],
  'readme-builder': ['dev'],
  'salary': ['life'],
  'split-bill': ['life'],
  'tree-gen': ['dev'],
  'unit-currency': ['life'],
  'utility-bill': ['life'],
  'vietqr': ['life'],
};

/**
 * Đường dẫn cũ → đường dẫn mới, để link/bookmark cũ vẫn mở được (next.config.ts chuyển hướng 308):
 * `/<id>` (trước khi gom theo nhóm) và `/<nhóm cũ>/<id>` (tool đã đổi nhóm).
 */
export function legacyToolRedirects(): { source: string; destination: string }[] {
  return ALL_TOOLS.flatMap((t) => [
    { source: `/${t.id}`, destination: t.href },
    ...(PREVIOUS_CATEGORIES[t.id] ?? []).map((c) => ({ source: `/${c}/${t.id}`, destination: t.href })),
  ]);
}
