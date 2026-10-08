'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Copy, Check, Plus, X, Clock, Globe2, Calculator, ArrowRightLeft } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  DEFAULT_ZONES,
  UNIT_LABEL,
  addDuration,
  describeInstant,
  detectTimestamp,
  diffDates,
  formatIso,
  formatWall,
  getWallParts,
  isValidTimeZone,
  isoUtc,
  listTimeZones,
  localTimeZone,
  meetingPlanner,
  parseDateString,
  worldClock,
  zonedToInstant,
  type Duration,
} from '@/lib/time-tools';

const pad = (n: number) => String(n).padStart(2, '0');

function CopyBtn({ text }: { text: string }) {
  const { showToast } = useApp();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="Sao chép"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
        }
      }}
      className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition shrink-0"
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500 shrink-0 w-40">{label}</span>
      <span className="text-xs font-mono text-slate-800 break-all text-right flex-1">{value}</span>
      <CopyBtn text={value} />
    </div>
  );
}

function Panel({ icon: Icon, title, children, right }: {
  icon: typeof Clock; title: string; children: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
          <Icon className="h-4 w-4 text-indigo-600" />
          {title}
        </h2>
        {right}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

const inputCls =
  'px-2 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200';

function TzSelect({ value, onChange, zones }: { value: string; onChange: (v: string) => void; zones: string[] }) {
  const list = zones.includes(value) ? zones : [value, ...zones];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls + ' max-w-full'}>
      {list.map((z) => (
        <option key={z} value={z}>{z}</option>
      ))}
    </select>
  );
}

const ZERO: Duration = { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
const DUR_FIELDS: [keyof Duration, string][] = [
  ['years', 'Năm'], ['months', 'Tháng'], ['days', 'Ngày'], ['hours', 'Giờ'], ['minutes', 'Phút'], ['seconds', 'Giây'],
];

function toPickers(ms: number, tz: string) {
  const p = getWallParts(ms, tz);
  return {
    date: `${String(p.year).padStart(4, '0')}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`,
  };
}

function fromPickers(date: string, time: string, tz: string): number | null {
  const d = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = (time || '00:00:00').match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!d || !t) return null;
  return zonedToInstant(+d[1], +d[2], +d[3], +t[1], +t[2], +(t[3] ?? 0), tz);
}

function fmtNum(n: number, digits = 2) {
  return n.toLocaleString('vi-VN', { maximumFractionDigits: digits });
}

export default function TimeToolsPage() {
  const { showToast } = useApp();
  const allZones = useMemo(() => listTimeZones(), []);
  const [localTz, setLocalTz] = useState('Asia/Ho_Chi_Minh');
  const [now, setNow] = useState<number | null>(null);

  // converter
  const [input, setInput] = useState('1700000000');
  const [convTz, setConvTz] = useState('Asia/Ho_Chi_Minh');

  // date -> timestamp
  const [pDate, setPDate] = useState('');
  const [pTime, setPTime] = useState('');
  const [pTz, setPTz] = useState('Asia/Ho_Chi_Minh');

  // world clock
  const [zones, setZones] = useState<string[]>(DEFAULT_ZONES);
  const [addZone, setAddZone] = useState('Europe/Paris');
  const [refDate, setRefDate] = useState('');
  const [refTime, setRefTime] = useState('');
  const [refTz, setRefTz] = useState('Asia/Ho_Chi_Minh');
  const [workStart, setWorkStart] = useState(9);
  const [workEnd, setWorkEnd] = useState(18);

  // calculator
  const [aDate, setADate] = useState('');
  const [aTime, setATime] = useState('');
  const [bDate, setBDate] = useState('');
  const [bTime, setBTime] = useState('');
  const [calcTz, setCalcTz] = useState('Asia/Ho_Chi_Minh');
  const [dur, setDur] = useState<Duration>({ ...ZERO, days: 30 });
  const [sign, setSign] = useState<1 | -1>(1);

  useEffect(() => {
    const ltz = localTimeZone();
    const n = Date.now();
    const sp = readShareParams();
    const tzP = sp.get('tz');
    const tz = tzP && isValidTimeZone(tzP) ? tzP : ltz;
    const zs = (sp.get('zones') ?? '').split(',').filter((z) => z && isValidTimeZone(z));
    const ts = sp.get('ts');
    const pk = toPickers(n, tz);
    setLocalTz(ltz);
    setNow(n);
    setConvTz(tz);
    setPTz(tz);
    setRefTz(tz);
    setCalcTz(tz);
    if (ts) setInput(ts);
    if (zs.length) setZones(zs);
    setPDate(pk.date); setPTime(pk.time);
    setRefDate(pk.date); setRefTime(pk.time);
    setADate(pk.date); setATime(pk.time);
    setBDate(pk.date); setBTime(pk.time);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /* ---- converter ---- */
  const conv = useMemo(() => {
    const t = input.trim();
    if (!t) return { error: null as string | null, info: null, unit: null as string | null };
    const ts = detectTimestamp(t);
    let ms: number | null = null;
    let unit: string | null = null;
    if (ts) {
      ms = ts.ms;
      unit = `Timestamp (${UNIT_LABEL[ts.unit]})`;
    } else {
      ms = parseDateString(t, convTz);
      unit = ms === null ? null : 'Chuỗi ngày';
    }
    if (ms === null || Number.isNaN(ms) || Math.abs(ms) > 8.64e15) {
      return { error: 'Không nhận dạng được. Hãy nhập timestamp hoặc ngày dạng ISO, RFC 2822, YYYY-MM-DD HH:mm:ss, dd/mm/yyyy.', info: null, unit: null };
    }
    return { error: null, info: describeInstant(ms, convTz, localTz, now ?? Date.now()), unit };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, convTz, localTz, now === null]);

  /* ---- date -> timestamp ---- */
  const pickedMs = fromPickers(pDate, pTime, pTz);

  /* ---- world clock ---- */
  const refMs = fromPickers(refDate, refTime, refTz) ?? now ?? 0;
  const clock = useMemo(() => (refMs || now ? worldClock(refMs, zones) : []), [refMs, zones, now]);
  const planner = useMemo(
    () => (refMs ? meetingPlanner(refMs, refTz, zones, workStart, workEnd) : []),
    [refMs, refTz, zones, workStart, workEnd]
  );
  const overlapHours = planner.filter((s) => s.allWorking).length;

  /* ---- calculator ---- */
  const aMs = fromPickers(aDate, aTime, calcTz);
  const bMs = fromPickers(bDate, bTime, calcTz);
  const diff = aMs !== null && bMs !== null ? diffDates(aMs, bMs, calcTz) : null;
  const addResult = aMs !== null ? addDuration(aMs, calcTz, dur, sign) : null;

  const setRefFromNow = () => {
    const pk = toPickers(Date.now(), refTz);
    setRefDate(pk.date);
    setRefTime(pk.time);
  };

  const setDurField = (k: keyof Duration, v: string) => {
    const n = Math.max(0, Math.min(100000, parseInt(v, 10) || 0));
    setDur((d) => ({ ...d, [k]: n }));
  };

  const nowInfo = now !== null ? describeInstant(now, localTz, localTz, now) : null;

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <CalendarClock className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Thời gian &amp; Timestamp</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Đổi Unix timestamp, múi giờ, đồng hồ thế giới, lịch họp và tính toán ngày. Xử lý đúng giờ mùa hè (DST), hoàn toàn trên trình duyệt.
            </p>
          </div>
        </div>
        <ShareLinkButton
          params={{ tz: convTz, ts: input.trim().length <= 40 ? input.trim() : '', zones: zones.join(',') }}
          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1"
        />
      </div>

      {/* Hiện tại */}
      <Panel icon={Clock} title="Thời gian hiện tại">
        {nowInfo && now !== null ? (
          <div className="grid md:grid-cols-2 gap-x-6">
            <div>
              <Row label="Unix (giây)" value={String(nowInfo.unixSeconds)} />
              <Row label="Unix (mili giây)" value={String(now)} />
              <Row label="ISO 8601 (UTC)" value={isoUtc(now)} />
            </div>
            <div>
              <Row label={`Giờ địa phương (${localTz})`} value={formatWall(now, localTz)} />
              <Row label="ISO 8601 (địa phương)" value={formatIso(now, localTz, true)} />
              <Row label="UTC" value={formatWall(now, 'UTC')} />
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-400">Đang tải...</p>
        )}
      </Panel>

      <div className="grid lg:grid-cols-2 gap-3.5">
        {/* Converter */}
        <Panel icon={ArrowRightLeft} title="Timestamp / chuỗi ngày → thời gian">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, 200))}
                placeholder="1700000000 hoặc 2023-11-14 22:13:20 hoặc 14/11/2023"
                className={inputCls + ' flex-1 min-w-[200px] font-mono'}
              />
              <button
                type="button"
                onClick={() => setInput(String(Date.now()))}
                className="px-2.5 py-1 rounded-lg text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition"
              >
                Bây giờ
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-600">
              Múi giờ hiển thị / diễn giải:
              <TzSelect value={convTz} onChange={setConvTz} zones={allZones} />
            </div>
            {conv.error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">{conv.error}</p>
            )}
            {conv.info && (
              <div>
                <p className="text-[11px] text-slate-400 mb-1">Nhận dạng: {conv.unit}</p>
                <Row label="Unix (giây)" value={String(conv.info.unixSeconds)} />
                <Row label="Unix (mili giây)" value={String(conv.info.ms)} />
                <Row label="ISO 8601 (UTC)" value={conv.info.isoUtc} />
                <Row label="RFC 2822" value={conv.info.rfc2822} />
                <Row label={`Địa phương (${conv.info.localZone})`} value={conv.info.local} />
                <Row label={`${convTz} (${conv.info.zoneOffset})`} value={conv.info.zoneWall} />
                <Row label="ISO theo múi giờ chọn" value={conv.info.isoZone} />
                <Row label="Tương đối" value={conv.info.relative} />
                <Row label="Thứ" value={conv.info.weekday} />
                <Row label="Tuần trong năm" value={conv.info.week} />
                <Row label="Ngày thứ trong năm" value={`${conv.info.dayOfYear}${conv.info.leap ? ' (năm nhuận)' : ''}`} />
              </div>
            )}
          </div>
        </Panel>

        {/* Date -> timestamp */}
        <Panel icon={Calculator} title="Ngày giờ → timestamp">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              <input type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} className={inputCls} />
              <input type="time" step={1} value={pTime} onChange={(e) => setPTime(e.target.value)} className={inputCls} />
              <TzSelect value={pTz} onChange={setPTz} zones={allZones} />
            </div>
            {pickedMs !== null ? (
              <div>
                <Row label="Unix (giây)" value={String(Math.floor(pickedMs / 1000))} />
                <Row label="Unix (mili giây)" value={String(pickedMs)} />
                <Row label="ISO 8601 (UTC)" value={isoUtc(pickedMs)} />
                <Row label={`ISO (${pTz})`} value={formatIso(pickedMs, pTz)} />
              </div>
            ) : (
              <p className="text-xs text-slate-400">Chọn ngày và giờ hợp lệ.</p>
            )}
            <p className="text-[11px] text-slate-400">
              Giờ không tồn tại (nhảy đồng hồ DST) được đẩy tới sau khoảng trống; giờ bị lặp lấy lần xuất hiện đầu tiên.
            </p>
          </div>
        </Panel>
      </div>

      {/* World clock */}
      <Panel
        icon={Globe2}
        title="Đồng hồ thế giới & lịch họp"
        right={
          <button
            type="button"
            onClick={setRefFromNow}
            className="px-2 py-1 rounded-lg text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition"
          >
            Lấy thời điểm hiện tại
          </button>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            Thời điểm tham chiếu:
            <input type="date" value={refDate} onChange={(e) => setRefDate(e.target.value)} className={inputCls} />
            <input type="time" step={1} value={refTime} onChange={(e) => setRefTime(e.target.value)} className={inputCls} />
            <TzSelect value={refTz} onChange={setRefTz} zones={allZones} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-1.5 pr-3 font-semibold">Múi giờ</th>
                  <th className="py-1.5 pr-3 font-semibold">Giờ</th>
                  <th className="py-1.5 pr-3 font-semibold">Thứ</th>
                  <th className="py-1.5 pr-3 font-semibold">Offset</th>
                  <th className="py-1.5 pr-3 font-semibold">DST</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {clock.map((r) => (
                  <tr key={r.tz} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 pr-3 font-medium text-slate-800">
                      {r.tz} <span className="text-slate-400 font-normal">{r.abbr}</span>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-slate-800">{r.wall}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{r.weekday}</td>
                    <td className="py-1.5 pr-3 font-mono text-slate-600">UTC{r.offset}</td>
                    <td className="py-1.5 pr-3">
                      {r.dstShift && (
                        <span className="px-1.5 py-0.5 rounded-sm bg-amber-100 text-amber-700 text-[10px] font-semibold">
                          Giờ mùa hè
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        title="Xoá"
                        onClick={() => setZones((z) => z.filter((x) => x !== r.tz))}
                        className="p-1 text-slate-400 hover:text-red-600 rounded-md"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {clock.length === 0 && (
                  <tr><td colSpan={6} className="py-3 text-slate-400">Chưa có múi giờ nào. Hãy thêm bên dưới.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <TzSelect value={addZone} onChange={setAddZone} zones={allZones} />
            <button
              type="button"
              onClick={() => {
                if (zones.includes(addZone)) return showToast('Múi giờ này đã có trong danh sách.');
                if (zones.length >= 20) return showToast('Tối đa 20 múi giờ.');
                setZones((z) => [...z, addZone]);
              }}
              className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1"
            >
              <Plus className="h-3.5 w-3.5" /> Thêm
            </button>
            <button
              type="button"
              onClick={() => setZones(DEFAULT_ZONES)}
              className="px-2.5 py-1 rounded-lg text-xs text-slate-500 hover:bg-slate-100 transition"
            >
              Mặc định
            </button>
          </div>

          {/* Planner */}
          <div className="pt-2 border-t border-slate-100">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 mb-2">
              <span className="font-semibold text-slate-800">Lịch họp</span>
              giờ làm việc
              <input type="number" min={0} max={23} value={workStart}
                onChange={(e) => setWorkStart(Math.max(0, Math.min(23, +e.target.value || 0)))}
                className={inputCls + ' w-14'} />
              đến
              <input type="number" min={1} max={24} value={workEnd}
                onChange={(e) => setWorkEnd(Math.max(1, Math.min(24, +e.target.value || 1)))}
                className={inputCls + ' w-14'} />
              <span className="text-slate-400">
                (ngày {refDate} theo {refTz}) — {overlapHours > 0 ? `${overlapHours} giờ trùng giờ làm việc` : 'không có giờ nào trùng'}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="text-[11px] border-separate border-spacing-px">
                <thead>
                  <tr>
                    <th className="text-left pr-2 font-medium text-slate-500 sticky left-0 bg-white">Múi giờ</th>
                    {planner.map((s, i) => (
                      <th key={i} className={`font-mono font-medium px-1 ${s.allWorking ? 'text-emerald-700' : 'text-slate-400'}`}>
                        {pad(i)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {zones.filter(isValidTimeZone).map((tz, zi) => (
                    <tr key={tz}>
                      <td className="pr-2 whitespace-nowrap text-slate-700 sticky left-0 bg-white">{tz}</td>
                      {planner.map((s, i) => {
                        const c = s.cells[zi];
                        if (!c) return <td key={i} />;
                        return (
                          <td
                            key={i}
                            title={`${pad(c.hour)}:${pad(c.minute)}${c.dayShift ? (c.dayShift > 0 ? ' (ngày hôm sau)' : ' (ngày hôm trước)') : ''}`}
                            className={`text-center font-mono px-1 py-0.5 rounded-xs ${
                              s.allWorking
                                ? 'bg-emerald-500 text-white font-semibold'
                                : c.working
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-slate-100 text-slate-400'
                            } ${c.dayShift ? 'underline decoration-dotted' : ''}`}
                          >
                            {pad(c.hour)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              Cột = giờ theo múi giờ tham chiếu ({refTz}). Ô xanh đậm: mọi nơi đều trong giờ làm việc; xanh nhạt: nơi đó đang làm việc; gạch chân: khác ngày so với ngày tham chiếu.
            </p>
          </div>
        </div>
      </Panel>

      {/* Calculator */}
      <Panel
        icon={Calculator}
        title="Máy tính ngày"
        right={<TzSelect value={calcTz} onChange={setCalcTz} zones={allZones} />}
      >
        <div className="grid lg:grid-cols-2 gap-5">
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-700">Khoảng cách giữa hai ngày</h3>
            <div className="flex flex-wrap gap-2 items-center text-xs text-slate-600">
              Từ
              <input type="date" value={aDate} onChange={(e) => setADate(e.target.value)} className={inputCls} />
              <input type="time" step={1} value={aTime} onChange={(e) => setATime(e.target.value)} className={inputCls} />
            </div>
            <div className="flex flex-wrap gap-2 items-center text-xs text-slate-600">
              Đến
              <input type="date" value={bDate} onChange={(e) => setBDate(e.target.value)} className={inputCls} />
              <input type="time" step={1} value={bTime} onChange={(e) => setBTime(e.target.value)} className={inputCls} />
            </div>
            {diff ? (
              <div>
                <Row
                  label={diff.negative ? 'Chênh lệch (ngày kết thúc trước)' : 'Chênh lệch'}
                  value={`${diff.years} năm ${diff.months} tháng ${diff.days} ngày ${diff.hours} giờ ${diff.minutes} phút ${diff.seconds} giây`}
                />
                <Row label="Tổng số ngày" value={fmtNum(diff.totalDays, 4)} />
                <Row label="Số ngày lịch" value={String(diff.calendarDays)} />
                <Row label="Ngày làm việc (T2–T6)" value={String(diff.weekdays)} />
                <Row label="Tổng số giờ" value={fmtNum(diff.totalHours, 2)} />
                <Row label="Tổng số giây" value={fmtNum(diff.totalSeconds, 0)} />
              </div>
            ) : (
              <p className="text-xs text-slate-400">Chọn đủ hai mốc thời gian.</p>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-700">Cộng / trừ khoảng thời gian (từ mốc &quot;Từ&quot;)</h3>
            <div className="flex gap-1">
              {([1, -1] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSign(s)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium border transition ${
                    sign === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {s === 1 ? 'Cộng (+)' : 'Trừ (−)'}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {DUR_FIELDS.map(([k, label]) => (
                <label key={k} className="text-[11px] text-slate-500 flex flex-col gap-0.5">
                  {label}
                  <input
                    type="number"
                    min={0}
                    value={dur[k]}
                    onChange={(e) => setDurField(k, e.target.value)}
                    className={inputCls + ' w-full'}
                  />
                </label>
              ))}
            </div>
            {addResult !== null && Number.isFinite(addResult) && Math.abs(addResult) < 8.64e15 ? (
              <div>
                <Row label={`Kết quả (${calcTz})`} value={formatWall(addResult, calcTz)} />
                <Row label="ISO 8601" value={formatIso(addResult, calcTz)} />
                <Row label="Unix (giây)" value={String(Math.floor(addResult / 1000))} />
                <Row label="Thứ" value={describeInstant(addResult, calcTz, localTz, now ?? 0).weekday} />
              </div>
            ) : (
              <p className="text-xs text-slate-400">Kết quả ngoài phạm vi hoặc chưa chọn ngày.</p>
            )}
            <p className="text-[11px] text-slate-400">
              Năm/tháng/ngày cộng theo lịch (31/1 + 1 tháng = 29/2 hoặc 28/2) và giữ nguyên giờ qua DST; giờ/phút/giây cộng theo thời gian thực.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
