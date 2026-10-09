'use client';

import { useEffect, useMemo, useState } from 'react';
import { saveAs } from 'file-saver';
import { CalendarPlus, Download, ExternalLink } from 'lucide-react';
import { ToolHeader } from '@/components/ToolHeader';
import { Select } from '@/components/ui/searchable-select';
import { EMPTY_EVENT, buildIcs, type IcsEvent, type Repeat } from '@/lib/ics';
import { listTimeZones, localTimeZone, zonedToInstant } from '@/lib/time-tools';
import { sanitizeFileName } from '@/lib/file-tools';

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5';
const field = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500';
const lbl = 'block text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1';
const REMIND = [['', 'Không nhắc'], ['0', 'Đúng giờ'], ['10', 'Trước 10 phút'], ['15', 'Trước 15 phút'], ['30', 'Trước 30 phút'], ['60', 'Trước 1 giờ'], ['1440', 'Trước 1 ngày']] as const;
const pad = (n: number) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export default function CalendarEventPage() {
  // Ngày hôm nay và múi giờ của máy chỉ biết ở trình duyệt, nên điền sau khi mount để không lệch với bản prerender.
  const [ev, setEv] = useState<IcsEvent>(EMPTY_EVENT);
  useEffect(() => {
    const t = todayISO();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEv((p) => ({ ...p, startDate: t, endDate: t, tz: localTimeZone() }));
  }, []);
  const zones = useMemo(() => listTimeZones(), []);
  const set = <K extends keyof IcsEvent>(k: K, v: IcsEvent[K]) => setEv((p) => ({ ...p, [k]: v }));
  // Mốc thời gian & UID cố định cho bản xem trước; file tải về được dựng lại với mốc mới nhất lúc bấm.
  const [stamp] = useState(() => ({ now: Date.now(), uid: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}@getools` }));

  const result = useMemo(() => buildIcs(ev, stamp.now, stamp.uid, zonedToInstant), [ev, stamp]);

  const googleUrl = useMemo(() => {
    if (!result.ok) return '';
    const m = /DTSTART(?:;VALUE=DATE)?:(\d{8}(?:T\d{6}Z)?)/.exec(result.ics), n = /DTEND(?:;VALUE=DATE)?:(\d{8}(?:T\d{6}Z)?)/.exec(result.ics);
    if (!m || !n) return '';
    const q = new URLSearchParams({ action: 'TEMPLATE', text: ev.title.trim(), dates: `${m[1]}/${n[1]}` });
    if (ev.description.trim()) q.set('details', ev.description.trim());
    if (ev.location.trim()) q.set('location', ev.location.trim());
    return `https://calendar.google.com/calendar/render?${q.toString()}`;
  }, [result, ev.title, ev.description, ev.location]);

  const download = () => {
    const fresh = buildIcs(ev, Date.now(), stamp.uid, zonedToInstant);
    if (!fresh.ok) return;
    saveAs(new Blob([fresh.ics], { type: 'text/calendar;charset=utf-8' }), `${sanitizeFileName(ev.title.trim(), 'su-kien')}.ics`);
  };

  return (
    <div className="space-y-3.5">
      <ToolHeader icon={CalendarPlus} title="Tạo lịch hẹn (.ics)" desc="Tạo file lịch để thêm sự kiện vào Google, Apple hoặc Outlook Calendar, có lặp lại và nhắc trước." />
      <div className="grid lg:grid-cols-2 gap-3.5 items-start">
        <section className={`${card} space-y-3`}>
          <label className={lbl}>Tiêu đề<input value={ev.title} onChange={(e) => set('title', e.target.value)} className={field} placeholder="vd. Họp nhóm dự án" /></label>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={ev.allDay} onChange={(e) => set('allDay', e.target.checked)} /> Cả ngày</label>
          <div className="grid grid-cols-2 gap-2">
            <label className={lbl}>Ngày bắt đầu<input type="date" value={ev.startDate} onChange={(e) => { const v = e.target.value; setEv((p) => ({ ...p, startDate: v, endDate: !p.endDate || p.endDate === p.startDate || p.endDate < v ? v : p.endDate })); }} className={field} /></label>
            {!ev.allDay && <label className={lbl}>Giờ bắt đầu<input type="time" value={ev.startTime} onChange={(e) => set('startTime', e.target.value)} className={field} /></label>}
            <label className={lbl}>Ngày kết thúc<input type="date" value={ev.endDate} onChange={(e) => set('endDate', e.target.value)} className={field} /></label>
            {!ev.allDay && <label className={lbl}>Giờ kết thúc<input type="time" value={ev.endTime} onChange={(e) => set('endTime', e.target.value)} className={field} /></label>}
          </div>
          {!ev.allDay && <label className={lbl}>Múi giờ<Select value={ev.tz} onChange={(e) => set('tz', e.target.value)}>{zones.map((z) => <option key={z} value={z}>{z}</option>)}</Select></label>}
          <label className={lbl}>Địa điểm / link họp<input value={ev.location} onChange={(e) => set('location', e.target.value)} className={field} /></label>
          <label className={lbl}>Ghi chú<textarea rows={3} value={ev.description} onChange={(e) => set('description', e.target.value)} className={`${field} normal-case tracking-normal font-normal`} /></label>
          <div className="grid grid-cols-3 gap-2">
            <label className={lbl}>Lặp lại
              <Select value={ev.repeat} onChange={(e) => set('repeat', e.target.value as Repeat)}>
                <option value="none">Không lặp</option><option value="DAILY">Hằng ngày</option><option value="WEEKLY">Hằng tuần</option><option value="MONTHLY">Hằng tháng</option><option value="YEARLY">Hằng năm</option>
              </Select>
            </label>
            <label className={lbl}>Số lần (0 = mãi)<input inputMode="numeric" disabled={ev.repeat === 'none'} value={ev.count} onChange={(e) => set('count', Number(e.target.value) || 0)} className={`${field} disabled:opacity-50`} /></label>
            <label className={lbl}>Nhắc
              <Select value={ev.remindMin === null ? '' : String(ev.remindMin)} onChange={(e) => set('remindMin', e.target.value === '' ? null : Number(e.target.value))}>
                {REMIND.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </label>
          </div>
        </section>
        <section className={`${card} space-y-3`}>
          {!result.ok ? <p className="text-sm text-red-600">{result.error}</p> : (
            <>
              <p className="text-sm text-slate-700">Sự kiện hợp lệ. Mở file .ics bằng ứng dụng lịch để thêm vào, hoặc dùng nút Google Calendar.</p>
              <div className="flex flex-wrap gap-2">
                <button onClick={download} className="px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1.5"><Download className="h-4 w-4" /> Tải file .ics</button>
                {googleUrl && <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="px-3 py-2 rounded-lg text-sm font-medium border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5"><ExternalLink className="h-4 w-4" /> Thêm vào Google Calendar</a>}
              </div>
              <details className="text-xs text-slate-600">
                <summary className="cursor-pointer">Xem nội dung file</summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-slate-100 whitespace-pre-wrap break-all">{result.ics}</pre>
              </details>
              <p className="text-[11px] text-slate-500">Giờ được đổi sang UTC theo múi giờ bạn chọn, ứng dụng lịch sẽ tự hiển thị lại theo múi giờ của máy. Nút Google Calendar chỉ mở trang của Google với thông tin cơ bản, không gồm lặp lại và nhắc.</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
