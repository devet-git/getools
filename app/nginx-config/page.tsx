'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Server,
  Copy,
  Check,
  Download,
  Plus,
  Trash2,
  Sparkles,
  AlertTriangle,
  Info,
  XCircle,
  FileText,
  Upload,
  Search,
  ArrowRightLeft,
  ChevronDown,
} from 'lucide-react';
import { Select } from '@/components/ui/searchable-select';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  SCENARIOS,
  defaultOptions,
  generateNginx,
  lintNginx,
  explainConfig,
  allDirectives,
  directiveCount,
  extractLocations,
  matchLocation,
  LOCATION_PRIORITY_NOTES,
  MAX_CONFIG_CHARS,
  GenOptions,
  Scenario,
  LocMod,
  Issue,
  Severity,
} from '@/lib/nginx-config';

/* ------------------------------------------------------------------ */
/* Hằng số giao diện                                                   */
/* ------------------------------------------------------------------ */

const inputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400';
const btnCls =
  'px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1';

/** Cờ boolean đưa vào link chia sẻ (không chứa tên miền, đường dẫn, mật khẩu...) */
const SHARE_FLAGS: (keyof GenOptions)[] = [
  'ssl', 'http2', 'http3', 'redirectHttp', 'acme', 'stapling', 'hsts', 'hstsSub', 'hstsPreload', 'secHeaders', 'serverTokensOff',
  'denyDotfiles', 'denySensitive', 'gzip', 'brotli', 'htmlNoCache', 'rateLimit', 'limitConn', 'cors', 'basicAuth', 'jsonLog',
  'errorPages', 'websocket', 'buffering', 'stripPrefix', 'backendHttps', 'phpFront', 'forceDownload', 'autoindex', 'limitRate', 'ipv6',
];
const SHORT_FLAGS: Record<string, string> = { redirectHttp: 'rh', serverTokensOff: 'tok', denyDotfiles: 'dot', denySensitive: 'sens', htmlNoCache: 'html', secHeaders: 'sec', stripPrefix: 'strip', backendHttps: 'bh', forceDownload: 'dl', limitRate: 'lr', basicAuth: 'auth', errorPages: 'ep', hstsSub: 'hsub', hstsPreload: 'hpre', rateLimit: 'rl', limitConn: 'cl', jsonLog: 'json', websocket: 'ws', buffering: 'buf', stapling: 'stap', brotli: 'br', acme: 'acme', autoindex: 'ai' };
const flagName = (k: string) => SHORT_FLAGS[k] ?? k;

const SAMPLE_BAD = `# Cấu hình mẫu có nhiều lỗi/cảnh báo để thử bộ phân tích
user nginx;
worker_processes auto;
events { worker_connections 1024; }

http {
    include mime.types;
    server_tokens on;

    upstream backend {
        server 127.0.0.1:3000;
        keepalive 16;
    }

    server {
        listen 80;
        listen 443 ssl http2;
        server_name _;
        root /var/www/html;
        autoindex on;

        ssl_protocols TLSv1 TLSv1.1 TLSv1.2;
        ssl_ciphers RC4-SHA:HIGH:!aNULL;

        add_header X-Frame-Options DENY;
        add_header Strict-Transport-Security "max-age=63072000";

        return 301 http://$host$request_uri;

        location /api {
            proxy_pass http://backend/;
            add_header X-Api "1";
        }

        location /img/ {
            alias /data/img;
        }

        location / {
            if ($http_user_agent ~ "bot") {
                proxy_pass http://backend;
            }
            try_files $uri index.html;
            proxy_pas http://backend;
        }

        location ~ ^/files/.* { root /srv; }
        location ~ ^/files/pdf/.*\\.pdf$ { root /srv; }
    }

    server {
        listen 8080;
        server_name loop.example.com;
        return 301 http://$host$request_uri;
    }

    server {
        listen 80
        server_name example.com
    }
}
`;

const LOC_TEMPLATES: { label: string; mod: LocMod; path: string; body: string }[] = [
  { label: '/health (200 OK)', mod: '=', path: '/health', body: 'access_log off;\nadd_header Content-Type text/plain;\nreturn 200 "ok\\n";' },
  { label: '/admin (Basic Auth)', mod: '^~', path: '/admin/', body: 'auth_basic "Admin";\nauth_basic_user_file /etc/nginx/.htpasswd;\ntry_files $uri $uri/ =404;' },
  { label: '/static (alias)', mod: '^~', path: '/static/', body: 'alias /var/www/static/;\nexpires 30d;' },
  { label: 'robots.txt', mod: '=', path: '/robots.txt', body: 'access_log off;\nlog_not_found off;' },
  { label: 'Ảnh (regex)', mod: '~*', path: '\\.(?:png|jpe?g|gif|webp|avif)$', body: 'expires 30d;\naccess_log off;' },
];

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* Thành phần nhỏ                                                      */
/* ------------------------------------------------------------------ */

function Section({ title, hint, children, open = false }: { title: string; hint?: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group bg-white border border-slate-200 rounded-xl shadow-xs">
      <summary className="cursor-pointer select-none list-none flex items-center justify-between gap-2 px-3 py-2">
        <span className="text-xs font-semibold text-slate-800">
          {title}
          {hint && <span className="ml-2 font-normal text-slate-400">{hint}</span>}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400 transition group-open:rotate-180" />
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-slate-100">{children}</div>
    </details>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-slate-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-slate-400 mt-0.5 leading-snug">{hint}</span>}
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer text-xs text-slate-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 accent-indigo-600" />
      <span>
        {label}
        {hint && <span className="block text-[10px] text-slate-400 leading-snug">{hint}</span>}
      </span>
    </label>
  );
}

const sevStyle: Record<Severity, { cls: string; label: string; Icon: typeof Info }> = {
  error: { cls: 'bg-red-50 text-red-700 border-red-200', label: 'Lỗi', Icon: XCircle },
  warn: { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Cảnh báo', Icon: AlertTriangle },
  info: { cls: 'bg-indigo-50 text-indigo-700 border-indigo-200', label: 'Gợi ý', Icon: Info },
};

/* ------------------------------------------------------------------ */
/* Tab: Tạo cấu hình                                                   */
/* ------------------------------------------------------------------ */

type OutTab = 'combined' | 'server' | 'http' | 'full' | 'commands';

function GeneratorTab({ onSendToAnalyzer }: { onSendToAnalyzer: (t: string) => void }) {
  const { showToast } = useApp();
  const [o, setO] = useState<GenOptions>(() => defaultOptions('spa'));
  const [out, setOut] = useState<OutTab>('combined');
  const [copied, setCopied] = useState(false);
  const [testUri, setTestUri] = useState('/static/app.js');
  const loaded = useRef(false);

  // khởi tạo từ URL
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const p = readShareParams();
    const s = p.get('s') as Scenario | null;
    if (!s || !SCENARIOS.some((x) => x.id === s)) return;
    const base = defaultOptions(s);
    const f = p.get('f');
    if (f !== null) {
      const on = new Set(f.split(',').filter(Boolean));
      for (const k of SHARE_FLAGS) (base as unknown as Record<string, unknown>)[k] = on.has(flagName(k));
    }
    const lb = p.get('lb');
    if (lb === 'round_robin' || lb === 'least_conn' || lb === 'ip_hash') base.lb = lb;
    const cache = p.get('cache');
    if (cache === 'hashed' || cache === 'moderate' || cache === 'off') base.cacheMode = cache;
    const rk = p.get('rk');
    if (rk === 'http2https' || rk === 'www2apex' || rk === 'apex2www' || rk === 'migrate') base.redirectKind = rk;
    const ka = parseInt(p.get('ka') ?? '', 10);
    if (Number.isFinite(ka) && ka >= 0 && ka <= 1000) base.keepalive = ka;
    const csp = p.get('csp');
    if (csp === 'off' || csp === 'report-only' || csp === 'enforce') base.csp = csp;
    const mnt = p.get('mnt');
    if (mnt === 'off' || mnt === 'always' || mnt === 'flag') base.maintenance = mnt;
    const t = setTimeout(() => setO(base), 0);
    return () => clearTimeout(t);
  }, []);

  const set = <K extends keyof GenOptions>(k: K, v: GenOptions[K]) => setO((p) => ({ ...p, [k]: v }));
  const changeScenario = (s: Scenario) =>
    setO((p) => ({
      ...defaultOptions(s),
      domains: p.domains,
      ssl: p.ssl,
      certMode: p.certMode,
      certPath: p.certPath,
      keyPath: p.keyPath,
      acmeRoot: p.acmeRoot,
      authFile: p.authFile,
      authRealm: p.authRealm,
      corsOrigins: p.corsOrigins,
      redirectTarget: p.redirectTarget,
      ipAllow: p.ipAllow,
      locations: p.locations,
    }));

  const deferred = useDeferredValue(o);
  const res = useMemo(() => generateNginx(deferred), [deferred]);
  const text = out === 'combined' ? res.combined : out === 'server' ? res.server : out === 'http' ? res.http : out === 'full' ? res.fullConf : res.commands;
  const fileName = out === 'full' ? 'nginx.conf' : out === 'commands' ? 'deploy.sh' : `${res.certDomain}.conf`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast('Đã sao chép cấu hình!');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const shareParams = useMemo(() => {
    const flags = SHARE_FLAGS.filter((k) => o[k] === true).map((k) => flagName(k));
    return { s: o.scenario, f: flags.join(',') || ',', lb: o.lb, cache: o.cacheMode, rk: o.redirectKind, ka: String(o.keepalive), csp: o.csp, mnt: o.maintenance };
  }, [o]);

  const sc = o.scenario;
  const isProxy = sc === 'proxy' || sc === 'node' || sc === 'loadbalancer';
  const usesProxyOpts = isProxy || sc === 'gateway';
  const hasRoot = sc === 'static' || sc === 'spa' || sc === 'php' || sc === 'download';
  const isRedirect = sc === 'redirect';

  const lint = useMemo(() => lintNginx(res.combined), [res.combined]);
  const errCount = lint.issues.filter((i) => i.severity === 'error').length;
  const warnCount = lint.issues.filter((i) => i.severity === 'warn').length;

  const locs = useMemo(() => extractLocations(res.combined), [res.combined]);
  const match = useMemo(() => (testUri.trim() ? matchLocation(locs, testUri.trim()) : null), [locs, testUri]);

  const updServer = (i: number, patch: Partial<GenOptions['servers'][number]>) => set('servers', o.servers.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const updRoute = (i: number, patch: Partial<GenOptions['routes'][number]>) => set('routes', o.routes.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const updLoc = (i: number, patch: Partial<GenOptions['locations'][number]>) => set('locations', o.locations.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-3.5 items-start">
      {/* ---------------- CỘT TUỲ CHỌN ---------------- */}
      <div className="space-y-2.5">
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-slate-800">Kịch bản</h2>
            <ShareLinkButton params={shareParams} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => changeScenario(s.id)}
                title={s.desc}
                className={`text-left rounded-lg border px-2.5 py-1.5 transition ${sc === s.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
              >
                <span className="block text-xs font-semibold leading-tight">{s.label}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-2">{SCENARIOS.find((s) => s.id === sc)?.desc}</p>
        </div>

        <Section title="Tên miền & nội dung" open>
          <Field label="server_name" hint="Nhiều tên cách nhau bằng dấu cách. Hỗ trợ *.example.com, _ (server mặc định).">
            <input className={inputCls} value={o.domains} onChange={(e) => set('domains', e.target.value)} spellCheck={false} />
          </Field>
          {isRedirect && (
            <>
              <Field label="Kiểu redirect">
                <Select className={inputCls} value={o.redirectKind} onChange={(e) => set('redirectKind', e.target.value as GenOptions['redirectKind'])}>
                  <option value="http2https">HTTP → HTTPS (mọi host)</option>
                  <option value="www2apex">www.domain → domain</option>
                  <option value="apex2www">domain → www.domain</option>
                  <option value="migrate">Chuyển miền cũ → miền mới (301)</option>
                </Select>
              </Field>
              {o.redirectKind === 'migrate' && (
                <Field label="Tên miền đích" hint="Tên miền cũ nhập ở server_name phía trên. Path + query được giữ nguyên qua $request_uri.">
                  <input className={inputCls} value={o.redirectTarget} onChange={(e) => set('redirectTarget', e.target.value)} spellCheck={false} />
                </Field>
              )}
            </>
          )}
          {hasRoot && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="root">
                <input className={inputCls} value={o.root} onChange={(e) => set('root', e.target.value)} spellCheck={false} />
              </Field>
              <Field label="index">
                <input className={inputCls} value={o.index} onChange={(e) => set('index', e.target.value)} spellCheck={false} />
              </Field>
            </div>
          )}
          {!isRedirect && (
            <Field label="client_max_body_size" hint="Mặc định nginx là 1m; upload lớn hơn bị lỗi 413.">
              <input className={inputCls} value={o.maxBody} onChange={(e) => set('maxBody', e.target.value)} spellCheck={false} />
            </Field>
          )}
        </Section>

        {sc === 'php' && (
          <Section title="PHP-FPM" open>
            <Field label="fastcgi_pass" hint="Socket (khuyên dùng): unix:/run/php/php8.3-fpm.sock — hoặc cổng TCP: 127.0.0.1:9000">
              <input className={inputCls} value={o.fastcgiPass} onChange={(e) => set('fastcgiPass', e.target.value)} spellCheck={false} />
            </Field>
            <Toggle label="Front controller (Laravel / Symfony / WordPress)" hint="try_files … /index.php?$query_string. Tắt: chỉ phục vụ file thật." checked={o.phpFront} onChange={(v) => set('phpFront', v)} />
          </Section>
        )}

        {sc === 'download' && (
          <Section title="Tải file / CDN" open>
            <Toggle label="Ép tải xuống (Content-Disposition: attachment) cho file nén/cài đặt" checked={o.forceDownload} onChange={(v) => set('forceDownload', v)} />
            <Toggle label="Giới hạn tốc độ mỗi kết nối" hint="limit_rate_after / limit_rate" checked={o.limitRate} onChange={(v) => set('limitRate', v)} />
            {o.limitRate && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Sau khi tải (limit_rate_after)">
                  <input className={inputCls} value={o.limitRateAfter} onChange={(e) => set('limitRateAfter', e.target.value)} />
                </Field>
                <Field label="Tốc độ (limit_rate)">
                  <input className={inputCls} value={o.limitRateValue} onChange={(e) => set('limitRateValue', e.target.value)} />
                </Field>
              </div>
            )}
            <Toggle label="autoindex (liệt kê thư mục)" hint="Chỉ bật cho thư mục công khai có chủ đích." checked={o.autoindex} onChange={(v) => set('autoindex', v)} />
            <p className="text-[10px] text-slate-400">Range request (206 Partial Content, tua video, tải tiếp) được nginx hỗ trợ sẵn cho file tĩnh.</p>
          </Section>
        )}

        {isProxy && (
          <Section title="Backend / Upstream" open>
            <div className="space-y-1.5">
              {o.servers.map((s, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input className={inputCls} value={s.addr} onChange={(e) => updServer(i, { addr: e.target.value })} placeholder="127.0.0.1:3000 hoặc unix:/run/app.sock" spellCheck={false} aria-label="Địa chỉ backend" />
                  <input className={inputCls + ' !w-16'} type="number" min={1} value={s.weight} onChange={(e) => updServer(i, { weight: parseInt(e.target.value, 10) || 1 })} title="weight" aria-label="weight" />
                  <label className="flex items-center gap-1 text-[10px] text-slate-500 whitespace-nowrap" title="Chỉ nhận request khi các server chính đều lỗi">
                    <input type="checkbox" checked={s.backup} onChange={(e) => updServer(i, { backup: e.target.checked })} className="accent-indigo-600" />
                    backup
                  </label>
                  <button type="button" onClick={() => set('servers', o.servers.filter((_, j) => j !== i))} className="p-1 text-slate-400 hover:text-red-500" aria-label="Xoá backend">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button type="button" className={btnCls} onClick={() => set('servers', [...o.servers, { addr: '127.0.0.1:3001', weight: 1, backup: false }])}>
                <Plus className="h-3 w-3" /> Thêm backend
              </button>
            </div>
            {o.servers.length > 1 && (
              <Field label="Thuật toán cân bằng tải">
                <Select className={inputCls} value={o.lb} onChange={(e) => set('lb', e.target.value as GenOptions['lb'])}>
                  <option value="round_robin">round-robin (mặc định, theo weight)</option>
                  <option value="least_conn">least_conn (ít kết nối nhất)</option>
                  <option value="ip_hash">ip_hash (dính theo IP client)</option>
                </Select>
              </Field>
            )}
            <div className="grid grid-cols-3 gap-2">
              <Field label="Tên upstream">
                <input className={inputCls} value={o.upstreamName} onChange={(e) => set('upstreamName', e.target.value)} spellCheck={false} />
              </Field>
              <Field label="max_fails">
                <input className={inputCls} type="number" min={0} value={o.maxFails} onChange={(e) => set('maxFails', parseInt(e.target.value, 10) || 0)} />
              </Field>
              <Field label="fail_timeout">
                <input className={inputCls} value={o.failTimeout} onChange={(e) => set('failTimeout', e.target.value)} />
              </Field>
            </div>
            <Field label="keepalive tới backend (0 = tắt)" hint="Giữ sẵn N kết nối rảnh; tự thêm proxy_http_version 1.1 + Connection.">
              <input className={inputCls} type="number" min={0} value={o.keepalive} onChange={(e) => set('keepalive', parseInt(e.target.value, 10) || 0)} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="location chuyển tiếp" hint='"/" hoặc tiền tố như /api/'>
                <input className={inputCls} value={o.proxyLocation} onChange={(e) => set('proxyLocation', e.target.value)} spellCheck={false} />
              </Field>
              <Field label="Đường dẫn ở backend" hint="Chỉ dùng khi bỏ tiền tố">
                <input className={inputCls} value={o.backendPath} onChange={(e) => set('backendPath', e.target.value)} placeholder="/" spellCheck={false} />
              </Field>
            </div>
            <Toggle
              label="Bỏ tiền tố location khi gửi tới backend"
              hint="Có: proxy_pass http://up/; (có dấu / cuối → /api/x thành /x). Không: giữ nguyên /api/x. Chỉ áp dụng khi location khác “/”."
              checked={o.stripPrefix}
              onChange={(v) => set('stripPrefix', v)}
            />
          </Section>
        )}

        {sc === 'gateway' && (
          <Section title="Route của API gateway" open>
            <div className="space-y-1.5">
              {o.routes.map((r, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input className={inputCls} value={r.path} onChange={(e) => updRoute(i, { path: e.target.value })} placeholder="/users/" spellCheck={false} aria-label="Đường dẫn route" />
                  <input className={inputCls} value={r.target} onChange={(e) => updRoute(i, { target: e.target.value })} placeholder="127.0.0.1:3001" spellCheck={false} aria-label="Địa chỉ service" />
                  <label className="flex items-center gap-1 text-[10px] text-slate-500 whitespace-nowrap" title="Bỏ tiền tố khi gửi tới service">
                    <input type="checkbox" checked={r.strip} onChange={(e) => updRoute(i, { strip: e.target.checked })} className="accent-indigo-600" />
                    strip
                  </label>
                  <button type="button" onClick={() => set('routes', o.routes.filter((_, j) => j !== i))} className="p-1 text-slate-400 hover:text-red-500" aria-label="Xoá route">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button type="button" className={btnCls} onClick={() => set('routes', [...o.routes, { path: '/items/', target: '127.0.0.1:3003', strip: true }])}>
                <Plus className="h-3 w-3" /> Thêm route
              </button>
            </div>
          </Section>
        )}

        {usesProxyOpts && (
          <Section title="Tuỳ chọn proxy" hint="timeout, buffering, WebSocket">
            <Toggle label="WebSocket (Upgrade + map $connection_upgrade)" checked={o.websocket} onChange={(v) => set('websocket', v)} />
            <Toggle label="proxy_buffering" hint="Tắt cho SSE / streaming / long-polling." checked={o.buffering} onChange={(v) => set('buffering', v)} />
            <Toggle label="Backend dùng HTTPS" hint="Thêm proxy_ssl_server_name on (SNI)." checked={o.backendHttps} onChange={(v) => set('backendHttps', v)} />
            <div className="grid grid-cols-3 gap-2">
              <Field label="connect">
                <input className={inputCls} value={o.connectTimeout} onChange={(e) => set('connectTimeout', e.target.value)} />
              </Field>
              <Field label="send">
                <input className={inputCls} value={o.sendTimeout} onChange={(e) => set('sendTimeout', e.target.value)} />
              </Field>
              <Field label="read">
                <input className={inputCls} value={o.readTimeout} onChange={(e) => set('readTimeout', e.target.value)} />
              </Field>
            </div>
          </Section>
        )}

        {!(isRedirect && o.redirectKind === 'http2https') && (
          <Section title="HTTPS & TLS" hint="Mozilla intermediate" open>
            <Toggle label="Bật HTTPS (listen 443 ssl)" checked={o.ssl} onChange={(v) => set('ssl', v)} />
            {o.ssl && (
              <>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <Toggle label="HTTP/2 (http2 on)" checked={o.http2} onChange={(v) => set('http2', v)} />
                  <Toggle label="nginx < 1.25.1 (listen … http2)" checked={o.legacyHttp2} onChange={(v) => set('legacyHttp2', v)} />
                  <Toggle label="Redirect HTTP → HTTPS" checked={o.redirectHttp} onChange={(v) => set('redirectHttp', v)} />
                  <Toggle label="IPv6 ([::])" checked={o.ipv6} onChange={(v) => set('ipv6', v)} />
                  <Toggle label="HTTP/3 (QUIC) — nâng cao" hint="Cần nginx ≥ 1.25 + http_v3_module, mở UDP 443." checked={o.http3} onChange={(v) => set('http3', v)} />
                  <Toggle label="OCSP stapling" hint="Let's Encrypt đã ngừng OCSP." checked={o.stapling} onChange={(v) => set('stapling', v)} />
                </div>
                <Field label="Chứng chỉ">
                  <Select className={inputCls} value={o.certMode} onChange={(e) => set('certMode', e.target.value as GenOptions['certMode'])}>
                    <option value="letsencrypt">Let&apos;s Encrypt (/etc/letsencrypt/live/&lt;domain&gt;/…)</option>
                    <option value="custom">Đường dẫn tuỳ chỉnh</option>
                  </Select>
                </Field>
                {o.certMode === 'custom' && (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="ssl_certificate">
                      <input className={inputCls} value={o.certPath} onChange={(e) => set('certPath', e.target.value)} spellCheck={false} />
                    </Field>
                    <Field label="ssl_certificate_key">
                      <input className={inputCls} value={o.keyPath} onChange={(e) => set('keyPath', e.target.value)} spellCheck={false} />
                    </Field>
                  </div>
                )}
              </>
            )}
            <Toggle label="Cho phép xác thực ACME (HTTP-01 webroot)" hint="location /.well-known/acme-challenge/ cho certbot --webroot." checked={o.acme} onChange={(v) => set('acme', v)} />
            {o.acme && (
              <Field label="Thư mục webroot ACME">
                <input className={inputCls} value={o.acmeRoot} onChange={(e) => set('acmeRoot', e.target.value)} spellCheck={false} />
              </Field>
            )}
            {o.ssl && (
              <div className="space-y-1.5 rounded-lg bg-slate-50 border border-slate-100 p-2">
                <Toggle label="HSTS (Strict-Transport-Security, 2 năm)" checked={o.hsts} onChange={(v) => set('hsts', v)} />
                {o.hsts && (
                  <div className="pl-5 space-y-1.5">
                    <Toggle label="includeSubDomains" checked={o.hstsSub} onChange={(v) => set('hstsSub', v)} />
                    <Toggle label="preload" hint="Cẩn thận: gần như không thể gỡ khỏi danh sách preload." checked={o.hstsPreload} onChange={(v) => set('hstsPreload', v)} />
                  </div>
                )}
              </div>
            )}
          </Section>
        )}

        {!isRedirect && (
          <Section title="Bảo mật" hint="header, ẩn file nhạy cảm">
            <Toggle label="Header bảo mật cơ bản" hint="X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy (add_header … always)" checked={o.secHeaders} onChange={(v) => set('secHeaders', v)} />
            {o.secHeaders && (
              <Field label="X-Frame-Options">
                <Select className={inputCls} value={o.xfo} onChange={(e) => set('xfo', e.target.value as GenOptions['xfo'])}>
                  <option value="SAMEORIGIN">SAMEORIGIN</option>
                  <option value="DENY">DENY</option>
                  <option value="off">Không gửi (dùng CSP frame-ancestors)</option>
                </Select>
              </Field>
            )}
            <Field label="Content-Security-Policy" hint="Starter chỉ để bắt đầu: nên chạy Report-Only trước vì CSP dễ làm hỏng script/style inline, CDN, font.">
              <Select className={inputCls} value={o.csp} onChange={(e) => set('csp', e.target.value as GenOptions['csp'])}>
                <option value="off">Tắt</option>
                <option value="report-only">Report-Only (an toàn để thử)</option>
                <option value="enforce">Enforce</option>
              </Select>
            </Field>
            {o.csp !== 'off' && <textarea className={inputCls + ' font-mono h-16'} value={o.cspValue} onChange={(e) => set('cspValue', e.target.value)} spellCheck={false} aria-label="Giá trị CSP" />}
            <Toggle label="server_tokens off" hint="Ẩn phiên bản nginx." checked={o.serverTokensOff} onChange={(v) => set('serverTokensOff', v)} />
            <Toggle label="Chặn file ẩn (.git, .env, .htaccess…)" hint="Trừ /.well-known." checked={o.denyDotfiles} onChange={(v) => set('denyDotfiles', v)} />
            <Toggle label="Chặn file nhạy cảm (backup, .sql, .ini, composer.json…)" checked={o.denySensitive} onChange={(v) => set('denySensitive', v)} />
          </Section>
        )}

        {!isRedirect && (
          <Section title="Nén & cache">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <Toggle label="gzip" checked={o.gzip} onChange={(v) => set('gzip', v)} />
              <Toggle label="brotli" hint="Cần module ngx_brotli." checked={o.brotli} onChange={(v) => set('brotli', v)} />
            </div>
            {o.gzip && (
              <Field label="gzip_min_length (byte)">
                <input className={inputCls} type="number" min={0} value={o.gzipMinLength} onChange={(e) => set('gzipMinLength', parseInt(e.target.value, 10) || 0)} />
              </Field>
            )}
            <Field label="Cache file tĩnh" hint="“immutable” chỉ an toàn khi tên file có hash (app.3f2a1c.js).">
              <Select className={inputCls} value={o.cacheMode} onChange={(e) => set('cacheMode', e.target.value as GenOptions['cacheMode'])}>
                <option value="hashed">1 năm + immutable (asset có hash)</option>
                <option value="moderate">30 ngày</option>
                <option value="off">Không đặt Cache-Control</option>
              </Select>
            </Field>
            {(sc === 'static' || sc === 'spa') && <Toggle label="HTML luôn no-cache" checked={o.htmlNoCache} onChange={(v) => set('htmlNoCache', v)} />}
          </Section>
        )}

        {!isRedirect && (
          <Section title="Giới hạn & CORS">
            <Toggle label="limit_req — giới hạn tốc độ request / IP" checked={o.rateLimit} onChange={(v) => set('rateLimit', v)} />
            {o.rateLimit && (
              <div className="grid grid-cols-3 gap-2">
                <Field label="rate">
                  <input className={inputCls} value={o.rate} onChange={(e) => set('rate', e.target.value)} placeholder="10r/s" />
                </Field>
                <Field label="burst">
                  <input className={inputCls} type="number" min={0} value={o.burst} onChange={(e) => set('burst', parseInt(e.target.value, 10) || 0)} />
                </Field>
                <Field label="Bộ nhớ zone">
                  <input className={inputCls} value={o.zoneSize} onChange={(e) => set('zoneSize', e.target.value)} />
                </Field>
              </div>
            )}
            <Toggle label="limit_conn — giới hạn kết nối đồng thời / IP" checked={o.limitConn} onChange={(v) => set('limitConn', v)} />
            {o.limitConn && (
              <Field label="Số kết nối tối đa">
                <input className={inputCls} type="number" min={1} value={o.connLimit} onChange={(e) => set('connLimit', parseInt(e.target.value, 10) || 1)} />
              </Field>
            )}
            <Toggle label="CORS (preflight OPTIONS → 204)" hint="Origin được phép khai báo bằng map, không dùng * khi có credentials." checked={o.cors} onChange={(v) => set('cors', v)} />
            {o.cors && (
              <>
                <Field label="Origin được phép" hint="Cách nhau bằng dấu cách, vd https://app.example.com">
                  <input className={inputCls} value={o.corsOrigins} onChange={(e) => set('corsOrigins', e.target.value)} spellCheck={false} />
                </Field>
                <Toggle label="Allow-Credentials: true" checked={o.corsCredentials} onChange={(v) => set('corsCredentials', v)} />
              </>
            )}
          </Section>
        )}

        {!isRedirect && (
          <Section title="Kiểm soát truy cập">
            <Toggle label="Basic Auth (auth_basic)" checked={o.basicAuth} onChange={(v) => set('basicAuth', v)} />
            {o.basicAuth && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Realm">
                  <input className={inputCls} value={o.authRealm} onChange={(e) => set('authRealm', e.target.value)} />
                </Field>
                <Field label="File htpasswd">
                  <input className={inputCls} value={o.authFile} onChange={(e) => set('authFile', e.target.value)} spellCheck={false} />
                </Field>
              </div>
            )}
            <Field label="Chỉ cho phép IP / CIDR (allow … ; deny all)" hint="Để trống = không giới hạn. Vd: 10.0.0.0/8 203.0.113.5">
              <input className={inputCls} value={o.ipAllow} onChange={(e) => set('ipAllow', e.target.value)} spellCheck={false} />
            </Field>
          </Section>
        )}

        <Section title="Log, trang lỗi, bảo trì">
          <div className="grid grid-cols-2 gap-2">
            <Field label="access_log" hint="Để trống = tự đặt theo tên miền">
              <input className={inputCls} value={o.accessLog} onChange={(e) => set('accessLog', e.target.value)} spellCheck={false} />
            </Field>
            <Field label="error_log">
              <input className={inputCls} value={o.errorLog} onChange={(e) => set('errorLog', e.target.value)} spellCheck={false} />
            </Field>
          </div>
          <Toggle label="Log dạng JSON (log_format … escape=json)" checked={o.jsonLog} onChange={(v) => set('jsonLog', v)} />
          {!isRedirect && (
            <>
              <Toggle label="Trang lỗi tuỳ chỉnh (404.html, 50x.html)" checked={o.errorPages} onChange={(v) => set('errorPages', v)} />
              <Field label="Chế độ bảo trì (503)">
                <Select className={inputCls} value={o.maintenance} onChange={(e) => set('maintenance', e.target.value as GenOptions['maintenance'])}>
                  <option value="off">Tắt</option>
                  <option value="flag">Bật bằng file cờ (/var/www/maintenance.flag)</option>
                  <option value="always">Luôn bật (mọi request 503)</option>
                </Select>
              </Field>
            </>
          )}
        </Section>

        {!isRedirect && (
          <Section title="Location tuỳ chỉnh" hint={`${o.locations.length} khối`}>
            <div className="flex flex-wrap gap-1">
              {LOC_TEMPLATES.map((t) => (
                <button key={t.label} type="button" className={btnCls} onClick={() => set('locations', [...o.locations, { modifier: t.mod, path: t.path, body: t.body }])}>
                  <Plus className="h-3 w-3" /> {t.label}
                </button>
              ))}
              <button type="button" className={btnCls} onClick={() => set('locations', [...o.locations, { modifier: '', path: '/new/', body: 'try_files $uri =404;' }])}>
                <Plus className="h-3 w-3" /> Trống
              </button>
            </div>
            {o.locations.map((l, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-2 space-y-1.5 bg-slate-50">
                <div className="flex items-center gap-1.5">
                  <Select className={inputCls + ' !w-20 font-mono'} value={l.modifier} onChange={(e) => updLoc(i, { modifier: e.target.value as LocMod })} aria-label="Modifier">
                    <option value="">(none)</option>
                    <option value="=">=</option>
                    <option value="^~">^~</option>
                    <option value="~">~</option>
                    <option value="~*">~*</option>
                  </Select>
                  <input className={inputCls + ' font-mono'} value={l.path} onChange={(e) => updLoc(i, { path: e.target.value })} spellCheck={false} aria-label="Đường dẫn location" />
                  <button type="button" onClick={() => set('locations', o.locations.filter((_, j) => j !== i))} className="p-1 text-slate-400 hover:text-red-500" aria-label="Xoá location">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <textarea className={inputCls + ' font-mono h-20'} value={l.body} onChange={(e) => updLoc(i, { body: e.target.value })} spellCheck={false} aria-label="Nội dung location" placeholder="directive…;" />
              </div>
            ))}
            <details className="text-[11px] text-slate-600 bg-slate-50 rounded-lg border border-slate-100 px-2.5 py-1.5">
              <summary className="cursor-pointer font-medium text-slate-700">Thứ tự ưu tiên khớp location</summary>
              <ul className="mt-1.5 space-y-1 list-disc pl-4 leading-snug">
                {LOCATION_PRIORITY_NOTES.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
            <div className="rounded-lg border border-slate-200 p-2 space-y-1.5">
              <Field label="Thử một URL xem location nào được dùng" hint={`${locs.length} location trong server chính`}>
                <input className={inputCls + ' font-mono'} value={testUri} onChange={(e) => setTestUri(e.target.value)} spellCheck={false} placeholder="/duong-dan/file.js" />
              </Field>
              {match ? (
                <div className="text-[11px] leading-snug space-y-0.5">
                  <p className="font-semibold text-emerald-700 font-mono">
                    → location {locs[match.index].mod} {locs[match.index].path}
                  </p>
                  {match.steps.map((s) => (
                    <p key={s} className="text-slate-500">
                      {s}
                    </p>
                  ))}
                </div>
              ) : (
                testUri.trim() && <p className="text-[11px] text-slate-500">Không location nào khớp (nginx trả 404 hoặc dùng cấu hình cấp server).</p>
              )}
            </div>
          </Section>
        )}
      </div>

      {/* ---------------- CỘT KẾT QUẢ ---------------- */}
      <div className="space-y-2.5">
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 border-b border-slate-100">
            <div className="flex flex-wrap gap-1" role="tablist">
              {(
                [
                  ['combined', 'Gộp 1 file'],
                  ['server', 'Server block'],
                  ['http', 'Cấp http'],
                  ['full', 'nginx.conf'],
                  ['commands', 'Lệnh & Docker'],
                ] as [OutTab, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={out === id}
                  type="button"
                  onClick={() => setOut(id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${out === id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              <button type="button" className={btnCls} onClick={copy}>
                {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />} Sao chép
              </button>
              <button type="button" className={btnCls} onClick={() => download(fileName, text)}>
                <Download className="h-3 w-3" /> Tải
              </button>
              {out !== 'commands' && (
                <button type="button" className={btnCls} onClick={() => onSendToAnalyzer(text)} title="Mở trong tab Phân tích">
                  <ArrowRightLeft className="h-3 w-3" /> Phân tích
                </button>
              )}
            </div>
          </div>
          {out === 'server' && res.http.includes('=====') && (
            <p className="px-3 py-1.5 text-[11px] text-amber-700 bg-amber-50 border-b border-amber-100">
              Kịch bản này cần thêm khai báo cấp <code className="font-mono">http {'{ }'}</code> (map / upstream / limit_req_zone…). Xem tab “Cấp http” hoặc dùng “Gộp 1 file”.
            </p>
          )}
          <pre className="bg-slate-900 text-slate-100 text-[11.5px] leading-relaxed font-mono p-3 overflow-x-auto whitespace-pre" tabIndex={0}>
            {text}
          </pre>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className={`px-2 py-0.5 rounded-full border ${errCount ? sevStyle.error.cls : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
            {errCount ? `${errCount} lỗi cú pháp/ngữ cảnh` : 'Tự kiểm tra: không có lỗi'}
          </span>
          {warnCount > 0 && <span className={`px-2 py-0.5 rounded-full border ${sevStyle.warn.cls}`}>{warnCount} cảnh báo</span>}
          <span className="text-slate-400">Bộ phân tích nội bộ đã chạy trên cấu hình vừa tạo (không thay thế được `nginx -t`).</span>
        </div>

        {res.warnings.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-1">
            {res.warnings.map((w) => (
              <p key={w} className="flex gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /> {w}
              </p>
            ))}
          </div>
        )}
        {res.notes.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 space-y-1">
            <p className="font-semibold text-slate-800">Giải thích & lưu ý</p>
            {res.notes.map((n) => (
              <p key={n} className="flex gap-1.5">
                <Info className="h-3.5 w-3.5 shrink-0 mt-px text-indigo-500" /> {n}
              </p>
            ))}
          </div>
        )}
        <p className="text-[11px] text-slate-500">
          Mẹo: luôn chạy <code className="font-mono">sudo nginx -t</code> trước <code className="font-mono">nginx -s reload</code>. Lấy chứng chỉ trước (tắt HTTPS → certbot → bật HTTPS) để tránh lỗi thiếu file .pem.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab: Phân tích                                                      */
/* ------------------------------------------------------------------ */

function AnalyzerTab({ text, setText }: { text: string; setText: (t: string) => void }) {
  const { showToast } = useApp();
  const [mode, setMode] = useState<'lint' | 'explain'>('lint');
  const [filter, setFilter] = useState<Severity | 'all'>('all');
  const fileRef = useRef<HTMLInputElement>(null);
  const deferred = useDeferredValue(text);
  const result = useMemo(() => lintNginx(deferred), [deferred]);
  const explain = useMemo(() => (mode === 'explain' ? explainConfig(deferred) : []), [mode, deferred]);

  const counts = useMemo(() => {
    const c = { error: 0, warn: 0, info: 0 };
    for (const i of result.issues) c[i.severity]++;
    return c;
  }, [result]);
  const shown = result.issues.filter((i) => filter === 'all' || i.severity === filter).slice(0, 500);
  const byLine = useMemo(() => {
    const m = new Map<number, Severity>();
    const rank: Record<Severity, number> = { error: 3, warn: 2, info: 1 };
    for (const i of result.issues) {
      const cur = m.get(i.line);
      if (!cur || rank[i.severity] > rank[cur]) m.set(i.line, i.severity);
    }
    return m;
  }, [result]);
  const lines = useMemo(() => deferred.replace(/\r\n?/g, '\n').split('\n'), [deferred]);
  const LINE_CAP = 3000;

  const jump = (line: number) => {
    const el = document.getElementById(`ng-ln-${line}`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 1024 * 1024) {
      showToast('File quá lớn (tối đa 1 MB).');
      return;
    }
    setText(await f.text());
  };

  const lineBg: Record<Severity, string> = { error: 'bg-red-50', warn: 'bg-amber-50', info: 'bg-indigo-50' };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold text-slate-800">Dán cấu hình nginx</h2>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={btnCls} onClick={() => setText(SAMPLE_BAD)}>
                <Sparkles className="h-3 w-3 text-amber-500" /> Mẫu có lỗi
              </button>
              <button type="button" className={btnCls} onClick={() => fileRef.current?.click()}>
                <Upload className="h-3 w-3" /> Mở file
              </button>
              <button type="button" className={btnCls} onClick={() => setText('')}>
                <Trash2 className="h-3 w-3" /> Xoá
              </button>
              <input ref={fileRef} type="file" accept=".conf,.txt,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </div>
          </div>
          <textarea
            data-handoff
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_CONFIG_CHARS))}
            spellCheck={false}
            placeholder={'server {\n    listen 80;\n    server_name example.com;\n    ...\n}'}
            rows={Math.max(18, Math.min(3000, text.split('\n').length + 1))}
            className="block w-full resize-none overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-[12px] leading-relaxed text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
          <p className="text-[11px] text-slate-500">
            {result.lineCount} dòng · {result.stats.servers} server · {result.stats.locations} location · {result.stats.directives} directive. Phân tích tĩnh, chạy hoàn toàn trên trình duyệt, không đọc được các file <code className="font-mono">include</code>.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-xs p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1" role="tablist">
              <button type="button" role="tab" aria-selected={mode === 'lint'} onClick={() => setMode('lint')} className={`px-2.5 py-1 rounded-lg text-xs font-medium ${mode === 'lint' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                Kiểm tra lỗi
              </button>
              <button type="button" role="tab" aria-selected={mode === 'explain'} onClick={() => setMode('explain')} className={`px-2.5 py-1 rounded-lg text-xs font-medium ${mode === 'explain' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                Giải thích từng dòng
              </button>
            </div>
            {mode === 'lint' && (
              <div className="flex gap-1 text-[11px]">
                {(['all', 'error', 'warn', 'info'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={`px-2 py-0.5 rounded-full border ${filter === f ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    {f === 'all' ? `Tất cả ${result.issues.length}` : f === 'error' ? `Lỗi ${counts.error}` : f === 'warn' ? `Cảnh báo ${counts.warn}` : `Gợi ý ${counts.info}`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {mode === 'lint' ? (
            !text.trim() ? (
              <p className="text-xs text-slate-500 py-8 text-center">Dán cấu hình vào ô bên trái hoặc bấm “Mẫu có lỗi” để thử.</p>
            ) : shown.length === 0 ? (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-3 flex items-center gap-1.5">
                <Check className="h-4 w-4" /> {result.issues.length === 0 ? 'Không phát hiện vấn đề nào.' : 'Không có mục nào ở bộ lọc này.'}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {shown.map((i: Issue, idx) => {
                  const st = sevStyle[i.severity];
                  return (
                    <li key={idx}>
                      <button type="button" onClick={() => jump(i.line)} className={`w-full text-left rounded-lg border px-2.5 py-1.5 ${st.cls}`}>
                        <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                          <st.Icon className="h-3.5 w-3.5" /> {st.label} · dòng {i.line}:{i.col} · <span className="font-mono font-normal opacity-70">{i.rule}</span>
                        </span>
                        <span className="block text-xs mt-0.5 leading-snug">{i.message}</span>
                        {i.hint && <span className="block text-[11px] mt-0.5 opacity-80 leading-snug">Gợi ý: {i.hint}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : explain.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">Chưa có nội dung để giải thích.</p>
          ) : (
            <ul className="space-y-1.5">
              {explain.slice(0, 1500).map((e) => (
                <li key={`${e.line}-${e.kind}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5" style={{ marginLeft: Math.min(e.depth, 6) * 10 }}>
                  <p className="font-mono text-[11.5px] text-slate-800 break-all">
                    <span className="text-slate-400 mr-1.5">{e.line}</span>
                    {e.source}
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5 leading-snug">{e.text}</p>
                  {e.details.map((d) => (
                    <p key={d} className="text-[10.5px] text-slate-400 leading-snug">
                      {d}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {text.trim() && mode === 'lint' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          <p className="px-3 py-1.5 text-[11px] font-semibold text-slate-700 border-b border-slate-100 flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" /> Vị trí vấn đề trong file {lines.length > LINE_CAP && <span className="font-normal text-slate-400">(hiển thị {LINE_CAP} dòng đầu)</span>}
          </p>
          <div className="overflow-x-auto font-mono text-[11.5px] leading-relaxed">
            {lines.slice(0, LINE_CAP).map((l, i) => {
              const sev = byLine.get(i + 1);
              return (
                <div key={i} id={`ng-ln-${i + 1}`} className={`flex ${sev ? lineBg[sev] : ''}`}>
                  <span className="w-12 shrink-0 text-right pr-2 text-slate-400 select-none">{i + 1}</span>
                  <span className="whitespace-pre text-slate-800">{l || ' '}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab: Từ điển directive                                              */
/* ------------------------------------------------------------------ */

function DictionaryTab() {
  const [q, setQ] = useState('');
  const all = useMemo(() => allDirectives(), []);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const r = t ? all.filter((d) => d.name.includes(t) || d.desc.toLowerCase().includes(t)) : all;
    return r.slice(0, 80);
  }, [q, all]);
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs p-3 space-y-2.5">
      <div className="relative">
        <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className={inputCls + ' pl-8'} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Tìm trong ${directiveCount()} directive (vd: proxy, gzip, ssl, cache…)`} />
      </div>
      <ul className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {list.map((d) => (
          <li key={d.name} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
            <p className="font-mono text-xs font-semibold text-indigo-700">{d.name}</p>
            <p className="text-xs text-slate-700 leading-snug">{d.desc}</p>
            <p className="font-mono text-[10.5px] text-slate-500 mt-0.5 break-all">{d.syntax}</p>
            <p className="text-[10.5px] text-slate-400">Ngữ cảnh: {d.contexts.join(', ')}</p>
          </li>
        ))}
      </ul>
      {list.length === 0 && <p className="text-xs text-slate-500 text-center py-4">Không tìm thấy directive phù hợp.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Trang chính                                                         */
/* ------------------------------------------------------------------ */

export default function NginxConfigPage() {
  const [tab, setTab] = useState<'gen' | 'lint' | 'dict'>('gen');
  const [analyzerText, setAnalyzerText] = useState('');

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Server className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Nginx Config Generator</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Tạo cấu hình nginx chuẩn (SSL Mozilla, proxy, SPA, PHP, rate limit…) và phân tích/giải thích cấu hình có sẵn. Chạy hoàn toàn trên trình duyệt.
            </p>
          </div>
        </div>
        <div className="flex gap-1" role="tablist">
          {(
            [
              ['gen', 'Tạo cấu hình'],
              ['lint', 'Phân tích & Giải thích'],
              ['dict', 'Từ điển directive'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition ${tab === id ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div hidden={tab !== 'gen'}>
        <GeneratorTab
          onSendToAnalyzer={(t) => {
            setAnalyzerText(t);
            setTab('lint');
          }}
        />
      </div>
      {tab === 'lint' && <AnalyzerTab text={analyzerText} setText={setAnalyzerText} />}
      {tab === 'dict' && <DictionaryTab />}
    </div>
  );
}
