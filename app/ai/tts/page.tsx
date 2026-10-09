'use client';

import { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue, useSyncExternalStore } from 'react';
import {
  Volume2,
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  RotateCcw,
  Download,
  Sparkles,
  Sliders,
  Trash2,
  Copy,
  Check,
  Upload,
  Headphones,
  History,
  Loader2,
  User,
  Zap,
  Mic2,
  Wand2,
  ClipboardPaste,
  Search,
  Globe,
  Wifi,
  HardDrive,
  AlertTriangle,
  RefreshCw,
  ListChecks,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApp } from '@/components/AppContext';
import { AiSection } from '@/components/AiSection';
import { AiKeyNotice } from '@/components/AiKeyNotice';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { useAiSettings } from '@/lib/use-ai-config';
import { callAi, toAiError } from '@/lib/ai-client';
import { readShareParams } from '@/lib/share-link';
import {
  SUPPORTED_LANGUAGES,
  AI_VOICES,
  SPEAKING_STYLES,
  LanguageOption,
  TTSHistoryItem,
  saveTTSHistoryItem,
  deleteTTSHistoryItem,
  clearTTSHistory,
  audioBufferToWav,
  rewriteTextForStyle,
} from '@/lib/tts-config';
import {
  normalizeForSpeech,
  detectLanguage,
  splitIntoChunks,
  pickBestVoice,
  groupVoicesByLang,
  filterVoices,
  langLabel,
  langPrimary,
  viVoiceGuides,
  estimateSeconds,
  formatDuration,
  LANG_BCP47,
  type SpeechChunk,
  type NormLang,
  type DetectedLang,
} from '@/lib/tts-local';
import { subscribeStorageSync } from '@/lib/storage';
import { apiFetch } from '@/lib/api-client';

const emptyArrayString = () => '[]';
const noopSubscribe = () => () => {};
const MAX_BROWSER_CHARS = 60000;
const PREFS_KEY = 'getools_tts_prefs_v1';
const HISTORY_KEY = 'git_downloader_tts_history_v1';

type Engine = 'browser' | 'ai';
type LangId = 'vi' | 'en' | 'zh' | 'ko' | 'ja';
const FIVE_LANGS: string[] = ['vi', 'en', 'zh', 'ko', 'ja'];

function getTTSHistorySnapshot(): string {
  if (typeof window === 'undefined') return '[]';
  try {
    return localStorage.getItem(HISTORY_KEY) || '[]';
  } catch {
    return '[]';
  }
}

const VOICE_SAMPLES: Record<string, string> = {
  vi: 'Xin chào, đây là giọng đọc thử.',
  en: 'Hello, this is a voice sample.',
  zh: '你好，这是语音试听。',
  ja: 'こんにちは、これは音声サンプルです。',
  ko: '안녕하세요, 음성 샘플입니다.',
  ru: 'Здравствуйте, это пример голоса.',
  th: 'สวัสดี นี่คือเสียงตัวอย่าง',
  fr: 'Bonjour, ceci est un exemple de voix.',
  de: 'Hallo, das ist eine Stimmprobe.',
  es: 'Hola, esta es una muestra de voz.',
};

/* ------------------------------------------------------------------ */
/* Bộ phát giọng trình duyệt: xếp hàng từng câu/cụm để tránh lỗi Chrome */
/* ------------------------------------------------------------------ */

interface SpeakCfg {
  voice: SpeechSynthesisVoice | null;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
}

interface PlayerSnap {
  status: 'idle' | 'playing' | 'paused';
  index: number;
  word: { start: number; end: number } | null;
  chunks: SpeechChunk[];
}

class ChunkSpeaker {
  private snap: PlayerSnap = { status: 'idle', index: 0, word: null, chunks: [] };
  private listeners = new Set<() => void>();
  private gen = 0;
  private utter: SpeechSynthesisUtterance | null = null; // giữ tham chiếu để Chrome không thu gom làm mất onend
  private manualPaused = false;
  cfg: SpeakCfg = { voice: null, lang: 'vi-VN', rate: 1, pitch: 1, volume: 1 };
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

/* ------------------------------------------------------------------ */
/* Danh sách giọng của trình duyệt (tải bất đồng bộ, thử lại)           */
/* ------------------------------------------------------------------ */

function useSpeechVoices(supported: boolean) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const read = () => {
      if (cancelled) return;
      const list = synth.getVoices();
      if (list.length > 0) {
        setVoices([...list]);
        setLoading(false);
      } else if (tries++ < 14) {
        timer = setTimeout(read, 350);
      } else {
        setLoading(false);
      }
    };
    const onChanged = () => {
      const list = synth.getVoices();
      if (list.length > 0) {
        setVoices([...list]);
        setLoading(false);
      }
    };
    timer = setTimeout(read, 0);
    synth.addEventListener?.('voiceschanged', onChanged);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      synth.removeEventListener?.('voiceschanged', onChanged);
    };
  }, [supported, nonce]);

  const reload = useCallback(() => {
    setLoading(true);
    setNonce((n) => n + 1);
  }, []);

  return { voices, loading, reload };
}

/* ------------------------------------------------------------------ */
/* Xử lý âm thanh giọng AI (giữ nguyên hành vi cũ)                      */
/* ------------------------------------------------------------------ */

interface EqFilter {
  type: BiquadFilterType;
  frequency: number;
  Q?: number;
  gain?: number;
}

const STYLE_EQ: Record<string, EqFilter[]> = {
  news: [
    { type: 'highpass', frequency: 110 },
    { type: 'peaking', frequency: 3200, Q: 1.2, gain: 3.5 },
  ],
  story: [
    { type: 'peaking', frequency: 240, Q: 1.0, gain: 3.5 },
    { type: 'highshelf', frequency: 5500, gain: -2.5 },
  ],
  friendly: [
    { type: 'peaking', frequency: 2800, Q: 1.2, gain: 3.0 },
    { type: 'highshelf', frequency: 8000, gain: 2.0 },
  ],
  presentation: [{ type: 'peaking', frequency: 1800, Q: 1.1, gain: 2.5 }],
  calm: [
    { type: 'lowpass', frequency: 4200 },
    { type: 'lowshelf', frequency: 180, gain: 2.0 },
  ],
};

async function processAudio(
  arrayBuffer: ArrayBuffer,
  targetGender: 'male' | 'female',
  mime: string,
  targetStyle: string,
): Promise<{ url: string; mime: string }> {
  const fallback = () => ({ url: URL.createObjectURL(new Blob([arrayBuffer], { type: mime })), mime });
  if (typeof window === 'undefined') return { url: '', mime };
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return fallback();

    const audioCtx = new AudioCtx();
    const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    const styleObj = SPEAKING_STYLES.find((s) => s.id === targetStyle) || SPEAKING_STYLES[0];
    const genderBaseRatio = targetGender === 'male' ? 0.83 : 1.02;
    const combinedRate = genderBaseRatio * styleObj.rateMultiplier;

    const newLength = Math.max(1, Math.round(decodedBuffer.length / combinedRate));
    const offlineCtx = new OfflineAudioContext(decodedBuffer.numberOfChannels, newLength, decodedBuffer.sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = decodedBuffer;
    source.playbackRate.value = combinedRate;

    let lastNode: AudioNode = source;
    const addFilter = (f: EqFilter) => {
      const node = offlineCtx.createBiquadFilter();
      node.type = f.type;
      node.frequency.value = f.frequency;
      if (f.Q !== undefined) node.Q.value = f.Q;
      if (f.gain !== undefined) node.gain.value = f.gain;
      lastNode.connect(node);
      lastNode = node;
    };
    addFilter(targetGender === 'male' ? { type: 'lowshelf', frequency: 160, gain: 3.0 } : { type: 'highshelf', frequency: 4500, gain: 1.8 });
    (STYLE_EQ[targetStyle] || []).forEach(addFilter);

    lastNode.connect(offlineCtx.destination);
    source.start(0);
    const renderedBuffer = await offlineCtx.startRendering();
    await audioCtx.close();

    const wavBlob = new Blob([audioBufferToWav(renderedBuffer)], { type: 'audio/wav' });
    return { url: URL.createObjectURL(wavBlob), mime: 'audio/wav' };
  } catch (e) {
    console.warn('Web Audio processing fallback:', e);
    return fallback();
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function cleanFileName(text: string, len = 24): string {
  return text.trim().slice(0, len).replace(/[^a-zA-Z0-9_À-ɏḀ-ỿ]/g, '_');
}

const SPEED_CHIPS = [0.75, 1, 1.25, 1.5, 2];

interface Prefs {
  engine?: Engine;
  rate?: number;
  pitch?: number;
  volume?: number;
  normalize?: boolean;
  voiceURI?: string;
  langMode?: string;
  preset?: string;
}

function clampNum(v: unknown, min: number, max: number, def: number): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

export default function TextToSpeechPage() {
  const { showToast, keys } = useApp();
  const ai = useAiSettings();

  /* ---------------- Trạng thái chung ---------------- */
  const [engine, setEngine] = useState<Engine>('browser');
  const [langMode, setLangMode] = useState<'auto' | LangId>('auto');
  const [text, setText] = useState(SUPPORTED_LANGUAGES[0].sampleTexts[0].content);
  const deferredText = useDeferredValue(text);
  const [copied, setCopied] = useState(false);
  const [copiedNorm, setCopiedNorm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const prefsLoaded = useRef(false);

  /* ---------------- Trình duyệt (miễn phí) ---------------- */
  const [normalizeOn, setNormalizeOn] = useState(true);
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [volume, setVolume] = useState(1);
  const [preset, setPreset] = useState('natural');
  const [chosenURI, setChosenURI] = useState('');
  const [voiceQuery, setVoiceQuery] = useState('');
  const [showGuide, setShowGuide] = useState(false);

  const supported = useSyncExternalStore(
    noopSubscribe,
    () => 'speechSynthesis' in window,
    () => false,
  );
  const userAgent = useSyncExternalStore(
    noopSubscribe,
    () => navigator.userAgent,
    () => '',
  );
  const isFirefox = /firefox/i.test(userAgent);
  const isSafari = /safari/i.test(userAgent) && !/chrome|chromium|crios|edg|android/i.test(userAgent);
  const { voices, loading: voicesLoading, reload: reloadVoices } = useSpeechVoices(supported);

  const speaker = useMemo(() => new ChunkSpeaker(), []);
  const player = useSyncExternalStore(speaker.subscribe, speaker.getSnapshot, speaker.getSnapshot);

  /* ---------------- AI Gemini (mở rộng) ---------------- */
  const [selectedVoice, setSelectedVoice] = useState('Puck');
  const [selectedGender, setSelectedGender] = useState<'male' | 'female' | 'all'>('male');
  const [selectedStyle, setSelectedStyle] = useState('natural');
  const [autoAdaptStyleText, setAutoAdaptStyleText] = useState(false);
  const [originalTextBackup, setOriginalTextBackup] = useState<string>('');
  const [speed, setSpeed] = useState(1.0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null);
  const [currentAudioMime, setCurrentAudioMime] = useState<string>('audio/wav');
  const [audioDuration, setAudioDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiBackup, setAiBackup] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /* ---------------- Lịch sử ---------------- */
  const rawTTSHistory = useSyncExternalStore(subscribeStorageSync, getTTSHistorySnapshot, emptyArrayString);
  const historyItems: TTSHistoryItem[] = useMemo(() => {
    try {
      const parsed = JSON.parse(rawTTSHistory);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [rawTTSHistory]);
  const [showHistory, setShowHistory] = useState(false);

  /* ---------------- Ngôn ngữ hiệu dụng ---------------- */
  const detected: DetectedLang = useMemo(() => detectLanguage(deferredText), [deferredText]);
  const effLang: string = langMode === 'auto' ? detected : langMode;
  const aiLangId: LangId = (FIVE_LANGS.includes(effLang) ? effLang : 'en') as LangId;
  const sampleLang: LanguageOption = SUPPORTED_LANGUAGES.find((l) => l.id === (FIVE_LANGS.includes(effLang) ? effLang : 'vi')) || SUPPORTED_LANGUAGES[0];
  const normLang: NormLang = effLang === 'vi' ? 'vi' : effLang === 'en' ? 'en' : 'none';

  /* ---------------- Chọn giọng ---------------- */
  const best = useMemo(() => pickBestVoice(voices, effLang), [voices, effLang]);
  const chosenVoice = chosenURI ? voices.find((v) => v.voiceURI === chosenURI) || null : null;
  const selVoice: SpeechSynthesisVoice | null = chosenVoice || best.voice;
  const voiceMismatch = !!chosenVoice && langPrimary(chosenVoice.lang) !== effLang && !!best.exact;
  const noExactVoice = voices.length > 0 && !best.exact && !chosenVoice;
  const maxChunk = selVoice && !selVoice.localService ? 160 : 190;

  /* ---------------- Văn bản sẽ đọc ---------------- */
  const spoken = useMemo(() => {
    const capped = deferredText.slice(0, MAX_BROWSER_CHARS);
    return normalizeOn ? normalizeForSpeech(capped, { lang: normLang }) : capped.trim();
  }, [deferredText, normalizeOn, normLang]);
  const liveChunks = useMemo(() => splitIntoChunks(spoken, maxChunk), [spoken, maxChunk]);
  const active = player.status !== 'idle';
  const displayChunks = active ? player.chunks : liveChunks;
  const paragraphs = useMemo(() => {
    const out: { idx: number; text: string }[][] = [];
    displayChunks.forEach((c, idx) => {
      if (c.newPara || out.length === 0) out.push([]);
      out[out.length - 1].push({ idx, text: c.text });
    });
    return out;
  }, [displayChunks]);

  const totalChars = useMemo(() => displayChunks.reduce((a, c) => a + c.text.length, 0), [displayChunks]);
  const doneChars = useMemo(() => {
    let n = 0;
    for (let i = 0; i < Math.min(player.index, displayChunks.length); i++) n += displayChunks[i].text.length;
    return n + (active && player.word ? player.word.start : 0);
  }, [displayChunks, player.index, player.word, active]);
  const percent = totalChars > 0 && active ? Math.min(100, Math.round((doneChars / totalChars) * 100)) : 0;
  const estSeconds = useMemo(() => estimateSeconds(spoken, rate), [spoken, rate]);

  const voiceGroups = useMemo(() => groupVoicesByLang(filterVoices(voices, voiceQuery)), [voices, voiceQuery]);

  /* ---------------- Hiệu ứng ---------------- */
  // Nạp tùy chọn đã lưu, văn bản chuyển từ công cụ khác và tham số link chia sẻ (một lần sau khi mount)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (raw) {
          const p = JSON.parse(raw) as Prefs;
          if (p.engine === 'ai' || p.engine === 'browser') setEngine(p.engine);
          setRate(clampNum(p.rate, 0.5, 2, 1));
          setPitch(clampNum(p.pitch, 0.5, 1.5, 1));
          setVolume(clampNum(p.volume, 0, 1, 1));
          if (typeof p.normalize === 'boolean') setNormalizeOn(p.normalize);
          if (typeof p.voiceURI === 'string') setChosenURI(p.voiceURI);
          if (typeof p.preset === 'string') setPreset(p.preset);
          if (p.langMode && (p.langMode === 'auto' || FIVE_LANGS.includes(p.langMode))) setLangMode(p.langMode as 'auto' | LangId);
        }
      } catch {
        /* bỏ qua */
      }
      try {
        const sp = readShareParams();
        if (sp.get('rate')) setRate(clampNum(sp.get('rate'), 0.5, 2, 1));
        if (sp.get('pitch')) setPitch(clampNum(sp.get('pitch'), 0.5, 1.5, 1));
        if (sp.get('vol')) setVolume(clampNum(sp.get('vol'), 0, 1, 1));
        if (sp.get('lang') && FIVE_LANGS.includes(sp.get('lang') as string)) setLangMode(sp.get('lang') as LangId);
        if (sp.get('engine') === 'ai' || sp.get('engine') === 'browser') setEngine(sp.get('engine') as Engine);
      } catch {
        /* bỏ qua */
      }
      try {
        const incoming = sessionStorage.getItem('stt_to_tts_text');
        if (incoming) {
          sessionStorage.removeItem('stt_to_tts_text');
          setText(incoming);
        }
      } catch {
        /* bỏ qua */
      }
      prefsLoaded.current = true;
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!prefsLoaded.current) return;
    try {
      const p: Prefs = { engine, rate, pitch, volume, normalize: normalizeOn, voiceURI: chosenURI, langMode, preset };
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
      /* bỏ qua */
    }
  }, [engine, rate, pitch, volume, normalizeOn, chosenURI, langMode, preset]);

  // Cấu hình giọng cho bộ phát + khởi động lại cụm hiện tại khi người dùng đổi thông số lúc đang đọc
  const cfgKey = `${selVoice?.voiceURI ?? ''}|${rate}|${pitch}|${volume}`;
  useEffect(() => {
    speaker.cfg = { voice: selVoice, lang: LANG_BCP47[effLang as DetectedLang] || 'vi-VN', rate, pitch, volume };
    speaker.onNotice = (m) => showToast(m);
  });
  const prevCfgKey = useRef(cfgKey);
  useEffect(() => {
    if (prevCfgKey.current === cfgKey) return;
    prevCfgKey.current = cfgKey;
    if (player.status !== 'playing') return;
    const t = setTimeout(() => speaker.restartCurrent(), 400);
    return () => clearTimeout(t);
  }, [cfgKey, speaker, player.status]);

  // Dừng đọc khi rời trang / ẩn trang
  useEffect(() => {
    const stopAll = () => speaker.stop();
    window.addEventListener('pagehide', stopAll);
    return () => {
      window.removeEventListener('pagehide', stopAll);
      speaker.stop();
    };
  }, [speaker]);

  // Cuộn tới câu đang đọc (chỉ cuộn trong khung văn bản)
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (player.status === 'idle') return;
    const box = panelRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-chunk="${player.index}"]`);
    if (!box || !el) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top + el.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: Math.max(0, top - 40), behavior: 'smooth' });
    }
  }, [player.index, player.status]);

  /* ---------------- Âm thanh AI: sự kiện <audio> ---------------- */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => setAudioDuration(audio.duration || 0);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [currentAudioUrl]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  /* ---------------- Điều khiển chung ---------------- */
  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    speaker.stop();
    setIsPlaying(false);
  }, [speaker]);

  const switchEngine = (e: Engine) => {
    if (e === engine) return;
    stopAudio();
    setEngine(e);
  };

  const handleLanguageChange = (lang: LanguageOption | 'auto') => {
    if (lang === 'auto') {
      setLangMode('auto');
    } else {
      setLangMode(lang.id);
      const isSample = SUPPORTED_LANGUAGES.some((l) => l.sampleTexts.some((s) => s.content.trim() === text.trim()));
      if (!text.trim() || isSample) setText(lang.sampleTexts[0].content);
    }
    stopAudio();
  };

  const makeChunks = useCallback(
    (raw: string): SpeechChunk[] => {
      const capped = raw.slice(0, MAX_BROWSER_CHARS);
      const lang: DetectedLang = langMode === 'auto' ? detectLanguage(capped) : (langMode as DetectedLang);
      const nl: NormLang = lang === 'vi' ? 'vi' : lang === 'en' ? 'en' : 'none';
      const out = normalizeOn ? normalizeForSpeech(capped, { lang: nl }) : capped.trim();
      return splitIntoChunks(out, maxChunk);
    },
    [langMode, normalizeOn, maxChunk],
  );

  const recordHistory = (t: string) => {
    const top = historyItems[0];
    if (top && top.engine === 'browser' && top.text === t.trim() && Date.now() - top.timestamp < 60000) return;
    const styleObj = SPEAKING_STYLES.find((s) => s.id === preset);
    saveTTSHistoryItem({
      text: t.trim().slice(0, 2000),
      language: effLang,
      voice: selVoice ? `${selVoice.name} (Trình duyệt)` : 'Mặc định (Trình duyệt)',
      style: styleObj?.name || 'Tùy chỉnh',
      engine: 'browser',
    });
  };

  const startBrowserSpeech = (chunks: SpeechChunk[], from = 0, rawForHistory?: string) => {
    if (!supported) {
      showToast('Trình duyệt này không hỗ trợ đọc văn bản (Web Speech). Hãy dùng Chrome, Edge hoặc Safari.');
      return;
    }
    if (chunks.length === 0) {
      showToast('Vui lòng nhập văn bản cần đọc!');
      return;
    }
    if (audioRef.current) audioRef.current.pause();
    speaker.cfg = { voice: selVoice, lang: LANG_BCP47[effLang as DetectedLang] || 'vi-VN', rate, pitch, volume };
    speaker.start(chunks, from);
    if (from === 0) recordHistory(rawForHistory ?? text);
  };

  const togglePlay = () => {
    if (player.status === 'playing') speaker.pause();
    else if (player.status === 'paused') speaker.resume();
    else startBrowserSpeech(liveChunks);
  };

  const skip = (delta: number) => {
    if (player.status === 'idle') {
      startBrowserSpeech(liveChunks, Math.max(0, delta > 0 ? 1 : 0));
      return;
    }
    const target = Math.max(0, Math.min(player.chunks.length - 1, player.index + delta));
    speaker.seek(target);
  };

  const readFromClipboard = async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error('unsupported');
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) {
        showToast('Clipboard đang trống.');
        return;
      }
      setText(clip);
      startBrowserSpeech(makeChunks(clip), 0, clip);
    } catch {
      showToast('Không đọc được clipboard (trình duyệt chưa cấp quyền hoặc không hỗ trợ). Hãy dán văn bản vào ô rồi bấm Đọc.');
    }
  };

  const previewVoice = (v: SpeechSynthesisVoice) => {
    const sample = VOICE_SAMPLES[langPrimary(v.lang)] || VOICE_SAMPLES.en;
    speaker.preview(v, sample, rate, pitch, volume);
  };

  const applyPreset = (id: string) => {
    const st = SPEAKING_STYLES.find((s) => s.id === id);
    if (!st) return;
    setPreset(id);
    setRate(Math.round(clampNum(st.rateMultiplier, 0.5, 2, 1) * 20) / 20);
    setPitch(Math.round(clampNum(st.pitchMultiplier, 0.5, 1.5, 1) * 20) / 20);
  };

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast('Đã sao chép văn bản vào clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Không thể sao chép văn bản.');
    }
  };

  const handleCopyNormalized = async () => {
    try {
      await navigator.clipboard.writeText(spoken);
      setCopiedNorm(true);
      showToast('Đã sao chép văn bản đã chuẩn hóa!');
      setTimeout(() => setCopiedNorm(false), 2000);
    } catch {
      showToast('Không thể sao chép văn bản.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 200 * 1024) {
      showToast('Vui lòng chọn file văn bản nhỏ hơn 200KB!');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setText(content);
        showToast(`Đã nạp nội dung từ "${file.name}"!`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  /* ---------------- AI: tạo giọng Gemini ---------------- */
  const handleGenerateAndPlay = async (customStyle?: string) => {
    if (!text.trim()) {
      showToast('Vui lòng nhập văn bản cần đọc!');
      return;
    }
    const styleToUse = customStyle || selectedStyle;
    stopAudio();

    setIsGenerating(true);
    try {
      const activeVoice = AI_VOICES.find((v) => v.id === selectedVoice);
      const effectiveGender = selectedGender === 'all' ? activeVoice?.gender || 'male' : selectedGender;
      const styleObj = SPEAKING_STYLES.find((s) => s.id === styleToUse) || SPEAKING_STYLES[0];

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (keys.gemini) headers['x-gemini-key'] = keys.gemini.trim();

      const textToSpeak = autoAdaptStyleText ? rewriteTextForStyle(text.trim(), styleToUse, aiLangId) : text.trim();

      const res = await apiFetch('/api/tts', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: textToSpeak, language: aiLangId, voice: selectedVoice, gender: effectiveGender, style: styleToUse }),
      });
      const data = await res.json();

      if (!res.ok || !data.success || !data.audioBase64) {
        if (data.fallbackToBrowser) {
          showToast('Máy chủ giọng AI chưa khả dụng. Chuyển sang giọng trình duyệt (miễn phí).');
          setEngine('browser');
          startBrowserSpeech(makeChunks(text));
        } else {
          showToast(data.error || 'Lỗi khi tạo giọng nói từ AI.');
        }
        return;
      }

      const bytes = base64ToBytes(data.audioBase64);
      const out = await processAudio(bytes.buffer as ArrayBuffer, effectiveGender, data.mimeType || 'audio/wav', styleToUse);
      if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
      setCurrentAudioMime(out.mime);
      setCurrentAudioUrl(out.url);

      saveTTSHistoryItem({
        text: text.trim(),
        language: aiLangId,
        voice: `${selectedVoice} (${effectiveGender === 'male' ? 'Nam' : 'Nữ'})`,
        style: styleObj.name,
        engine: 'ai',
        audioBase64: data.audioBase64.length < 600000 ? data.audioBase64 : undefined,
      });

      showToast(`Đã áp dụng: Giọng ${effectiveGender === 'male' ? 'Nam' : 'Nữ'} · Phong cách: ${styleObj.name}`);
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.playbackRate = speed;
          audioRef.current.play().catch(() => {});
        }
      }, 100);
    } catch {
      showToast('Không thể kết nối máy chủ giọng AI. Đang chuyển sang giọng trình duyệt (miễn phí)...');
      setEngine('browser');
      startBrowserSpeech(makeChunks(text));
    } finally {
      setIsGenerating(false);
    }
  };

  const togglePlayPauseAi = () => {
    if (!audioRef.current || !currentAudioUrl) {
      handleGenerateAndPlay();
      return;
    }
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play();
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) audioRef.current.currentTime = val;
  };

  const triggerDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadSpeech = async (customFilename?: string) => {
    if (currentAudioUrl) {
      const ext = currentAudioMime.includes('wav') ? 'wav' : 'mp3';
      triggerDownload(currentAudioUrl, `speech_${aiLangId}_${selectedStyle}_${cleanFileName(customFilename || text) || 'audio'}.${ext}`);
      showToast('Đang tải file âm thanh về máy!');
      return;
    }
    if (!text.trim()) {
      showToast('Vui lòng nhập văn bản trước khi tải file!');
      return;
    }

    setIsDownloading(true);
    showToast('Đang xử lý và tạo file âm thanh để tải về...');
    try {
      const activeVoice = AI_VOICES.find((v) => v.id === selectedVoice);
      const effectiveGender = selectedGender === 'all' ? activeVoice?.gender || 'male' : selectedGender;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (keys.gemini) headers['x-gemini-key'] = keys.gemini.trim();

      const res = await apiFetch('/api/tts', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: text.trim(), language: aiLangId, voice: selectedVoice, gender: effectiveGender, style: selectedStyle }),
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.audioBase64) throw new Error(data.error || 'Không thể tạo file âm thanh');

      const bytes = base64ToBytes(data.audioBase64);
      const out = await processAudio(bytes.buffer as ArrayBuffer, effectiveGender, data.mimeType || 'audio/wav', selectedStyle);
      setCurrentAudioMime(out.mime);
      setCurrentAudioUrl(out.url);
      const ext = out.mime.includes('wav') ? 'wav' : 'mp3';
      triggerDownload(out.url, `speech_${aiLangId}_${selectedStyle}_${cleanFileName(text) || 'audio'}.${ext}`);
      showToast('Tải file âm thanh thành công!');
    } catch (e) {
      showToast(e instanceof Error && e.message ? e.message : 'Lỗi khi tải file âm thanh.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePlayHistory = (item: TTSHistoryItem) => {
    setText(item.text);
    if (FIVE_LANGS.includes(item.language)) setLangMode(item.language as LangId);
    if (item.audioBase64) {
      const url = URL.createObjectURL(new Blob([base64ToBytes(item.audioBase64) as BlobPart], { type: 'audio/wav' }));
      if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
      setCurrentAudioMime('audio/wav');
      setCurrentAudioUrl(url);
      setEngine('ai');
      setTimeout(() => {
        audioRef.current?.play().catch(() => {});
      }, 100);
      showToast('Đang phát lại đoạn âm thanh đã lưu!');
    } else {
      setEngine(item.engine === 'ai' ? 'ai' : 'browser');
      showToast('Đã khôi phục nội dung văn bản. Bạn có thể nhấn Đọc để phát!');
    }
  };

  const handleDownloadHistoryItem = async (item: TTSHistoryItem) => {
    if (item.audioBase64) {
      const url = URL.createObjectURL(new Blob([base64ToBytes(item.audioBase64) as BlobPart], { type: 'audio/wav' }));
      triggerDownload(url, `tts_history_${item.language}_${cleanFileName(item.text, 20) || 'audio'}.wav`);
      URL.revokeObjectURL(url);
      showToast('Đã tải file âm thanh từ lịch sử!');
    } else {
      setText(item.text);
      if (FIVE_LANGS.includes(item.language)) setLangMode(item.language as LangId);
      setEngine('ai');
      showToast('Mục này chưa có file âm thanh. Hãy bấm "Tạo & Phát âm" ở tab giọng AI để tạo và tải.');
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const filteredVoices = useMemo(() => (selectedGender === 'all' ? AI_VOICES : AI_VOICES.filter((v) => v.gender === selectedGender)), [selectedGender]);
  const currentStyleObj = SPEAKING_STYLES.find((s) => s.id === selectedStyle) || SPEAKING_STYLES[0];
  const currentVoiceObj = AI_VOICES.find((v) => v.id === selectedVoice);

  const handleSelectGenderFilter = (gender: 'male' | 'female' | 'all') => {
    setSelectedGender(gender);
    const current = AI_VOICES.find((v) => v.id === selectedVoice);
    if (gender === 'male' && (!current || current.gender !== 'male')) setSelectedVoice('Puck');
    else if (gender === 'female' && (!current || current.gender !== 'female')) setSelectedVoice('Kore');
    stopAudio();
  };

  const handleApplyStyleToText = (styleId?: string) => {
    const targetStyle = styleId || selectedStyle;
    if (!text.trim()) {
      showToast('Vui lòng nhập hoặc nạp văn bản trước!');
      return;
    }
    if (!originalTextBackup) setOriginalTextBackup(text);
    setText(rewriteTextForStyle(text, targetStyle, aiLangId));
    showToast(`Đã diễn đạt lại văn bản theo phong cách: ${SPEAKING_STYLES.find((s) => s.id === targetStyle)?.name}`);
  };

  const handleRestoreOriginalText = () => {
    if (originalTextBackup) {
      setText(originalTextBackup);
      showToast('Đã khôi phục văn bản gốc ban đầu.');
    }
  };

  const handleSelectStyle = (styleId: string) => {
    setSelectedStyle(styleId);
    const targetObj = SPEAKING_STYLES.find((s) => s.id === styleId);
    showToast(`Đã chọn phong cách: ${targetObj?.name} (${targetObj?.badge})`);
    if (autoAdaptStyleText && text.trim()) {
      if (!originalTextBackup) setOriginalTextBackup(text);
      setText(rewriteTextForStyle(text, styleId, aiLangId));
    }
    if (currentAudioUrl || isPlaying) handleGenerateAndPlay(styleId);
  };

  /* ---------------- AI: viết lại cho dễ nghe ---------------- */
  const runAiRewrite = async (kind: 'tldr' | 'bullets' | 'punctuate') => {
    if (!text.trim()) {
      showToast('Vui lòng nhập văn bản trước!');
      return;
    }
    setAiBusy(kind);
    try {
      const out =
        kind === 'punctuate'
          ? await callAi({ ai: ai.config, task: 'punctuate', input: text.slice(0, 50000), options: { language: 'auto', paragraphs: true, removeFillers: false } })
          : await callAi({ ai: ai.config, task: 'summarize', input: text.slice(0, 50000), options: { style: kind, length: 'short', language: 'auto' } });
      setAiBackup((prev) => prev ?? text);
      setText(out.trim());
      showToast('Đã viết lại văn bản. Bấm "Hoàn tác" để quay về bản gốc.');
    } catch (e) {
      const err = toAiError(e);
      if (!err.aborted) showToast(err.message);
    } finally {
      setAiBusy(null);
    }
  };

  const undoAiRewrite = () => {
    if (aiBackup !== null) {
      setText(aiBackup);
      setAiBackup(null);
    }
  };

  /* ---------------- Giao diện ---------------- */
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const aiReady = ai.isAiReady('any');
  const geminiReady = ai.isAiReady('gemini');
  const hasChunks = liveChunks.length > 0;
  const viMissing = effLang === 'vi' && noExactVoice;

  const textCard = (
    <div className="bg-white rounded-xl border border-border p-4 shadow-xs space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">{langMode === 'auto' ? '🌐' : sampleLang.flag}</span>
          <div className="min-w-0">
            <h2 className="font-semibold text-sm text-slate-900">Văn bản đầu vào</h2>
            <p className="text-[11px] text-slate-500">
              {langMode === 'auto' ? 'Tự nhận diện: ' : 'Ngôn ngữ: '}
              <span className="font-medium text-indigo-600">{langLabel(effLang)}</span>
              <span className="font-mono text-slate-400"> · {LANG_BCP47[effLang as DetectedLang] || effLang}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {engine === 'ai' && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleApplyStyleToText()}
                className="h-7 text-xs px-2.5 text-amber-800 bg-amber-50 hover:bg-amber-100 border-amber-300 font-medium"
                data-tooltip="Biến đổi văn bản đầu vào theo phong cách diễn đạt đang chọn"
              >
                <Wand2 className="h-3.5 w-3.5 mr-1 text-amber-600" />
                Diễn đạt lại theo phong cách
              </Button>
              {originalTextBackup && (
                <Button variant="ghost" size="sm" onClick={handleRestoreOriginalText} className="h-7 text-xs px-2 text-slate-600 hover:text-slate-900" data-tooltip="Khôi phục lại văn bản ban đầu">
                  <RotateCcw className="h-3 w-3 mr-1 text-slate-500" />
                  Bản gốc
                </Button>
              )}
            </>
          )}
          <Button variant="ghost" size="sm" onClick={readFromClipboard} className="h-7 text-xs px-2 text-slate-600 hover:text-slate-900" data-tooltip="Dán văn bản từ clipboard và đọc ngay" disabled={engine === 'ai'}>
            <ClipboardPaste className="h-3.5 w-3.5 mr-1" />
            Đọc từ clipboard
          </Button>
          <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} className="h-7 text-xs px-2 text-slate-600 hover:text-slate-900" data-tooltip="Tải văn bản từ file .txt hoặc .md">
            <Upload className="h-3.5 w-3.5 mr-1" />
            Nạp file
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCopyText} className="h-7 text-xs px-2 text-slate-600 hover:text-slate-900" data-tooltip="Sao chép văn bản gốc">
            {copied ? <Check className="h-3.5 w-3.5 mr-1 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
            {copied ? 'Đã chép' : 'Sao chép'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setText('');
              setOriginalTextBackup('');
              setAiBackup(null);
              speaker.stop();
            }}
            className="h-7 text-xs px-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
            data-tooltip="Xóa trắng"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Xóa
          </Button>
        </div>
      </div>

      <div className="relative">
        <textarea
          data-handoff
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nhập hoặc dán đoạn văn bản cần chuyển thành giọng nói (tiếng Việt, Anh, Trung, Nhật, Hàn, Nga, Thái...)"
          rows={7}
          className="w-full text-sm p-3.5 rounded-lg border border-slate-200 bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-hidden transition resize-y font-sans leading-relaxed text-slate-800"
        />
        <div className="flex flex-wrap items-center justify-between gap-x-3 text-[11px] text-slate-400 mt-1.5 px-1">
          <span>
            {wordCount} từ · {text.length.toLocaleString('vi-VN')} ký tự
            {engine === 'browser' && hasChunks && ` · ${liveChunks.length} câu · khoảng ${formatDuration(estSeconds)}`}
          </span>
          {text.length > MAX_BROWSER_CHARS && engine === 'browser' && (
            <span className="text-amber-600">Giọng trình duyệt chỉ đọc {MAX_BROWSER_CHARS.toLocaleString('vi-VN')} ký tự đầu.</span>
          )}
        </div>
      </div>

      <div className="pt-2 border-t border-slate-100">
        <div className="flex items-center gap-1.5 mb-2">
          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-xs font-semibold text-slate-700">Mẫu câu nhanh ({sampleLang.name}):</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {sampleLang.sampleTexts.map((sample, idx) => (
            <button
              key={idx}
              onClick={() => setText(sample.content)}
              className="text-xs text-left px-2.5 py-1.5 rounded-md bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200/80 hover:border-indigo-200 text-slate-700 transition"
            >
              <span className="font-medium block">{sample.title}</span>
            </button>
          ))}
          <button
            onClick={() => setText('Hôm nay là thứ 3, ngày 5/3/2024. Cuộc họp bắt đầu lúc 14:30 tại Q.1, TP.HCM. Chi phí dự kiến 1.234.567đ (tăng 12,5%), liên hệ 0912 345 678 hoặc an@gmail.com.')}
            className="text-xs text-left px-2.5 py-1.5 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 transition"
            data-tooltip="Văn bản có số, ngày giờ, tiền, viết tắt để thử bộ chuẩn hóa"
          >
            <span className="font-medium block">Thử chuẩn hóa số &amp; ngày giờ</span>
          </button>
        </div>
      </div>
    </div>
  );

  const aiRewriteCard = (
    <AiSection
      requires="any"
      title="Rút gọn / viết lại cho dễ nghe"
      description="Dùng AI để tóm tắt, gạch đầu dòng hoặc thêm dấu câu cho văn bản dài trước khi đọc. Có khóa AI thì mở thêm tính năng này."
      className={aiReady ? '' : 'min-h-[210px]'}
    >
      <div className="bg-white rounded-xl border border-border p-3.5 shadow-xs flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 mr-1">
          <Wand2 className="h-3.5 w-3.5 text-indigo-600" />
          Viết lại cho dễ nghe (AI):
        </span>
        <Button variant="outline" size="sm" disabled={!!aiBusy} onClick={() => runAiRewrite('tldr')} className="h-7 text-xs">
          {aiBusy === 'tldr' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1 text-amber-500" />}
          Rút gọn (TL;DR)
        </Button>
        <Button variant="outline" size="sm" disabled={!!aiBusy} onClick={() => runAiRewrite('bullets')} className="h-7 text-xs">
          {aiBusy === 'bullets' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <ListChecks className="h-3.5 w-3.5 mr-1 text-emerald-600" />}
          Gạch đầu dòng
        </Button>
        <Button variant="outline" size="sm" disabled={!!aiBusy} onClick={() => runAiRewrite('punctuate')} className="h-7 text-xs">
          {aiBusy === 'punctuate' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1 text-indigo-600" />}
          Thêm dấu câu
        </Button>
        {aiBackup !== null && (
          <Button variant="ghost" size="sm" onClick={undoAiRewrite} className="h-7 text-xs text-slate-600">
            <Undo2 className="h-3.5 w-3.5 mr-1" />
            Hoàn tác
          </Button>
        )}
      </div>
    </AiSection>
  );

  /* ---------- Tab giọng trình duyệt ---------- */
  const playerCard = (
    <div className="bg-slate-900 text-white rounded-xl p-4 sm:p-5 shadow-lg space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <Headphones className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight">Trình phát giọng trình duyệt</h3>
            <p className="text-[11px] text-slate-400 truncate">
              {selVoice ? `${selVoice.name} · ${selVoice.lang}` : voicesLoading ? 'Đang tải danh sách giọng...' : 'Giọng mặc định của hệ thống'}
            </p>
          </div>
        </div>
        <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold shrink-0">Miễn phí</span>
      </div>

      <div className="space-y-1.5">
        <input
          type="range"
          min={0}
          max={Math.max(0, displayChunks.length - 1)}
          step={1}
          value={Math.min(player.index, Math.max(0, displayChunks.length - 1))}
          onChange={(e) => (active ? speaker.seek(parseInt(e.target.value, 10)) : startBrowserSpeech(liveChunks, parseInt(e.target.value, 10)))}
          disabled={!hasChunks}
          aria-label="Tua theo câu"
          className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 disabled:opacity-40"
        />
        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-emerald-500 transition-all duration-200" style={{ width: `${percent}%` }} />
        </div>
        <div className="flex justify-between text-[11px] text-slate-400 font-mono">
          <span>{active ? `Câu ${player.index + 1}/${displayChunks.length}` : `${displayChunks.length} câu`}</span>
          <span>{active ? `${percent}%` : `≈ ${formatDuration(estSeconds)}`}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-800/80">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => skip(-1)}
            disabled={!hasChunks || (active && player.index === 0)}
            className="h-10 px-3 border-slate-700 hover:bg-slate-800 text-slate-200"
            data-tooltip="Câu trước" aria-label="Câu trước"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            onClick={togglePlay}
            disabled={!supported || !hasChunks}
            className="h-10 px-5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg shadow-sm gap-2"
          >
            {player.status === 'playing' ? (
              <>
                <Pause className="h-4 w-4" />
                <span>Tạm dừng</span>
              </>
            ) : player.status === 'paused' ? (
              <>
                <Play className="h-4 w-4 fill-white" />
                <span>Tiếp tục</span>
              </>
            ) : (
              <>
                <Play className="h-4 w-4 fill-white" />
                <span>Đọc</span>
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => skip(1)}
            disabled={!hasChunks || (active && player.index >= player.chunks.length - 1)}
            className="h-10 px-3 border-slate-700 hover:bg-slate-800 text-slate-200"
            data-tooltip="Câu sau" aria-label="Câu sau"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
          <Button variant="ghost" onClick={() => speaker.stop()} disabled={!active} className="h-10 px-3 hover:bg-slate-800 text-slate-400 hover:text-white" data-tooltip="Dừng" aria-label="Dừng">
            <Square className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-[11px] text-slate-500 max-w-[16rem] leading-snug">
          Giọng trình duyệt không xuất được file âm thanh. Cần file WAV? Dùng tab giọng AI Gemini.
        </p>
      </div>
    </div>
  );

  const readingPanel = (
    <div className="bg-white rounded-xl border border-border p-4 shadow-xs space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-slate-900">Văn bản sẽ được đọc</h3>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${normalizeOn && normLang !== 'none' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
            {normalizeOn ? (normLang === 'none' ? 'Đã làm sạch markdown/emoji' : `Đã chuẩn hóa (${normLang === 'vi' ? 'tiếng Việt' : 'tiếng Anh'})`) : 'Văn bản gốc'}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleCopyNormalized} disabled={!spoken} className="h-7 text-xs px-2 text-slate-600 hover:text-slate-900">
          {copiedNorm ? <Check className="h-3.5 w-3.5 mr-1 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
          {copiedNorm ? 'Đã chép' : 'Sao chép bản chuẩn hóa'}
        </Button>
      </div>
      <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer select-none">
        <input type="checkbox" checked={normalizeOn} onChange={(e) => setNormalizeOn(e.target.checked)} className="mt-0.5 rounded border-slate-300 text-emerald-600 h-3.5 w-3.5" />
        <span>
          <b>Chuẩn hóa văn bản trước khi đọc</b> - đọc số thành chữ (1.234.567, 21, 105, 0,5, 50%), ngày giờ (05/03/2024, 14:30), tiền (100k, 2tr, 50.000đ, $), đơn vị (km, kg, m2, °C, GB), viết tắt (TP.HCM, Q.1, UBND), email/URL, và bỏ markdown/emoji.
        </span>
      </label>
      {hasChunks ? (
        <div ref={panelRef} className="relative max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-800 space-y-2">
          {paragraphs.map((para, pi) => (
            <p key={pi}>
              {para.map(({ idx, text: ct }) => {
                const isActive = active && idx === player.index;
                const w = isActive ? player.word : null;
                return (
                  <span
                    key={idx}
                    data-chunk={idx}
                    onClick={() => (active ? speaker.seek(idx) : startBrowserSpeech(liveChunks, idx))}
                    data-tooltip="Bấm để đọc từ câu này"
                    className={`cursor-pointer rounded px-0.5 transition-colors ${isActive ? 'bg-amber-100 ring-1 ring-amber-300' : 'hover:bg-indigo-50'}`}
                  >
                    {w && w.end <= ct.length ? (
                      <>
                        {ct.slice(0, w.start)}
                        <mark className="bg-amber-300 text-slate-900 rounded px-0.5">{ct.slice(w.start, w.end)}</mark>
                        {ct.slice(w.end)}
                      </>
                    ) : (
                      ct
                    )}{' '}
                  </span>
                );
              })}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400 italic py-3 text-center">Nhập văn bản ở trên để xem bản sẽ được đọc.</p>
      )}
    </div>
  );

  const unsupportedCard = (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 space-y-1.5">
      <div className="flex items-center gap-2 font-semibold text-sm">
        <AlertTriangle className="h-4 w-4" />
        Trình duyệt này không hỗ trợ đọc văn bản (Web Speech Synthesis)
      </div>
      <p>Hãy mở trang bằng Google Chrome, Microsoft Edge hoặc Safari (máy tính / điện thoại) để dùng giọng miễn phí. Firefox bản cũ hoặc trình duyệt nhúng (in-app) thường không có tính năng này.</p>
      {geminiReady && <p>Bạn đã có khóa Gemini - có thể dùng tab &quot;Giọng AI Gemini&quot; thay thế.</p>}
    </div>
  );

  const voiceCard = (
    <div className="bg-white rounded-xl border border-border p-4 sm:p-5 shadow-xs space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-emerald-600" />
          <h2 className="font-semibold text-sm text-slate-900">Giọng đọc &amp; tốc độ</h2>
        </div>
        <div className="flex items-center gap-2">
          <ShareLinkButton params={{ engine: 'browser', rate: String(rate), pitch: String(pitch), vol: String(volume), lang: langMode === 'auto' ? undefined : langMode }} />
          <button type="button" onClick={() => setShowHistory(!showHistory)} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1">
            <History className="h-3.5 w-3.5" />
            <span>Lịch sử ({historyItems.length})</span>
          </button>
        </div>
      </div>

      {!supported ? (
        unsupportedCard
      ) : (
        <>
          {viMissing && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-2">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                Máy bạn chưa có giọng tiếng Việt
              </div>
              <p>
                Đang tạm dùng giọng <b>{best.voice?.name}</b> ({best.voice?.lang}) - sẽ đọc tiếng Việt sai dấu và âm. Cài thêm giọng Việt (miễn phí) để nghe chuẩn:
              </p>
              <button type="button" onClick={() => setShowGuide(!showGuide)} className="font-semibold underline underline-offset-2">
                {showGuide ? 'Ẩn hướng dẫn cài giọng' : 'Xem hướng dẫn cài giọng tiếng Việt'}
              </button>
              {showGuide && (
                <ul className="space-y-1.5 pt-1">
                  {viVoiceGuides().map((g) => (
                    <li key={g.os}>
                      <b>{g.os}:</b> {g.steps}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {voiceMismatch && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 flex flex-wrap items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="flex-1 min-w-[12rem]">
                Giọng đã chọn ({chosenVoice?.lang}) không khớp ngôn ngữ văn bản ({langLabel(effLang)}).
              </span>
              <button type="button" onClick={() => setChosenURI('')} className="px-2 py-1 rounded-md bg-amber-600 text-white font-semibold hover:bg-amber-700">
                Dùng giọng tự động
              </button>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-semibold text-slate-700">Chọn giọng ({voices.length}):</label>
              <button type="button" onClick={reloadVoices} className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center gap-1" data-tooltip="Tải lại danh sách giọng">
                <RefreshCw className={`h-3 w-3 ${voicesLoading ? 'animate-spin' : ''}`} />
                Tải lại
              </button>
            </div>
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={voiceQuery}
                onChange={(e) => setVoiceQuery(e.target.value)}
                placeholder="Tìm giọng hoặc ngôn ngữ (vd. Hoai My, vi-VN, Nhật)"
                className="w-full text-xs pl-8 pr-2.5 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500"
              />
            </div>

            {voicesLoading && voices.length === 0 ? (
              <p className="text-xs text-slate-500 flex items-center gap-2 py-3">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Đang tải danh sách giọng của trình duyệt...
              </p>
            ) : voices.length === 0 ? (
              <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
                <p>Trình duyệt chưa báo giọng nào. Vẫn có thể bấm <b>Đọc</b> để dùng giọng mặc định của hệ thống.</p>
                {isFirefox && <p>Firefox thường có rất ít giọng (phụ thuộc hệ điều hành). Chrome hoặc Edge sẽ có nhiều giọng hơn.</p>}
                <button type="button" onClick={reloadVoices} className="font-semibold text-indigo-600 hover:underline">
                  Thử tải lại danh sách giọng
                </button>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                <button
                  type="button"
                  onClick={() => setChosenURI('')}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 ${!chosenURI ? 'bg-emerald-50 text-emerald-900' : 'hover:bg-slate-50 text-slate-800'}`}
                >
                  <span>
                    <b>Tự động (khuyên dùng)</b>
                    <span className="block text-[11px] text-slate-500">
                      Chọn giọng hợp với ngôn ngữ văn bản: {best.voice ? best.voice.name : 'mặc định hệ thống'}
                    </span>
                  </span>
                  {!chosenURI && <Check className="h-4 w-4 text-emerald-600 shrink-0" />}
                </button>
                {voiceGroups.length === 0 && <p className="px-3 py-3 text-xs text-slate-500 italic">Không có giọng khớp &quot;{voiceQuery}&quot;.</p>}
                {voiceGroups.map((g) => (
                  <div key={g.lang}>
                    <div className="sticky top-0 bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600 flex items-center gap-1.5">
                      <Globe className="h-3 w-3" />
                      {g.label} <span className="font-normal text-slate-400">({g.voices.length})</span>
                      {g.lang === 'vi' && <span className="ml-auto text-emerald-700">ưu tiên</span>}
                    </div>
                    {g.voices.map((v) => {
                      const sel = selVoice?.voiceURI === v.voiceURI && !!chosenURI;
                      return (
                        <div key={v.voiceURI + v.lang + v.name} className={`flex items-center gap-2 px-3 py-1.5 text-xs ${sel ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
                          <button type="button" onClick={() => setChosenURI(v.voiceURI)} className="flex-1 min-w-0 text-left">
                            <span className="font-medium text-slate-900 block truncate">{v.name}</span>
                            <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
                              <span className="font-mono">{v.lang}</span>
                              {v.localService ? (
                                <span className="inline-flex items-center gap-0.5 px-1.5 rounded bg-emerald-100 text-emerald-700 font-semibold">
                                  <HardDrive className="h-2.5 w-2.5" />
                                  Cục bộ
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 px-1.5 rounded bg-sky-100 text-sky-700 font-semibold" data-tooltip="Cần mạng, có thể có độ trễ">
                                  <Wifi className="h-2.5 w-2.5" />
                                  Mạng
                                </span>
                              )}
                              {v.default && <span className="px-1.5 rounded bg-slate-200 text-slate-700">Mặc định</span>}
                            </span>
                          </button>
                          <button type="button" onClick={() => previewVoice(v)} className="shrink-0 h-7 px-2 rounded-md border border-slate-200 text-slate-600 hover:bg-white flex items-center gap-1" data-tooltip="Nghe thử giọng này">
                            <Volume2 className="h-3 w-3" />
                            Nghe thử
                          </button>
                          {sel && <Check className="h-4 w-4 text-emerald-600 shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2.5 pt-2 border-t border-slate-100">
            <label className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-amber-500" />
              Kiểu đọc có sẵn:
            </label>
            <div className="flex flex-wrap gap-1.5">
              {SPEAKING_STYLES.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => applyPreset(st.id)}
                  data-tooltip={st.description}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition ${
                    preset === st.id ? 'border-amber-500 bg-amber-50 text-amber-900 ring-1 ring-amber-400' : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {st.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-semibold text-slate-700">Tốc độ đọc:</span>
                <span className="font-mono text-indigo-600 font-bold">{rate.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.05"
                value={rate}
                onChange={(e) => {
                  setRate(parseFloat(e.target.value));
                  setPreset('');
                }}
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {SPEED_CHIPS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setRate(c);
                      setPreset('');
                    }}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-mono border ${rate === c ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    {c}x
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-semibold text-slate-700">Cao độ:</span>
                <span className="font-mono text-indigo-600 font-bold">{pitch.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="1.5"
                step="0.05"
                value={pitch}
                onChange={(e) => {
                  setPitch(parseFloat(e.target.value));
                  setPreset('');
                }}
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
            </div>
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-semibold text-slate-700">Âm lượng:</span>
                <span className="font-mono text-indigo-600 font-bold">{Math.round(volume * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
            </div>
            <p className="text-[11px] text-slate-500">Thay đổi khi đang đọc sẽ áp dụng ngay (đọc lại từ đầu câu hiện tại). iOS thường bỏ qua âm lượng - hãy chỉnh âm lượng máy.</p>
          </div>

          <details className="text-xs text-slate-600 pt-2 border-t border-slate-100">
            <summary className="cursor-pointer font-semibold text-slate-700">Mẹo &amp; xử lý sự cố</summary>
            <ul className="list-disc pl-4 mt-2 space-y-1">
              <li>Văn bản dài được tự chia thành từng câu (≤ {maxChunk} ký tự) để Chrome không tự dừng sau ~15 giây.</li>
              <li>Bấm vào một câu trong khung &quot;Văn bản sẽ được đọc&quot; để đọc từ đó.</li>
              <li>Giọng &quot;Cục bộ&quot; chạy ngay trên máy, ổn định hơn; giọng &quot;Mạng&quot; (Google, Edge Online) hay hơn nhưng cần Internet.</li>
              {isSafari && <li>Safari / iOS: phải bấm nút Đọc trực tiếp (không tự phát), và có thể bỏ qua tạm dừng - khi đó &quot;Tiếp tục&quot; đọc lại từ đầu câu.</li>}
              {isFirefox && <li>Firefox có ít giọng và không có sẵn tiếng Việt trên nhiều hệ điều hành; hãy cài giọng hệ thống hoặc dùng Chrome / Edge.</li>}
              <li>Không nghe thấy gì? Kiểm tra âm lượng, bỏ chế độ im lặng (iPhone), thử giọng &quot;Cục bộ&quot; khác hoặc bấm &quot;Tải lại&quot; danh sách giọng.</li>
            </ul>
          </details>
        </>
      )}
    </div>
  );

  /* ---------- Tab giọng AI Gemini ---------- */
  const aiPlayer = (
    <div className="bg-slate-900 text-white rounded-xl p-5 shadow-lg space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
            <Headphones className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2 flex-wrap">
              <span>Audio Studio Player</span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  currentVoiceObj?.gender === 'male' || selectedGender === 'male'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                    : 'bg-pink-500/20 text-pink-300 border border-pink-500/30'
                }`}
              >
                {currentVoiceObj?.gender === 'male' || selectedGender === 'male' ? '👨 Giọng Nam' : '👩 Giọng Nữ'}
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              Mô hình: {selectedVoice} ({currentVoiceObj?.gender === 'male' || selectedGender === 'male' ? 'Nam' : 'Nữ'}) · {SUPPORTED_LANGUAGES.find((l) => l.id === aiLangId)?.name}
            </p>
          </div>
        </div>
        <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5 font-medium text-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          AI Neural
        </span>
      </div>

      <div className="flex items-center justify-between bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/60 text-xs gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Mic2 className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-slate-300 font-medium">Phong cách hiện tại:</span>
          <span className="font-bold text-amber-300">{currentStyleObj.name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/30 font-mono">{currentStyleObj.badge}</span>
        </div>
        <div className="text-[11px] text-slate-400 hidden sm:block">
          Tốc độ hiệu dụng: <span className="font-mono text-cyan-300 font-bold">{(speed * currentStyleObj.rateMultiplier).toFixed(2)}x</span>
        </div>
      </div>

      <div className="h-12 bg-slate-950/60 rounded-lg border border-slate-800 flex items-center justify-center gap-1 px-4 overflow-hidden">
        {Array.from({ length: 48 }).map((_, i) => {
          const heightPercent = isPlaying ? Math.sin(i * 0.4 + currentTime * 8) * 40 + 50 : Math.sin(i * 0.3) * 15 + 25;
          return (
            <div
              key={i}
              style={{ height: `${Math.max(10, Math.min(95, heightPercent))}%` }}
              className={`w-1 rounded-full transition-all duration-75 ${
                isPlaying ? (selectedGender === 'male' ? 'bg-gradient-to-t from-cyan-500 to-indigo-400' : 'bg-gradient-to-t from-pink-500 to-indigo-400') : 'bg-slate-700/60'
              }`}
            />
          );
        })}
      </div>

      <div className="space-y-1">
        <input
          type="range"
          min="0"
          max={audioDuration || 100}
          step="0.01"
          value={currentTime}
          onChange={handleSeek}
          disabled={!currentAudioUrl}
          aria-label="Tua âm thanh"
          className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 disabled:opacity-40"
        />
        <div className="flex justify-between text-[11px] text-slate-400 font-mono">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(audioDuration)}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-800/80">
        <div className="flex items-center gap-2">
          <Button onClick={() => handleGenerateAndPlay()} disabled={isGenerating || !text.trim()} className="h-10 px-5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg shadow-sm gap-2">
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Đang tạo âm thanh...</span>
              </>
            ) : (
              <>
                <Play className="h-4 w-4 fill-white" />
                <span>Tạo &amp; Phát âm</span>
              </>
            )}
          </Button>
          {currentAudioUrl && (
            <Button variant="outline" onClick={togglePlayPauseAi} className="h-10 px-3 border-slate-700 hover:bg-slate-800 text-slate-200" data-tooltip={isPlaying ? 'Tạm dừng' : 'Tiếp tục phát'}>
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
          )}
          <Button variant="ghost" onClick={stopAudio} className="h-10 px-3 hover:bg-slate-800 text-slate-400 hover:text-white" data-tooltip="Dừng phát" aria-label="Dừng phát">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
        <Button
          variant="outline"
          onClick={() => handleDownloadSpeech()}
          disabled={isDownloading || !text.trim()}
          className="h-10 px-4 border-slate-700 hover:bg-slate-800 text-emerald-400 hover:text-emerald-300 gap-2 text-xs font-semibold shadow-xs"
          data-tooltip="Tải đoạn âm thanh đã tạo về máy tính (.wav/.mp3)"
        >
          {isDownloading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
              <span>Đang xử lý tải...</span>
            </>
          ) : (
            <>
              <Download className="h-4 w-4 text-emerald-400" />
              <span>Tải file âm thanh</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );

  const aiSettings = (
    <div className="bg-white rounded-xl border border-border p-5 shadow-xs space-y-5">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-indigo-600" />
          <h2 className="font-semibold text-sm text-slate-900">Thiết lập giọng AI Gemini</h2>
        </div>
        <button type="button" onClick={() => setShowHistory(!showHistory)} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1">
          <History className="h-3.5 w-3.5" />
          <span>Lịch sử ({historyItems.length})</span>
        </button>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <User className="h-3.5 w-3.5 text-indigo-600" />
            <span>Chọn Giới tính giọng đọc:</span>
          </label>
          <span className="text-[11px] font-medium text-indigo-600">
            {selectedGender === 'male' ? 'Đang chọn Giọng Nam' : selectedGender === 'female' ? 'Đang chọn Giọng Nữ' : 'Tất cả giọng'}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-lg">
          {(
            [
              ['male', '👨 Giọng Nam', 'bg-white text-cyan-800 shadow-xs ring-1 ring-cyan-500'],
              ['female', '👩 Giọng Nữ', 'bg-white text-pink-800 shadow-xs ring-1 ring-pink-500'],
              ['all', `Tất cả (${AI_VOICES.length})`, 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-300'],
            ] as const
          ).map(([g, label, activeCls]) => (
            <button
              key={g}
              type="button"
              onClick={() => handleSelectGenderFilter(g)}
              className={`py-1.5 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 ${selectedGender === g ? activeCls : 'text-slate-600 hover:text-slate-900'}`}
            >
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-700 block">Danh sách nhân vật giọng AI ({filteredVoices.length} lựa chọn):</label>
        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
          {filteredVoices.map((v) => {
            const isSelected = selectedVoice === v.id;
            const isMale = v.gender === 'male';
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setSelectedVoice(v.id);
                  setSelectedGender(v.gender);
                  stopAudio();
                }}
                className={`w-full p-2.5 rounded-lg border text-left transition-all flex items-start justify-between ${
                  isSelected
                    ? isMale
                      ? 'border-cyan-600 bg-cyan-50/60 text-cyan-950 ring-1 ring-cyan-500'
                      : 'border-pink-600 bg-pink-50/60 text-pink-950 ring-1 ring-pink-500'
                    : 'border-slate-200 hover:border-slate-300 bg-white text-slate-800'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-xs">{v.name}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isMale ? 'bg-cyan-100 text-cyan-700' : 'bg-pink-100 text-pink-700'}`}>{isMale ? 'Nam' : 'Nữ'}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{v.tone}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 leading-snug">{v.description}</p>
                </div>
                {isSelected && <div className={`h-2.5 w-2.5 rounded-full mt-1.5 shrink-0 ${isMale ? 'bg-cyan-600' : 'bg-pink-600'}`} />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2.5 pt-2 border-t border-slate-100">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <label className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-amber-500" />
            <span>Phong cách diễn đạt (Acoustic &amp; Style Profile):</span>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-amber-900 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200/80 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoAdaptStyleText}
              onChange={(e) => setAutoAdaptStyleText(e.target.checked)}
              className="rounded border-amber-300 text-amber-600 focus:ring-amber-500 h-3 w-3"
            />
            <span>Tự động biến đổi ngữ điệu lời đọc</span>
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SPEAKING_STYLES.map((st) => {
            const isSelected = selectedStyle === st.id;
            return (
              <div
                key={st.id}
                onClick={() => handleSelectStyle(st.id)}
                className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer relative ${
                  isSelected ? 'border-amber-500 bg-amber-50/70 text-amber-950 ring-1 ring-amber-400 shadow-xs' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60 text-slate-800'
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="font-bold text-xs leading-tight">{st.name}</span>
                  {isSelected && <div className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />}
                </div>
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded font-mono ${isSelected ? 'bg-amber-200/70 text-amber-900' : 'bg-slate-100 text-slate-600'}`}>{st.badge}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectStyle(st.id);
                      handleApplyStyleToText(st.id);
                    }}
                    className="text-[10px] font-medium text-amber-700 hover:text-amber-900 hover:bg-amber-100/80 px-1.5 py-0.5 rounded transition flex items-center gap-1"
                    data-tooltip="Áp dụng cấu trúc văn phong này vào khung soạn thảo"
                  >
                    <Wand2 className="h-2.5 w-2.5" />
                    Đổi lời văn
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 leading-snug line-clamp-2">{st.description}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-3 pt-2 border-t border-slate-100">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="font-semibold text-slate-700">Tốc độ phát gốc (Base Speed):</span>
          <span className="font-mono text-indigo-600 font-bold">{speed}x</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400">0.5x</span>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            className="flex-1 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
          />
          <span className="text-[10px] text-slate-400">2.0x</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-3.5">
      <audio ref={audioRef} src={currentAudioUrl || undefined} preload="auto" />
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".txt,.md,.text" className="hidden" />

      {/* Header */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0">
            <Volume2 className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-sm sm:text-base font-bold tracking-tight">Chuyển văn bản thành giọng nói (Text-to-Speech)</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">Miễn phí trên trình duyệt</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Giọng trình duyệt không cần khóa · chuẩn hóa số, ngày giờ, tiền tiếng Việt · thêm khóa Gemini để có giọng AI &amp; xuất file
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-medium text-slate-400 mr-1 hidden md:inline">Ngôn ngữ:</span>
          <button
            onClick={() => handleLanguageChange('auto')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition flex items-center gap-1 ${
              langMode === 'auto' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700/60'
            }`}
            data-tooltip="Tự nhận diện ngôn ngữ từ văn bản"
          >
            <span>🌐</span>
            <span>Tự động</span>
          </button>
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              key={lang.id}
              onClick={() => handleLanguageChange(lang)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition flex items-center gap-1 ${
                langMode === lang.id ? 'bg-indigo-600 text-white shadow-xs' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700/60'
              }`}
            >
              <span>{lang.flag}</span>
              <span>{lang.name}</span>
            </button>
          ))}
        </div>
      </div>

      <AiKeyNotice />

      {/* Engine switch */}
      <div role="tablist" aria-label="Công nghệ phát giọng" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          type="button"
          role="tab"
          aria-selected={engine === 'browser'}
          onClick={() => switchEngine('browser')}
          className={`p-3 rounded-xl border text-left transition-all ${engine === 'browser' ? 'border-emerald-600 bg-emerald-50/60 ring-1 ring-emerald-500' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-slate-900">Giọng trình duyệt - miễn phí</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Không cần khóa</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-tight">Web Speech API: dùng giọng có sẵn của máy, chuẩn hóa số/ngày giờ tiếng Việt, tô sáng câu đang đọc, tua theo câu.</p>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={engine === 'ai'}
          onClick={() => switchEngine('ai')}
          className={`p-3 rounded-xl border text-left transition-all ${engine === 'ai' ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-500' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-slate-900">Giọng AI Gemini - cần khóa</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${geminiReady ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'}`}>{geminiReady ? 'Đã có khóa' : 'Cần khóa Gemini'}</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-tight">Giọng thần kinh tự nhiên, Nam/Nữ, 6 phong cách, tải file WAV/MP3 về máy.</p>
        </button>
      </div>

      {engine === 'browser' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
          <div className="lg:col-span-7 space-y-3">
            {textCard}
            {!supported ? unsupportedCard : null}
            {playerCard}
            {readingPanel}
            {aiRewriteCard}
          </div>
          <div className="lg:col-span-5 space-y-4">{voiceCard}</div>
        </div>
      ) : (
        <div className="space-y-3">
          {textCard}
          {aiRewriteCard}
          <AiSection
            requires="gemini"
            title="Giọng AI Gemini"
            description="Giọng thần kinh tự nhiên (Nam/Nữ, 6 phong cách), xuất và tải file âm thanh. Giọng trình duyệt miễn phí vẫn dùng được ở tab bên cạnh."
            className={geminiReady ? '' : 'min-h-[560px]'}
          >
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
              <div className="lg:col-span-7 space-y-3">{aiPlayer}</div>
              <div className="lg:col-span-5 space-y-4">{aiSettings}</div>
            </div>
          </AiSection>
        </div>
      )}

      {/* Lịch sử */}
      {showHistory && (
        <div className="bg-white rounded-xl border border-border p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-slate-500" />
              <h3 className="font-semibold text-sm text-slate-900">Lịch sử đọc gần đây</h3>
            </div>
            {historyItems.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  clearTTSHistory();
                  showToast('Đã xóa toàn bộ lịch sử TTS!');
                }}
                className="h-7 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
              >
                Xóa toàn bộ
              </Button>
            )}
          </div>

          {historyItems.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-4 text-center">Chưa có mục nào được lưu. Hãy nhập văn bản và nhấn &quot;Đọc&quot;!</p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
              {historyItems.map((item) => (
                <div key={item.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 font-medium text-slate-700 text-[10px] uppercase">{item.language}</span>
                      <span className="text-[11px] text-slate-400">{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="text-[10px] text-indigo-600 font-medium">
                        {item.voice} · {item.style}
                      </span>
                    </div>
                    <p className="truncate text-slate-700">{item.text}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => handlePlayHistory(item)} className="h-7 text-xs px-2.5" data-tooltip="Khôi phục / phát lại mục này">
                      <Play className="h-3 w-3 mr-1" />
                      Phát
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownloadHistoryItem(item)}
                      className="h-7 text-xs px-2.5 text-emerald-700 hover:text-emerald-800 border-emerald-200 hover:bg-emerald-50"
                      data-tooltip="Tải đoạn âm thanh này về máy (giọng AI)"
                    >
                      <Download className="h-3 w-3 mr-1" />
                      Tải về
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        deleteTTSHistoryItem(item.id);
                        showToast('Đã xóa mục khỏi lịch sử!');
                      }}
                      className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                      data-tooltip="Xóa mục" aria-label="Xóa mục"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
