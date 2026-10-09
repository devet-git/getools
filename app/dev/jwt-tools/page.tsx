'use client';

import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Copy, ShieldAlert, AlertTriangle, Info, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import {
  ALGS,
  CLAIM_INFO,
  HEADER_INFO,
  JwtAlg,
  JwtWarning,
  KeyKind,
  GeneratedKeyPair,
  SAMPLE_HS256_SECRET,
  SAMPLE_HS256_TOKEN,
  SecretEncoding,
  VerifyResult,
  addClaim,
  nowSeconds,
  algFamily,
  analyzeTimes,
  defaultHeaderJson,
  defaultPayloadJson,
  generateKeyPair,
  headerWarnings,
  isJwtAlg,
  jwkThumbprint,
  jwkToPem,
  parseJwt,
  parseJwkText,
  pemToJwk,
  randomHsSecret,
  signJwt,
  syncHeaderAlg,
  verifyJwt,
} from '@/lib/jwt-tools';
import { Select } from '@/components/ui/searchable-select';

type Tab = 'verify' | 'sign' | 'keys';

const levelStyle = {
  danger: 'bg-red-50 border-red-200 text-red-800',
  warn: 'bg-amber-50 border-amber-200 text-amber-800',
  info: 'bg-indigo-50 border-indigo-200 text-indigo-800',
} as const;

const inputCls = 'w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-hidden';
const areaCls =
  'w-full p-3 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-indigo-500 outline-hidden resize-y leading-relaxed text-slate-800';
const btnCls = 'px-2.5 py-1.5 text-xs font-medium rounded-lg border transition';
const btnPrimary = `${btnCls} text-white bg-indigo-600 hover:bg-indigo-700 border-indigo-600`;
const btnSecondary = `${btnCls} text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border-indigo-200`;

function Warnings({ items }: { items: JwtWarning[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      {items.map((w, i) => (
        <div key={i} className={`flex gap-2 text-xs border rounded-lg px-3 py-2 ${levelStyle[w.level]}`}>
          {w.level === 'danger' ? <ShieldAlert className="h-4 w-4 shrink-0" /> : w.level === 'warn' ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <Info className="h-4 w-4 shrink-0" />}
          <span>{w.text}</span>
        </div>
      ))}
    </div>
  );
}

function Panel({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border shadow-xs p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function AlgSelect({ value, onChange, label }: { value: JwtAlg; onChange: (a: JwtAlg) => void; label: string }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as JwtAlg)} className={inputCls + ' w-auto font-mono'} aria-label={label}>
      {ALGS.map((a) => (
        <option key={a} value={a}>{a}</option>
      ))}
    </Select>
  );
}

function EncodingSelect({ value, onChange }: { value: SecretEncoding; onChange: (e: SecretEncoding) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as SecretEncoding)} className={inputCls + ' w-auto'} aria-label="Định dạng secret">
      <option value="text">Secret dạng văn bản</option>
      <option value="base64">Secret dạng Base64</option>
      <option value="hex">Secret dạng hex</option>
    </Select>
  );
}

function ColoredToken({ token }: { token: string }) {
  const parts = token.split('.');
  return (
    <div className="font-mono text-xs break-all leading-relaxed bg-slate-50 border border-slate-200 rounded-lg p-3">
      <span className="text-red-600">{parts[0]}</span>
      <span className="text-slate-400">.</span>
      <span className="text-indigo-600">{parts[1] ?? ''}</span>
      <span className="text-slate-400">.</span>
      <span className="text-emerald-600">{parts[2] ?? ''}</span>
    </div>
  );
}

function ClaimTable({ obj, info }: { obj: Record<string, unknown>; info: Record<string, string> }) {
  const entries = Object.entries(obj);
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
      {entries.map(([k, v]) => (
        <div key={k} className="px-3 py-1.5 text-xs">
          <div className="flex flex-wrap gap-x-2">
            <span className="font-mono font-bold text-slate-800">{k}</span>
            <span className="font-mono text-slate-600 break-all">{typeof v === 'string' ? v : JSON.stringify(v)}</span>
          </div>
          {Object.prototype.hasOwnProperty.call(info, k) && <div className="text-[11px] text-slate-500">{info[k]}</div>}
        </div>
      ))}
      {entries.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">Rỗng</div>}
    </div>
  );
}

export default function JwtToolsPage() {
  const { showToast } = useApp();
  const [tab, setTab] = useState<Tab>('verify');
  const [now, setNow] = useState(() => Date.now());

  // Verify
  const [token, setToken] = useState('');
  const [vAlg, setVAlg] = useState<JwtAlg>('HS256');
  const [vKey, setVKey] = useState('');
  const [vEnc, setVEnc] = useState<SecretEncoding>('text');
  const [tol, setTol] = useState(0);
  const [vResult, setVResult] = useState<{ sig: string; res: { ok: true; value: VerifyResult } | { ok: false; error: string } } | null>(null);

  // Sign
  const [sAlg, setSAlg] = useState<JwtAlg>('HS256');
  const [header, setHeader] = useState(defaultHeaderJson('HS256'));
  const [payload, setPayload] = useState(() => defaultPayloadJson(Math.floor(Date.now() / 1000)));
  const [sKey, setSKey] = useState('');
  const [sEnc, setSEnc] = useState<SecretEncoding>('text');
  const [signed, setSigned] = useState<{ token: string; warnings: JwtWarning[] } | null>(null);
  const [signErr, setSignErr] = useState('');
  const [gen, setGen] = useState<{ kind: string; pair: GeneratedKeyPair } | null>(null);
  const [genBusy, setGenBusy] = useState(false);

  // Keys
  const [kText, setKText] = useState('');
  const [kOut, setKOut] = useState<{ title: string; text: string }[]>([]);
  const [kErr, setKErr] = useState('');

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  const copy = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      showToast('Đã sao chép!');
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  /* ---- Giải mã ---- */
  const parsed = useMemo(() => (token.trim() ? parseJwt(token) : null), [token]);
  const nowSec = Math.floor(now / 1000);
  const times = useMemo(() => (parsed && parsed.ok ? analyzeTimes(parsed.value.payload, nowSec, tol) : null), [parsed, nowSec, tol]);
  const hWarn = useMemo(() => (parsed && parsed.ok ? headerWarnings(parsed.value.header) : []), [parsed]);

  const sigKey = parsed && parsed.ok ? [token.trim(), vAlg, vKey, vEnc].join('\u0000') : '';
  useEffect(() => {
    if (!parsed || !parsed.ok || !vKey.trim()) return;
    let cancelled = false;
    verifyJwt(token, { alg: vAlg, key: vKey, secretEncoding: vEnc }).then((res) => {
      if (!cancelled) setVResult({ sig: sigKey, res });
    });
    return () => {
      cancelled = true;
    };
  }, [parsed, token, vAlg, vKey, vEnc, sigKey]);
  const vr = vResult && vResult.sig === sigKey && vKey.trim() ? vResult.res : null;

  const onTokenChange = (t: string) => {
    setToken(t);
    const p = parseJwt(t);
    if (p.ok && isJwtAlg(p.value.header.alg)) setVAlg(p.value.header.alg);
  };

  /* ---- Ký ---- */
  const changeSignAlg = (a: JwtAlg) => {
    setSAlg(a);
    setHeader((h) => syncHeaderAlg(h, a));
    setSigned(null);
    setSignErr('');
  };

  const doSign = async () => {
    setSignErr('');
    const r = await signJwt({ headerJson: header, payloadJson: payload, alg: sAlg, key: sKey, secretEncoding: sEnc });
    if (r.ok) setSigned(r.value);
    else {
      setSigned(null);
      setSignErr(r.error);
    }
  };

  const addC = (c: 'iat' | 'exp' | 'nbf' | 'jti') => {
    const r = addClaim(payload, c, nowSeconds());
    if (r.ok) setPayload(r.value);
    else showToast(r.error);
  };

  const doGenerate = async (kind: KeyKind) => {
    setGenBusy(true);
    const r = await generateKeyPair(kind);
    setGenBusy(false);
    if (!r.ok) {
      showToast(r.error);
      return;
    }
    setGen({ kind, pair: r.value });
    setSKey(r.value.privatePem);
    const alg: JwtAlg = kind.startsWith('RSA') ? (algFamily(sAlg) === 'RS' || algFamily(sAlg) === 'PS' ? sAlg : 'RS256') : kind === 'EC-P-256' ? 'ES256' : kind === 'EC-P-384' ? 'ES384' : 'ES512';
    changeSignAlg(alg);
  };

  const doSecret = () => {
    const alg: JwtAlg = algFamily(sAlg) === 'HS' ? sAlg : 'HS256';
    changeSignAlg(alg);
    setSEnc('base64');
    setSKey(randomHsSecret(alg === 'HS256' ? 32 : alg === 'HS384' ? 48 : 64));
    setGen(null);
  };

  const sendToVerify = () => {
    if (!signed) return;
    setToken(signed.token);
    setVAlg(sAlg);
    if (algFamily(sAlg) === 'HS') {
      setVKey(sKey);
      setVEnc(sEnc);
    } else if (gen) {
      setVKey(gen.pair.publicPem);
    } else {
      setVKey('');
    }
    setTab('verify');
  };

  /* ---- Khóa ---- */
  const doConvert = async () => {
    setKErr('');
    setKOut([]);
    const t = kText.trim();
    if (!t) {
      setKErr('Hãy dán PEM (PUBLIC KEY / PRIVATE KEY) hoặc JWK.');
      return;
    }
    if (t.startsWith('{')) {
      const j = parseJwkText(t);
      if (!j.ok) return setKErr(j.error);
      const th = await jwkThumbprint(j.value);
      const out: { title: string; text: string }[] = [];
      if (j.value.kty === 'RSA' || j.value.kty === 'EC') {
        const p = await jwkToPem(t);
        if (!p.ok) return setKErr(p.error);
        out.push({ title: p.value.isPrivate ? 'PEM khóa riêng (PKCS#8)' : 'PEM khóa công khai (SPKI)', text: p.value.pem });
        if (p.value.isPrivate) out.push({ title: 'PEM khóa công khai (SPKI)', text: p.value.publicPem });
      }
      if (th.ok) out.push({ title: 'JWK thumbprint (RFC 7638, SHA-256, Base64URL)', text: th.value });
      else out.push({ title: 'Thumbprint', text: th.error });
      setKOut(out);
    } else {
      const r = await pemToJwk(t);
      if (!r.ok) return setKErr(r.error);
      const out = [{ title: r.value.isPrivate ? 'JWK khóa riêng' : 'JWK khóa công khai', text: JSON.stringify(r.value.jwk, null, 2) }];
      if (r.value.isPrivate) out.push({ title: 'JWK khóa công khai', text: JSON.stringify(r.value.publicJwk, null, 2) });
      out.push({ title: 'JWK thumbprint (RFC 7638, SHA-256, Base64URL)', text: r.value.thumbprint });
      setKOut(out);
    }
  };

  const keyPlaceholder =
    algFamily(vAlg) === 'HS' ? 'Secret dùng để ký token' : '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n(hoặc JWK / JWKS dạng JSON)';

  const tabs: { id: Tab; label: string }[] = [
    { id: 'verify', label: 'Giải mã & Xác minh' },
    { id: 'sign', label: 'Tạo & Ký' },
    { id: 'keys', label: 'Khóa: JWK ⇄ PEM' },
  ];

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <KeyRound className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">JWT Sign &amp; Verify</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Giải mã, xác minh và ký JWT bằng Web Crypto. Mọi thứ chỉ xử lý trong trình duyệt, không gửi lên máy chủ.
            </p>
          </div>
        </div>
      </div>

      <div className="flex gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2 text-xs">
        <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          Mọi thao tác chạy hoàn toàn trong trình duyệt của bạn, không có gì được gửi đi. Dù vậy, đừng dán secret hoặc khóa riêng dùng cho môi trường production
          (tiện ích trình duyệt, ảnh chụp màn hình hay lịch sử clipboard có thể làm lộ). Công cụ này cố ý không có nút chia sẻ link để tránh đưa token hoặc khóa vào URL.
        </span>
      </div>

      <div className="flex gap-1 border-b border-slate-200" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${tab === t.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'verify' && (
        <div className="space-y-3.5">
          <Panel
            title="JWT"
            right={
              <div className="flex gap-1.5">
                <button
                  className={btnSecondary}
                  onClick={() => {
                    onTokenChange(SAMPLE_HS256_TOKEN);
                    setVKey(SAMPLE_HS256_SECRET);
                    setVEnc('text');
                  }}
                >
                  Dùng mẫu jwt.io
                </button>
                <button className={btnSecondary} onClick={() => { setToken(''); setVKey(''); }}>Xóa</button>
              </div>
            }
          >
            <textarea
              value={token}
              onChange={(e) => onTokenChange(e.target.value)}
              rows={4}
              spellCheck={false}
              placeholder="Dán JWT vào đây (eyJhbGciOi...)"
              className={areaCls}
              aria-label="JWT"
            />
            {parsed && !parsed.ok && <p className="text-xs text-red-600">{parsed.error}</p>}
            {parsed && parsed.ok && <ColoredToken token={parsed.value.rawParts.join('.')} />}
          </Panel>

          {parsed && parsed.ok && times && (
            <>
              <Warnings items={hWarn} />
              <div className="grid lg:grid-cols-2 gap-3.5">
                <Panel title="Header">
                  <ClaimTable obj={parsed.value.header} info={HEADER_INFO} />
                </Panel>
                <Panel title="Payload">
                  <ClaimTable obj={parsed.value.payload} info={CLAIM_INFO} />
                </Panel>
              </div>

              <Panel
                title="Thời gian hiệu lực"
                right={
                  <label className="text-[11px] text-slate-500 flex items-center gap-1">
                    Sai lệch đồng hồ cho phép (giây):
                    <input
                      type="number"
                      min={0}
                      max={86400}
                      value={tol}
                      onChange={(e) => setTol(Math.min(86400, Math.max(0, Number(e.target.value) || 0)))}
                      className="w-20 px-1.5 py-0.5 text-xs border border-slate-200 rounded-sm"
                    />
                  </label>
                }
              >
                <div className="flex flex-wrap gap-2">
                  {times.expired === true && <span className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-full px-2.5 py-0.5">ĐÃ HẾT HẠN</span>}
                  {times.expired === false && <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">CHƯA HẾT HẠN</span>}
                  {times.notYetValid && <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">CHƯA CÓ HIỆU LỰC (nbf)</span>}
                  {times.expired === null && <span className="text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-0.5">KHÔNG CÓ exp</span>}
                </div>
                {times.claims.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <tbody>
                        {times.claims.map((c) => (
                          <tr key={c.claim} className="border-t border-slate-100">
                            <td className="py-1.5 pr-3 font-medium text-slate-700 whitespace-nowrap">{c.label}</td>
                            <td className="pr-3 font-mono text-slate-600 whitespace-nowrap">{c.local} (giờ máy)</td>
                            <td className="pr-3 font-mono text-slate-600 whitespace-nowrap">{c.utc}</td>
                            <td className="text-slate-500 whitespace-nowrap">{c.relative}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <Warnings items={times.warnings} />
              </Panel>

              <Panel title="Xác minh chữ ký">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-600">Thuật toán mong đợi:</span>
                  <AlgSelect value={vAlg} onChange={setVAlg} label="Thuật toán xác minh" />
                  {algFamily(vAlg) === 'HS' && <EncodingSelect value={vEnc} onChange={setVEnc} />}
                </div>
                <p className="text-[11px] text-slate-500">
                  Xác minh luôn dùng thuật toán BẠN chọn, không dùng giá trị alg trong header token. Tin alg do token tự khai là nguồn gốc của nhiều lỗ hổng
                  (alg=none, hoặc đổi RS256 thành HS256 để dùng khóa công khai làm secret). Header của token này khai báo:{' '}
                  <b className="font-mono">{String(parsed.value.header.alg)}</b>.
                </p>
                <textarea
                  value={vKey}
                  onChange={(e) => setVKey(e.target.value)}
                  rows={algFamily(vAlg) === 'HS' ? 2 : 6}
                  spellCheck={false}
                  placeholder={keyPlaceholder}
                  className={areaCls}
                  aria-label="Khóa xác minh"
                />
                {!vKey.trim() && <p className="text-xs text-slate-400">Nhập {algFamily(vAlg) === 'HS' ? 'secret' : 'khóa công khai'} để xác minh chữ ký.</p>}
                {vr && !vr.ok && (
                  <div className="flex gap-2 text-sm border rounded-lg px-3 py-2 bg-red-50 border-red-200 text-red-800">
                    <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{vr.error}</span>
                  </div>
                )}
                {vr && vr.ok && (
                  <div className="space-y-2">
                    <div
                      className={`flex gap-2 text-sm font-medium border rounded-lg px-3 py-2 ${
                        vr.value.accepted ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
                      }`}
                    >
                      {vr.value.accepted ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 shrink-0 mt-0.5" />}
                      <span>
                        {vr.value.accepted
                          ? 'Chữ ký HỢP LỆ.'
                          : vr.value.signatureValid
                            ? `Chữ ký khớp theo ${vAlg} nhưng alg trong header khác, nên token KHÔNG được chấp nhận.`
                            : 'Chữ ký KHÔNG hợp lệ: nội dung bị sửa, sai khóa hoặc sai thuật toán.'}
                      </span>
                    </div>
                    <Warnings items={vr.value.warnings} />
                    {vr.value.accepted && times.expired && (
                      <p className="text-xs text-amber-700">Lưu ý: chữ ký đúng nhưng token đã hết hạn.</p>
                    )}
                  </div>
                )}
              </Panel>
            </>
          )}
        </div>
      )}

      {tab === 'sign' && (
        <div className="space-y-3.5">
          <div className="grid lg:grid-cols-2 gap-3.5">
            <Panel
              title="Header"
              right={<AlgSelect value={sAlg} onChange={changeSignAlg} label="Thuật toán ký" />}
            >
              <textarea value={header} onChange={(e) => setHeader(e.target.value)} rows={6} spellCheck={false} className={areaCls} aria-label="Header JSON" />
            </Panel>
            <Panel
              title="Payload"
              right={
                <div className="flex flex-wrap gap-1">
                  {(['iat', 'exp', 'nbf', 'jti'] as const).map((c) => (
                    <button key={c} className={btnSecondary} onClick={() => addC(c)} data-tooltip={c === 'exp' ? 'Hết hạn sau 1 giờ' : undefined}>
                      +{c}{c === 'exp' ? ' (+1h)' : ''}
                    </button>
                  ))}
                </div>
              }
            >
              <textarea value={payload} onChange={(e) => setPayload(e.target.value)} rows={6} spellCheck={false} className={areaCls} aria-label="Payload JSON" />
            </Panel>
          </div>

          <Panel
            title={algFamily(sAlg) === 'HS' ? 'Secret (HS*)' : 'Khóa riêng (PEM PKCS#8 hoặc JWK)'}
            right={
              <div className="flex flex-wrap gap-1">
                <button className={btnSecondary} onClick={doSecret}>Tạo secret ngẫu nhiên</button>
                <button className={btnSecondary} disabled={genBusy} onClick={() => doGenerate('RSA-2048')}>{genBusy ? 'Đang tạo...' : 'Cặp khóa RSA 2048'}</button>
                <button className={btnSecondary} disabled={genBusy} onClick={() => doGenerate('EC-P-256')}>Cặp khóa EC P-256</button>
              </div>
            }
          >
            {algFamily(sAlg) === 'HS' && (
              <div>
                <EncodingSelect value={sEnc} onChange={setSEnc} />
              </div>
            )}
            <textarea
              value={sKey}
              onChange={(e) => setSKey(e.target.value)}
              rows={algFamily(sAlg) === 'HS' ? 2 : 8}
              spellCheck={false}
              placeholder={algFamily(sAlg) === 'HS' ? 'Secret' : '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
              className={areaCls}
              aria-label="Khóa ký"
            />
            <div className="flex items-center gap-2">
              <button className={btnPrimary} onClick={doSign}>Ký token</button>
              <span className="text-[11px] text-slate-400">Chỉ dùng khóa thử nghiệm. Không dán khóa production.</span>
            </div>
            {signErr && <p className="text-xs text-red-600">{signErr}</p>}
          </Panel>

          {gen && (
            <Panel title={`Cặp khóa vừa tạo (${gen.kind}) - CHỈ ĐỂ THỬ NGHIỆM`}>
              <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
                Khóa được sinh ngẫu nhiên trong trình duyệt và hiển thị ở đây; không lưu ở đâu. Đừng dùng cho môi trường thật.
              </div>
              <div className="grid lg:grid-cols-2 gap-3">
                {[
                  ['Khóa riêng PEM (PKCS#8)', gen.pair.privatePem],
                  ['Khóa công khai PEM (SPKI)', gen.pair.publicPem],
                  ['Khóa riêng JWK', gen.pair.privateJwk],
                  ['Khóa công khai JWK', gen.pair.publicJwk],
                ].map(([t, v]) => (
                  <div key={t}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[11px] text-slate-500">{t}</span>
                      <button className="text-slate-400 hover:text-indigo-600" onClick={() => copy(v)} aria-label={`Sao chép ${t}`}>
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <textarea readOnly value={v} rows={5} className={areaCls} aria-label={t} />
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-slate-500">
                JWK thumbprint (kid gợi ý): <span className="font-mono">{gen.pair.thumbprint}</span>
              </div>
            </Panel>
          )}

          {signed && (
            <Panel
              title="Token đã ký"
              right={
                <div className="flex gap-1">
                  <button className={btnSecondary} onClick={() => copy(signed.token)}>Sao chép token</button>
                  <button className={btnSecondary} onClick={sendToVerify}>Xác minh token này</button>
                </div>
              }
            >
              <ColoredToken token={signed.token} />
              <div className="flex gap-3 text-[11px]">
                <span className="text-red-600">header</span>
                <span className="text-indigo-600">payload</span>
                <span className="text-emerald-600">chữ ký</span>
              </div>
              <Warnings items={signed.warnings} />
            </Panel>
          )}
        </div>
      )}

      {tab === 'keys' && (
        <div className="space-y-3.5">
          <Panel
            title="Chuyển đổi JWK ⇄ PEM và thumbprint"
            right={
              <button className={btnPrimary} onClick={doConvert}>
                <RefreshCw className="h-3 w-3 inline mr-1" />
                Chuyển đổi
              </button>
            }
          >
            <textarea
              value={kText}
              onChange={(e) => setKText(e.target.value)}
              rows={9}
              spellCheck={false}
              placeholder={'Dán PEM (BEGIN PUBLIC KEY / BEGIN PRIVATE KEY / BEGIN RSA ... KEY) hoặc JWK JSON.\nPEM sẽ được đổi sang JWK, JWK đổi sang PEM; luôn tính thumbprint RFC 7638.'}
              className={areaCls}
              aria-label="Khóa đầu vào"
            />
            {kErr && <p className="text-xs text-red-600">{kErr}</p>}
            <p className="text-[11px] text-slate-400">Hỗ trợ RSA và EC (P-256/384/521). Khóa EC dạng SEC1 hoặc có mật khẩu cần chuyển sang PKCS#8 không mật khẩu trước.</p>
          </Panel>
          {kOut.map((o) => (
            <Panel key={o.title} title={o.title} right={<button className={btnSecondary} onClick={() => copy(o.text)}>Sao chép</button>}>
              <pre className="bg-slate-900 text-slate-100 text-xs font-mono rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">{o.text}</pre>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
