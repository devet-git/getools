// Âm thanh → WAV 16-bit PCM: giải mã bằng Web Audio, tự ghi header RIFF/WAVE.
import type { ConvertOutput } from './types';
import { extOf, outName } from './util';

/** WAV dùng trường kích thước 32-bit; ArrayBuffer quá lớn cũng dễ làm sập tab. */
export const MAX_WAV_BYTES = 1024 * 1024 * 1024;

/** Ghi WAV PCM 16-bit xen kẽ các kênh. Hàm thuần, chạy được cả ở Node để kiểm thử. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const numCh = channels.length;
  if (numCh === 0) throw new Error('Không có kênh âm thanh nào.');
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error('Tần số lấy mẫu không hợp lệ.');
  const frames = channels[0].length;
  const blockAlign = numCh * 2;
  const dataSize = frames * blockAlign;
  if (44 + dataSize > MAX_WAV_BYTES) throw new Error('Âm thanh quá dài, file WAV sẽ vượt 1 GB. Hãy cắt ngắn trước.');
  const out = new Uint8Array(44 + dataSize);
  const dv = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true); // kích thước khối fmt
  dv.setUint16(20, 1, true); // 1 = PCM
  dv.setUint16(22, numCh, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * blockAlign, true); // byte rate
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 16, true); // bit mỗi mẫu
  str(36, 'data');
  dv.setUint32(40, dataSize, true);
  let p = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      // Kẹp về [-1, 1] rồi đổi sang số nguyên 16-bit (âm nhân 0x8000, dương 0x7fff để không tràn)
      const s = Math.max(-1, Math.min(1, channels[c][i] || 0));
      dv.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      p += 2;
    }
  }
  return out;
}

export async function audioToWav(file: File): Promise<ConvertOutput[]> {
  type Ctor = typeof OfflineAudioContext;
  const Ctx: Ctor | undefined = typeof window !== 'undefined'
    ? window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: Ctor }).webkitOfflineAudioContext
    : undefined;
  if (!Ctx) throw new Error('Trình duyệt không hỗ trợ Web Audio để giải mã âm thanh.');
  // decodeAudioData luôn đổi tần số về tần số của context: Opus (WebM) gốc 48 kHz, còn lại dùng 44.1 kHz chuẩn CD
  const sampleRate = extOf(file) === 'webm' ? 48000 : 44100;
  const ctx = new Ctx(1, 1, sampleRate);
  let buf: AudioBuffer;
  try {
    buf = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error('Không giải mã được âm thanh (file hỏng hoặc trình duyệt không hỗ trợ codec này).');
  }
  const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const wav = encodeWav(channels, buf.sampleRate);
  return [{ blob: new Blob([wav as BlobPart], { type: 'audio/wav' }), name: outName(file.name, 'wav') }];
}
