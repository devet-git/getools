/**
 * Bộ phân tích ASN.1 DER + giải mã chứng chỉ X.509 / CSR PKCS#10, viết tay, không dùng thư viện.
 * Mọi hàm công khai đều không ném lỗi: dữ liệu hỏng trả về đối tượng lỗi kèm thông báo tiếng Việt.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_DER_SIZE = 1024 * 1024; // 1 MB
export const MAX_DEPTH = 64;
const MAX_NODES = 100_000;

/* ================= Tiện ích byte ================= */

export function toHex(b: Uint8Array, sep = ''): string {
  let s = '';
  for (let i = 0; i < b.length; i++) {
    s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    if (sep && i < b.length - 1) s += sep;
  }
  return s;
}

export function toBase64(b: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode(...b.subarray(i, i + CH));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array | null {
  try {
    let s = b64.replace(/-/g, '+').replace(/_/g, '/');
    s += '='.repeat((4 - (s.length % 4)) % 4);
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function fromHex(h: string): Uint8Array | null {
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) return null;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

export function toPemText(label: string, der: Uint8Array): string {
  const b64 = toBase64(der);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function bigFromBytes(b: Uint8Array, signed: boolean): bigint {
  let v = BigInt(0);
  for (let i = 0; i < b.length; i++) v = (v << BigInt(8)) | BigInt(b[i]);
  if (signed && b.length > 0 && b[0] & 0x80) v -= BigInt(1) << BigInt(8 * b.length);
  return v;
}

/* ================= ASN.1 DER ================= */

export interface Asn1Node {
  /** 0 universal, 1 application, 2 context, 3 private */
  cls: number;
  tag: number;
  constructed: boolean;
  /** offset tuyệt đối của byte tag */
  offset: number;
  /** độ dài header (tag + length) */
  hdr: number;
  /** độ dài nội dung */
  len: number;
  children?: Asn1Node[];
  /** OCTET STRING / BIT STRING chứa DER lồng nhau (nếu nhận ra được) */
  inner?: Asn1Node;
}

class AsnError extends Error {}

interface Ctx {
  nodes: number;
}

function parseNode(b: Uint8Array, pos: number, end: number, depth: number, ctx: Ctx): Asn1Node {
  if (depth > MAX_DEPTH) throw new AsnError(`Cấu trúc lồng quá sâu (> ${MAX_DEPTH} cấp) tại offset ${pos}.`);
  if (++ctx.nodes > MAX_NODES) throw new AsnError('Quá nhiều phần tử ASN.1 (giới hạn 100.000).');
  if (pos >= end) throw new AsnError(`Dữ liệu bị cắt cụt: thiếu byte tag tại offset ${pos}.`);
  const b0 = b[pos];
  const cls = b0 >> 6;
  const constructed = (b0 & 0x20) !== 0;
  let tag = b0 & 0x1f;
  let p = pos + 1;
  if (tag === 0x1f) {
    tag = 0;
    let n = 0;
    for (;;) {
      if (p >= end) throw new AsnError(`Dữ liệu bị cắt cụt trong tag dạng dài tại offset ${p}.`);
      const c = b[p++];
      tag = tag * 128 + (c & 0x7f);
      if (++n > 5) throw new AsnError(`Tag dạng dài quá lớn tại offset ${pos}.`);
      if (!(c & 0x80)) break;
    }
  }
  if (cls === 0 && tag === 0 && !constructed) throw new AsnError(`Gặp End-of-Contents (00 00) tại offset ${pos}: không hợp lệ trong DER.`);
  if (p >= end) throw new AsnError(`Dữ liệu bị cắt cụt: thiếu byte độ dài tại offset ${p}.`);
  const l0 = b[p++];
  let len: number;
  if (l0 === 0x80) {
    throw new AsnError(`Độ dài không xác định (indefinite length, BER) tại offset ${pos}: DER không cho phép, hãy chuyển sang DER (openssl asn1parse / x509 -outform DER).`);
  } else if (l0 & 0x80) {
    const n = l0 & 0x7f;
    if (n > 4) throw new AsnError(`Độ dài dạng dài dùng ${n} byte tại offset ${pos}: vượt giới hạn hỗ trợ.`);
    if (p + n > end) throw new AsnError(`Dữ liệu bị cắt cụt trong trường độ dài tại offset ${p}.`);
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[p++];
  } else {
    len = l0;
  }
  const hdr = p - pos;
  if (p + len > end) {
    throw new AsnError(`Phần tử tại offset ${pos} khai báo ${len} byte nhưng chỉ còn ${end - p} byte (dữ liệu bị cắt cụt hoặc độ dài sai).`);
  }
  const node: Asn1Node = { cls, tag, constructed, offset: pos, hdr, len };
  const cEnd = p + len;
  if (constructed) {
    const children: Asn1Node[] = [];
    let q = p;
    while (q < cEnd) {
      const ch = parseNode(b, q, cEnd, depth + 1, ctx);
      children.push(ch);
      q = ch.offset + ch.hdr + ch.len;
    }
    node.children = children;
  } else if (cls === 0 && (tag === 4 || tag === 3) && depth < MAX_DEPTH - 1) {
    // Thử nhận ra DER lồng nhau (SEQUENCE/SET) trong OCTET STRING / BIT STRING
    const s = tag === 3 ? p + 1 : p;
    if (cEnd - s >= 2 && (b[s] === 0x30 || b[s] === 0x31) && (tag === 4 || b[p] === 0)) {
      const saved = ctx.nodes;
      try {
        const inner = parseNode(b, s, cEnd, depth + 1, ctx);
        if (inner.offset + inner.hdr + inner.len === cEnd) node.inner = inner;
        else ctx.nodes = saved;
      } catch {
        ctx.nodes = saved;
      }
    }
  }
  return node;
}

export interface ParsedAsn1 {
  node: Asn1Node;
  /** số byte thừa sau phần tử gốc */
  trailing: number;
}

/** Phân tích một phần tử ASN.1 gốc. Không bao giờ ném lỗi. */
export function parseAsn1(bytes: Uint8Array, start = 0, end = bytes.length): Result<ParsedAsn1> {
  if (bytes.length > MAX_DER_SIZE) return { ok: false, error: `Dữ liệu quá lớn (${bytes.length} byte, giới hạn ${MAX_DER_SIZE} byte).` };
  if (end - start <= 0) return { ok: false, error: 'Dữ liệu rỗng.' };
  try {
    const node = parseNode(bytes, start, end, 0, { nodes: 0 });
    return { ok: true, value: { node, trailing: end - (node.offset + node.hdr + node.len) } };
  } catch (e) {
    if (e instanceof AsnError) return { ok: false, error: e.message };
    return { ok: false, error: 'Không thể phân tích ASN.1: dữ liệu không hợp lệ.' };
  }
}

export function contentOf(n: Asn1Node, b: Uint8Array): Uint8Array {
  return b.subarray(n.offset + n.hdr, n.offset + n.hdr + n.len);
}
export function rawOf(n: Asn1Node, b: Uint8Array): Uint8Array {
  return b.subarray(n.offset, n.offset + n.hdr + n.len);
}

export function decodeOid(c: Uint8Array): string {
  if (c.length === 0) return '';
  const arcs: string[] = [];
  let v = BigInt(0);
  let first = true;
  for (let i = 0; i < c.length; i++) {
    v = (v << BigInt(7)) | BigInt(c[i] & 0x7f);
    if (!(c[i] & 0x80)) {
      if (first) {
        const a0 = v < BigInt(80) ? (v < BigInt(40) ? BigInt(0) : BigInt(1)) : BigInt(2);
        arcs.push(a0.toString(), (v - a0 * BigInt(40)).toString());
        first = false;
      } else arcs.push(v.toString());
      v = BigInt(0);
    }
  }
  return arcs.join('.');
}

const UNIVERSAL_NAMES: Record<number, string> = {
  1: 'BOOLEAN', 2: 'INTEGER', 3: 'BIT STRING', 4: 'OCTET STRING', 5: 'NULL', 6: 'OBJECT IDENTIFIER', 7: 'ObjectDescriptor',
  9: 'REAL', 10: 'ENUMERATED', 12: 'UTF8String', 16: 'SEQUENCE', 17: 'SET', 18: 'NumericString', 19: 'PrintableString',
  20: 'TeletexString', 21: 'VideotexString', 22: 'IA5String', 23: 'UTCTime', 24: 'GeneralizedTime', 25: 'GraphicString',
  26: 'VisibleString', 27: 'GeneralString', 28: 'UniversalString', 30: 'BMPString',
};

export function tagName(n: Asn1Node): string {
  if (n.cls === 0) return UNIVERSAL_NAMES[n.tag] ?? `UNIVERSAL ${n.tag}`;
  if (n.cls === 1) return `APPLICATION ${n.tag}`;
  if (n.cls === 2) return `[${n.tag}]`;
  return `PRIVATE ${n.tag}`;
}

function decodeStringContent(tag: number, c: Uint8Array): string | null {
  try {
    switch (tag) {
      case 12:
        return new TextDecoder('utf-8').decode(c);
      case 18:
      case 19:
      case 20:
      case 22:
      case 26:
      case 25:
      case 27: {
        let s = '';
        for (let i = 0; i < c.length; i++) s += String.fromCharCode(c[i]);
        return s;
      }
      case 30: {
        let s = '';
        for (let i = 0; i + 1 < c.length; i += 2) s += String.fromCharCode((c[i] << 8) | c[i + 1]);
        return s;
      }
      case 28: {
        let s = '';
        for (let i = 0; i + 3 < c.length; i += 4) s += String.fromCodePoint(Math.min(0x10ffff, ((c[i] << 24) | (c[i + 1] << 16) | (c[i + 2] << 8) | c[i + 3]) >>> 0));
        return s;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/* ================= Thời gian ================= */

/** Phân tích UTCTime / GeneralizedTime thành mili giây epoch (UTC). */
export function parseAsn1Time(tag: number, s: string): number | null {
  let m: RegExpExecArray | null;
  let year: number;
  let rest: string;
  if (tag === 23) {
    m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(Z|[+-]\d{4})$/.exec(s);
    if (!m) return null;
    const yy = parseInt(m[1], 10);
    year = yy >= 50 ? 1900 + yy : 2000 + yy; // RFC 5280: YY >= 50 -> 19YY
    rest = m.slice(2).join('|');
  } else if (tag === 24) {
    m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})?(\d{2})?(?:\.\d+)?(Z|[+-]\d{4})$/.exec(s);
    if (!m) return null;
    year = parseInt(m[1], 10);
    rest = m.slice(2).join('|');
  } else return null;
  const parts = rest.split('|');
  const mo = parseInt(parts[0], 10), da = parseInt(parts[1], 10), hh = parseInt(parts[2], 10);
  const mi = parts[3] ? parseInt(parts[3], 10) : 0;
  const ss = parts[4] ? parseInt(parts[4], 10) : 0;
  const z = parts[5];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || hh > 23 || mi > 59 || ss > 60) return null;
  const d = new Date(0);
  d.setUTCFullYear(year, mo - 1, da);
  d.setUTCHours(hh, mi, ss, 0);
  if (d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) return null;
  let ms = d.getTime();
  if (z && z !== 'Z') {
    const sign = z[0] === '-' ? -1 : 1;
    ms -= sign * (parseInt(z.slice(1, 3), 10) * 60 + parseInt(z.slice(3, 5), 10)) * 60000;
  }
  return ms;
}

function timeFromNode(n: Asn1Node | undefined, b: Uint8Array): { ms: number } | { error: string } {
  if (!n || n.cls !== 0 || (n.tag !== 23 && n.tag !== 24)) return { error: 'Trường thời gian không phải UTCTime/GeneralizedTime.' };
  const s = decodeStringContent(22, contentOf(n, b)) ?? '';
  const ms = parseAsn1Time(n.tag, s);
  if (ms === null) return { error: `Định dạng thời gian không hợp lệ: "${s.slice(0, 40)}".` };
  return { ms };
}

/* ================= Registry OID ================= */

// Mỗi dòng: oid|tên|tên ngắn (tùy chọn, dùng cho DN)
const OID_TABLE = `
2.5.4.0|objectClass
2.5.4.1|aliasedEntryName
2.5.4.2|knowledgeInformation
2.5.4.3|commonName|CN
2.5.4.4|surname|SN
2.5.4.5|serialNumber|serialNumber
2.5.4.6|countryName|C
2.5.4.7|localityName|L
2.5.4.8|stateOrProvinceName|ST
2.5.4.9|streetAddress|STREET
2.5.4.10|organizationName|O
2.5.4.11|organizationalUnitName|OU
2.5.4.12|title|title
2.5.4.13|description|description
2.5.4.14|searchGuide
2.5.4.15|businessCategory|businessCategory
2.5.4.16|postalAddress|postalAddress
2.5.4.17|postalCode|postalCode
2.5.4.18|postOfficeBox|postOfficeBox
2.5.4.19|physicalDeliveryOfficeName
2.5.4.20|telephoneNumber|telephoneNumber
2.5.4.21|telexNumber
2.5.4.22|teletexTerminalIdentifier
2.5.4.23|facsimileTelephoneNumber
2.5.4.24|x121Address
2.5.4.25|internationalISDNNumber
2.5.4.26|registeredAddress
2.5.4.27|destinationIndicator
2.5.4.28|preferredDeliveryMethod
2.5.4.29|presentationAddress
2.5.4.30|supportedApplicationContext
2.5.4.31|member
2.5.4.32|owner
2.5.4.33|roleOccupant
2.5.4.34|seeAlso
2.5.4.35|userPassword
2.5.4.36|userCertificate
2.5.4.37|cACertificate
2.5.4.38|authorityRevocationList
2.5.4.39|certificateRevocationList
2.5.4.40|crossCertificatePair
2.5.4.41|name|name
2.5.4.42|givenName|GN
2.5.4.43|initials|initials
2.5.4.44|generationQualifier|generationQualifier
2.5.4.45|x500UniqueIdentifier|x500UniqueIdentifier
2.5.4.46|dnQualifier|dnQualifier
2.5.4.47|enhancedSearchGuide
2.5.4.48|protocolInformation
2.5.4.49|distinguishedName
2.5.4.50|uniqueMember
2.5.4.51|houseIdentifier
2.5.4.52|supportedAlgorithms
2.5.4.53|deltaRevocationList
2.5.4.54|dmdName
2.5.4.65|pseudonym|pseudonym
2.5.4.97|organizationIdentifier|organizationIdentifier
0.9.2342.19200300.100.1.1|userId|UID
0.9.2342.19200300.100.1.3|rfc822Mailbox|mail
0.9.2342.19200300.100.1.25|domainComponent|DC
1.2.840.113549.1.9.1|emailAddress|emailAddress
1.2.840.113549.1.9.2|unstructuredName|unstructuredName
1.2.840.113549.1.9.3|contentType
1.2.840.113549.1.9.4|messageDigest
1.2.840.113549.1.9.5|signingTime
1.2.840.113549.1.9.7|challengePassword
1.2.840.113549.1.9.8|unstructuredAddress
1.2.840.113549.1.9.14|extensionRequest
1.2.840.113549.1.9.15|smimeCapabilities
1.2.840.113549.1.9.20|friendlyName
1.2.840.113549.1.9.21|localKeyId
1.3.6.1.4.1.311.60.2.1.1|jurisdictionLocalityName|jurisdictionL
1.3.6.1.4.1.311.60.2.1.2|jurisdictionStateOrProvinceName|jurisdictionST
1.3.6.1.4.1.311.60.2.1.3|jurisdictionCountryName|jurisdictionC
1.3.6.1.4.1.311.20.2|enrollCertTypeExtension (certificateTemplateName)
1.3.6.1.4.1.311.20.2.2|smartcardLogon
1.3.6.1.4.1.311.20.2.3|userPrincipalName (UPN)
1.3.6.1.4.1.311.21.1|caVersion
1.3.6.1.4.1.311.21.7|certificateTemplate
1.3.6.1.4.1.311.21.10|applicationCertPolicies
1.3.6.1.4.1.311.10.3.4|encryptingFileSystem (EFS)
1.3.6.1.4.1.311.10.3.12|documentSigning (Microsoft)
1.3.6.1.4.1.311.2.1.21|msCodeInd (individual code signing)
1.3.6.1.4.1.311.2.1.22|msCodeCom (commercial code signing)
1.2.840.113549.1.1.1|rsaEncryption
1.2.840.113549.1.1.2|md2WithRSAEncryption
1.2.840.113549.1.1.3|md4WithRSAEncryption
1.2.840.113549.1.1.4|md5WithRSAEncryption
1.2.840.113549.1.1.5|sha1WithRSAEncryption
1.2.840.113549.1.1.6|rsaOAEPEncryptionSET
1.2.840.113549.1.1.7|id-RSAES-OAEP
1.2.840.113549.1.1.8|id-mgf1
1.2.840.113549.1.1.9|id-pSpecified
1.2.840.113549.1.1.10|RSASSA-PSS
1.2.840.113549.1.1.11|sha256WithRSAEncryption
1.2.840.113549.1.1.12|sha384WithRSAEncryption
1.2.840.113549.1.1.13|sha512WithRSAEncryption
1.2.840.113549.1.1.14|sha224WithRSAEncryption
1.2.840.113549.1.1.15|sha512-224WithRSAEncryption
1.2.840.113549.1.1.16|sha512-256WithRSAEncryption
1.3.14.3.2.29|sha1WithRSASignature
1.2.840.10045.2.1|id-ecPublicKey
1.2.840.10045.4.1|ecdsa-with-SHA1
1.2.840.10045.4.3.1|ecdsa-with-SHA224
1.2.840.10045.4.3.2|ecdsa-with-SHA256
1.2.840.10045.4.3.3|ecdsa-with-SHA384
1.2.840.10045.4.3.4|ecdsa-with-SHA512
1.2.840.10045.3.1.1|secp192r1 (P-192)
1.2.840.10045.3.1.7|prime256v1 (P-256)
1.3.132.0.33|secp224r1 (P-224)
1.3.132.0.34|secp384r1 (P-384)
1.3.132.0.35|secp521r1 (P-521)
1.3.132.0.10|secp256k1
1.3.132.0.8|secp160r1
1.3.132.0.9|secp160k1
1.3.132.0.30|secp160r2
1.3.132.0.31|secp192k1
1.3.132.0.32|secp224k1
1.3.36.3.3.2.8.1.1.1|brainpoolP160r1
1.3.36.3.3.2.8.1.1.3|brainpoolP192r1
1.3.36.3.3.2.8.1.1.5|brainpoolP224r1
1.3.36.3.3.2.8.1.1.7|brainpoolP256r1
1.3.36.3.3.2.8.1.1.9|brainpoolP320r1
1.3.36.3.3.2.8.1.1.11|brainpoolP384r1
1.3.36.3.3.2.8.1.1.13|brainpoolP512r1
1.3.101.110|X25519
1.3.101.111|X448
1.3.101.112|Ed25519
1.3.101.113|Ed448
1.2.840.10040.4.1|dsa
1.2.840.10040.4.3|dsa-with-sha1
2.16.840.1.101.3.4.3.1|dsa-with-sha224
2.16.840.1.101.3.4.3.2|dsa-with-sha256
2.16.840.1.101.3.4.3.3|dsa-with-sha384
2.16.840.1.101.3.4.3.4|dsa-with-sha512
2.16.840.1.101.3.4.3.9|ecdsa-with-SHA3-224
2.16.840.1.101.3.4.3.10|ecdsa-with-SHA3-256
2.16.840.1.101.3.4.3.11|ecdsa-with-SHA3-384
2.16.840.1.101.3.4.3.12|ecdsa-with-SHA3-512
2.16.840.1.101.3.4.3.13|rsassa-pkcs1-v1_5-with-sha3-224
2.16.840.1.101.3.4.3.14|rsassa-pkcs1-v1_5-with-sha3-256
2.16.840.1.101.3.4.3.15|rsassa-pkcs1-v1_5-with-sha3-384
2.16.840.1.101.3.4.3.16|rsassa-pkcs1-v1_5-with-sha3-512
2.16.840.1.101.3.4.3.17|ML-DSA-44
2.16.840.1.101.3.4.3.18|ML-DSA-65
2.16.840.1.101.3.4.3.19|ML-DSA-87
2.16.840.1.101.3.4.3.20|SLH-DSA-SHA2-128s
1.2.156.10197.1.301|SM2
1.2.156.10197.1.501|SM2-with-SM3
1.2.156.10197.1.401|SM3
1.3.14.3.2.26|sha1
1.2.840.113549.2.2|md2
1.2.840.113549.2.4|md4
1.2.840.113549.2.5|md5
2.16.840.1.101.3.4.2.1|sha256
2.16.840.1.101.3.4.2.2|sha384
2.16.840.1.101.3.4.2.3|sha512
2.16.840.1.101.3.4.2.4|sha224
2.16.840.1.101.3.4.2.5|sha512-224
2.16.840.1.101.3.4.2.6|sha512-256
2.16.840.1.101.3.4.2.7|sha3-224
2.16.840.1.101.3.4.2.8|sha3-256
2.16.840.1.101.3.4.2.9|sha3-384
2.16.840.1.101.3.4.2.10|sha3-512
2.5.29.9|subjectDirectoryAttributes
2.5.29.14|subjectKeyIdentifier
2.5.29.15|keyUsage
2.5.29.16|privateKeyUsagePeriod
2.5.29.17|subjectAltName
2.5.29.18|issuerAltName
2.5.29.19|basicConstraints
2.5.29.20|cRLNumber
2.5.29.21|reasonCode
2.5.29.23|holdInstructionCode
2.5.29.24|invalidityDate
2.5.29.27|deltaCRLIndicator
2.5.29.28|issuingDistributionPoint
2.5.29.29|certificateIssuer
2.5.29.30|nameConstraints
2.5.29.31|cRLDistributionPoints
2.5.29.32|certificatePolicies
2.5.29.32.0|anyPolicy
2.5.29.33|policyMappings
2.5.29.35|authorityKeyIdentifier
2.5.29.36|policyConstraints
2.5.29.37|extendedKeyUsage
2.5.29.37.0|anyExtendedKeyUsage
2.5.29.46|freshestCRL
2.5.29.54|inhibitAnyPolicy
2.5.29.55|targetInformation
1.3.6.1.5.5.7.1.1|authorityInfoAccess
1.3.6.1.5.5.7.1.2|biometricInfo
1.3.6.1.5.5.7.1.3|qcStatements
1.3.6.1.5.5.7.1.11|subjectInfoAccess
1.3.6.1.5.5.7.1.12|logotype
1.3.6.1.5.5.7.1.24|tlsFeature
1.3.6.1.4.1.11129.2.4.2|signedCertificateTimestampList (SCT)
1.3.6.1.4.1.11129.2.4.3|ctPrecertificatePoison
1.3.6.1.4.1.11129.2.4.4|ctPrecertificateSigning
2.16.840.1.113730.1.1|netscapeCertType
2.16.840.1.113730.1.2|netscapeBaseUrl
2.16.840.1.113730.1.4|netscapeCaRevocationUrl
2.16.840.1.113730.1.8|netscapeCaPolicyUrl
2.16.840.1.113730.1.13|netscapeComment
1.3.6.1.5.5.7.48.1|ocsp
1.3.6.1.5.5.7.48.2|caIssuers
1.3.6.1.5.5.7.48.3|timeStamping
1.3.6.1.5.5.7.48.5|caRepository
1.3.6.1.5.5.7.48.1.1|ocspBasic
1.3.6.1.5.5.7.48.1.2|ocspNonce
1.3.6.1.5.5.7.48.1.5|ocspNoCheck
1.3.6.1.5.5.7.3.1|serverAuth
1.3.6.1.5.5.7.3.2|clientAuth
1.3.6.1.5.5.7.3.3|codeSigning
1.3.6.1.5.5.7.3.4|emailProtection
1.3.6.1.5.5.7.3.5|ipsecEndSystem
1.3.6.1.5.5.7.3.6|ipsecTunnel
1.3.6.1.5.5.7.3.7|ipsecUser
1.3.6.1.5.5.7.3.8|timeStamping
1.3.6.1.5.5.7.3.9|OCSPSigning
1.3.6.1.5.5.7.3.17|ipsecIKE
1.3.6.1.5.5.7.3.21|sshClient
1.3.6.1.5.5.7.3.22|sshServer
1.3.6.1.5.5.7.3.36|documentSigning
1.3.6.1.4.1.311.10.3.1|msCTLSign
1.3.6.1.4.1.311.10.3.3|msSGC (Server Gated Crypto)
1.3.6.1.4.1.311.10.3.10|msCertTrustListSigning (qualified subordination)
1.3.6.1.4.1.311.10.3.11|msKeyRecovery
1.3.6.1.4.1.311.10.5.1|msDRM
1.3.6.1.5.2.3.4|pkinit KPClientAuth
1.3.6.1.5.2.3.5|pkinit KPKdc
1.3.6.1.5.2.2|krb5PrincipalName
1.3.6.1.4.1.311.20.2.1|certificateRequestAgent
2.16.840.1.113730.4.1|netscapeServerGatedCrypto
2.23.140.1.1|ev-guidelines (CA/B Forum EV)
2.23.140.1.2.1|domain-validated (DV)
2.23.140.1.2.2|organization-validated (OV)
2.23.140.1.2.3|individual-validated (IV)
2.23.140.1.3|ev-code-signing
2.23.140.1.4.1|code-signing-requirements
2.23.140.1.31|onion-ev (.onion EV)
2.23.140.1.5.1.1|smime-mailbox-validated-legacy
2.23.140.1.5.1.2|smime-mailbox-validated-multipurpose
2.23.140.1.5.1.3|smime-mailbox-validated-strict
2.23.140.1.5.2.1|smime-organization-validated-legacy
2.23.140.1.5.2.2|smime-organization-validated-multipurpose
2.23.140.1.5.2.3|smime-organization-validated-strict
2.23.140.1.5.3.1|smime-sponsor-validated-legacy
2.23.140.1.5.3.2|smime-sponsor-validated-multipurpose
2.23.140.1.5.3.3|smime-sponsor-validated-strict
2.23.140.1.5.4.1|smime-individual-validated-legacy
2.23.140.1.5.4.2|smime-individual-validated-multipurpose
2.23.140.1.5.4.3|smime-individual-validated-strict
2.23.140.2.1|test-certificate (CA/B Forum)
1.3.6.1.5.5.7.2.1|cps (Certification Practice Statement)
1.3.6.1.5.5.7.2.2|userNotice
2.16.840.1.114412.2.1|DigiCert EV policy
2.16.840.1.114412.1.1|DigiCert OV policy
2.16.840.1.114412.1.2|DigiCert DV policy
2.16.840.1.114412.1.3.0.2|DigiCert EV (CPS)
1.3.6.1.4.1.6449.1.2.1.5.1|Sectigo (Comodo) EV policy
1.3.6.1.4.1.6449.1.2.1.3.4|Sectigo (Comodo) OV policy
1.3.6.1.4.1.6449.1.2.2.7|Sectigo (Comodo) DV policy
1.3.6.1.4.1.44947.1.1.1|ISRG (Let's Encrypt) CPS
1.3.6.1.4.1.14370.1.6|GlobalSign policy
1.3.6.1.4.1.4146.1.1|GlobalSign EV policy
2.16.840.1.114413.1.7.23.3|GoDaddy OV policy
2.16.840.1.114414.1.7.23.3|Starfield OV policy
1.3.6.1.4.1.34697.2.1|Certum DV policy
1.2.840.113549.1.7.1|pkcs7-data
1.2.840.113549.1.7.2|pkcs7-signedData
1.2.840.113549.1.7.3|pkcs7-envelopedData
1.2.840.113549.1.12.10.1.1|pkcs12 keyBag
1.2.840.113549.1.12.10.1.2|pkcs12 pkcs8ShroudedKeyBag
1.2.840.113549.1.12.10.1.3|pkcs12 certBag
1.2.840.113549.1.5.12|PBKDF2
1.2.840.113549.1.5.13|PBES2
1.2.840.113549.2.7|hmacWithSHA1
1.2.840.113549.2.9|hmacWithSHA256
2.16.840.1.101.3.4.1.2|aes128-CBC
2.16.840.1.101.3.4.1.42|aes256-CBC
2.16.840.1.101.3.4.1.6|aes128-GCM
2.16.840.1.101.3.4.1.46|aes256-GCM
1.3.6.1.4.1.311.17.1|microsoft localKeyset
1.3.6.1.5.5.7.0.19|id-mod-ocsp
1.3.6.1.5.5.7.6.2|id-alg-dh-sig-hmac-sha1
1.3.6.1.5.5.7.8.5|id-on-xmppAddr
1.3.6.1.5.5.7.8.7|id-on-dnsSRV
1.3.6.1.5.5.7.8.9|id-on-SmtpUTF8Mailbox
1.3.6.1.5.5.7.8.3|id-on-permanentIdentifier
1.3.6.1.5.5.7.4.1|id-it-caProtEncCert
`;

const OID_NAMES = new Map<string, string>();
const OID_SHORT = new Map<string, string>();
for (const line of OID_TABLE.split('\n')) {
  const t = line.trim();
  if (!t) continue;
  const [oid, name, short] = t.split('|');
  OID_NAMES.set(oid, name);
  if (short) OID_SHORT.set(oid, short);
}

export const OID_COUNT = OID_NAMES.size;

/** Tên đọc được của OID, hoặc chính chuỗi OID nếu chưa biết. */
export function oidName(oid: string): string {
  return OID_NAMES.get(oid) ?? oid;
}
export function oidKnown(oid: string): boolean {
  return OID_NAMES.has(oid);
}
export function oidLabel(oid: string): string {
  const n = OID_NAMES.get(oid);
  return n ? `${n} (${oid})` : oid;
}

const CURVE_BITS: Record<string, number> = {
  '1.2.840.10045.3.1.1': 192, '1.2.840.10045.3.1.7': 256, '1.3.132.0.33': 224, '1.3.132.0.34': 384, '1.3.132.0.35': 521,
  '1.3.132.0.10': 256, '1.3.132.0.8': 160, '1.3.132.0.9': 160, '1.3.132.0.30': 160, '1.3.132.0.31': 192, '1.3.132.0.32': 224,
  '1.3.36.3.3.2.8.1.1.1': 160, '1.3.36.3.3.2.8.1.1.3': 192, '1.3.36.3.3.2.8.1.1.5': 224, '1.3.36.3.3.2.8.1.1.7': 256,
  '1.3.36.3.3.2.8.1.1.9': 320, '1.3.36.3.3.2.8.1.1.11': 384, '1.3.36.3.3.2.8.1.1.13': 512,
};

/* ================= Mô tả node (cho cây ASN.1) ================= */

export interface NodeDescription {
  name: string;
  value: string;
}

export function describeNode(n: Asn1Node, b: Uint8Array): NodeDescription {
  const name = tagName(n);
  if (n.constructed) return { name, value: `${n.children?.length ?? 0} phần tử` };
  const c = contentOf(n, b);
  if (n.cls !== 0) {
    const s = c.length > 0 && c.length < 200 && /^[\x20-\x7e]+$/.test(String.fromCharCode(...c)) ? ` "${String.fromCharCode(...c)}"` : '';
    return { name, value: `${c.length} byte${s}` };
  }
  switch (n.tag) {
    case 1:
      return { name, value: c.length === 1 ? (c[0] ? 'TRUE' : 'FALSE') : toHex(c) };
    case 2:
    case 10: {
      if (c.length === 0) return { name, value: '(rỗng)' };
      if (c.length <= 8) return { name, value: bigFromBytes(c, true).toString() + (c.length > 4 ? ` (0x${toHex(c)})` : '') };
      return { name, value: `${c.length * 8} bit · 0x${toHex(c.subarray(0, 24))}${c.length > 24 ? '…' : ''}` };
    }
    case 3: {
      const unused = c[0] ?? 0;
      return { name, value: `${Math.max(0, (c.length - 1) * 8 - unused)} bit` + (n.inner ? ' (chứa DER)' : '') };
    }
    case 4:
      return { name, value: `${c.length} byte` + (n.inner ? ' (chứa DER)' : '') };
    case 5:
      return { name, value: '' };
    case 6:
      return { name, value: oidLabel(decodeOid(c)) };
    case 23:
    case 24: {
      const t = timeFromNode(n, b);
      const raw = decodeStringContent(22, c) ?? '';
      return { name, value: 'ms' in t ? `${raw} → ${new Date(t.ms).toISOString()}` : raw };
    }
    default: {
      const s = decodeStringContent(n.tag, c);
      if (s !== null) return { name, value: JSON.stringify(s.length > 300 ? s.slice(0, 300) + '…' : s) };
      return { name, value: `${c.length} byte` };
    }
  }
}

/* ================= DN (Distinguished Name) ================= */

export interface DnAttr {
  oid: string;
  name: string;
  short: string;
  value: string;
}
export interface Dn {
  /** các RDN theo thứ tự trong DER; mỗi RDN có thể nhiều thuộc tính */
  rdns: DnAttr[][];
  /** chuỗi RFC 4514 (thứ tự đảo, như `CN=...,O=...,C=...`) */
  rfc4514: string;
  /** chuỗi theo thứ tự trong chứng chỉ, dạng `C=VN, O=..., CN=...` */
  ordered: string;
  cn?: string;
  raw: Uint8Array;
}

function escapeRfc4514(v: string): string {
  let s = v.replace(/[\\",+;<>]/g, '\\$&').replace(/\0/g, '\\00');
  if (s.startsWith('#') || s.startsWith(' ')) s = '\\' + s;
  if (s.endsWith(' ') && !s.endsWith('\\ ')) s = s.slice(0, -1) + '\\ ';
  return s;
}

function decodeDn(n: Asn1Node, b: Uint8Array): Dn {
  if (n.cls !== 0 || n.tag !== 16) throw new AsnError('Name không phải SEQUENCE.');
  const rdns: DnAttr[][] = [];
  for (const set of n.children ?? []) {
    if (set.tag !== 17 || !set.children) throw new AsnError('RDN không phải SET.');
    const attrs: DnAttr[] = [];
    for (const atv of set.children) {
      const [o, v] = atv.children ?? [];
      if (!o || !v || o.tag !== 6) throw new AsnError('AttributeTypeAndValue không hợp lệ.');
      const oid = decodeOid(contentOf(o, b));
      let value = v.cls === 0 && !v.constructed ? decodeStringContent(v.tag, contentOf(v, b)) : null;
      const short = OID_SHORT.get(oid) ?? '';
      if (value === null) value = '#' + toHex(rawOf(v, b));
      attrs.push({ oid, name: oidName(oid), short: short || oid, value });
    }
    rdns.push(attrs);
  }
  const fmt = (attrs: DnAttr[]) => attrs.map((a) => `${a.short}=${a.value.startsWith('#') && a.short === a.oid ? a.value : escapeRfc4514(a.value)}`).join('+');
  const rfc4514 = [...rdns].reverse().map(fmt).join(',');
  const ordered = rdns.map(fmt).join(', ');
  const cn = rdns.flat().find((a) => a.oid === '2.5.4.3')?.value;
  return { rdns, rfc4514, ordered, cn, raw: rawOf(n, b) };
}

/* ================= GeneralName ================= */

export interface GeneralName {
  type: string;
  value: string;
}

function ipToString(c: Uint8Array): string {
  if (c.length === 4) return Array.from(c).join('.');
  if (c.length === 16) {
    const g: number[] = [];
    for (let i = 0; i < 16; i += 2) g.push((c[i] << 8) | c[i + 1]);
    let bestS = -1, bestL = 0;
    for (let i = 0; i < 8; ) {
      if (g[i] === 0) {
        let j = i;
        while (j < 8 && g[j] === 0) j++;
        if (j - i > bestL) { bestL = j - i; bestS = i; }
        i = j;
      } else i++;
    }
    if (bestL < 2) return g.map((x) => x.toString(16)).join(':');
    const left = g.slice(0, bestS).map((x) => x.toString(16)).join(':');
    const right = g.slice(bestS + bestL).map((x) => x.toString(16)).join(':');
    return `${left}::${right}`;
  }
  return toHex(c, ':');
}

function maskBits(m: Uint8Array): number {
  let n = 0;
  for (const x of m) n += x.toString(2).split('1').length - 1;
  return n;
}

function decodeGeneralName(n: Asn1Node, b: Uint8Array, isConstraint = false): GeneralName {
  const c = contentOf(n, b);
  if (n.cls !== 2) return { type: 'khác', value: toHex(rawOf(n, b)) };
  const ia5 = () => decodeStringContent(22, c) ?? '';
  switch (n.tag) {
    case 0: {
      const kids = n.children ?? [];
      const oid = kids[0] && kids[0].tag === 6 ? decodeOid(contentOf(kids[0], b)) : '?';
      let val = '';
      const wrap = kids[1];
      const inner = wrap?.children?.[0];
      if (inner) {
        const s = !inner.constructed ? decodeStringContent(inner.tag, contentOf(inner, b)) : null;
        val = s ?? '#' + toHex(rawOf(inner, b));
      }
      return { type: 'otherName', value: `${oidName(oid)}: ${val}` };
    }
    case 1: return { type: 'email', value: ia5() };
    case 2: return { type: 'DNS', value: ia5() };
    case 3: return { type: 'x400Address', value: toHex(c) };
    case 4: {
      const nm = n.children?.[0];
      if (!nm) return { type: 'dirName', value: '' };
      try {
        return { type: 'dirName', value: decodeDn(nm, b).ordered };
      } catch {
        return { type: 'dirName', value: toHex(rawOf(nm, b)) };
      }
    }
    case 5: return { type: 'ediPartyName', value: toHex(c) };
    case 6: return { type: 'URI', value: ia5() };
    case 7: {
      if (isConstraint && (c.length === 8 || c.length === 32)) {
        const h = c.length / 2;
        return { type: 'IP', value: `${ipToString(c.subarray(0, h))}/${maskBits(c.subarray(h))}` };
      }
      return { type: 'IP', value: ipToString(c) };
    }
    case 8: return { type: 'registeredID', value: oidLabel(decodeOid(c)) };
    default: return { type: `[${n.tag}]`, value: toHex(c) };
  }
}

function decodeGeneralNames(n: Asn1Node, b: Uint8Array, isConstraint = false): GeneralName[] {
  return (n.children ?? []).map((k) => decodeGeneralName(k, b, isConstraint));
}

/* ================= Khóa công khai ================= */

export interface KeyInfo {
  algOid: string;
  algName: string;
  kind: 'rsa' | 'ec' | 'ed25519' | 'ed448' | 'x25519' | 'x448' | 'dsa' | 'sm2' | 'other';
  /** độ dài khoá (bit): RSA modulus, EC curve size, Ed25519 = 256 */
  bits?: number;
  exponent?: string;
  curveOid?: string;
  curve?: string;
  pointBytes?: number;
  modulusHex?: string;
  /** mô tả ngắn, vd "RSA 2048 bit" */
  description: string;
  /** SHA-256 của SubjectPublicKeyInfo DER (hex), tính sau */
  spkiDer: Uint8Array;
}

function bitLength(c: Uint8Array): number {
  let i = 0;
  while (i < c.length - 1 && c[i] === 0) i++;
  if (c.length === 0) return 0;
  return (c.length - i - 1) * 8 + (32 - Math.clz32(c[i]));
}

function decodeSpki(n: Asn1Node, b: Uint8Array): KeyInfo {
  const [algNode, bitNode] = n.children ?? [];
  if (!algNode || !bitNode || algNode.tag !== 16 || bitNode.tag !== 3) throw new AsnError('SubjectPublicKeyInfo không hợp lệ.');
  const algOidNode = algNode.children?.[0];
  if (!algOidNode || algOidNode.tag !== 6) throw new AsnError('Thiếu OID thuật toán khóa.');
  const algOid = decodeOid(contentOf(algOidNode, b));
  const algParam = algNode.children?.[1];
  const algName = oidName(algOid);
  const bc = contentOf(bitNode, b);
  const keyBytes = bc.subarray(1);
  const info: KeyInfo = { algOid, algName, kind: 'other', description: algName, spkiDer: rawOf(n, b) };
  if (algOid === '1.2.840.113549.1.1.1' || algOid === '1.2.840.113549.1.1.10') {
    info.kind = 'rsa';
    const r = parseAsn1(b, bitNode.offset + bitNode.hdr + 1, bitNode.offset + bitNode.hdr + bitNode.len);
    const seq = r.ok ? r.value.node : null;
    const nn = seq?.children?.[0];
    const ee = seq?.children?.[1];
    if (seq && nn && ee && nn.tag === 2 && ee.tag === 2) {
      const mod = contentOf(nn, b);
      info.bits = bitLength(mod);
      info.modulusHex = toHex(mod[0] === 0 ? mod.subarray(1) : mod);
      info.exponent = bigFromBytes(contentOf(ee, b), false).toString();
      info.description = `${algOid === '1.2.840.113549.1.1.10' ? 'RSA-PSS' : 'RSA'} ${info.bits} bit (e=${info.exponent})`;
    } else info.description = 'RSA (không đọc được modulus)';
  } else if (algOid === '1.2.840.10045.2.1') {
    info.kind = 'ec';
    if (algParam && algParam.tag === 6) {
      info.curveOid = decodeOid(contentOf(algParam, b));
      info.curve = oidName(info.curveOid);
      info.bits = CURVE_BITS[info.curveOid];
    } else if (algParam) {
      info.curve = 'tham số EC tường minh (không chuẩn)';
    }
    info.pointBytes = keyBytes.length;
    if (!info.bits && keyBytes[0] === 0x04) info.bits = ((keyBytes.length - 1) / 2) * 8;
    info.description = `EC ${info.curve ?? '?'}${info.bits ? ` · ${info.bits} bit` : ''} · điểm ${keyBytes.length} byte${keyBytes[0] === 4 ? ' (không nén)' : keyBytes[0] === 2 || keyBytes[0] === 3 ? ' (nén)' : ''}`;
  } else if (algOid === '1.3.101.112') {
    info.kind = 'ed25519'; info.bits = 256; info.pointBytes = keyBytes.length; info.description = 'Ed25519 · 256 bit';
  } else if (algOid === '1.3.101.113') {
    info.kind = 'ed448'; info.bits = 456; info.pointBytes = keyBytes.length; info.description = 'Ed448 · 456 bit';
  } else if (algOid === '1.3.101.110') {
    info.kind = 'x25519'; info.bits = 256; info.pointBytes = keyBytes.length; info.description = 'X25519 · 256 bit';
  } else if (algOid === '1.3.101.111') {
    info.kind = 'x448'; info.bits = 448; info.pointBytes = keyBytes.length; info.description = 'X448 · 448 bit';
  } else if (algOid === '1.2.840.10040.4.1') {
    info.kind = 'dsa'; info.description = 'DSA';
  } else if (algOid === '1.2.156.10197.1.301') {
    info.kind = 'sm2'; info.description = 'SM2';
  } else {
    info.description = `${algName} · ${keyBytes.length} byte`;
  }
  return info;
}

/* ================= Thuật toán chữ ký ================= */

export interface SigAlg {
  oid: string;
  name: string;
  params?: string;
  /** băm dùng trong chữ ký: sha1, sha256, md5, ... hoặc undefined */
  hash?: string;
}

function hashOfSigName(name: string, oid: string): string | undefined {
  const n = name.toLowerCase();
  if (oid === '1.3.101.112' || oid === '1.3.101.113') return 'sha512'; // EdDSA tự băm
  for (const h of ['md2', 'md4', 'md5', 'sha512-224', 'sha512-256', 'sha3-224', 'sha3-256', 'sha3-384', 'sha3-512', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512']) {
    if (n.includes(h)) return h;
  }
  return undefined;
}

function decodeAlgId(n: Asn1Node, b: Uint8Array): SigAlg {
  const o = n.children?.[0];
  if (n.tag !== 16 || !o || o.tag !== 6) throw new AsnError('AlgorithmIdentifier không hợp lệ.');
  const oid = decodeOid(contentOf(o, b));
  const name = oidName(oid);
  const out: SigAlg = { oid, name, hash: hashOfSigName(name, oid) };
  const p = n.children?.[1];
  if (oid === '1.2.840.113549.1.1.10' && p && p.tag === 16) {
    try {
      let hash = 'sha1', mgf = 'MGF1-sha1', salt = 20;
      for (const k of p.children ?? []) {
        const inner = k.children?.[0];
        if (!inner) continue;
        if (k.tag === 0) hash = oidName(decodeOid(contentOf(inner.children?.[0] ?? inner, b)));
        else if (k.tag === 1) {
          const h2 = inner.children?.[1]?.children?.[0];
          mgf = 'MGF1-' + (h2 ? oidName(decodeOid(contentOf(h2, b))) : 'sha1');
        } else if (k.tag === 2) salt = Number(bigFromBytes(contentOf(inner, b), false));
      }
      out.hash = hash;
      out.params = `hash=${hash}, ${mgf}, saltLength=${salt}`;
    } catch {
      out.params = '(không đọc được tham số PSS)';
    }
  }
  return out;
}

/* ================= Extensions ================= */

export interface ExtInfo {
  oid: string;
  name: string;
  critical: boolean;
  /** hex của extnValue (nội dung OCTET STRING) */
  valueHex: string;
  /** các dòng mô tả giá trị đã giải mã */
  lines: string[];
  error?: string;
}

export interface CertPolicy {
  oid: string;
  name: string;
  qualifiers: string[];
}

export interface BasicConstraints {
  ca: boolean;
  pathLen?: number;
}

export interface ExtSummary {
  san: GeneralName[];
  ian: GeneralName[];
  keyUsage?: string[];
  eku?: { oid: string; name: string }[];
  basicConstraints?: BasicConstraints;
  ski?: string;
  aki?: { keyId?: string; issuer?: string; serial?: string };
  aia: { method: string; type: string; value: string }[];
  crlDp: string[];
  policies: CertPolicy[];
  nameConstraints?: { permitted: GeneralName[]; excluded: GeneralName[] };
  sctCount?: number;
  mustStaple: boolean;
  requestedExts?: ExtInfo[];
}

const KU_NAMES = ['digitalSignature', 'nonRepudiation', 'keyEncipherment', 'dataEncipherment', 'keyAgreement', 'keyCertSign', 'cRLSign', 'encipherOnly', 'decipherOnly'];
const NS_NAMES = ['sslClient', 'sslServer', 'email', 'objsign', 'reserved', 'sslCA', 'emailCA', 'objCA'];

function bitStringBits(c: Uint8Array, names: string[]): string[] {
  const out: string[] = [];
  const unused = c[0] ?? 0;
  const total = (c.length - 1) * 8 - unused;
  for (let i = 0; i < Math.min(total, names.length); i++) {
    if (c[1 + (i >> 3)] & (0x80 >> (i & 7))) out.push(names[i]);
  }
  return out;
}

function ifNode(n: Asn1Node | undefined, what: string): Asn1Node {
  if (!n) throw new AsnError(`Thiếu ${what}.`);
  return n;
}

function decodeExtensionValue(oid: string, root: Asn1Node, b: Uint8Array, sum: ExtSummary): string[] {
  const lines: string[] = [];
  const gnLines = (gns: GeneralName[]) => gns.forEach((g) => lines.push(`${g.type}: ${g.value}`));
  switch (oid) {
    case '2.5.29.17':
    case '2.5.29.18': {
      const gns = decodeGeneralNames(root, b);
      (oid === '2.5.29.17' ? sum.san : sum.ian).push(...gns);
      gnLines(gns);
      break;
    }
    case '2.5.29.15': {
      const bits = bitStringBits(contentOf(ifNode(root, 'BIT STRING'), b), KU_NAMES);
      sum.keyUsage = bits;
      lines.push(bits.length ? bits.join(', ') : '(không có bit nào được đặt)');
      break;
    }
    case '2.5.29.37': {
      const list = (root.children ?? []).map((k) => {
        const o = decodeOid(contentOf(k, b));
        return { oid: o, name: oidName(o) };
      });
      sum.eku = list;
      list.forEach((e) => lines.push(e.name === e.oid ? e.oid : `${e.name} (${e.oid})`));
      break;
    }
    case '2.5.29.19': {
      const bc: BasicConstraints = { ca: false };
      for (const k of root.children ?? []) {
        const c = contentOf(k, b);
        if (k.tag === 1) bc.ca = c[0] !== 0;
        else if (k.tag === 2) bc.pathLen = Number(bigFromBytes(c, true));
      }
      sum.basicConstraints = bc;
      lines.push(`CA: ${bc.ca ? 'TRUE' : 'FALSE'}`);
      if (bc.pathLen !== undefined) lines.push(`pathLenConstraint: ${bc.pathLen}`);
      break;
    }
    case '2.5.29.14': {
      const c = contentOf(root, b);
      sum.ski = toHex(c, ':').toUpperCase();
      lines.push(sum.ski);
      break;
    }
    case '2.5.29.35': {
      const aki: NonNullable<ExtSummary['aki']> = {};
      for (const k of root.children ?? []) {
        if (k.tag === 0) aki.keyId = toHex(contentOf(k, b), ':').toUpperCase();
        else if (k.tag === 1) aki.issuer = decodeGeneralNames(k, b).map((g) => `${g.type}: ${g.value}`).join('; ');
        else if (k.tag === 2) aki.serial = toHex(contentOf(k, b), ':').toUpperCase();
      }
      sum.aki = aki;
      if (aki.keyId) lines.push(`keyid: ${aki.keyId}`);
      if (aki.issuer) lines.push(`issuer: ${aki.issuer}`);
      if (aki.serial) lines.push(`serial: ${aki.serial}`);
      break;
    }
    case '2.5.29.31':
    case '2.5.29.46': {
      for (const dp of root.children ?? []) {
        for (const k of dp.children ?? []) {
          if (k.tag === 0) {
            const full = k.children?.[0];
            if (full && full.tag === 0) {
              for (const g of decodeGeneralNames(full, b)) {
                lines.push(`${g.type}: ${g.value}`);
                if (oid === '2.5.29.31') sum.crlDp.push(g.value);
              }
            } else lines.push('relativeName');
          } else if (k.tag === 1) lines.push('reasons: ' + toHex(contentOf(k, b)));
          else if (k.tag === 2) lines.push('cRLIssuer: ' + decodeGeneralNames(k, b).map((g) => g.value).join('; '));
        }
      }
      break;
    }
    case '1.3.6.1.5.5.7.1.1':
    case '1.3.6.1.5.5.7.1.11': {
      for (const ad of root.children ?? []) {
        const [o, loc] = ad.children ?? [];
        if (!o || !loc) continue;
        const method = decodeOid(contentOf(o, b));
        const g = decodeGeneralName(loc, b);
        lines.push(`${oidName(method)}: ${g.type}:${g.value}`);
        if (oid === '1.3.6.1.5.5.7.1.1') sum.aia.push({ method: oidName(method), type: g.type, value: g.value });
      }
      break;
    }
    case '2.5.29.32': {
      for (const pi of root.children ?? []) {
        const o = pi.children?.[0];
        if (!o) continue;
        const poid = decodeOid(contentOf(o, b));
        const quals: string[] = [];
        for (const q of pi.children?.[1]?.children ?? []) {
          const qo = q.children?.[0];
          const qv = q.children?.[1];
          if (!qo) continue;
          const qid = decodeOid(contentOf(qo, b));
          if (qid === '1.3.6.1.5.5.7.2.1' && qv) quals.push(`CPS: ${decodeStringContent(22, contentOf(qv, b)) ?? ''}`);
          else if (qid === '1.3.6.1.5.5.7.2.2' && qv) {
            const txt = (qv.children ?? []).map((x) => (x.children ? '' : decodeStringContent(x.tag, contentOf(x, b)) ?? '')).filter(Boolean).join(' ');
            quals.push(`UserNotice${txt ? ': ' + txt : ''}`);
          } else quals.push(oidName(qid));
        }
        sum.policies.push({ oid: poid, name: oidName(poid), qualifiers: quals });
        lines.push(poid === oidName(poid) ? `Policy: ${poid}` : `Policy: ${oidName(poid)} (${poid})`);
        quals.forEach((q) => lines.push('  ' + q));
      }
      break;
    }
    case '2.5.29.30': {
      const nc = { permitted: [] as GeneralName[], excluded: [] as GeneralName[] };
      for (const k of root.children ?? []) {
        const target = k.tag === 0 ? nc.permitted : k.tag === 1 ? nc.excluded : null;
        if (!target) continue;
        for (const st of k.children ?? []) {
          const g = st.children?.[0];
          if (g) target.push(decodeGeneralName(g, b, true));
        }
      }
      sum.nameConstraints = nc;
      nc.permitted.forEach((g) => lines.push(`Permitted ${g.type}: ${g.value}`));
      nc.excluded.forEach((g) => lines.push(`Excluded ${g.type}: ${g.value}`));
      break;
    }
    case '1.3.6.1.4.1.11129.2.4.2': {
      // OCTET STRING { TLS-encoded SignedCertificateTimestampList }
      const inner = contentOf(root, b);
      if (inner.length < 2) throw new AsnError('SCT list rỗng.');
      const total = (inner[0] << 8) | inner[1];
      let p = 2;
      let count = 0;
      while (p + 2 <= inner.length && p < 2 + total && count < 64) {
        const l = (inner[p] << 8) | inner[p + 1];
        p += 2;
        if (p + l > inner.length) break;
        const sct = inner.subarray(p, p + l);
        if (sct.length >= 41) {
          const ts = Number(bigFromBytes(sct.subarray(33, 41), false));
          lines.push(`SCT #${count + 1}: v${sct[0] + 1}, log ${toHex(sct.subarray(1, 9))}…, thời gian ${new Date(ts).toISOString()}`);
        } else lines.push(`SCT #${count + 1}: ${sct.length} byte`);
        p += l;
        count++;
      }
      sum.sctCount = count;
      lines.unshift(`${count} Signed Certificate Timestamp (Certificate Transparency)`);
      break;
    }
    case '1.3.6.1.4.1.11129.2.4.3':
      lines.push('Precertificate poison (chứng chỉ tiền phát hành CT, không dùng được trực tiếp)');
      break;
    case '1.3.6.1.5.5.7.1.24': {
      const feats = (root.children ?? []).map((k) => Number(bigFromBytes(contentOf(k, b), true)));
      if (feats.includes(5)) sum.mustStaple = true;
      lines.push(feats.map((f) => (f === 5 ? 'status_request (OCSP Must-Staple)' : f === 17 ? 'status_request_v2' : String(f))).join(', '));
      break;
    }
    case '2.5.29.54':
      lines.push('skipCerts: ' + bigFromBytes(contentOf(root, b), true).toString());
      break;
    case '2.5.29.36':
      for (const k of root.children ?? []) lines.push(`${k.tag === 0 ? 'requireExplicitPolicy' : 'inhibitPolicyMapping'}: ${bigFromBytes(contentOf(k, b), true)}`);
      break;
    case '2.16.840.1.113730.1.1':
      lines.push(bitStringBits(contentOf(root, b), NS_NAMES).join(', '));
      break;
    case '2.16.840.1.113730.1.13':
      lines.push(decodeStringContent(22, contentOf(root, b)) ?? '');
      break;
    case '1.3.6.1.4.1.311.20.2':
      lines.push(decodeStringContent(root.tag === 30 ? 30 : root.tag, contentOf(root, b)) ?? '');
      break;
    case '1.3.6.1.4.1.311.21.7': {
      const o = root.children?.[0];
      if (o) lines.push('Template: ' + oidLabel(decodeOid(contentOf(o, b))));
      break;
    }
    case '2.5.29.16':
      lines.push('privateKeyUsagePeriod (xem Raw)');
      break;
    default:
      lines.push('(chưa giải mã chi tiết — xem hex hoặc cây ASN.1)');
  }
  return lines;
}

function decodeExtensionList(listNode: Asn1Node, b: Uint8Array, sum: ExtSummary): ExtInfo[] {
  const out: ExtInfo[] = [];
  for (const e of listNode.children ?? []) {
    const kids = e.children ?? [];
    const oidNode = kids[0];
    if (e.tag !== 16 || !oidNode || oidNode.tag !== 6) {
      out.push({ oid: '?', name: '(extension hỏng)', critical: false, valueHex: '', lines: [], error: 'Extension không đúng cấu trúc SEQUENCE { OID, [BOOLEAN], OCTET STRING }.' });
      continue;
    }
    const oid = decodeOid(contentOf(oidNode, b));
    let critical = false;
    let valNode = kids[1];
    if (valNode && valNode.tag === 1) {
      critical = contentOf(valNode, b)[0] !== 0;
      valNode = kids[2];
    }
    const info: ExtInfo = { oid, name: oidName(oid), critical, valueHex: '', lines: [] };
    if (!valNode || valNode.tag !== 4) {
      info.error = 'Thiếu extnValue (OCTET STRING).';
      out.push(info);
      continue;
    }
    const vc = contentOf(valNode, b);
    info.valueHex = toHex(vc);
    const vStart = valNode.offset + valNode.hdr;
    try {
      const r = parseAsn1(b, vStart, vStart + valNode.len);
      if (!r.ok) throw new AsnError(r.error);
      info.lines = decodeExtensionValue(oid, r.value.node, b, sum);
    } catch (err) {
      info.error = 'Không giải mã được giá trị: ' + (err instanceof AsnError ? err.message : 'dữ liệu không hợp lệ');
    }
    out.push(info);
  }
  return out;
}

function emptySummary(): ExtSummary {
  return { san: [], ian: [], aia: [], crlDp: [], policies: [], mustStaple: false };
}

/* ================= Chứng chỉ ================= */

export interface CertInfo {
  kind: 'certificate';
  /** 1, 2 hoặc 3 */
  version: number;
  serialHex: string;
  serialDec?: string;
  sigAlg: SigAlg;
  /** SigAlg lặp lại trong TBS (phải trùng) */
  issuer: Dn;
  subject: Dn;
  notBefore: number;
  notAfter: number;
  key: KeyInfo;
  extensions: ExtInfo[];
  ext: ExtSummary;
  selfSigned: boolean;
  isCA: boolean;
  signatureHex: string;
  signatureBits: number;
  issuerUniqueId: boolean;
  subjectUniqueId: boolean;
  der: Uint8Array;
  tree: Asn1Node;
  notes: string[];
}

export interface CsrInfo {
  kind: 'csr';
  version: number;
  subject: Dn;
  key: KeyInfo;
  sigAlg: SigAlg;
  attributes: { oid: string; name: string; values: string[] }[];
  ext: ExtSummary;
  extensions: ExtInfo[];
  signatureHex: string;
  signatureBits: number;
  der: Uint8Array;
  tree: Asn1Node;
  notes: string[];
}

function decodeSerial(c: Uint8Array): { hex: string; dec?: string; negative: boolean } {
  const negative = c.length > 0 && (c[0] & 0x80) !== 0;
  let m = c;
  while (m.length > 1 && m[0] === 0) m = m.subarray(1);
  const hex = toHex(m).toUpperCase();
  return { hex: hex || '00', dec: m.length <= 16 ? bigFromBytes(c, false).toString() : undefined, negative };
}

function bitStringHex(n: Asn1Node | undefined, b: Uint8Array): { hex: string; bits: number } {
  if (!n || n.tag !== 3) return { hex: '', bits: 0 };
  const c = contentOf(n, b);
  return { hex: toHex(c.subarray(1)), bits: Math.max(0, (c.length - 1) * 8 - (c[0] ?? 0)) };
}

export function decodeCertificate(der: Uint8Array): Result<CertInfo> {
  const parsed = parseAsn1(der);
  if (!parsed.ok) return parsed;
  try {
    const root = parsed.value.node;
    const notes: string[] = [];
    if (parsed.value.trailing > 0) notes.push(`Có ${parsed.value.trailing} byte thừa sau chứng chỉ (bỏ qua).`);
    if (root.tag !== 16 || (root.children?.length ?? 0) !== 3) throw new AsnError('Không phải chứng chỉ X.509: cần SEQUENCE gồm 3 phần (tbsCertificate, thuật toán, chữ ký).');
    const [tbs, outerAlg, sigNode] = root.children!;
    if (tbs.tag !== 16 || !tbs.children) throw new AsnError('tbsCertificate không phải SEQUENCE.');
    const f = tbs.children;
    let i = 0;
    let version = 1;
    if (f[0]?.cls === 2 && f[0].tag === 0) {
      const v = f[0].children?.[0];
      if (!v || v.tag !== 2) throw new AsnError('Trường version không hợp lệ.');
      version = Number(bigFromBytes(contentOf(v, der), true)) + 1;
      i = 1;
    }
    if (version < 1 || version > 3) notes.push(`Phiên bản X.509 lạ: v${version}.`);
    const serialNode = f[i++];
    if (!serialNode || serialNode.tag !== 2) throw new AsnError('Thiếu số serial.');
    const serial = decodeSerial(contentOf(serialNode, der));
    if (serial.negative) notes.push('Serial là số âm (vi phạm RFC 5280).');
    const sigAlg = decodeAlgId(ifNode(f[i++], 'thuật toán chữ ký'), der);
    const outer = decodeAlgId(outerAlg, der);
    if (outer.oid !== sigAlg.oid) notes.push('Thuật toán chữ ký trong TBS khác với bên ngoài (chứng chỉ không nhất quán).');
    const issuer = decodeDn(ifNode(f[i++], 'issuer'), der);
    const validity = ifNode(f[i++], 'validity');
    if (validity.tag !== 16 || (validity.children?.length ?? 0) !== 2) throw new AsnError('Validity không hợp lệ.');
    const nb = timeFromNode(validity.children![0], der);
    const na = timeFromNode(validity.children![1], der);
    if ('error' in nb) throw new AsnError('notBefore: ' + nb.error);
    if ('error' in na) throw new AsnError('notAfter: ' + na.error);
    const subject = decodeDn(ifNode(f[i++], 'subject'), der);
    const key = decodeSpki(ifNode(f[i++], 'SubjectPublicKeyInfo'), der);
    let issuerUniqueId = false, subjectUniqueId = false;
    const ext = emptySummary();
    let extensions: ExtInfo[] = [];
    for (; i < f.length; i++) {
      const k = f[i];
      if (k.cls !== 2) continue;
      if (k.tag === 1) issuerUniqueId = true;
      else if (k.tag === 2) subjectUniqueId = true;
      else if (k.tag === 3) {
        const list = k.children?.[0];
        if (list) extensions = decodeExtensionList(list, der, ext);
      }
    }
    if (version < 3 && extensions.length) notes.push('Chứng chỉ không phải v3 nhưng có extension.');
    const sig = bitStringHex(sigNode, der);
    const selfSigned = bytesEqual(issuer.raw, subject.raw);
    const isCA = ext.basicConstraints ? ext.basicConstraints.ca : false;
    return {
      ok: true,
      value: {
        kind: 'certificate', version, serialHex: serial.hex, serialDec: serial.dec, sigAlg, issuer, subject,
        notBefore: nb.ms, notAfter: na.ms, key, extensions, ext, selfSigned, isCA,
        signatureHex: sig.hex, signatureBits: sig.bits, issuerUniqueId, subjectUniqueId, der, tree: root, notes,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof AsnError ? e.message : 'Không phải chứng chỉ X.509 hợp lệ.' };
  }
}

export function decodeCsr(der: Uint8Array): Result<CsrInfo> {
  const parsed = parseAsn1(der);
  if (!parsed.ok) return parsed;
  try {
    const root = parsed.value.node;
    const notes: string[] = [];
    if (parsed.value.trailing > 0) notes.push(`Có ${parsed.value.trailing} byte thừa sau CSR (bỏ qua).`);
    if (root.tag !== 16 || (root.children?.length ?? 0) !== 3) throw new AsnError('Không phải CSR PKCS#10: cần SEQUENCE gồm 3 phần (certificationRequestInfo, thuật toán, chữ ký).');
    const [info, algNode, sigNode] = root.children!;
    const f = info.children ?? [];
    if (info.tag !== 16 || f.length < 3 || f[0].tag !== 2) throw new AsnError('certificationRequestInfo không hợp lệ.');
    const version = Number(bigFromBytes(contentOf(f[0], der), true)) + 1;
    const subject = decodeDn(f[1], der);
    const key = decodeSpki(f[2], der);
    const sigAlg = decodeAlgId(algNode, der);
    const ext = emptySummary();
    let extensions: ExtInfo[] = [];
    const attributes: CsrInfo['attributes'] = [];
    const attrs = f[3];
    if (attrs && attrs.cls === 2 && attrs.tag === 0) {
      for (const a of attrs.children ?? []) {
        const o = a.children?.[0];
        const set = a.children?.[1];
        if (!o || o.tag !== 6) continue;
        const oid = decodeOid(contentOf(o, der));
        const values: string[] = [];
        for (const v of set?.children ?? []) {
          if (oid === '1.2.840.113549.1.9.14') {
            extensions = extensions.concat(decodeExtensionList(v, der, ext));
            values.push(`${v.children?.length ?? 0} extension`);
          } else if (!v.constructed) {
            values.push(decodeStringContent(v.tag, contentOf(v, der)) ?? describeNode(v, der).value);
          } else values.push(describeNode(v, der).value);
        }
        attributes.push({ oid, name: oidName(oid), values });
      }
    }
    const sig = bitStringHex(sigNode, der);
    return { ok: true, value: { kind: 'csr', version, subject, key, sigAlg, attributes, ext, extensions, signatureHex: sig.hex, signatureBits: sig.bits, der, tree: root, notes } };
  } catch (e) {
    return { ok: false, error: e instanceof AsnError ? e.message : 'Không phải CSR PKCS#10 hợp lệ.' };
  }
}

/* ================= Trạng thái hiệu lực, vân tay ================= */

export interface ValidityStatus {
  state: 'valid' | 'not_yet' | 'expired';
  /** số ngày còn lại (âm nếu đã hết hạn / dương tới ngày bắt đầu nếu chưa hiệu lực) */
  daysRemaining: number;
  lifetimeDays: number;
  /** vị trí 'hôm nay' trên thanh 0..1 (có thể ngoài khoảng) */
  position: number;
}

const DAY = 86400000;

export function validityStatus(c: Pick<CertInfo, 'notBefore' | 'notAfter'>, now: number): ValidityStatus {
  const lifetimeDays = (c.notAfter - c.notBefore) / DAY;
  const span = c.notAfter - c.notBefore;
  const position = span > 0 ? (now - c.notBefore) / span : now >= c.notBefore ? 1 : 0;
  if (now < c.notBefore) return { state: 'not_yet', daysRemaining: Math.ceil((c.notBefore - now) / DAY), lifetimeDays, position };
  if (now > c.notAfter) return { state: 'expired', daysRemaining: -Math.floor((now - c.notAfter) / DAY), lifetimeDays, position };
  return { state: 'valid', daysRemaining: Math.floor((c.notAfter - now) / DAY), lifetimeDays, position };
}

export function formatDuration(days: number): string {
  const d = Math.round(Math.abs(days));
  if (d >= 730) {
    const y = Math.floor(d / 365);
    const m = Math.round((d - y * 365) / 30);
    return `${y} năm${m > 0 ? ` ${m} tháng` : ''}`;
  }
  if (d >= 60) return `${Math.round(d / 30)} tháng (${d} ngày)`;
  return `${d} ngày`;
}

async function digest(alg: 'SHA-1' | 'SHA-256', data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const copy = new Uint8Array(data.length);
    copy.set(data);
    return new Uint8Array(await subtle.digest(alg, copy));
  } catch {
    return null;
  }
}

export interface Fingerprints {
  sha1: string;
  sha256: string;
  /** SHA-256 của SPKI, base64 (dạng pin-sha256 của HPKP) */
  spkiPin: string;
  spkiSha256Hex: string;
}

export async function computeFingerprints(der: Uint8Array, spki: Uint8Array): Promise<Fingerprints> {
  const [s1, s256, sp] = await Promise.all([digest('SHA-1', der), digest('SHA-256', der), digest('SHA-256', spki)]);
  return {
    sha1: s1 ? toHex(s1, ':').toUpperCase() : 'không khả dụng',
    sha256: s256 ? toHex(s256, ':').toUpperCase() : 'không khả dụng',
    spkiPin: sp ? toBase64(sp) : 'không khả dụng',
    spkiSha256Hex: sp ? toHex(sp, ':').toUpperCase() : 'không khả dụng',
  };
}

/* ================= Phân tích cảnh báo & chuỗi ================= */

export type Severity = 'error' | 'warning' | 'info';
export interface Finding {
  severity: Severity;
  message: string;
}

const TLS_MAX_DAYS = 398;

function isTlsLeaf(c: CertInfo): boolean {
  if (c.isCA || c.selfSigned) return false;
  if (c.ext.eku && c.ext.eku.length > 0) return c.ext.eku.some((e) => e.oid === '1.3.6.1.5.5.7.3.1' || e.oid === '2.5.29.37.0');
  return c.ext.san.length > 0;
}

export function keyFindings(key: KeyInfo): Finding[] {
  const out: Finding[] = [];
  if (key.kind === 'rsa' && key.bits !== undefined && key.bits < 2048) {
    out.push({ severity: 'error', message: `Khóa RSA ${key.bits} bit quá yếu (khuyến nghị tối thiểu 2048 bit).` });
  }
  if (key.kind === 'ec' && key.bits !== undefined && key.bits < 224) {
    out.push({ severity: 'error', message: `Đường cong EC ${key.curve ?? ''} (${key.bits} bit) quá yếu.` });
  }
  if (key.kind === 'dsa') out.push({ severity: 'warning', message: 'Khóa DSA đã lỗi thời, trình duyệt hiện đại không chấp nhận.' });
  return out;
}

/** Cảnh báo cho riêng một chứng chỉ (không xét chuỗi). */
export function certFindings(c: CertInfo, now: number): Finding[] {
  const out: Finding[] = [];
  const v = validityStatus(c, now);
  if (v.state === 'expired') out.push({ severity: 'error', message: `Chứng chỉ đã hết hạn ${-v.daysRemaining} ngày trước.` });
  else if (v.state === 'not_yet') out.push({ severity: 'warning', message: `Chứng chỉ chưa có hiệu lực (còn ${v.daysRemaining} ngày nữa).` });
  else if (v.daysRemaining <= 30) out.push({ severity: 'warning', message: `Chứng chỉ sắp hết hạn: còn ${v.daysRemaining} ngày.` });
  out.push(...keyFindings(c.key));
  const h = c.sigAlg.hash;
  if (h === 'md2' || h === 'md4' || h === 'md5') out.push({ severity: 'error', message: `Chữ ký dùng ${h.toUpperCase()} — không an toàn.` });
  else if (h === 'sha1') {
    out.push({ severity: c.selfSigned ? 'info' : 'error', message: c.selfSigned ? 'Chữ ký SHA-1 trên chứng chỉ tự ký (root); ít ảnh hưởng vì root được tin cậy trực tiếp.' : 'Chữ ký SHA-1 — không còn được trình duyệt chấp nhận.' });
  }
  if (isTlsLeaf(c)) {
    if (v.lifetimeDays > TLS_MAX_DAYS + 1 && c.notBefore >= Date.UTC(2020, 8, 1)) {
      out.push({ severity: 'warning', message: `Thời hạn ${Math.round(v.lifetimeDays)} ngày vượt mức tối đa ${TLS_MAX_DAYS} ngày của chứng chỉ TLS theo chuẩn CA/B Forum (cảnh báo theo chuẩn CA/B Forum; chứng chỉ riêng/nội bộ có thể bỏ qua).` });
    }
    if (c.ext.san.length === 0) out.push({ severity: 'warning', message: 'Chứng chỉ TLS không có Subject Alternative Name — trình duyệt hiện đại bỏ qua CN.' });
  }
  if (c.version === 3 && c.ext.basicConstraints?.ca && c.ext.keyUsage && !c.ext.keyUsage.includes('keyCertSign')) {
    out.push({ severity: 'warning', message: 'CA nhưng KeyUsage không có keyCertSign.' });
  }
  for (const e of c.extensions) if (e.error) out.push({ severity: 'warning', message: `Extension ${e.name}: ${e.error}` });
  for (const n of c.notes) out.push({ severity: 'info', message: n });
  return out;
}

export function csrFindings(c: CsrInfo): Finding[] {
  const out = keyFindings(c.key);
  const h = c.sigAlg.hash;
  if (h === 'md2' || h === 'md4' || h === 'md5' || h === 'sha1') out.push({ severity: 'error', message: `Chữ ký CSR dùng ${h.toUpperCase()} — CA sẽ từ chối.` });
  if (c.ext.san.length === 0) out.push({ severity: 'info', message: 'CSR không yêu cầu SAN; CA thường tự thêm từ CN hoặc yêu cầu bổ sung.' });
  for (const n of c.notes) out.push({ severity: 'info', message: n });
  return out;
}

export type ChainRole = 'leaf' | 'intermediate' | 'root';

export interface ChainEntry {
  index: number;
  role: ChainRole;
  /** chỉ số chứng chỉ phát hành (issuer) trong danh sách, -1 nếu không có */
  issuerIndex: number;
  findings: Finding[];
}

export interface ChainAnalysis {
  entries: ChainEntry[];
  chainFindings: Finding[];
  /** thứ tự đề xuất (leaf -> root) theo chỉ số */
  suggestedOrder: number[];
  orderOk: boolean;
}

function findIssuer(certs: CertInfo[], i: number): number {
  const c = certs[i];
  let fallback = -1;
  for (let j = 0; j < certs.length; j++) {
    if (j === i) continue;
    const cand = certs[j];
    if (!bytesEqual(cand.subject.raw, c.issuer.raw)) continue;
    const akiId = c.ext.aki?.keyId;
    if (akiId && cand.ext.ski) {
      if (akiId === cand.ext.ski) return j;
      continue; // cùng tên nhưng khác khoá
    }
    if (fallback < 0) fallback = j;
  }
  return fallback;
}

export function analyzeChain(certs: CertInfo[], now: number): ChainAnalysis {
  const n = certs.length;
  const issuerIdx = certs.map((_, i) => (certs[i].selfSigned ? -1 : findIssuer(certs, i)));
  const isIssuerOfOther = certs.map((_, i) => issuerIdx.some((x) => x === i));
  const entries: ChainEntry[] = certs.map((c, i) => {
    const role: ChainRole = c.selfSigned ? 'root' : isIssuerOfOther[i] || (c.isCA && n > 1) ? 'intermediate' : 'leaf';
    return { index: i, role, issuerIndex: issuerIdx[i], findings: certFindings(c, now) };
  });
  const chain: Finding[] = [];
  if (n < 2) return { entries, chainFindings: chain, suggestedOrder: certs.map((_, i) => i), orderOk: true };

  const label = (i: number) => `#${i + 1} (${certs[i].subject.cn ?? certs[i].subject.ordered ?? '?'})`;
  // thứ tự đề xuất: bắt đầu từ leaf, đi theo issuer
  const used = new Set<number>();
  const order: number[] = [];
  const starts = entries.filter((e) => e.role === 'leaf').map((e) => e.index);
  const queue = starts.length ? starts : [0];
  for (const s of queue) {
    let cur = s;
    while (cur >= 0 && !used.has(cur)) {
      used.add(cur);
      order.push(cur);
      cur = issuerIdx[cur];
    }
  }
  for (let i = 0; i < n; i++) if (!used.has(i)) order.push(i);

  if (starts.length > 1) chain.push({ severity: 'warning', message: `Có ${starts.length} chứng chỉ lá không phát hành cho nhau — dữ liệu có thể gồm nhiều chuỗi khác nhau: ${starts.map((s) => label(s)).join(', ')}.` });

  let orderOk = true;
  for (let i = 0; i < n; i++) {
    const j = issuerIdx[i];
    if (j >= 0 && j !== i + 1) {
      orderOk = false;
      chain.push({ severity: 'warning', message: `Thứ tự chưa đúng: issuer của ${label(i)} là ${label(j)}, nhưng nó nằm ở vị trí ${j + 1} thay vì ${i + 2}. Thứ tự chuẩn của TLS: leaf → intermediate → (root).` });
    } else if (j < 0 && !certs[i].selfSigned) {
      const isLast = i === n - 1 || order[order.length - 1] === i;
      chain.push({
        severity: isLast && certs[i].isCA ? 'info' : 'warning',
        message: isLast && certs[i].isCA
          ? `Không có chứng chỉ của issuer cho ${label(i)} — chuỗi kết thúc ở intermediate (root thường được bỏ qua vì client đã có sẵn).`
          : `Thiếu chứng chỉ phát hành cho ${label(i)} (issuer: ${certs[i].issuer.ordered}) — có thể thiếu intermediate.`,
      });
    }
    if (j >= 0) {
      const iss = certs[j];
      if (!iss.isCA) chain.push({ severity: 'error', message: `${label(j)} phát hành cho ${label(i)} nhưng không có BasicConstraints CA:TRUE.` });
      else if (iss.ext.keyUsage && !iss.ext.keyUsage.includes('keyCertSign')) chain.push({ severity: 'warning', message: `${label(j)} thiếu KeyUsage keyCertSign nhưng được dùng để ký ${label(i)}.` });
      if (certs[i].notAfter > iss.notAfter) chain.push({ severity: 'info', message: `${label(i)} hết hạn sau issuer ${label(j)} — chuỗi sẽ hết hiệu lực khi issuer hết hạn.` });
    }
  }
  const caBelow = (j: number, guard: number): number => {
    if (guard > n) return 0;
    let best = 0;
    for (let k = 0; k < n; k++) if (issuerIdx[k] === j) best = Math.max(best, certs[k].isCA ? 1 + caBelow(k, guard + 1) : 0);
    return best;
  };
  for (let j = 0; j < n; j++) {
    const pl = certs[j].ext.basicConstraints?.pathLen;
    if (pl !== undefined && caBelow(j, 0) > pl) chain.push({ severity: 'error', message: `${label(j)} có pathLenConstraint=${pl} nhưng bên dưới có nhiều CA trung gian hơn mức cho phép.` });
  }
  if (!certs.some((c) => c.selfSigned)) chain.push({ severity: 'info', message: 'Không có chứng chỉ gốc (root) trong dữ liệu — client cần có root trong kho tin cậy.' });
  return { entries, chainFindings: chain, suggestedOrder: order, orderOk };
}

/* ================= Nhận dữ liệu đầu vào (PEM / base64 / hex / DER) ================= */

export type LoadedItem =
  | { ok: true; kind: 'certificate'; label: string; cert: CertInfo }
  | { ok: true; kind: 'csr'; label: string; csr: CsrInfo }
  | { ok: false; label: string; error: string };

export interface LoadResult {
  items: LoadedItem[];
  /** thông báo chung (vd. bỏ qua khối khóa riêng) */
  notes: string[];
}

const CERT_LABELS = ['CERTIFICATE', 'TRUSTED CERTIFICATE', 'X509 CERTIFICATE', 'X.509 CERTIFICATE'];
const CSR_LABELS = ['CERTIFICATE REQUEST', 'NEW CERTIFICATE REQUEST', 'X509 CERTIFICATE REQUEST'];
const MAX_ITEMS = 100;

interface RawBlock {
  label: string;
  der: Uint8Array | null;
  error?: string;
}

function extractPemBlocks(text: string, notes: string[]): RawBlock[] {
  const blocks: RawBlock[] = [];
  let pos = 0;
  for (;;) {
    const bi = text.indexOf('-----BEGIN ', pos);
    if (bi < 0) break;
    const lineEnd = text.indexOf('-----', bi + 11);
    if (lineEnd < 0) break;
    const label = text.slice(bi + 11, lineEnd).trim();
    const bodyStart = lineEnd + 5;
    const endMark = text.indexOf('-----END ', bodyStart);
    if (endMark < 0) {
      blocks.push({ label, der: null, error: `Khối PEM "${label}" thiếu dòng -----END.` });
      break;
    }
    const endClose = text.indexOf('-----', endMark + 9);
    pos = endClose < 0 ? text.length : endClose + 5;
    if (/PRIVATE KEY/.test(label)) {
      notes.push(`Bỏ qua khối "${label}" — công cụ này không cần và không xử lý khóa riêng. Đừng dán khóa riêng vào các trang web.`);
      continue;
    }
    if (!CERT_LABELS.includes(label) && !CSR_LABELS.includes(label)) {
      notes.push(`Bỏ qua khối "${label}" (chỉ hỗ trợ CERTIFICATE và CERTIFICATE REQUEST).`);
      continue;
    }
    const body = text
      .slice(bodyStart, endMark)
      .split(/\r?\n/)
      .filter((l) => !/^\s*[A-Za-z-]+:/.test(l)) // bỏ header kiểu Proc-Type
      .join('')
      .replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/_=-]*$/.test(body) || body.length === 0) {
      blocks.push({ label, der: null, error: 'Nội dung PEM không phải Base64 hợp lệ.' });
      continue;
    }
    const der = fromBase64(body.replace(/=+$/, ''));
    blocks.push(der ? { label, der } : { label, der: null, error: 'Không giải mã được Base64 của khối PEM.' });
    if (blocks.length >= MAX_ITEMS) break;
  }
  return blocks;
}

function decodeAuto(label: string, der: Uint8Array): LoadedItem {
  if (der.length > MAX_DER_SIZE) return { ok: false, label, error: `Dữ liệu quá lớn (${der.length} byte, giới hạn ${MAX_DER_SIZE}).` };
  // Chứng chỉ TRUSTED có thêm dữ liệu phụ sau chứng chỉ -> cắt đúng độ dài phần tử đầu.
  const p = parseAsn1(der);
  if (!p.ok) return { ok: false, label, error: p.error };
  const root = p.value.node;
  const total = root.offset + root.hdr + root.len;
  const trimmed = p.value.trailing > 0 && label === 'TRUSTED CERTIFICATE' ? der.subarray(0, total) : der;
  let wantCsr = CSR_LABELS.includes(label);
  if (!CSR_LABELS.includes(label) && !CERT_LABELS.includes(label)) {
    const tbs = root.children?.[0];
    const f = tbs?.children ?? [];
    wantCsr = !!tbs && f.length >= 3 && f.length <= 4 && f[0].tag === 2 && f[0].cls === 0 && f[1].tag === 16 && f[2].tag === 16 && !(f[0].len > 1);
  }
  if (wantCsr) {
    const r = decodeCsr(trimmed);
    return r.ok ? { ok: true, kind: 'csr', label: r.value.subject.cn ?? 'CSR', csr: r.value } : { ok: false, label, error: r.error };
  }
  const r = decodeCertificate(trimmed);
  return r.ok ? { ok: true, kind: 'certificate', label: r.value.subject.cn ?? r.value.subject.ordered ?? 'Chứng chỉ', cert: r.value } : { ok: false, label, error: r.error };
}

/**
 * Nhận văn bản (PEM nhiều khối, base64 thuần, hex) hoặc byte thô (DER) và giải mã thành danh sách chứng chỉ/CSR.
 * Không bao giờ ném lỗi.
 */
export function loadX509(input: string | Uint8Array): LoadResult {
  const notes: string[] = [];
  try {
    if (input instanceof Uint8Array) {
      if (input.length === 0) return { items: [], notes };
      if (input.length > MAX_DER_SIZE * 4) return { items: [{ ok: false, label: 'Tệp', error: 'Tệp quá lớn.' }], notes };
      if (input[0] === 0x30) return { items: [decodeAuto('DER', input.subarray(0, Math.min(input.length, MAX_DER_SIZE + 1)))], notes };
      return loadX509(new TextDecoder('latin1').decode(input));
    }
    const text = input.length > 6_000_000 ? input.slice(0, 6_000_000) : input;
    if (text.trim() === '') return { items: [], notes };
    if (text.includes('-----BEGIN ')) {
      const blocks = extractPemBlocks(text, notes);
      const items = blocks.map((bl) => (bl.der ? decodeAuto(bl.label, bl.der) : ({ ok: false, label: bl.label, error: bl.error ?? 'Lỗi' } as LoadedItem)));
      if (items.length === 0 && notes.length === 0) notes.push('Không tìm thấy khối chứng chỉ nào.');
      return { items, notes };
    }
    // Không có header PEM: thử hex rồi base64
    const compact = text.replace(/\s+/g, '');
    const hexTry = compact.replace(/^0x/i, '').replace(/[:,-]|0x/gi, '');
    let der: Uint8Array | null = null;
    if (/^[0-9a-fA-F]+$/.test(hexTry) && hexTry.length % 2 === 0 && hexTry.length >= 8 && /^30/i.test(hexTry)) der = fromHex(hexTry);
    if (!der && /^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) der = fromBase64(compact.replace(/=+$/, ''));
    if (!der || der.length === 0) {
      return { items: [{ ok: false, label: 'Đầu vào', error: 'Không nhận ra định dạng: hãy dán PEM (-----BEGIN CERTIFICATE-----), Base64 của DER hoặc chuỗi hex.' }], notes };
    }
    const one = decodeAuto('DER', der);
    if (!one.ok) one.error = 'Đầu vào không phải PEM/DER hợp lệ — ' + one.error;
    return { items: [one], notes };
  } catch {
    return { items: [{ ok: false, label: 'Đầu vào', error: 'Không thể xử lý dữ liệu đầu vào.' }], notes };
  }
}

/* ================= Xuất JSON ================= */

function dnJson(d: Dn) {
  return { rfc4514: d.rfc4514, attributes: d.rdns.map((r) => r.map((a) => ({ type: a.short, oid: a.oid, value: a.value }))) };
}

export function certToJson(c: CertInfo, fp?: Fingerprints, now = Date.now()): Record<string, unknown> {
  const v = validityStatus(c, now);
  return {
    type: 'certificate',
    version: c.version,
    serialNumber: { hex: c.serialHex, decimal: c.serialDec },
    signatureAlgorithm: { oid: c.sigAlg.oid, name: c.sigAlg.name, params: c.sigAlg.params },
    issuer: dnJson(c.issuer),
    subject: dnJson(c.subject),
    validity: {
      notBefore: new Date(c.notBefore).toISOString(),
      notAfter: new Date(c.notAfter).toISOString(),
      lifetimeDays: Math.round(v.lifetimeDays * 100) / 100,
      status: v.state,
      daysRemaining: v.daysRemaining,
    },
    publicKey: { algorithm: c.key.algName, description: c.key.description, bits: c.key.bits, curve: c.key.curve, exponent: c.key.exponent, modulusHex: c.key.modulusHex },
    selfSigned: c.selfSigned,
    isCA: c.isCA,
    extensions: c.extensions.map((e) => ({ oid: e.oid, name: e.name, critical: e.critical, value: e.lines, error: e.error })),
    subjectAltName: c.ext.san.map((g) => `${g.type}:${g.value}`),
    fingerprints: fp ? { sha1: fp.sha1, sha256: fp.sha256, spkiPinSha256: fp.spkiPin } : undefined,
    signatureHex: c.signatureHex,
    pem: toPemText('CERTIFICATE', c.der),
  };
}

export function csrToJson(c: CsrInfo): Record<string, unknown> {
  return {
    type: 'csr',
    version: c.version,
    subject: dnJson(c.subject),
    signatureAlgorithm: { oid: c.sigAlg.oid, name: c.sigAlg.name },
    publicKey: { algorithm: c.key.algName, description: c.key.description, bits: c.key.bits, curve: c.key.curve, exponent: c.key.exponent },
    attributes: c.attributes,
    requestedExtensions: c.extensions.map((e) => ({ oid: e.oid, name: e.name, critical: e.critical, value: e.lines })),
    subjectAltName: c.ext.san.map((g) => `${g.type}:${g.value}`),
    signatureHex: c.signatureHex,
    pem: toPemText('CERTIFICATE REQUEST', c.der),
  };
}
