/**
 * Sinh thẻ <head> (SEO / Open Graph / Twitter Card / JSON-LD), kiểm tra và phân tích HTML head.
 * Thuần logic, không phụ thuộc React hay DOM.
 */

/* ---------------- Escape ---------------- */

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** JSON an toàn khi nhúng trong <script>: không để lọt `</script>` hay `<!--`. */
export function safeJsonForScript(obj: unknown, indent = 2): string {
  return JSON.stringify(obj, null, indent).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/* ---------------- Mô hình dữ liệu ---------------- */

export type JsonLdType = 'Article' | 'Product' | 'Organization' | 'WebSite' | 'BreadcrumbList' | 'FAQPage' | 'SoftwareApplication';

export interface JsonLdBlock {
  id: string;
  type: JsonLdType;
  f: Record<string, string>;
  items: { a: string; b: string }[];
}

export interface MetaState {
  title: string;
  description: string;
  canonical: string;
  lang: string;
  charset: string;
  viewport: string;
  themeColor: string;
  author: string;
  robots: {
    index: boolean;
    follow: boolean;
    noarchive: boolean;
    nosnippet: boolean;
    noimageindex: boolean;
    notranslate: boolean;
    maxSnippet: string;
    maxImagePreview: '' | 'none' | 'standard' | 'large';
    maxVideoPreview: string;
  };
  favicon: string;
  appleTouchIcon: string;
  manifest: string;
  og: {
    enabled: boolean;
    title: string;
    description: string;
    type: string;
    url: string;
    image: string;
    imageAlt: string;
    imageWidth: string;
    imageHeight: string;
    siteName: string;
    locale: string;
  };
  article: { publishedTime: string; modifiedTime: string; author: string; section: string; tags: string };
  twitter: { enabled: boolean; card: 'summary' | 'summary_large_image'; site: string; creator: string; title: string; description: string; image: string };
  alternates: { hreflang: string; href: string }[];
  preconnect: { href: string; crossorigin: boolean }[];
  jsonld: JsonLdBlock[];
}

export function defaultMetaState(): MetaState {
  return {
    title: '',
    description: '',
    canonical: '',
    lang: 'vi',
    charset: 'utf-8',
    viewport: 'width=device-width, initial-scale=1',
    themeColor: '',
    author: '',
    robots: { index: true, follow: true, noarchive: false, nosnippet: false, noimageindex: false, notranslate: false, maxSnippet: '', maxImagePreview: '', maxVideoPreview: '' },
    favicon: '',
    appleTouchIcon: '',
    manifest: '',
    og: { enabled: true, title: '', description: '', type: 'website', url: '', image: '', imageAlt: '', imageWidth: '', imageHeight: '', siteName: '', locale: 'vi_VN' },
    article: { publishedTime: '', modifiedTime: '', author: '', section: '', tags: '' },
    twitter: { enabled: true, card: 'summary_large_image', site: '', creator: '', title: '', description: '', image: '' },
    alternates: [],
    preconnect: [],
    jsonld: [],
  };
}

export function sampleMetaState(): MetaState {
  const s = defaultMetaState();
  s.title = 'GeTools - Bộ công cụ trực tuyến miễn phí cho lập trình viên';
  s.description = 'Hơn 40 công cụ chạy ngay trên trình duyệt: JSON, regex, mã hóa, màu sắc, thời gian... Không cần cài đặt, dữ liệu không rời khỏi máy bạn.';
  s.canonical = 'https://getools.example.com/';
  s.themeColor = '#0f172a';
  s.favicon = 'https://getools.example.com/favicon.ico';
  s.appleTouchIcon = 'https://getools.example.com/apple-touch-icon.png';
  s.og = { ...s.og, title: 'GeTools - Công cụ cho lập trình viên', description: 'Bộ công cụ chạy hoàn toàn trên trình duyệt, miễn phí.', url: 'https://getools.example.com/', image: 'https://getools.example.com/og.png', imageAlt: 'Ảnh giới thiệu GeTools', imageWidth: '1200', imageHeight: '630', siteName: 'GeTools' };
  s.twitter = { ...s.twitter, site: '@getools', creator: '@getools' };
  s.alternates = [{ hreflang: 'vi', href: 'https://getools.example.com/' }, { hreflang: 'en', href: 'https://getools.example.com/en/' }, { hreflang: 'x-default', href: 'https://getools.example.com/' }];
  s.preconnect = [{ href: 'https://fonts.googleapis.com', crossorigin: false }, { href: 'https://fonts.gstatic.com', crossorigin: true }];
  s.jsonld = [{ id: 'j1', type: 'WebSite', f: { name: 'GeTools', url: 'https://getools.example.com/', searchUrl: 'https://getools.example.com/search?q={search_term_string}' }, items: [] }];
  return s;
}

/* ---------------- Ước lượng độ rộng pixel (Arial 20px, kiểu tiêu đề Google) ---------------- */

const W_NARROW = new Set("ijl'.,:;!|`".split(''));

function charEm(ch: string): number {
  const c = ch.codePointAt(0)!;
  if (c >= 0x1100 && (c <= 0x11ff || (c >= 0x2e80 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xff60) || c >= 0x20000)) return 1.0;
  if (ch === ' ') return 0.278;
  if (W_NARROW.has(ch)) return 0.24;
  if ('ft'.includes(ch)) return 0.278;
  if (ch === 'r') return 0.333;
  if ('-()[]{}"'.includes(ch)) return 0.34;
  if (ch === 'I') return 0.278;
  if (ch === 'm') return 0.833;
  if (ch === 'w') return 0.722;
  if ('MW'.includes(ch)) return 0.9;
  if (ch === '@' || ch === '%') return 0.9;
  if (/[A-Z]/.test(ch)) return 0.68;
  if (/[0-9]/.test(ch)) return 0.556;
  if (/[a-z]/.test(ch)) return 0.56;
  return 0.6;
}

/** Ước lượng bề rộng (px) của tiêu đề ở cỡ 20px. Bỏ dấu thanh/dấu mũ (NFD) để chữ tiếng Việt tính như chữ gốc. */
export function estimateTitlePx(text: string, fontPx = 20): number {
  let em = 0;
  for (const ch of text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')) em += charEm(ch);
  return Math.round(em * fontPx);
}

/** Cắt tiêu đề theo bề rộng px, thêm "…" nếu bị cắt. */
export function truncateByPx(text: string, maxPx: number): { text: string; truncated: boolean } {
  if (estimateTitlePx(text) <= maxPx) return { text, truncated: false };
  let out = '';
  for (const ch of text) {
    if (estimateTitlePx(out + ch + '…') > maxPx) break;
    out += ch;
  }
  return { text: out.trimEnd() + '…', truncated: true };
}

export function truncateChars(text: string, max: number): { text: string; truncated: boolean } {
  const chars = [...text];
  if (chars.length <= max) return { text, truncated: false };
  return { text: chars.slice(0, max).join('').trimEnd() + '…', truncated: true };
}

/* ---------------- JSON-LD ---------------- */

function prune<T>(v: T): T | undefined {
  if (Array.isArray(v)) {
    const a = v.map(prune).filter((x) => x !== undefined);
    return (a.length ? a : undefined) as unknown as T | undefined;
  }
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const p = prune(x);
      if (p !== undefined) o[k] = p;
    }
    const keys = Object.keys(o);
    // Đối tượng chỉ còn @type thì coi như rỗng
    return (keys.length === 0 || (keys.length === 1 && keys[0] === '@type') ? undefined : o) as unknown as T | undefined;
  }
  if (typeof v === 'string') return (v.trim() === '' ? undefined : v.trim()) as unknown as T | undefined;
  return v;
}

const lines = (s: string | undefined) => (s || '').split(/\r?\n|,\s*(?=https?:)/).map((x) => x.trim()).filter(Boolean);
const num = (s: string | undefined): number | string | undefined => {
  const t = (s || '').trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
};

export const JSONLD_FIELDS: Record<JsonLdType, { key: string; label: string; multiline?: boolean; placeholder?: string }[]> = {
  Article: [
    { key: 'headline', label: 'Tiêu đề bài (headline)' }, { key: 'description', label: 'Mô tả' }, { key: 'image', label: 'Ảnh (mỗi dòng 1 URL)', multiline: true },
    { key: 'datePublished', label: 'Ngày đăng (ISO 8601)', placeholder: '2025-01-31T08:00:00+07:00' }, { key: 'dateModified', label: 'Ngày sửa (ISO 8601)' },
    { key: 'authorName', label: 'Tên tác giả' }, { key: 'authorUrl', label: 'URL tác giả' },
    { key: 'publisherName', label: 'Tên nhà xuất bản' }, { key: 'publisherLogo', label: 'Logo nhà xuất bản (URL)' }, { key: 'url', label: 'URL bài viết' },
  ],
  Product: [
    { key: 'name', label: 'Tên sản phẩm' }, { key: 'description', label: 'Mô tả' }, { key: 'image', label: 'Ảnh (mỗi dòng 1 URL)', multiline: true },
    { key: 'sku', label: 'SKU' }, { key: 'brand', label: 'Thương hiệu' }, { key: 'price', label: 'Giá', placeholder: '199000' }, { key: 'currency', label: 'Tiền tệ', placeholder: 'VND' },
    { key: 'availability', label: 'Tình trạng (InStock, OutOfStock, PreOrder...)', placeholder: 'InStock' }, { key: 'url', label: 'URL sản phẩm' },
    { key: 'ratingValue', label: 'Điểm đánh giá TB' }, { key: 'reviewCount', label: 'Số lượt đánh giá' },
  ],
  Organization: [
    { key: 'name', label: 'Tên tổ chức' }, { key: 'url', label: 'Website' }, { key: 'logo', label: 'Logo (URL)' },
    { key: 'sameAs', label: 'Hồ sơ mạng xã hội (mỗi dòng 1 URL)', multiline: true }, { key: 'telephone', label: 'Điện thoại' }, { key: 'contactType', label: 'Loại liên hệ', placeholder: 'customer service' },
  ],
  WebSite: [
    { key: 'name', label: 'Tên website' }, { key: 'url', label: 'URL gốc' }, { key: 'searchUrl', label: 'URL tìm kiếm (dùng {search_term_string})', placeholder: 'https://example.com/search?q={search_term_string}' },
  ],
  BreadcrumbList: [],
  FAQPage: [],
  SoftwareApplication: [
    { key: 'name', label: 'Tên ứng dụng' }, { key: 'description', label: 'Mô tả' }, { key: 'operatingSystem', label: 'Hệ điều hành', placeholder: 'Android, iOS, Web' },
    { key: 'applicationCategory', label: 'Danh mục', placeholder: 'DeveloperApplication' }, { key: 'price', label: 'Giá', placeholder: '0' }, { key: 'currency', label: 'Tiền tệ', placeholder: 'USD' },
    { key: 'ratingValue', label: 'Điểm đánh giá TB' }, { key: 'reviewCount', label: 'Số lượt đánh giá' }, { key: 'url', label: 'URL' },
  ],
};

const AVAIL: Record<string, string> = { instock: 'InStock', outofstock: 'OutOfStock', preorder: 'PreOrder', backorder: 'BackOrder', soldout: 'SoldOut', discontinued: 'Discontinued', limitedavailability: 'LimitedAvailability' };

export function buildJsonLd(b: JsonLdBlock): Record<string, unknown> | null {
  const f = b.f;
  const t = (k: string) => (f[k] || '').trim();
  let o: Record<string, unknown>;
  const rating = (): unknown =>
    t('ratingValue') && t('reviewCount')
      ? { '@type': 'AggregateRating', ratingValue: num(f.ratingValue), reviewCount: num(f.reviewCount) }
      : undefined;
  switch (b.type) {
    case 'Article':
      o = {
        '@type': 'Article', headline: t('headline'), description: t('description'),
        image: lines(f.image), datePublished: t('datePublished'), dateModified: t('dateModified'),
        author: { '@type': 'Person', name: t('authorName'), url: t('authorUrl') },
        publisher: { '@type': 'Organization', name: t('publisherName'), logo: t('publisherLogo') ? { '@type': 'ImageObject', url: t('publisherLogo') } : undefined },
        mainEntityOfPage: t('url') ? { '@type': 'WebPage', '@id': t('url') } : undefined,
      };
      break;
    case 'Product': {
      const av = t('availability').replace(/^https?:\/\/schema\.org\//, '');
      o = {
        '@type': 'Product', name: t('name'), image: lines(f.image), description: t('description'), sku: t('sku'),
        brand: t('brand') ? { '@type': 'Brand', name: t('brand') } : undefined,
        offers: t('price')
          ? { '@type': 'Offer', url: t('url'), price: t('price'), priceCurrency: t('currency').toUpperCase(), availability: av ? 'https://schema.org/' + (AVAIL[av.toLowerCase()] || av) : undefined }
          : undefined,
        aggregateRating: rating(),
      };
      break;
    }
    case 'Organization':
      o = {
        '@type': 'Organization', name: t('name'), url: t('url'), logo: t('logo'), sameAs: lines(f.sameAs),
        contactPoint: t('telephone') ? { '@type': 'ContactPoint', telephone: t('telephone'), contactType: t('contactType') } : undefined,
      };
      break;
    case 'WebSite':
      o = {
        '@type': 'WebSite', name: t('name'), url: t('url'),
        potentialAction: t('searchUrl')
          ? { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: t('searchUrl') }, 'query-input': 'required name=search_term_string' }
          : undefined,
      };
      break;
    case 'BreadcrumbList': {
      const rows = b.items.filter((i) => i.a.trim());
      o = { '@type': 'BreadcrumbList', itemListElement: rows.map((i, idx) => ({ '@type': 'ListItem', position: idx + 1, name: i.a.trim(), item: i.b.trim() || undefined })) };
      break;
    }
    case 'FAQPage': {
      const rows = b.items.filter((i) => i.a.trim() && i.b.trim());
      o = { '@type': 'FAQPage', mainEntity: rows.map((i) => ({ '@type': 'Question', name: i.a.trim(), acceptedAnswer: { '@type': 'Answer', text: i.b.trim() } })) };
      break;
    }
    case 'SoftwareApplication':
      o = {
        '@type': 'SoftwareApplication', name: t('name'), description: t('description'), operatingSystem: t('operatingSystem'),
        applicationCategory: t('applicationCategory'), url: t('url'),
        offers: t('price') !== '' ? { '@type': 'Offer', price: t('price'), priceCurrency: t('currency').toUpperCase() } : undefined,
        aggregateRating: rating(),
      };
      break;
    default:
      return null;
  }
  const p = prune(o);
  return p ? { '@context': 'https://schema.org', ...(p as Record<string, unknown>) } : null;
}

const JSONLD_REQUIRED: Partial<Record<JsonLdType, string[]>> = {
  Article: ['headline', 'image', 'datePublished', 'authorName'],
  Product: ['name', 'image', 'price', 'currency'],
  Organization: ['name', 'url'],
  WebSite: ['name', 'url'],
  SoftwareApplication: ['name', 'operatingSystem', 'applicationCategory'],
};

/* ---------------- Danh sách thẻ trung gian ---------------- */

export interface HeadItem {
  tag: 'meta' | 'link' | 'title' | 'script' | 'html';
  attrs: [string, string][];
  text?: string;
}

const t = (s: string) => s.trim();

export function robotsContent(r: MetaState['robots']): string {
  const v: string[] = [r.index ? 'index' : 'noindex', r.follow ? 'follow' : 'nofollow'];
  if (r.noarchive) v.push('noarchive');
  if (r.nosnippet) v.push('nosnippet');
  if (r.noimageindex) v.push('noimageindex');
  if (r.notranslate) v.push('notranslate');
  if (t(r.maxSnippet) !== '' && /^-?\d+$/.test(t(r.maxSnippet))) v.push('max-snippet:' + t(r.maxSnippet));
  if (r.maxImagePreview) v.push('max-image-preview:' + r.maxImagePreview);
  if (t(r.maxVideoPreview) !== '' && /^-?\d+$/.test(t(r.maxVideoPreview))) v.push('max-video-preview:' + t(r.maxVideoPreview));
  return v.join(', ');
}

/** Có cần xuất thẻ robots không (mặc định index,follow thì bỏ qua). */
function robotsIsDefault(r: MetaState['robots']): boolean {
  return robotsContent(r) === 'index, follow';
}

export function buildHeadItems(s: MetaState): HeadItem[] {
  const items: HeadItem[] = [];
  const meta = (k: 'name' | 'property' | 'http-equiv', n: string, c: string) => {
    if (t(c)) items.push({ tag: 'meta', attrs: [[k, n], ['content', t(c)]] });
  };
  const link = (rel: string, href: string, extra: [string, string][] = []) => {
    if (t(href)) items.push({ tag: 'link', attrs: [['rel', rel], ['href', t(href)], ...extra] });
  };
  if (t(s.charset)) items.push({ tag: 'meta', attrs: [['charset', t(s.charset)]] });
  meta('name', 'viewport', s.viewport);
  if (t(s.title)) items.push({ tag: 'title', attrs: [], text: t(s.title) });
  meta('name', 'description', s.description);
  meta('name', 'author', s.author);
  if (!robotsIsDefault(s.robots)) meta('name', 'robots', robotsContent(s.robots));
  meta('name', 'theme-color', s.themeColor);
  link('canonical', s.canonical);
  link('icon', s.favicon);
  link('apple-touch-icon', s.appleTouchIcon);
  link('manifest', s.manifest);
  for (const a of s.alternates) if (t(a.hreflang) && t(a.href)) link('alternate', a.href, [['hreflang', t(a.hreflang)]]);
  for (const p of s.preconnect) if (t(p.href)) link('preconnect', p.href, p.crossorigin ? [['crossorigin', '']] : []);
  if (s.og.enabled) {
    const o = s.og;
    meta('property', 'og:title', o.title || s.title);
    meta('property', 'og:description', o.description || s.description);
    meta('property', 'og:type', o.type);
    meta('property', 'og:url', o.url || s.canonical);
    meta('property', 'og:image', o.image);
    if (t(o.image)) {
      meta('property', 'og:image:alt', o.imageAlt);
      meta('property', 'og:image:width', o.imageWidth);
      meta('property', 'og:image:height', o.imageHeight);
    }
    meta('property', 'og:site_name', o.siteName);
    meta('property', 'og:locale', o.locale);
    if (o.type === 'article') {
      const a = s.article;
      meta('property', 'article:published_time', a.publishedTime);
      meta('property', 'article:modified_time', a.modifiedTime);
      meta('property', 'article:author', a.author);
      meta('property', 'article:section', a.section);
      for (const tag of a.tags.split(',').map(t).filter(Boolean)) meta('property', 'article:tag', tag);
    }
  }
  if (s.twitter.enabled) {
    const w = s.twitter;
    meta('name', 'twitter:card', w.card);
    meta('name', 'twitter:site', w.site);
    meta('name', 'twitter:creator', w.creator);
    meta('name', 'twitter:title', w.title);
    meta('name', 'twitter:description', w.description);
    meta('name', 'twitter:image', w.image);
    if (!t(w.image) && s.og.enabled && t(s.og.imageAlt)) meta('name', 'twitter:image:alt', s.og.imageAlt);
  }
  for (const b of s.jsonld) {
    const j = buildJsonLd(b);
    if (j) items.push({ tag: 'script', attrs: [['type', 'application/ld+json']], text: safeJsonForScript(j) });
  }
  return items;
}

/* ---------------- Bộ xuất: HTML ---------------- */

export function renderHtml(s: MetaState): string {
  const items = buildHeadItems(s);
  const out = items.map((it) => {
    const attrs = it.attrs.map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${escapeAttr(v)}"`)).join('');
    if (it.tag === 'title') return `<title>${escapeText(it.text || '')}</title>`;
    if (it.tag === 'script') return `<script${attrs}>\n${it.text}\n</script>`;
    return `<${it.tag}${attrs}>`;
  });
  return out.join('\n');
}

export function renderHtmlDocument(s: MetaState): string {
  const head = renderHtml(s)
    .split('\n')
    .map((l) => '    ' + l)
    .join('\n');
  return `<!doctype html>\n<html lang="${escapeAttr(t(s.lang) || 'en')}">\n  <head>\n${head}\n  </head>\n  <body></body>\n</html>`;
}

/* ---------------- Bộ xuất: literal JS/TS ---------------- */

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function toLiteral(v: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  const pad1 = '  '.repeat(indent + 1);
  if (v === null || v === undefined) return 'undefined';
  if (typeof v === 'string') return JSON.stringify(v).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    const simple = v.every((x) => typeof x === 'string' || typeof x === 'number');
    if (simple && v.length <= 3) return '[' + v.map((x) => toLiteral(x)).join(', ') + ']';
    return '[\n' + v.map((x) => pad1 + toLiteral(x, indent + 1)).join(',\n') + ',\n' + pad + ']';
  }
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
  if (!entries.length) return '{}';
  return '{\n' + entries.map(([k, x]) => `${pad1}${IDENT.test(k) ? k : JSON.stringify(k)}: ${toLiteral(x, indent + 1)}`).join(',\n') + ',\n' + pad + '}';
}

function robotsObject(r: MetaState['robots']): Record<string, unknown> | undefined {
  if (robotsIsDefault(r)) return undefined;
  const g: Record<string, unknown> = {};
  const o: Record<string, unknown> = { index: r.index, follow: r.follow };
  if (r.noarchive) g.noarchive = true;
  if (r.nosnippet) g.nosnippet = true;
  if (r.noimageindex) g.noimageindex = true;
  if (r.notranslate) g.notranslate = true;
  if (/^-?\d+$/.test(t(r.maxSnippet))) g['max-snippet'] = Number(t(r.maxSnippet));
  if (r.maxImagePreview) g['max-image-preview'] = r.maxImagePreview;
  if (/^-?\d+$/.test(t(r.maxVideoPreview))) g['max-video-preview'] = Number(t(r.maxVideoPreview));
  return Object.keys(g).length ? { ...o, ...g } : o;
}

function parseViewport(v: string): Record<string, unknown> | undefined {
  const o: Record<string, unknown> = {};
  for (const part of v.split(',')) {
    const [k, val] = part.split('=').map((x) => x.trim());
    if (!k || val === undefined) continue;
    const key = k.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    o[key] = /^-?\d+(\.\d+)?$/.test(val) ? Number(val) : val === 'yes' ? true : val === 'no' ? false : val;
  }
  return Object.keys(o).length ? o : undefined;
}

export function nextMetadata(s: MetaState): string {
  const md: Record<string, unknown> = {};
  if (t(s.title)) md.title = t(s.title);
  if (t(s.description)) md.description = t(s.description);
  if (t(s.author)) md.authors = [{ name: t(s.author) }];
  if (t(s.manifest)) md.manifest = t(s.manifest);
  const alt: Record<string, unknown> = {};
  if (t(s.canonical)) alt.canonical = t(s.canonical);
  const langs: Record<string, string> = {};
  for (const a of s.alternates) if (t(a.hreflang) && t(a.href)) langs[t(a.hreflang)] = t(a.href);
  if (Object.keys(langs).length) alt.languages = langs;
  if (Object.keys(alt).length) md.alternates = alt;
  const rb = robotsObject(s.robots);
  if (rb) {
    const { index, follow, ...rest } = rb;
    md.robots = Object.keys(rest).length ? { index, follow, googleBot: { index, follow, ...rest } } : { index, follow };
  }
  const icons: Record<string, unknown> = {};
  if (t(s.favicon)) icons.icon = t(s.favicon);
  if (t(s.appleTouchIcon)) icons.apple = t(s.appleTouchIcon);
  if (Object.keys(icons).length) md.icons = icons;
  if (s.og.enabled) {
    const o = s.og;
    const og: Record<string, unknown> = {
      title: t(o.title) || undefined, description: t(o.description) || undefined, url: t(o.url) || undefined, siteName: t(o.siteName) || undefined,
      locale: t(o.locale) || undefined, type: t(o.type) || undefined,
    };
    if (t(o.image)) og.images = [{ url: t(o.image), width: num(o.imageWidth), height: num(o.imageHeight), alt: t(o.imageAlt) || undefined }];
    if (o.type === 'article') {
      const a = s.article;
      Object.assign(og, {
        publishedTime: t(a.publishedTime) || undefined, modifiedTime: t(a.modifiedTime) || undefined,
        authors: t(a.author) ? [t(a.author)] : undefined, section: t(a.section) || undefined,
        tags: a.tags.split(',').map(t).filter(Boolean),
      });
      if (!(og.tags as string[]).length) delete og.tags;
    }
    md.openGraph = og;
  }
  if (s.twitter.enabled) {
    const w = s.twitter;
    md.twitter = {
      card: w.card, site: t(w.site) || undefined, creator: t(w.creator) || undefined, title: t(w.title) || undefined, description: t(w.description) || undefined,
      images: t(w.image) ? [t(w.image)] : undefined,
    };
  }
  const vp: Record<string, unknown> = { ...(parseViewport(s.viewport) || {}) };
  if (t(s.themeColor)) vp.themeColor = t(s.themeColor);
  let out = `import type { Metadata, Viewport } from 'next';\n\nexport const metadata: Metadata = ${toLiteral(md)};\n`;
  if (Object.keys(vp).length) out += `\nexport const viewport: Viewport = ${toLiteral(vp)};\n`;
  const ld = s.jsonld.map(buildJsonLd).filter(Boolean);
  out += `\n// <html lang="${t(s.lang) || 'en'}"> đặt trong app/layout.tsx.\n`;
  if (ld.length) {
    out += `// JSON-LD không nằm trong Metadata API: render trong page/layout.\n`;
    out += `const jsonLd = ${toLiteral(ld.length === 1 ? ld[0] : ld)};\n`;
    out += `// <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\\\u003c') }} />\n`;
  }
  return out;
}

/* ---------------- Bộ xuất: Helmet / Nuxt ---------------- */

function jsxAttr(v: string): string {
  return /^[A-Za-z0-9 _.,:;/#@+=?-]*$/.test(v) ? `"${v}"` : `{${JSON.stringify(v)}}`;
}

export function reactHelmet(s: MetaState): string {
  const items = buildHeadItems(s);
  const body = items.map((it) => {
    if (it.tag === 'title') return `<title>{${JSON.stringify(it.text)}}</title>`;
    const attrs = it.attrs.map(([k, v]) => {
      const name = k === 'charset' ? 'charSet' : k === 'http-equiv' ? 'httpEquiv' : k === 'crossorigin' ? 'crossOrigin' : k === 'hreflang' ? 'hrefLang' : k;
      return v === '' ? name : `${name}=${jsxAttr(v)}`;
    });
    if (it.tag === 'script') {
      let json = it.text || '';
      try {
        json = JSON.stringify(JSON.parse(json));
      } catch {
        /* giữ nguyên */
      }
      return `<script type="application/ld+json">{${JSON.stringify(json)}}</script>`;
    }
    return `<${it.tag} ${attrs.join(' ')} />`;
  });
  return `import { Helmet } from 'react-helmet-async';\n\nexport function SeoHead() {\n  return (\n    <Helmet htmlAttributes={{ lang: ${JSON.stringify(t(s.lang) || 'en')} }}>\n${body.map((l) => '      ' + l).join('\n')}\n    </Helmet>\n  );\n}\n`;
}

export function nuxtUseHead(s: MetaState): string {
  const items = buildHeadItems(s);
  const metaArr: Record<string, unknown>[] = [];
  const linkArr: Record<string, unknown>[] = [];
  const scripts: Record<string, unknown>[] = [];
  let title: string | undefined;
  let charset: string | undefined;
  for (const it of items) {
    const o: Record<string, unknown> = {};
    for (const [k, v] of it.attrs) o[k === 'http-equiv' ? 'http-equiv' : k] = k === 'crossorigin' && v === '' ? 'anonymous' : v;
    if (it.tag === 'title') title = it.text;
    else if (it.tag === 'meta') {
      if (o.charset) charset = String(o.charset);
      else metaArr.push(o);
    } else if (it.tag === 'link') linkArr.push(o);
    else if (it.tag === 'script') scripts.push({ type: 'application/ld+json', innerHTML: it.text });
  }
  const cfg: Record<string, unknown> = { htmlAttrs: { lang: t(s.lang) || 'en' }, title, meta: metaArr, link: linkArr, script: scripts.length ? scripts : undefined };
  void charset;
  return `// Nuxt 3: trong <script setup> của page/layout hoặc app.vue\nuseHead(${toLiteral(cfg)});\n`;
}

/* ---------------- Kiểm tra (validation) ---------------- */

export type Severity = 'error' | 'warning' | 'info' | 'ok';

export interface Issue {
  severity: Severity;
  message: string;
}

const isAbs = (u: string) => /^https?:\/\//i.test(u.trim());
const isHttp = (u: string) => /^http:\/\//i.test(u.trim());
const isHttps = (u: string) => /^https:\/\//i.test(u.trim());

export function validateMeta(s: MetaState): Issue[] {
  const out: Issue[] = [];
  const add = (severity: Severity, message: string) => out.push({ severity, message });
  const title = t(s.title);
  const desc = t(s.description);
  if (!title) add('error', 'Thiếu <title>.');
  else {
    const px = estimateTitlePx(title);
    if (title.length > 60) add('warning', `Tiêu đề dài ${title.length} ký tự (khuyến nghị 50-60), dễ bị Google cắt.`);
    else if (title.length < 30) add('info', `Tiêu đề khá ngắn (${title.length} ký tự); nên 50-60 ký tự.`);
    if (px > 580) add('warning', `Tiêu đề ước tính ${px}px, vượt ~580px nên có thể bị cắt trên Google.`);
  }
  if (!desc) add('warning', 'Thiếu meta description.');
  else if (desc.length > 160) add('warning', `Mô tả dài ${desc.length} ký tự (khuyến nghị 150-160), sẽ bị cắt.`);
  else if (desc.length < 70) add('info', `Mô tả ngắn (${desc.length} ký tự); nên 150-160 ký tự.`);
  if (!t(s.canonical)) add('info', 'Chưa có canonical; nên khai báo để tránh trùng lặp nội dung.');
  else if (!isAbs(s.canonical)) add('error', 'Canonical phải là URL tuyệt đối (bắt đầu bằng http:// hoặc https://).');
  if (!s.robots.index) add('info', 'Robots đang là noindex: trang sẽ không được lập chỉ mục.');
  if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(s.viewport)) add('warning', 'Viewport chặn zoom (user-scalable=no / maximum-scale=1) gây khó truy cập.');
  if (!t(s.viewport)) add('warning', 'Thiếu thẻ viewport: trang không responsive trên di động.');
  if (!t(s.charset)) add('warning', 'Thiếu charset (nên là utf-8).');
  if (t(s.themeColor) && !/^(#[0-9a-f]{3,8}|rgb|hsl|[a-z]+)/i.test(t(s.themeColor))) add('warning', 'theme-color không giống một màu hợp lệ.');
  for (const [name, v] of [['favicon', s.favicon], ['apple-touch-icon', s.appleTouchIcon], ['manifest', s.manifest]] as const) {
    if (t(v) && /^http:\/\//i.test(t(v)) && isHttps(s.canonical)) add('warning', `${name} dùng http:// trong khi trang dùng https (mixed content).`);
  }

  if (s.og.enabled) {
    const o = s.og;
    const ogTitle = t(o.title) || title;
    if (!ogTitle) add('warning', 'Thiếu og:title.');
    else if (ogTitle.length > 90) add('warning', `og:title dài ${ogTitle.length} ký tự (nên ≤ 90).`);
    if (!(t(o.description) || desc)) add('warning', 'Thiếu og:description.');
    if (!t(o.image)) add('warning', 'Thiếu og:image: link chia sẻ sẽ không có ảnh (khuyến nghị 1200x630).');
    else {
      if (!isAbs(o.image)) add('error', 'og:image phải là URL tuyệt đối, URL tương đối không hoạt động trên mạng xã hội.');
      else if (isHttp(o.image)) add('warning', 'og:image dùng http://; nhiều nền tảng yêu cầu https://.');
      if (!t(o.imageAlt)) add('info', 'Chưa có og:image:alt (mô tả ảnh cho trình đọc màn hình).');
      if (!t(o.imageWidth) || !t(o.imageHeight)) add('info', 'Nên khai báo og:image:width và og:image:height để ảnh hiện nhanh ở lần chia sẻ đầu.');
    }
    const ogUrl = t(o.url) || t(s.canonical);
    if (!ogUrl) add('warning', 'Thiếu og:url.');
    else if (!isAbs(ogUrl)) add('error', 'og:url phải là URL tuyệt đối.');
    if (!t(o.type)) add('info', 'Thiếu og:type (thường là website hoặc article).');
    if (!t(o.siteName)) add('info', 'Thiếu og:site_name.');
    if (t(o.locale) && !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(t(o.locale))) add('warning', 'og:locale nên theo dạng ngôn ngữ_QUỐCGIA, ví dụ vi_VN.');
    if (t(s.canonical) && t(o.url) && s.canonical.trim() !== o.url.trim()) {
      if (isHttps(s.canonical) !== isHttps(o.url)) add('warning', 'Canonical và og:url khác giao thức (http vs https).');
      else add('info', 'og:url khác canonical.');
    }
    if (t(o.image) && isHttps(s.canonical) && isHttp(o.image)) add('warning', 'Canonical là https nhưng og:image là http (không đồng nhất).');
    if (o.type === 'article' && !t(s.article.publishedTime)) add('info', 'og:type=article nhưng chưa có article:published_time.');
    for (const [k, v] of [['article:published_time', s.article.publishedTime], ['article:modified_time', s.article.modifiedTime]] as const) {
      if (o.type === 'article' && t(v) && Number.isNaN(Date.parse(t(v)))) add('warning', `${k} không phải ngày giờ ISO 8601 hợp lệ.`);
    }
  }
  if (s.twitter.enabled) {
    const w = s.twitter;
    const img = t(w.image) || (s.og.enabled ? t(s.og.image) : '');
    if (w.card === 'summary_large_image' && !img) add('warning', 'Twitter Card summary_large_image cần ảnh (twitter:image hoặc og:image).');
    if (t(w.site) && !/^@\w{1,15}$/.test(t(w.site))) add('warning', 'twitter:site nên có dạng @tên_người_dùng.');
    if (t(w.creator) && !/^@\w{1,15}$/.test(t(w.creator))) add('warning', 'twitter:creator nên có dạng @tên_người_dùng.');
    if (t(w.image) && !isAbs(w.image)) add('error', 'twitter:image phải là URL tuyệt đối.');
    if (!t(w.site)) add('info', 'Chưa có twitter:site.');
  }
  const seen = new Set<string>();
  for (const a of s.alternates) {
    const h = t(a.hreflang).toLowerCase();
    if (!h && !t(a.href)) continue;
    if (!h || !t(a.href)) add('warning', 'Một dòng hreflang thiếu mã ngôn ngữ hoặc URL.');
    if (h && !/^(x-default|[a-z]{2,3}(-[a-z0-9]{2,8})*)$/i.test(h)) add('warning', `hreflang "${a.hreflang}" không đúng định dạng (vd vi, en-US, x-default).`);
    if (h && seen.has(h)) add('error', `hreflang "${h}" bị trùng.`);
    seen.add(h);
    if (t(a.href) && !isAbs(a.href)) add('error', `hreflang ${h || '?'}: URL phải tuyệt đối.`);
  }
  if (seen.size > 0 && !seen.has('x-default')) add('info', 'Nên có hreflang="x-default" cho trang chọn ngôn ngữ/mặc định.');
  const pc = new Set<string>();
  for (const p of s.preconnect) {
    if (!t(p.href)) continue;
    if (!/^https?:\/\/[^/\s]+\/?$/.test(t(p.href))) add('warning', `preconnect "${p.href}" nên chỉ gồm origin (https://host).`);
    if (pc.has(t(p.href))) add('warning', `preconnect "${p.href}" bị trùng.`);
    pc.add(t(p.href));
  }
  if (pc.size > 4) add('info', 'Quá nhiều preconnect (> 4) có thể làm chậm tải trang.');
  for (const b of s.jsonld) {
    const req = JSONLD_REQUIRED[b.type] || [];
    const miss = req.filter((k) => !(b.f[k] || '').trim());
    const built = buildJsonLd(b);
    if (!built) add('warning', `JSON-LD ${b.type} đang trống.`);
    else if (miss.length) add('warning', `JSON-LD ${b.type} thiếu trường nên có: ${miss.join(', ')}.`);
    if (b.type === 'BreadcrumbList' && b.items.length < 2) add('info', 'BreadcrumbList nên có ít nhất 2 mục.');
    if (b.type === 'WebSite' && b.f.searchUrl && !b.f.searchUrl.includes('{search_term_string}')) add('warning', 'URL tìm kiếm của WebSite nên chứa {search_term_string}.');
    for (const k of ['datePublished', 'dateModified']) {
      if ((b.f[k] || '').trim() && Number.isNaN(Date.parse(b.f[k]))) add('warning', `JSON-LD ${b.type}: ${k} không phải ISO 8601.`);
    }
  }
  if (!out.some((i) => i.severity === 'error' || i.severity === 'warning')) add('ok', 'Không phát hiện lỗi hay cảnh báo.');
  return out;
}

/* ---------------- Phân tích HTML head ---------------- */

/** Phần tử đã phẳng hóa từ DOM (hoặc parse5 khi test). */
export interface FlatEl {
  tag: string;
  attrs: Record<string, string>;
  text: string;
}

export interface AnalyzedHead {
  state: MetaState;
  tags: { tag: string; key: string; value: string }[];
  duplicates: string[];
  jsonLd: { raw: string; valid: boolean; type: string; error?: string }[];
  htmlLang: string;
}

export const MAX_HEAD_HTML = 500_000;

export function analyzeHeadElements(els: FlatEl[], htmlLang = ''): AnalyzedHead {
  const st = defaultMetaState();
  st.viewport = '';
  st.charset = '';
  st.lang = htmlLang || st.lang;
  st.og = { ...st.og, enabled: false, type: '', locale: '' };
  st.twitter = { ...st.twitter, enabled: false };
  const tags: AnalyzedHead['tags'] = [];
  const counts = new Map<string, number>();
  const bump = (k: string) => counts.set(k, (counts.get(k) || 0) + 1);
  const jsonLd: AnalyzedHead['jsonLd'] = [];
  const articleTags: string[] = [];
  let ogSeen = false;
  let twSeen = false;
  for (const el of els) {
    const a = el.attrs;
    if (el.tag === 'title') {
      tags.push({ tag: 'title', key: 'title', value: el.text });
      bump('title');
      if (!st.title) st.title = el.text.trim();
    } else if (el.tag === 'meta') {
      if (a.charset !== undefined) {
        st.charset = a.charset;
        tags.push({ tag: 'meta', key: 'charset', value: a.charset });
        bump('charset');
        continue;
      }
      const key = (a.name ?? a.property ?? a['http-equiv'] ?? '').trim();
      if (!key) continue;
      const lk = key.toLowerCase();
      const v = a.content ?? '';
      tags.push({ tag: 'meta', key, value: v });
      if (lk !== 'article:tag') bump(lk);
      const first = (cur: string) => cur || v;
      if (lk === 'description') st.description = first(st.description);
      else if (lk === 'viewport') st.viewport = first(st.viewport);
      else if (lk === 'theme-color') st.themeColor = first(st.themeColor);
      else if (lk === 'author') st.author = first(st.author);
      else if (lk === 'robots' || lk === 'googlebot') {
        const parts = v.toLowerCase().split(',').map((x) => x.trim());
        if (lk === 'robots') {
          st.robots.index = !(parts.includes('noindex') || parts.includes('none'));
          st.robots.follow = !(parts.includes('nofollow') || parts.includes('none'));
          st.robots.noarchive = parts.includes('noarchive');
          st.robots.nosnippet = parts.includes('nosnippet');
          st.robots.noimageindex = parts.includes('noimageindex');
          st.robots.notranslate = parts.includes('notranslate');
          for (const p of parts) {
            if (p.startsWith('max-snippet:')) st.robots.maxSnippet = p.slice(12);
            if (p.startsWith('max-video-preview:')) st.robots.maxVideoPreview = p.slice(18);
            if (p.startsWith('max-image-preview:')) {
              const m = p.slice(18);
              if (m === 'none' || m === 'standard' || m === 'large') st.robots.maxImagePreview = m;
            }
          }
        }
      } else if (lk.startsWith('og:')) {
        ogSeen = true;
        const map: Record<string, keyof MetaState['og']> = {
          'og:title': 'title', 'og:description': 'description', 'og:type': 'type', 'og:url': 'url', 'og:image': 'image', 'og:image:alt': 'imageAlt',
          'og:image:width': 'imageWidth', 'og:image:height': 'imageHeight', 'og:site_name': 'siteName', 'og:locale': 'locale',
        };
        const f = map[lk];
        if (f && !(st.og[f] as string)) (st.og as Record<string, unknown>)[f] = v;
      } else if (lk.startsWith('twitter:')) {
        twSeen = true;
        if (lk === 'twitter:card') st.twitter.card = v === 'summary' ? 'summary' : 'summary_large_image';
        else if (lk === 'twitter:site') st.twitter.site = first(st.twitter.site);
        else if (lk === 'twitter:creator') st.twitter.creator = first(st.twitter.creator);
        else if (lk === 'twitter:title') st.twitter.title = first(st.twitter.title);
        else if (lk === 'twitter:description') st.twitter.description = first(st.twitter.description);
        else if (lk === 'twitter:image') st.twitter.image = first(st.twitter.image);
      } else if (lk === 'article:published_time') st.article.publishedTime = first(st.article.publishedTime);
      else if (lk === 'article:modified_time') st.article.modifiedTime = first(st.article.modifiedTime);
      else if (lk === 'article:author') st.article.author = first(st.article.author);
      else if (lk === 'article:section') st.article.section = first(st.article.section);
      else if (lk === 'article:tag') articleTags.push(v);
    } else if (el.tag === 'link') {
      const rels = (a.rel || '').toLowerCase().split(/\s+/).filter(Boolean);
      const href = a.href ?? '';
      if (!rels.length) continue;
      const rel = rels.join(' ');
      tags.push({ tag: 'link', key: rel + (a.hreflang ? `[${a.hreflang}]` : ''), value: href });
      if (rels.includes('canonical')) {
        bump('canonical');
        if (!st.canonical) st.canonical = href;
      } else if (rels.includes('alternate') && a.hreflang) {
        bump('hreflang:' + a.hreflang.toLowerCase());
        st.alternates.push({ hreflang: a.hreflang, href });
      } else if (rels.includes('apple-touch-icon')) {
        if (!st.appleTouchIcon) st.appleTouchIcon = href;
      } else if (rels.includes('icon')) {
        if (!st.favicon) st.favicon = href;
      } else if (rels.includes('manifest')) {
        if (!st.manifest) st.manifest = href;
      } else if (rels.includes('preconnect')) {
        st.preconnect.push({ href, crossorigin: a.crossorigin !== undefined });
      }
    } else if (el.tag === 'script' && (a.type || '').toLowerCase() === 'application/ld+json') {
      const raw = el.text.trim();
      try {
        const j = JSON.parse(raw);
        const first = Array.isArray(j) ? j[0] : j;
        const g = first && typeof first === 'object' && Array.isArray(first['@graph']) ? first['@graph'][0] : first;
        const ty = g && typeof g === 'object' ? String(Array.isArray(g['@type']) ? g['@type'].join(', ') : g['@type'] ?? '?') : '?';
        jsonLd.push({ raw, valid: true, type: ty });
      } catch (e) {
        jsonLd.push({ raw, valid: false, type: '?', error: e instanceof Error ? e.message : 'JSON lỗi' });
      }
      tags.push({ tag: 'script', key: 'ld+json', value: raw.slice(0, 120) });
    }
  }
  st.og.enabled = ogSeen;
  st.twitter.enabled = twSeen;
  st.article.tags = articleTags.join(', ');
  const duplicates: string[] = [];
  for (const [k, n] of counts) {
    if (n > 1) duplicates.push(`${k} (xuất hiện ${n} lần)`);
  }
  return { state: st, tags, duplicates, jsonLd, htmlLang };
}

/** Kiểm tra bổ sung cho kết quả phân tích: trùng thẻ, JSON-LD lỗi. */
export function auditAnalyzed(r: AnalyzedHead): Issue[] {
  const base = validateMeta(r.state).filter((i) => i.severity !== 'ok');
  const extra: Issue[] = [];
  for (const d of r.duplicates) extra.push({ severity: 'error', message: `Thẻ trùng lặp: ${d}.` });
  for (const j of r.jsonLd) if (!j.valid) extra.push({ severity: 'error', message: `JSON-LD không phải JSON hợp lệ: ${j.error}` });
  if (!r.htmlLang) extra.push({ severity: 'info', message: 'Không có thuộc tính lang trên <html> (hoặc chỉ dán phần <head>).' });
  const all = [...extra, ...base];
  if (!all.some((i) => i.severity === 'error' || i.severity === 'warning')) all.push({ severity: 'ok', message: 'Không phát hiện lỗi hay cảnh báo.' });
  return all;
}
