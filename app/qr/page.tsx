'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  QrCode, Copy, Download, Image as ImageIcon, Camera, CameraOff, ScanLine, ExternalLink, AlertTriangle, Upload, X,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  buildWifi, buildVCard, buildEmail, buildSms, buildTel, buildGeo, qrContrast, parseQrContent, isSafeHttpUrl,
  WifiSecurity, VCardInput,
} from '@/lib/qr-tools';

type ContentType = 'text' | 'wifi' | 'vcard' | 'email' | 'sms' | 'tel' | 'geo';
const TYPES: { id: ContentType; label: string }[] = [
  { id: 'text', label: 'Văn bản / URL' },
  { id: 'wifi', label: 'Wi-Fi' },
  { id: 'vcard', label: 'Danh bạ (vCard)' },
  { id: 'email', label: 'Email' },
  { id: 'sms', label: 'SMS' },
  { id: 'tel', label: 'Số điện thoại' },
  { id: 'geo', label: 'Địa lý' },
];
type EC = 'L' | 'M' | 'Q' | 'H';
const MAX_TEXT = 2000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const inputCls = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-hidden focus:border-indigo-400';
const btnCls = 'px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1.5 disabled:opacity-50';
const labelCls = 'block text-[11px] font-medium text-slate-500 mb-1';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className={labelCls}>{label}</span>{children}</label>;
}

export default function QrPage() {
  const { showToast } = useApp();
  const [tab, setTab] = useState<'create' | 'read'>('create');

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <QrCode className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Mã QR</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">Tạo mã QR (văn bản, Wi-Fi, danh bạ...) và đọc mã QR từ ảnh hoặc camera. Xử lý hoàn toàn trên trình duyệt.</p>
          </div>
        </div>
        <div className="flex gap-1 bg-slate-800 rounded-lg p-0.5">
          {([['create', 'Tạo mã', QrCode], ['read', 'Đọc mã', ScanLine]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition ${tab === id ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white'}`}>
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'create' ? <Creator showToast={showToast} /> : <Reader showToast={showToast} />}
    </div>
  );
}

// ======================= TẠO =======================
function Creator({ showToast }: { showToast: (m: string) => void }) {
  const [type, setType] = useState<ContentType>('text');
  const [text, setText] = useState('https://example.com');
  const [wifi, setWifi] = useState({ ssid: '', password: '', security: 'WPA' as WifiSecurity, hidden: false });
  const [vc, setVc] = useState<VCardInput>({ firstName: '', lastName: '', org: '', title: '', phone: '', email: '', url: '', address: '', note: '' });
  const [mail, setMail] = useState({ to: '', subject: '', body: '' });
  const [sms, setSms] = useState({ phone: '', body: '' });
  const [tel, setTel] = useState('');
  const [geo, setGeo] = useState({ lat: '', lng: '' });
  const [ec, setEc] = useState<EC>('M');
  const [size, setSize] = useState(300);
  const [margin, setMargin] = useState(2);
  const [fg, setFg] = useState('#000000');
  const [bg, setBg] = useState('#ffffff');
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [logoName, setLogoName] = useState('');
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const p = readShareParams();
    const t = p.get('type') as ContentType | null;
    if (t && TYPES.some((x) => x.id === t)) setType(t);
    if (p.get('text')) setText(p.get('text')!);
    const e = p.get('ec');
    if (e === 'L' || e === 'M' || e === 'Q' || e === 'H') setEc(e);
    const s = Number(p.get('size'));
    if (s >= 100 && s <= 1000) setSize(s);
  }, []);

  const payload = useMemo(() => {
    switch (type) {
      case 'text': return text;
      case 'wifi': return wifi.ssid ? buildWifi(wifi) : '';
      case 'vcard': return vc.firstName || vc.lastName || vc.phone || vc.email ? buildVCard(vc) : '';
      case 'email': return mail.to ? buildEmail(mail.to, mail.subject, mail.body) : '';
      case 'sms': return sms.phone ? buildSms(sms.phone, sms.body) : '';
      case 'tel': return tel ? buildTel(tel) : '';
      case 'geo': return buildGeo(geo.lat, geo.lng) ?? '';
    }
  }, [type, text, wifi, vc, mail, sms, tel, geo]);

  const effEc: EC = logo ? 'H' : ec;
  const contrast = useMemo(() => qrContrast(fg, bg), [fg, bg]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!payload) { setError(''); canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height); return; }
    if (payload.length > MAX_TEXT) { setError(`Nội dung quá dài (tối đa ${MAX_TEXT} ký tự).`); return; }
    let cancelled = false;
    QRCode.toCanvas(canvas, payload, { errorCorrectionLevel: effEc, width: size, margin, color: { dark: fg, light: bg } })
      .then(() => {
        if (cancelled) return;
        setError('');
        if (logo) {
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          const box = Math.round(canvas.width * 0.2);
          const x = (canvas.width - box) / 2;
          ctx.fillStyle = bg;
          ctx.fillRect(x - 4, x - 4, box + 8, box + 8);
          const r = Math.min(box / logo.naturalWidth, box / logo.naturalHeight);
          const w = logo.naturalWidth * r, h = logo.naturalHeight * r;
          ctx.drawImage(logo, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        }
      })
      .catch(() => { if (!cancelled) setError('Không thể tạo mã QR: nội dung quá dài hoặc không hợp lệ.'); });
    return () => { cancelled = true; };
  }, [payload, effEc, size, margin, fg, bg, logo]);

  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const downloadPng = () => canvasRef.current?.toBlob((b) => b && download(b, 'qr-code.png'));
  const downloadSvg = async () => {
    try {
      const svg = await QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: effEc, margin, width: size, color: { dark: fg, light: bg } });
      download(new Blob([svg], { type: 'image/svg+xml' }), 'qr-code.svg');
      if (logo) showToast('Tệp SVG không chứa logo.');
    } catch { showToast('Không thể xuất SVG.'); }
  };
  const copyImage = () => {
    canvasRef.current?.toBlob(async (b) => {
      if (!b) return;
      try {
        if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('unsupported');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
        showToast('Đã sao chép ảnh QR!');
      } catch { showToast('Trình duyệt không hỗ trợ sao chép ảnh, hãy tải PNG.'); }
    });
  };

  const onLogo = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/') || f.size > 2 * 1024 * 1024) { showToast('Logo phải là ảnh nhỏ hơn 2MB.'); return; }
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => { setLogo(img); setLogoName(f.name); URL.revokeObjectURL(url); };
    img.onerror = () => { showToast('Không đọc được ảnh logo.'); URL.revokeObjectURL(url); };
    img.src = url;
  };

  const set = <T,>(setter: (fn: (p: T) => T) => void, k: keyof T, v: unknown) => setter((p) => ({ ...p, [k]: v }));
  const ready = !!payload && !error;

  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-3.5">
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {TYPES.map((t) => (
            <button key={t.id} onClick={() => setType(t.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${type === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {type === 'text' && (
          <Field label={`Nội dung (${text.length}/${MAX_TEXT})`}>
            <textarea className={inputCls} rows={5} value={text} maxLength={MAX_TEXT} onChange={(e) => setText(e.target.value)} placeholder="Nhập văn bản hoặc đường dẫn URL" />
          </Field>
        )}
        {type === 'wifi' && (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Tên mạng (SSID)"><input className={inputCls} value={wifi.ssid} onChange={(e) => set(setWifi, 'ssid', e.target.value)} /></Field>
            <Field label="Mật khẩu"><input className={inputCls} value={wifi.password} disabled={wifi.security === 'nopass'} onChange={(e) => set(setWifi, 'password', e.target.value)} /></Field>
            <Field label="Bảo mật">
              <select className={inputCls} value={wifi.security} onChange={(e) => set(setWifi, 'security', e.target.value)}>
                <option value="WPA">WPA/WPA2/WPA3</option><option value="WEP">WEP</option><option value="nopass">Không mật khẩu</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 text-xs text-slate-600 mt-5">
              <input type="checkbox" checked={wifi.hidden} onChange={(e) => set(setWifi, 'hidden', e.target.checked)} /> Mạng ẩn
            </label>
          </div>
        )}
        {type === 'vcard' && (
          <div className="grid sm:grid-cols-2 gap-3">
            {([['lastName', 'Họ'], ['firstName', 'Tên'], ['org', 'Công ty'], ['title', 'Chức vụ'], ['phone', 'Điện thoại'], ['email', 'Email'], ['url', 'Website'], ['address', 'Địa chỉ']] as const).map(([k, l]) => (
              <Field key={k} label={l}><input className={inputCls} value={vc[k]} onChange={(e) => set(setVc, k, e.target.value)} /></Field>
            ))}
            <div className="sm:col-span-2"><Field label="Ghi chú"><input className={inputCls} value={vc.note} onChange={(e) => set(setVc, 'note', e.target.value)} /></Field></div>
          </div>
        )}
        {type === 'email' && (
          <div className="space-y-3">
            <Field label="Gửi tới"><input className={inputCls} type="email" value={mail.to} onChange={(e) => set(setMail, 'to', e.target.value)} /></Field>
            <Field label="Tiêu đề"><input className={inputCls} value={mail.subject} onChange={(e) => set(setMail, 'subject', e.target.value)} /></Field>
            <Field label="Nội dung"><textarea className={inputCls} rows={3} value={mail.body} onChange={(e) => set(setMail, 'body', e.target.value)} /></Field>
          </div>
        )}
        {type === 'sms' && (
          <div className="space-y-3">
            <Field label="Số điện thoại"><input className={inputCls} value={sms.phone} onChange={(e) => set(setSms, 'phone', e.target.value)} /></Field>
            <Field label="Tin nhắn"><textarea className={inputCls} rows={3} value={sms.body} onChange={(e) => set(setSms, 'body', e.target.value)} /></Field>
          </div>
        )}
        {type === 'tel' && <Field label="Số điện thoại"><input className={inputCls} value={tel} onChange={(e) => setTel(e.target.value)} placeholder="+84 912 345 678" /></Field>}
        {type === 'geo' && (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Vĩ độ (-90 đến 90)"><input className={inputCls} value={geo.lat} onChange={(e) => set(setGeo, 'lat', e.target.value)} placeholder="21.0285" /></Field>
            <Field label="Kinh độ (-180 đến 180)"><input className={inputCls} value={geo.lng} onChange={(e) => set(setGeo, 'lng', e.target.value)} placeholder="105.8542" /></Field>
            {(geo.lat || geo.lng) && !payload && <p className="text-xs text-red-600 sm:col-span-2">Toạ độ không hợp lệ.</p>}
          </div>
        )}

        <div className="border-t border-slate-100 pt-4 grid sm:grid-cols-2 gap-3">
          <Field label={`Mức sửa lỗi${logo ? ' (bị ép về H do có logo)' : ''}`}>
            <div className="flex gap-1">
              {(['L', 'M', 'Q', 'H'] as const).map((l) => (
                <button key={l} onClick={() => setEc(l)} disabled={!!logo}
                  className={`flex-1 py-1 rounded-lg text-xs font-medium border ${effEc === l ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'} disabled:opacity-70`}>{l}</button>
              ))}
            </div>
          </Field>
          <Field label={`Kích thước: ${size}px`}><input type="range" min={100} max={1000} step={10} value={size} onChange={(e) => setSize(+e.target.value)} className="w-full" /></Field>
          <Field label={`Lề: ${margin} ô`}><input type="range" min={0} max={8} value={margin} onChange={(e) => setMargin(+e.target.value)} className="w-full" /></Field>
          <div className="flex gap-3">
            <Field label="Màu mã"><input type="color" value={fg} onChange={(e) => setFg(e.target.value)} className="h-8 w-14 rounded border border-slate-200" /></Field>
            <Field label="Màu nền"><input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="h-8 w-14 rounded border border-slate-200" /></Field>
          </div>
          <div className="sm:col-span-2">
            <span className={labelCls}>Logo ở giữa (chỉ cho PNG)</span>
            <div className="flex items-center gap-2">
              <label className={`${btnCls} cursor-pointer`}><ImageIcon className="h-3.5 w-3.5" />Chọn logo
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { onLogo(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {logo && <button className={btnCls} onClick={() => { setLogo(null); setLogoName(''); }}><X className="h-3.5 w-3.5" />Bỏ {logoName.slice(0, 20)}</button>}
            </div>
          </div>
        </div>
        {contrast.message && (
          <div className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 ${contrast.level === 'bad' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
            <AlertTriangle className="h-4 w-4 shrink-0" />{contrast.message} (tỉ lệ {contrast.ratio.toFixed(1)}:1)
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 h-fit">
        <div className="flex items-center justify-center bg-slate-50 rounded-lg p-3 min-h-[200px] overflow-auto">
          <canvas ref={canvasRef} className={`max-w-full h-auto ${payload && !error ? '' : 'hidden'}`} />
          {(!payload || error) && <p className={`text-xs text-center ${error ? 'text-red-600' : 'text-slate-400'}`}>{error || 'Nhập nội dung để xem trước mã QR'}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button className={btnCls} disabled={!ready} onClick={downloadPng}><Download className="h-3.5 w-3.5" />PNG</button>
          <button className={btnCls} disabled={!ready} onClick={downloadSvg}><Download className="h-3.5 w-3.5" />SVG</button>
          <button className={btnCls} disabled={!ready} onClick={copyImage}><Copy className="h-3.5 w-3.5" />Chép ảnh</button>
          <ShareLinkButton params={{ type, text: type === 'text' && text.length <= 300 ? text : undefined, ec, size: String(size) }} />
        </div>
      </div>
    </div>
  );
}

// ======================= ĐỌC =======================
function Reader({ showToast }: { showToast: (m: string) => void }) {
  const [result, setResult] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState('');
  const [camOn, setCamOn] = useState(false);
  const [dragging, setDragging] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamOn(false);
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  const decodeImage = useCallback(async (blob: Blob) => {
    if (!blob.type.startsWith('image/')) { setMessage('Tệp không phải là ảnh.'); return; }
    if (blob.size > MAX_IMAGE_BYTES) { setMessage('Ảnh quá lớn (tối đa 15MB).'); return; }
    setMessage(''); setResult(null);
    const url = URL.createObjectURL(blob);
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return url; });
    try {
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      const d = ctx.getImageData(0, 0, c.width, c.height);
      const code = jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' });
      if (code) setResult(code.data); else setMessage('Không tìm thấy mã QR trong ảnh. Hãy thử ảnh rõ nét hơn.');
    } catch { setMessage('Không đọc được ảnh này.'); }
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); stopCamera(); decodeImage(f); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [decodeImage, stopCamera]);
  useEffect(() => () => { setPreview((old) => { if (old) URL.revokeObjectURL(old); return ''; }); }, []);

  const startCamera = async () => {
    setMessage(''); setResult(null);
    if (!navigator.mediaDevices?.getUserMedia) { setMessage('Trình duyệt không hỗ trợ camera (cần HTTPS).'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      setCamOn(true);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      let last = 0;
      const loop = (t: number) => {
        if (!streamRef.current) return;
        if (t - last > 120 && v.videoWidth) {
          last = t;
          const scale = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight));
          canvas.width = Math.round(v.videoWidth * scale); canvas.height = Math.round(v.videoHeight * scale);
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' });
          if (code) { setResult(code.data); stopCamera(); return; }
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      stopCamera();
      const name = (e as DOMException)?.name;
      setMessage(name === 'NotAllowedError' || name === 'SecurityError' ? 'Bạn đã từ chối quyền truy cập camera. Hãy cho phép camera trong cài đặt trình duyệt.'
        : name === 'NotFoundError' ? 'Không tìm thấy camera trên thiết bị.'
        : name === 'NotReadableError' ? 'Camera đang được ứng dụng khác sử dụng.'
        : 'Không thể mở camera.');
    }
  };

  const copy = async (s: string) => {
    try { await navigator.clipboard.writeText(s); showToast('Đã sao chép!'); } catch { showToast('Lỗi khi sao chép vào bộ nhớ tạm.'); }
  };
  const parsed = result !== null ? parseQrContent(result) : null;

  return (
    <div className="grid lg:grid-cols-2 gap-3.5">
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) { stopCamera(); decodeImage(f); } }}
          className={`border-2 border-dashed rounded-xl p-6 text-center text-xs text-slate-500 transition ${dragging ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200'}`}>
          <Upload className="h-6 w-6 mx-auto mb-2 text-slate-400" />
          Kéo thả ảnh vào đây, dán ảnh (Ctrl+V) hoặc
          <div className="mt-2">
            <label className={`${btnCls} inline-flex cursor-pointer`}><ImageIcon className="h-3.5 w-3.5" />Chọn ảnh
              <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { stopCamera(); decodeImage(f); } e.target.value = ''; }} />
            </label>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {camOn
            ? <button className={btnCls} onClick={stopCamera}><CameraOff className="h-3.5 w-3.5" />Tắt camera</button>
            : <button className={btnCls} onClick={startCamera}><Camera className="h-3.5 w-3.5" />Quét bằng camera</button>}
        </div>
        <video ref={videoRef} muted playsInline className={`w-full rounded-lg bg-black ${camOn ? '' : 'hidden'}`} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview && !camOn && <img src={preview} alt="Ảnh đã chọn" className="max-h-64 mx-auto rounded-lg border border-slate-200" />}
        {message && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{message}</p>}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 h-fit">
        <h2 className="text-sm font-semibold text-slate-800">Kết quả</h2>
        {result === null ? <p className="text-xs text-slate-400">Chưa có kết quả. Chọn ảnh hoặc bật camera để quét.</p> : (
          <>
            <pre className="whitespace-pre-wrap break-all text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-64 overflow-auto">{result}</pre>
            {parsed?.kind === 'url' && (
              <div className="space-y-1">
                <p className="text-[11px] text-amber-700">Chỉ mở link nếu bạn tin tưởng nguồn mã QR.</p>
                {isSafeHttpUrl(parsed.url) && (
                  <a href={parsed.url} target="_blank" rel="noopener noreferrer" className={`${btnCls} inline-flex`}><ExternalLink className="h-3.5 w-3.5" />Mở link</a>
                )}
              </div>
            )}
            {parsed?.kind === 'wifi' && (
              <Info rows={[['Loại', 'Wi-Fi'], ['Tên mạng', parsed.ssid], ['Mật khẩu', parsed.password || '(không có)'], ['Bảo mật', parsed.security], ['Mạng ẩn', parsed.hidden ? 'Có' : 'Không']]} />
            )}
            {parsed?.kind === 'vcard' && <Info rows={[['Loại', 'Danh bạ (vCard)'], ...parsed.fields.map((f) => [f.label, f.value] as [string, string])]} />}
            {parsed?.kind === 'email' && <Info rows={[['Loại', 'Email'], ['Tới', parsed.to], ['Tiêu đề', parsed.subject], ['Nội dung', parsed.body]]} />}
            {parsed?.kind === 'sms' && <Info rows={[['Loại', 'SMS'], ['Số', parsed.phone], ['Tin nhắn', parsed.body]]} />}
            {parsed?.kind === 'tel' && <Info rows={[['Loại', 'Số điện thoại'], ['Số', parsed.phone]]} />}
            {parsed?.kind === 'geo' && <Info rows={[['Loại', 'Vị trí'], ['Vĩ độ', parsed.lat], ['Kinh độ', parsed.lng]]} />}
            <div className="flex gap-1.5">
              <button className={btnCls} onClick={() => copy(result)}><Copy className="h-3.5 w-3.5" />Sao chép</button>
              {parsed?.kind === 'wifi' && parsed.password && <button className={btnCls} onClick={() => copy(parsed.password)}><Copy className="h-3.5 w-3.5" />Chép mật khẩu</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Info({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="text-xs grid grid-cols-[90px_1fr] gap-x-2 gap-y-1">
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className="text-slate-800 break-all whitespace-pre-wrap">{v}</dd></div>
      ))}
    </dl>
  );
}
