'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileBadge,
  Upload,
  Trash2,
  Copy,
  Check,
  Download,
  Sparkles,
  ChevronRight,
  ChevronDown,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Info,
  XCircle,
  Link2,
  KeyRound,
  CalendarClock,
} from 'lucide-react';
import { useApp } from '@/components/AppContext';
import {
  loadX509,
  analyzeChain,
  certFindings,
  csrFindings,
  computeFingerprints,
  validityStatus,
  formatDuration,
  describeNode,
  certToJson,
  csrToJson,
  toHex,
  toBase64,
  toPemText,
  contentOf,
  OID_COUNT,
  type Asn1Node,
  type CertInfo,
  type CsrInfo,
  type Dn,
  type ExtInfo,
  type Finding,
  type Fingerprints,
  type LoadedItem,
  type ChainAnalysis,
} from '@/lib/x509';
import { Select } from '@/components/ui/searchable-select';

/* ---------------- Mẫu (chứng chỉ thử nghiệm, không có khóa riêng) ---------------- */

const SAMPLE_LEAF_RSA = `-----BEGIN CERTIFICATE-----
MIIE4DCCA8igAwIBAgIUHUhwyM+/gDM10jr34Xb+MGjv3nQwDQYJKoZIhvcNAQEL
BQAwQzELMAkGA1UEBhMCVk4xFTATBgNVBAoMDEdFVG9vbHMgRGVtbzEdMBsGA1UE
AwwUR0VUb29scyBEZW1vIFJvb3QgQ0EwHhcNMjYxMDA4MTgxMDExWhcNMzYxMDA1
MTgxMDExWjBrMQswCQYDVQQGEwJWTjEPMA0GA1UECAwGSGEgTm9pMQ8wDQYDVQQH
DAZIYSBOb2kxEjAQBgNVBAoMCVZpIER1IEpTQzELMAkGA1UECwwCSVQxGTAXBgNV
BAMMEHd3dy5leGFtcGxlLnRlc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
AoIBAQDY6zTen2s1OMnaSbDcIflCtzPabdu5sGgbPZX4KOjGdVoiGONoutKfQqnt
NRq5DuPJuU+sV3hPK6IWPJ6rSfFjBokD/WVFnptD7/hvDLjgecVXf8dqEaV/oX4t
aMlujP4/2FUTeZFQx5/gMTkQ/1aH17HGEdhLXOheVsV3e7WNPCT9iBEd8Ooprf2V
/jkT50MEF0zHnMxtXx/SmCBCNgtZm1h2gxFj4TDKUYDQIxVqwBGG72Q/+aJsQ9vT
Gfe0FjUpKJsxbQkUmP9jnxi40CdJSeuH3sTnoGY+KOiZ5Xfg+0iwnNuA2Fd6h+gD
qolebz62JUQA7Y1YPzhMv9q3nNHnAgMBAAGjggGiMIIBnjB8BgNVHREEdTBzghB3
d3cuZXhhbXBsZS50ZXN0ggxleGFtcGxlLnRlc3SCDiouZXhhbXBsZS50ZXN0hwTA
AAIKhxAgAQ24AAAAAAAAAAAAAAABgRJhZG1pbkBleGFtcGxlLnRlc3SGFWh0dHBz
Oi8vZXhhbXBsZS50ZXN0LzAOBgNVHQ8BAf8EBAMCBaAwHQYDVR0lBBYwFAYIKwYB
BQUHAwEGCCsGAQUFBwMCMAkGA1UdEwQCMAAwHQYDVR0OBBYEFFK6wddXeaG8F4YL
lvUSPW9DK8dLMB8GA1UdIwQYMBaAFBljyZjK9fNXJGiA8Gc7AtYciphzMBMGA1Ud
IAQMMAowCAYGZ4EMAQICMF8GCCsGAQUFBwEBBFMwUTAkBggrBgEFBQcwAYYYaHR0
cDovL29jc3AuZXhhbXBsZS50ZXN0MCkGCCsGAQUFBzAChh1odHRwOi8vY2EuZXhh
bXBsZS50ZXN0L2NhLmNydDAuBgNVHR8EJzAlMCOgIaAfhh1odHRwOi8vY3JsLmV4
YW1wbGUudGVzdC9hLmNybDANBgkqhkiG9w0BAQsFAAOCAQEAirWGMYQahizCnbam
N2GoWGhXBbvVlaJUn52sxeA01+883RlMHtLsmNpp9/qH3qqRMEB9yWs/w0Aic/JP
0uq612WuvB7z2H31TEQY2wD1eNWFGXzEnZ1vpiJzvrSkH1UXeJdxXg1js8p+/aPt
OstBdK4cgIRCgAqs4dywUsjnQl+5b5Da7DpIdDvZyzrtl+CckWDwjgTlwDzoHTrn
JFCISidq80g9Y+1gUyiYEPo1/9mtB0aUrnYzVa+lq3tISTutTcoJUcvwrvqAvNB0
1RN/icfG4q6RldtjsGoN1AVgxy/ucv1HwazYrx7a+MLTD+mUpV78SgJAPQgP0okY
wNSSFA==
-----END CERTIFICATE-----
`;
const SAMPLE_CA_RSA = `-----BEGIN CERTIFICATE-----
MIIDdzCCAl+gAwIBAgIUT5dIm7i6c6WIU4uy1ysap3iEuSwwDQYJKoZIhvcNAQEL
BQAwQzELMAkGA1UEBhMCVk4xFTATBgNVBAoMDEdFVG9vbHMgRGVtbzEdMBsGA1UE
AwwUR0VUb29scyBEZW1vIFJvb3QgQ0EwHhcNMjYxMDA4MTgwODA0WhcNMzYxMDA1
MTgwODA0WjBDMQswCQYDVQQGEwJWTjEVMBMGA1UECgwMR0VUb29scyBEZW1vMR0w
GwYDVQQDDBRHRVRvb2xzIERlbW8gUm9vdCBDQTCCASIwDQYJKoZIhvcNAQEBBQAD
ggEPADCCAQoCggEBAJiQdG1SN9teUk/lTAzJr1Ily1xYYhNKqC4T021oH+qS8FJj
XKHG1NrOE15w2YzsUOEAVo/NRw6qkdjBPMHNX2xCiqZUARVQkdwksKF/y8bb6am6
zu389ZTPD0WItx8sBYNIDr17R4yfUBAp7Qz8dgiIXCs7RjOH6Sczl9Fys+GAnfgy
I40QzNrm7JxbhvAu6ziMSYdvS82DkoqidwXoy8uOhdU9IYPzvXC6mvCJaumaGvx4
TmD6QHsKG2VCtOs/xXcnwNAhsVz0718zVUAhP5MBlhumkl7KHnd160/VQ7vZjhjB
sbfIGpvw9mdYyvTEhAizBNxV5cNpkdsd/xau1DMCAwEAAaNjMGEwHQYDVR0OBBYE
FBljyZjK9fNXJGiA8Gc7AtYciphzMB8GA1UdIwQYMBaAFBljyZjK9fNXJGiA8Gc7
AtYciphzMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMA0GCSqGSIb3
DQEBCwUAA4IBAQA6uC8QA5rUa2fTDco/uvUIRGOHNg8LghpQoUVscClFDHrTAK4A
bX8DP39U9RQjAMcG3D2lFFXTmXl6qJ/6tGTZmIlZLwiipTuqxMY3E4AuHifdaHM3
EK3z1kCuEGuN66BiDk0o+FQ47pOwRJDzls4UISDjh/+4Zrj2mahfqo4KIqp9zsrB
V6NxhIvFye4LYNkQk7LgIQqH3X2RkSPcQe67Ok4BthF1N4PfBjAtuG+F72rnaCA9
zHIciJLA8bk2iR8WoGmHzEwHjuqqHqzf4/D3RUmrC7zVkzKH8tjwgrpaA0Cb3vhE
t6Fk1LUMPzqTfR8jSy+SVQbtYeEVqZtKi3/h
-----END CERTIFICATE-----
`;
const SAMPLE_EC_CA = `-----BEGIN CERTIFICATE-----
MIIB5DCCAYqgAwIBAgIUNsCAe4ynpv55vqEBEwgoDLNuvlYwCgYIKoZIzj0EAwIw
PjELMAkGA1UEBhMCVk4xFTATBgNVBAoMDEdFVG9vbHMgRGVtbzEYMBYGA1UEAwwP
R0VUb29scyBFQyBSb290MB4XDTI2MTAwODE4MDgwNVoXDTM2MTAwNTE4MDgwNVow
PjELMAkGA1UEBhMCVk4xFTATBgNVBAoMDEdFVG9vbHMgRGVtbzEYMBYGA1UEAwwP
R0VUb29scyBFQyBSb290MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEgfdtU0Nj
9WhpWgVK8ZSnv+ehJgnCiTL6p5Pwd/fHEJNs36nucGrKRqj/GZROB2kS/2ySs4PS
4i5S8ZNyF5gnbqNmMGQwHQYDVR0OBBYEFBcd8g0fExqsNmesjjIh+KmnJxwVMB8G
A1UdIwQYMBaAFBcd8g0fExqsNmesjjIh+KmnJxwVMBIGA1UdEwEB/wQIMAYBAf8C
AQEwDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMCA0gAMEUCIAfFlXt0IAAa+f3P
GEmMTFyW+/FlUvmQsNYW2ZDGpUuEAiEAlJ64jNhTIqNtgPF+XKDDQVdoN7q4DDHk
KqzIeXlWWeQ=
-----END CERTIFICATE-----
`;
const SAMPLE_EC_LEAF = `-----BEGIN CERTIFICATE-----
MIIB4DCCAYWgAwIBAgIUbcG5ttPZ92P/M+HlqfK8RGcYFdkwCgYIKoZIzj0EAwIw
PjELMAkGA1UEBhMCVk4xFTATBgNVBAoMDEdFVG9vbHMgRGVtbzEYMBYGA1UEAwwP
R0VUb29scyBFQyBSb290MB4XDTI2MTAwODE4MTAxMVoXDTI3MDQyNjE4MTAxMVow
FzEVMBMGA1UEAwwMZWMtbGVhZi50ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcD
QgAEAKMO+ajyQ+XSL6GO1ilEhYh0M5iekoVUBssw16sFJXHhwx16jceWxxSvwf9o
zq+tz4IFODxTqA7YYa/JsQuCvqOBhzCBhDAXBgNVHREEEDAOggxlYy1sZWFmLnRl
c3QwEwYDVR0lBAwwCgYIKwYBBQUHAwEwFAYDVR0eBA0wC6AJMAeCBS50ZXN0MB0G
A1UdDgQWBBQ2Y5uv2M8zqNydVRHrxZ7H1X5mtzAfBgNVHSMEGDAWgBQXHfINHxMa
rDZnrI4yIfippyccFTAKBggqhkjOPQQDAgNJADBGAiEA0bt77HtXcoAWef4nm69i
58CNZ4rh2/z/H6Rd5zpF4NQCIQDzFwYmiykAG7/Urzk/90VjvQHMEaTCo4N4dYVK
/LTLyw==
-----END CERTIFICATE-----
`;
const SAMPLE_CSR = `-----BEGIN CERTIFICATE REQUEST-----
MIIDbzCCAlcCAQAwazELMAkGA1UEBhMCVk4xDzANBgNVBAgMBkhhIE5vaTEPMA0G
A1UEBwwGSGEgTm9pMRIwEAYDVQQKDAlWaSBEdSBKU0MxCzAJBgNVBAsMAklUMRkw
FwYDVQQDDBB3d3cuZXhhbXBsZS50ZXN0MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A
MIIBCgKCAQEA2Os03p9rNTjJ2kmw3CH5Qrcz2m3bubBoGz2V+CjoxnVaIhjjaLrS
n0Kp7TUauQ7jyblPrFd4TyuiFjyeq0nxYwaJA/1lRZ6bQ+/4bwy44HnFV3/HahGl
f6F+LWjJboz+P9hVE3mRUMef4DE5EP9Wh9exxhHYS1zoXlbFd3u1jTwk/YgRHfDq
Ka39lf45E+dDBBdMx5zMbV8f0pggQjYLWZtYdoMRY+EwylGA0CMVasARhu9kP/mi
bEPb0xn3tBY1KSibMW0JFJj/Y58YuNAnSUnrh97E56BmPijomeV34PtIsJzbgNhX
eofoA6qJXm8+tiVEAO2NWD84TL/at5zR5wIDAQABoIG+MIG7BgkqhkiG9w0BCQ4x
ga0wgaowfAYDVR0RBHUwc4IQd3d3LmV4YW1wbGUudGVzdIIMZXhhbXBsZS50ZXN0
gg4qLmV4YW1wbGUudGVzdIcEwAACCocQIAENuAAAAAAAAAAAAAAAAYESYWRtaW5A
ZXhhbXBsZS50ZXN0hhVodHRwczovL2V4YW1wbGUudGVzdC8wCwYDVR0PBAQDAgWg
MB0GA1UdJQQWMBQGCCsGAQUFBwMBBggrBgEFBQcDAjANBgkqhkiG9w0BAQsFAAOC
AQEAquoxuN0IUmMcehZjfXUAXCkWG1hICBzWXIF2x3sOu4GrMUWBglitXZQPoMxL
qQZQh5JFKCGyjUPw/wmn6KUw1KfhvPGSFAwhHnVVExkNCNG9Wc1UaQqPtd/UfnDP
MFGq2EXX6pm9cM8EVv2ZgOd/uUILq1nsQbg80LiA1mtiYByQHk9M2QKp8Y9CXfqR
ysf27a9zbriu1QYdRwKblc5lhP9g7xLVGBk3MnGGGi8uQ2+Cy9R5TX9T5oSZdXBq
Dm9AAOZUrH/ljE4f3cAHwYpFc+ZfmDFJ7Kfa+IALa9d2vvt5IV7ZG5K9t02i3MUu
SVl39j241V4cIgd7vO8nduZuGg==
-----END CERTIFICATE REQUEST-----
`;
const SAMPLE_V1 = `-----BEGIN CERTIFICATE-----
MIIB5DCCAU0CFEfd0mVL23YB/RjGzRkqMGLszPs1MA0GCSqGSIb3DQEBBQUAMDEx
GTAXBgNVBAMMEG9sZC5leGFtcGxlLnRlc3QxFDASBgNVBAoMC0xlZ2FjeSBEZW1v
MB4XDTI2MTAwODE4MTAxMVoXDTM2MTAwNTE4MTAxMVowMTEZMBcGA1UEAwwQb2xk
LmV4YW1wbGUudGVzdDEUMBIGA1UECgwLTGVnYWN5IERlbW8wgZ8wDQYJKoZIhvcN
AQEBBQADgY0AMIGJAoGBALV7vy3Bqs5JvD11FINAjSahcQrESbkB8QewqXNhAM+3
LKWvU4C8j5CCzQTrl2K8ZDUSQKp10as1iaI8EsYERPiMjGH1/y+178TkzFYpvzf7
kBAeMtsgruV0wEuzzhsHjrNFq/FDNBokFRn7YA8YfLDpVnJY05i6SW1mN9P6ruc7
AgMBAAEwDQYJKoZIhvcNAQEFBQADgYEARi9ZBCCBOE1s5QtsNBrYAgBhlpK1lzQi
eTxWRjjqyTmr2MfQTYC4HmTVdmb1+4enEXrpUU12nF7Xy2KWYTtDmH9tjl34rzFI
cUP8N6jq0xAX5Y3B2PDqmKaklYjNjCXhRQ0TAVt6Q35xjUdrgGSO2Ldn5ojyYa3v
/WtCLD+Ex7A=
-----END CERTIFICATE-----
`;

const SAMPLES: { id: string; name: string; text: string }[] = [
  { id: 'chain', name: 'Chuỗi RSA 2048: leaf + CA (có SAN, EKU, AIA...)', text: SAMPLE_LEAF_RSA + SAMPLE_CA_RSA },
  { id: 'wrong', name: 'Chuỗi sai thứ tự (CA trước, leaf sau)', text: SAMPLE_CA_RSA + SAMPLE_LEAF_RSA },
  { id: 'ec', name: 'EC P-256 tự ký (CA, pathLen=1)', text: SAMPLE_EC_CA },
  { id: 'ecchain', name: 'Chuỗi EC: leaf (NameConstraints) + root', text: SAMPLE_EC_LEAF + SAMPLE_EC_CA },
  { id: 'csr', name: 'CSR RSA 2048 kèm SAN', text: SAMPLE_CSR },
  { id: 'weak', name: 'Chứng chỉ yếu: v1, RSA 1024, SHA-1', text: SAMPLE_V1 },
];

const MAX_FILE = 2 * 1024 * 1024;

/* ---------------- Tiện ích hiển thị ---------------- */

const DATE_FMT = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' });
function fmtDate(ms: number): string {
  try {
    return DATE_FMT.format(new Date(ms)) + ' UTC';
  } catch {
    return new Date(ms).toISOString();
  }
}

function sevStyle(s: Finding['severity']) {
  if (s === 'error') return { cls: 'bg-red-50 border-red-200 text-red-800', Icon: XCircle, label: 'Lỗi' };
  if (s === 'warning') return { cls: 'bg-amber-50 border-amber-200 text-amber-800', Icon: AlertTriangle, label: 'Cảnh báo' };
  return { cls: 'bg-slate-50 border-slate-200 text-slate-700', Icon: Info, label: 'Ghi chú' };
}

function FindingList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return null;
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <ul className="space-y-1.5">
      {sorted.map((f, i) => {
        const { cls, Icon, label } = sevStyle(f.severity);
        return (
          <li key={i} className={`flex items-start gap-2 text-xs rounded-lg border px-2.5 py-1.5 ${cls}`}>
            <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              <b>{label}:</b> {f.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const { showToast } = useApp();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      data-tooltip="Sao chép"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          showToast('Đã sao chép');
          setTimeout(() => setDone(false), 1200);
        } catch {
          showToast('Không thể sao chép');
        }
      }}
      className="inline-flex items-center gap-1 px-1.5 py-1 text-[11px] text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition shrink-0"
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'emerald' | 'red' | 'amber' | 'indigo' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

function Row({ k, children, mono, copy }: { k: string; children: React.ReactNode; mono?: boolean; copy?: string }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] gap-x-3 gap-y-0.5 py-1.5 border-b border-slate-100 last:border-0 text-xs">
      <div className="text-slate-500 font-medium">{k}</div>
      <div className={`min-w-0 break-words text-slate-800 flex items-start gap-1 ${mono ? 'font-mono text-[11px]' : ''}`}>
        <span className="min-w-0 break-all">{children}</span>
        {copy && <CopyBtn text={copy} />}
      </div>
    </div>
  );
}

function Section({ title, children, defaultOpen = false, badge }: { title: string; children: React.ReactNode; defaultOpen?: boolean; badge?: React.ReactNode }) {
  return (
    <details open={defaultOpen} className="group bg-white rounded-xl border border-slate-200/90 overflow-hidden">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2 bg-slate-50/60 hover:bg-slate-50 list-none">
        <ChevronRight className="h-4 w-4 text-slate-400 transition group-open:rotate-90" />
        {title}
        {badge}
      </summary>
      <div className="px-3 py-1">{children}</div>
    </details>
  );
}

function DnView({ dn }: { dn: Dn }) {
  if (dn.rdns.length === 0) return <span className="text-slate-400">(rỗng)</span>;
  return (
    <div className="space-y-0.5">
      {dn.rdns.map((rdn, i) => (
        <div key={i} className="flex flex-wrap gap-x-2">
          {rdn.map((a, j) => (
            <span key={j}>
              <b className="text-slate-600" data-tooltip={`${a.name} · ${a.oid}`}>
                {a.short}
              </b>
              <span className="text-slate-400"> = </span>
              {a.value}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Thanh hiệu lực ---------------- */

function ValidityBar({ cert, now }: { cert: Pick<CertInfo, 'notBefore' | 'notAfter'>; now: number }) {
  const v = validityStatus(cert, now);
  const clamped = Math.min(1, Math.max(0, v.position));
  const bar = v.state === 'valid' ? (v.daysRemaining <= 30 ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-red-500';
  return (
    <div>
      <div className="relative h-2.5 bg-slate-200 rounded-full mt-6 mb-1">
        <div className={`absolute inset-y-0 left-0 rounded-full ${bar}`} style={{ width: `${clamped * 100}%` }} />
        <div className="absolute -top-5 -translate-x-1/2 flex flex-col items-center" style={{ left: `${clamped * 100}%` }}>
          <span className="text-[10px] font-bold text-slate-700 whitespace-nowrap">{v.state === 'not_yet' ? '◀ Hôm nay' : v.state === 'expired' ? 'Hôm nay ▶' : 'Hôm nay'}</span>
          <span className="w-0.5 h-2 bg-slate-700" />
        </div>
      </div>
      <div className="flex justify-between text-[11px] text-slate-500">
        <span>{fmtDate(cert.notBefore)}</span>
        <span>{fmtDate(cert.notAfter)}</span>
      </div>
    </div>
  );
}

function StatusBadge({ cert, now }: { cert: Pick<CertInfo, 'notBefore' | 'notAfter'>; now: number }) {
  const v = validityStatus(cert, now);
  if (v.state === 'valid')
    return <Badge tone={v.daysRemaining <= 30 ? 'amber' : 'emerald'}>Còn hiệu lực · còn {v.daysRemaining} ngày</Badge>;
  if (v.state === 'expired') return <Badge tone="red">Đã hết hạn {-v.daysRemaining} ngày</Badge>;
  return <Badge tone="amber">Chưa có hiệu lực · còn {v.daysRemaining} ngày</Badge>;
}

/* ---------------- Tóm tắt ---------------- */

function FingerprintRows({ fp }: { fp?: Fingerprints }) {
  if (!fp) return <div className="text-xs text-slate-400 py-1">Đang tính vân tay...</div>;
  return (
    <>
      <Row k="SHA-256" mono copy={fp.sha256}>
        {fp.sha256}
      </Row>
      <Row k="SHA-1" mono copy={fp.sha1}>
        {fp.sha1}
      </Row>
      <Row k="SPKI pin (SHA-256, base64)" mono copy={`pin-sha256="${fp.spkiPin}"`}>
        pin-sha256=&quot;{fp.spkiPin}&quot;
      </Row>
    </>
  );
}

function SanChips({ cert }: { cert: CertInfo | CsrInfo }) {
  const [all, setAll] = useState(false);
  const list = cert.ext.san;
  if (list.length === 0) return <span className="text-slate-400 text-xs">Không có</span>;
  const shown = all ? list : list.slice(0, 24);
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((g, i) => (
        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-100 text-[11px] text-indigo-900 font-mono break-all">
          <span className="text-indigo-400 font-sans text-[10px] uppercase">{g.type}</span>
          {g.value}
        </span>
      ))}
      {list.length > shown.length && (
        <button onClick={() => setAll(true)} className="text-[11px] text-indigo-600 hover:underline">
          +{list.length - shown.length} mục nữa
        </button>
      )}
    </div>
  );
}

function CertSummary({ cert, fp, now, findings }: { cert: CertInfo; fp?: Fingerprints; now: number; findings: Finding[] }) {
  const v = validityStatus(cert, now);
  const policyKind = cert.ext.policies
    .map((p) => (p.oid === '2.23.140.1.2.1' ? 'DV' : p.oid === '2.23.140.1.2.2' ? 'OV' : p.oid === '2.23.140.1.2.3' ? 'IV' : p.oid === '2.23.140.1.1' ? 'EV' : ''))
    .filter(Boolean);
  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {v.state === 'valid' ? <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0" /> : <ShieldAlert className="h-5 w-5 text-red-600 shrink-0" />}
            <h2 className="text-base font-bold text-slate-900 break-all">{cert.subject.cn ?? (cert.subject.ordered || '(chủ thể rỗng)')}</h2>
          </div>
          <div className="text-xs text-slate-500 mt-0.5 break-all">Phát hành bởi: {cert.issuer.cn ?? cert.issuer.ordered}</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge cert={cert} now={now} />
          {cert.selfSigned && <Badge tone="indigo">Tự ký</Badge>}
          <Badge tone={cert.isCA ? 'indigo' : 'slate'}>{cert.isCA ? 'CA' : 'Không phải CA'}</Badge>
          <Badge>X.509 v{cert.version}</Badge>
          {policyKind.map((k) => (
            <Badge key={k} tone="emerald">
              {k}
            </Badge>
          ))}
          {cert.ext.mustStaple && <Badge tone="slate">OCSP Must-Staple</Badge>}
          {cert.ext.sctCount ? <Badge tone="slate">CT: {cert.ext.sctCount} SCT</Badge> : null}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
          <CalendarClock className="h-3.5 w-3.5" /> Hiệu lực
        </div>
        <ValidityBar cert={cert} now={now} />
        <div className="text-xs text-slate-600 mt-1">
          Tuổi thọ tổng: <b>{formatDuration(v.lifetimeDays)}</b> ({Math.round(v.lifetimeDays)} ngày)
          {v.state === 'valid' && <> · đã dùng {Math.round(Math.min(100, v.position * 100))}%</>}
        </div>
      </div>

      <div>
        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Tên miền / định danh (SAN)</div>
        <SanChips cert={cert} />
      </div>

      <div className="grid sm:grid-cols-2 gap-x-6">
        <Row k="Khóa công khai">
          <span className="inline-flex items-center gap-1">
            <KeyRound className="h-3.5 w-3.5 text-slate-400" />
            {cert.key.description}
          </span>
        </Row>
        <Row k="Chữ ký">{cert.sigAlg.name}</Row>
        <Row k="Serial" mono copy={cert.serialHex}>
          {cert.serialHex}
          {cert.serialDec && cert.serialDec.length < 30 ? ` (${cert.serialDec})` : ''}
        </Row>
        <Row k="Chủ thể (RFC 4514)" mono>
          {cert.subject.rfc4514 || '(rỗng)'}
        </Row>
      </div>

      <div>
        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Vân tay</div>
        <FingerprintRows fp={fp} />
      </div>

      <FindingList findings={findings} />
    </div>
  );
}

function CsrSummary({ csr, findings }: { csr: CsrInfo; findings: Finding[] }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FileBadge className="h-5 w-5 text-indigo-600" />
        <h2 className="text-base font-bold text-slate-900 break-all">{csr.subject.cn ?? (csr.subject.ordered || '(chủ thể rỗng)')}</h2>
        <Badge tone="indigo">CSR PKCS#10</Badge>
        <Badge>v{csr.version}</Badge>
      </div>
      <div>
        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Tên miền / định danh (SAN) yêu cầu</div>
        <SanChips cert={csr} />
      </div>
      <div className="grid sm:grid-cols-2 gap-x-6">
        <Row k="Khóa công khai">{csr.key.description}</Row>
        <Row k="Chữ ký CSR">{csr.sigAlg.name}</Row>
        <Row k="Chủ thể (RFC 4514)" mono>
          {csr.subject.rfc4514 || '(rỗng)'}
        </Row>
        <Row k="Thuộc tính">{csr.attributes.length ? csr.attributes.map((a) => a.name).join(', ') : 'Không có'}</Row>
      </div>
      <FindingList findings={findings} />
    </div>
  );
}

/* ---------------- Chi tiết ---------------- */

function ExtView({ e }: { e: ExtInfo }) {
  return (
    <details className="border-b border-slate-100 last:border-0 py-1.5 group/ext">
      <summary className="cursor-pointer list-none flex flex-wrap items-center gap-2 text-xs">
        <ChevronRight className="h-3.5 w-3.5 text-slate-400 transition group-open/ext:rotate-90" />
        <b className="text-slate-800">{e.name}</b>
        <span className="font-mono text-[10px] text-slate-400">{e.oid}</span>
        {e.critical && <Badge tone="red">critical</Badge>}
        {e.error && <Badge tone="amber">lỗi giải mã</Badge>}
      </summary>
      <div className="pl-5 pt-1 space-y-1">
        {e.error && <div className="text-xs text-amber-700">{e.error}</div>}
        {e.lines.map((l, i) => (
          <div key={i} className="text-xs text-slate-800 font-mono break-all whitespace-pre-wrap">
            {l}
          </div>
        ))}
        {e.valueHex && (
          <div className="text-[10px] text-slate-400 font-mono break-all">
            hex: {e.valueHex.length > 400 ? e.valueHex.slice(0, 400) + '…' : e.valueHex}
          </div>
        )}
      </div>
    </details>
  );
}

function CertDetails({ cert, fp, now }: { cert: CertInfo; fp?: Fingerprints; now: number }) {
  const v = validityStatus(cert, now);
  return (
    <div className="space-y-2">
      <Section title="Thông tin chung" defaultOpen>
        <Row k="Phiên bản">
          v{cert.version} {cert.version === 1 ? '(không có extension)' : ''}
        </Row>
        <Row k="Số serial (hex)" mono copy={cert.serialHex}>
          {cert.serialHex}
        </Row>
        {cert.serialDec && <Row k="Số serial (thập phân)">{cert.serialDec}</Row>}
        <Row k="Thuật toán chữ ký">
          {cert.sigAlg.name} <span className="text-slate-400 font-mono text-[10px]">{cert.sigAlg.oid}</span>
          {cert.sigAlg.params && <div className="text-slate-500">{cert.sigAlg.params}</div>}
        </Row>
        <Row k="Tự ký (subject = issuer)">{cert.selfSigned ? 'Có (chưa xác minh chữ ký)' : 'Không'}</Row>
        {(cert.issuerUniqueId || cert.subjectUniqueId) && <Row k="Unique ID">{cert.issuerUniqueId ? 'issuerUniqueID ' : ''}{cert.subjectUniqueId ? 'subjectUniqueID' : ''}</Row>}
      </Section>
      <Section title="Chủ thể (Subject)" defaultOpen>
        <Row k="Thuộc tính">
          <DnView dn={cert.subject} />
        </Row>
        <Row k="RFC 4514" mono copy={cert.subject.rfc4514}>
          {cert.subject.rfc4514}
        </Row>
      </Section>
      <Section title="Nhà phát hành (Issuer)">
        <Row k="Thuộc tính">
          <DnView dn={cert.issuer} />
        </Row>
        <Row k="RFC 4514" mono copy={cert.issuer.rfc4514}>
          {cert.issuer.rfc4514}
        </Row>
      </Section>
      <Section title="Hiệu lực" defaultOpen>
        <Row k="Không trước (notBefore)">{fmtDate(cert.notBefore)}</Row>
        <Row k="Không sau (notAfter)">{fmtDate(cert.notAfter)}</Row>
        <Row k="Tuổi thọ tổng">
          {formatDuration(v.lifetimeDays)} ({Math.round(v.lifetimeDays)} ngày)
        </Row>
        <Row k="Trạng thái">
          <StatusBadge cert={cert} now={now} />
        </Row>
      </Section>
      <Section title="Khóa công khai">
        <Row k="Thuật toán">
          {cert.key.algName} <span className="text-slate-400 font-mono text-[10px]">{cert.key.algOid}</span>
        </Row>
        <Row k="Mô tả">{cert.key.description}</Row>
        {cert.key.bits !== undefined && <Row k="Độ dài (bit)">{cert.key.bits}</Row>}
        {cert.key.exponent && <Row k="Số mũ công khai (e)">{cert.key.exponent}</Row>}
        {cert.key.curve && <Row k="Đường cong">{cert.key.curve}</Row>}
        {cert.key.modulusHex && (
          <Row k="Modulus (hex)" mono copy={cert.key.modulusHex}>
            {cert.key.modulusHex.length > 300 ? cert.key.modulusHex.slice(0, 300) + '…' : cert.key.modulusHex}
          </Row>
        )}
        <FingerprintRows fp={fp} />
      </Section>
      <Section title="Extension" badge={<Badge>{cert.extensions.length}</Badge>} defaultOpen={cert.extensions.length > 0 && cert.extensions.length <= 12}>
        {cert.extensions.length === 0 ? <div className="text-xs text-slate-400 py-2">Chứng chỉ không có extension.</div> : cert.extensions.map((e, i) => <ExtView key={i} e={e} />)}
      </Section>
      <Section title="Chữ ký">
        <Row k="Độ dài">{cert.signatureBits} bit</Row>
        <Row k="Giá trị (hex)" mono copy={cert.signatureHex}>
          {cert.signatureHex.length > 400 ? cert.signatureHex.slice(0, 400) + '…' : cert.signatureHex}
        </Row>
      </Section>
    </div>
  );
}

function CsrDetails({ csr }: { csr: CsrInfo }) {
  return (
    <div className="space-y-2">
      <Section title="Thông tin chung" defaultOpen>
        <Row k="Phiên bản">v{csr.version}</Row>
        <Row k="Thuật toán chữ ký">
          {csr.sigAlg.name} <span className="text-slate-400 font-mono text-[10px]">{csr.sigAlg.oid}</span>
          {csr.sigAlg.params && <div className="text-slate-500">{csr.sigAlg.params}</div>}
        </Row>
      </Section>
      <Section title="Chủ thể (Subject)" defaultOpen>
        <Row k="Thuộc tính">
          <DnView dn={csr.subject} />
        </Row>
        <Row k="RFC 4514" mono copy={csr.subject.rfc4514}>
          {csr.subject.rfc4514}
        </Row>
      </Section>
      <Section title="Khóa công khai" defaultOpen>
        <Row k="Mô tả">{csr.key.description}</Row>
        {csr.key.exponent && <Row k="Số mũ công khai (e)">{csr.key.exponent}</Row>}
        {csr.key.curve && <Row k="Đường cong">{csr.key.curve}</Row>}
      </Section>
      <Section title="Thuộc tính" badge={<Badge>{csr.attributes.length}</Badge>}>
        {csr.attributes.map((a, i) => (
          <Row key={i} k={a.name}>
            {a.values.join(' · ')}
          </Row>
        ))}
        {csr.attributes.length === 0 && <div className="text-xs text-slate-400 py-2">Không có.</div>}
      </Section>
      <Section title="Extension yêu cầu" badge={<Badge>{csr.extensions.length}</Badge>} defaultOpen={csr.extensions.length > 0}>
        {csr.extensions.length === 0 ? <div className="text-xs text-slate-400 py-2">CSR không yêu cầu extension.</div> : csr.extensions.map((e, i) => <ExtView key={i} e={e} />)}
      </Section>
      <Section title="Chữ ký">
        <Row k="Độ dài">{csr.signatureBits} bit</Row>
        <Row k="Giá trị (hex)" mono>
          {csr.signatureHex.length > 400 ? csr.signatureHex.slice(0, 400) + '…' : csr.signatureHex}
        </Row>
      </Section>
    </div>
  );
}

/* ---------------- Cây ASN.1 ---------------- */

function TreeNode({ node, bytes, depth, forceOpen }: { node: Asn1Node; bytes: Uint8Array; depth: number; forceOpen: { id: number; open: boolean } }) {
  const kids = node.children ?? (node.inner ? [node.inner] : []);
  const [open, setOpen] = useState(depth < 3);
  const [lastForce, setLastForce] = useState(forceOpen.id);
  if (forceOpen.id !== lastForce) {
    setLastForce(forceOpen.id);
    setOpen(forceOpen.open);
  }
  const d = useMemo(() => describeNode(node, bytes), [node, bytes]);
  const isOid = node.cls === 0 && node.tag === 6;
  const hexPreview = !node.constructed && node.len > 0 ? toHex(contentOf(node, bytes).subarray(0, 24)) + (node.len > 24 ? '…' : '') : '';
  return (
    <div>
      <div className="flex items-start gap-1 py-0.5 hover:bg-slate-100/70 rounded px-1 font-mono text-[11px] leading-snug">
        {kids.length > 0 ? (
          <button onClick={() => setOpen(!open)} className="shrink-0 mt-px text-slate-500 hover:text-indigo-600" aria-label={open ? 'Thu gọn' : 'Mở rộng'}>
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="text-slate-400 shrink-0 w-14 text-right" data-tooltip={`offset ${node.offset}, header ${node.hdr}, độ dài ${node.len}`}>
          {node.offset}
        </span>
        <span className="text-indigo-700 font-semibold shrink-0">{d.name}</span>
        <span className={`min-w-0 break-all ${isOid ? 'text-emerald-700' : 'text-slate-800'}`}>{d.value}</span>
        {hexPreview && !isOid && node.tag !== 23 && node.tag !== 24 && (node.tag === 4 || node.tag === 3 || node.tag === 2 || node.cls !== 0) && (
          <span className="text-slate-400 break-all hidden md:inline">· {hexPreview}</span>
        )}
        <span className="text-slate-300 ml-auto shrink-0 pl-2">
          +{node.hdr} l={node.len}
        </span>
      </div>
      {open && kids.length > 0 && (
        <div className="ml-3 pl-2 border-l border-slate-200">
          {kids.length > 400 && <div className="text-[11px] text-amber-700 py-0.5">Hiển thị 400/{kids.length} phần tử đầu.</div>}
          {kids.slice(0, 400).map((k, i) => (
            <TreeNode key={i} node={k} bytes={bytes} depth={depth + 1} forceOpen={forceOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

function AsnTree({ root, bytes }: { root: Asn1Node; bytes: Uint8Array }) {
  const [force, setForce] = useState({ id: 0, open: true });
  return (
    <div className="bg-white rounded-xl border border-slate-200/90 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-500">Mỗi dòng: offset · kiểu · giá trị · (+độ dài header, l = độ dài nội dung). OID được hiển thị kèm tên ({OID_COUNT} OID trong từ điển).</span>
        <div className="flex gap-1.5">
          <button onClick={() => setForce((f) => ({ id: f.id + 1, open: true }))} className="px-2 py-1 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
            Mở tất cả
          </button>
          <button onClick={() => setForce((f) => ({ id: f.id + 1, open: false }))} className="px-2 py-1 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
            Thu gọn
          </button>
        </div>
      </div>
      <div className="p-2 overflow-x-auto max-h-[70vh] overflow-y-auto">
        <TreeNode node={root} bytes={bytes} depth={0} forceOpen={force} />
      </div>
    </div>
  );
}

/* ---------------- Raw ---------------- */

function RawView({ der, label }: { der: Uint8Array; label: string }) {
  const pem = useMemo(() => toPemText(label, der), [der, label]);
  const hex = useMemo(() => toHex(der), [der]);
  const b64 = useMemo(() => toBase64(der), [der]);
  const blocks: { title: string; text: string; shown: string }[] = [
    { title: `PEM (${label})`, text: pem, shown: pem },
    { title: `DER hex (${der.length} byte)`, text: hex, shown: hex.length > 20000 ? hex.slice(0, 20000) + '…' : hex.replace(/(.{64})/g, '$1\n') },
    { title: 'DER Base64 (một dòng)', text: b64, shown: b64.length > 20000 ? b64.slice(0, 20000) + '…' : b64 },
  ];
  return (
    <div className="space-y-2">
      {blocks.map((b) => (
        <div key={b.title} className="bg-slate-900 text-slate-100 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-700 text-[11px] text-slate-300">
            <span>{b.title}</span>
            <CopyBtn text={b.text} label="Sao chép" />
          </div>
          <pre className="p-3 text-[11px] font-mono whitespace-pre-wrap break-all max-h-60 overflow-auto">{b.shown}</pre>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Chuỗi chứng chỉ ---------------- */

function ChainPanel({ certs, analysis, onPick }: { certs: CertInfo[]; analysis: ChainAnalysis; onPick: (idx: number) => void }) {
  const roleLabel = { leaf: 'Leaf (lá)', intermediate: 'Intermediate', root: 'Root' } as const;
  const roleTone = { leaf: 'emerald', intermediate: 'indigo', root: 'amber' } as const;
  const hasProblems = analysis.chainFindings.some((f) => f.severity !== 'info') || analysis.entries.some((e) => e.findings.some((f) => f.severity === 'error'));
  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="h-4 w-4 text-indigo-600" />
        <h3 className="text-sm font-bold text-slate-900">Phân tích chuỗi chứng chỉ ({certs.length})</h3>
        {analysis.orderOk ? <Badge tone="emerald">Thứ tự đúng</Badge> : <Badge tone="amber">Thứ tự chưa đúng</Badge>}
        {hasProblems ? <Badge tone="amber">Có vấn đề</Badge> : <Badge tone="emerald">Không phát hiện lỗi</Badge>}
      </div>
      <ol className="space-y-1.5">
        {analysis.entries.map((e) => {
          const c = certs[e.index];
          const worst = e.findings.some((f) => f.severity === 'error') ? 'error' : e.findings.some((f) => f.severity === 'warning') ? 'warning' : null;
          return (
            <li key={e.index}>
              <button onClick={() => onPick(e.index)} className="w-full text-left flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 hover:bg-slate-50 text-xs">
                <span className="font-mono text-slate-400">#{e.index + 1}</span>
                <Badge tone={roleTone[e.role]}>{roleLabel[e.role]}</Badge>
                <span className="font-semibold text-slate-800 break-all">{c.subject.cn ?? c.subject.ordered}</span>
                <span className="text-slate-400">
                  {e.issuerIndex >= 0 ? `→ ký bởi #${e.issuerIndex + 1}` : c.selfSigned ? '→ tự ký' : '→ issuer không có trong dữ liệu'}
                </span>
                {worst && <Badge tone={worst === 'error' ? 'red' : 'amber'}>{worst === 'error' ? 'Lỗi' : 'Cảnh báo'}</Badge>}
              </button>
            </li>
          );
        })}
      </ol>
      {!analysis.orderOk && (
        <div className="text-xs text-slate-600">
          Thứ tự đề xuất: {analysis.suggestedOrder.map((i) => `#${i + 1}`).join(' → ')}
        </div>
      )}
      <FindingList findings={analysis.chainFindings} />
    </div>
  );
}

/* ---------------- Trang chính ---------------- */

type View = 'overview' | 'details' | 'asn1' | 'raw';

export default function X509Page() {
  const { showToast } = useApp();
  const [text, setTextRaw] = useState('');
  const deferred = useDeferredValue(text);
  const [sel, setSel] = useState(0);
  const [view, setView] = useState<View>('overview');
  const [dragging, setDragging] = useState(false);
  const [fpState, setFpState] = useState<{ src: unknown; map: Record<number, Fingerprints> }>({ src: null, map: {} });
  const [now, setNow] = useState(0); // cập nhật mỗi lần dữ liệu đầu vào đổi
  const setText = useCallback((t: string) => {
    setTextRaw(t);
    setNow(Date.now());
    setSel(0);
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);

  const loaded = useMemo(() => loadX509(deferred), [deferred]);
  const items = loaded.items;
  const certs = useMemo(() => {
    const out: { idx: number; cert: CertInfo }[] = [];
    items.forEach((it, idx) => {
      if (it.ok && it.kind === 'certificate') out.push({ idx, cert: it.cert });
    });
    return out;
  }, [items]);
  const chain = useMemo(() => (certs.length >= 2 ? analyzeChain(certs.map((c) => c.cert), now) : null), [certs, now]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Record<number, Fingerprints> = {};
      for (let i = 0; i < items.length && i < 100; i++) {
        const it = items[i];
        if (!it.ok || it.kind !== 'certificate') continue;
        out[i] = await computeFingerprints(it.cert.der, it.cert.key.spkiDer);
        if (cancelled) return;
      }
      if (!cancelled) setFpState({ src: items, map: out });
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);

  const fps = fpState.src === items ? fpState.map : {};
  const current: LoadedItem | undefined = items[Math.min(sel, items.length - 1)];
  const curIndex = Math.min(sel, Math.max(0, items.length - 1));

  const findings: Finding[] = useMemo(() => {
    if (!current || !current.ok) return [];
    if (current.kind === 'csr') return csrFindings(current.csr);
    if (chain) {
      const k = certs.findIndex((c) => c.idx === curIndex);
      if (k >= 0) return chain.entries[k].findings;
    }
    return certFindings(current.cert, now);
  }, [current, chain, certs, curIndex, now]);

  const readFiles = async (files: FileList | File[]) => {
    const parts: string[] = [];
    for (const f of Array.from(files).slice(0, 20)) {
      if (f.size > MAX_FILE) {
        showToast(`"${f.name}" quá lớn (tối đa 2 MB)`);
        continue;
      }
      const buf = new Uint8Array(await f.arrayBuffer());
      if (buf.length > 0 && buf[0] === 0x30) parts.push((toBase64(buf).match(/.{1,64}/g) ?? []).join('\n'));
      else parts.push(new TextDecoder('latin1').decode(buf));
    }
    if (parts.length) setText(parts.join('\n'));
  };

  const exportJson = () => {
    const arr = items.map((it, i) => (it.ok ? (it.kind === 'certificate' ? certToJson(it.cert, fps[i], now) : csrToJson(it.csr)) : { error: it.error }));
    const blob = new Blob([JSON.stringify(arr.length === 1 ? arr[0] : arr, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'x509.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const tabs: { id: View; label: string }[] = [
    { id: 'overview', label: 'Tổng quan' },
    { id: 'details', label: 'Chi tiết' },
    { id: 'asn1', label: 'Cây ASN.1' },
    { id: 'raw', label: 'Raw' },
  ];

  return (
    <div className="space-y-3 max-w-6xl mx-auto">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <FileBadge className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Chứng chỉ X.509 / PEM</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Đọc chủ thể, hạn dùng, SAN, vân tay, cây ASN.1 và kiểm tra chuỗi chứng chỉ. Mọi thứ xử lý ngay trên trình duyệt, không gửi dữ liệu đi đâu.
            </p>
          </div>
        </div>
        <button
          onClick={exportJson}
          disabled={items.length === 0}
          className="px-2.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded-lg transition flex items-center gap-1.5 border border-slate-700"
        >
          <Download className="h-3.5 w-3.5" />
          Xuất JSON
        </button>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.length) void readFiles(e.dataTransfer.files);
        }}
        className={`bg-white rounded-xl border shadow-xs overflow-hidden transition ${dragging ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200/90'}`}
      >
        <div className="p-2.5 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Dữ liệu đầu vào</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <Select
              aria-label="Chọn mẫu"
              searchThreshold={0}
              value=""
              onChange={(e) => {
                const s = SAMPLES.find((x) => x.id === e.target.value);
                if (s) setText(s.text);
              }}
              className="px-2 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg border border-indigo-200 max-w-[220px]"
            >
              <option value="">Dùng mẫu...</option>
              {SAMPLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <button onClick={() => fileRef.current?.click()} className="px-2 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-200 flex items-center gap-1">
              <Upload className="h-3.5 w-3.5" />
              Chọn file
            </button>
            <button onClick={() => setText('')} data-tooltip="Xóa" aria-label="Xóa" className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition">
              <Trash2 className="h-4 w-4" />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pem,.crt,.cer,.der,.csr,.txt,.p7b,*/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void readFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={8}
          placeholder={'Dán PEM (-----BEGIN CERTIFICATE-----), nhiều chứng chỉ liên tiếp, CSR, Base64 hoặc chuỗi hex của DER...\nHoặc kéo-thả file .pem / .crt / .cer / .der / .csr vào đây.'}
          className="w-full p-3 text-xs font-mono bg-slate-50/60 focus:bg-white outline-hidden resize-y leading-relaxed text-slate-800 whitespace-pre"
        />
        <div className="px-3 py-1.5 border-t border-slate-100 text-[11px] text-slate-400">
          Mẹo: dán cả chuỗi từ <code>openssl s_client -showcerts</code> — văn bản xung quanh sẽ được bỏ qua. Khóa riêng (PRIVATE KEY) không được xử lý; đừng dán chúng lên web.
        </div>
      </div>

      {loaded.notes.length > 0 && (
        <FindingList findings={loaded.notes.map((m) => ({ severity: 'info' as const, message: m }))} />
      )}

      {items.length === 0 && (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 space-y-2">
          <Sparkles className="h-6 w-6 mx-auto text-indigo-400" />
          <div>Chưa có dữ liệu. Dán PEM vào ô trên hoặc chọn một mẫu để xem thử.</div>
        </div>
      )}

      {chain && <ChainPanel certs={certs.map((c) => c.cert)} analysis={chain} onPick={(k) => { setSel(certs[k].idx); setView('overview'); }} />}

      {items.length > 0 && (
        <div className="space-y-3">
          {items.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="tablist">
              {items.map((it, i) => (
                <button
                  key={i}
                  role="tab"
                  aria-selected={i === curIndex}
                  onClick={() => setSel(i)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition max-w-[260px] truncate ${
                    i === curIndex ? 'bg-indigo-600 text-white border-indigo-600' : it.ok ? 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50' : 'bg-red-50 text-red-700 border-red-200'
                  }`}
                >
                  #{i + 1} {it.ok ? (it.kind === 'csr' ? 'CSR · ' : '') + it.label : 'Lỗi'}
                </button>
              ))}
            </div>
          )}

          {current && !current.ok && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm flex items-start gap-2">
              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <b>Không đọc được ({current.label}):</b> {current.error}
              </div>
            </div>
          )}

          {current && current.ok && (
            <>
              <div className="flex gap-1 border-b border-slate-200" role="tablist">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={view === t.id}
                    onClick={() => setView(t.id)}
                    className={`px-3 py-1.5 text-xs font-semibold border-b-2 -mb-px transition ${view === t.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {view === 'overview' &&
                (current.kind === 'certificate' ? (
                  <CertSummary cert={current.cert} fp={fps[curIndex]} now={now} findings={findings} />
                ) : (
                  <CsrSummary csr={current.csr} findings={findings} />
                ))}
              {view === 'details' && (current.kind === 'certificate' ? <CertDetails cert={current.cert} fp={fps[curIndex]} now={now} /> : <CsrDetails csr={current.csr} />)}
              {view === 'asn1' &&
                (current.kind === 'certificate' ? <AsnTree root={current.cert.tree} bytes={current.cert.der} /> : <AsnTree root={current.csr.tree} bytes={current.csr.der} />)}
              {view === 'raw' &&
                (current.kind === 'certificate' ? (
                  <RawView der={current.cert.der} label="CERTIFICATE" />
                ) : (
                  <RawView der={current.csr.der} label="CERTIFICATE REQUEST" />
                ))}
            </>
          )}
        </div>
      )}
      <p className="text-[11px] text-slate-400">
        Lưu ý: công cụ chỉ đọc cấu trúc, chưa xác minh chữ ký hay thu hồi (CRL/OCSP). &quot;Tự ký&quot; nghĩa là subject trùng issuer. Tên OID tra từ từ điển {OID_COUNT} mục.
      </p>
    </div>
  );
}
