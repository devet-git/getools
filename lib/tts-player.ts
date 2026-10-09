/**
 * Trình phát của tool TTS, sống ở cấp ứng dụng (không gắn vào trang) để người dùng chuyển sang công cụ khác vẫn
 * nghe tiếp, điều khiển ở khu nổi góc màn hình (components/BackgroundDock.tsx):
 * - `ttsSpeaker`: giọng của trình duyệt (Web Speech), đọc lần lượt từng câu/cụm.
 * - `getTtsAudio()`: phần tử <audio> dùng chung cho giọng AI (không nằm trong DOM của trang nên không bị dừng
 *   khi trang bị gỡ), kèm `ttsAudioMeta` để trang khôi phục khi quay lại.
 */
import type { SpeechChunk } from '@/lib/tts-local';

/* ------------------------------------------------------------------ */
/* Bộ phát giọng trình duyệt: xếp hàng từng câu/cụm để tránh lỗi Chrome */
/* ------------------------------------------------------------------ */

export interface SpeakCfg {
  voice: SpeechSynthesisVoice | null;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
}

export interface PlayerSnap {
  status: 'idle' | 'playing' | 'paused';
  index: number;
  word: { start: number; end: number } | null;
  chunks: SpeechChunk[];
}

export class ChunkSpeaker {
  private snap: PlayerSnap = { status: 'idle', index: 0, word: null, chunks: [] };
  private listeners = new Set<() => void>();
  private gen = 0;
  private utter: SpeechSynthesisUtterance | null = null; // giữ tham chiếu để Chrome không thu gom làm mất onend
  private manualPaused = false;
  cfg: SpeakCfg = { voice: null, lang: 'vi-VN', rate: 1, pitch: 1, volume: 1 };
  /** Văn bản gốc đang đọc: trang TTS khôi phục lại khi người dùng quay về giữa lúc đang đọc */
  text = '';
  onNotice: (msg: string) => void = () => {};

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getSnapshot = () => this.snap;

  private set(p: Partial<PlayerSnap>) {
    this.snap = { ...this.snap, ...p };
    this.listeners.forEach((l) => l());
  }

  private get synth(): SpeechSynthesis | null {
    return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  }

  start(chunks: SpeechChunk[], from = 0) {
    const synth = this.synth;
    if (!synth || chunks.length === 0) return;
    this.gen++;
    this.manualPaused = false;
    const i = Math.max(0, Math.min(from, chunks.length - 1));
    this.set({ chunks, index: i, status: 'playing', word: null });
    try {
      synth.cancel();
    } catch {
      /* bỏ qua */
    }
    this.speak(i, this.gen);
  }

  private speak(i: number, token: number) {
    const synth = this.synth;
    if (!synth || token !== this.gen) return;
    const chunks = this.snap.chunks;
    if (i >= chunks.length) {
      this.utter = null;
      this.set({ status: 'idle', index: 0, word: null });
      return;
    }
    const text = chunks[i].text;
    const u = new SpeechSynthesisUtterance(text);
    const { voice, lang, rate, pitch, volume } = this.cfg;
    if (voice) u.voice = voice;
    u.lang = voice?.lang || lang;
    u.rate = Math.max(0.1, Math.min(10, rate));
    u.pitch = Math.max(0, Math.min(2, pitch));
    u.volume = Math.max(0, Math.min(1, volume));
    let started = false;
    u.onstart = () => {
      started = true;
      if (token === this.gen) this.set({ index: i, word: null });
    };
    u.onboundary = (e: SpeechSynthesisEvent) => {
      if (token !== this.gen || e.name === 'sentence') return;
      const start = e.charIndex;
      let len = (e as SpeechSynthesisEvent & { charLength?: number }).charLength || 0;
      if (!len) {
        const m = /^\S+/.exec(text.slice(start));
        len = m ? m[0].length : 0;
      }
      if (len > 0) this.set({ word: { start, end: start + len } });
    };
    u.onend = () => {
      if (token !== this.gen) return;
      this.set({ word: null });
      this.speak(i + 1, token);
    };
    u.onerror = (e: SpeechSynthesisErrorEvent) => {
      if (token !== this.gen) return;
      const err = e.error;
      if (err === 'canceled' || err === 'interrupted') return;
      if (err === 'not-allowed') {
        this.onNotice('Trình duyệt chặn phát âm thanh. Hãy bấm nút Đọc một lần nữa (Safari/iOS yêu cầu thao tác bấm trực tiếp).');
        this.stop();
        return;
      }
      if (err === 'synthesis-unavailable' || err === 'voice-unavailable' || err === 'language-unavailable' || err === 'synthesis-failed') {
        this.onNotice('Giọng đã chọn không đọc được. Hãy chọn giọng khác trong danh sách.');
        this.stop();
        return;
      }
      this.speak(i + 1, token); // lỗi lẻ: bỏ qua cụm này, đọc tiếp
    };
    this.utter = u;
    this.set({ index: i });
    try {
      synth.speak(u);
    } catch {
      this.onNotice('Không thể bắt đầu đọc. Hãy thử lại.');
      this.stop();
      return;
    }
    // Giọng mạng/đang tải có thể im lặng: nhắc người dùng nếu 8 giây vẫn chưa bắt đầu
    setTimeout(() => {
      if (!started && token === this.gen && this.snap.status === 'playing' && this.utter === u && !(this.synth?.paused)) {
        this.onNotice('Giọng đọc chưa phản hồi. Nếu vẫn im lặng, hãy chọn giọng "Cục bộ" khác hoặc bấm Đọc lại.');
      }
    }, 8000);
  }

  pause() {
    const synth = this.synth;
    if (!synth || this.snap.status !== 'playing') return;
    synth.pause();
    this.set({ status: 'paused' });
    const token = this.gen;
    // Một số trình duyệt (Android) không hỗ trợ pause: dừng hẳn và đọc lại cụm hiện tại khi tiếp tục
    setTimeout(() => {
      if (token === this.gen && this.snap.status === 'paused' && !synth.paused) {
        this.manualPaused = true;
        this.gen++;
        synth.cancel();
      }
    }, 200);
  }

  resume() {
    const synth = this.synth;
    if (!synth || this.snap.status !== 'paused') return;
    if (this.manualPaused) {
      this.start(this.snap.chunks, this.snap.index);
      return;
    }
    synth.resume();
    this.set({ status: 'playing' });
    const token = this.gen;
    const idx = this.snap.index;
    // Chrome đôi khi không tiếp tục được sau khi tạm dừng lâu: đọc lại cụm hiện tại
    setTimeout(() => {
      if (token === this.gen && this.snap.status === 'playing' && !synth.speaking && !synth.pending) {
        this.start(this.snap.chunks, idx);
      }
    }, 500);
  }

  stop() {
    this.gen++;
    this.manualPaused = false;
    this.utter = null;
    try {
      this.synth?.cancel();
    } catch {
      /* bỏ qua */
    }
    if (this.snap.status !== 'idle' || this.snap.word) this.set({ status: 'idle', index: 0, word: null });
  }

  seek(i: number) {
    if (this.snap.chunks.length === 0) return;
    this.start(this.snap.chunks, i);
  }

  restartCurrent() {
    if (this.snap.status === 'playing') this.start(this.snap.chunks, this.snap.index);
  }

  /** Nghe thử một giọng với câu mẫu (dừng phiên đọc hiện tại) */
  preview(voice: SpeechSynthesisVoice, text: string, rate: number, pitch: number, volume: number) {
    const synth = this.synth;
    if (!synth) return;
    this.stop();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = rate;
    u.pitch = pitch;
    u.volume = volume;
    this.utter = u;
    synth.speak(u);
  }
}

/** Bộ phát giọng trình duyệt dùng chung toàn app */
export const ttsSpeaker = new ChunkSpeaker();

/* ---------- Giọng AI: một phần tử audio dùng chung ---------- */

let audioEl: HTMLAudioElement | null = null;

/** Thông tin bản đang phát (để trang TTS khôi phục khi quay lại) */
export const ttsAudioMeta: { url: string | null; mime: string; text: string } = { url: null, mime: 'audio/wav', text: '' };

export function getTtsAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = 'auto';
    for (const ev of ['play', 'pause', 'ended', 'loadedmetadata', 'emptied']) audioEl.addEventListener(ev, emit);
    audioEl.addEventListener('timeupdate', onTime);
  }
  return audioEl;
}

/* ---------- Trạng thái tóm tắt cho khu nổi ---------- */

export type TtsDockState =
  | { kind: 'browser'; status: 'playing' | 'paused'; index: number; total: number; sentence: string }
  | { kind: 'ai'; playing: boolean; currentTime: number; duration: number; text: string }
  | null;

const listeners = new Set<() => void>();
let snap: TtsDockState = null;
let lastSecond = -1;

function compute(): TtsDockState {
  const p = ttsSpeaker.getSnapshot();
  if (p.status !== 'idle' && p.chunks.length) {
    return { kind: 'browser', status: p.status, index: p.index, total: p.chunks.length, sentence: p.chunks[p.index]?.text ?? '' };
  }
  const a = audioEl;
  // Giọng AI: hiện khi đang phát, hoặc tạm dừng giữa chừng (chưa hết bài)
  if (a && a.src && !a.ended && (!a.paused || a.currentTime > 0)) {
    return { kind: 'ai', playing: !a.paused, currentTime: a.currentTime, duration: Number.isFinite(a.duration) ? a.duration : 0, text: ttsAudioMeta.text };
  }
  return null;
}

function emit() {
  snap = compute();
  listeners.forEach((l) => l());
}

/** timeupdate bắn ~4 lần/giây: chỉ cập nhật khi đổi giây để khu nổi khỏi vẽ lại thừa */
function onTime() {
  const s = Math.floor(audioEl?.currentTime ?? 0);
  if (s === lastSecond) return;
  lastSecond = s;
  emit();
}

ttsSpeaker.subscribe(emit);

export function subscribeTtsDock(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export const getTtsDockSnapshot = () => snap;
export const getServerTtsDockSnapshot = (): TtsDockState => null;

/** Dừng mọi thứ đang đọc / phát */
export function stopTts() {
  ttsSpeaker.stop();
  const a = audioEl;
  if (a) {
    a.pause();
    a.currentTime = 0;
    emit();
  }
}
