'use client';

import { Select } from '@/components/ui/searchable-select';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ImagePlus,
  Upload,
  Download,
  Copy,
  Check,
  Trash2,
  RotateCcw,
  AlertTriangle,
  Loader2,
  Shield,
  Archive,
  Dices,
} from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  CODE_CARD_BG,
  CODE_LANGS,
  DEFAULT_SETTINGS,
  EMOJI_FONTS,
  FONT_STACKS,
  FORMAT_INFO,
  MINIMAL_BG,
  OG_SIZES,
  PATTERN_KINDS,
  TEMPLATES,
  WCAG_AA,
  buildMetaSnippet,
  checkImageUrl,
  clipTokenLine,
  coverRect,
  containRect,
  exportWarnings,
  fitText,
  formatBytes,
  generatePattern,
  getSize,
  gradientLine,
  gradientStops,
  isHexColor,
  langColor,
  mixHex,
  parseTopics,
  pickTextColor,
  resolveTextColor,
  safeZones,
  sanitizeSettings,
  slugify,
  splitGraphemes,
  tokenizeCode,
  withAlpha,
  wrapText,
  type Align,
  type BgType,
  type CodeLang,
  type ExportFormat,
  type FontId,
  type LogoShape,
  type OgSettings,
  type PatternKind,
  type PhotoLayout,
  type Rect,
  type SizeId,
  type TemplateId,
  type TokType,
} from '@/lib/og-image';

// ───────────── hằng & style ─────────────

const STORAGE_KEY = 'getools:og-image:v1';
const MAX_UPLOAD = 15 * 1024 * 1024;
const MAX_SOURCE_DIM = 2400;
const PREVIEW_MAX_H = 540;
const EMOJIS = ['🚀', '✨', '🔥', '💡', '📦', '🎉', '⭐', '❤️', '🇻🇳'];

const inputCls =
  'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-hidden focus:border-indigo-400';
const btnCls =
  'px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1.5 disabled:opacity-50';
const primaryBtn =
  'px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition flex items-center gap-1.5';
const panel = 'bg-white rounded-xl border border-slate-200 p-4 space-y-3 shadow-xs';
const labelCls = 'text-xs font-semibold text-slate-600';
const h2Cls = 'text-sm font-bold text-slate-800';

interface Img {
  src: HTMLCanvasElement;
  w: number;
  h: number;
  name: string;
}
interface Assets {
  bg: Img | null;
  logo: Img | null;
}

// ───────────── vẽ canvas ─────────────

type Ctx = CanvasRenderingContext2D;

let measureCtx: Ctx | null = null;
function measure(text: string, font: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 10;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

interface Env {
  ctx: Ctx;
  s: OgSettings;
  A: Assets;
  w: number;
  h: number;
  u: number;
  pad: number;
  tc: string;
  fam: string;
  mono: string;
  font: (size: number, weight?: number) => string;
}

function oneLine(text: string, maxW: number, font: string): string {
  return wrapText(text, { maxWidth: Math.max(10, maxW), font, measure, maxLines: 1 }).lines[0] ?? '';
}

function drawTextAt(ctx: Ctx, text: string, x: number, y: number, align: CanvasTextAlign = 'left') {
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

function drawCoverImage(ctx: Ctx, img: Img, r: Rect, blur: number) {
  const cr = coverRect(img.w, img.h, r.w, r.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  if (blur > 0) {
    const k = 1 + blur * 0.6;
    const sw = Math.max(8, Math.round(r.w / k));
    const sh = Math.max(8, Math.round(r.h / k));
    const tmp = document.createElement('canvas');
    tmp.width = sw;
    tmp.height = sh;
    const t = tmp.getContext('2d');
    if (t) {
      t.imageSmoothingEnabled = true;
      t.imageSmoothingQuality = 'high';
      t.drawImage(img.src, cr.x / k, cr.y / k, cr.w / k, cr.h / k);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tmp, r.x, r.y, r.w, r.h);
    }
  } else {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img.src, r.x + cr.x, r.y + cr.y, cr.w, cr.h);
  }
  ctx.restore();
}

function paintGradient(ctx: Ctx, r: Rect, s: OgSettings, count: 1 | 2 | 3) {
  if (count === 1) {
    ctx.fillStyle = s.c1;
  } else {
    const g = gradientLine(r.w, r.h, s.angle);
    const lg = ctx.createLinearGradient(r.x + g.x0, r.y + g.y0, r.x + g.x1, r.y + g.y1);
    const cols = [s.c1, s.c2, s.c3];
    gradientStops(count === 2 ? 2 : 3).forEach((p, i) => lg.addColorStop(p, cols[i]));
    ctx.fillStyle = lg;
  }
  ctx.fillRect(r.x, r.y, r.w, r.h);
}

/** Vẽ nền theo cài đặt. `allowImage=false` -> ảnh nền được thay bằng gradient 2 màu. */
function paintBackground(env: Env, r: Rect, allowImage: boolean) {
  const { ctx, s, A } = env;
  const type: BgType = s.bgType === 'image' && !(allowImage && A.bg) ? 'gradient2' : s.bgType;
  if (type === 'image' && A.bg) {
    drawCoverImage(ctx, A.bg, r, s.blur);
    if (s.overlayOpacity > 0) {
      ctx.fillStyle = withAlpha(s.overlayTone === 'dark' ? '#000000' : '#ffffff', s.overlayOpacity / 100);
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    return;
  }
  paintGradient(ctx, r, s, type === 'solid' ? 1 : type === 'gradient3' ? 3 : 2);
}

function drawPill(env: Env, text: string, x: number, y: number, size: number, bg: string, fg: string, maxW: number): { w: number; h: number } {
  const { ctx, u } = env;
  const padX = size * 0.8;
  const padY = size * 0.42;
  const f = env.font(size, 700);
  const t = oneLine(text, maxW - 2 * padX, f);
  ctx.font = f;
  const tw = measure(t, f);
  const w = tw + 2 * padX;
  const h = size + 2 * padY;
  rr(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = fg;
  drawTextAt(ctx, t, x + padX, y + h / 2 + u * 0.5);
  return { w, h };
}

function drawAvatar(env: Env, cx: number, cy: number, size: number, fallback: string) {
  const { ctx, A, s } = env;
  const x = cx - size / 2;
  const y = cy - size / 2;
  ctx.save();
  if (A.logo) {
    if (s.logoShape === 'none') {
      const c = containRect(A.logo.w, A.logo.h, size, size);
      ctx.drawImage(A.logo.src, x + c.x, y + c.y, c.w, c.h);
    } else {
      if (s.logoShape === 'circle') {
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
        ctx.closePath();
      } else {
        rr(ctx, x, y, size, size, size * 0.22);
      }
      ctx.clip();
      const c = coverRect(A.logo.w, A.logo.h, size, size);
      ctx.drawImage(A.logo.src, x + c.x, y + c.y, c.w, c.h);
    }
  } else {
    if (s.logoShape === 'rounded') rr(ctx, x, y, size, size, size * 0.22);
    else {
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.closePath();
    }
    ctx.fillStyle = s.accent;
    ctx.fill();
    const ch = splitGraphemes((fallback || '?').trim())[0] ?? '?';
    ctx.fillStyle = pickTextColor([s.accent]).color;
    ctx.font = env.font(size * 0.5, 700);
    drawTextAt(ctx, ch.toUpperCase(), cx, cy + size * 0.02, 'center');
  }
  ctx.restore();
}

function blockX(align: Align, x0: number, x1: number, width: number): number {
  return align === 'left' ? x0 : align === 'right' ? x1 - width : (x0 + x1 - width) / 2;
}
function alignX(align: Align, x0: number, x1: number): number {
  return align === 'left' ? x0 : align === 'right' ? x1 : (x0 + x1) / 2;
}

function simpleFooterText(s: OgSettings): { left: string; right: string } {
  return { left: [s.author, s.date].map((t) => t.trim()).filter(Boolean).join('  ·  '), right: s.url.trim() };
}

function footerHeight(env: Env, style: 'simple' | 'blog' | 'none'): number {
  const { s, u } = env;
  if (style === 'none') return 0;
  if (style === 'blog') return s.author.trim() || s.date.trim() || s.readTime.trim() || s.url.trim() ? 64 * u : 0;
  const f = simpleFooterText(s);
  return f.left || f.right ? 40 * u : 0;
}

function drawFooter(env: Env, style: 'simple' | 'blog', x0: number, x1: number, yc: number) {
  const { ctx, s, u, tc, A } = env;
  const regionW = x1 - x0;
  const muted = withAlpha(tc, 0.78);
  if (style === 'simple') {
    const { left, right } = simpleFooterText(s);
    const size = 24 * u;
    const f = env.font(size, 600);
    const av = A.logo && left ? 36 * u : 0;
    const gap = av ? 12 * u : 0;
    ctx.font = f;
    if (s.align === 'center') {
      const all = [left, right].filter(Boolean).join('  ·  ');
      const t = oneLine(all, regionW - av - gap, f);
      const tw = measure(t, f);
      const total = av + gap + tw;
      const sx = (x0 + x1 - total) / 2;
      if (av) drawAvatar(env, sx + av / 2, yc, av, s.author);
      ctx.fillStyle = muted;
      ctx.font = f;
      drawTextAt(ctx, t, sx + av + gap, yc);
      return;
    }
    const lt = oneLine(left, regionW * 0.62 - av - gap, f);
    const lw = av + gap + (lt ? measure(lt, f) : 0);
    const rt = oneLine(right, Math.max(60 * u, regionW - lw - 32 * u), f);
    const rw = rt ? measure(rt, f) : 0;
    const groupX = s.align === 'left' ? x0 : x1 - lw;
    if (av && lt) drawAvatar(env, groupX + av / 2, yc, av, s.author);
    ctx.font = f;
    ctx.fillStyle = muted;
    if (lt) drawTextAt(ctx, lt, groupX + av + gap, yc);
    ctx.fillStyle = withAlpha(tc, 0.65);
    if (rt) drawTextAt(ctx, rt, s.align === 'left' ? x1 - rw : x0, yc);
    return;
  }
  // blog
  const av = 56 * u;
  const nameF = env.font(28 * u, 700);
  const metaF = env.font(22 * u, 500);
  const metaParts = [s.date.trim(), s.readTime.trim()].filter(Boolean);
  if (s.align === 'center' && s.url.trim()) metaParts.push(s.url.trim());
  const hasPerson = !!(s.author.trim() || metaParts.length);
  const textMax = regionW * 0.62 - av - 16 * u;
  const name = oneLine(s.author.trim(), textMax, nameF);
  const meta = oneLine(metaParts.join('  ·  '), textMax, metaF);
  const tw = Math.max(name ? measure(name, nameF) : 0, meta ? measure(meta, metaF) : 0);
  const gw = hasPerson ? av + 16 * u + tw : 0;
  const gx = s.align === 'left' ? x0 : s.align === 'right' ? x1 - gw : (x0 + x1 - gw) / 2;
  if (hasPerson) {
    drawAvatar(env, gx + av / 2, yc, av, s.author);
    const tx = gx + av + 16 * u;
    ctx.fillStyle = tc;
    ctx.font = nameF;
    if (name && meta) {
      drawTextAt(ctx, name, tx, yc - 13 * u);
      ctx.fillStyle = muted;
      ctx.font = metaF;
      drawTextAt(ctx, meta, tx, yc + 15 * u);
    } else if (name) {
      drawTextAt(ctx, name, tx, yc);
    } else {
      ctx.fillStyle = muted;
      ctx.font = metaF;
      drawTextAt(ctx, meta, tx, yc);
    }
  }
  if (s.align !== 'center' && s.url.trim()) {
    const uf = env.font(24 * u, 600);
    const space = Math.max(80 * u, regionW - gw - 32 * u);
    const ut = oneLine(s.url.trim(), space, uf);
    ctx.font = uf;
    ctx.fillStyle = withAlpha(tc, 0.7);
    if (ut) {
      const uw = measure(ut, uf);
      drawTextAt(ctx, ut, s.align === 'left' ? x1 - uw : x0, yc);
    }
  }
}

interface StackOpts {
  footer: 'simple' | 'blog' | 'none';
  logoTop: boolean;
  cta: boolean;
  badge: 'pill' | 'text';
  anchor: 'center' | 'bottom';
  x0: number;
  x1: number;
}

function titleFit(env: Env, text: string, maxW: number, maxH: number, maxLines: number, maxSizeU = 150) {
  const { s, u, font } = env;
  const manual = !s.titleAuto;
  const minSize = manual ? s.titleSize * u : 20 * u;
  const maxSize = manual ? s.titleSize * u : maxSizeU * u * (env.h > env.w ? 1.15 : 1);
  return fitText({
    text,
    maxWidth: maxW,
    maxHeight: maxH,
    maxLines,
    minSize,
    maxSize,
    lineHeight: 1.18,
    fontFor: (sz) => font(sz),
    measure,
  });
}

function drawStack(env: Env, o: StackOpts) {
  const { ctx, s, u, pad, tc, h, A } = env;
  const { x0, x1 } = o;
  const regionW = x1 - x0;
  const align = s.align;
  const tag = s.tag.trim();
  const title = s.title.trim();
  const sub = s.subtitle.trim();
  const fH = footerHeight(env, o.footer);
  const footerGap = fH ? 24 * u : 0;
  const availH = h - 2 * pad - fH - footerGap;

  type El = { h: number; gap: number; draw: (y: number) => void };
  const els: El[] = [];
  let titleIdx = -1;

  if (o.logoTop) {
    const size = 84 * u;
    els.push({
      h: size,
      gap: 28 * u,
      draw: (y) => {
        const cx = alignX(align, x0, x1) + (align === 'left' ? size / 2 : align === 'right' ? -size / 2 : 0);
        drawAvatar(env, cx, y + size / 2, size, s.author || s.title);
      },
    });
  }
  if (o.badge === 'text') {
    els.push({
      h: 5 * u,
      gap: tag ? 16 * u : 28 * u,
      draw: (y) => {
        ctx.fillStyle = s.accent;
        ctx.fillRect(blockX(align, x0, x1, 56 * u), y, 56 * u, 5 * u);
      },
    });
  }
  if (tag) {
    if (o.badge === 'pill') {
      const size = 24 * u;
      els.push({
        h: size * 1.84,
        gap: 28 * u,
        draw: (y) => {
          const f = env.font(size, 700);
          const t = oneLine(tag, regionW - 2 * size * 0.8, f);
          const w = measure(t, f) + size * 1.6;
          drawPill(env, tag, blockX(align, x0, x1, w), y, size, s.accent, pickTextColor([s.accent]).color, regionW);
        },
      });
    } else {
      const size = 22 * u;
      els.push({
        h: size * 1.3,
        gap: 28 * u,
        draw: (y) => {
          const f = env.font(size, 700);
          ctx.font = f;
          ctx.fillStyle = s.accent;
          drawTextAt(ctx, oneLine(tag.toUpperCase(), regionW, f), alignX(align, x0, x1), y + (size * 1.3) / 2, align);
        },
      });
    }
  }
  const subSize = Math.round(30 * u * (env.h > env.w ? 1.1 : 1));
  const subF = env.font(subSize, 500);
  const subRes = sub ? wrapText(sub, { maxWidth: regionW, font: subF, measure, maxLines: 3 }) : { lines: [] as string[] };
  const subH = subRes.lines.length * subSize * 1.35;
  if (title) {
    titleIdx = els.length;
    els.push({ h: 0, gap: sub ? 20 * u : o.cta ? 36 * u : 0, draw: () => undefined });
  }
  if (subRes.lines.length) {
    els.push({
      h: subH,
      gap: 36 * u,
      draw: (y) => {
        ctx.font = subF;
        ctx.fillStyle = withAlpha(tc, 0.85);
        subRes.lines.forEach((ln, i) => drawTextAt(ctx, ln, alignX(align, x0, x1), y + subSize * 1.35 * (i + 0.5), align));
      },
    });
  }
  if (o.cta && s.cta.trim()) {
    const size = 28 * u;
    els.push({
      h: size * 1.84,
      gap: 0,
      draw: (y) => {
        const f = env.font(size, 700);
        const t = oneLine(s.cta.trim(), regionW - size * 1.6, f);
        const w = measure(t, f) + size * 1.6;
        drawPill(env, s.cta.trim(), blockX(align, x0, x1, w), y, size, s.accent, pickTextColor([s.accent]).color, regionW);
      },
    });
  }
  // gap của phần tử cuối không tính
  const last = els.length - 1;
  const fixed = els.reduce((a, e, i) => a + (i === titleIdx ? 0 : e.h) + (i < last ? e.gap : 0), 0);
  const titleMaxH = Math.max(60 * u, availH - fixed);
  let titleRes: ReturnType<typeof titleFit> | null = null;
  if (titleIdx >= 0) {
    titleRes = titleFit(env, title, regionW, titleMaxH, s.maxLines);
    els[titleIdx].h = titleRes.height;
    const tr = titleRes;
    els[titleIdx].draw = (y) => {
      ctx.font = env.font(tr.size);
      ctx.fillStyle = tc;
      tr.lines.forEach((ln, i) => drawTextAt(ctx, ln, alignX(align, x0, x1), y + tr.lineHeightPx * (i + 0.5), align));
    };
  }
  const total = els.reduce((a, e, i) => a + e.h + (i < last ? e.gap : 0), 0);
  let y = o.anchor === 'bottom' ? pad + Math.max(0, availH - total) : pad + Math.max(0, (availH - total) / 2);
  els.forEach((e) => {
    e.draw(y);
    y += e.h + e.gap;
  });

  if (fH && o.footer !== 'none') {
    const yc = h - pad - fH / 2;
    if (o.anchor === 'bottom') {
      ctx.fillStyle = withAlpha(tc, 0.18);
      ctx.fillRect(x0, h - pad - fH - 14 * u, regionW, Math.max(1, u));
    }
    drawFooter(env, o.footer, x0, x1, yc);
  }
  void A;
}

function iconStar(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r * 0.42 : r;
    const px = cx + Math.cos(ang) * rad;
    const py = cy + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}
function iconFork(ctx: Ctx, cx: number, cy: number, r: number) {
  const pts: [number, number][] = [
    [cx - r * 0.6, cy - r * 0.7],
    [cx + r * 0.6, cy - r * 0.7],
    [cx, cy + r * 0.75],
  ];
  ctx.lineWidth = r * 0.24;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  ctx.lineTo(pts[0][0], cy);
  ctx.quadraticCurveTo(pts[0][0], cy + r * 0.2, cx, cy + r * 0.3);
  ctx.lineTo(cx, pts[2][1]);
  ctx.moveTo(pts[1][0], pts[1][1]);
  ctx.lineTo(pts[1][0], cy);
  ctx.quadraticCurveTo(pts[1][0], cy + r * 0.2, cx, cy + r * 0.3);
  ctx.stroke();
  pts.forEach(([px, py]) => {
    ctx.beginPath();
    ctx.arc(px, py, r * 0.27, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.stroke();
  });
}
function iconIssue(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.lineWidth = r * 0.24;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
}

function drawGithub(env: Env) {
  const { ctx, s, u, pad, tc, w, h } = env;
  const fH = footerHeight(env, 'simple');
  const cardX = pad;
  const cardY = pad;
  const cardW = w - 2 * pad;
  const cardH = h - 2 * pad - (fH ? fH + 20 * u : 0);
  const ip = 40 * u;
  rr(ctx, cardX, cardY, cardW, cardH, 26 * u);
  ctx.fillStyle = withAlpha(tc, 0.08);
  ctx.fill();
  ctx.strokeStyle = withAlpha(tc, 0.22);
  ctx.lineWidth = Math.max(1, 2 * u);
  ctx.stroke();

  const x0 = cardX + ip;
  const x1 = cardX + cardW - ip;
  const innerW = x1 - x0;
  let top = cardY + ip;
  const bottom = cardY + cardH - ip;

  // tag
  const tag = s.tag.trim();
  if (tag) {
    const p = drawPill(env, tag, x0, top, 20 * u, withAlpha(s.accent, 0.95), pickTextColor([s.accent]).color, innerW);
    top += p.h + 22 * u;
  }
  // phần dưới: stats + chips
  const statsH = 40 * u;
  const chipSize = 22 * u;
  const chipF = env.font(chipSize, 600);
  const topics = parseTopics(s.topics, 8);
  const rows: { t: string; w: number }[][] = [];
  topics.forEach((t) => {
    const tw = measure(t, chipF) + chipSize * 1.4;
    let row = rows[rows.length - 1];
    const used = row ? row.reduce((a, c) => a + c.w + 10 * u, 0) : 0;
    if (!row || used + tw > innerW) {
      if (rows.length >= 2) return;
      row = [];
      rows.push(row);
    }
    row.push({ t, w: Math.min(tw, innerW) });
  });
  const chipH = chipSize * 1.75;
  const chipsH = rows.length ? rows.length * chipH + (rows.length - 1) * 10 * u + 22 * u : 0;
  const bottomH = statsH + chipsH;

  // tên repo + mô tả
  const name = s.title.trim();
  const descSize = 28 * u;
  const descF = env.font(descSize, 500);
  const desc = s.subtitle.trim();
  const descRes = desc ? wrapText(desc, { maxWidth: innerW, font: descF, measure, maxLines: 3 }) : { lines: [] as string[] };
  const descH = descRes.lines.length * descSize * 1.4;
  const nameMaxH = Math.max(50 * u, bottom - top - bottomH - descH - (desc ? 22 * u : 0) - 20 * u);
  if (name) {
    const res = titleFit(env, name, innerW, nameMaxH, Math.min(2, s.maxLines), 92);
    ctx.font = env.font(res.size);
    if (res.lines.length === 1 && name.includes('/')) {
      const i = name.indexOf('/');
      const owner = name.slice(0, i + 1);
      const repo = name.slice(i + 1);
      const yy = top + res.lineHeightPx / 2;
      const f = env.font(res.size);
      ctx.font = f;
      ctx.fillStyle = withAlpha(tc, 0.62);
      const ow = measure(owner, f);
      const full = measure(owner + repo, f);
      if (full <= innerW + 0.5) {
        drawTextAt(ctx, owner, x0, yy);
        ctx.fillStyle = tc;
        drawTextAt(ctx, repo, x0 + ow, yy);
      } else {
        ctx.fillStyle = tc;
        drawTextAt(ctx, res.lines[0], x0, yy);
      }
    } else {
      ctx.fillStyle = tc;
      res.lines.forEach((ln, i) => drawTextAt(ctx, ln, x0, top + res.lineHeightPx * (i + 0.5)));
    }
    top += res.height + 22 * u;
  }
  if (descRes.lines.length) {
    ctx.font = descF;
    ctx.fillStyle = withAlpha(tc, 0.85);
    descRes.lines.forEach((ln, i) => drawTextAt(ctx, ln, x0, top + descSize * 1.4 * (i + 0.5)));
  }

  // chips
  let cy = bottom - statsH - chipsH + (rows.length ? 0 : 0);
  rows.forEach((row) => {
    let cx = x0;
    row.forEach((c) => {
      rr(ctx, cx, cy, c.w, chipH, chipH / 2);
      ctx.fillStyle = withAlpha(s.accent, 0.16);
      ctx.fill();
      ctx.strokeStyle = withAlpha(s.accent, 0.7);
      ctx.lineWidth = Math.max(1, 1.5 * u);
      ctx.stroke();
      ctx.font = chipF;
      ctx.fillStyle = tc;
      drawTextAt(ctx, oneLine(c.t, c.w - chipSize * 1.2, chipF), cx + chipSize * 0.7, cy + chipH / 2);
      cx += c.w + 10 * u;
    });
    cy += chipH + 10 * u;
  });

  // stats
  const sy = bottom - statsH / 2;
  const sf = env.font(26 * u, 600);
  let sx = x0;
  if (s.ghLang.trim()) {
    ctx.fillStyle = langColor(s.ghLang);
    ctx.beginPath();
    ctx.arc(sx + 9 * u, sy, 9 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = withAlpha(tc, 0.9);
    ctx.font = sf;
    const t = oneLine(s.ghLang.trim(), innerW * 0.3, sf);
    drawTextAt(ctx, t, sx + 28 * u, sy);
    sx += 28 * u + measure(t, sf) + 36 * u;
  }
  const stats: [string, string][] = [
    ['star', s.ghStars.trim()],
    ['fork', s.ghForks.trim()],
    ['issue', s.ghIssues.trim()],
  ];
  stats.forEach(([icon, val]) => {
    if (!val) return;
    const r = 12 * u;
    ctx.fillStyle = withAlpha(tc, 0.85);
    ctx.strokeStyle = withAlpha(tc, 0.85);
    if (icon === 'star') iconStar(ctx, sx + r, sy, r);
    else if (icon === 'fork') iconFork(ctx, sx + r, sy, r);
    else iconIssue(ctx, sx + r, sy, r);
    ctx.font = sf;
    ctx.fillStyle = withAlpha(tc, 0.9);
    const t = oneLine(val, 160 * u, sf);
    drawTextAt(ctx, t, sx + 2 * r + 10 * u, sy);
    sx += 2 * r + 10 * u + measure(t, sf) + 32 * u;
  });

  if (fH) {
    // dùng chân trang đơn giản nhưng luôn căn trái/phải
    drawFooter({ ...env, s: { ...s, align: 'left' } }, 'simple', pad, w - pad, h - pad - fH / 2);
  }
}

const TOK_COLORS: Record<TokType, string> = {
  plain: '#e6edf3',
  keyword: '#ff7b72',
  string: '#a5d6ff',
  comment: '#8b949e',
  number: '#79c0ff',
  prop: '#7ee787',
};

function drawCode(env: Env) {
  const { ctx, s, u, pad, tc, w, h, mono } = env;
  const x0 = pad;
  const x1 = w - pad;
  const regionW = x1 - x0;
  const fH = footerHeight(env, 'simple');
  const title = s.title.trim();
  let y = pad;
  if (title) {
    const res = titleFit(env, title, regionW, h * 0.26, Math.min(2, s.maxLines), 76);
    ctx.font = env.font(res.size);
    ctx.fillStyle = tc;
    res.lines.forEach((ln, i) => drawTextAt(ctx, ln, alignX(s.align, x0, x1), y + res.lineHeightPx * (i + 0.5), s.align));
    y += res.height + 26 * u;
  }
  const cardY = y;
  const cardH = Math.max(120 * u, h - pad - (fH ? fH + 18 * u : 0) - cardY);
  const cardW = regionW;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 40 * u;
  ctx.shadowOffsetY = 14 * u;
  rr(ctx, x0, cardY, cardW, cardH, 18 * u);
  ctx.fillStyle = CODE_CARD_BG;
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = Math.max(1, u);
  rr(ctx, x0, cardY, cardW, cardH, 18 * u);
  ctx.stroke();
  // thanh tiêu đề
  const barH = 46 * u;
  ctx.save();
  rr(ctx, x0, cardY, cardW, cardH, 18 * u);
  ctx.clip();
  ctx.fillStyle = '#161b22';
  ctx.fillRect(x0, cardY, cardW, barH);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x0, cardY + barH, cardW, Math.max(1, u));
  ctx.restore();
  ['#ff5f56', '#ffbd2e', '#27c93f'].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x0 + 28 * u + i * 26 * u, cardY + barH / 2, 7.5 * u, 0, Math.PI * 2);
    ctx.fill();
  });
  const fname = s.tag.trim();
  if (fname) {
    const ff = `500 ${Math.round(18 * u)}px ${mono}`;
    ctx.font = ff;
    ctx.fillStyle = '#8b949e';
    drawTextAt(ctx, oneLine(fname, cardW - 220 * u, ff), x0 + cardW / 2, cardY + barH / 2, 'center');
  }
  // thân code
  let lines = tokenizeCode(s.code, s.codeLang);
  while (lines.length > 1 && lines[lines.length - 1].length === 0) lines = lines.slice(0, -1);
  const bodyY = cardY + barH + 22 * u;
  const bodyH = cardH - barH - 40 * u;
  const lh = 1.5;
  const probe = measure('0', `400 100px ${mono}`) / 100;
  const digits = String(Math.max(1, Math.min(lines.length, 60))).length;
  const maxLen = Math.max(1, ...lines.map((l) => l.reduce((a, t) => a + t.t.length, 0)));
  let fs = Math.min(30 * u, bodyH / (Math.min(lines.length, 3) * lh));
  const inner = cardW - 48 * u;
  // cỡ chữ vừa chiều cao
  fs = Math.min(fs, bodyH / (lines.length * lh));
  // cỡ chữ vừa chiều rộng (tối đa 70 cột trước khi cắt)
  const colsWanted = Math.min(maxLen, 70);
  const gutterFor = (f: number) => (digits + 1.6) * probe * f;
  fs = Math.min(fs, inner / ((colsWanted + digits + 1.6) * probe));
  fs = Math.max(fs, 12 * u);
  let maxRows = Math.max(1, Math.floor(bodyH / (fs * lh)));
  let shown = lines;
  if (lines.length > maxRows) {
    shown = lines.slice(0, maxRows);
    shown[maxRows - 1] = [{ t: '…', type: 'plain' }];
  }
  maxRows = shown.length;
  const gutter = gutterFor(fs);
  const maxCols = Math.max(4, Math.floor((inner - gutter) / (probe * fs)));
  const cf = `500 ${Math.round(fs * 10) / 10}px ${mono}`;
  ctx.font = cf;
  const startX = x0 + 24 * u;
  shown.forEach((ln, i) => {
    const yy = bodyY + fs * lh * (i + 0.5);
    ctx.fillStyle = '#6e7681';
    ctx.font = cf;
    drawTextAt(ctx, String(i + 1), startX + (digits * probe * fs), yy, 'right');
    let x = startX + gutter;
    clipTokenLine(ln, maxCols).forEach((tk) => {
      ctx.fillStyle = TOK_COLORS[tk.type];
      drawTextAt(ctx, tk.t, x, yy, 'left');
      x += measure(tk.t, cf);
    });
  });
  if (fH) drawFooter(env, 'simple', x0, x1, h - pad - fH / 2);
}

function drawHeroDecor(env: Env) {
  const { ctx, w, h, u, tc } = env;
  ctx.fillStyle = withAlpha(tc, 0.07);
  ctx.beginPath();
  ctx.arc(w * 0.88, h * 0.12, Math.min(w, h) * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = withAlpha(tc, 0.05);
  ctx.beginPath();
  ctx.arc(w * 0.08, h * 0.98, Math.min(w, h) * 0.3, 0, Math.PI * 2);
  ctx.fill();
  void u;
}

function drawPattern(env: Env) {
  const { ctx, s, w, h, tc } = env;
  const shapes = generatePattern(s.patternKind, w, h, s.patternSeed);
  ctx.save();
  shapes.forEach((sh) => {
    const col = sh.k === 'line' ? withAlpha(tc, sh.a) : withAlpha(s.accent, sh.a);
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    if (sh.k === 'circle') {
      ctx.beginPath();
      ctx.arc(sh.x, sh.y, Math.max(0.5, sh.r), 0, Math.PI * 2);
      if (sh.fill) ctx.fill();
      else {
        ctx.lineWidth = sh.lw;
        ctx.stroke();
      }
    } else if (sh.k === 'line') {
      ctx.lineWidth = sh.lw;
      ctx.beginPath();
      ctx.moveTo(sh.x1, sh.y1);
      ctx.lineTo(sh.x2, sh.y2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      sh.pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      if (sh.closed) ctx.closePath();
      if (sh.fill) ctx.fill();
      else {
        ctx.lineWidth = sh.lw;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    }
  });
  ctx.restore();
}

/** Vẽ toàn bộ ảnh OG vào canvas theo cài đặt. */
function drawOg(canvas: HTMLCanvasElement, s: OgSettings, A: Assets) {
  const { w, h } = getSize(s.size);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
  const u = Math.min(w / 1200, h / 630);
  const fam = (FONT_STACKS.find((f) => f.id === s.fontFamily) ?? FONT_STACKS[0]).stack + EMOJI_FONTS;
  const mono = (FONT_STACKS.find((f) => f.id === 'mono') ?? FONT_STACKS[0]).stack + EMOJI_FONTS;
  const tcInfo = resolveTextColor(s, !!A.bg);
  const env: Env = {
    ctx,
    s,
    A,
    w,
    h,
    u,
    pad: s.padding * u,
    tc: tcInfo.color,
    fam,
    mono,
    font: (size, weight = s.weight) => `${weight} ${Math.round(size * 10) / 10}px ${fam}`,
  };
  const full: Rect = { x: 0, y: 0, w, h };
  const t = s.template;
  const split = t === 'photo' && s.photoLayout !== 'full';

  // nền
  if (t === 'minimal') {
    ctx.fillStyle = MINIMAL_BG;
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w * 0.9, h * 0.05, 0, w * 0.9, h * 0.05, Math.max(w, h) * 0.7);
    g.addColorStop(0, withAlpha(s.accent, 0.22));
    g.addColorStop(1, withAlpha(s.accent, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else if (split) {
    const half = Math.round(w / 2);
    const imgRect: Rect = s.photoLayout === 'left' ? { x: 0, y: 0, w: half, h } : { x: half, y: 0, w: w - half, h };
    const panel: Rect = s.photoLayout === 'left' ? { x: half, y: 0, w: w - half, h } : { x: 0, y: 0, w: half, h };
    paintBackground(env, panel, false);
    if (A.bg) {
      drawCoverImage(ctx, A.bg, imgRect, s.blur);
      if (s.overlayOpacity > 0) {
        ctx.fillStyle = withAlpha(s.overlayTone === 'dark' ? '#000000' : '#ffffff', s.overlayOpacity / 100);
        ctx.fillRect(imgRect.x, imgRect.y, imgRect.w, imgRect.h);
      }
    } else {
      ctx.fillStyle = mixHex(s.c1, '#000000', 0.35);
      ctx.fillRect(imgRect.x, imgRect.y, imgRect.w, imgRect.h);
      ctx.fillStyle = withAlpha('#ffffff', 0.7);
      ctx.font = env.font(26 * u, 600);
      drawTextAt(ctx, 'Chưa có ảnh', imgRect.x + imgRect.w / 2, imgRect.h / 2, 'center');
    }
  } else {
    paintBackground(env, full, true);
  }
  if (t === 'hero') drawHeroDecor(env);
  if (t === 'pattern') drawPattern(env);

  const pad = env.pad;
  const base = { x0: pad, x1: w - pad };
  if (t === 'hero') drawStack(env, { ...base, footer: 'simple', logoTop: false, cta: false, badge: 'pill', anchor: 'center' });
  else if (t === 'pattern') drawStack(env, { ...base, footer: 'simple', logoTop: false, cta: false, badge: 'pill', anchor: 'center' });
  else if (t === 'launch') drawStack(env, { ...base, footer: 'simple', logoTop: !!A.logo, cta: true, badge: 'pill', anchor: 'center' });
  else if (t === 'minimal') drawStack(env, { ...base, footer: 'simple', logoTop: false, cta: false, badge: 'text', anchor: 'bottom' });
  else if (t === 'blog') drawStack(env, { ...base, footer: 'blog', logoTop: false, cta: false, badge: 'pill', anchor: 'center' });
  else if (t === 'photo') {
    const half = w / 2;
    const region =
      s.photoLayout === 'left' ? { x0: half + pad, x1: w - pad } : s.photoLayout === 'right' ? { x0: pad, x1: half - pad } : base;
    drawStack(env, { ...region, footer: 'simple', logoTop: false, cta: false, badge: 'pill', anchor: 'center' });
  } else if (t === 'code') drawCode(env);
  else if (t === 'github') drawGithub(env);
}

function renderBlob(s: OgSettings, A: Assets): Promise<Blob | null> {
  const c = document.createElement('canvas');
  drawOg(c, s, A);
  const info = FORMAT_INFO[s.format];
  return new Promise((resolve) => {
    try {
      c.toBlob((b) => resolve(b), info.mime, s.format === 'png' ? undefined : s.quality);
    } catch {
      resolve(null);
    }
  });
}

// ───────────── tải ảnh lên ─────────────

async function readImageFile(file: File): Promise<Img> {
  if (file.size > MAX_UPLOAD) throw new Error(`File quá lớn (${formatBytes(file.size)}). Tối đa 15 MB.`);
  const ok = /^image\/(png|jpe?g|webp|gif|bmp|avif|svg\+xml)$/.test(file.type) || /\.(png|jpe?g|webp|gif|svg|bmp|avif)$/i.test(file.name);
  if (!ok) throw new Error('Định dạng không được hỗ trợ. Hãy dùng PNG, JPG, WebP, GIF hoặc SVG.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Không giải mã được ảnh. File có thể bị hỏng.'));
      el.src = url;
    });
    let w = img.naturalWidth || 512;
    let h = img.naturalHeight || 512;
    const k = Math.min(1, MAX_SOURCE_DIM / Math.max(w, h));
    w = Math.max(1, Math.round(w * k));
    h = Math.max(1, Math.round(h * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Trình duyệt không hỗ trợ canvas.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return { src: c, w, h, name: file.name };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ───────────── component nhỏ ─────────────

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

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
            value === o.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  unit = '',
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  unit?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      <span className={labelCls}>
        {label}: {value}
        {unit}
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label className={labelCls}>{label}</label>
      {children}
    </div>
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
      <pre className="bg-slate-900 text-slate-100 text-xs rounded-lg p-3 overflow-x-auto whitespace-pre font-mono">{text}</pre>
    </div>
  );
}

function UploadRow({
  label,
  img,
  busy,
  onPick,
  onClear,
}: {
  label: string;
  img: Img | null;
  busy: boolean;
  onPick: (f: File) => void;
  onClear: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button type="button" onClick={() => ref.current?.click()} className={btnCls} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        {label}
      </button>
      {img && (
        <>
          <span className="text-xs text-slate-600 truncate max-w-48">
            {img.name} ({img.w}×{img.h})
          </span>
          <button type="button" onClick={onClear} className="p-1 text-slate-400 hover:text-red-600" title="Xóa ảnh">
            <Trash2 className="h-4 w-4" />
          </button>
        </>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

// ───────────── trang ─────────────

export default function OgImagePage() {
  const { showToast } = useApp();
  const [s, setS] = useState<OgSettings>(DEFAULT_SETTINGS);
  const [bgImg, setBgImg] = useState<Img | null>(null);
  const [logoImg, setLogoImg] = useState<Img | null>(null);
  const [loadingImg, setLoadingImg] = useState<'bg' | 'logo' | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showSafe, setShowSafe] = useState(false);
  const [boxW, setBoxW] = useState(600);
  const [fileInfo, setFileInfo] = useState<{ bytes: number; key: string } | null>(null);
  const [busy, setBusy] = useState<'' | 'dl' | 'copy' | 'zip'>('');
  const [copied, setCopied] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const assets = useMemo<Assets>(() => ({ bg: bgImg, logo: logoImg }), [bgImg, logoImg]);
  const set = useCallback(<K extends keyof OgSettings>(k: K, v: OgSettings[K]) => setS((p) => ({ ...p, [k]: v })), []);

  // đọc cài đặt đã lưu + tham số URL
  useEffect(() => {
    const timer = setTimeout(() => {
      let next = DEFAULT_SETTINGS;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) next = sanitizeSettings(JSON.parse(raw));
      } catch {
        /* bỏ qua: localStorage có thể bị chặn */
      }
      const p = readShareParams();
      const patch: Partial<OgSettings> = {};
      const sz = p.get('size');
      if (sz && OG_SIZES.some((x) => x.id === sz)) patch.size = sz as SizeId;
      const tp = p.get('tpl');
      if (tp && TEMPLATES.some((x) => x.id === tp)) patch.template = tp as TemplateId;
      const ti = p.get('title');
      if (ti) patch.title = ti.slice(0, 300);
      const su = p.get('sub');
      if (su) patch.subtitle = su.slice(0, 400);
      const au = p.get('author');
      if (au) patch.author = au.slice(0, 80);
      const ur = p.get('url');
      if (ur) patch.url = ur.slice(0, 120);
      setS(sanitizeSettings({ ...next, ...patch }));
      setLoaded(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // lưu cài đặt (không gồm ảnh tải lên)
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      } catch {
        /* bỏ qua */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [s, loaded]);

  // theo dõi bề rộng khung xem trước
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const upd = () => setBoxW(Math.max(120, el.clientWidth));
    upd();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // vẽ xem trước
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    try {
      drawOg(c, s, assets);
    } catch {
      showToast('Không vẽ được ảnh xem trước.');
    }
  }, [s, assets, showToast]);

  // ước lượng dung lượng file xuất (debounce)
  const fileKey = useMemo(() => JSON.stringify(s) + (bgImg?.name ?? '') + (logoImg?.name ?? ''), [s, bgImg, logoImg]);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const b = await renderBlob(s, assets);
      if (!cancelled && b) setFileInfo({ bytes: b.size, key: fileKey });
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [s, assets, fileKey]);

  const size = getSize(s.size);
  const ratio = size.w / size.h;
  const dispW = Math.min(boxW, PREVIEW_MAX_H * ratio);
  const dispH = dispW / ratio;
  const tcInfo = useMemo(() => resolveTextColor(s, !!bgImg), [s, bgImg]);
  const usesImageBg = s.bgType === 'image' || s.template === 'photo';
  const zones = useMemo(() => safeZones(size.w, size.h), [size.w, size.h]);
  const info = FORMAT_INFO[s.format];
  const bytes = fileInfo?.key === fileKey ? fileInfo.bytes : null;
  const warnings = bytes !== null ? exportWarnings(bytes, s.format) : [];
  const t = s.template;

  const snippet = buildMetaSnippet({
    imageUrl: s.imageUrl,
    width: size.w,
    height: size.h,
    alt: s.alt || s.title,
    mime: info.mime,
  });
  const urlProblem = checkImageUrl(s.imageUrl);

  const pickImage = async (f: File, target: 'bg' | 'logo') => {
    setLoadingImg(target);
    try {
      const img = await readImageFile(f);
      if (target === 'bg') {
        setBgImg(img);
        setS((p) => ({ ...p, bgType: 'image' }));
      } else {
        setLogoImg(img);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Không đọc được ảnh.');
    } finally {
      setLoadingImg(null);
    }
  };

  const fileName = (sz: SizeId = s.size) => {
    const z = getSize(sz);
    return `og-${slugify(s.title)}-${z.w}x${z.h}.${info.ext}`;
  };

  const download = async () => {
    setBusy('dl');
    try {
      const b = await renderBlob(s, assets);
      if (!b) throw new Error('Không tạo được ảnh. Định dạng có thể không được trình duyệt hỗ trợ.');
      saveAs(b, fileName());
      showToast(`Đã tải ${formatBytes(b.size)}.`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Lỗi khi tải ảnh.');
    } finally {
      setBusy('');
    }
  };

  const copyImage = async () => {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      showToast('Trình duyệt không hỗ trợ sao chép ảnh. Hãy dùng nút Tải xuống.');
      return;
    }
    setBusy('copy');
    try {
      const pr = renderBlob({ ...s, format: 'png' }, assets).then((b) => {
        if (!b) throw new Error('png');
        return b;
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pr })]);
      showToast('Đã sao chép ảnh (PNG) vào bộ nhớ tạm.');
    } catch {
      showToast('Không sao chép được ảnh. Hãy dùng nút Tải xuống.');
    } finally {
      setBusy('');
    }
  };

  const downloadZip = async () => {
    setBusy('zip');
    try {
      const zip = new JSZip();
      let total = 0;
      for (const z of OG_SIZES) {
        const b = await renderBlob({ ...s, size: z.id }, assets);
        if (!b) throw new Error('Không tạo được một trong các kích thước.');
        total += b.size;
        zip.file(`og-${z.w}x${z.h}.${info.ext}`, b);
      }
      const og = getSize('og');
      zip.file(
        'meta-tags.html',
        buildMetaSnippet({ imageUrl: s.imageUrl, width: og.w, height: og.h, alt: s.alt || s.title, mime: info.mime }) + '\n'
      );
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      saveAs(blob, `og-images-${slugify(s.title)}.zip`);
      showToast(`Đã tạo ZIP ${OG_SIZES.length} kích thước (${formatBytes(total)}).`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Không tạo được ZIP.');
    } finally {
      setBusy('');
    }
  };

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      showToast('Đã sao chép!');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const reset = () => {
    setS(DEFAULT_SETTINGS);
    setBgImg(null);
    setLogoImg(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* bỏ qua */
    }
    showToast('Đã đặt lại về mặc định.');
  };

  const showSubtitle = t !== 'code';
  const showCta = t === 'launch';

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ImagePlus className="h-5 w-5 text-indigo-300" />
          <h1 className="text-sm font-bold">Tạo ảnh Open Graph</h1>
          <span className="text-xs text-slate-400 hidden sm:inline">Social card cho Facebook, X, LinkedIn - vẽ ngay trên trình duyệt</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reset} className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-100 bg-slate-700 hover:bg-slate-600 transition flex items-center gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" /> Đặt lại
          </button>
          <ShareLinkButton
            params={{ size: s.size, tpl: s.template, title: s.title, sub: s.subtitle, author: s.author, url: s.url }}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {/* ───── Xem trước + xuất (hiện trước trên di động) ───── */}
        <div className="space-y-4 lg:order-2 min-w-0">
          <div className={`${panel} lg:sticky lg:top-4`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={labelCls}>
                Xem trước {size.w}×{size.h} <span className="font-normal text-slate-400">- {size.note}</span>
              </span>
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={showSafe} onChange={(e) => setShowSafe(e.target.checked)} />
                <Shield className="h-3.5 w-3.5" /> Vùng an toàn
              </label>
            </div>
            <div ref={boxRef} className="w-full flex justify-center">
              <div
                className="relative rounded-lg overflow-hidden border border-slate-200 shadow-xs"
                style={{ width: dispW, height: dispH }}
              >
                <canvas ref={canvasRef} style={{ width: dispW, height: dispH, display: 'block' }} aria-label="Xem trước ảnh Open Graph" />
                {showSafe &&
                  zones.map((z) => (
                    <div
                      key={z.label}
                      title={z.label}
                      className={`absolute pointer-events-none ${
                        z.kind === 'trim' ? 'bg-red-500/35' : 'border-2 border-dashed border-emerald-400'
                      }`}
                      style={{
                        left: `${(z.x / size.w) * 100}%`,
                        top: `${(z.y / size.h) * 100}%`,
                        width: `${(z.w / size.w) * 100}%`,
                        height: `${(z.h / size.h) * 100}%`,
                      }}
                    />
                  ))}
              </div>
            </div>
            {showSafe && (
              <ul className="text-xs text-slate-500 space-y-0.5">
                {zones.map((z) => (
                  <li key={z.label} className="flex items-center gap-1.5">
                    <span className={`inline-block h-2.5 w-2.5 rounded-xs ${z.kind === 'trim' ? 'bg-red-500/60' : 'border border-dashed border-emerald-500'}`} />
                    {z.label}
                  </li>
                ))}
                <li>Giữ chữ và logo quan trọng bên trong các khung nét đứt.</li>
              </ul>
            )}
            <div className="flex flex-wrap gap-1">
              {OG_SIZES.map((z) => (
                <button
                  key={z.id}
                  onClick={() => set('size', z.id)}
                  className={`px-2 py-1 rounded-lg text-xs border transition ${
                    s.size === z.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                  title={z.note}
                >
                  {z.w}×{z.h}
                </button>
              ))}
            </div>

            <div className={`text-xs rounded-lg px-2.5 py-1.5 flex gap-1.5 items-start border ${
              tcInfo.warn ? 'text-amber-800 bg-amber-50 border-amber-200' : 'text-emerald-800 bg-emerald-50 border-emerald-200'
            }`}>
              {tcInfo.warn ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> : <Check className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
              <span>
                Tương phản chữ/nền: <b>{tcInfo.ratio.toFixed(2)}:1</b>
                {usesImageBg && bgImg && s.template !== 'minimal' ? ' (ước lượng theo lớp phủ)' : ''}
                {tcInfo.warn
                  ? ` - thấp hơn ${WCAG_AA}:1 (WCAG AA), chữ có thể khó đọc. Hãy đổi màu nền, tăng lớp phủ hoặc đổi màu chữ.`
                  : ` - đạt WCAG AA (≥ ${WCAG_AA}:1).`}
              </span>
            </div>
          </div>

          {/* Xuất */}
          <div className={panel}>
            <h2 className={h2Cls}>Xuất ảnh</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Định dạng">
                <Select value={s.format} onChange={(e) => set('format', e.target.value as ExportFormat)} className={inputCls}>
                  <option value="png">PNG (không mất chất lượng)</option>
                  <option value="jpeg">JPEG (nhẹ, tương thích nhất)</option>
                  <option value="webp">WebP (nhẹ nhất)</option>
                </Select>
              </Field>
              {s.format !== 'png' ? (
                <Range label="Chất lượng" value={Math.round(s.quality * 100)} min={30} max={100} onChange={(v) => set('quality', v / 100)} unit="%" />
              ) : (
                <div className="text-xs text-slate-500 self-end pb-1.5">PNG luôn giữ nguyên chất lượng.</div>
              )}
            </div>
            <p className="text-xs text-slate-600">
              Dung lượng ước tính:{' '}
              <b className="text-slate-800">{bytes === null ? 'đang tính...' : formatBytes(bytes)}</b> ({info.label}, {size.w}×{size.h})
            </p>
            {warnings.map((w) => (
              <p key={w} className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {w}
              </p>
            ))}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => void download()} disabled={busy !== ''} className={primaryBtn}>
                {busy === 'dl' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Tải xuống
              </button>
              <button onClick={() => void copyImage()} disabled={busy !== ''} className={btnCls}>
                {busy === 'copy' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                Sao chép ảnh
              </button>
              <button onClick={() => void downloadZip()} disabled={busy !== ''} className={btnCls}>
                {busy === 'zip' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
                Tải tất cả kích thước (ZIP)
              </button>
            </div>
          </div>

          {/* Meta tags */}
          <div className={panel}>
            <h2 className={h2Cls}>Meta tags</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="URL ảnh cuối cùng (sau khi upload)">
                <input
                  value={s.imageUrl}
                  onChange={(e) => set('imageUrl', e.target.value)}
                  placeholder="https://example.com/og-image.png"
                  className={`${inputCls} font-mono`}
                  spellCheck={false}
                />
              </Field>
              <Field label="Mô tả ảnh (og:image:alt)">
                <input value={s.alt} onChange={(e) => set('alt', e.target.value)} placeholder={s.title} className={inputCls} />
              </Field>
            </div>
            {urlProblem && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {urlProblem}
              </p>
            )}
            <CopyBlock title="Dán vào <head>" text={snippet} copied={copied} onCopy={() => void copySnippet()} />
            <p className="text-xs text-slate-500">
              Mẹo: X/Twitter tối đa 5 MB, Facebook khuyến nghị dưới 8 MB. Dùng ảnh 1200×630, URL tuyệt đối https, và kiểm tra lại bằng công cụ gỡ lỗi chia sẻ của từng nền tảng
              (cache có thể giữ ảnh cũ).
            </p>
          </div>
        </div>

        {/* ───── Điều khiển ───── */}
        <div className="space-y-4 lg:order-1 min-w-0">
          <div className={panel}>
            <h2 className={h2Cls}>Mẫu thiết kế</h2>
            <div className="grid grid-cols-2 gap-1.5">
              {TEMPLATES.map((tp) => (
                <button
                  key={tp.id}
                  onClick={() => set('template', tp.id)}
                  title={tp.hint}
                  className={`text-left px-2.5 py-2 rounded-lg border transition ${
                    s.template === tp.id ? 'bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500' : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-xs font-semibold text-slate-800">{tp.label}</div>
                  <div className="text-[11px] text-slate-500 leading-snug">{tp.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div className={panel}>
            <h2 className={h2Cls}>Nội dung</h2>
            <Field label={t === 'github' ? 'Tên repo (owner/repo)' : 'Tiêu đề'}>
              <textarea
                value={s.title}
                onChange={(e) => set('title', e.target.value)}
                rows={2}
                maxLength={300}
                className={inputCls}
                placeholder={t === 'github' ? 'vercel/next.js' : 'Tiêu đề bài viết'}
              />
            </Field>
            <div className="flex flex-wrap gap-1">
              {EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => set('title', (s.title + em).slice(0, 300))}
                  className="h-7 w-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-sm"
                  title="Chèn emoji vào cuối tiêu đề"
                >
                  {em}
                </button>
              ))}
            </div>
            {showSubtitle && (
              <Field label={t === 'github' ? 'Mô tả repo' : 'Phụ đề'}>
                <textarea value={s.subtitle} onChange={(e) => set('subtitle', e.target.value)} rows={2} maxLength={400} className={inputCls} />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label={t === 'code' ? 'Tên file (thanh tiêu đề)' : t === 'github' ? 'Nhãn (vd: Open source)' : 'Nhãn / badge'}>
                <input value={s.tag} onChange={(e) => set('tag', e.target.value)} maxLength={60} className={inputCls} />
              </Field>
              {t !== 'github' && (
                <Field label="Tác giả / thương hiệu">
                  <input value={s.author} onChange={(e) => set('author', e.target.value)} maxLength={80} className={inputCls} />
                </Field>
              )}
              {t !== 'github' && t !== 'code' && (
                <Field label="Ngày">
                  <input value={s.date} onChange={(e) => set('date', e.target.value)} maxLength={40} className={inputCls} />
                </Field>
              )}
              {t === 'blog' && (
                <Field label="Thời gian đọc">
                  <input value={s.readTime} onChange={(e) => set('readTime', e.target.value)} maxLength={40} className={inputCls} />
                </Field>
              )}
              {showCta && (
                <Field label="Nút CTA">
                  <input value={s.cta} onChange={(e) => set('cta', e.target.value)} maxLength={60} className={inputCls} />
                </Field>
              )}
              <Field label="URL / tên miền (chân trang)">
                <input value={s.url} onChange={(e) => set('url', e.target.value)} maxLength={120} className={inputCls} />
              </Field>
            </div>

            {t === 'code' && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <Field label="Ngôn ngữ">
                  <Seg value={s.codeLang} options={CODE_LANGS} onChange={(v: CodeLang) => set('codeLang', v)} />
                </Field>
                <Field label="Đoạn code (tối đa ~16 dòng hiển thị đẹp)">
                  <textarea
                    value={s.code}
                    onChange={(e) => set('code', e.target.value)}
                    rows={7}
                    maxLength={4000}
                    spellCheck={false}
                    className={`${inputCls} font-mono text-xs`}
                  />
                </Field>
              </div>
            )}

            {t === 'github' && (
              <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                <Field label="Ngôn ngữ chính">
                  <input value={s.ghLang} onChange={(e) => set('ghLang', e.target.value)} maxLength={40} className={inputCls} />
                </Field>
                <Field label="Topics (cách nhau bởi dấu phẩy)">
                  <input value={s.topics} onChange={(e) => set('topics', e.target.value)} maxLength={200} className={inputCls} />
                </Field>
                <Field label="Sao (stars)">
                  <input value={s.ghStars} onChange={(e) => set('ghStars', e.target.value)} maxLength={12} className={inputCls} />
                </Field>
                <Field label="Fork">
                  <input value={s.ghForks} onChange={(e) => set('ghForks', e.target.value)} maxLength={12} className={inputCls} />
                </Field>
                <Field label="Issues">
                  <input value={s.ghIssues} onChange={(e) => set('ghIssues', e.target.value)} maxLength={12} className={inputCls} />
                </Field>
                <p className="text-xs text-slate-500 self-end">Số liệu nhập tay, không gọi GitHub API.</p>
              </div>
            )}

            {t === 'pattern' && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <Field label="Kiểu họa tiết">
                  <Seg value={s.patternKind} options={PATTERN_KINDS} onChange={(v: PatternKind) => set('patternKind', v)} />
                </Field>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600">Seed {s.patternSeed}</span>
                  <button onClick={() => set('patternSeed', Math.floor(Math.random() * 999999))} className={btnCls}>
                    <Dices className="h-3.5 w-3.5" /> Ngẫu nhiên
                  </button>
                </div>
              </div>
            )}

            {t === 'photo' && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <Field label="Bố cục ảnh">
                  <Seg
                    value={s.photoLayout}
                    options={[
                      { id: 'full', label: 'Ảnh nền toàn khung' },
                      { id: 'left', label: 'Ảnh bên trái' },
                      { id: 'right', label: 'Ảnh bên phải' },
                    ]}
                    onChange={(v: PhotoLayout) => set('photoLayout', v)}
                  />
                </Field>
                {!bgImg && <p className="text-xs text-amber-700">Chưa có ảnh: hãy tải ảnh ở mục &quot;Nền&quot; bên dưới.</p>}
              </div>
            )}
          </div>

          <div className={panel}>
            <h2 className={h2Cls}>Nền & màu</h2>
            {t === 'minimal' && <p className="text-xs text-slate-500">Mẫu Tối giản dùng nền tối riêng; chỉ màu nhấn có tác dụng.</p>}
            {t !== 'minimal' && (
              <>
                <Seg
                  value={s.bgType}
                  options={[
                    { id: 'solid', label: 'Màu đơn' },
                    { id: 'gradient2', label: 'Gradient 2 màu' },
                    { id: 'gradient3', label: 'Gradient 3 màu' },
                    { id: 'image', label: 'Ảnh' },
                  ]}
                  onChange={(v: BgType) => set('bgType', v)}
                />
                {s.bgType !== 'image' && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <ColorField label={s.bgType === 'solid' ? 'Màu nền' : 'Màu 1'} value={s.c1} onChange={(v) => set('c1', v)} />
                    {s.bgType !== 'solid' && <ColorField label="Màu 2" value={s.c2} onChange={(v) => set('c2', v)} />}
                    {s.bgType === 'gradient3' && <ColorField label="Màu 3" value={s.c3} onChange={(v) => set('c3', v)} />}
                  </div>
                )}
                {s.bgType !== 'image' && s.bgType !== 'solid' && (
                  <Range label="Góc gradient" value={s.angle} min={0} max={360} onChange={(v) => set('angle', v)} unit="°" />
                )}
                {(s.bgType === 'image' || t === 'photo') && (
                  <div className="space-y-2 border-t border-slate-100 pt-3">
                    <UploadRow
                      label="Tải ảnh nền"
                      img={bgImg}
                      busy={loadingImg === 'bg'}
                      onPick={(f) => void pickImage(f, 'bg')}
                      onClear={() => setBgImg(null)}
                    />
                    {s.bgType === 'image' && !bgImg && t !== 'photo' && (
                      <p className="text-xs text-amber-700">Chưa có ảnh: đang dùng gradient thay thế. Ảnh không được lưu giữa các lần mở trang.</p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Lớp phủ">
                        <Seg
                          value={s.overlayTone}
                          options={[
                            { id: 'dark', label: 'Tối' },
                            { id: 'light', label: 'Sáng' },
                          ]}
                          onChange={(v) => set('overlayTone', v)}
                        />
                      </Field>
                      <Range label="Độ đậm lớp phủ" value={s.overlayOpacity} min={0} max={90} onChange={(v) => set('overlayOpacity', v)} unit="%" />
                      <Range label="Làm mờ ảnh" value={s.blur} min={0} max={30} onChange={(v) => set('blur', v)} unit="px" />
                    </div>
                  </div>
                )}
              </>
            )}
            <div className="border-t border-slate-100 pt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <ColorField label="Màu nhấn" value={s.accent} onChange={(v) => set('accent', v)} />
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={s.textAuto} onChange={(e) => set('textAuto', e.target.checked)} />
                Tự chọn màu chữ (tương phản)
              </label>
              {!s.textAuto && <ColorField label="Màu chữ" value={s.textColor} onChange={(v) => set('textColor', v)} />}
            </div>
          </div>

          <div className={panel}>
            <h2 className={h2Cls}>Chữ & bố cục</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phông chữ">
                <Select searchThreshold={0} value={s.fontFamily} onChange={(e) => set('fontFamily', e.target.value as FontId)} className={inputCls}>
                  {FONT_STACKS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Độ đậm">
                <Select value={s.weight} onChange={(e) => set('weight', Number(e.target.value))} className={inputCls}>
                  {[400, 500, 600, 700, 800, 900].map((wt) => (
                    <option key={wt} value={wt}>
                      {wt}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Căn lề">
              <Seg
                value={s.align}
                options={[
                  { id: 'left', label: 'Trái' },
                  { id: 'center', label: 'Giữa' },
                  { id: 'right', label: 'Phải' },
                ]}
                onChange={(v: Align) => set('align', v)}
              />
            </Field>
            <Range label="Lề (padding)" value={s.padding} min={16} max={160} onChange={(v) => set('padding', v)} unit="px" />
            <div className="grid grid-cols-2 gap-3 items-end">
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={s.titleAuto} onChange={(e) => set('titleAuto', e.target.checked)} />
                Tự vừa cỡ chữ tiêu đề
              </label>
              <Field label="Số dòng tối đa">
                <Select value={s.maxLines} onChange={(e) => set('maxLines', Number(e.target.value))} className={inputCls}>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} dòng
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {!s.titleAuto && <Range label="Cỡ chữ tiêu đề" value={s.titleSize} min={20} max={220} onChange={(v) => set('titleSize', v)} unit="px" />}
            <p className="text-xs text-slate-500">Chữ quá dài sẽ được rút gọn bằng dấu &quot;…&quot; khi vượt số dòng. Hỗ trợ tiếng Việt, CJK và emoji.</p>
          </div>

          <div className={panel}>
            <h2 className={h2Cls}>Logo / avatar</h2>
            <UploadRow
              label="Tải logo / avatar"
              img={logoImg}
              busy={loadingImg === 'logo'}
              onPick={(f) => void pickImage(f, 'logo')}
              onClear={() => setLogoImg(null)}
            />
            <Field label="Kiểu cắt">
              <Seg
                value={s.logoShape}
                options={[
                  { id: 'circle', label: 'Tròn' },
                  { id: 'rounded', label: 'Bo góc' },
                  { id: 'none', label: 'Giữ nguyên' },
                ]}
                onChange={(v: LogoShape) => set('logoShape', v)}
              />
            </Field>
            <p className="text-xs text-slate-500">
              Logo xuất hiện ở đầu khối (mẫu Ra mắt sản phẩm) hoặc cạnh tên tác giả ở chân trang. Ảnh tải lên chỉ xử lý trong trình duyệt và không được lưu lại.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
