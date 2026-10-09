'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import {
  ScrollText,
  Upload,
  Trash2,
  Copy,
  Download,
  ChevronRight,
  ChevronDown,
  Search,
  Sparkles,
  ShieldCheck,
  BarChart3,
  X,
  AlertTriangle,
  Layers,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  LEVELS,
  LEVEL_LABEL,
  MAX_INPUT_BYTES,
  EMPTY_FILTER,
  LogParser,
  StatsAccumulator,
  compileFilter,
  entryFullText,
  exportCsv,
  exportJson,
  exportLog,
  formatTs,
  maskSensitive,
  parseTimestamp,
} from '@/lib/log-parser';
import type { FilterSpec, Level, LogEntry, StatsResult } from '@/lib/log-parser';

/* ------------------------------------------------------------------ */
/* Mẫu                                                                 */
/* ------------------------------------------------------------------ */

const SAMPLES: { id: string; label: string; text: string }[] = [
  {
    id: 'spring',
    label: 'Spring Boot + stack trace',
    text: `2024-03-05 10:15:30.123  INFO 12345 --- [           main] o.s.b.SpringApplication : Started DemoApplication in 3.2 seconds
2024-03-05 10:15:31.456  INFO 12345 --- [nio-8080-exec-1] c.e.demo.UserController : Loading user 1001 from 10.0.0.12
2024-03-05 10:15:32.789 ERROR 12345 --- [nio-8080-exec-2] c.e.demo.UserService : Cannot load user 1002 for admin@example.com
java.lang.IllegalStateException: Connection pool exhausted
\tat com.example.demo.db.Pool.acquire(Pool.java:88)
\tat com.example.demo.UserService.load(UserService.java:42)
\tat com.example.demo.UserController.get(UserController.java:27)
Caused by: java.net.SocketTimeoutException: Read timed out
\tat java.base/java.net.SocketInputStream.read(SocketInputStream.java:186)
\t... 12 more
2024-03-05 10:15:33.001  WARN 12345 --- [nio-8080-exec-3] c.e.demo.UserService : Slow query took 2310 ms
2024-03-05 10:15:34.100 ERROR 12345 --- [nio-8080-exec-4] c.e.demo.UserService : Cannot load user 1003 for bob@example.com
java.lang.IllegalStateException: Connection pool exhausted
\tat com.example.demo.db.Pool.acquire(Pool.java:88)
2024-03-05 10:15:40.250 DEBUG 12345 --- [   scheduling-1] c.e.demo.Cleanup : Removed 0 expired sessions`,
  },
  {
    id: 'json',
    label: 'JSON lines',
    text: `{"level":"info","time":"2024-01-01T08:00:00.000Z","msg":"server listening","port":3000,"logger":"http"}
{"level":"info","time":"2024-01-01T08:00:02.120Z","msg":"request completed","method":"GET","path":"/api/items/17","status":200,"duration_ms":12,"trace_id":"a1b2c3"}
{"level":"warn","time":"2024-01-01T08:00:03.500Z","msg":"cache miss for key user:42","logger":"cache"}
{"level":"error","time":"2024-01-01T08:00:04.900Z","msg":"upstream timeout after 3000ms","status":504,"logger":"http","trace_id":"d4e5f6","stack":"Error: upstream timeout\\n    at fetchUp (/app/up.js:10:5)\\n    at async handler (/app/h.js:22:3)"}
{"level":50,"time":1704096005000,"msg":"pino style numeric level","pid":99}
{"severity":"CRITICAL","@timestamp":"2024-01-01T08:00:06+07:00","message":"disk full on /dev/sda1","logger":"sys"}
{"level":"info","time":"2024-01-01T08:00:07.000Z","msg":"request completed","method":"POST","path":"/api/items","status":503,"duration_ms":3012}`,
  },
  {
    id: 'logfmt',
    label: 'logfmt',
    text: `time=2024-02-01T10:00:00Z level=info msg="starting worker" worker=3 queue=default
time=2024-02-01T10:00:01Z level=info msg="job done" job_id=551 duration=120ms
time=2024-02-01T10:00:02Z level=warn msg="retrying job" job_id=552 attempt=2
time=2024-02-01T10:00:05Z level=error msg="job failed" job_id=552 err="connection refused" host=10.1.2.3
ts=2024-02-01T10:00:06Z level=debug msg="heartbeat" worker=3`,
  },
  {
    id: 'nginx',
    label: 'Nginx / Apache access',
    text: `203.0.113.9 - - [10/Oct/2023:13:55:36 +0000] "GET /api/users/42 HTTP/1.1" 200 1534 "-" "Mozilla/5.0 (X11; Linux x86_64)" 0.045
203.0.113.9 - - [10/Oct/2023:13:55:37 +0000] "GET /api/orders?page=2 HTTP/1.1" 200 8210 "https://shop.example/" "Mozilla/5.0" 0.312
198.51.100.7 - alice [10/Oct/2023:13:55:40 +0000] "POST /api/login HTTP/1.1" 401 59 "-" "curl/8.4.0" 0.020
198.51.100.7 - - [10/Oct/2023:13:55:41 +0000] "GET /api/users/43 HTTP/1.1" 500 120 "-" "curl/8.4.0" 2.801
192.0.2.55 - - [10/Oct/2023:13:56:02 +0000] "GET /static/app.js HTTP/2.0" 304 0 "-" "Mozilla/5.0" 0.002
192.0.2.55 - - [10/Oct/2023:13:56:10 +0000] "GET /api/orders?page=3 HTTP/1.1" 502 150 "-" "Mozilla/5.0" 5.004
192.0.2.55 - - [10/Oct/2023:13:57:15 +0000] "GET /missing HTTP/1.1" 404 162 "-" "Mozilla/5.0" 0.001
127.0.0.1 - - [10/Oct/2000:13:55:36 -0700] "GET /apache_pb.gif HTTP/1.0" 200 2326`,
  },
  {
    id: 'syslog',
    label: 'Syslog',
    text: `<34>Oct 11 22:14:15 web01 su[1234]: 'su root' failed for lonvick on /dev/pts/8
<30>Oct 11 22:14:20 web01 systemd[1]: Started Daily apt download activities.
<165>1 2024-01-01T12:00:00.003Z app01.example.com myapp 3021 ID47 [meta seq="1"] Order 8812 processed
<11>1 2024-01-01T12:00:05.000Z app01.example.com myapp 3021 ID48 - Payment gateway error code 502
Jan  5 10:00:00 db01 sshd[991]: Failed password for root from 203.0.113.50 port 51122 ssh2`,
  },
  {
    id: 'python',
    label: 'Python traceback',
    text: `2024-01-01 12:00:00,123 - app.main - INFO - Service started
2024-01-01 12:00:01,456 - app.worker - WARNING - Queue length 5120 above threshold
2024-01-01 12:00:02,789 - app.worker - ERROR - Task 7731 failed
Traceback (most recent call last):
  File "/srv/app/worker.py", line 41, in run
    result = handler(job)
  File "/srv/app/handlers.py", line 12, in handler
    return 1 / job.count
ZeroDivisionError: division by zero
2024-01-01 12:00:03,000 - app.worker - INFO - Task 7732 done
ERROR:root:legacy default format message
WARNING:urllib3.connectionpool:Retrying (Retry(total=2)) after connection broken`,
  },
  {
    id: 'node',
    label: 'Node / winston / pino-pretty',
    text: `[2024-01-01 12:00:00.123 +0000] INFO (4121 on api-1): server started on port 3000
[2024-01-01 12:00:01.200 +0000] WARN (4121 on api-1): deprecated call
2024-01-01T12:00:02.000Z error: Unhandled rejection
Error: ECONNREFUSED 127.0.0.1:5432
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1555:16)
    at connect (/app/db.js:20:11)
2024-01-01T12:00:03.000Z info: user 1001 logged in
[12:00:04.500] ERROR (4121): fatal handler crashed`,
  },
  {
    id: 'go',
    label: 'Go log + panic',
    text: `2009/11/10 23:00:00 server listening on :8080
2009/11/10 23:00:05 handled request /api/v1/items in 12ms
2009/11/10 23:00:09 panic: runtime error: index out of range [3] with length 3
goroutine 7 [running]:
main.handler(0xc000123456)
\t/app/main.go:42 +0x1d
created by net/http.(*Server).Serve
\t/usr/local/go/src/net/http/server.go:3086 +0x4cc
2009/11/10 23:00:10 restarting worker`,
  },
  {
    id: 'docker',
    label: 'Docker / Kubernetes',
    text: `2024-01-01T00:00:00.123456789Z stdout F {"level":"info","msg":"ready","port":8080}
2024-01-01T00:00:01.000000000Z stdout F GET /healthz 200
2024-01-01T00:00:02.500000000Z stderr F ERROR: connection to redis lost (10.2.3.4:6379)
2024-01-01T00:00:03.000000000Z stderr F WARN retrying in 5s
{"log":"legacy docker json-file line\\n","stream":"stdout","time":"2024-01-01T00:00:04.000000000Z"}`,
  },
];

/* ------------------------------------------------------------------ */
/* Hằng số giao diện                                                   */
/* ------------------------------------------------------------------ */

const ROW_H = 28;
const TRACE_ROW_EXTRA = 22;
const OVERSCAN = 8;
const PARSE_CHUNK = 1024 * 1024;

const LEVEL_BADGE: Record<Level, string> = {
  trace: 'bg-slate-100 text-slate-500',
  debug: 'bg-indigo-100 text-indigo-700',
  info: 'bg-emerald-100 text-emerald-700',
  warn: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700',
  fatal: 'bg-red-600 text-white',
  unknown: 'bg-slate-100 text-slate-400',
};
const LEVEL_BORDER: Record<Level, string> = {
  trace: 'border-l-slate-200',
  debug: 'border-l-indigo-300',
  info: 'border-l-emerald-300',
  warn: 'border-l-amber-400',
  error: 'border-l-red-500',
  fatal: 'border-l-red-700',
  unknown: 'border-l-slate-200',
};
const LEVEL_BAR: Record<Level, string> = {
  trace: 'bg-slate-300',
  debug: 'bg-indigo-400',
  info: 'bg-emerald-400',
  warn: 'bg-amber-400',
  error: 'bg-red-500',
  fatal: 'bg-red-700',
  unknown: 'bg-slate-300',
};

const inputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const btnCls =
  'px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition flex items-center gap-1 disabled:opacity-50';

function fmtNum(n: number): string {
  return n.toLocaleString('vi-VN');
}

function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function Highlight({ text, re }: { text: string; re: RegExp | null }) {
  if (!re || !text) return <>{text}</>;
  const parts: ReactNode[] = [];
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = rx.exec(text)) !== null && guard++ < 50) {
    if (m[0].length === 0) {
      rx.lastIndex++;
      continue;
    }
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <mark key={m.index} className="bg-amber-200 text-slate-900 rounded-xs px-0.5">
        {m[0]}
      </mark>
    );
    last = m.index + m[0].length;
  }
  if (last === 0) return <>{text}</>;
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/* ------------------------------------------------------------------ */
/* Một dòng log                                                        */
/* ------------------------------------------------------------------ */

interface RowProps {
  entry: LogEntry;
  top: number;
  height: number | null;
  open: boolean;
  traceOpen: boolean;
  hl: RegExp | null;
  onToggle: (id: number) => void;
  onToggleTrace: (id: number) => void;
  onCopy: (text: string, what: string) => void;
}

const Row = memo(function Row({ entry: e, top, height, open, traceOpen, hl, onToggle, onToggleTrace, onCopy }: RowProps) {
  const hasTrace = e.trace.length > 0;
  const measured = open || traceOpen;
  const fieldKeys = Object.keys(e.fields);
  return (
    <div
      data-id={measured ? e.id : undefined}
      className={`absolute left-0 right-0 border-b border-slate-100 border-l-4 ${LEVEL_BORDER[e.level]} ${
        e.level === 'error' || e.level === 'fatal' ? 'bg-red-50/40' : 'bg-white'
      } ${measured ? '' : 'overflow-hidden'}`}
      style={{ top, height: measured ? undefined : (height ?? ROW_H) }}
    >
      <div className="group flex items-center gap-2 px-2 h-7 text-xs cursor-pointer hover:bg-slate-50" onClick={() => onToggle(e.id)}>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
        <span className="w-12 shrink-0 text-right text-[10px] text-slate-400 font-mono">{e.line}</span>
        <span className="w-44 shrink-0 truncate font-mono text-[11px] text-slate-500 hidden sm:block" data-tooltip={e.tsText}>
          {e.tsText}
        </span>
        <span className={`w-14 shrink-0 text-center rounded px-1 py-0.5 text-[10px] font-bold ${LEVEL_BADGE[e.level]}`}>
          {LEVEL_LABEL[e.level]}
        </span>
        <span className="flex-1 min-w-0 truncate font-mono text-slate-800">
          <Highlight text={e.message.length > 600 ? e.message.slice(0, 600) : e.message} re={hl} />
        </span>
        <button
          className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded hover:bg-slate-200 text-slate-500"
          data-tooltip="Sao chép entry" aria-label="Sao chép entry"
          onClick={(ev) => {
            ev.stopPropagation();
            onCopy(entryFullText(e), 'entry');
          }}
        >
          <Copy className="h-3 w-3" />
        </button>
      </div>
      {hasTrace && (
        <div
          className="flex items-center gap-1.5 pl-[4.5rem] pr-2 h-[22px] text-[11px] text-slate-500 cursor-pointer hover:text-slate-800"
          onClick={() => onToggleTrace(e.id)}
        >
          {traceOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <span className="shrink-0 font-medium text-red-600">{e.trace.length} dòng stack</span>
          {!traceOpen && <span className="truncate font-mono text-slate-400">{e.trace[0].trim()}</span>}
        </div>
      )}
      {traceOpen && hasTrace && (
        <pre className="mx-2 mb-1 ml-[4.5rem] max-h-72 overflow-auto rounded bg-slate-900 text-slate-100 text-[11px] leading-4 p-2 font-mono whitespace-pre">
          {e.trace.map((t, i) => (
            <div key={i}>
              <Highlight text={t.length > 1000 ? t.slice(0, 1000) + '…' : t} re={hl} />
            </div>
          ))}
        </pre>
      )}
      {open && (
        <div className="mx-2 mb-2 ml-8 rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-2 cursor-default" onClick={(ev) => ev.stopPropagation()}>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <span className="rounded bg-white border border-slate-200 px-1.5 py-0.5">Định dạng: {e.format}</span>
            <span className="rounded bg-white border border-slate-200 px-1.5 py-0.5">Dòng {e.line}</span>
            {e.ts !== null && <span className="rounded bg-white border border-slate-200 px-1.5 py-0.5">UTC: {formatTs(e.ts)}</span>}
            <div className="flex-1" />
            <button className={btnCls} onClick={() => onCopy(e.raw, 'dòng')}>
              <Copy className="h-3 w-3" /> Chép dòng
            </button>
            <button className={btnCls} onClick={() => onCopy(entryFullText(e), 'entry')}>
              <Copy className="h-3 w-3" /> Chép entry
            </button>
          </div>
          {fieldKeys.length > 0 && (
            <table className="w-full text-[11px] border-collapse">
              <tbody>
                {fieldKeys.slice(0, 80).map((k) => (
                  <tr key={k} className="border-t border-slate-200">
                    <td className="py-0.5 pr-3 align-top font-mono text-indigo-700 whitespace-nowrap w-40 max-w-[10rem] truncate">{k}</td>
                    <td className="py-0.5 font-mono text-slate-700 break-all">{e.fields[k]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <pre className="max-h-40 overflow-auto rounded bg-slate-900 text-slate-100 text-[11px] leading-4 p-2 font-mono whitespace-pre-wrap break-all">
            {e.raw}
          </pre>
        </div>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Trang chính                                                         */
/* ------------------------------------------------------------------ */

export default function LogViewerPage() {
  const { showToast } = useApp();

  const [text, setText] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const parseToken = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // Bộ lọc
  const [levels, setLevels] = useState<Set<Level>>(() => new Set<Level>(LEVELS));
  const [q, setQ] = useState('');
  const [regex, setRegex] = useState('');
  const [exclude, setExclude] = useState('');
  const [excludeRegex, setExcludeRegex] = useState(false);
  const [fromStr, setFromStr] = useState('');
  const [toStr, setToStr] = useState('');
  const [fieldQ, setFieldQ] = useState('');
  const [onlyTrace, setOnlyTrace] = useState(false);
  const [cluster, setCluster] = useState<string | null>(null);
  const [mask, setMask] = useState(false);
  const [showStats, setShowStats] = useState(true);

  // Đọc trạng thái từ URL
  useEffect(() => {
    const p = readShareParams();
    if (p.get('q')) setQ(p.get('q') as string);
    if (p.get('re')) setRegex(p.get('re') as string);
    if (p.get('ex')) setExclude(p.get('ex') as string);
    if (p.get('fq')) setFieldQ(p.get('fq') as string);
    const lv = p.get('lv');
    if (lv) {
      const s = new Set<Level>();
      for (const part of lv.split(',')) if ((LEVELS as string[]).includes(part)) s.add(part as Level);
      if (s.size) setLevels(s);
    }
  }, []);

  // Debounce bộ lọc
  const spec: FilterSpec = useMemo(
    () => ({
      ...EMPTY_FILTER(),
      levels,
      text: q,
      regex,
      exclude,
      excludeIsRegex: excludeRegex,
      from: fromStr.trim() ? parseTimestamp(fromStr) : null,
      to: toStr.trim() ? parseTimestamp(toStr) : null,
      fieldQuery: fieldQ,
      onlyTrace,
      cluster,
    }),
    [levels, q, regex, exclude, excludeRegex, fromStr, toStr, fieldQ, onlyTrace, cluster]
  );
  const [applied, setApplied] = useState<FilterSpec>(spec);
  useEffect(() => {
    const t = setTimeout(() => setApplied(spec), 250);
    return () => clearTimeout(t);
  }, [spec]);

  const timeError =
    (fromStr.trim() && spec.from === null ? 'Thời gian "từ" không hợp lệ. ' : '') +
    (toStr.trim() && spec.to === null ? 'Thời gian "đến" không hợp lệ.' : '');

  /* ---------------- Phân tích ---------------- */

  const resetView = () => {
    setLevels(new Set<Level>(LEVELS));
    setQ('');
    setRegex('');
    setExclude('');
    setFromStr('');
    setToStr('');
    setFieldQ('');
    setOnlyTrace(false);
    setCluster(null);
  };

  const runParse = useCallback(
    async (name: string, getChunks: () => AsyncGenerator<{ chunk: string; frac: number }>) => {
      const token = ++parseToken.current;
      setParsing(true);
      setProgress(0);
      setEntries([]);
      setSourceName(name);
      const parser = new LogParser();
      try {
        for await (const { chunk, frac } of getChunks()) {
          if (token !== parseToken.current) return;
          parser.feedText(chunk);
          setProgress(frac);
          await new Promise((r) => setTimeout(r, 0));
        }
        if (token !== parseToken.current) return;
        const result = parser.finish();
        setEntries(result);
        if (result.length === 0) showToast('Không tìm thấy dòng log nào.');
      } catch {
        showToast('Lỗi khi đọc nội dung log.');
      } finally {
        if (token === parseToken.current) {
          setParsing(false);
          setProgress(1);
        }
      }
    },
    [showToast]
  );

  const parseText = useCallback(
    (content: string, name: string) => {
      if (content.length > MAX_INPUT_BYTES) {
        showToast('Nội dung vượt quá 20 MB. Hãy cắt nhỏ log.');
        return;
      }
      resetView();
      void runParse(name, async function* () {
        for (let pos = 0; pos < content.length; pos += PARSE_CHUNK) {
          yield { chunk: content.slice(pos, pos + PARSE_CHUNK), frac: Math.min(1, (pos + PARSE_CHUNK) / content.length) };
        }
      });
    },
    [runParse, showToast]
  );

  const parseFile = useCallback(
    (file: File) => {
      if (file.size > MAX_INPUT_BYTES) {
        showToast('File vượt quá 20 MB.');
        return;
      }
      resetView();
      void runParse(file.name, async function* () {
        const decoder = new TextDecoder('utf-8');
        for (let pos = 0; pos < file.size; pos += PARSE_CHUNK) {
          const buf = await file.slice(pos, Math.min(file.size, pos + PARSE_CHUNK)).arrayBuffer();
          const last = pos + PARSE_CHUNK >= file.size;
          yield { chunk: decoder.decode(buf, { stream: !last }), frac: Math.min(1, (pos + PARSE_CHUNK) / file.size) };
        }
        if (file.size === 0) yield { chunk: '', frac: 1 };
      });
    },
    [runParse, showToast]
  );

  const clearAll = () => {
    parseToken.current++;
    setParsing(false);
    setEntries([]);
    setText('');
    setSourceName('');
    resetView();
  };

  const onDrop = (ev: DragEvent) => {
    ev.preventDefault();
    setDragging(false);
    const f = ev.dataTransfer.files?.[0];
    if (f) parseFile(f);
  };

  /* ---------------- Lọc (theo khối) ---------------- */

  const [filtered, setFiltered] = useState<LogEntry[]>([]);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [filtering, setFiltering] = useState(false);

  useEffect(() => {
    const c = compileFilter(applied);
    if (!c.ok) {
      setFilterError(c.error);
      return;
    }
    setFilterError(null);
    if (entries.length === 0) {
      setFiltered([]);
      return;
    }
    let cancelled = false;
    const { test, usesRegex } = c.value;
    const out: LogEntry[] = [];
    const t0 = performance.now();
    let i = 0;
    const size = usesRegex ? 1500 : 25000;
    setFiltering(true);
    const step = () => {
      if (cancelled) return;
      const end = Math.min(entries.length, i + size);
      for (; i < end; i++) if (test(entries[i])) out.push(entries[i]);
      if (usesRegex && performance.now() - t0 > 5000 && i < entries.length) {
        setFilterError('Regex chạy quá chậm (quá 5 giây) nên đã dừng. Hãy đơn giản hóa mẫu.');
        setFiltering(false);
        return;
      }
      if (i < entries.length) setTimeout(step, 0);
      else {
        setFiltered(out);
        setFiltering(false);
      }
    };
    setTimeout(step, 0);
    return () => {
      cancelled = true;
    };
  }, [entries, applied]);

  const highlight = useMemo(() => {
    const c = compileFilter(applied);
    return c.ok ? c.value.highlight : null;
  }, [applied]);

  /* ---------------- Thống kê (theo khối) ---------------- */

  const [stats, setStats] = useState<StatsResult | null>(null);
  useEffect(() => {
    if (!showStats || filtered.length === 0) {
      setStats(null);
      return;
    }
    let cancelled = false;
    const acc = new StatsAccumulator();
    let i = 0;
    const step = () => {
      if (cancelled) return;
      const end = Math.min(filtered.length, i + 20000);
      for (; i < end; i++) acc.add(filtered[i]);
      if (i < filtered.length) setTimeout(step, 0);
      else setStats(acc.result(10));
    };
    setTimeout(step, 0);
    return () => {
      cancelled = true;
    };
  }, [filtered, showStats]);

  /* ---------------- Danh sách ảo ---------------- */

  const [openSet, setOpenSet] = useState<Set<number>>(() => new Set());
  const [traceSet, setTraceSet] = useState<Set<number>>(() => new Set());
  const heights = useRef(new Map<number, number>());
  const [hv, setHv] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpenSet(new Set());
    setTraceSet(new Set());
    heights.current = new Map();
  }, [entries]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [filtered]);

  const offsets = useMemo(() => {
    const n = filtered.length;
    const o = new Float64Array(n + 1);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      o[i] = acc;
      const e = filtered[i];
      let h: number;
      const isOpen = openSet.has(e.id);
      const isTrace = traceSet.has(e.id);
      if (isOpen || isTrace) {
        h = heights.current.get(e.id) ?? (ROW_H + (e.trace.length ? TRACE_ROW_EXTRA : 0) + (isOpen ? 260 : 0) + (isTrace ? Math.min(e.trace.length, 18) * 16 + 12 : 0));
      } else h = ROW_H + (e.trace.length ? TRACE_ROW_EXTRA : 0);
      acc += h;
    }
    o[n] = acc;
    return o;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, openSet, traceSet, hv]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, [entries.length]);

  const range = useMemo(() => {
    const n = filtered.length;
    if (n === 0) return { start: 0, end: 0 };
    // tìm phần tử đầu tiên có offsets[i+1] > scrollTop
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1] > scrollTop) hi = mid;
      else lo = mid + 1;
    }
    const start = Math.max(0, lo - OVERSCAN);
    let end = lo;
    while (end < n && offsets[end] < scrollTop + viewH) end++;
    return { start, end: Math.min(n, end + OVERSCAN) };
  }, [filtered.length, offsets, scrollTop, viewH]);

  // Đo chiều cao các dòng đang mở
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const root = innerRef.current;
    if (!root) return;
    let changed = false;
    root.querySelectorAll<HTMLElement>('[data-id]').forEach((el) => {
      const id = Number(el.dataset.id);
      const h = el.offsetHeight;
      const prev = heights.current.get(id);
      if (h > 0 && (prev === undefined || Math.abs(prev - h) > 1)) {
        heights.current.set(id, h);
        changed = true;
      }
    });
    if (changed) setHv((v) => v + 1);
  });

  const toggleOpen = useCallback((id: number) => {
    setOpenSet((s) => {
      const n = new Set(s);
      if (n.has(id)) {
        n.delete(id);
        if (!traceSet.has(id)) heights.current.delete(id);
      } else n.add(id);
      return n;
    });
    heights.current.delete(id);
  }, [traceSet]);

  const toggleTrace = useCallback((id: number) => {
    setTraceSet((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    heights.current.delete(id);
  }, []);

  const copyText = useCallback(
    async (t: string, what: string) => {
      try {
        await navigator.clipboard.writeText(mask ? maskSensitive(t) : t);
        showToast(`Đã sao chép ${what}${mask ? ' (đã che dữ liệu nhạy cảm)' : ''}!`);
      } catch {
        showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
      }
    },
    [mask, showToast]
  );

  /* ---------------- Xuất ---------------- */

  const doExport = (kind: 'log' | 'json' | 'csv') => {
    if (filtered.length === 0) {
      showToast('Không có dòng nào để xuất.');
      return;
    }
    const day = new Date().toISOString().slice(0, 10);
    if (kind === 'log') download(`log_loc_${day}.log`, exportLog(filtered, mask), 'text/plain;charset=utf-8');
    else if (kind === 'json') download(`log_loc_${day}.json`, exportJson(filtered, mask), 'application/json;charset=utf-8');
    else download(`log_loc_${day}.csv`, exportCsv(filtered, mask), 'text/csv;charset=utf-8');
    showToast(`Đã xuất ${fmtNum(filtered.length)} entry (.${kind})${mask ? ' đã che dữ liệu nhạy cảm' : ''}.`);
  };

  /* ---------------- Dẫn xuất ---------------- */

  const formatCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.format, (m.get(e.format) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const toggleLevel = (lv: Level) => {
    setLevels((s) => {
      const n = new Set(s);
      if (n.has(lv)) n.delete(lv);
      else n.add(lv);
      return n;
    });
  };

  const filterActive =
    levels.size < LEVELS.length || q || regex || exclude || fromStr || toStr || fieldQ || onlyTrace || cluster;

  const shareParams = {
    q,
    re: regex,
    ex: exclude,
    fq: fieldQ,
    lv: levels.size < LEVELS.length ? [...levels].join(',') : '',
  };

  const hasData = entries.length > 0;
  const maxBucket = stats ? Math.max(1, ...stats.buckets.map((b) => b.count)) : 1;
  const maxLevel = stats ? Math.max(1, ...LEVELS.map((l) => stats.levelCounts[l])) : 1;

  return (
    <div className="space-y-3.5">
      {/* HEADER */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <ScrollText className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Log Viewer</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Dán hoặc kéo thả file log (tối đa 20 MB), tự nhận dạng định dạng, gom stack trace, lọc, thống kê. Xử lý hoàn toàn trên trình duyệt.
            </p>
          </div>
        </div>
        <ShareLinkButton params={shareParams} className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1" />
      </div>

      {/* NHẬP */}
      <div
        className={`bg-white rounded-xl border p-3 space-y-2.5 shadow-xs transition ${dragging ? 'border-indigo-400 ring-2 ring-indigo-200' : 'border-slate-200'}`}
        onDragOver={(ev) => {
          ev.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <textarea
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          placeholder="Dán log vào đây, hoặc kéo thả file .log / .txt / .json vào khung này..."
          spellCheck={false}
          className={`w-full ${hasData ? 'h-16' : 'h-24'} rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => (text.trim() ? parseText(text, 'Văn bản dán') : showToast('Hãy dán log vào ô trên trước.'))}
            disabled={parsing}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition flex items-center gap-1 disabled:opacity-50"
          >
            <Search className="h-3.5 w-3.5" /> Phân tích
          </button>
          <button onClick={() => fileRef.current?.click()} className={btnCls} disabled={parsing}>
            <Upload className="h-3.5 w-3.5" /> Mở file...
          </button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(ev) => {
              const f = ev.target.files?.[0];
              if (f) parseFile(f);
              ev.target.value = '';
            }}
          />
          <button onClick={clearAll} className={btnCls}>
            <Trash2 className="h-3.5 w-3.5" /> Xóa
          </button>
          <span className="text-[11px] text-slate-400 mx-1 hidden md:inline">Mẫu thử:</span>
          {SAMPLES.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setText(s.text);
                parseText(s.text, s.label);
              }}
              className="px-2 py-1 rounded-full text-[11px] bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 border border-slate-200 transition flex items-center gap-1"
            >
              <Sparkles className="h-3 w-3 text-amber-500" />
              {s.label}
            </button>
          ))}
        </div>
        {parsing && (
          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="text-[11px] text-slate-500">Đang phân tích... {Math.round(progress * 100)}%</p>
          </div>
        )}
        <p className={`text-[11px] text-slate-400 ${hasData ? 'hidden' : ''}`}>
          Mẹo: timestamp không kèm múi giờ được coi là UTC. Truy vấn trường: <code className="font-mono">status&gt;=500 logger=foo level&gt;=warn msg~timeout</code>.
        </p>
      </div>

      {!hasData && !parsing && (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          <ScrollText className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          Chưa có log. Dán nội dung, mở file hoặc chọn một mẫu thử ở trên.
        </div>
      )}

      {hasData && (
        <>
          {/* TÓM TẮT + BỘ LỌC */}
          <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2.5 shadow-xs">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-700">{sourceName}</span>
              <span>· {fmtNum(entries.length)} entry</span>
              {formatCounts.slice(0, 6).map(([f, c]) => (
                <span key={f} className="rounded bg-slate-100 px-1.5 py-0.5">
                  {f}: {fmtNum(c)}
                </span>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {LEVELS.map((lv) => {
                const on = levels.has(lv);
                return (
                  <button
                    key={lv}
                    onClick={() => toggleLevel(lv)}
                    className={`px-2 py-1 rounded-md text-[11px] font-bold border transition ${
                      on ? `${LEVEL_BADGE[lv]} border-transparent` : 'bg-white text-slate-300 border-slate-200 line-through'
                    }`}
                    data-tooltip={on ? 'Đang hiện - bấm để ẩn' : 'Đang ẩn - bấm để hiện'}
                  >
                    {LEVEL_LABEL[lv]}
                    {stats && on ? ` ${fmtNum(stats.levelCounts[lv])}` : ''}
                  </button>
                );
              })}
              <label className="flex items-center gap-1 text-xs text-slate-600 ml-2 cursor-pointer">
                <input type="checkbox" checked={onlyTrace} onChange={(ev) => setOnlyTrace(ev.target.checked)} />
                Chỉ entry có stack trace
              </label>
              <label className="flex items-center gap-1 text-xs text-slate-600 ml-2 cursor-pointer" data-tooltip="Che email, IP, Bearer token, password=... khi sao chép / xuất">
                <input type="checkbox" checked={mask} onChange={(ev) => setMask(ev.target.checked)} />
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                Che dữ liệu nhạy cảm
              </label>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <input className={inputCls} placeholder="Tìm văn bản..." value={q} onChange={(ev) => setQ(ev.target.value)} />
              <input className={`${inputCls} font-mono`} placeholder="Regex (vd: timeout|refused)" value={regex} onChange={(ev) => setRegex(ev.target.value)} />
              <div className="flex gap-1.5">
                <input className={inputCls} placeholder="Loại trừ..." value={exclude} onChange={(ev) => setExclude(ev.target.value)} />
                <label className="flex items-center gap-1 text-[11px] text-slate-500 whitespace-nowrap cursor-pointer">
                  <input type="checkbox" checked={excludeRegex} onChange={(ev) => setExcludeRegex(ev.target.checked)} />
                  regex
                </label>
              </div>
              <input className={`${inputCls} font-mono`} placeholder="Trường: status>=500 logger=foo" value={fieldQ} onChange={(ev) => setFieldQ(ev.target.value)} />
              <input className={`${inputCls} font-mono`} placeholder="Từ (UTC): 2024-01-01 12:00:00" value={fromStr} onChange={(ev) => setFromStr(ev.target.value)} />
              <input className={`${inputCls} font-mono`} placeholder="Đến (UTC): 2024-01-01 13:00:00" value={toStr} onChange={(ev) => setToStr(ev.target.value)} />
              <div className="flex flex-wrap items-center gap-1.5 lg:col-span-2">
                {cluster && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] px-2 py-0.5 max-w-full">
                    <Layers className="h-3 w-3 shrink-0" />
                    <span className="truncate">Nhóm: {cluster}</span>
                    <button onClick={() => setCluster(null)} aria-label="Bỏ lọc nhóm">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
                {filterActive && (
                  <button onClick={resetView} className="text-[11px] text-indigo-600 hover:underline">
                    Xóa tất cả bộ lọc
                  </button>
                )}
              </div>
            </div>

            {(filterError || timeError) && (
              <div className="flex items-start gap-1.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs p-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{filterError || timeError}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-slate-600">
                <b>{fmtNum(filtered.length)}</b> / {fmtNum(entries.length)} entry khớp
                {filtering && <span className="text-slate-400"> · đang lọc...</span>}
              </span>
              <div className="flex-1" />
              <button className={btnCls} onClick={() => setShowStats((v) => !v)}>
                <BarChart3 className="h-3.5 w-3.5" /> {showStats ? 'Ẩn thống kê' : 'Hiện thống kê'}
              </button>
              <button className={btnCls} onClick={() => doExport('log')}>
                <Download className="h-3.5 w-3.5" /> .log
              </button>
              <button className={btnCls} onClick={() => doExport('json')}>
                <Download className="h-3.5 w-3.5" /> .json
              </button>
              <button className={btnCls} onClick={() => doExport('csv')}>
                <Download className="h-3.5 w-3.5" /> .csv
              </button>
            </div>
          </div>

          {/* KHU LÀM VIỆC: danh sách + thống kê */}
          <div className="flex flex-col lg:flex-row gap-3 min-w-0 lg:h-[max(26rem,calc(100dvh-8rem))]">
          {/* THỐNG KÊ */}
          {showStats && stats && (
            <div className="grid gap-3 grid-cols-1 content-start max-h-[60vh] overflow-auto lg:max-h-none lg:h-full lg:min-h-0 lg:w-[26rem] xl:w-[32rem] lg:shrink-0 lg:order-last">
              <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs space-y-2">
                <h2 className="text-xs font-bold text-slate-700">Theo mức độ</h2>
                <div className="space-y-1">
                  {LEVELS.filter((l) => stats.levelCounts[l] > 0).map((l) => (
                    <button key={l} className="w-full flex items-center gap-2 text-[11px] hover:bg-slate-50 rounded" onClick={() => setLevels(new Set<Level>([l]))} data-tooltip="Chỉ hiện mức này">
                      <span className={`w-14 text-center rounded px-1 py-0.5 text-[10px] font-bold ${LEVEL_BADGE[l]}`}>{LEVEL_LABEL[l]}</span>
                      <span className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <span className={`block h-full ${LEVEL_BAR[l]}`} style={{ width: `${(stats.levelCounts[l] / maxLevel) * 100}%` }} />
                      </span>
                      <span className="w-14 text-right font-mono text-slate-600">{fmtNum(stats.levelCounts[l])}</span>
                    </button>
                  ))}
                </div>

                <h2 className="text-xs font-bold text-slate-700 pt-2">Dòng thời gian</h2>
                {stats.buckets.length > 0 ? (
                  <div>
                    <svg viewBox={`0 0 ${stats.buckets.length * 10} 60`} preserveAspectRatio="none" className="w-full h-24 bg-slate-50 rounded border border-slate-200">
                      {stats.buckets.map((b, i) => {
                        const h = (b.count / maxBucket) * 56;
                        const eh = (b.errors / maxBucket) * 56;
                        return (
                          <g
                            key={i}
                            className="cursor-pointer"
                            onClick={() => {
                              setFromStr(formatTs(b.start));
                              setToStr(formatTs(b.end - 1));
                            }}
                          >
                            <title>{`${formatTs(b.start, false)} · ${b.count} entry${b.errors ? `, ${b.errors} lỗi` : ''}`}</title>
                            <rect x={i * 10} y={0} width={10} height={60} fill="transparent" />
                            <rect x={i * 10 + 1} y={58 - h} width={8} height={Math.max(h, b.count ? 1 : 0)} className="fill-indigo-400" />
                            {eh > 0 && <rect x={i * 10 + 1} y={58 - eh} width={8} height={Math.max(eh, 1)} className="fill-red-500" />}
                          </g>
                        );
                      })}
                    </svg>
                    <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-0.5">
                      <span>{stats.minTs !== null ? formatTs(stats.minTs, false) : ''}</span>
                      <span>cột = {stats.bucketMs >= 60000 ? `${stats.bucketMs / 60000} phút` : `${stats.bucketMs / 1000} giây`} · bấm để lọc</span>
                      <span>{stats.maxTs !== null ? formatTs(stats.maxTs, false) : ''}</span>
                    </div>
                    {(fromStr || toStr) && (
                      <button
                        className="text-[11px] text-indigo-600 hover:underline"
                        onClick={() => {
                          setFromStr('');
                          setToStr('');
                        }}
                      >
                        Đặt lại khoảng thời gian
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">Không có entry nào có timestamp.</p>
                )}
                {stats.noTs > 0 && <p className="text-[11px] text-slate-400">{fmtNum(stats.noTs)} entry không có timestamp.</p>}
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs space-y-1.5">
                <h2 className="text-xs font-bold text-slate-700">Nhóm lỗi tương tự (top 10 thông điệp, đã che số/UUID/IP)</h2>
                {stats.clusters.map((c) => (
                  <button
                    key={c.key}
                    className="w-full text-left flex items-start gap-2 text-[11px] hover:bg-slate-50 rounded p-1"
                    onClick={() => setCluster(c.key)}
                    data-tooltip="Bấm để lọc theo nhóm này"
                  >
                    <span className="w-12 shrink-0 text-right font-mono font-bold text-slate-700">{fmtNum(c.count)}</span>
                    <span className={`shrink-0 rounded px-1 text-[10px] font-bold ${LEVEL_BADGE[c.level]}`}>{LEVEL_LABEL[c.level]}</span>
                    <span className="min-w-0 break-all font-mono text-slate-600 line-clamp-2">{c.key}</span>
                  </button>
                ))}
              </div>

              {stats.access && (
                <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs space-y-2">
                  <h2 className="text-xs font-bold text-slate-700">Access log ({fmtNum(stats.access.total)} request)</h2>
                  <div className="grid gap-3 grid-cols-2 text-[11px]">
                    <div>
                      <div className="font-semibold text-slate-600 mb-1">Phân bố status</div>
                      <div className="flex flex-wrap gap-1 mb-1">
                        {Object.entries(stats.access.statusClasses)
                          .sort()
                          .map(([k, v]) => (
                            <button
                              key={k}
                              onClick={() => setFieldQ(`status=${k}`)}
                              className={`rounded px-1.5 py-0.5 font-bold ${k[0] === '5' ? 'bg-red-100 text-red-700' : k[0] === '4' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}
                            >
                              {k}: {fmtNum(v)}
                            </button>
                          ))}
                      </div>
                      {stats.access.statuses.map((s) => (
                        <div key={s.key} className="flex justify-between font-mono text-slate-600">
                          <span>{s.key}</span>
                          <span>{fmtNum(s.count)}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-600 mb-1">Endpoint chậm nhất (TB)</div>
                      {stats.access.slowest.length === 0 && <div className="text-slate-400">Không có dữ liệu độ trễ.</div>}
                      {stats.access.slowest.map((s) => (
                        <div key={s.key} className="flex justify-between gap-2 font-mono text-slate-600">
                          <span className="truncate" data-tooltip={s.key}>{s.key}</span>
                          <span className="shrink-0">{Math.round(s.avgMs)}ms / max {Math.round(s.maxMs)}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-600 mb-1">Top path</div>
                      {stats.access.topPaths.map((s) => (
                        <div key={s.key} className="flex justify-between gap-2 font-mono text-slate-600">
                          <span className="truncate" data-tooltip={s.key}>{s.key}</span>
                          <span>{fmtNum(s.count)}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-600 mb-1">Top IP</div>
                      {stats.access.topIps.map((s) => (
                        <button key={s.key} onClick={() => setFieldQ(`ip=${s.key}`)} className="w-full flex justify-between font-mono text-slate-600 hover:bg-slate-50">
                          <span>{s.key}</span>
                          <span>{fmtNum(s.count)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* DANH SÁCH */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col min-w-0 lg:flex-1 lg:h-full lg:min-h-0">
            <div
              ref={scrollRef}
              onScroll={(ev) => setScrollTop((ev.currentTarget as HTMLDivElement).scrollTop)}
              className="relative overflow-auto h-[60vh] lg:h-auto lg:flex-1 lg:min-h-0"
            >
              {filtered.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  {filtering ? 'Đang lọc...' : 'Không có entry nào khớp bộ lọc.'}
                </div>
              ) : (
                <div ref={innerRef} className="relative min-w-[640px]" style={{ height: offsets[filtered.length] }}>
                  {filtered.slice(range.start, range.end).map((e, k) => {
                    const i = range.start + k;
                    return (
                      <Row
                        key={e.id}
                        entry={e}
                        top={offsets[i]}
                        height={offsets[i + 1] - offsets[i]}
                        open={openSet.has(e.id)}
                        traceOpen={traceSet.has(e.id)}
                        hl={highlight}
                        onToggle={toggleOpen}
                        onToggleTrace={toggleTrace}
                        onCopy={copyText}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          </div>
        </>
      )}
    </div>
  );
}
