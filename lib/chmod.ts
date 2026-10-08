// Logic thuần cho công cụ Chmod & Quyền Unix (không phụ thuộc React).

export const S_ISUID = 0o4000;
export const S_ISGID = 0o2000;
export const S_ISVTX = 0o1000;
export const MODE_MASK = 0o7777;

export type PermClass = 'u' | 'g' | 'o';
export type PermBit = 'r' | 'w' | 'x';

const CLASS_SHIFT: Record<PermClass, number> = { u: 6, g: 3, o: 0 };
const BIT_VALUE: Record<PermBit, number> = { r: 4, w: 2, x: 1 };

export function hasPerm(mode: number, cls: PermClass, bit: PermBit): boolean {
  return ((mode >> CLASS_SHIFT[cls]) & BIT_VALUE[bit]) !== 0;
}

export function setPerm(mode: number, cls: PermClass, bit: PermBit, on: boolean): number {
  const v = BIT_VALUE[bit] << CLASS_SHIFT[cls];
  return on ? (mode | v) & MODE_MASK : mode & ~v & MODE_MASK;
}

export function toggleSpecial(mode: number, which: 'suid' | 'sgid' | 'sticky', on: boolean): number {
  const v = which === 'suid' ? S_ISUID : which === 'sgid' ? S_ISGID : S_ISVTX;
  return on ? mode | v : mode & ~v & MODE_MASK;
}

/* ---------------- Bát phân ---------------- */

/** Chuỗi bát phân: 3 chữ số nếu không có bit đặc biệt, ngược lại 4 chữ số. */
export function modeToOctal(mode: number, forceFour = false): string {
  const m = mode & MODE_MASK;
  const s = m.toString(8).padStart(4, '0');
  return forceFour || m > 0o777 ? s : s.slice(1);
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseOctal(input: string): ParseResult<number> {
  const s = input.trim();
  if (s === '') return { ok: false, error: 'Hãy nhập số bát phân (ví dụ 755 hoặc 4755).' };
  if (!/^[0-7]+$/.test(s)) {
    return { ok: false, error: 'Số bát phân chỉ gồm chữ số 0-7.' };
  }
  if (s.length < 3 || s.length > 4) {
    return { ok: false, error: 'Số bát phân phải có 3 hoặc 4 chữ số.' };
  }
  return { ok: true, value: parseInt(s, 8) };
}

/* ---------------- Ký hiệu rwx ---------------- */

/** 9 ký tự, ví dụ rwxr-xr-x, rwsr-sr-t. */
export function modeToSymbolic(mode: number): string {
  const m = mode & MODE_MASK;
  const triple = (shift: number, special: boolean, sch: string): string => {
    const r = (m >> shift) & 4 ? 'r' : '-';
    const w = (m >> shift) & 2 ? 'w' : '-';
    const x = (m >> shift) & 1;
    let xc: string;
    if (special) xc = x ? sch : sch.toUpperCase();
    else xc = x ? 'x' : '-';
    return r + w + xc;
  };
  return (
    triple(6, !!(m & S_ISUID), 's') + triple(3, !!(m & S_ISGID), 's') + triple(0, !!(m & S_ISVTX), 't')
  );
}

export type FileKind = '-' | 'd' | 'l' | 'c' | 'b' | 'p' | 's';

/** Chuỗi kiểu `ls -l`: 10 ký tự. */
export function modeToLs(mode: number, kind: FileKind = '-'): string {
  return kind + modeToSymbolic(mode);
}

/** Phân tích chuỗi 9 ký tự (hoặc 10 ký tự có ký tự loại file đứng đầu). */
export function parseSymbolic(input: string): ParseResult<number> {
  let s = input.trim();
  if (s.length === 10 && /^[-dlcbps]/.test(s)) s = s.slice(1);
  if (s.length !== 9) {
    return { ok: false, error: 'Chuỗi ký hiệu phải có 9 ký tự (ví dụ rwxr-xr-x) hoặc 10 ký tự như ls -l (-rwxr-xr-x).' };
  }
  let mode = 0;
  for (let i = 0; i < 3; i++) {
    const t = s.slice(i * 3, i * 3 + 3);
    const shift = 6 - i * 3;
    if (t[0] === 'r') mode |= 4 << shift;
    else if (t[0] !== '-') return { ok: false, error: `Ký tự thứ ${i * 3 + 1} phải là 'r' hoặc '-'.` };
    if (t[1] === 'w') mode |= 2 << shift;
    else if (t[1] !== '-') return { ok: false, error: `Ký tự thứ ${i * 3 + 2} phải là 'w' hoặc '-'.` };
    const c = t[2];
    const sp = i === 0 ? ['s', 'S', S_ISUID] : i === 1 ? ['s', 'S', S_ISGID] : ['t', 'T', S_ISVTX];
    if (c === 'x') mode |= 1 << shift;
    else if (c === '-') {
      /* không có quyền */
    } else if (c === sp[0]) {
      mode |= (1 << shift) | (sp[2] as number);
    } else if (c === sp[1]) {
      mode |= sp[2] as number;
    } else {
      const allowed = i === 2 ? "'x', 't', 'T' hoặc '-'" : "'x', 's', 'S' hoặc '-'";
      return { ok: false, error: `Ký tự thứ ${i * 3 + 3} phải là ${allowed}.` };
    }
  }
  return { ok: true, value: mode };
}

/* ---------------- Biểu thức chmod symbolic ---------------- */

export interface ChmodStep {
  clause: string;
  description: string;
  before: number;
  after: number;
}

export interface ApplyOptions {
  isDir?: boolean;
  /** umask dùng khi không ghi rõ ugoa (GNU). Mặc định 0o022. */
  umask?: number;
}

export type ApplyResult =
  | { ok: true; mode: number; steps: ChmodStep[] }
  | { ok: false; error: string };

const WHO_NAME: Record<string, string> = { u: 'chủ sở hữu (u)', g: 'nhóm (g)', o: 'người khác (o)' };

function describePerms(bits: number, special: number): string {
  const parts: string[] = [];
  if (bits & 4) parts.push('đọc');
  if (bits & 2) parts.push('ghi');
  if (bits & 1) parts.push('thực thi');
  if (special & S_ISUID) parts.push('setuid');
  if (special & S_ISGID) parts.push('setgid');
  if (special & S_ISVTX) parts.push('sticky');
  return parts.length ? parts.join(', ') : '(không có quyền nào)';
}

/**
 * Áp biểu thức chmod (vd `u+x,g-w,o=r`, `a+rX`, `+t`, hoặc số bát phân `755`) lên mode ban đầu.
 * Không bao giờ ném lỗi.
 */
export function applySymbolic(start: number, expr: string, opts: ApplyOptions = {}): ApplyResult {
  const isDir = !!opts.isDir;
  const umask = (opts.umask ?? 0o022) & 0o777;
  const text = expr.trim();
  if (text === '') return { ok: false, error: 'Hãy nhập biểu thức chmod, ví dụ u+x,g-w,o=r.' };
  if (text.length > 200) return { ok: false, error: 'Biểu thức quá dài.' };
  const startMode = start & MODE_MASK;

  // Dạng số bát phân
  if (/^[0-7]+$/.test(text)) {
    if (text.length > 4) return { ok: false, error: 'Số bát phân tối đa 4 chữ số.' };
    const m = parseInt(text, 8);
    return {
      ok: true,
      mode: m,
      steps: [
        {
          clause: text,
          description: `Đặt trực tiếp mode theo số bát phân ${text} (thay thế hoàn toàn mode cũ).`,
          before: startMode,
          after: m,
        },
      ],
    };
  }

  const execAny = (startMode & 0o111) !== 0;
  let mode = startMode;
  const steps: ChmodStep[] = [];
  const clauses = text.split(',');

  for (const clause of clauses) {
    if (clause === '') return { ok: false, error: 'Có mệnh đề rỗng (dấu phẩy thừa).' };
    let i = 0;
    let who = '';
    while (i < clause.length && 'ugoa'.includes(clause[i])) {
      who += clause[i];
      i++;
    }
    if (i >= clause.length || !'+-='.includes(clause[i])) {
      return { ok: false, error: `Mệnh đề "${clause}" không hợp lệ: cần toán tử + - hoặc = sau phần ugoa.` };
    }
    const whoSet = new Set<string>();
    const explicitWho = who !== '';
    for (const ch of who) {
      if (ch === 'a') ['u', 'g', 'o'].forEach((c) => whoSet.add(c));
      else whoSet.add(ch);
    }
    if (!explicitWho) ['u', 'g', 'o'].forEach((c) => whoSet.add(c));
    const whoLabel = explicitWho ? who : '(trống = a, có áp umask)';

    // Có thể có nhiều thao tác nối tiếp: u+r-w=x ...
    while (i < clause.length) {
      const op = clause[i];
      if (!'+-='.includes(op)) {
        return { ok: false, error: `Ký tự '${op}' không hợp lệ trong mệnh đề "${clause}".` };
      }
      i++;
      let permChars = '';
      let copyFrom = '';
      while (i < clause.length && !'+-='.includes(clause[i])) {
        const ch = clause[i];
        if ('rwxXst'.includes(ch)) permChars += ch;
        else if ('ugo'.includes(ch)) copyFrom += ch;
        else return { ok: false, error: `Ký tự '${ch}' không hợp lệ trong mệnh đề "${clause}".` };
        i++;
      }
      if (copyFrom && permChars) {
        return { ok: false, error: `Mệnh đề "${clause}" không được trộn ugo với rwxXst sau cùng một toán tử.` };
      }
      if (copyFrom.length > 1) {
        return { ok: false, error: `Mệnh đề "${clause}": chỉ được sao chép từ một lớp (u, g hoặc o).` };
      }

      // Tính các bit rwx (theo vị trí lớp) và bit đặc biệt
      let rwx = 0; // 0..7
      let special = 0;
      const notes: string[] = [];
      if (copyFrom) {
        rwx = (mode >> CLASS_SHIFT[copyFrom as PermClass]) & 7;
        notes.push(`sao chép quyền hiện có của ${WHO_NAME[copyFrom]}`);
      } else {
        if (permChars.includes('r')) rwx |= 4;
        if (permChars.includes('w')) rwx |= 2;
        if (permChars.includes('x')) rwx |= 1;
        if (permChars.includes('X')) {
          if (isDir || execAny) {
            rwx |= 1;
            notes.push(isDir ? 'X: là thư mục nên thêm x' : 'X: mode ban đầu đã có x ở đâu đó nên thêm x');
          } else {
            notes.push('X: là file và chưa có quyền x ở đâu cả nên bỏ qua');
          }
        }
        if (permChars.includes('s')) {
          if (whoSet.has('u')) special |= S_ISUID;
          if (whoSet.has('g')) special |= S_ISGID;
          if (!whoSet.has('u') && !whoSet.has('g')) notes.push('s: chỉ có tác dụng với u hoặc g, nên bỏ qua');
        }
        if (permChars.includes('t')) {
          if (whoSet.has('o')) special |= S_ISVTX;
          else notes.push('t: chỉ áp dụng khi who gồm a/o hoặc để trống, nên bỏ qua');
        }
      }

      // Ma trận bit mục tiêu
      let rwxMask = 0;
      for (const c of ['u', 'g', 'o'] as PermClass[]) {
        if (whoSet.has(c)) rwxMask |= 7 << CLASS_SHIFT[c];
      }
      let value = 0;
      for (const c of ['u', 'g', 'o'] as PermClass[]) {
        if (whoSet.has(c)) value |= rwx << CLASS_SHIFT[c];
      }
      if (!explicitWho) {
        value &= ~umask & 0o777;
        rwxMask &= ~umask & 0o777;
        if (umask && (rwx !== 0 || copyFrom)) notes.push(`áp umask ${umask.toString(8).padStart(3, '0')} vì không ghi rõ ugoa`);
      }

      const before = mode;
      let desc = '';
      const target = explicitWho ? who.split('').map((c) => (c === 'a' ? 'tất cả (a)' : WHO_NAME[c])).join(' + ') : 'tất cả (a)';
      if (op === '+') {
        mode = (mode | value | special) & MODE_MASK;
        desc = `Thêm quyền ${describePerms(value ? rwx : 0, special)} cho ${target}.`;
        if (!value && !special && !copyFrom) desc = `Không thêm gì cho ${target}.`;
      } else if (op === '-') {
        mode = mode & ~(value | special) & MODE_MASK;
        desc = `Bỏ quyền ${describePerms(value ? rwx : 0, special)} của ${target}.`;
        if (!value && !special) desc = `Không bỏ gì của ${target}.`;
      } else {
        // '=' : xóa quyền cũ của lớp rồi đặt mới
        let clearSpecial = 0;
        if (whoSet.has('u')) clearSpecial |= S_ISUID;
        if (whoSet.has('g')) clearSpecial |= S_ISGID;
        if (explicitWho && who.includes('a')) clearSpecial |= S_ISVTX;
        mode = ((mode & ~(rwxMask | clearSpecial)) | value | special) & MODE_MASK;
        desc = `Đặt quyền của ${target} đúng bằng: ${describePerms(value ? rwx : 0, special)} (xóa quyền cũ của lớp này).`;
      }
      if (notes.length) desc += ' (' + notes.join('; ') + ')';
      steps.push({
        clause: `${whoLabel === '(trống = a, có áp umask)' ? '' : who}${op}${permChars || copyFrom}`,
        description: desc,
        before,
        after: mode,
      });
    }
  }
  return { ok: true, mode, steps };
}

/* ---------------- umask ---------------- */

export function parseUmask(input: string): ParseResult<number> {
  const s = input.trim();
  if (!/^[0-7]{3,4}$/.test(s)) return { ok: false, error: 'umask gồm 3 hoặc 4 chữ số bát phân (vd 022 hoặc 0027).' };
  return { ok: true, value: parseInt(s, 8) & 0o777 };
}

export function umaskToDefaults(umask: number): { file: number; dir: number } {
  const u = umask & 0o777;
  return { file: 0o666 & ~u, dir: 0o777 & ~u };
}

/** Từ quyền thư mục mong muốn suy ra umask. */
export function umaskFromDirMode(dirMode: number): number {
  return ~dirMode & 0o777;
}

/** Từ quyền file mong muốn (chỉ rw có ý nghĩa vì file mới không bao giờ có x). */
export function umaskFromFileMode(fileMode: number): { umask: number; exact: boolean } {
  const exact = (fileMode & 0o111) === 0;
  const effective = fileMode & 0o666;
  return { umask: ~effective & 0o777, exact };
}

/* ---------------- Cảnh báo & giải thích ---------------- */

export interface ModeWarning {
  level: 'danger' | 'warn' | 'info';
  text: string;
}

export interface AnalyzeOptions {
  isDir?: boolean;
  /** file là script/binary (để cảnh báo setuid). */
  isScript?: boolean;
}

export function analyzeMode(mode: number, opts: AnalyzeOptions = {}): ModeWarning[] {
  const m = mode & MODE_MASK;
  const w: ModeWarning[] = [];
  const oW = hasPerm(m, 'o', 'w');
  const gW = hasPerm(m, 'g', 'w');
  if ((m & 0o777) === 0o777) {
    w.push({ level: 'danger', text: '777: MỌI người dùng đều đọc/ghi/thực thi được. Hầu như luôn là cách "chữa cháy" nguy hiểm, hãy cấp quyền hẹp hơn (755, 775 với nhóm phù hợp).' });
  } else if (oW) {
    w.push({
      level: 'danger',
      text: opts.isDir && (m & S_ISVTX)
        ? 'Người khác có quyền ghi (thư mục có sticky nên chỉ xóa được file của chính mình).'
        : 'World-writable: bất kỳ người dùng nào trên máy cũng sửa/xóa được' + (opts.isDir ? ' nội dung thư mục' : ' file này') + '. Nên bỏ quyền ghi của "người khác" (o-w).',
    });
  }
  if (m & S_ISUID) {
    w.push({
      level: 'danger',
      text: opts.isScript
        ? 'setuid trên script: Linux bỏ qua setuid với script shebang (và rất dễ bị khai thác nếu hệ khác chấp nhận). Đừng dùng; hãy dùng sudo/capabilities.'
        : 'setuid: chương trình chạy với quyền của chủ sở hữu (thường là root). Chỉ dùng cho binary đã được kiểm toán kỹ (như passwd, sudo); lỗi nhỏ có thể dẫn tới leo thang đặc quyền.',
    });
  }
  if (m & S_ISGID) {
    w.push({
      level: 'info',
      text: opts.isDir
        ? 'setgid trên thư mục: file mới tạo bên trong thừa hưởng nhóm của thư mục (hữu ích cho thư mục chia sẻ).'
        : 'setgid trên file: chương trình chạy với quyền của nhóm sở hữu. Hãy chắc chắn là cần thiết.',
    });
  }
  if (m & S_ISVTX) {
    w.push({
      level: 'info',
      text: opts.isDir
        ? 'sticky bit trên thư mục: chỉ chủ file, chủ thư mục hoặc root mới được xóa/đổi tên file bên trong (như /tmp).'
        : 'sticky bit trên file thường không còn tác dụng trên Linux hiện đại.',
    });
  }
  if (m & S_ISUID && !(m & 0o100)) w.push({ level: 'warn', text: "setuid hiển thị 'S' hoa: có setuid nhưng chủ sở hữu không có quyền x nên không hoạt động." });
  if (m & S_ISGID && !(m & 0o010)) w.push({ level: 'warn', text: "setgid hiển thị 'S' hoa: không có quyền x cho nhóm. Với thư mục thì vẫn hợp lệ, với file thì thường là cấu hình sai (hoặc dùng cho mandatory locking cũ)." });
  if (m & S_ISVTX && !(m & 0o001)) w.push({ level: 'warn', text: "sticky hiển thị 'T' hoa: có sticky nhưng người khác không có quyền x." });
  if (gW && !oW && (m & 0o777) !== 0o777) w.push({ level: 'info', text: 'Nhóm có quyền ghi: mọi thành viên trong nhóm sở hữu đều sửa được.' });
  if (!hasPerm(m, 'u', 'r') && (hasPerm(m, 'g', 'r') || hasPerm(m, 'o', 'r'))) {
    w.push({ level: 'warn', text: 'Chủ sở hữu bị hạn chế hơn nhóm/người khác. Linux áp dụng đúng lớp đầu tiên khớp, nên chủ sở hữu sẽ KHÔNG đọc được dù nhóm/người khác đọc được.' });
  }
  if (opts.isDir && !hasPerm(m, 'u', 'x') && (m & 0o700)) {
    w.push({ level: 'warn', text: 'Thư mục thiếu quyền x cho chủ sở hữu: không thể cd vào hoặc truy cập file bên trong.' });
  }
  if (!opts.isDir && (m & 0o111) && !(m & 0o444)) {
    w.push({ level: 'info', text: 'Có quyền thực thi nhưng không ai có quyền đọc: script không chạy được (interpreter cần đọc), binary thì vẫn chạy.' });
  }
  return w;
}

const CLASS_VN: Record<PermClass, string> = { u: 'Chủ sở hữu (owner)', g: 'Nhóm (group)', o: 'Người khác (others)' };

/** Giải thích "Vì sao?" bằng tiếng Việt. */
export function explainMode(mode: number, opts: { isDir?: boolean } = {}): string[] {
  const m = mode & MODE_MASK;
  const dir = !!opts.isDir;
  const lines: string[] = [];
  lines.push(`Mode ${modeToOctal(m, true)} = ${modeToSymbolic(m)}. Mỗi chữ số bát phân là tổng của r=4, w=2, x=1 cho một lớp người dùng.`);
  for (const c of ['u', 'g', 'o'] as PermClass[]) {
    const digit = (m >> CLASS_SHIFT[c]) & 7;
    const parts: string[] = [];
    if (digit & 4) parts.push(dir ? 'liệt kê nội dung (r)' : 'đọc (r)');
    if (digit & 2) parts.push(dir ? 'tạo/xóa/đổi tên file bên trong (w)' : 'ghi/sửa (w)');
    if (digit & 1) parts.push(dir ? 'đi vào thư mục / truy cập file bên trong (x)' : 'thực thi (x)');
    const sum = [digit & 4 ? '4' : '', digit & 2 ? '2' : '', digit & 1 ? '1' : ''].filter(Boolean).join('+') || '0';
    lines.push(`${CLASS_VN[c]}: chữ số ${digit} (${sum}) → ${parts.length ? parts.join(', ') : 'không có quyền nào'}.`);
  }
  if (m & S_ISUID) lines.push('Chữ số đầu có 4 (setuid): chương trình chạy với quyền của chủ sở hữu file.');
  if (m & S_ISGID) lines.push(dir ? 'Chữ số đầu có 2 (setgid): file mới trong thư mục thừa hưởng nhóm của thư mục.' : 'Chữ số đầu có 2 (setgid): chương trình chạy với quyền của nhóm sở hữu.');
  if (m & S_ISVTX) lines.push(dir ? 'Chữ số đầu có 1 (sticky): chỉ chủ file/chủ thư mục/root được xóa file bên trong.' : 'Chữ số đầu có 1 (sticky bit).');
  if (dir) lines.push('Với thư mục: x nghĩa là "được đi qua" (cd, truy cập tên file); r chỉ cho phép xem danh sách; w (kèm x) cho phép thêm/xóa mục bên trong.');
  return lines;
}

export interface ModePreset {
  mode: number;
  label: string;
  useCase: string;
  isDir?: boolean;
}

export const PRESETS: ModePreset[] = [
  { mode: 0o600, label: '600', useCase: 'Khóa riêng SSH (~/.ssh/id_rsa), file bí mật: chỉ chủ sở hữu đọc/ghi. SSH từ chối khóa nếu quyền rộng hơn.' },
  { mode: 0o400, label: '400', useCase: 'File chỉ đọc cho chủ sở hữu: chứng chỉ, khóa .pem trên AWS, file cấu hình không được sửa.' },
  { mode: 0o644, label: '644', useCase: 'File thông thường (HTML, ảnh, văn bản): chủ sở hữu sửa được, mọi người đọc được.' },
  { mode: 0o664, label: '664', useCase: 'File nhóm cùng sửa: chủ sở hữu và nhóm ghi được, người khác chỉ đọc.' },
  { mode: 0o755, label: '755', useCase: 'Script, chương trình chạy được và thư mục: chủ sở hữu toàn quyền, người khác đọc và chạy/vào.', isDir: true },
  { mode: 0o700, label: '700', useCase: 'Thư mục riêng (~/.ssh, ~/.gnupg) hoặc script chỉ chủ sở hữu được dùng.', isDir: true },
  { mode: 0o750, label: '750', useCase: 'Thư mục/chương trình cho chủ sở hữu và nhóm; người khác bị chặn hoàn toàn.', isDir: true },
  { mode: 0o775, label: '775', useCase: 'Thư mục làm việc chung cho nhóm: chủ sở hữu và nhóm toàn quyền.', isDir: true },
  { mode: 0o1777, label: '1777', useCase: 'Kiểu /tmp: ai cũng ghi được nhưng sticky bit ngăn xóa file của người khác.', isDir: true },
  { mode: 0o2775, label: '2775', useCase: 'Thư mục dùng chung của nhóm: setgid để file mới luôn thuộc nhóm của thư mục.', isDir: true },
  { mode: 0o4755, label: '4755', useCase: 'Binary setuid (như /usr/bin/passwd, sudo): chạy với quyền chủ sở hữu (thường root). Rất nhạy cảm.' },
  { mode: 0o777, label: '777', useCase: 'Cảnh báo: ai cũng làm được mọi thứ. Chỉ dùng tạm khi gỡ lỗi trong môi trường cô lập.', isDir: true },
];

/* ---------------- Sinh lệnh ---------------- */

/** Đặt chuỗi vào dấu nháy đơn an toàn cho POSIX shell. */
export function shellQuote(s: string): string {
  if (s === '') return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export interface CommandOptions {
  path: string;
  recursive: boolean;
}

export interface GeneratedCommand {
  label: string;
  command: string;
}

export function generateCommands(mode: number, path: string, symbolicExprForUx?: string): GeneratedCommand[] {
  const p = shellQuote(path.trim() || 'file');
  const oct = modeToOctal(mode);
  const out: GeneratedCommand[] = [
    { label: 'Đặt mode (bát phân)', command: `chmod ${oct} ${p}` },
    { label: 'Đặt mode (ký hiệu)', command: `chmod ${symbolicForChmod(mode)} ${p}` },
    { label: 'Đệ quy toàn bộ thư mục', command: `chmod -R ${oct} ${p}` },
    { label: 'Chỉ file trong cây thư mục (idiom 644)', command: `find ${p} -type f -exec chmod 644 {} +` },
    { label: 'Chỉ thư mục trong cây (idiom 755)', command: `find ${p} -type d -exec chmod 755 {} +` },
    { label: 'Thêm quyền thực thi cho chủ sở hữu', command: `chmod u+x ${p}` },
  ];
  if (symbolicExprForUx && /^[ugoa,+\-=rwxXst]+$/.test(symbolicExprForUx)) {
    out.push({ label: 'Biểu thức bạn đã nhập', command: `chmod ${symbolicExprForUx} ${p}` });
  }
  return out;
}

/** `u=rwx,g=rx,o=rx` (có thêm s/t nếu cần). */
export function symbolicForChmod(mode: number): string {
  const m = mode & MODE_MASK;
  const parts: string[] = [];
  const names: Record<PermClass, string> = { u: 'u', g: 'g', o: 'o' };
  for (const c of ['u', 'g', 'o'] as PermClass[]) {
    let s = '';
    const d = (m >> CLASS_SHIFT[c]) & 7;
    if (d & 4) s += 'r';
    if (d & 2) s += 'w';
    if (d & 1) s += 'x';
    if (c === 'u' && m & S_ISUID) s += 's';
    if (c === 'g' && m & S_ISGID) s += 's';
    if (c === 'o' && m & S_ISVTX) s += 't';
    parts.push(`${names[c]}=${s}`);
  }
  return parts.join(',');
}

/* ---------------- chown / chgrp ---------------- */

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,31}\$?$/;
const ID_RE = /^[0-9]{1,10}$/;

export function validOwnerName(s: string): boolean {
  return NAME_RE.test(s) || ID_RE.test(s);
}

export function generateChown(owner: string, group: string, path: string, recursive: boolean): ParseResult<GeneratedCommand[]> {
  const o = owner.trim();
  const g = group.trim();
  if (!o && !g) return { ok: false, error: 'Nhập ít nhất một trong hai: người dùng hoặc nhóm.' };
  if (o && !validOwnerName(o)) return { ok: false, error: 'Tên người dùng không hợp lệ (chữ, số, _ . - hoặc UID số).' };
  if (g && !validOwnerName(g)) return { ok: false, error: 'Tên nhóm không hợp lệ (chữ, số, _ . - hoặc GID số).' };
  const p = shellQuote(path.trim() || 'file');
  const r = recursive ? '-R ' : '';
  const list: GeneratedCommand[] = [];
  if (o && g) list.push({ label: 'Đổi cả chủ sở hữu và nhóm', command: `chown ${r}${o}:${g} ${p}` });
  else if (o) list.push({ label: 'Đổi chủ sở hữu', command: `chown ${r}${o} ${p}` });
  if (g) list.push({ label: 'Đổi nhóm', command: `chgrp ${r}${g} ${p}` });
  if (o && !g) list.push({ label: 'Đổi chủ sở hữu và nhóm theo nhóm đăng nhập của user', command: `chown ${r}${o}: ${p}` });
  list.push({ label: 'Kiểm tra kết quả', command: `ls -ld ${p}` });
  return { ok: true, value: list };
}

/* ---------------- Windows icacls ---------------- */

export interface IcaclsOptions {
  path: string;
  principal: string;
  read: boolean;
  write: boolean;
  execute: boolean;
  recursive: boolean;
  removeInheritance: boolean;
}

/** Đặt chuỗi trong dấu nháy kép cho cmd/PowerShell. */
function winQuote(s: string): string {
  return '"' + s.replace(/"/g, '') + '"';
}

export function generateIcacls(o: IcaclsOptions): ParseResult<GeneratedCommand[]> {
  const principal = o.principal.trim();
  if (!principal) return { ok: false, error: 'Nhập tên người dùng/nhóm Windows (vd Users, DOMAIN\\ten).' };
  if (/[":/*?<>|;,\r\n]/.test(principal)) return { ok: false, error: 'Tên người dùng Windows chứa ký tự không hợp lệ.' };
  if (/["\r\n]/.test(o.path)) return { ok: false, error: 'Đường dẫn chứa ký tự không hợp lệ.' };
  const path = winQuote(o.path.trim() || 'C:\\duong\\dan');
  const rights: string[] = [];
  if (o.read) rights.push('R');
  if (o.write) rights.push('W');
  if (o.execute) rights.push('RX');
  const uniq = Array.from(new Set(rights.length ? rights : []));
  const t = o.recursive ? ' /T' : '';
  const out: GeneratedCommand[] = [];
  if (o.removeInheritance) out.push({ label: 'Tắt kế thừa quyền, giữ bản sao', command: `icacls ${path} /inheritance:d${t}` });
  if (uniq.length) {
    const spec = o.recursive ? `(OI)(CI)(${uniq.join(',')})` : `(${uniq.join(',')})`;
    out.push({ label: 'Cấp quyền (thay thế quyền cũ của user)', command: `icacls ${path} /grant:r ${winQuote(principal + ':' + spec).replace(/^"|"$/g, '"')}${t}` });
  } else {
    out.push({ label: 'Thu hồi mọi quyền của user', command: `icacls ${path} /remove ${winQuote(principal)}${t}` });
  }
  out.push({ label: 'Xem quyền hiện tại', command: `icacls ${path}` });
  return { ok: true, value: out };
}

/* ---------------- Docker ---------------- */

export function dockerSnippets(mode: number, src: string, dest: string): GeneratedCommand[] {
  const q = (s: string) => (/^[A-Za-z0-9_@%+=:,./*-]+$/.test(s) ? s : JSON.stringify(s));
  const oct = modeToOctal(mode);
  const s = q(src.trim() || './app');
  const d = q(dest.trim() || '/app');
  return [
    { label: 'COPY --chmod (BuildKit, khuyến nghị)', command: `COPY --chmod=${oct} ${s} ${d}` },
    { label: 'ADD --chmod', command: `ADD --chmod=${oct} ${s} ${d}` },
    { label: 'Cách truyền thống (thêm layer)', command: `COPY ${s} ${d}\nRUN chmod ${oct} ${d}` },
    { label: 'Kèm đổi chủ sở hữu', command: `COPY --chown=app:app --chmod=${oct} ${s} ${d}` },
  ];
}
