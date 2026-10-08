/**
 * Tạo README & Badge: logic thuần (không React).
 * - Badge shields.io (escape đúng quy tắc)
 * - Slug tiêu đề kiểu GitHub + mục lục tự động
 * - Mẫu nội dung từng mục theo loại dự án và ngôn ngữ
 */

export type Lang = 'vi' | 'en';
export type BadgeStyle = 'flat' | 'flat-square' | 'for-the-badge' | 'plastic';
export const BADGE_STYLES: BadgeStyle[] = ['flat', 'flat-square', 'for-the-badge', 'plastic'];

/* ------------------------------------------------------------------ */
/* Shields.io                                                           */
/* ------------------------------------------------------------------ */

/** Escape một đoạn nhãn/thông điệp trong đường dẫn /badge/<label>-<message>-<color>. */
export function escapeShields(s: string): string {
  const x = s.replace(/-/g, '--').replace(/_/g, '__').replace(/ /g, '_');
  return encodeURIComponent(x).replace(/%2D/gi, '-').replace(/%5F/gi, '_');
}

/** Mã màu: tên (brightgreen, blue...) hoặc hex (có/không #). Trả về '' nếu không hợp lệ. */
export function normalizeColor(c: string): string {
  const v = c.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(v)) return v.toLowerCase();
  if (/^[a-zA-Z]{3,20}$/.test(v)) return v.toLowerCase();
  return '';
}

export interface BadgeExtras {
  style?: BadgeStyle;
  logo?: string;
  logoColor?: string;
  label?: string;
}

function query(extras: BadgeExtras): string {
  const p: string[] = [];
  if (extras.label) p.push('label=' + encodeURIComponent(extras.label));
  if (extras.style && extras.style !== 'flat') p.push('style=' + extras.style);
  if (extras.logo) p.push('logo=' + encodeURIComponent(extras.logo.trim()));
  if (extras.logo && extras.logoColor) {
    const lc = normalizeColor(extras.logoColor);
    if (lc) p.push('logoColor=' + encodeURIComponent(lc));
  }
  return p.length ? '?' + p.join('&') : '';
}

const SHIELDS = 'https://img.shields.io';

/** Badge tĩnh: label, message, color (+ style/logo). Label rỗng được phép (chỉ message). */
export function staticBadgeUrl(label: string, message: string, color: string, extras: BadgeExtras = {}): string {
  const col = normalizeColor(color) || 'blue';
  const l = label.trim();
  const m = message.trim() || ' ';
  const path = l ? `${escapeShields(l)}-${escapeShields(m)}-${col}` : `${escapeShields(m)}-${col}`;
  return `${SHIELDS}/badge/${path}${query(extras)}`;
}

/** Mỗi phần của đường dẫn được encode riêng, giữ nguyên dấu / và @ (npm scope). */
function seg(s: string): string {
  return s
    .trim()
    .split('/')
    .map((p) => encodeURIComponent(p).replace(/%40/g, '@'))
    .join('/');
}

export type BadgeNeed = 'repo' | 'npm' | 'pypi' | 'crate' | 'docker' | 'none';

export interface BadgeCtx {
  repo: string; // owner/repo
  npm: string;
  pypi: string;
  crate: string;
  docker: string; // user/image
  workflow: string; // ci.yml
  branch: string;
}

export interface BadgeDef {
  id: string;
  group: string;
  title: string;
  need: BadgeNeed;
  path: (c: BadgeCtx) => string;
  link: (c: BadgeCtx) => string;
}

const gh = (c: BadgeCtx) => `https://github.com/${seg(c.repo)}`;

export const BADGE_DEFS: BadgeDef[] = [
  { id: 'gh-stars', group: 'GitHub', title: 'Stars', need: 'repo', path: (c) => `github/stars/${seg(c.repo)}`, link: (c) => gh(c) + '/stargazers' },
  { id: 'gh-forks', group: 'GitHub', title: 'Forks', need: 'repo', path: (c) => `github/forks/${seg(c.repo)}`, link: (c) => gh(c) + '/network/members' },
  { id: 'gh-issues', group: 'GitHub', title: 'Issues', need: 'repo', path: (c) => `github/issues/${seg(c.repo)}`, link: (c) => gh(c) + '/issues' },
  { id: 'gh-license', group: 'GitHub', title: 'License', need: 'repo', path: (c) => `github/license/${seg(c.repo)}`, link: (c) => gh(c) + '/blob/HEAD/LICENSE' },
  { id: 'gh-commit', group: 'GitHub', title: 'Last commit', need: 'repo', path: (c) => `github/last-commit/${seg(c.repo)}`, link: (c) => gh(c) + '/commits' },
  { id: 'gh-release', group: 'GitHub', title: 'Release', need: 'repo', path: (c) => `github/v/release/${seg(c.repo)}`, link: (c) => gh(c) + '/releases' },
  {
    id: 'gh-workflow',
    group: 'GitHub',
    title: 'Workflow status',
    need: 'repo',
    path: (c) => `github/actions/workflow/status/${seg(c.repo)}/${seg(c.workflow || 'ci.yml')}${c.branch ? '?branch=' + encodeURIComponent(c.branch) : ''}`,
    link: (c) => gh(c) + '/actions',
  },
  { id: 'gh-lang', group: 'GitHub', title: 'Top language', need: 'repo', path: (c) => `github/languages/top/${seg(c.repo)}`, link: (c) => gh(c) },
  { id: 'gh-size', group: 'GitHub', title: 'Code size', need: 'repo', path: (c) => `github/languages/code-size/${seg(c.repo)}`, link: (c) => gh(c) },
  { id: 'npm-v', group: 'npm', title: 'npm version', need: 'npm', path: (c) => `npm/v/${seg(c.npm)}`, link: (c) => `https://www.npmjs.com/package/${seg(c.npm)}` },
  { id: 'npm-dm', group: 'npm', title: 'npm downloads', need: 'npm', path: (c) => `npm/dm/${seg(c.npm)}`, link: (c) => `https://www.npmjs.com/package/${seg(c.npm)}` },
  { id: 'pypi-v', group: 'PyPI', title: 'PyPI version', need: 'pypi', path: (c) => `pypi/v/${seg(c.pypi)}`, link: (c) => `https://pypi.org/project/${seg(c.pypi)}/` },
  { id: 'pypi-py', group: 'PyPI', title: 'Python versions', need: 'pypi', path: (c) => `pypi/pyversions/${seg(c.pypi)}`, link: (c) => `https://pypi.org/project/${seg(c.pypi)}/` },
  { id: 'crates-v', group: 'crates.io', title: 'crates.io', need: 'crate', path: (c) => `crates/v/${seg(c.crate)}`, link: (c) => `https://crates.io/crates/${seg(c.crate)}` },
  { id: 'docker-pulls', group: 'Docker', title: 'Docker pulls', need: 'docker', path: (c) => `docker/pulls/${seg(c.docker)}`, link: (c) => `https://hub.docker.com/r/${seg(c.docker)}` },
];

export function badgeNeedMet(need: BadgeNeed, c: BadgeCtx): boolean {
  switch (need) {
    case 'repo':
      return /^[\w.-]+\/[\w.-]+$/.test(c.repo.trim());
    case 'npm':
      return c.npm.trim() !== '';
    case 'pypi':
      return c.pypi.trim() !== '';
    case 'crate':
      return c.crate.trim() !== '';
    case 'docker':
      return /^[\w.-]+\/[\w.-]+$/.test(c.docker.trim());
    default:
      return true;
  }
}

export function dynamicBadgeUrl(def: BadgeDef, c: BadgeCtx, style: BadgeStyle): string {
  const p = def.path(c);
  const sep = p.includes('?') ? '&' : '?';
  return `${SHIELDS}/${p}${style !== 'flat' ? sep + 'style=' + style : ''}`;
}

export interface Badge {
  key: string;
  alt: string;
  url: string;
  link?: string;
}

function mdAlt(s: string): string {
  return s.replace(/[[\]\\]/g, '\\$&');
}

export function badgeMarkdown(b: Badge): string {
  const img = `![${mdAlt(b.alt)}](${b.url})`;
  return b.link ? `[${img}](${b.link})` : img;
}

function htmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function badgeHtml(b: Badge): string {
  const img = `<img src="${htmlAttr(b.url)}" alt="${htmlAttr(b.alt)}">`;
  return b.link ? `<a href="${htmlAttr(b.link)}">${img}</a>` : img;
}

/** Màu/logo thương hiệu cho chip công nghệ. */
const TECH: Record<string, [string, string]> = {
  typescript: ['3178C6', 'typescript'],
  javascript: ['F7DF1E', 'javascript'],
  react: ['20232A', 'react'],
  'next.js': ['000000', 'nextdotjs'],
  nextjs: ['000000', 'nextdotjs'],
  'node.js': ['339933', 'nodedotjs'],
  nodejs: ['339933', 'nodedotjs'],
  tailwindcss: ['06B6D4', 'tailwindcss'],
  'tailwind css': ['06B6D4', 'tailwindcss'],
  python: ['3776AB', 'python'],
  django: ['092E20', 'django'],
  flask: ['000000', 'flask'],
  fastapi: ['009688', 'fastapi'],
  go: ['00ADD8', 'go'],
  rust: ['000000', 'rust'],
  java: ['ED8B00', 'openjdk'],
  'spring boot': ['6DB33F', 'springboot'],
  docker: ['2496ED', 'docker'],
  postgresql: ['4169E1', 'postgresql'],
  mysql: ['4479A1', 'mysql'],
  mongodb: ['47A248', 'mongodb'],
  redis: ['DC382D', 'redis'],
  pandas: ['150458', 'pandas'],
  numpy: ['013243', 'numpy'],
  jupyter: ['F37626', 'jupyter'],
  flutter: ['02569B', 'flutter'],
  'react native': ['20232A', 'react'],
  expo: ['000020', 'expo'],
  kotlin: ['7F52FF', 'kotlin'],
  swift: ['F05138', 'swift'],
};

export function techBadge(name: string): string {
  const n = name.trim();
  const known = TECH[n.toLowerCase()];
  const color = known ? known[0] : '555555';
  const logo = known ? `&logo=${known[1]}&logoColor=white` : '';
  return `![${mdAlt(n)}](${SHIELDS}/badge/${escapeShields(n)}-${color}?style=flat-square${logo})`;
}

/* ------------------------------------------------------------------ */
/* Slug GitHub, mục lục                                                 */
/* ------------------------------------------------------------------ */

/** Chuyển tiêu đề Markdown thành văn bản hiển thị (bỏ ảnh, link, nhấn mạnh, mã, HTML). */
export function plainHeading(raw: string): string {
  let s = raw.trim().replace(/\s+#+\s*$/, '');
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/`+([^`]*)`+/g, '$1');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/\*+/g, '');
  s = s.replace(/(^|\s)_+([^_\s][^_]*?)_+(?=\s|$)/g, '$1$2');
  return s.trim();
}

/** Slug theo GitHub: chữ thường, giữ chữ cái (kể cả có dấu) & số, bỏ dấu câu, khoảng trắng → "-". */
export function githubSlug(heading: string): string {
  return plainHeading(heading)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

/** Trả về hàm cấp slug có xử lý trùng lặp: x, x-1, x-2... */
export function makeSlugger(): (heading: string) => string {
  const used = new Set<string>();
  const counts = new Map<string, number>();
  return (heading: string) => {
    const base = githubSlug(heading);
    let slug = base;
    if (used.has(slug)) {
      let n = counts.get(base) ?? 0;
      do {
        n += 1;
        slug = `${base}-${n}`;
      } while (used.has(slug));
      counts.set(base, n);
    }
    used.add(slug);
    return slug;
  };
}

export interface HeadingInfo {
  level: number;
  text: string;
  slug: string;
}

export function extractHeadings(md: string): HeadingInfo[] {
  const out: HeadingInfo[] = [];
  const slug = makeSlugger();
  let fence: { ch: string; len: number } | null = null;
  for (const line of md.split('\n')) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = { ch: f[1][0], len: f[1].length };
      else if (f[1][0] === fence.ch && f[1].length >= fence.len && /^ {0,3}[`~]+\s*$/.test(line)) fence = null;
      continue;
    }
    if (fence) continue;
    const m = /^ {0,3}(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const text = plainHeading(m[2]);
    if (!text) continue;
    out.push({ level: m[1].length, text, slug: slug(m[2]) });
  }
  return out;
}

export function generateToc(md: string, minLevel = 2, maxLevel = 3, skipTexts: string[] = []): string {
  const heads = extractHeadings(md).filter(
    (h) => h.level >= minLevel && h.level <= maxLevel && !skipTexts.includes(h.text)
  );
  return heads.map((h) => `${'  '.repeat(h.level - minLevel)}- [${h.text.replace(/[[\]]/g, '\\$&')}](#${h.slug})`).join('\n');
}

/* ------------------------------------------------------------------ */
/* Mẫu README                                                           */
/* ------------------------------------------------------------------ */

export type SectionId =
  | 'title'
  | 'badges'
  | 'demo'
  | 'toc'
  | 'features'
  | 'tech'
  | 'requirements'
  | 'install'
  | 'usage'
  | 'config'
  | 'structure'
  | 'scripts'
  | 'testing'
  | 'api'
  | 'roadmap'
  | 'contributing'
  | 'license'
  | 'author'
  | 'thanks';

export const SECTION_ORDER: SectionId[] = [
  'title', 'badges', 'demo', 'toc', 'features', 'tech', 'requirements', 'install', 'usage', 'config',
  'structure', 'scripts', 'testing', 'api', 'roadmap', 'contributing', 'license', 'author', 'thanks',
];

export const SECTION_LABEL: Record<SectionId, string> = {
  title: 'Tiêu đề + mô tả ngắn',
  badges: 'Badges',
  demo: 'Demo / ảnh chụp màn hình',
  toc: 'Mục lục tự động',
  features: 'Tính năng',
  tech: 'Công nghệ',
  requirements: 'Yêu cầu',
  install: 'Cài đặt',
  usage: 'Sử dụng',
  config: 'Cấu hình / biến môi trường',
  structure: 'Cấu trúc thư mục',
  scripts: 'Scripts',
  testing: 'Kiểm thử',
  api: 'API',
  roadmap: 'Roadmap',
  contributing: 'Đóng góp',
  license: 'Giấy phép',
  author: 'Tác giả / Liên hệ',
  thanks: 'Cảm ơn',
};

const HEADINGS: Record<SectionId, [string, string]> = {
  title: ['', ''],
  badges: ['', ''],
  demo: ['Demo & ảnh chụp màn hình', 'Demo & Screenshots'],
  toc: ['Mục lục', 'Table of Contents'],
  features: ['Tính năng', 'Features'],
  tech: ['Công nghệ sử dụng', 'Tech Stack'],
  requirements: ['Yêu cầu', 'Requirements'],
  install: ['Cài đặt', 'Installation'],
  usage: ['Sử dụng', 'Usage'],
  config: ['Cấu hình', 'Configuration'],
  structure: ['Cấu trúc thư mục', 'Project Structure'],
  scripts: ['Scripts', 'Scripts'],
  testing: ['Kiểm thử', 'Testing'],
  api: ['API', 'API Reference'],
  roadmap: ['Lộ trình', 'Roadmap'],
  contributing: ['Đóng góp', 'Contributing'],
  license: ['Giấy phép', 'License'],
  author: ['Tác giả & liên hệ', 'Author & Contact'],
  thanks: ['Lời cảm ơn', 'Acknowledgements'],
};

export function sectionHeading(id: SectionId, lang: Lang): string {
  return HEADINGS[id][lang === 'vi' ? 0 : 1];
}

export type ProjectType = 'node' | 'python' | 'go' | 'rust' | 'java' | 'docker' | 'cli' | 'library' | 'mobile' | 'data';

export const PROJECT_TYPES: { id: ProjectType; label: string }[] = [
  { id: 'node', label: 'Node / React / Next.js' },
  { id: 'python', label: 'Python' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'java', label: 'Java / Spring' },
  { id: 'docker', label: 'Docker' },
  { id: 'cli', label: 'Công cụ dòng lệnh (CLI)' },
  { id: 'library', label: 'Thư viện (Library)' },
  { id: 'mobile', label: 'Ứng dụng di động' },
  { id: 'data', label: 'Khoa học dữ liệu' },
];

export interface ProjectCtx {
  name: string;
  repo: string; // owner/repo
  description: string;
  stack: string[];
  license: string;
  type: ProjectType;
  lang: Lang;
}

interface TypeInfo {
  stack: string[];
  requires: [string[], string[]];
  install: string;
  lang: string;
  usage: string;
  scripts: [string, string, string][];
  test: string;
  env: [string, string, string, string][];
  api: string;
  defaultOn: SectionId[];
}

const BASE_ON: SectionId[] = [
  'title', 'badges', 'toc', 'features', 'tech', 'requirements', 'install', 'usage', 'testing', 'contributing', 'license', 'author',
];

const TYPES: Record<ProjectType, TypeInfo> = {
  node: {
    stack: ['Node.js', 'TypeScript', 'React'],
    requires: [['Node.js 18 trở lên', 'npm, pnpm hoặc yarn'], ['Node.js 18 or newer', 'npm, pnpm or yarn']],
    lang: 'bash',
    install: 'git clone https://github.com/{{repo}}.git\ncd {{slug}}\nnpm install',
    usage: 'npm run dev',
    scripts: [
      ['npm run dev', 'Chạy môi trường phát triển', 'Start the development server'],
      ['npm run build', 'Build bản production', 'Create a production build'],
      ['npm start', 'Chạy bản production', 'Run the production build'],
      ['npm run lint', 'Kiểm tra mã nguồn', 'Lint the source code'],
      ['npm test', 'Chạy kiểm thử', 'Run the tests'],
    ],
    test: 'npm test',
    env: [
      ['PORT', '3000', 'Cổng chạy ứng dụng', 'Port the app listens on'],
      ['DATABASE_URL', 'postgres://user:pass@localhost:5432/db', 'Chuỗi kết nối cơ sở dữ liệu', 'Database connection string'],
      ['API_KEY', 'your-api-key', 'Khóa truy cập dịch vụ ngoài', 'Key for the external service'],
    ],
    api: '',
    defaultOn: [...BASE_ON, 'config', 'scripts'],
  },
  python: {
    stack: ['Python'],
    requires: [['Python 3.10 trở lên', 'pip'], ['Python 3.10 or newer', 'pip']],
    lang: 'bash',
    install:
      'git clone https://github.com/{{repo}}.git\ncd {{slug}}\npython -m venv .venv\nsource .venv/bin/activate  # Windows: .venv\\Scripts\\activate\npip install -r requirements.txt',
    usage: 'python main.py',
    scripts: [
      ['python main.py', 'Chạy ứng dụng', 'Run the app'],
      ['pytest', 'Chạy kiểm thử', 'Run the tests'],
      ['ruff check .', 'Kiểm tra mã nguồn', 'Lint the source code'],
    ],
    test: 'pytest',
    env: [
      ['DEBUG', 'false', 'Bật chế độ gỡ lỗi', 'Enable debug mode'],
      ['DATABASE_URL', 'sqlite:///app.db', 'Chuỗi kết nối cơ sở dữ liệu', 'Database connection string'],
    ],
    api: '',
    defaultOn: [...BASE_ON, 'config'],
  },
  go: {
    stack: ['Go'],
    requires: [['Go 1.22 trở lên'], ['Go 1.22 or newer']],
    lang: 'bash',
    install: 'git clone https://github.com/{{repo}}.git\ncd {{slug}}\ngo mod download',
    usage: 'go run ./cmd/{{slug}}',
    scripts: [
      ['go run ./cmd/{{slug}}', 'Chạy ứng dụng', 'Run the app'],
      ['go build -o bin/{{slug}} ./cmd/{{slug}}', 'Biên dịch', 'Build the binary'],
      ['go test ./...', 'Chạy kiểm thử', 'Run the tests'],
      ['go vet ./...', 'Kiểm tra tĩnh', 'Static analysis'],
    ],
    test: 'go test ./... -race -cover',
    env: [['PORT', '8080', 'Cổng lắng nghe', 'Listening port']],
    api: '',
    defaultOn: BASE_ON,
  },
  rust: {
    stack: ['Rust'],
    requires: [['Rust (stable) và Cargo'], ['Rust (stable) and Cargo']],
    lang: 'bash',
    install: 'git clone https://github.com/{{repo}}.git\ncd {{slug}}\ncargo build --release',
    usage: 'cargo run --release',
    scripts: [
      ['cargo run', 'Chạy ứng dụng', 'Run the app'],
      ['cargo build --release', 'Biên dịch bản tối ưu', 'Optimised build'],
      ['cargo test', 'Chạy kiểm thử', 'Run the tests'],
      ['cargo clippy', 'Kiểm tra mã nguồn', 'Lint the source code'],
    ],
    test: 'cargo test',
    env: [['RUST_LOG', 'info', 'Mức độ ghi log', 'Log level']],
    api: '',
    defaultOn: BASE_ON,
  },
  java: {
    stack: ['Java', 'Spring Boot'],
    requires: [['JDK 21 trở lên', 'Maven 3.9+ (hoặc dùng ./mvnw)'], ['JDK 21 or newer', 'Maven 3.9+ (or use ./mvnw)']],
    lang: 'bash',
    install: 'git clone https://github.com/{{repo}}.git\ncd {{slug}}\n./mvnw clean install',
    usage: './mvnw spring-boot:run',
    scripts: [
      ['./mvnw spring-boot:run', 'Chạy ứng dụng', 'Run the app'],
      ['./mvnw clean package', 'Đóng gói file JAR', 'Package the JAR'],
      ['./mvnw test', 'Chạy kiểm thử', 'Run the tests'],
    ],
    test: './mvnw test',
    env: [
      ['SPRING_DATASOURCE_URL', 'jdbc:postgresql://localhost:5432/db', 'Chuỗi kết nối JDBC', 'JDBC connection string'],
      ['SPRING_DATASOURCE_USERNAME', 'user', 'Tài khoản cơ sở dữ liệu', 'Database user'],
      ['SERVER_PORT', '8080', 'Cổng ứng dụng', 'Application port'],
    ],
    api: '',
    defaultOn: [...BASE_ON, 'config', 'api'],
  },
  docker: {
    stack: ['Docker'],
    requires: [['Docker 24 trở lên', 'Docker Compose v2'], ['Docker 24 or newer', 'Docker Compose v2']],
    lang: 'bash',
    install: 'git clone https://github.com/{{repo}}.git\ncd {{slug}}\ndocker compose build',
    usage: 'docker compose up -d\ndocker compose logs -f',
    scripts: [
      ['docker compose up -d', 'Khởi động các dịch vụ', 'Start the services'],
      ['docker compose down', 'Dừng và xóa container', 'Stop and remove containers'],
      ['docker compose logs -f', 'Xem log', 'Follow the logs'],
    ],
    test: 'docker compose run --rm app npm test',
    env: [
      ['APP_PORT', '8080', 'Cổng public của ứng dụng', 'Public port of the app'],
      ['POSTGRES_PASSWORD', 'change-me', 'Mật khẩu cơ sở dữ liệu', 'Database password'],
    ],
    api: '',
    defaultOn: [...BASE_ON, 'config'],
  },
  cli: {
    stack: ['Node.js'],
    requires: [['Node.js 18 trở lên'], ['Node.js 18 or newer']],
    lang: 'bash',
    install: 'npm install -g {{slug}}',
    usage: '{{slug}} --help\n{{slug}} <lệnh> [tùy chọn]',
    scripts: [],
    test: 'npm test',
    env: [],
    api: '| Tùy chọn | Mô tả |\n| --- | --- |\n| `-h, --help` | Hiển thị trợ giúp |\n| `-v, --version` | Hiển thị phiên bản |\n| `-o, --output <file>` | Ghi kết quả ra file |',
    defaultOn: [...BASE_ON, 'api'],
  },
  library: {
    stack: ['TypeScript'],
    requires: [['Node.js 18 trở lên'], ['Node.js 18 or newer']],
    lang: 'bash',
    install: 'npm install {{slug}}',
    usage: "import { example } from '{{slug}}';\n\nconst result = example('hello');\nconsole.log(result);",
    scripts: [
      ['npm run build', 'Biên dịch thư viện', 'Build the library'],
      ['npm test', 'Chạy kiểm thử', 'Run the tests'],
    ],
    test: 'npm test',
    env: [],
    api: '### `example(input)`\n\n| Tham số | Kiểu | Mô tả |\n| --- | --- | --- |\n| `input` | `string` | Dữ liệu đầu vào |\n\nTrả về: `string`',
    defaultOn: [...BASE_ON, 'api'],
  },
  mobile: {
    stack: ['React Native', 'Expo', 'TypeScript'],
    requires: [['Node.js 18 trở lên', 'Expo Go trên điện thoại hoặc trình giả lập Android/iOS'], ['Node.js 18 or newer', 'Expo Go on your phone or an Android/iOS emulator']],
    lang: 'bash',
    install: 'git clone https://github.com/{{repo}}.git\ncd {{slug}}\nnpm install',
    usage: 'npx expo start',
    scripts: [
      ['npx expo start', 'Chạy máy chủ phát triển', 'Start the dev server'],
      ['npx expo run:android', 'Chạy trên Android', 'Run on Android'],
      ['npx expo run:ios', 'Chạy trên iOS', 'Run on iOS'],
    ],
    test: 'npm test',
    env: [['API_URL', 'https://api.example.com', 'Địa chỉ máy chủ API', 'API server URL']],
    api: '',
    defaultOn: [...BASE_ON, 'demo', 'config'],
  },
  data: {
    stack: ['Python', 'Pandas', 'Jupyter'],
    requires: [['Python 3.10 trở lên', 'Jupyter Lab'], ['Python 3.10 or newer', 'Jupyter Lab']],
    lang: 'bash',
    install:
      'git clone https://github.com/{{repo}}.git\ncd {{slug}}\npython -m venv .venv\nsource .venv/bin/activate\npip install -r requirements.txt',
    usage: 'jupyter lab',
    scripts: [
      ['jupyter lab', 'Mở notebook', 'Open the notebooks'],
      ['python src/train.py', 'Huấn luyện mô hình', 'Train the model'],
      ['pytest', 'Kiểm thử mã xử lý dữ liệu', 'Test the data code'],
    ],
    test: 'pytest',
    env: [['DATA_DIR', './data', 'Thư mục chứa dữ liệu', 'Data directory']],
    api: '',
    defaultOn: [...BASE_ON, 'structure'],
  },
};

export function defaultStack(type: ProjectType): string[] {
  return [...TYPES[type].stack];
}

export function defaultEnabled(type: ProjectType): SectionId[] {
  return TYPES[type].defaultOn;
}

export function slugName(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'my-project';
}

function fill(s: string, c: ProjectCtx): string {
  const owner = c.repo.split('/')[0] || 'your-username';
  const repo = c.repo.includes('/') ? c.repo : `${owner}/${slugName(c.name)}`;
  return s
    .replace(/\{\{repo\}\}/g, repo)
    .replace(/\{\{owner\}\}/g, owner)
    .replace(/\{\{slug\}\}/g, c.repo.split('/')[1] || slugName(c.name));
}

/** Nội dung mẫu mặc định cho một mục (phần thân, không gồm tiêu đề mục). */
export function sectionTemplate(id: SectionId, c: ProjectCtx): string {
  const vi = c.lang === 'vi';
  const t = (a: string, b: string) => (vi ? a : b);
  const info = TYPES[c.type];
  const code = (body: string, lang = info.lang) => '```' + lang + '\n' + fill(body, c) + '\n```';
  const owner = c.repo.split('/')[0] || 'your-username';
  const repoUrl = c.repo.includes('/') ? `https://github.com/${c.repo}` : 'https://github.com/your-username/your-repo';
  const stack = c.stack.length ? c.stack : info.stack;

  switch (id) {
    case 'title':
      return c.description.trim() || t('Mô tả ngắn gọn về dự án: dự án làm gì và dành cho ai.', 'A short description of what the project does and who it is for.');
    case 'badges':
      return '';
    case 'demo':
      return [
        t('Ảnh chụp màn hình hoặc GIF minh họa:', 'Screenshots or an animated GIF:'),
        '',
        `![Demo](docs/demo.png)`,
        '',
        t('Bản demo trực tuyến: [Xem tại đây](https://example.com)', 'Live demo: [View it here](https://example.com)'),
      ].join('\n');
    case 'toc':
      return '';
    case 'features':
      return [
        t('- Tính năng nổi bật thứ nhất', '- First key feature'),
        t('- Tính năng nổi bật thứ hai', '- Second key feature'),
        t('- Dễ cài đặt, dễ sử dụng', '- Easy to install and use'),
        t('- Mã nguồn mở, chào đón đóng góp', '- Open source and contributions welcome'),
      ].join('\n');
    case 'tech':
      return stack.map((s) => techBadge(s)).join(' ');
    case 'requirements':
      return info.requires[vi ? 0 : 1].map((r) => `- ${r}`).join('\n');
    case 'install':
      return [t('Làm theo các bước sau để cài đặt:', 'Follow these steps to install:'), '', code(info.install)].join('\n');
    case 'usage':
      return [t('Chạy dự án:', 'Run the project:'), '', code(info.usage, c.type === 'library' ? 'ts' : info.lang)].join('\n');
    case 'config': {
      const rows = info.env.length ? info.env : [['APP_ENV', 'production', 'Môi trường chạy', 'Runtime environment'] as [string, string, string, string]];
      return [
        t('Sao chép `.env.example` thành `.env` và điền giá trị phù hợp:', 'Copy `.env.example` to `.env` and fill in the values:'),
        '',
        t('| Biến | Giá trị ví dụ | Mô tả |', '| Variable | Example | Description |'),
        '| --- | --- | --- |',
        ...rows.map((r) => `| \`${r[0]}\` | \`${r[1]}\` | ${vi ? r[2] : r[3]} |`),
      ].join('\n');
    }
    case 'structure':
      return code(`${c.repo.split('/')[1] || slugName(c.name)}/\n├── src/\n├── tests/\n├── README.md\n└── LICENSE`, 'text');
    case 'scripts': {
      const rows = info.scripts;
      if (!rows.length) return t('Chưa có script nào. Hãy liệt kê các lệnh thường dùng tại đây.', 'No scripts yet. List the commonly used commands here.');
      return [t('| Lệnh | Mô tả |', '| Command | Description |'), '| --- | --- |', ...rows.map((r) => `| \`${fill(r[0], c)}\` | ${vi ? r[1] : r[2]} |`)].join('\n');
    }
    case 'testing':
      return [t('Chạy bộ kiểm thử:', 'Run the test suite:'), '', code(info.test)].join('\n');
    case 'api':
      return info.api || t('Mô tả các endpoint hoặc hàm công khai tại đây.', 'Document the public endpoints or functions here.');
    case 'roadmap':
      return [
        t('- [x] Phiên bản đầu tiên', '- [x] First release'),
        t('- [ ] Bổ sung tài liệu chi tiết', '- [ ] Add detailed documentation'),
        t('- [ ] Hỗ trợ thêm nền tảng', '- [ ] Support more platforms'),
        t('- [ ] Cải thiện hiệu năng', '- [ ] Improve performance'),
      ].join('\n');
    case 'contributing':
      return vi
        ? [
            'Mọi đóng góp đều được chào đón!',
            '',
            '1. Fork repository',
            '2. Tạo nhánh tính năng: `git checkout -b feature/ten-tinh-nang`',
            '3. Commit thay đổi: `git commit -m "Thêm tính năng X"`',
            '4. Push lên nhánh: `git push origin feature/ten-tinh-nang`',
            '5. Mở Pull Request',
          ].join('\n')
        : [
            'Contributions are welcome!',
            '',
            '1. Fork the repository',
            '2. Create a feature branch: `git checkout -b feature/amazing-feature`',
            '3. Commit your changes: `git commit -m "Add amazing feature"`',
            '4. Push to the branch: `git push origin feature/amazing-feature`',
            '5. Open a Pull Request',
          ].join('\n');
    case 'license':
      return vi
        ? `Phân phối theo giấy phép ${c.license || 'MIT'}. Xem file [LICENSE](LICENSE) để biết thêm chi tiết.`
        : `Distributed under the ${c.license || 'MIT'} License. See [LICENSE](LICENSE) for more information.`;
    case 'author':
      return [`- GitHub: [@${owner}](https://github.com/${owner})`, `- ${t('Dự án', 'Project')}: [${c.repo || 'owner/repo'}](${repoUrl})`, `- Email: your.email@example.com`].join('\n');
    case 'thanks':
      return [t('- [Shields.io](https://shields.io) cho các badge', '- [Shields.io](https://shields.io) for the badges'), t('- [Choose a License](https://choosealicense.com) giúp chọn giấy phép', '- [Choose a License](https://choosealicense.com) for help picking a license')].join('\n');
  }
}

/* ------------------------------------------------------------------ */
/* Ghép README                                                          */
/* ------------------------------------------------------------------ */

export interface BuildInput {
  ctx: ProjectCtx;
  order: SectionId[];
  enabled: Partial<Record<SectionId, boolean>>;
  /** Nội dung từng mục đã chốt (mẫu hoặc người dùng sửa). */
  bodies: Partial<Record<SectionId, string>>;
  tocMin?: number;
  tocMax?: number;
}

export function buildReadme(input: BuildInput): string {
  const { ctx, order, enabled, bodies } = input;
  const parts: { id: SectionId; text: string }[] = [];
  for (const id of order) {
    if (!enabled[id]) continue;
    const body = (bodies[id] ?? '').trim();
    if (id === 'title') {
      parts.push({ id, text: `# ${ctx.name.trim() || 'Tên dự án'}${body ? '\n\n' + body : ''}` });
    } else if (id === 'badges') {
      if (body) parts.push({ id, text: body });
    } else {
      const h = `## ${sectionHeading(id, ctx.lang)}`;
      parts.push({ id, text: id === 'toc' ? h + '\n\n@@TOC@@' : body ? `${h}\n\n${body}` : h });
    }
  }
  const draft = parts.map((p) => p.text).join('\n\n');
  if (!draft.includes('@@TOC@@')) return draft + '\n';
  const tocHead = sectionHeading('toc', ctx.lang);
  const toc = generateToc(draft.replace('@@TOC@@', ''), input.tocMin ?? 2, input.tocMax ?? 3, [tocHead]);
  const tocText = toc || (ctx.lang === 'vi' ? '_Chưa có mục nào._' : '_No sections yet._');
  return draft.replace('@@TOC@@', () => tocText) + '\n';
}
