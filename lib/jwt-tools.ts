// Logic thuần cho JWT Sign & Verify, chỉ dùng Web Crypto (crypto.subtle).
// Mọi hàm công khai trả về đối tượng kết quả thay vì ném lỗi.

import { bytesToBase64, base64ToBytes } from '@/lib/encoders';

/* ---------------- Kiểu & hằng ---------------- */

export const HS_ALGS = ['HS256', 'HS384', 'HS512'] as const;
export const RS_ALGS = ['RS256', 'RS384', 'RS512'] as const;
export const PS_ALGS = ['PS256', 'PS384', 'PS512'] as const;
export const ES_ALGS = ['ES256', 'ES384', 'ES512'] as const;
export const ALGS = [...HS_ALGS, ...RS_ALGS, ...PS_ALGS, ...ES_ALGS] as const;
export type JwtAlg = (typeof ALGS)[number];

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface JwtWarning {
  level: 'danger' | 'warn' | 'info';
  text: string;
}

export const MAX_TOKEN_LENGTH = 200_000;
const MAX_KEY_LENGTH = 100_000;

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export function isJwtAlg(s: unknown): s is JwtAlg {
  return typeof s === 'string' && (ALGS as readonly string[]).includes(s);
}

export function algFamily(alg: JwtAlg): 'HS' | 'RS' | 'PS' | 'ES' {
  return alg.slice(0, 2) as 'HS' | 'RS' | 'PS' | 'ES';
}

function hashName(alg: JwtAlg): 'SHA-256' | 'SHA-384' | 'SHA-512' {
  return ('SHA-' + alg.slice(2)) as 'SHA-256' | 'SHA-384' | 'SHA-512';
}

function curveFor(alg: JwtAlg): 'P-256' | 'P-384' | 'P-521' {
  return alg === 'ES256' ? 'P-256' : alg === 'ES384' ? 'P-384' : 'P-521';
}

function ab(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

/* ---------------- Base64URL ---------------- */

export function b64urlEncode(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Giải mã Base64URL nghiêm ngặt (không padding hoặc có padding đúng). Trả về null nếu không hợp lệ. */
export function b64urlDecode(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(s)) return null;
  const body = s.replace(/=+$/, '');
  if (body.length % 4 === 1) return null;
  // Bit thừa ở cuối phải bằng 0 (canonical)
  const pad = (4 - (body.length % 4)) % 4;
  if (s.length > body.length && s.length - body.length !== pad) return null;
  const std = body.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  try {
    return base64ToBytes(std);
  } catch {
    return null;
  }
}

export function b64urlEncodeText(text: string): string {
  return b64urlEncode(enc.encode(text));
}

function utf8(bytes: Uint8Array): string | null {
  try {
    return dec.decode(bytes);
  } catch {
    return null;
  }
}

/* ---------------- Phân tích JWT ---------------- */

export interface ParsedJwt {
  rawParts: [string, string, string];
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  headerJson: string;
  payloadJson: string;
  signature: Uint8Array;
  signingInput: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseJwt(input: string): Result<ParsedJwt> {
  let t = input.trim().replace(/^Bearer\s+/i, '');
  t = t.replace(/\s+/g, '');
  if (!t) return { ok: false, error: 'Hãy dán một JWT (dạng header.payload.signature).' };
  if (t.length > MAX_TOKEN_LENGTH) return { ok: false, error: 'Token quá dài (tối đa 200.000 ký tự).' };
  const parts = t.split('.');
  if (parts.length === 5) return { ok: false, error: 'Đây là JWE (5 phần, đã mã hóa), công cụ này chỉ hỗ trợ JWS/JWT (3 phần).' };
  if (parts.length !== 3) return { ok: false, error: 'JWT phải có đúng 3 phần ngăn cách bởi dấu chấm (header.payload.signature).' };
  const names = ['header', 'payload'];
  const objs: Record<string, unknown>[] = [];
  const jsons: string[] = [];
  for (let i = 0; i < 2; i++) {
    const bytes = b64urlDecode(parts[i]);
    if (!bytes) return { ok: false, error: `Phần ${names[i]} không phải Base64URL hợp lệ (chỉ gồm A-Z a-z 0-9 - _).` };
    const text = utf8(bytes);
    if (text === null) return { ok: false, error: `Phần ${names[i]} không phải văn bản UTF-8 hợp lệ.` };
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      return { ok: false, error: `Phần ${names[i]} không phải JSON hợp lệ.` };
    }
    if (!isObject(v)) return { ok: false, error: `Phần ${names[i]} phải là một đối tượng JSON.` };
    objs.push(v);
    jsons.push(JSON.stringify(v, null, 2));
  }
  const sig = b64urlDecode(parts[2]);
  if (!sig) return { ok: false, error: 'Phần chữ ký không phải Base64URL hợp lệ.' };
  return {
    ok: true,
    value: {
      rawParts: [parts[0], parts[1], parts[2]],
      header: objs[0],
      payload: objs[1],
      headerJson: jsons[0],
      payloadJson: jsons[1],
      signature: sig,
      signingInput: parts[0] + '.' + parts[1],
    },
  };
}

/* ---------------- Giải thích claim ---------------- */

export const CLAIM_INFO: Record<string, string> = {
  iss: 'Issuer: bên phát hành token (thường là URL của máy chủ xác thực).',
  sub: 'Subject: chủ thể của token, thường là ID người dùng.',
  aud: 'Audience: đối tượng nhận token; dịch vụ nhận phải kiểm tra mình có nằm trong aud.',
  exp: 'Expiration time: thời điểm hết hạn (Unix giây). Từ lúc này trở đi token bị từ chối.',
  nbf: 'Not before: token chưa có hiệu lực trước thời điểm này.',
  iat: 'Issued at: thời điểm token được phát hành.',
  jti: 'JWT ID: mã định danh duy nhất, dùng để chống phát lại hoặc thu hồi token.',
  name: 'Tên hiển thị đầy đủ của người dùng.',
  given_name: 'Tên (first name).',
  family_name: 'Họ (last name).',
  preferred_username: 'Tên đăng nhập ưa dùng.',
  nickname: 'Biệt danh.',
  email: 'Địa chỉ email của người dùng.',
  email_verified: 'Email đã được xác minh hay chưa.',
  phone_number: 'Số điện thoại.',
  picture: 'URL ảnh đại diện.',
  locale: 'Ngôn ngữ/khu vực ưa dùng.',
  scope: 'Danh sách phạm vi quyền (OAuth 2.0), phân tách bằng dấu cách.',
  scp: 'Phạm vi quyền (scope), thường là mảng.',
  roles: 'Các vai trò của người dùng.',
  role: 'Vai trò của người dùng.',
  groups: 'Các nhóm của người dùng.',
  permissions: 'Danh sách quyền cụ thể.',
  azp: 'Authorized party: client_id được phép dùng token này.',
  client_id: 'Mã định danh ứng dụng client.',
  nonce: 'Giá trị ngẫu nhiên chống tấn công phát lại (OpenID Connect).',
  auth_time: 'Thời điểm người dùng xác thực lần cuối.',
  acr: 'Authentication Context Class Reference: mức độ đảm bảo xác thực.',
  amr: 'Authentication Methods References: các phương thức đã dùng (pwd, otp, ...).',
  at_hash: 'Hash của access token (OpenID Connect).',
  c_hash: 'Hash của authorization code (OpenID Connect).',
  sid: 'Session ID của phiên đăng nhập.',
  typ: 'Loại token.',
  cnf: 'Confirmation: ràng buộc token với khóa (proof-of-possession).',
  act: 'Actor: bên đang hành động thay mặt chủ thể.',
  ver: 'Phiên bản token.',
  tid: 'Tenant ID (Azure AD).',
  oid: 'Object ID của người dùng (Azure AD).',
};

export const HEADER_INFO: Record<string, string> = {
  alg: 'Thuật toán ký. Không nên tin tuyệt đối khi xác minh, hãy ép dùng thuật toán bạn mong đợi.',
  typ: 'Loại token, thường là JWT.',
  kid: 'Key ID: gợi ý chọn khóa nào trong JWKS để xác minh.',
  cty: 'Content type của payload (dùng cho JWT lồng nhau).',
  jku: 'URL của JWK Set. Nguy hiểm nếu tin theo token (kẻ tấn công trỏ tới khóa của chúng).',
  jwk: 'Khóa công khai nhúng trong token. Không được tin dùng để xác minh chính token đó.',
  x5u: 'URL chứa chuỗi chứng chỉ X.509. Không tin theo token.',
  x5c: 'Chuỗi chứng chỉ X.509 nhúng trong token.',
  x5t: 'Thumbprint SHA-1 của chứng chỉ.',
  'x5t#S256': 'Thumbprint SHA-256 của chứng chỉ.',
  crit: 'Danh sách header mở rộng bắt buộc phải hiểu.',
  b64: 'Có mã hóa Base64URL payload hay không (RFC 7797).',
};

/* ---------------- Thời gian ---------------- */

export function formatRelative(deltaSec: number): string {
  const abs = Math.abs(Math.round(deltaSec));
  if (abs < 1) return 'ngay bây giờ';
  const units: [number, string][] = [
    [365 * 86400, 'năm'],
    [30 * 86400, 'tháng'],
    [86400, 'ngày'],
    [3600, 'giờ'],
    [60, 'phút'],
    [1, 'giây'],
  ];
  const parts: string[] = [];
  let rest = abs;
  for (const [sz, name] of units) {
    if (rest >= sz) {
      const n = Math.floor(rest / sz);
      rest -= n * sz;
      parts.push(`${n} ${name}`);
      if (parts.length === 2) break;
    }
  }
  return deltaSec > 0 ? `còn ${parts.join(' ')} nữa` : `${parts.join(' ')} trước`;
}

export interface TimeClaimInfo {
  claim: 'exp' | 'nbf' | 'iat';
  label: string;
  seconds: number;
  utc: string;
  local: string;
  relative: string;
}

export interface TimeAnalysis {
  claims: TimeClaimInfo[];
  expired: boolean | null;
  notYetValid: boolean;
  warnings: JwtWarning[];
}

const TIME_LABEL = { exp: 'Hết hạn (exp)', nbf: 'Có hiệu lực từ (nbf)', iat: 'Phát hành (iat)' } as const;

export function analyzeTimes(payload: Record<string, unknown>, nowSec: number, toleranceSec = 0): TimeAnalysis {
  const tol = Number.isFinite(toleranceSec) ? Math.max(0, toleranceSec) : 0;
  const claims: TimeClaimInfo[] = [];
  const warnings: JwtWarning[] = [];
  for (const c of ['exp', 'nbf', 'iat'] as const) {
    const v = payload[c];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      warnings.push({ level: 'warn', text: `${c} phải là một số (NumericDate - Unix giây), nhưng đang là ${typeof v}.` });
      continue;
    }
    if (v > 1e11) {
      warnings.push({ level: 'warn', text: `${c} = ${v} có vẻ là mili giây; JWT yêu cầu Unix giây.` });
    }
    const d = new Date(v * 1000);
    if (Number.isNaN(d.getTime())) {
      warnings.push({ level: 'warn', text: `${c} nằm ngoài phạm vi thời gian hợp lệ.` });
      continue;
    }
    claims.push({
      claim: c,
      label: TIME_LABEL[c],
      seconds: v,
      utc: d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC'),
      local: d.toLocaleString('vi-VN'),
      relative: formatRelative(v - nowSec),
    });
  }
  const exp = claims.find((x) => x.claim === 'exp');
  const nbf = claims.find((x) => x.claim === 'nbf');
  const iat = claims.find((x) => x.claim === 'iat');
  const expired = exp ? nowSec >= exp.seconds + tol : null;
  const notYetValid = nbf ? nowSec + tol < nbf.seconds : false;
  if (iat && iat.seconds > nowSec + tol) warnings.push({ level: 'warn', text: 'iat nằm trong tương lai: đồng hồ máy phát hành và máy này có thể lệch nhau.' });
  if (exp && nbf && exp.seconds < nbf.seconds) warnings.push({ level: 'warn', text: 'exp nhỏ hơn nbf: token không bao giờ hợp lệ.' });
  if (!exp) warnings.push({ level: 'info', text: 'Token không có exp: sẽ không bao giờ hết hạn, rủi ro cao nếu bị lộ.' });
  return { claims, expired, notYetValid, warnings };
}

/* ---------------- PEM / DER ---------------- */

export function toPem(label: string, der: Uint8Array): string {
  const b64 = bytesToBase64(der);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

export function parsePem(text: string): Result<{ label: string; der: Uint8Array }> {
  if (text.length > MAX_KEY_LENGTH) return { ok: false, error: 'Khóa quá dài.' };
  const m = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(text);
  if (!m) return { ok: false, error: 'Không tìm thấy khối PEM (-----BEGIN ...-----).' };
  const body = m[2];
  if (/^\s*(Proc-Type|DEK-Info):/m.test(body)) {
    return { ok: false, error: 'Khóa PEM được mã hóa bằng mật khẩu. Hãy giải mã trước (openssl pkcs8 -topk8 -nocrypt -in key.pem).' };
  }
  const b64 = body.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length === 0 || b64.length % 4 === 1) {
    return { ok: false, error: 'Nội dung PEM không phải Base64 hợp lệ.' };
  }
  try {
    return { ok: true, value: { label: m[1], der: base64ToBytes(b64 + '='.repeat((4 - (b64.length % 4)) % 4)) } };
  } catch {
    return { ok: false, error: 'Nội dung PEM không phải Base64 hợp lệ.' };
  }
}

function derLen(n: number): number[] {
  if (n < 128) return [n];
  const bytes: number[] = [];
  let x = n;
  while (x > 0) {
    bytes.unshift(x & 0xff);
    x = Math.floor(x / 256);
  }
  return [0x80 | bytes.length, ...bytes];
}

function derTlv(tag: number, content: Uint8Array | number[]): Uint8Array {
  const c = content instanceof Uint8Array ? content : Uint8Array.from(content);
  const l = derLen(c.length);
  const out = new Uint8Array(1 + l.length + c.length);
  out[0] = tag;
  out.set(l, 1);
  out.set(c, 1 + l.length);
  return out;
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

const RSA_ALG_ID = derTlv(0x30, [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);

/** PKCS#1 RSAPublicKey -> SPKI */
function wrapPkcs1Public(der: Uint8Array): Uint8Array {
  return derTlv(0x30, concat(RSA_ALG_ID, derTlv(0x03, concat(Uint8Array.of(0), der))));
}

/** PKCS#1 RSAPrivateKey -> PKCS#8 */
function wrapPkcs1Private(der: Uint8Array): Uint8Array {
  return derTlv(0x30, concat(derTlv(0x02, [0]), RSA_ALG_ID, derTlv(0x04, der)));
}

/** Chuẩn hoá PEM thành DER SPKI hoặc PKCS#8. */
function pemToStandardDer(text: string): Result<{ kind: 'public' | 'private'; der: Uint8Array }> {
  const p = parsePem(text);
  if (!p.ok) return p;
  switch (p.value.label) {
    case 'PUBLIC KEY':
      return { ok: true, value: { kind: 'public', der: p.value.der } };
    case 'RSA PUBLIC KEY':
      return { ok: true, value: { kind: 'public', der: wrapPkcs1Public(p.value.der) } };
    case 'PRIVATE KEY':
      return { ok: true, value: { kind: 'private', der: p.value.der } };
    case 'RSA PRIVATE KEY':
      return { ok: true, value: { kind: 'private', der: wrapPkcs1Private(p.value.der) } };
    case 'EC PRIVATE KEY':
      return { ok: false, error: 'Khóa "BEGIN EC PRIVATE KEY" (SEC1) chưa hỗ trợ trực tiếp. Hãy chuyển sang PKCS#8: openssl pkcs8 -topk8 -nocrypt -in ec.pem.' };
    case 'ENCRYPTED PRIVATE KEY':
      return { ok: false, error: 'Khóa riêng được mã hóa bằng mật khẩu. Hãy giải mã trước (openssl pkcs8 -nocrypt).' };
    case 'CERTIFICATE':
      return { ok: false, error: 'Đây là chứng chỉ X.509. Hãy trích khóa công khai: openssl x509 -in cert.pem -pubkey -noout.' };
    default:
      return { ok: false, error: `Loại PEM "${p.value.label}" không được hỗ trợ (cần PUBLIC KEY hoặc PRIVATE KEY).` };
  }
}

/* ---------------- Tham số thuật toán ---------------- */

function importParams(alg: JwtAlg): RsaHashedImportParams | EcKeyImportParams | HmacImportParams {
  switch (algFamily(alg)) {
    case 'HS':
      return { name: 'HMAC', hash: hashName(alg) };
    case 'RS':
      return { name: 'RSASSA-PKCS1-v1_5', hash: hashName(alg) };
    case 'PS':
      return { name: 'RSA-PSS', hash: hashName(alg) };
    default:
      return { name: 'ECDSA', namedCurve: curveFor(alg) };
  }
}

function signParams(alg: JwtAlg): AlgorithmIdentifier | RsaPssParams | EcdsaParams {
  switch (algFamily(alg)) {
    case 'HS':
      return 'HMAC';
    case 'RS':
      return 'RSASSA-PKCS1-v1_5';
    case 'PS':
      return { name: 'RSA-PSS', saltLength: parseInt(alg.slice(2), 10) / 8 };
    default:
      return { name: 'ECDSA', hash: hashName(alg) };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* ---------------- JWK ---------------- */

export type Jwk = Record<string, unknown> & { kty?: string };

const PRIVATE_JWK_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'];

export function parseJwkText(text: string, kid?: string): Result<Jwk> {
  if (text.length > MAX_KEY_LENGTH) return { ok: false, error: 'JWK quá dài.' };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JWK không phải JSON hợp lệ.' };
  }
  if (isObject(v) && Array.isArray(v.keys)) {
    const keys = v.keys.filter(isObject) as Jwk[];
    if (!keys.length) return { ok: false, error: 'JWKS không có khóa nào.' };
    const found = kid ? keys.find((k) => k.kid === kid) : undefined;
    if (kid && !found && keys.length > 1) return { ok: false, error: `JWKS không có khóa với kid="${kid}".` };
    return { ok: true, value: found ?? keys[0] };
  }
  if (!isObject(v) || typeof v.kty !== 'string') return { ok: false, error: 'JWK phải là đối tượng JSON có trường "kty".' };
  return { ok: true, value: v as Jwk };
}

function cleanJwk(jwk: Jwk, publicOnly: boolean): Jwk {
  const out: Jwk = { ...jwk };
  delete out.alg;
  delete out.use;
  delete out.key_ops;
  delete out.ext;
  if (publicOnly) for (const f of PRIVATE_JWK_FIELDS) delete out[f];
  return out;
}

export function isPrivateJwk(jwk: Jwk): boolean {
  return typeof jwk.d === 'string' || typeof jwk.p === 'string';
}

function rsaBits(nB64: unknown): number {
  if (typeof nB64 !== 'string') return 0;
  const b = b64urlDecode(nB64);
  if (!b) return 0;
  let i = 0;
  while (i < b.length && b[i] === 0) i++;
  if (i >= b.length) return 0;
  return (b.length - i - 1) * 8 + (32 - Math.clz32(b[i]));
}

function checkJwkMatchesAlg(jwk: Jwk, alg: JwtAlg): string | null {
  const fam = algFamily(alg);
  if (fam === 'HS') return jwk.kty === 'oct' ? null : 'JWK cho HS* phải có kty="oct".';
  if (fam === 'RS' || fam === 'PS') return jwk.kty === 'RSA' ? null : `Thuật toán ${alg} cần khóa RSA, nhưng JWK có kty="${String(jwk.kty)}".`;
  if (jwk.kty !== 'EC') return `Thuật toán ${alg} cần khóa EC, nhưng JWK có kty="${String(jwk.kty)}".`;
  if (jwk.crv !== curveFor(alg)) return `${alg} cần đường cong ${curveFor(alg)}, nhưng khóa dùng "${String(jwk.crv)}".`;
  return null;
}

export interface KeyLoad {
  key: CryptoKey;
  warnings: JwtWarning[];
}

/** Nạp khóa công khai (xác minh) từ PEM SPKI/PKCS#8 hoặc JWK/JWKS. Với khóa riêng, tự suy ra khóa công khai. */
export async function loadVerifyKey(alg: JwtAlg, text: string, kid?: string): Promise<Result<KeyLoad>> {
  const t = text.trim();
  if (!t) return { ok: false, error: 'Hãy nhập khóa công khai (PEM hoặc JWK).' };
  const warnings: JwtWarning[] = [];
  try {
    let jwk: Jwk | null = null;
    if (t.startsWith('{')) {
      const j = parseJwkText(t, kid);
      if (!j.ok) return j;
      jwk = j.value;
      if (isPrivateJwk(jwk)) warnings.push({ level: 'warn', text: 'Bạn đã dán khóa RIÊNG; để xác minh chỉ cần khóa công khai. Công cụ đã tự bỏ phần bí mật.' });
    } else {
      const d = pemToStandardDer(t);
      if (!d.ok) return d;
      const imp = importParams(alg);
      if (d.value.kind === 'public') {
        const key = await crypto.subtle.importKey('spki', ab(d.value.der), imp, true, ['verify']);
        const jw = (await crypto.subtle.exportKey('jwk', key)) as Jwk;
        if (jw.kty === 'RSA' && rsaBits(jw.n) < 2048) warnings.push({ level: 'warn', text: 'Khóa RSA dưới 2048 bit được coi là yếu.' });
        return { ok: true, value: { key, warnings } };
      }
      const priv = await crypto.subtle.importKey('pkcs8', ab(d.value.der), imp, true, ['sign']);
      jwk = (await crypto.subtle.exportKey('jwk', priv)) as Jwk;
      warnings.push({ level: 'warn', text: 'Bạn đã dán khóa RIÊNG; để xác minh chỉ cần khóa công khai. Công cụ đã tự suy ra khóa công khai.' });
    }
    const mismatch = checkJwkMatchesAlg(jwk, alg);
    if (mismatch) return { ok: false, error: mismatch };
    if (jwk.kty === 'oct') return { ok: false, error: 'Khóa oct chỉ dùng cho HS*.' };
    if (jwk.kty === 'RSA' && rsaBits(jwk.n) < 2048) warnings.push({ level: 'warn', text: 'Khóa RSA dưới 2048 bit được coi là yếu.' });
    const key = await crypto.subtle.importKey('jwk', cleanJwk(jwk, true) as JsonWebKey, importParams(alg), true, ['verify']);
    return { ok: true, value: { key, warnings } };
  } catch (e) {
    return { ok: false, error: `Không nạp được khóa cho ${alg}: ${friendlyKeyError(e)}` };
  }
}

function friendlyKeyError(e: unknown): string {
  const m = errMsg(e);
  if (/curve|named/i.test(m)) return 'đường cong của khóa không khớp với thuật toán (ES256=P-256, ES384=P-384, ES512=P-521).';
  return 'khóa không hợp lệ hoặc không khớp với thuật toán (' + m.slice(0, 120) + ').';
}

/** Nạp khóa riêng (ký) từ PEM PKCS#8 / PKCS#1 hoặc JWK. */
export async function loadSignKey(alg: JwtAlg, text: string): Promise<Result<KeyLoad>> {
  const t = text.trim();
  if (!t) return { ok: false, error: 'Hãy nhập khóa riêng (PEM PKCS#8 hoặc JWK).' };
  const warnings: JwtWarning[] = [];
  try {
    if (t.startsWith('{')) {
      const j = parseJwkText(t);
      if (!j.ok) return j;
      if (!isPrivateJwk(j.value)) return { ok: false, error: 'JWK này là khóa công khai (không có trường "d"); cần khóa riêng để ký.' };
      const mismatch = checkJwkMatchesAlg(j.value, alg);
      if (mismatch) return { ok: false, error: mismatch };
      if (j.value.kty === 'RSA' && rsaBits(j.value.n) < 2048) warnings.push({ level: 'warn', text: 'Khóa RSA dưới 2048 bit được coi là yếu.' });
      const key = await crypto.subtle.importKey('jwk', cleanJwk(j.value, false) as JsonWebKey, importParams(alg), true, ['sign']);
      return { ok: true, value: { key, warnings } };
    }
    const d = pemToStandardDer(t);
    if (!d.ok) return d;
    if (d.value.kind === 'public') return { ok: false, error: 'Đây là khóa công khai; cần khóa riêng (BEGIN PRIVATE KEY) để ký.' };
    const key = await crypto.subtle.importKey('pkcs8', ab(d.value.der), importParams(alg), true, ['sign']);
    return { ok: true, value: { key, warnings } };
  } catch (e) {
    return { ok: false, error: `Không nạp được khóa riêng cho ${alg}: ${friendlyKeyError(e)}` };
  }
}

export type SecretEncoding = 'text' | 'base64' | 'base64url' | 'hex';

export function secretToBytes(secret: string, enc_: SecretEncoding): Result<Uint8Array> {
  if (secret.length > MAX_KEY_LENGTH) return { ok: false, error: 'Secret quá dài.' };
  if (enc_ === 'text') {
    const b = enc.encode(secret);
    return b.length ? { ok: true, value: b } : { ok: false, error: 'Secret không được để trống.' };
  }
  const s = secret.replace(/\s+/g, '');
  let bytes: Uint8Array | null = null;
  if (enc_ === 'hex') {
    if (s.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(s)) {
      bytes = new Uint8Array(s.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    }
  } else {
    // base64 chuẩn hoặc url-safe, chấp nhận thiếu padding
    if (/^[A-Za-z0-9+/_-]*={0,2}$/.test(s)) bytes = b64urlDecode(s.replace(/\+/g, '-').replace(/\//g, '_'));
  }
  if (!bytes) return { ok: false, error: `Secret không phải chuỗi ${enc_ === 'hex' ? 'hex' : 'Base64'} hợp lệ.` };
  if (!bytes.length) return { ok: false, error: 'Secret không được để trống.' };
  return { ok: true, value: bytes };
}

export async function loadHmacKey(alg: JwtAlg, secret: string, encoding: SecretEncoding, usage: 'sign' | 'verify'): Promise<Result<KeyLoad>> {
  if (algFamily(alg) !== 'HS') return { ok: false, error: 'Chỉ dùng cho HS256/384/512.' };
  const t = secret.trim();
  let bytes: Result<Uint8Array>;
  if (t.startsWith('{') && /"kty"\s*:\s*"oct"/.test(t)) {
    const j = parseJwkText(t);
    if (!j.ok) return j;
    const kb = typeof j.value.k === 'string' ? b64urlDecode(j.value.k) : null;
    bytes = kb && kb.length ? { ok: true, value: kb } : { ok: false, error: 'JWK oct thiếu trường "k" hợp lệ.' };
  } else {
    // text giữ nguyên khoảng trắng, không trim
    bytes = secretToBytes(encoding === 'text' ? secret : t, encoding);
  }
  if (!bytes.ok) return bytes;
  const warnings: JwtWarning[] = [];
  const need = parseInt(alg.slice(2), 10) / 8;
  if (bytes.value.length < need) {
    warnings.push({ level: 'warn', text: `Secret chỉ dài ${bytes.value.length} byte, ngắn hơn ${need} byte (độ dài hash của ${alg}). RFC 7518 yêu cầu khóa HMAC tối thiểu bằng độ dài hash; secret ngắn dễ bị dò brute-force.` });
  }
  try {
    const key = await crypto.subtle.importKey('raw', ab(bytes.value), importParams(alg) as HmacImportParams, false, [usage]);
    return { ok: true, value: { key, warnings } };
  } catch (e) {
    return { ok: false, error: 'Không nạp được secret: ' + errMsg(e) };
  }
}

/* ---------------- Ký & xác minh ---------------- */

export async function signBytes(alg: JwtAlg, key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign(signParams(alg), key, ab(data)));
}

export async function verifyBytes(alg: JwtAlg, key: CryptoKey, sig: Uint8Array, data: Uint8Array): Promise<boolean> {
  return crypto.subtle.verify(signParams(alg), key, ab(sig), ab(data));
}

export interface VerifyOptions {
  /** Thuật toán do NGƯỜI DÙNG chọn (không lấy từ header). */
  alg: JwtAlg;
  /** HS*: secret; RS/PS/ES: PEM hoặc JWK công khai. */
  key: string;
  secretEncoding?: SecretEncoding;
}

export interface VerifyResult {
  /** Chữ ký khớp theo thuật toán người dùng chọn. */
  signatureValid: boolean;
  /** Header alg khác thuật toán người dùng chọn. */
  algMismatch: boolean;
  /** Tổng thể: chữ ký đúng VÀ alg khớp. */
  accepted: boolean;
  warnings: JwtWarning[];
}

export function headerWarnings(header: Record<string, unknown>): JwtWarning[] {
  const w: JwtWarning[] = [];
  const alg = header.alg;
  if (typeof alg !== 'string') w.push({ level: 'danger', text: 'Header thiếu trường "alg" hợp lệ.' });
  else if (alg.toLowerCase() === 'none') {
    w.push({
      level: 'danger',
      text: 'alg = "none": token KHÔNG có chữ ký nên ai cũng có thể giả mạo. Máy chủ tuyệt đối không được chấp nhận token như vậy; đây là lỗ hổng kinh điển của các thư viện JWT cũ.',
    });
  } else if (!isJwtAlg(alg)) {
    w.push({ level: 'warn', text: `Thuật toán "${alg}" không được công cụ này hỗ trợ xác minh.` });
  }
  for (const k of ['jku', 'jwk', 'x5u', 'x5c']) {
    if (k in header) w.push({ level: 'warn', text: `Header có "${k}": đừng bao giờ lấy khóa xác minh từ chính token; kẻ tấn công có thể trỏ tới khóa của họ.` });
  }
  if ('crit' in header) w.push({ level: 'info', text: 'Header có "crit": bên xác minh phải hiểu các extension được liệt kê, nếu không phải từ chối token.' });
  return w;
}

export async function verifyJwt(token: string, opts: VerifyOptions): Promise<Result<VerifyResult>> {
  const parsed = parseJwt(token);
  if (!parsed.ok) return parsed;
  const { header, signingInput, signature } = parsed.value;
  const warnings: JwtWarning[] = headerWarnings(header);
  const headerAlg = header.alg;
  const algMismatch = headerAlg !== opts.alg;
  if (algMismatch && typeof headerAlg === 'string' && headerAlg.toLowerCase() !== 'none') {
    warnings.push({
      level: 'danger',
      text: `Header khai báo alg="${headerAlg}" nhưng bạn chọn ${opts.alg}. Bên xác minh phải ép dùng thuật toán mong đợi và từ chối token nếu header khác, vì tin alg trong token dẫn tới tấn công nhầm thuật toán (ví dụ đổi RS256 thành HS256 rồi ký bằng chính khóa công khai làm secret).`,
    });
  } else if (algMismatch && headerAlg === undefined) {
    warnings.push({ level: 'danger', text: 'Header không có alg nên token bị từ chối.' });
  }
  const kid = typeof header.kid === 'string' ? header.kid : undefined;
  const fam = algFamily(opts.alg);
  const loaded =
    fam === 'HS'
      ? await loadHmacKey(opts.alg, opts.key, opts.secretEncoding ?? 'text', 'verify')
      : await loadVerifyKey(opts.alg, opts.key, kid);
  if (!loaded.ok) return loaded;
  warnings.push(...loaded.value.warnings);
  let valid = false;
  try {
    valid = await verifyBytes(opts.alg, loaded.value.key, signature, enc.encode(signingInput));
  } catch (e) {
    return { ok: false, error: 'Lỗi khi xác minh: ' + errMsg(e) };
  }
  if (!valid && fam === 'ES' && signature.length !== (opts.alg === 'ES256' ? 64 : opts.alg === 'ES384' ? 96 : 132)) {
    warnings.push({ level: 'warn', text: `Chữ ký ${opts.alg} phải là R||S dài ${opts.alg === 'ES256' ? 64 : opts.alg === 'ES384' ? 96 : 132} byte (không phải DER). Chữ ký hiện có ${signature.length} byte.` });
  }
  return { ok: true, value: { signatureValid: valid, algMismatch, accepted: valid && !algMismatch, warnings } };
}

export interface SignOptions {
  headerJson: string;
  payloadJson: string;
  alg: JwtAlg;
  key: string;
  secretEncoding?: SecretEncoding;
}

function parseJsonObject(text: string, name: string): Result<Record<string, unknown>> {
  if (text.length > MAX_TOKEN_LENGTH) return { ok: false, error: `${name} quá dài.` };
  try {
    const v: unknown = JSON.parse(text);
    if (!isObject(v)) return { ok: false, error: `${name} phải là một đối tượng JSON ({...}).` };
    return { ok: true, value: v };
  } catch (e) {
    return { ok: false, error: `${name} không phải JSON hợp lệ: ${errMsg(e).slice(0, 100)}` };
  }
}

/** Đặt header.alg = alg, giữ nguyên các trường khác. Trả về JSON đã định dạng (hoặc nguyên văn nếu JSON lỗi). */
export function syncHeaderAlg(headerJson: string, alg: JwtAlg): string {
  const h = parseJsonObject(headerJson, 'Header');
  if (!h.ok) return headerJson;
  return JSON.stringify({ ...h.value, alg }, null, 2);
}

export async function signJwt(opts: SignOptions): Promise<Result<{ token: string; warnings: JwtWarning[] }>> {
  const h = parseJsonObject(opts.headerJson, 'Header');
  if (!h.ok) return h;
  const p = parseJsonObject(opts.payloadJson, 'Payload');
  if (!p.ok) return p;
  if (h.value.alg !== opts.alg) {
    return { ok: false, error: `Header có alg="${String(h.value.alg)}" nhưng thuật toán đã chọn là ${opts.alg}. Hãy đồng bộ header.` };
  }
  const loaded =
    algFamily(opts.alg) === 'HS'
      ? await loadHmacKey(opts.alg, opts.key, opts.secretEncoding ?? 'text', 'sign')
      : await loadSignKey(opts.alg, opts.key);
  if (!loaded.ok) return loaded;
  try {
    const input = b64urlEncodeText(JSON.stringify(h.value)) + '.' + b64urlEncodeText(JSON.stringify(p.value));
    const sig = await signBytes(opts.alg, loaded.value.key, enc.encode(input));
    return { ok: true, value: { token: input + '.' + b64urlEncode(sig), warnings: loaded.value.warnings } };
  } catch (e) {
    return { ok: false, error: 'Lỗi khi ký: ' + errMsg(e) };
  }
}

/* ---------------- Sinh khóa ---------------- */

export type KeyKind = 'RSA-2048' | 'RSA-3072' | 'EC-P-256' | 'EC-P-384' | 'EC-P-521';

export interface GeneratedKeyPair {
  privatePem: string;
  publicPem: string;
  privateJwk: string;
  publicJwk: string;
  thumbprint: string;
}

export async function generateKeyPair(kind: KeyKind): Promise<Result<GeneratedKeyPair>> {
  try {
    const params: RsaHashedKeyGenParams | EcKeyGenParams = kind.startsWith('RSA')
      ? { name: 'RSASSA-PKCS1-v1_5', modulusLength: kind === 'RSA-2048' ? 2048 : 3072, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' }
      : { name: 'ECDSA', namedCurve: kind.slice(3) };
    const pair = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
    const privJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as Jwk;
    const pubJwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as Jwk;
    const pj = cleanJwk(pubJwk, true);
    const sj = cleanJwk(privJwk, false);
    const th = await jwkThumbprint(pj);
    return {
      ok: true,
      value: {
        privatePem: toPem('PRIVATE KEY', pkcs8),
        publicPem: toPem('PUBLIC KEY', spki),
        privateJwk: JSON.stringify(sj, null, 2),
        publicJwk: JSON.stringify(pj, null, 2),
        thumbprint: th.ok ? th.value : '',
      },
    };
  } catch (e) {
    return { ok: false, error: 'Không tạo được cặp khóa: ' + errMsg(e) };
  }
}

/** Secret HMAC ngẫu nhiên (mặc định 32 byte), trả về Base64URL. */
export function randomHsSecret(bytes = 32): string {
  const b = new Uint8Array(Math.min(Math.max(bytes, 16), 128));
  crypto.getRandomValues(b);
  return b64urlEncode(b);
}

export function randomJti(): string {
  return crypto.randomUUID();
}

/* ---------------- JWK <-> PEM & thumbprint ---------------- */

async function importAnyPem(der: Uint8Array, kind: 'public' | 'private'): Promise<Jwk> {
  const fmt = kind === 'public' ? 'spki' : 'pkcs8';
  const usages: KeyUsage[] = kind === 'public' ? ['verify'] : ['sign'];
  const attempts: (RsaHashedImportParams | EcKeyImportParams)[] = [
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    { name: 'ECDSA', namedCurve: 'P-256' },
    { name: 'ECDSA', namedCurve: 'P-384' },
    { name: 'ECDSA', namedCurve: 'P-521' },
  ];
  for (const a of attempts) {
    try {
      const k = await crypto.subtle.importKey(fmt, ab(der), a, true, usages);
      return cleanJwk((await crypto.subtle.exportKey('jwk', k)) as Jwk, false);
    } catch {
      /* thử tiếp */
    }
  }
  throw new Error('Không nhận dạng được khóa (chỉ hỗ trợ RSA và EC P-256/384/521).');
}

export interface PemToJwkResult {
  jwk: Jwk;
  publicJwk: Jwk;
  isPrivate: boolean;
  thumbprint: string;
}

export async function pemToJwk(pemText: string): Promise<Result<PemToJwkResult>> {
  const d = pemToStandardDer(pemText.trim());
  if (!d.ok) return d;
  try {
    const jwk = await importAnyPem(d.value.der, d.value.kind);
    const publicJwk = cleanJwk(jwk, true);
    const th = await jwkThumbprint(publicJwk);
    return { ok: true, value: { jwk, publicJwk, isPrivate: d.value.kind === 'private', thumbprint: th.ok ? th.value : '' } };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export interface JwkToPemResult {
  pem: string;
  publicPem: string;
  isPrivate: boolean;
}

export async function jwkToPem(jwkText: string): Promise<Result<JwkToPemResult>> {
  const j = parseJwkText(jwkText.trim());
  if (!j.ok) return j;
  const jwk = j.value;
  if (jwk.kty !== 'RSA' && jwk.kty !== 'EC') return { ok: false, error: 'Chỉ chuyển được JWK loại RSA hoặc EC sang PEM (kty="oct" là khóa đối xứng).' };
  const params: RsaHashedImportParams | EcKeyImportParams =
    jwk.kty === 'RSA'
      ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
      : { name: 'ECDSA', namedCurve: typeof jwk.crv === 'string' ? jwk.crv : 'P-256' };
  try {
    const isPrivate = isPrivateJwk(jwk);
    const pub = await crypto.subtle.importKey('jwk', cleanJwk(jwk, true) as JsonWebKey, params, true, ['verify']);
    const publicPem = toPem('PUBLIC KEY', new Uint8Array(await crypto.subtle.exportKey('spki', pub)));
    let pem = publicPem;
    if (isPrivate) {
      const priv = await crypto.subtle.importKey('jwk', cleanJwk(jwk, false) as JsonWebKey, params, true, ['sign']);
      pem = toPem('PRIVATE KEY', new Uint8Array(await crypto.subtle.exportKey('pkcs8', priv)));
    }
    return { ok: true, value: { pem, publicPem, isPrivate } };
  } catch (e) {
    return { ok: false, error: 'JWK không hợp lệ: ' + errMsg(e).slice(0, 150) };
  }
}

/** RFC 7638: SHA-256 của JSON gồm các thành viên bắt buộc theo thứ tự từ điển. */
export async function jwkThumbprint(jwk: Jwk): Promise<Result<string>> {
  let members: string[];
  if (jwk.kty === 'RSA') members = ['e', 'kty', 'n'];
  else if (jwk.kty === 'EC') members = ['crv', 'kty', 'x', 'y'];
  else if (jwk.kty === 'oct') members = ['k', 'kty'];
  else if (jwk.kty === 'OKP') members = ['crv', 'kty', 'x'];
  else return { ok: false, error: 'kty không được hỗ trợ cho thumbprint (RSA, EC, oct, OKP).' };
  const obj: Record<string, string> = {};
  for (const m of members) {
    const v = jwk[m];
    if (typeof v !== 'string') return { ok: false, error: `JWK thiếu thành viên bắt buộc "${m}".` };
    obj[m] = v;
  }
  const json = '{' + members.map((m) => JSON.stringify(m) + ':' + JSON.stringify(obj[m])).join(',') + '}';
  const hash = await crypto.subtle.digest('SHA-256', ab(enc.encode(json)));
  return { ok: true, value: b64urlEncode(new Uint8Array(hash)) };
}

/* ---------------- Mẫu ---------------- */

export const SAMPLE_HS256_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
export const SAMPLE_HS256_SECRET = 'your-256-bit-secret';

export function defaultHeaderJson(alg: JwtAlg): string {
  return JSON.stringify({ alg, typ: 'JWT' }, null, 2);
}

export function defaultPayloadJson(nowSec: number): string {
  return JSON.stringify({ sub: '1234567890', name: 'Nguyễn Văn A', iat: nowSec }, null, 2);
}

/** Thêm/ghi đè claim thời gian hoặc jti vào payload JSON. */
export function addClaim(payloadJson: string, claim: 'iat' | 'exp' | 'nbf' | 'jti', nowSec: number): Result<string> {
  const p = parseJsonObject(payloadJson, 'Payload');
  if (!p.ok) return p;
  const out = { ...p.value };
  if (claim === 'iat' || claim === 'nbf') out[claim] = nowSec;
  else if (claim === 'exp') out.exp = nowSec + 3600;
  else out.jti = randomJti();
  return { ok: true, value: JSON.stringify(out, null, 2) };
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
