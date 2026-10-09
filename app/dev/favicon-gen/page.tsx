'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppWindow,
  Upload,
  Download,
  Copy,
  Check,
  Trash2,
  ImageIcon,
  Type,
  Code2,
  AlertTriangle,
  Moon,
  Loader2,
} from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Select } from '@/components/ui/searchable-select';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  FILE_DEFS,
  ICO_SIZES,
  MAX_INPUT_BYTES,
  SAFARI_PINNED_NOTE,
  SAMPLE_SVG,
  buildBrowserConfig,
  buildHeadSnippet,
  buildManifest,
  clampGraphemes,
  encodeIco,
  fitRect,
  formatBytes,
  gradientLine,
  isHexColor,
  isIncluded,
  maskableBox,
  nextjsNote,
  normalizeSvg,
  shapeRadius,
  sourceWarnings,
  stepSizes,
  vitePublicNote,
  type FileId,
  type FitMode,
  type IconShape,
  type PackOptions,
} from '@/lib/favicon-gen';

// ───────────── kiểu & hằng ─────────────

type Tab = 'image' | 'text' | 'svg';
type Quality = 'high' | 'medium' | 'low' | 'pixel';

interface Src {
  img: HTMLImageElement;
  w: number;
  h: number;
  vector: boolean;
  name: string;
  url: string;
  svgText?: string;
}

interface TextOpts {
  text: string;
  weight: number;
  family: string;
  color: string;
  gradient: boolean;
  bg1: string;
  bg2: string;
  angle: number;
  shape: IconShape;
}

interface RenderOpts {
  kind: 'image' | 'text';
  src: Src | null;
  fit: FitMode;
  zoom: number;
  panX: number;
  panY: number;
  radius: number;
  fitBgOn: boolean;
  fitBg: string;
  bgOpaque: string;
  text: TextOpts;
  quality: Quality;
}

type Variant = 'any' | 'opaque' | 'maskable';

const EMOJI_SUFFIX = ', "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';
const FAMILIES: { id: string; label: string; stack: string }[] = [
  { id: 'sans', label: 'Sans (hệ thống)', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  { id: 'serif', label: 'Serif', stack: 'Georgia, "Times New Roman", "Noto Serif", serif' },
  { id: 'mono', label: 'Monospace', stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  { id: 'rounded', label: 'Bo tròn', stack: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif' },
  { id: 'display', label: 'Đậm / Impact', stack: 'Impact, "Arial Black", "Helvetica Neue", sans-serif' },
];
const EMOJIS = ['🚀', '😀', '⭐', '🔥', '💡', '🛒', '📷', '🎵', '🌿', '❤️'];
const MASTER = 1024;
const PREVIEW_MASTER = 512;

const inputCls =
  'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-hidden focus:border-indigo-400';
const btnCls =
  'px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1.5 disabled:opacity-50';
const panel = 'bg-white rounded-xl border border-slate-200 p-4 space-y-3 shadow-xs';
const labelCls = 'text-xs font-semibold text-slate-600';

// ───────────── vẽ canvas ─────────────

function makeCanvas(w: number, h = w): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function setSmoothing(ctx: CanvasRenderingContext2D, q: Quality) {
  if (q === 'pixel') {
    ctx.imageSmoothingEnabled = false;
  } else {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = q === 'high' ? 'high' : q === 'medium' ? 'medium' : 'low';
  }
}

/** Thu nhỏ từng bậc (mỗi bước tối đa 1/2) để tránh răng cưa; trả về canvas cuối. */
function downscale(master: HTMLCanvasElement, target: number, q: Quality): HTMLCanvasElement {
  if (master.width === target) return master;
  const steps = q === 'high' ? stepSizes(master.width, target) : [target];
  let cur: HTMLCanvasElement = master;
  for (const s of steps) {
    const c = makeCanvas(s);
    const ctx = c.getContext('2d');
    if (!ctx) break;
    setSmoothing(ctx, q);
    ctx.drawImage(cur, 0, 0, s, s);
    cur = c;
  }
  return cur;
}

/** Thu nhỏ ảnh nguồn rất lớn từng bậc trước khi vẽ. */
function shrinkSource(src: Src, destMax: number, q: Quality): { el: CanvasImageSource; w: number; h: number } {
  if (src.vector || q !== 'high') return { el: src.img, w: src.w, h: src.h };
  let el: CanvasImageSource = src.img;
  let w = src.w;
  let h = src.h;
  while (Math.max(w, h) / 2 > destMax) {
    const nw = Math.floor(w / 2);
    const nh = Math.floor(h / 2);
    const c = makeCanvas(nw, nh);
    const ctx = c.getContext('2d');
    if (!ctx) break;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(el, 0, 0, nw, nh);
    el = c;
    w = nw;
    h = nh;
  }
  return { el, w, h };
}

function paintTextBg(ctx: CanvasRenderingContext2D, S: number, t: TextOpts) {
  if (t.gradient) {
    const g = gradientLine(S, t.angle);
    const lg = ctx.createLinearGradient(g.x0, g.y0, g.x1, g.y1);
    lg.addColorStop(0, t.bg1);
    lg.addColorStop(1, t.bg2);
    ctx.fillStyle = lg;
  } else {
    ctx.fillStyle = t.bg1;
  }
  ctx.fillRect(0, 0, S, S);
}

function drawText(ctx: CanvasRenderingContext2D, S: number, t: TextOpts, scale: number) {
  const chars = Array.from(t.text);
  if (!t.text.trim()) return;
  const fam = (FAMILIES.find((f) => f.id === t.family) ?? FAMILIES[0]).stack + EMOJI_SUFFIX;
  const n = chars.length;
  let px = S * scale * (n <= 1 ? 0.64 : n === 2 ? 0.5 : 0.38);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${t.weight} ${px}px ${fam}`;
  const maxW = S * scale * 0.84;
  const w = ctx.measureText(t.text).width;
  if (w > maxW && w > 0) {
    px = px * (maxW / w);
    ctx.font = `${t.weight} ${px}px ${fam}`;
  }
  const m = ctx.measureText(t.text);
  const asc = m.actualBoundingBoxAscent || px * 0.72;
  const desc = m.actualBoundingBoxDescent || 0;
  ctx.fillStyle = t.color;
  ctx.fillText(t.text, S / 2, S / 2 + (asc - desc) / 2);
}

function renderMaster(S: number, variant: Variant, o: RenderOpts): HTMLCanvasElement {
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  setSmoothing(ctx, o.quality);

  if (o.kind === 'text') {
    ctx.save();
    if (variant === 'any') {
      roundRectPath(ctx, 0, 0, S, S, shapeRadius(o.text.shape) * S);
      ctx.clip();
    }
    paintTextBg(ctx, S, o.text);
    drawText(ctx, S, o.text, variant === 'maskable' ? 0.8 : 1);
    ctx.restore();
    return c;
  }

  const fitFill = o.fit === 'contain' && o.fitBgOn ? o.fitBg : null;
  if (variant === 'any') {
    ctx.save();
    roundRectPath(ctx, 0, 0, S, S, o.radius * S);
    ctx.clip();
    if (fitFill) {
      ctx.fillStyle = fitFill;
      ctx.fillRect(0, 0, S, S);
    }
    drawSrc(ctx, o, S, 0, S);
    ctx.restore();
  } else if (variant === 'opaque') {
    ctx.fillStyle = fitFill ?? o.bgOpaque;
    ctx.fillRect(0, 0, S, S);
    drawSrc(ctx, o, S, 0, S);
  } else {
    ctx.fillStyle = fitFill ?? o.bgOpaque;
    ctx.fillRect(0, 0, S, S);
    const { offset, inner } = maskableBox(S);
    ctx.save();
    ctx.beginPath();
    ctx.rect(offset, offset, inner, inner);
    ctx.clip();
    drawSrc(ctx, o, inner, offset, S);
    ctx.restore();
  }
  return c;
}

function drawSrc(ctx: CanvasRenderingContext2D, o: RenderOpts, box: number, offset: number, canvasSize: number) {
  if (!o.src) return;
  void canvasSize;
  const sh = shrinkSource(o.src, box * Math.max(1, o.zoom) * 1.5, o.quality);
  const r = fitRect(sh.w, sh.h, box, o.fit, o.zoom, o.panX, o.panY);
  ctx.drawImage(sh.el, offset + r.dx, offset + r.dy, r.dw, r.dh);
}

function canvasToBytes(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => {
      if (!b) return reject(new Error('Không tạo được PNG từ canvas.'));
      b.arrayBuffer().then((ab) => resolve(new Uint8Array(ab)), reject);
    }, 'image/png');
  });
}

// ───────────── component nhỏ ─────────────

function CanvasView({
  canvas,
  size,
  className = '',
  style,
}: {
  canvas: HTMLCanvasElement | null;
  size: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !canvas) return;
    el.width = canvas.width;
    el.height = canvas.height;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.drawImage(canvas, 0, 0);
  }, [canvas]);
  return <canvas ref={ref} className={className} style={{ width: size, height: size, ...style }} />;
}

const CHECKER: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg,#cbd5e1 25%,transparent 25%),linear-gradient(-45deg,#cbd5e1 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#cbd5e1 75%),linear-gradient(-45deg,transparent 75%,#cbd5e1 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
  backgroundColor: '#f1f5f9',
};

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="color"
        value={isHexColor(value) ? value : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-9 rounded-sm border border-slate-200 bg-white p-0.5 cursor-pointer"
        aria-label={label}
      />
      <span className="text-xs text-slate-600">
        {label} <span className="font-mono text-slate-400">{value}</span>
      </span>
    </label>
  );
}

function CopyBlock({ title, text, onCopy, copied }: { title: string; text: string; onCopy: () => void; copied: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className={labelCls}>{title}</span>
        <button onClick={onCopy} className={btnCls}>
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Đã chép' : 'Sao chép'}
        </button>
      </div>
      <pre className="bg-slate-900 text-slate-100 text-xs rounded-lg p-3 overflow-x-auto whitespace-pre font-mono">
        {text}
      </pre>
    </div>
  );
}

// ───────────── trang ─────────────

export default function FaviconGenPage() {
  const { showToast } = useApp();

  const [tab, setTab] = useState<Tab>('text');
  const [imgSrc, setImgSrc] = useState<Src | null>(null);
  const [svgSrc, setSvgSrc] = useState<Src | null>(null);
  const [darkSrc, setDarkSrc] = useState<Src | null>(null);
  const [darkOn, setDarkOn] = useState(false);
  const [svgCode, setSvgCode] = useState(SAMPLE_SVG);
  const [svgError, setSvgError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [fit, setFit] = useState<FitMode>('cover');
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [radius, setRadius] = useState(0);
  const [fitBgOn, setFitBgOn] = useState(false);
  const [fitBg, setFitBg] = useState('#ffffff');

  const [text, setText] = useState<TextOpts>({
    text: 'Ab',
    weight: 700,
    family: 'sans',
    color: '#ffffff',
    gradient: true,
    bg1: '#6366f1',
    bg2: '#22d3ee',
    angle: 135,
    shape: 'rounded',
  });

  const [appName, setAppName] = useState('Ứng dụng của tôi');
  const [shortName, setShortName] = useState('Ứng dụng');
  const [themeColor, setThemeColor] = useState('#4f46e5');
  const [bgOpaque, setBgOpaque] = useState('#ffffff');
  const [basePath, setBasePath] = useState('/');
  const [quality, setQuality] = useState<Quality>('high');
  const [include, setInclude] = useState<Record<FileId, boolean>>(
    () => Object.fromEntries(FILE_DEFS.map((d) => [d.id, d.defaultOn])) as Record<FileId, boolean>
  );
  const [copied, setCopied] = useState('');
  const [busy, setBusy] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const darkFileRef = useRef<HTMLInputElement>(null);
  const urls = useRef<Set<string>>(new Set());
  const svgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const svgSeq = useRef(0);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const revoke = useCallback((u?: string) => {
    if (!u) return;
    URL.revokeObjectURL(u);
    urls.current.delete(u);
  }, []);

  useEffect(() => {
    const set = urls.current;
    return () => {
      set.forEach((u) => URL.revokeObjectURL(u));
      set.clear();
      if (svgTimer.current) clearTimeout(svgTimer.current);
    };
  }, []);

  // đọc cấu hình từ link chia sẻ
  useEffect(() => {
    const p = readShareParams();
    const t = setTimeout(() => {
      const tb = p.get('tab');
      if (tb === 'image' || tb === 'text' || tb === 'svg') setTab(tb === 'image' ? 'text' : tb);
      const nm = p.get('name');
      if (nm) setAppName(nm.slice(0, 60));
      const sn = p.get('short');
      if (sn) setShortName(sn.slice(0, 12));
      const th = p.get('theme');
      if (th && isHexColor(th)) setThemeColor(th);
      const bg = p.get('bg');
      if (bg && isHexColor(bg)) setBgOpaque(bg);
      const tx = p.get('text');
      const c1 = p.get('c1');
      const c2 = p.get('c2');
      const tc = p.get('tc');
      const shape = p.get('shape');
      const fam = p.get('fam');
      setText((prev) => ({
        ...prev,
        text: tx ? clampGraphemes(tx, 3) : prev.text,
        bg1: c1 && isHexColor(c1) ? c1 : prev.bg1,
        bg2: c2 && isHexColor(c2) ? c2 : prev.bg2,
        color: tc && isHexColor(tc) ? tc : prev.color,
        shape: shape === 'square' || shape === 'rounded' || shape === 'circle' ? shape : prev.shape,
        family: fam && FAMILIES.some((f) => f.id === fam) ? fam : prev.family,
      }));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // ───── nạp ảnh ─────
  const loadImage = useCallback((url: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode'));
      img.src = url;
    });
  }, []);

  const loadFile = useCallback(
    async (file: File, target: 'main' | 'dark') => {
      if (file.size > MAX_INPUT_BYTES) {
        showToast(`File quá lớn (${formatBytes(file.size)}). Tối đa 15 MB.`);
        return;
      }
      const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
      if (!isSvg && !/^image\/(png|jpe?g|webp|gif|bmp|avif)$/.test(file.type)) {
        showToast('Định dạng không được hỗ trợ. Hãy dùng PNG, JPG, WebP hoặc SVG.');
        return;
      }
      setLoading(true);
      let url = '';
      try {
        let svgText: string | undefined;
        let w = 0;
        let h = 0;
        if (isSvg) {
          const norm = normalizeSvg(await file.text());
          if (!norm.ok) throw new Error(norm.error);
          svgText = norm.text;
          w = norm.width;
          h = norm.height;
          url = URL.createObjectURL(new Blob([norm.text], { type: 'image/svg+xml' }));
        } else {
          url = URL.createObjectURL(file);
        }
        urls.current.add(url);
        const img = await loadImage(url);
        if (!isSvg) {
          w = img.naturalWidth;
          h = img.naturalHeight;
        }
        if (!(w > 0) || !(h > 0)) throw new Error('decode');
        const s: Src = { img, w, h, vector: isSvg, name: file.name, url, svgText };
        if (target === 'dark') {
          revoke(darkSrc?.url);
          setDarkSrc(s);
        } else {
          revoke(imgSrc?.url);
          setImgSrc(s);
          setPanX(0);
          setPanY(0);
          setZoom(1);
          setTab('image');
        }
      } catch (e) {
        revoke(url);
        const msg = e instanceof Error && e.message !== 'decode' ? e.message : 'Không giải mã được ảnh. File có thể bị hỏng.';
        showToast(msg);
      } finally {
        setLoading(false);
      }
    },
    [darkSrc, imgSrc, loadImage, revoke, showToast]
  );

  // dán ảnh từ clipboard
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of Array.from(items)) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            void loadFile(f, 'main');
            return;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [loadFile]);

  // giải mã SVG code (debounce)
  const decodeSvg = useCallback(
    async (code: string) => {
      const seq = ++svgSeq.current;
      const norm = normalizeSvg(code);
      if (!norm.ok) {
        setSvgError(norm.error);
        setSvgSrc((prev) => {
          revoke(prev?.url);
          return null;
        });
        return;
      }
      const url = URL.createObjectURL(new Blob([norm.text], { type: 'image/svg+xml' }));
      urls.current.add(url);
      try {
        const img = await loadImage(url);
        if (seq !== svgSeq.current) {
          revoke(url);
          return;
        }
        setSvgError('');
        setSvgSrc((prev) => {
          revoke(prev?.url);
          return { img, w: norm.width, h: norm.height, vector: true, name: 'favicon.svg', url, svgText: norm.text };
        });
      } catch {
        revoke(url);
        if (seq === svgSeq.current) setSvgError('SVG không hợp lệ hoặc trình duyệt không vẽ được (kiểm tra cú pháp XML).');
      }
    },
    [loadImage, revoke]
  );

  const scheduleSvg = useCallback(
    (code: string, delay = 400) => {
      if (svgTimer.current) clearTimeout(svgTimer.current);
      svgTimer.current = setTimeout(() => void decodeSvg(code), delay);
    },
    [decodeSvg]
  );

  useEffect(() => {
    scheduleSvg(SAMPLE_SVG, 0);
  }, [scheduleSvg]);

  // ───── render ─────
  const activeSrc = tab === 'svg' ? svgSrc : imgSrc;
  const kind: 'image' | 'text' = tab === 'text' ? 'text' : 'image';

  const renderOpts: RenderOpts = useMemo(
    () => ({
      kind,
      src: activeSrc,
      fit,
      zoom,
      panX,
      panY,
      radius,
      fitBgOn,
      fitBg,
      bgOpaque,
      text,
      quality,
    }),
    [kind, activeSrc, fit, zoom, panX, panY, radius, fitBgOn, fitBg, bgOpaque, text, quality]
  );

  const hasContent = kind === 'text' ? text.text.trim().length > 0 : !!activeSrc;
  const darkReady = darkOn && !!darkSrc;
  const svgSource: string | null = tab === 'svg' ? svgSrc?.svgText ?? null : tab === 'image' ? imgSrc?.svgText ?? null : null;

  // Canvas chỉ tồn tại ở trình duyệt: chỉ dựng bản xem trước sau khi mount để HTML server và client khớp nhau
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const previews = useMemo(() => {
    if (!mounted || !hasContent) return null;
    try {
      const any = renderMaster(PREVIEW_MASTER, 'any', renderOpts);
      const opaque = renderMaster(PREVIEW_MASTER, 'opaque', renderOpts);
      const mask = renderMaster(PREVIEW_MASTER, 'maskable', renderOpts);
      const q = renderOpts.quality;
      const dark = darkReady
        ? downscale(renderMaster(PREVIEW_MASTER, 'any', { ...renderOpts, kind: 'image', src: darkSrc }), 32, q)
        : null;
      return {
        edit: renderMaster(256, 'any', renderOpts),
        s16: downscale(any, 16, q),
        s32: downscale(any, 32, q),
        dark32: dark,
        s150: downscale(any, 150, q),
        apple: downscale(opaque, 180, q),
        mask: downscale(mask, 192, q),
      };
    } catch {
      return null;
    }
  }, [mounted, hasContent, renderOpts, darkReady, darkSrc]);

  // ───── tùy chọn gói ─────
  const packOpts: PackOptions = {
    appName,
    shortName,
    themeColor,
    backgroundColor: bgOpaque,
    basePath,
    include,
    hasSvg: !!svgSource,
    hasDark: darkReady,
  };
  const headSnippet = buildHeadSnippet(packOpts);
  const manifestText = buildManifest(packOpts);
  const nextNote = nextjsNote(packOpts);
  const viteNote = vitePublicNote(packOpts);

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      showToast('Đã sao chép!');
      setTimeout(() => setCopied((c) => (c === key ? '' : c)), 1500);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const download = async () => {
    if (!hasContent) {
      showToast('Chưa có nguồn icon để tạo gói.');
      return;
    }
    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 20));
      const q = renderOpts.quality;
      const masters: Partial<Record<Variant, HTMLCanvasElement>> = {};
      const master = (v: Variant) => (masters[v] ??= renderMaster(MASTER, v, renderOpts));
      const zip = new JSZip();
      const pngs = new Map<number, Uint8Array>();
      const pngFor = async (size: number) => {
        let b = pngs.get(size);
        if (!b) {
          b = await canvasToBytes(downscale(master('any'), size, q));
          pngs.set(size, b);
        }
        return b;
      };
      let count = 0;
      for (const d of FILE_DEFS) {
        if (!isIncluded(packOpts, d.id)) continue;
        if (d.id === 'ico') {
          const imgs = [];
          for (const s of ICO_SIZES) imgs.push({ size: s, data: await pngFor(s) });
          zip.file(d.name, encodeIco(imgs));
        } else if (d.id === 'manifest') {
          zip.file(d.name, manifestText);
        } else if (d.id === 'browserconfig') {
          zip.file(d.name, buildBrowserConfig(packOpts));
        } else if (d.id === 'svg') {
          if (svgSource) zip.file(d.name, svgSource);
        } else if (d.id === 'dark32') {
          if (darkSrc) {
            const dm = renderMaster(MASTER, 'any', { ...renderOpts, kind: 'image', src: darkSrc });
            zip.file(d.name, await canvasToBytes(downscale(dm, 32, q)));
          }
        } else if (d.size && d.variant) {
          if (d.variant === 'any') zip.file(d.name, await pngFor(d.size));
          else zip.file(d.name, await canvasToBytes(downscale(master(d.variant), d.size, q)));
        }
        count++;
      }
      zip.file('head-snippet.html', headSnippet + '\n');
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      saveAs(blob, 'favicon-pack.zip');
      showToast(`Đã tạo gói ${count} file.`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Không tạo được gói favicon.');
    } finally {
      setBusy(false);
    }
  };

  // ───── pan trên preview ─────
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (tab === 'text' || !activeSrc) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: panX, py: panY };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const box = e.currentTarget.getBoundingClientRect().width || 256;
    setPanX(Math.max(-2, Math.min(2, d.px + (e.clientX - d.x) / box)));
    setPanY(Math.max(-2, Math.min(2, d.py + (e.clientY - d.y) / box)));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const warnings = tab !== 'text' && activeSrc ? sourceWarnings(activeSrc.w, activeSrc.h, activeSrc.vector) : [];
  const set = <K extends keyof TextOpts>(k: K, v: TextOpts[K]) => setText((t) => ({ ...t, [k]: v }));

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'image', label: 'Tải ảnh', icon: <ImageIcon className="h-3.5 w-3.5" /> },
    { id: 'text', label: 'Từ chữ / emoji', icon: <Type className="h-3.5 w-3.5" /> },
    { id: 'svg', label: 'Từ SVG code', icon: <Code2 className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AppWindow className="h-5 w-5 text-indigo-300" />
          <h1 className="text-sm font-bold">Favicon & App Icon</h1>
          <span className="text-xs text-slate-400 hidden sm:inline">Tạo bộ icon cho web/PWA ngay trên trình duyệt</span>
        </div>
        <ShareLinkButton
          params={{
            tab,
            name: appName,
            short: shortName,
            theme: themeColor,
            bg: bgOpaque,
            text: tab === 'text' ? text.text : undefined,
            c1: text.bg1,
            c2: text.bg2,
            tc: text.color,
            shape: text.shape,
            fam: text.family,
          }}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ───── Nguồn ───── */}
        <div className={panel}>
          <div className="flex gap-1 flex-wrap">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition ${
                  tab === t.id
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'image' && (
            <div className="space-y-3">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) void loadFile(f, 'main');
                }}
                className={`border-2 border-dashed rounded-xl p-4 text-center text-sm text-slate-500 transition ${
                  dragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300'
                }`}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Đang đọc ảnh...
                  </span>
                ) : (
                  <>
                    <p>Kéo thả, dán (Ctrl+V) hoặc chọn ảnh PNG / JPG / WebP / SVG (tối đa 15 MB).</p>
                    <button onClick={() => fileRef.current?.click()} className={`${btnCls} mx-auto mt-2`}>
                      <Upload className="h-3.5 w-3.5" /> Chọn file
                    </button>
                  </>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void loadFile(f, 'main');
                    e.target.value = '';
                  }}
                />
              </div>
              {imgSrc && (
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="truncate">
                    {imgSrc.name} - {imgSrc.w}×{imgSrc.h}
                  </span>
                  <button
                    onClick={() => {
                      revoke(imgSrc.url);
                      setImgSrc(null);
                    }}
                    className="p-1 text-slate-400 hover:text-red-600"
                    title="Xóa ảnh"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'svg' && (
            <div className="space-y-2">
              <textarea ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; } }}
                value={svgCode}
                onChange={(e) => {
                  setSvgCode(e.target.value);
                  scheduleSvg(e.target.value);
                }}
                spellCheck={false}
                rows={Math.max(14, Math.min(3000, svgCode.split('\n').length + 1))}
                placeholder="<svg xmlns=...>...</svg>"
                className={`${inputCls} font-mono text-xs resize-none overflow-hidden`}
              />
              <p className="text-xs text-slate-500">
                SVG được vẽ qua thẻ &lt;img&gt; (blob URL) nên script bên trong không chạy và không bao giờ chèn vào DOM.
              </p>
              {svgError && (
                <p className="text-xs text-red-600 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> {svgError}
                </p>
              )}
            </div>
          )}

          {tab === 'text' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Chữ / emoji (1–3 ký tự)</label>
                  <input
                    value={text.text}
                    onChange={(e) => set('text', clampGraphemes(e.target.value, 3))}
                    className={inputCls}
                    aria-label="Chữ hoặc emoji"
                  />
                </div>
                <div>
                  <label className={labelCls}>Phông chữ</label>
                  <Select searchThreshold={0} value={text.family} onChange={(e) => set('family', e.target.value)} className={inputCls}>
                    {FAMILIES.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    onClick={() => set('text', e)}
                    className="h-8 w-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-base"
                  >
                    {e}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Độ đậm</label>
                  <Select value={text.weight} onChange={(e) => set('weight', Number(e.target.value))} className={inputCls}>
                    {[400, 600, 700, 900].map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className={labelCls}>Hình dạng</label>
                  <Select value={text.shape} onChange={(e) => set('shape', e.target.value as IconShape)} className={inputCls}>
                    <option value="square">Vuông</option>
                    <option value="rounded">Bo góc</option>
                    <option value="circle">Tròn</option>
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <ColorField label="Màu chữ" value={text.color} onChange={(v) => set('color', v)} />
                <ColorField label={text.gradient ? 'Nền 1' : 'Màu nền'} value={text.bg1} onChange={(v) => set('bg1', v)} />
                {text.gradient && <ColorField label="Nền 2" value={text.bg2} onChange={(v) => set('bg2', v)} />}
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" checked={text.gradient} onChange={(e) => set('gradient', e.target.checked)} />
                  Gradient
                </label>
              </div>
              {text.gradient && (
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  Góc {text.angle}°
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={text.angle}
                    onChange={(e) => set('angle', Number(e.target.value))}
                    className="flex-1"
                  />
                </label>
              )}
            </div>
          )}

          {tab !== 'text' && (
            <>
              {warnings.map((w) => (
                <p key={w} className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {w}
                </p>
              ))}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Chế độ khớp</label>
                  <Select value={fit} onChange={(e) => setFit(e.target.value as FitMode)} className={inputCls}>
                    <option value="cover">Cover (lấp đầy, cắt phần thừa)</option>
                    <option value="contain">Contain (hiện đủ ảnh)</option>
                  </Select>
                </div>
                <label className="text-xs text-slate-600 flex flex-col gap-1">
                  <span className={labelCls}>Thu phóng {Math.round(zoom * 100)}%</span>
                  <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
                </label>
              </div>
              {fit === 'contain' && (
                <div className="flex items-center gap-4 flex-wrap">
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input type="checkbox" checked={!fitBgOn} onChange={(e) => setFitBgOn(!e.target.checked)} />
                    Nền trong suốt
                  </label>
                  {fitBgOn && <ColorField label="Màu nền" value={fitBg} onChange={setFitBg} />}
                </div>
              )}
              <label className="text-xs text-slate-600 flex flex-col gap-1">
                <span className={labelCls}>
                  Bo góc {Math.round(radius * 100)}% {radius >= 0.5 ? '(tròn)' : ''}
                </span>
                <input type="range" min={0} max={0.5} step={0.01} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
              </label>
              <button
                onClick={() => {
                  setPanX(0);
                  setPanY(0);
                  setZoom(1);
                }}
                className={btnCls}
              >
                Đặt lại vị trí
              </button>
            </>
          )}
        </div>

        {/* ───── Xem trước chỉnh sửa + tùy chọn ───── */}
        <div className="space-y-4">
          <div className={panel}>
            <div className="flex items-center justify-between">
              <span className={labelCls}>Xem trước (256px){tab !== 'text' && activeSrc ? ' - kéo để di chuyển' : ''}</span>
            </div>
            <div className="flex justify-center">
              <div
                style={{ ...CHECKER, width: 256, height: 256, touchAction: 'none' }}
                className={`rounded-lg border border-slate-200 overflow-hidden ${tab !== 'text' && activeSrc ? 'cursor-grab active:cursor-grabbing' : ''}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                {previews ? (
                  <CanvasView canvas={previews.edit} size={256} />
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-slate-500 text-center px-6">
                    {tab === 'text' ? 'Nhập chữ hoặc emoji để bắt đầu.' : 'Chưa có ảnh. Hãy tải ảnh hoặc dán SVG.'}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={panel}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Tên ứng dụng</label>
                <input value={appName} onChange={(e) => setAppName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Tên ngắn (≤12)</label>
                <input value={shortName} maxLength={12} onChange={(e) => setShortName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Đường dẫn gốc icon</label>
                <input value={basePath} onChange={(e) => setBasePath(e.target.value)} className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className={labelCls}>Chất lượng thu nhỏ</label>
                <Select value={quality} onChange={(e) => setQuality(e.target.value as Quality)} className={inputCls}>
                  <option value="high">Cao (thu nhỏ từng bậc)</option>
                  <option value="medium">Trung bình</option>
                  <option value="low">Nhanh</option>
                  <option value="pixel">Pixel art (không làm mịn)</option>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <ColorField label="Màu chủ đề" value={themeColor} onChange={setThemeColor} />
              <ColorField label="Màu nền (biến thể đặc)" value={bgOpaque} onChange={setBgOpaque} />
            </div>
            <div className="border-t border-slate-100 pt-3 space-y-2">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <input type="checkbox" checked={darkOn} onChange={(e) => setDarkOn(e.target.checked)} />
                <Moon className="h-3.5 w-3.5" /> Favicon riêng cho chế độ tối (prefers-color-scheme)
              </label>
              {darkOn && (
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <button onClick={() => darkFileRef.current?.click()} className={btnCls}>
                    <Upload className="h-3.5 w-3.5" /> Chọn ảnh thay thế
                  </button>
                  <span className="truncate">{darkSrc ? darkSrc.name : 'Chưa chọn ảnh'}</span>
                  {darkSrc && (
                    <button
                      onClick={() => {
                        revoke(darkSrc.url);
                        setDarkSrc(null);
                      }}
                      className="p-1 text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <input
                    ref={darkFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void loadFile(f, 'dark');
                      e.target.value = '';
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ───── Xem trước thực tế ───── */}
      <div className={panel}>
        <h2 className="text-sm font-bold text-slate-800">Xem trước kích thước thực</h2>
        {!previews ? (
          <p className="text-xs text-slate-500">Chưa có icon để xem trước.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Tab trình duyệt */}
            <div className="space-y-2">
              <span className={labelCls}>Tab trình duyệt</span>
              {(['light', 'dark'] as const).map((m) => (
                <div
                  key={m}
                  className={`rounded-lg p-2 border ${m === 'light' ? 'bg-slate-200 border-slate-300' : 'bg-[#202124] border-slate-700'}`}
                >
                  <div
                    className={`flex items-center gap-2 rounded-t-lg px-2.5 py-1.5 w-44 ${
                      m === 'light' ? 'bg-white text-slate-700' : 'bg-[#35363a] text-slate-200'
                    }`}
                  >
                    <CanvasView canvas={m === 'dark' && previews.dark32 ? previews.dark32 : previews.s16} size={16} />
                    <span className="text-xs truncate">{appName || 'Ứng dụng'}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 px-1">
                    <CanvasView canvas={m === 'dark' && previews.dark32 ? previews.dark32 : previews.s32} size={32} />
                    <span className={`text-[10px] ${m === 'light' ? 'text-slate-600' : 'text-slate-400'}`}>16px &amp; 32px</span>
                  </div>
                </div>
              ))}
            </div>
            {/* iOS */}
            <div className="space-y-2">
              <span className={labelCls}>Màn hình chính iOS</span>
              <div className="rounded-xl p-3 bg-linear-to-br from-sky-400 to-indigo-500 flex flex-col items-center gap-1">
                <CanvasView canvas={previews.apple} size={60} className="shadow-md" style={{ borderRadius: '22.5%' }} />
                <span className="text-[10px] text-white font-medium truncate max-w-24">{shortName || appName}</span>
              </div>
            </div>
            {/* Android */}
            <div className="space-y-2">
              <span className={labelCls}>Android (mask thích ứng)</span>
              <div className="rounded-xl p-3 bg-slate-800 flex items-end justify-around">
                {[
                  { r: '50%', l: 'Tròn' },
                  { r: '32%', l: 'Squircle' },
                ].map((s) => (
                  <div key={s.l} className="flex flex-col items-center gap-1">
                    <CanvasView canvas={previews.mask} size={56} style={{ borderRadius: s.r }} />
                    <span className="text-[10px] text-slate-300">{s.l}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Windows */}
            <div className="space-y-2">
              <span className={labelCls}>Ô Windows</span>
              <div
                className="rounded-md w-32 h-32 flex flex-col items-center justify-center relative mx-auto"
                style={{ backgroundColor: themeColor }}
              >
                <CanvasView canvas={previews.s150} size={64} />
                <span className="absolute left-2 bottom-1.5 text-[10px] text-white font-medium truncate max-w-28">
                  {shortName || appName}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ───── Các file ───── */}
      <div className={panel}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-800">Các file trong gói</h2>
          <button
            onClick={() => void download()}
            disabled={!hasContent || busy}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition flex items-center gap-1.5"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Tải ZIP
          </button>
        </div>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {FILE_DEFS.map((d) => {
            const unavailable = (d.id === 'svg' && !svgSource) || (d.id === 'dark32' && !darkReady);
            return (
              <label
                key={d.id}
                className={`flex items-start gap-2 text-xs ${unavailable ? 'opacity-50' : ''}`}
                title={unavailable ? d.desc : undefined}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={include[d.id] && !unavailable}
                  disabled={unavailable}
                  onChange={(e) => setInclude((p) => ({ ...p, [d.id]: e.target.checked }))}
                />
                <span>
                  <span className="font-mono text-slate-800">{d.name}</span>
                  <span className="text-slate-500"> - {d.desc}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="text-xs text-slate-500">{SAFARI_PINNED_NOTE}</p>
        <p className="text-xs text-slate-500">
          Mẹo: icon nhỏ 16px nên dùng hình đơn giản, tương phản cao, ít chi tiết. Gói ZIP còn kèm head-snippet.html.
        </p>
      </div>

      {/* ───── Mã ───── */}
      <div className={panel}>
        <CopyBlock title="Snippet <head>" text={headSnippet} copied={copied === 'head'} onCopy={() => void copy('head', headSnippet)} />
        <CopyBlock title="site.webmanifest" text={manifestText} copied={copied === 'man'} onCopy={() => void copy('man', manifestText)} />
        <div className="grid md:grid-cols-2 gap-3">
          <CopyBlock title="Next.js (app/)" text={nextNote} copied={copied === 'next'} onCopy={() => void copy('next', nextNote)} />
          <CopyBlock title="Vite / CRA (public/)" text={viteNote} copied={copied === 'vite'} onCopy={() => void copy('vite', viteNote)} />
        </div>
      </div>
    </div>
  );
}
