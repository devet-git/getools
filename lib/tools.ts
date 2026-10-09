import type { ComponentType } from 'react';
import {
  FolderDown, Code2, Package, Link2, SearchCode, FileMinus, GitBranch, GitCommitHorizontal,
  Volume2, Mic, Sparkles, ScanText, FileSpreadsheet,
  GitCompare, Braces, Table, Type, BookOpenText, Regex, Binary, CalendarClock, Timer,
  ImageDown, QrCode, Palette, FileArchive,
  FileJson2, Terminal, GitCompareArrows, ListTree, Database, Container, FileCog, Dices, Calculator,
  Globe, Tags, KeyRound, FileLock, FolderTree, NotebookText, ScrollText, AppWindow, LayoutGrid, BookMarked,
  CalendarDays, Percent, LockKeyhole, HeartPulse, Shuffle, Zap, QrCode as QrCodeIcon, ShieldCheck, FileText, FilePen, CalendarPlus, ListChecks, Timer as TimerIcon, Receipt, Wallet, Landmark, ArrowLeftRight, Speech, Fingerprint, FileBadge, Workflow, Server, ChartNoAxesCombined, Coins, ImagePlus, Boxes,
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
  /** Tool bắt buộc có khóa AI: 'any' = khóa của nhà cung cấp đang chọn; 'gemini' = chỉ Gemini (vd. TTS) */
  requiresAi?: 'any' | 'gemini';
  /** Tool dùng được miễn phí (tính năng của trình duyệt / xử lý cục bộ); thêm khóa AI sẽ mở thêm tính năng nâng cao */
  aiEnhanced?: boolean;
}

export interface ToolCategory {
  title: string;
  /** Nhóm dành cho mọi người dùng (không cần kiến thức lập trình) — hiện khi bật chế độ "Phổ thông" ở trang chủ */
  general?: boolean;
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
      { id: 'repo-analytics', name: 'Phân tích Repo', href: '/repo-analytics', icon: ChartNoAxesCombined,
        description: 'Người đóng góp, biểu đồ nhiệt commit, tốc độ phát hành, issue/PR tồn đọng', keywords: ['analytics', 'contributors', 'commits', 'heatmap', 'insights', 'github', 'thong ke'], badge: 'Mới' },
      { id: 'gitignore', name: '.gitignore & LICENSE', href: '/gitignore', icon: FileMinus,
        description: 'Tạo .gitignore và LICENSE từ mẫu chính thức', keywords: ['gitignore', 'license', 'mit', 'apache'], badge: 'Mới' },
      { id: 'git-cheatsheet', name: 'Cheat sheet lệnh Git', href: '/git-cheatsheet', icon: GitBranch,
        description: 'Tra cứu lệnh Git theo tình huống, có nút sao chép', keywords: ['git', 'command', 'lenh', 'undo', 'rebase'], badge: 'Mới' },
      { id: 'ai-commit', name: 'Commit message & mô tả PR', href: '/ai-commit', icon: GitCommitHorizontal,
        description: 'Phân tích diff để sinh commit message, mô tả PR và cảnh báo rủi ro (miễn phí); thêm khóa AI để viết lại và review', keywords: ['commit', 'pr', 'diff', 'conventional', 'ai'], badge: 'Mới', aiEnhanced: true },
    ],
  },
  {
    title: 'Dành cho Developer',
    items: [
      { id: 'json-to-code', name: 'JSON → Code (TS, Go, Python...)', href: '/json-to-code', icon: FileJson2,
        description: 'Sinh interface/struct/class từ JSON: TypeScript, Go, Python, Kotlin, Rust, Zod, JSON Schema', keywords: ['typescript', 'interface', 'struct', 'pydantic', 'zod', 'schema', 'quicktype', 'type'], badge: 'Mới' },
      { id: 'curl-converter', name: 'cURL → Code', href: '/curl-converter', icon: Terminal,
        description: 'Đổi lệnh cURL sang fetch, axios, Python requests, Go, PHP, HTTPie', keywords: ['curl', 'fetch', 'axios', 'requests', 'http', 'api'], badge: 'Mới' },
      { id: 'json-diff', name: 'So sánh JSON (theo cấu trúc)', href: '/json-diff', icon: GitCompareArrows,
        description: 'So sánh hai JSON theo đường dẫn, bỏ qua thứ tự khóa, xuất JSON Patch', keywords: ['json', 'diff', 'patch', 'compare', 'rfc6902'], badge: 'Mới' },
      { id: 'json-explorer', name: 'JSON Explorer & JSONPath', href: '/json-explorer', icon: ListTree,
        description: 'Duyệt JSON dạng cây, tìm kiếm, truy vấn JSONPath, chép đường dẫn', keywords: ['json', 'jsonpath', 'tree', 'query', 'jq', 'path'], badge: 'Mới' },
      { id: 'sql-tools', name: 'SQL Formatter', href: '/sql-tools', icon: Database,
        description: 'Định dạng, nén và làm đẹp câu lệnh SQL (nhiều dialect)', keywords: ['sql', 'format', 'beautify', 'mysql', 'postgres', 'query'], badge: 'Mới' },
      { id: 'docker-tools', name: 'Docker run ⇄ Compose', href: '/docker-tools', icon: Container,
        description: 'Đổi lệnh docker run sang docker-compose.yml và ngược lại', keywords: ['docker', 'compose', 'container', 'yaml', 'run'], badge: 'Mới' },
      { id: 'env-tools', name: '.env & Config', href: '/env-tools', icon: FileCog,
        description: '.env ⇄ JSON ⇄ YAML ⇄ cờ docker -e ⇄ Kubernetes ConfigMap/Secret', keywords: ['env', 'dotenv', 'kubernetes', 'secret', 'configmap', 'base64'], badge: 'Mới' },
      { id: 'mock-data', name: 'Sinh dữ liệu giả', href: '/mock-data', icon: Dices,
        description: 'Tạo dữ liệu mẫu (tên, email, SĐT VN, địa chỉ...) ra JSON, CSV, SQL', keywords: ['mock', 'fake', 'faker', 'seed', 'lorem', 'sample', 'data'], badge: 'Mới' },
      { id: 'number-tools', name: 'Hệ cơ số, Bit & IEEE-754', href: '/number-tools', icon: Calculator,
        description: 'Đổi cơ số, xem/bật tắt từng bit, phân tích số thực IEEE-754, đổi đơn vị dung lượng', keywords: ['binary', 'hex', 'bit', 'float', 'ieee', 'base', 'bytes', 'kib'], badge: 'Mới' },
      { id: 'url-tools', name: 'URL Parser & Query Builder', href: '/url-tools', icon: Globe,
        description: 'Phân tích URL, sửa query dạng bảng, mã hóa và dựng lại URL', keywords: ['url', 'query', 'params', 'parse', 'encode', 'uri'], badge: 'Mới' },
      { id: 'meta-tags', name: 'Meta Tags & Social Preview', href: '/meta-tags', icon: Tags,
        description: 'Sinh thẻ SEO / Open Graph / Twitter Card và xem trước thẻ chia sẻ', keywords: ['seo', 'og', 'opengraph', 'twitter', 'meta', 'html', 'head'], badge: 'Mới' },
      { id: 'jwt-tools', name: 'JWT Sign & Verify', href: '/jwt-tools', icon: KeyRound,
        description: 'Tạo, ký và xác minh JWT (HS256/384/512, RS256) ngay trên trình duyệt', keywords: ['jwt', 'token', 'hmac', 'rsa', 'sign', 'verify'], badge: 'Mới' },
      { id: 'chmod', name: 'Chmod & Quyền Unix', href: '/chmod', icon: FileLock,
        description: 'Máy tính chmod: rwx ⇄ số bát phân ⇄ lệnh, umask, setuid/setgid/sticky', keywords: ['chmod', 'permission', 'umask', 'unix', 'linux', 'rwx'], badge: 'Mới' },
      { id: 'tree-gen', name: 'Sơ đồ cây thư mục', href: '/tree-gen', icon: FolderTree,
        description: 'Biến danh sách đường dẫn / thụt lề thành cây ├── └── cho README', keywords: ['tree', 'folder', 'directory', 'ascii', 'structure', 'readme'], badge: 'Mới' },
      { id: 'readme-builder', name: 'Tạo README & Badge', href: '/readme-builder', icon: NotebookText,
        description: 'Dựng README từ mẫu, thêm badge shields.io và mục lục', keywords: ['readme', 'badge', 'shields', 'markdown', 'docs'], badge: 'Mới' },
      { id: 'log-viewer', name: 'Log Viewer', href: '/log-viewer', icon: ScrollText,
        description: 'Dán log, lọc theo mức độ / regex, đếm theo thời gian, gập stack trace', keywords: ['log', 'logs', 'stacktrace', 'error', 'filter', 'debug'], badge: 'Mới' },
      { id: 'favicon-gen', name: 'Favicon & App Icon', href: '/favicon-gen', icon: AppWindow,
        description: 'Tạo bộ favicon (ICO, PNG, Apple Touch) và manifest từ một ảnh, tải về ZIP', keywords: ['favicon', 'icon', 'ico', 'apple-touch', 'pwa', 'manifest'], badge: 'Mới' },
      { id: 'css-playground', name: 'CSS Flex / Grid & Tiện ích', href: '/css-playground', icon: LayoutGrid,
        description: 'Sân chơi Flexbox/Grid sinh CSS, clamp() fluid, px ⇄ rem, box-shadow', keywords: ['css', 'flexbox', 'grid', 'clamp', 'rem', 'shadow', 'layout'], badge: 'Mới' },
      { id: 'dev-reference', name: 'Tra cứu nhanh cho Dev', href: '/dev-reference', icon: BookMarked,
        description: 'HTTP status, header, cổng mạng thông dụng, MIME, bảng ASCII, HTML entities', keywords: ['http', 'status', 'port', 'mime', 'ascii', 'entities', 'reference', 'header'], badge: 'Mới' },
    ],
  },
  {
    title: 'Bảo mật & DevOps',
    items: [
      { id: 'totp', name: 'TOTP / Mã 2FA', href: '/totp', icon: Fingerprint,
        description: 'Sinh mã 6 số từ secret (RFC 6238), tạo mã QR provisioning để thử và debug 2FA', keywords: ['totp', 'otp', '2fa', 'authenticator', 'hotp', 'secret', 'base32'], badge: 'Mới' },
      { id: 'x509', name: 'Chứng chỉ X.509 / PEM', href: '/x509', icon: FileBadge,
        description: 'Đọc chủ thể, hạn dùng, SAN, vân tay và chuỗi chứng chỉ từ PEM', keywords: ['certificate', 'ssl', 'tls', 'pem', 'x509', 'csr', 'chung chi', 'fingerprint'], badge: 'Mới' },
      { id: 'github-actions', name: 'GitHub Actions Builder', href: '/github-actions', icon: Workflow,
        description: 'Dựng file workflow CI/CD: ngôn ngữ, cache, matrix, deploy; kiểm tra lỗi cơ bản', keywords: ['actions', 'workflow', 'ci', 'cd', 'yaml', 'github', 'pipeline'], badge: 'Mới' },
      { id: 'dockerfile', name: 'Dockerfile Generator & Linter', href: '/dockerfile', icon: Boxes,
        description: 'Sinh Dockerfile multi-stage theo ngôn ngữ và cảnh báo thực hành xấu', keywords: ['docker', 'dockerfile', 'lint', 'multistage', 'container', 'hadolint'], badge: 'Mới' },
      { id: 'nginx-config', name: 'Nginx Config Generator', href: '/nginx-config', icon: Server,
        description: 'Reverse proxy, SSL, gzip, SPA fallback, rate limit, header bảo mật', keywords: ['nginx', 'proxy', 'ssl', 'https', 'gzip', 'spa', 'rate limit', 'server'], badge: 'Mới' },
    ],
  },
  {
    title: 'AI & Đa phương tiện',
    general: true,
    items: [
      { id: 'tts', name: 'Chuyển văn bản thành giọng nói (TTS)', href: '/tts', icon: Volume2,
        description: 'Đọc văn bản bằng giọng của trình duyệt (miễn phí, có chuẩn hóa số/ngày tiếng Việt); thêm khóa Gemini để dùng giọng AI', keywords: ['tts', 'speech', 'giong noi'], badge: 'TTS', aiEnhanced: true },
      { id: 'stt', name: 'Chuyển giọng nói thành văn bản (STT)', href: '/stt', icon: Mic,
        description: 'Ghi âm và nhận diện giọng nói (miễn phí) với lệnh dấu câu, xuất phụ đề; thêm khóa AI để làm sạch, tóm tắt, biên bản', keywords: ['stt', 'micro', 'ghi am'], aiEnhanced: true },
      { id: 'llm-tokens', name: 'Đếm token & chi phí LLM', href: '/llm-tokens', icon: Coins,
        description: 'Ước tính số token và chi phí cho nhiều model (GPT, Claude, Gemini...)', keywords: ['token', 'tokenizer', 'cost', 'price', 'gpt', 'claude', 'gemini', 'llm', 'prompt', 'chi phi'], badge: 'Mới' },
      { id: 'ai-text', name: 'Tóm tắt / Dịch / Giải thích code', href: '/ai-text', icon: Sparkles,
        description: 'Tóm tắt, dịch và phân tích code ngay trên trình duyệt (miễn phí); thêm khóa AI để nâng cao chất lượng', keywords: ['summarize', 'translate', 'explain', 'tom tat', 'dich', 'ai'], badge: 'Mới', aiEnhanced: true },
      { id: 'ai-ocr', name: 'Đọc chữ từ ảnh (OCR)', href: '/ai-ocr', icon: ScanText,
        description: 'Đọc chữ từ ảnh / ảnh chụp màn hình ngay trên trình duyệt (miễn phí); thêm khóa AI để giữ bảng và sửa lỗi OCR', keywords: ['ocr', 'image', 'anh', 'text'], badge: 'Mới', aiEnhanced: true },
    ],
  },
  {
    title: 'Đời sống & Văn phòng',
    general: true,
    items: [
      { id: 'pomodoro', name: 'Pomodoro & bấm giờ', href: '/pomodoro', icon: TimerIcon,
        description: 'Làm việc tập trung theo chu kỳ 25/5 phút, có chuông báo, thông báo và đếm số phiên trong ngày', keywords: ['pomodoro', 'tap trung', 'bam gio', 'hen gio', 'timer', 'focus', 'nghi ngoi', 'hoc tap'], badge: 'Mới' },
      { id: 'checklist', name: 'Checklist', href: '/checklist', icon: ListChecks,
        description: 'Danh sách việc cần làm lưu trên trình duyệt, có mẫu dựng sẵn cho du lịch, chuyển nhà, họp, đi chợ Tết', keywords: ['checklist', 'viec can lam', 'todo', 'to do', 'danh sach', 'du lich', 'chuyen nha', 'ghi chu'], badge: 'Mới' },
      { id: 'calendar-event', name: 'Tạo lịch hẹn (.ics)', href: '/calendar-event', icon: CalendarPlus,
        description: 'Tạo file lịch để thêm sự kiện vào Google, Apple hoặc Outlook Calendar, có lặp lại và nhắc trước', keywords: ['lich hen', 'ics', 'calendar', 'su kien', 'google calendar', 'outlook', 'nhac lich', 'event'], badge: 'Mới' },
      { id: 'date-calc', name: 'Tuổi, đếm ngược & ngày làm việc', href: '/date-calc', icon: CalendarDays,
        description: 'Tính tuổi, đếm ngược sự kiện, ngày làm việc trừ lễ Việt Nam và đổi âm ↔ dương lịch', keywords: ['tuoi', 'sinh nhat', 'dem nguoc', 'ngay lam viec', 'ngay le', 'am lich', 'duong lich', 'tet', 'age', 'countdown', 'lunar', 'holiday'], badge: 'Mới' },
      { id: 'percent-calc', name: 'Phần trăm, giảm giá & VAT', href: '/percent-calc', icon: Percent,
        description: 'Tính phần trăm, giảm giá nhiều lớp, thêm/tách VAT và biên lợi nhuận', keywords: ['phan tram', 'percent', 'giam gia', 'discount', 'vat', 'thue gtgt', 'loi nhuan', 'margin', 'markup', 'sale'], badge: 'Mới' },
      { id: 'health-calc', name: 'BMI & nhu cầu calo', href: '/health-calc', icon: HeartPulse,
        description: 'Tính BMI theo chuẩn người châu Á, BMR và lượng calo mỗi ngày (TDEE) — chỉ để tham khảo', keywords: ['bmi', 'calo', 'calorie', 'tdee', 'bmr', 'can nang', 'chieu cao', 'suc khoe', 'giam can', 'beo phi'], badge: 'Mới' },
      { id: 'random-picker', name: 'Bốc thăm & chia nhóm', href: '/random-picker', icon: Shuffle,
        description: 'Bốc thăm ngẫu nhiên, chia nhóm, xáo thứ tự hoặc quay số công bằng', keywords: ['boc tham', 'chia nhom', 'ngau nhien', 'random', 'quay so', 'xao tron', 'shuffle', 'team', 'lucky draw'], badge: 'Mới' },
      { id: 'utility-bill', name: 'Tính tiền điện & nước', href: '/utility-bill', icon: Zap,
        description: 'Tính hóa đơn điện, nước theo bậc thang (biểu giá chỉnh được) hoặc suy ngược số đã dùng từ số tiền đã trả', keywords: ['tien dien', 'tien nuoc', 'evn', 'bac thang', 'kwh', 'hoa don dien', 'utility', 'electricity', 'water'], badge: 'Mới' },
      { id: 'vietqr', name: 'Mã QR chuyển khoản VietQR', href: '/vietqr', icon: QrCodeIcon,
        description: 'Tạo mã QR chuẩn VietQR để nhận tiền: ngân hàng, số tài khoản, số tiền và nội dung', keywords: ['vietqr', 'qr', 'chuyen khoan', 'ngan hang', 'tai khoan', 'napas', 'nhan tien', 'bank'], badge: 'Mới' },
      { id: 'vn-id-check', name: 'Kiểm tra MST, CCCD & SĐT', href: '/vn-id-check', icon: ShieldCheck,
        description: 'Kiểm tra cấu trúc mã số thuế, CCCD 12 số và số di động Việt Nam, ngay trên trình duyệt', keywords: ['mst', 'ma so thue', 'cccd', 'can cuoc', 'so dien thoai', 'sdt', 'nha mang', 'validate', 'kiem tra'], badge: 'Mới' },
      { id: 'invoice', name: 'Báo giá, hóa đơn & phiếu thu', href: '/invoice', icon: FileText,
        description: 'Soạn phiếu báo giá, hóa đơn bán hàng, phiếu thu có đọc số tiền bằng chữ, in hoặc lưu PDF', keywords: ['bao gia', 'hoa don', 'phieu thu', 'invoice', 'quotation', 'receipt', 'pdf', 'in an'], badge: 'Mới' },
      { id: 'password-gen', name: 'Tạo mật khẩu & cụm từ bảo mật', href: '/password-gen', icon: LockKeyhole,
        description: 'Sinh mật khẩu ngẫu nhiên hoặc cụm từ dễ nhớ và kiểm tra độ mạnh, chạy ngay trên trình duyệt', keywords: ['mat khau', 'password', 'passphrase', 'random', 'bao mat', 'do manh', 'generator'], badge: 'Mới' },
      { id: 'split-bill', name: 'Chia tiền nhóm', href: '/split-bill', icon: Receipt,
        description: 'Ghi các khoản chi chung, tự tính ai nợ ai và đề xuất chuyển khoản ít lần nhất', keywords: ['chia tien', 'split', 'bill', 'nhom', 'an uong', 'du lich', 'hoa don', 'tra tien'], badge: 'Mới' },
      { id: 'salary', name: 'Lương Gross ⇄ Net', href: '/salary', icon: Wallet,
        description: 'Tính lương thực nhận sau bảo hiểm và thuế TNCN, hoặc tính ngược từ lương Net', keywords: ['luong', 'gross', 'net', 'thue', 'tncn', 'bao hiem', 'bhxh', 'giam tru'], badge: 'Mới' },
      { id: 'loan-savings', name: 'Vay & Tiết kiệm', href: '/loan-savings', icon: Landmark,
        description: 'Lịch trả nợ vay ngân hàng / trả góp và tính lãi kép khi gửi tiết kiệm', keywords: ['vay', 'lai suat', 'tra gop', 'tiet kiem', 'lai kep', 'ngan hang', 'loan', 'mortgage'], badge: 'Mới' },
      { id: 'unit-currency', name: 'Đổi đơn vị & tiền tệ', href: '/unit-currency', icon: ArrowLeftRight,
        description: 'Đổi đơn vị đo (kể cả lượng vàng, sào, mẫu) và quy đổi ngoại tệ', keywords: ['doi don vi', 'tien te', 'ty gia', 'usd', 'vang', 'luong vang', 'sao', 'nhiet do', 'convert'], badge: 'Mới' },
      { id: 'number-words', name: 'Đọc số thành chữ', href: '/number-words', icon: Speech,
        description: 'Viết số tiền bằng chữ cho hợp đồng, phiếu chi (tiếng Việt / tiếng Anh)', keywords: ['doc so', 'so thanh chu', 'bang chu', 'viet so tien', 'hop dong', 'number to words'], badge: 'Mới' },
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
    general: true,
    items: [
      { id: 'image-tools', name: 'Nén / Đổi cỡ / Đổi định dạng ảnh', href: '/image-tools', icon: ImageDown,
        description: 'PNG, JPG, WebP: nén, đổi kích thước và chuyển định dạng', keywords: ['image', 'compress', 'resize', 'webp', 'png', 'jpg', 'anh'], badge: 'Mới' },
      { id: 'qr', name: 'Mã QR', href: '/qr', icon: QrCode,
        description: 'Tạo mã QR (văn bản, URL, Wi-Fi) và đọc mã QR từ ảnh', keywords: ['qr', 'barcode', 'wifi'], badge: 'Mới' },
      { id: 'og-image', name: 'Tạo ảnh Open Graph', href: '/og-image', icon: ImagePlus,
        description: 'Tạo ảnh social card 1200×630 từ mẫu, xuất PNG/JPEG cho meta tag', keywords: ['og', 'opengraph', 'social', 'card', 'thumbnail', 'twitter', 'share', 'banner'], badge: 'Mới' },
      { id: 'pdf-edit', name: 'Biên tập PDF', href: '/pdf-edit', icon: FilePen,
        description: 'Đánh số trang, thêm watermark, xoay / xóa / sắp xếp trang, ghép ảnh thành PDF và chuyển PDF thành ảnh ngay trên trình duyệt', keywords: ['pdf to image', 'pdf sang anh', 'chuyen pdf thanh anh', 'pdf', 'danh so trang', 'watermark', 'xoay', 'xoa trang', 'sap xep', 'anh sang pdf', 'image to pdf', 'page number'], badge: 'Mới' },
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
