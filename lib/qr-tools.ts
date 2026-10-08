/** Logic tạo/đọc mã QR (không phụ thuộc React). */
import { parseColor, contrastRatio, relativeLuminance } from './color-tools';

// ---------- Tạo payload ----------
/** Escape theo chuẩn Wi-Fi QR: \ ; , : " */
export function escapeWifi(s: string): string {
  return s.replace(/([\\;,:"])/g, '\\$1');
}

export type WifiSecurity = 'WPA' | 'WEP' | 'nopass';
export function buildWifi(o: { ssid: string; password: string; security: WifiSecurity; hidden: boolean }): string {
  const pass = o.security === 'nopass' ? '' : o.password;
  return `WIFI:T:${o.security};S:${escapeWifi(o.ssid)};P:${escapeWifi(pass)};H:${o.hidden ? 'true' : ''};;`;
}

function escapeVCard(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([;,])/g, '\\$1');
}
export interface VCardInput {
  firstName: string; lastName: string; org: string; title: string;
  phone: string; email: string; url: string; address: string; note: string;
}
export function buildVCard(v: VCardInput): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  lines.push(`N:${escapeVCard(v.lastName)};${escapeVCard(v.firstName)};;;`);
  lines.push(`FN:${escapeVCard([v.firstName, v.lastName].filter(Boolean).join(' '))}`);
  if (v.org) lines.push(`ORG:${escapeVCard(v.org)}`);
  if (v.title) lines.push(`TITLE:${escapeVCard(v.title)}`);
  if (v.phone) lines.push(`TEL;TYPE=CELL:${v.phone.replace(/[\r\n]/g, '')}`);
  if (v.email) lines.push(`EMAIL:${v.email.replace(/[\r\n]/g, '')}`);
  if (v.url) lines.push(`URL:${v.url.replace(/[\r\n]/g, '')}`);
  if (v.address) lines.push(`ADR:;;${escapeVCard(v.address)};;;;`);
  if (v.note) lines.push(`NOTE:${escapeVCard(v.note)}`);
  lines.push('END:VCARD');
  return lines.join('\n');
}

export function buildEmail(to: string, subject: string, body: string): string {
  const q: string[] = [];
  if (subject) q.push(`subject=${encodeURIComponent(subject)}`);
  if (body) q.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${to.trim()}${q.length ? '?' + q.join('&') : ''}`;
}
export function buildSms(phone: string, body: string): string {
  return `SMSTO:${phone.trim()}:${body}`;
}
export function buildTel(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}
export function buildGeo(lat: string, lng: string): string | null {
  const a = Number(lat), b = Number(lng);
  if (lat.trim() === '' || lng.trim() === '' || !isFinite(a) || !isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return `geo:${a},${b}`;
}

// ---------- Tương phản ----------
export interface QrContrast { ratio: number; inverted: boolean; level: 'ok' | 'low' | 'bad'; message: string }
export function qrContrast(fg: string, bg: string): QrContrast {
  const f = parseColor(fg), b = parseColor(bg);
  if (!f || !b) return { ratio: 0, inverted: false, level: 'bad', message: 'Màu không hợp lệ.' };
  const ratio = contrastRatio(f, b);
  const inverted = relativeLuminance(f) > relativeLuminance(b);
  if (ratio < 3) return { ratio, inverted, level: 'bad', message: 'Độ tương phản quá thấp, mã QR rất khó quét. Hãy dùng màu đậm trên nền sáng.' };
  if (inverted) return { ratio, inverted, level: 'low', message: 'Mã đảo màu (chấm sáng trên nền tối): nhiều ứng dụng quét không đọc được.' };
  if (ratio < 4.5) return { ratio, inverted, level: 'low', message: 'Độ tương phản hơi thấp, có thể khó quét trong điều kiện thiếu sáng.' };
  return { ratio, inverted, level: 'ok', message: '' };
}

// ---------- Phân tích nội dung đã đọc ----------
export type ParsedQr =
  | { kind: 'url'; url: string }
  | { kind: 'wifi'; ssid: string; password: string; security: string; hidden: boolean }
  | { kind: 'vcard'; fields: { label: string; value: string }[] }
  | { kind: 'email'; to: string; subject: string; body: string }
  | { kind: 'sms'; phone: string; body: string }
  | { kind: 'tel'; phone: string }
  | { kind: 'geo'; lat: string; lng: string }
  | { kind: 'text' };

/** Tách chuỗi theo dấu `;` chưa bị escape. */
function splitUnescaped(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) { cur += s[i] + s[i + 1]; i++; }
    else if (s[i] === sep) { out.push(cur); cur = ''; }
    else cur += s[i];
  }
  out.push(cur);
  return out;
}
const unescapeWifi = (s: string) => s.replace(/\\([\\;,:"])/g, '$1');

export function isSafeHttpUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

const VCARD_LABELS: Record<string, string> = {
  FN: 'Họ tên', ORG: 'Công ty', TITLE: 'Chức vụ', TEL: 'Điện thoại', EMAIL: 'Email', URL: 'Website', ADR: 'Địa chỉ', NOTE: 'Ghi chú',
};

export function parseQrContent(text: string): ParsedQr {
  const t = text.trim();
  if (/^WIFI:/i.test(t)) {
    const fields: Record<string, string> = {};
    for (const part of splitUnescaped(t.slice(5), ';')) {
      const i = part.indexOf(':');
      if (i > 0) fields[part.slice(0, i).toUpperCase()] = unescapeWifi(part.slice(i + 1));
    }
    return { kind: 'wifi', ssid: fields.S ?? '', password: fields.P ?? '', security: fields.T || 'nopass', hidden: /^true$/i.test(fields.H ?? '') };
  }
  if (/^BEGIN:VCARD/i.test(t)) {
    const fields: { label: string; value: string }[] = [];
    for (const line of t.split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const key = line.slice(0, i).split(';')[0].toUpperCase();
      if (VCARD_LABELS[key]) {
        const val = line.slice(i + 1).split(';').filter(Boolean).join(', ').replace(/\\n/gi, '\n').replace(/\\([;,\\])/g, '$1');
        if (val) fields.push({ label: VCARD_LABELS[key], value: val });
      }
    }
    return { kind: 'vcard', fields };
  }
  if (/^mailto:/i.test(t)) {
    const rest = t.slice(7);
    const [to, qs = ''] = rest.split('?');
    const p = new URLSearchParams(qs);
    return { kind: 'email', to: decodeURIComponentSafe(to), subject: p.get('subject') ?? '', body: p.get('body') ?? '' };
  }
  if (/^smsto?:/i.test(t)) {
    const rest = t.replace(/^smsto?:/i, '');
    const i = rest.indexOf(':');
    if (i >= 0) return { kind: 'sms', phone: rest.slice(0, i), body: rest.slice(i + 1) };
    const [phone, qs = ''] = rest.split('?');
    return { kind: 'sms', phone, body: new URLSearchParams(qs).get('body') ?? '' };
  }
  if (/^tel:/i.test(t)) return { kind: 'tel', phone: t.slice(4) };
  const geo = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i.exec(t);
  if (geo) return { kind: 'geo', lat: geo[1], lng: geo[2] };
  if (isSafeHttpUrl(t) && /^https?:\/\//i.test(t)) return { kind: 'url', url: t };
  return { kind: 'text' };
}

function decodeURIComponentSafe(s: string) {
  try { return decodeURIComponent(s); } catch { return s; }
}
