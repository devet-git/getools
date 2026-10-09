'use client';

import { useState, useEffect, useRef, useMemo, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import {
  Mic,
  Square,
  Copy,
  Check,
  Download,
  Trash2,
  Sparkles,
  Volume2,
  FileText,
  History,
  AlertCircle,
  Upload,
  ArrowRight,
  Wand2,
  Undo2,
  Search,
  Loader2,
  RotateCcw,
  X,
  ListChecks,
  Languages,
  AlignLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/searchable-select';
import { useApp } from '@/components/AppContext';
import { AiSection } from '@/components/AiSection';
import { SendToButton } from '@/components/SendToButton';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { useAiSettings } from '@/lib/use-ai-config';
import { callAi, toAiError } from '@/lib/ai-client';
import { readShareParams } from '@/lib/share-link';
import { notifyStorageSync, subscribeStorageSync } from '@/lib/storage';
import {
  VOICE_COMMAND_SHEET,
  DEFAULT_FILLERS,
  appendSegment,
  buildCues,
  capitalizeSentences,
  cleanupText,
  computeStats,
  countMatches,
  detectBrowser,
  fixSpacing,
  formatClock,
  paragraphizeSegments,
  paragraphizeText,
  parseFillerList,
  replaceAllText,
  segmentsFromText,
  toMarkdown,
  toSrt,
  toVtt,
  withTimestamps,
  type CommandMode,
  type SttSegment,
} from '@/lib/stt-local';
import { toolHref } from '@/lib/tools';

interface STTHistoryItem {
  id: string;
  text: string;
  language: string;
  durationSeconds: number;
  timestamp: number;
}

const STT_STORAGE_KEY = 'git_downloader_stt_history_v1';

function getSTTHistorySnapshot(): string {
  if (typeof window === 'undefined') return '[]';
  try {
    return localStorage.getItem(STT_STORAGE_KEY) || '[]';
  } catch {
    return '[]';
  }
}

const emptyArrayString = () => '[]';

const STT_LANGUAGES = [
  { id: 'vi', name: 'Tiếng Việt', flag: '🇻🇳', bcp47: 'vi-VN', ai: 'vi' },
  { id: 'en', name: 'Tiếng Anh (Mỹ)', flag: '🇺🇸', bcp47: 'en-US', ai: 'en' },
  { id: 'en-gb', name: 'Tiếng Anh (Anh)', flag: '🇬🇧', bcp47: 'en-GB', ai: 'en' },
  { id: 'ja', name: 'Tiếng Nhật', flag: '🇯🇵', bcp47: 'ja-JP', ai: 'ja' },
  { id: 'ko', name: 'Tiếng Hàn', flag: '🇰🇷', bcp47: 'ko-KR', ai: 'ko' },
  { id: 'zh', name: 'Tiếng Trung', flag: '🇨🇳', bcp47: 'zh-CN', ai: 'zh' },
  { id: 'fr', name: 'Tiếng Pháp', flag: '🇫🇷', bcp47: 'fr-FR', ai: 'fr' },
  { id: 'de', name: 'Tiếng Đức', flag: '🇩🇪', bcp47: 'de-DE', ai: 'de' },
  { id: 'es', name: 'Tiếng Tây Ban Nha', flag: '🇪🇸', bcp47: 'es-ES', ai: 'es' },
];

const TRANSLATE_TARGETS = [
  { id: 'vi', name: 'Tiếng Việt' },
  { id: 'en', name: 'Tiếng Anh' },
  { id: 'ja', name: 'Tiếng Nhật' },
  { id: 'ko', name: 'Tiếng Hàn' },
  { id: 'zh', name: 'Tiếng Trung' },
  { id: 'fr', name: 'Tiếng Pháp' },
  { id: 'de', name: 'Tiếng Đức' },
  { id: 'es', name: 'Tiếng Tây Ban Nha' },
];

const MAX_AI_CHARS = 60_000;

/* Minimal types for the (non-standard) Web Speech API */
interface SpeechAlt {
  transcript: string;
}
interface SpeechRes {
  isFinal: boolean;
  0: SpeechAlt;
}
interface SpeechEvt {
  resultIndex: number;
  results: ArrayLike<SpeechRes>;
}
interface SpeechRec {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((e: SpeechEvt) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecCtor = new () => SpeechRec;

function getSpeechCtor(): SpeechRecCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecCtor; webkitSpeechRecognition?: SpeechRecCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

const noopSubscribe = () => () => {};
function getEnvSnapshot(): string {
  const supported = getSpeechCtor() ? '1' : '0';
  return `${supported}|${detectBrowser(navigator.userAgent)}`;
}
const getEnvServerSnapshot = () => '1|chromium';

function downloadFile(name: string, content: string, mime: string) {
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

type AiTaskKey = 'punctuate' | 'action-items' | 'summarize' | 'translate';
const AI_TASK_LABEL: Record<AiTaskKey, string> = {
  punctuate: 'Thêm dấu câu & làm sạch',
  'action-items': 'Biên bản & việc cần làm',
  summarize: 'Tóm tắt',
  translate: 'Dịch',
};

export default function SpeechToTextPage() {
  const router = useRouter();
  const { showToast } = useApp();
  const ai = useAiSettings();

  const [selectedLangId, setSelectedLangId] = useState(() => {
    const l = readShareParams().get('lang');
    return STT_LANGUAGES.some((x) => x.id === l) ? (l as string) : 'vi';
  });
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [segments, setSegments] = useState<SttSegment[]>([]);
  const [dirty, setDirty] = useState(false);
  const [duration, setDuration] = useState(0);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [isCopied, setIsCopied] = useState(false);
  const [autoPunctuate, setAutoPunctuate] = useState(true);
  const [cmdMode, setCmdMode] = useState<CommandMode>(() => {
    const m = readShareParams().get('cmd');
    return m === 'off' || m === 'aggressive' || m === 'conservative' ? m : 'conservative';
  });
  const [uploadedAudioUrl, setUploadedAudioUrl] = useState<string | null>(null);
  const [uploadedAudioName, setUploadedAudioName] = useState<string | null>(null);
  const [micPerm, setMicPerm] = useState<string>('unknown');

  // Cleanup / paragraph / export options
  const [removeFillers, setRemoveFillers] = useState(true);
  const [fillerText, setFillerText] = useState(DEFAULT_FILLERS.join(', '));
  const [collapseRepeats, setCollapseRepeats] = useState(true);
  const [pauseSec, setPauseSec] = useState(2.5);
  const [sentencesPerPara, setSentencesPerPara] = useState(4);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [canUndo, setCanUndo] = useState(false);

  // Find / replace
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);

  // AI
  const [aiRunning, setAiRunning] = useState<AiTaskKey | null>(null);
  const [aiResult, setAiResult] = useState<{ task: AiTaskKey; text: string } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiParagraphs, setAiParagraphs] = useState(true);
  const [aiFillers, setAiFillers] = useState(true);
  const [aiTarget, setAiTarget] = useState('en');
  const [aiLength, setAiLength] = useState<'short' | 'medium' | 'long'>('medium');
  const aiAbortRef = useRef<AbortController | null>(null);
  const aiLastRef = useRef<AiTaskKey | null>(null);

  const env = useSyncExternalStore(noopSubscribe, getEnvSnapshot, getEnvServerSnapshot);
  const [supportFlag, browserKind] = env.split('|');
  const isSupported = supportFlag === '1';

  // References
  const recognitionRef = useRef<SpeechRec | null>(null);
  const wantRecordingRef = useRef(false);
  const restartLogRef = useRef<number[]>([]);
  const recStartRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const visStartingRef = useRef(false);
  const animFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef('');
  const segmentsRef = useRef<SttSegment[]>([]);
  const durationRef = useRef(0);
  const undoRef = useRef<string | null>(null);
  const settingsRef = useRef({ cmdMode, autoPunctuate, langId: selectedLangId });

  const currentLang = STT_LANGUAGES.find((l) => l.id === selectedLangId) || STT_LANGUAGES[0];

  useEffect(() => {
    settingsRef.current = { cmdMode, autoPunctuate, langId: selectedLangId };
  }, [cmdMode, autoPunctuate, selectedLangId]);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  // STT History via external store
  const rawHistory = useSyncExternalStore(subscribeStorageSync, getSTTHistorySnapshot, emptyArrayString);
  const historyItems: STTHistoryItem[] = useMemo(() => {
    try {
      const parsed = JSON.parse(rawHistory);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [rawHistory]);

  // Microphone permission state (feature-detected)
  useEffect(() => {
    let status: PermissionStatus | null = null;
    let cancelled = false;
    try {
      if (!navigator.permissions?.query) return;
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((s) => {
          if (cancelled) return;
          status = s;
          setMicPerm(s.state);
          s.onchange = () => setMicPerm(s.state);
        })
        .catch(() => {});
    } catch {
      /* không hỗ trợ Permissions API */
    }
    return () => {
      cancelled = true;
      if (status) status.onchange = null;
    };
  }, []);

  // Timer while recording
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  // Stop everything when leaving the page
  useEffect(() => {
    return () => {
      wantRecordingRef.current = false;
      try {
        recognitionRef.current?.stop();
      } catch {}
      aiAbortRef.current?.abort();
    };
  }, []);

  /* ---------- transcript state helpers ---------- */
  const commitText = (next: string, markDirty = true) => {
    transcriptRef.current = next;
    setTranscript(next);
    if (markDirty) setDirty(true);
  };

  const pushSegments = (list: SttSegment[]) => {
    segmentsRef.current = list;
    setSegments(list);
  };

  /** Áp một phép biến đổi lên văn bản, cho phép hoàn tác 1 bước. */
  const transform = (fn: (t: string) => string, okMsg: string, keepSegments = false) => {
    const cur = transcriptRef.current;
    if (!cur.trim()) {
      showToast('Chưa có văn bản để xử lý.');
      return;
    }
    const next = fn(cur);
    if (next === cur) {
      showToast('Không có gì để thay đổi.');
      return;
    }
    undoRef.current = cur;
    setCanUndo(true);
    commitText(next, !keepSegments);
    showToast(okMsg);
  };

  const handleUndo = () => {
    if (undoRef.current === null) return;
    const prev = undoRef.current;
    undoRef.current = null;
    setCanUndo(false);
    commitText(prev, true);
    showToast('Đã hoàn tác.');
  };

  /* ---------- audio visualizer ---------- */
  const startVisualizer = async () => {
    if (micStreamRef.current || visStartingRef.current) return;
    visStartingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!wantRecordingRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      micStreamRef.current = stream;
      setMicPerm('granted');

      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        setVolumeLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(updateVolume);
      };

      updateVolume();
    } catch {
      // Microphone permission denied or not available
      setVolumeLevel(0);
    } finally {
      visStartingRef.current = false;
    }
  };

  const stopVisualizer = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    analyserRef.current = null;
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setVolumeLevel(0);
  };

  /* ---------- recognition ---------- */
  const finishRecording = () => {
    wantRecordingRef.current = false;
    recognitionRef.current = null;
    setIsRecording(false);
    setInterimTranscript('');
    stopVisualizer();
  };

  const spawnRecognition = (first: boolean) => {
    const Ctor = getSpeechCtor();
    if (!Ctor) throw new Error('unsupported');
    const lang = STT_LANGUAGES.find((l) => l.id === settingsRef.current.langId) || STT_LANGUAGES[0];
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang.bcp47;
    const startedAt = new Map<number, number>();

    recognition.onstart = () => {
      setIsRecording(true);
      startVisualizer();
      if (first) showToast(`Đang lắng nghe giọng nói (${lang.name})... Hãy bắt đầu nói.`);
    };

    recognition.onresult = (event) => {
      const now = Date.now() - (recStartRef.current ?? Date.now());
      let interim = '';
      const finals: SttSegment[] = [];
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (!startedAt.has(i)) startedAt.set(i, now);
        if (result.isFinal) {
          finals.push({ text, start: startedAt.get(i) ?? now, end: now });
          startedAt.delete(i);
        } else {
          interim += text;
        }
      }

      if (finals.length) {
        const s = settingsRef.current;
        let cur = transcriptRef.current;
        const added: SttSegment[] = [];
        for (const f of finals) {
          const r = appendSegment(cur, f.text, { mode: s.cmdMode, capitalize: s.autoPunctuate });
          if (r.piece) {
            cur = r.text;
            added.push({ text: r.piece, start: f.start, end: f.end });
          }
        }
        if (added.length) {
          transcriptRef.current = cur;
          setTranscript(cur);
          pushSegments([...segmentsRef.current, ...added]);
        }
      }
      setInterimTranscript(interim);
    };

    recognition.onerror = (event) => {
      switch (event.error) {
        case 'no-speech':
        case 'aborted':
          return; // Chrome tự ngắt khi im lặng - sẽ tự khởi động lại ở onend
        case 'not-allowed':
        case 'service-not-allowed':
          showToast('Bạn chưa cấp quyền Microphone. Bấm biểu tượng khóa trên thanh địa chỉ và cho phép Micro, rồi thử lại.');
          setMicPerm('denied');
          wantRecordingRef.current = false;
          return;
        case 'audio-capture':
          showToast('Không tìm thấy micro. Hãy kiểm tra thiết bị thu âm đã cắm và đang bật.');
          wantRecordingRef.current = false;
          return;
        case 'network':
          showToast('Lỗi mạng: trình duyệt cần Internet để nhận diện giọng nói (âm thanh được gửi tới máy chủ của hãng trình duyệt).');
          wantRecordingRef.current = false;
          return;
        case 'language-not-supported':
          showToast('Trình duyệt không hỗ trợ ngôn ngữ này. Hãy chọn ngôn ngữ khác.');
          wantRecordingRef.current = false;
          return;
        default:
          showToast(`Lỗi nhận diện: ${event.error}`);
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return; // phiên cũ đã bị thay thế
      if (!wantRecordingRef.current) {
        finishRecording();
        return;
      }
      // Chrome tự dừng sau một lúc im lặng: khởi động lại, nhưng chặn vòng lặp lỗi
      const now = Date.now();
      const log = restartLogRef.current.filter((t) => now - t < 5000);
      log.push(now);
      restartLogRef.current = log;
      if (log.length > 6) {
        showToast('Nhận diện liên tục bị ngắt lặp lại, đã dừng. Hãy bấm Micro để thử lại.');
        finishRecording();
        return;
      }
      setTimeout(() => {
        if (!wantRecordingRef.current || recognitionRef.current !== recognition) return;
        try {
          spawnRecognition(false);
        } catch {
          showToast('Không thể khởi động lại nhận diện. Hãy bấm Micro để thử lại.');
          finishRecording();
        }
      }, 250);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const startRecording = () => {
    if (typeof window === 'undefined') return;
    if (!getSpeechCtor()) {
      showToast(
        browserKind === 'firefox'
          ? 'Firefox chưa hỗ trợ nhận diện giọng nói. Hãy dùng Chrome, Edge hoặc Safari.'
          : 'Trình duyệt chưa hỗ trợ Web Speech Recognition. Vui lòng dùng Chrome hoặc Edge.',
      );
      return;
    }
    if (recStartRef.current === null) recStartRef.current = Date.now();
    wantRecordingRef.current = true;
    restartLogRef.current = [];
    try {
      spawnRecognition(true);
    } catch {
      showToast('Không thể kích hoạt microphone. Vui lòng kiểm tra quyền truy cập.');
      finishRecording();
    }
  };

  const saveSTTHistoryItem = (text: string, language: string, durationSec: number) => {
    if (typeof window === 'undefined') return;
    try {
      const current = JSON.parse(localStorage.getItem(STT_STORAGE_KEY) || '[]');
      const newItem: STTHistoryItem = {
        id: 'stt_' + Date.now(),
        text,
        language,
        durationSeconds: durationSec,
        timestamp: Date.now(),
      };
      const updated = [newItem, ...current.slice(0, 29)];
      localStorage.setItem(STT_STORAGE_KEY, JSON.stringify(updated));
      notifyStorageSync();
    } catch {}
  };

  const stopRecording = () => {
    wantRecordingRef.current = false;
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      try {
        rec.stop();
      } catch {}
    }
    setIsRecording(false);
    stopVisualizer();
    setInterimTranscript('');

    // Save to history if transcript has content
    const text = transcriptRef.current.trim();
    if (text) {
      const lang = STT_LANGUAGES.find((l) => l.id === settingsRef.current.langId) || STT_LANGUAGES[0];
      saveSTTHistoryItem(text, lang.name, durationRef.current);
      showToast('Đã dừng ghi âm và lưu kết quả.');
    }
  };

  const toggleRecording = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  const handleClearTranscript = () => {
    if (transcriptRef.current.trim()) {
      undoRef.current = transcriptRef.current;
      setCanUndo(true);
    }
    commitText('', false);
    pushSegments([]);
    setDirty(false);
    setInterimTranscript('');
    setDuration(0);
    recStartRef.current = isRecording ? Date.now() : null;
  };

  /* ---------- output text ---------- */
  const fullText = (transcript + (interimTranscript ? ' ' + interimTranscript : '')).trim();

  /** Segment có mốc: dùng mốc thật nếu văn bản chưa bị sửa, ngược lại ước lượng theo độ dài câu. */
  const effectiveSegments = (): { segs: SttSegment[]; estimated: boolean } => {
    if (!dirty && segments.length > 0) return { segs: segments, estimated: false };
    const lastEnd = segments.reduce((a, s) => Math.max(a, s.end), 0);
    return { segs: segmentsFromText(transcript, Math.max(duration * 1000, lastEnd)), estimated: true };
  };

  const textForOutput = (): string => {
    if (!showTimestamps) return fullText;
    const { segs } = effectiveSegments();
    return segs.length ? withTimestamps(segs) : fullText;
  };

  const handleCopy = async () => {
    const out = textForOutput();
    if (!out) {
      showToast('Chưa có văn bản để sao chép.');
      return;
    }
    try {
      await navigator.clipboard.writeText(out);
      setIsCopied(true);
      showToast('Đã sao chép văn bản vào clipboard!');
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      showToast('Lỗi khi sao chép.');
    }
  };

  const baseName = () => `voice_transcript_${selectedLangId}_${new Date().toISOString().slice(0, 10)}`;

  const handleExport = (kind: 'txt' | 'md' | 'srt' | 'vtt') => {
    if (!fullText) {
      showToast('Chưa có nội dung để tải về.');
      return;
    }
    const { segs, estimated } = effectiveSegments();
    if (kind === 'txt') {
      downloadFile(`${baseName()}.txt`, textForOutput(), 'text/plain;charset=utf-8');
    } else if (kind === 'md') {
      const md = toMarkdown(fullText, showTimestamps ? segs : null, {
        language: currentLang.name,
        durationSec: duration,
        dateIso: new Date().toISOString().slice(0, 10),
      });
      downloadFile(`${baseName()}.md`, md, 'text/markdown;charset=utf-8');
    } else {
      const cues = buildCues(segs);
      if (cues.length === 0) {
        showToast('Không tạo được phụ đề từ nội dung này.');
        return;
      }
      if (kind === 'srt') downloadFile(`${baseName()}.srt`, toSrt(cues), 'application/x-subrip;charset=utf-8');
      else downloadFile(`${baseName()}.vtt`, toVtt(cues), 'text/vtt;charset=utf-8');
      if (estimated) showToast('Văn bản đã được chỉnh sửa nên mốc thời gian phụ đề chỉ là ước lượng.');
      else showToast(`Đã tải phụ đề .${kind} (${cues.length} cue).`);
      return;
    }
    showToast(`Đã tải xuống file .${kind}!`);
  };

  // Send to TTS
  const handleSendToTTS = () => {
    if (!fullText) {
      showToast('Chưa có văn bản để chuyển sang TTS.');
      return;
    }
    sessionStorage.setItem('stt_to_tts_text', fullText);
    sessionStorage.setItem('stt_to_tts_lang', selectedLangId);
    router.push(toolHref('tts'));
  };

  // Send to Markdown Converter
  const handleSendToMarkdown = () => {
    if (!fullText) {
      showToast('Chưa có văn bản để chuyển sang Markdown.');
      return;
    }
    sessionStorage.setItem('stt_to_md_text', fullText);
    router.push(toolHref('html-to-markdown'));
  };

  const deleteHistoryItem = (id: string) => {
    if (typeof window === 'undefined') return;
    try {
      const current: STTHistoryItem[] = JSON.parse(localStorage.getItem(STT_STORAGE_KEY) || '[]');
      const filtered = current.filter((item) => item.id !== id);
      localStorage.setItem(STT_STORAGE_KEY, JSON.stringify(filtered));
      notifyStorageSync();
      showToast('Đã xóa bản ghi.');
    } catch {}
  };

  const clearAllHistory = () => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(STT_STORAGE_KEY);
      notifyStorageSync();
      showToast('Đã xóa toàn bộ lịch sử nhận diện.');
    } catch {}
  };

  // Audio File Upload (chỉ để phát lại; Web Speech không nhận diện trực tiếp từ file)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (uploadedAudioUrl) URL.revokeObjectURL(uploadedAudioUrl);
    const url = URL.createObjectURL(file);
    setUploadedAudioUrl(url);
    setUploadedAudioName(file.name);
    showToast(`Đã nạp file: ${file.name}. Lưu ý: chỉ phát lại được, không nhận diện trực tiếp từ file.`);
  };

  /* ---------- local tools ---------- */
  const isEnglish = currentLang.ai === 'en';

  const handleCleanup = () =>
    transform(
      (t) =>
        cleanupText(t, {
          removeFillers,
          fillers: parseFillerList(fillerText),
          collapseRepeats,
          fixSpacing: true,
          capitalize: true,
          englishI: isEnglish,
        }),
      'Đã làm sạch văn bản.',
    );

  const handleFormat = () =>
    transform((t) => capitalizeSentences(fixSpacing(t)), 'Đã sửa khoảng trắng và viết hoa đầu câu.');

  const handleParagraphs = () => {
    if (!dirty && segments.length > 0) {
      transform(
        () => paragraphizeSegments(segments, { pauseMs: Math.max(0.5, pauseSec) * 1000, sentencesPerParagraph: sentencesPerPara }),
        'Đã chia đoạn theo khoảng lặng khi nói.',
        true,
      );
    } else {
      transform((t) => paragraphizeText(t, sentencesPerPara), 'Đã chia đoạn theo số câu.');
    }
  };

  const matchCount = useMemo(
    () => (findText ? countMatches(transcript, findText, { caseSensitive, wholeWord }) : 0),
    [transcript, findText, caseSensitive, wholeWord],
  );

  const handleReplace = () => {
    if (!findText) {
      showToast('Nhập nội dung cần tìm.');
      return;
    }
    const cur = transcriptRef.current;
    const r = replaceAllText(cur, findText, replaceText, { caseSensitive, wholeWord });
    if (r.count === 0) {
      showToast('Không tìm thấy nội dung cần thay.');
      return;
    }
    undoRef.current = cur;
    setCanUndo(true);
    commitText(r.text, true);
    showToast(`Đã thay ${r.count} vị trí.`);
  };

  const stats = useMemo(
    () => computeStats(transcript, dirty ? null : segments, duration),
    [transcript, dirty, segments, duration],
  );

  /* ---------- AI extensions ---------- */
  const runAi = async (task: AiTaskKey) => {
    const input = transcriptRef.current.trim();
    if (!input) {
      showToast('Chưa có văn bản để gửi cho AI.');
      return;
    }
    if (input.length > MAX_AI_CHARS) {
      setAiError(`Văn bản quá dài (${input.length.toLocaleString('vi-VN')} ký tự). Giới hạn ${MAX_AI_CHARS.toLocaleString('vi-VN')} ký tự — hãy chia nhỏ.`);
      return;
    }
    aiAbortRef.current?.abort();
    const ctrl = new AbortController();
    aiAbortRef.current = ctrl;
    aiLastRef.current = task;
    setAiRunning(task);
    setAiError(null);
    try {
      const lang = currentLang.ai;
      const options: Record<string, string | boolean> =
        task === 'punctuate'
          ? { language: lang, paragraphs: aiParagraphs, removeFillers: aiFillers }
          : task === 'action-items'
            ? { language: lang === 'en' ? 'en' : 'vi', sections: 'all' }
            : task === 'summarize'
              ? { language: lang, length: aiLength, style: 'bullets' }
              : { source: lang, target: aiTarget, tone: 'keep', preserveMarkdown: false };
      const text = await callAi({ task, input, options, ai: ai.config, signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      setAiResult({ task, text });
    } catch (e) {
      const err = toAiError(e);
      if (!err.aborted) setAiError(err.message);
    } finally {
      if (aiAbortRef.current === ctrl) {
        aiAbortRef.current = null;
        setAiRunning(null);
      }
    }
  };

  const cancelAi = () => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    setAiRunning(null);
    showToast('Đã huỷ yêu cầu AI.');
  };

  const copyAiResult = async () => {
    if (!aiResult) return;
    try {
      await navigator.clipboard.writeText(aiResult.text);
      showToast('Đã sao chép kết quả AI.');
    } catch {
      showToast('Lỗi khi sao chép.');
    }
  };

  const useAiAsMain = () => {
    if (!aiResult) return;
    undoRef.current = transcriptRef.current;
    setCanUndo(true);
    commitText(aiResult.text, true);
    showToast('Đã dùng kết quả AI làm bản chính (có thể hoàn tác).');
  };

  // Format mm:ss
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const smallBtn =
    'px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition inline-flex items-center gap-1 disabled:opacity-50';
  const inputCls =
    'rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';

  const cmdModes: { id: CommandMode; label: string; hint: string }[] = [
    { id: 'off', label: 'Tắt', hint: 'Không đổi lời nói thành dấu câu.' },
    { id: 'conservative', label: 'An toàn', hint: 'Chỉ nhận lệnh nằm ở đầu hoặc cuối một đoạn nói (sau/ trước khi ngừng nghỉ).' },
    { id: 'aggressive', label: 'Mọi nơi', hint: 'Nhận lệnh ở bất kỳ vị trí nào trong câu — có thể đổi nhầm từ thường như “chấm bài”.' },
  ];

  return (
    <div className="space-y-3.5">
      {/* COMPACT HEADER */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-red-600/20 border border-red-500/30 text-red-400 flex items-center justify-center shrink-0">
            <Mic className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-bold tracking-tight">
                Chuyển giọng nói thành văn bản (Speech-to-Text)
              </h1>
              <span className="px-2 py-0.2 rounded-full text-[10px] font-semibold bg-red-500/20 text-red-300 border border-red-400/30">
                Live Mic
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Nhận diện trực tiếp qua Micro bằng trình duyệt (miễn phí), kèm lệnh dấu câu, làm sạch và xuất phụ đề.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[11px] font-medium text-slate-400 hidden md:inline" htmlFor="stt-lang">
            Ngôn ngữ:
          </label>
          <Select
            searchThreshold={0}
            id="stt-lang"
            value={selectedLangId}
            onChange={(e) => {
              if (isRecording) stopRecording();
              setSelectedLangId(e.target.value);
            }}
            className="w-56 max-w-full rounded-lg bg-slate-800 border border-slate-700 text-xs text-white px-2 py-1.5 outline-hidden focus:border-red-400"
          >
            {STT_LANGUAGES.map((lang) => (
              <option key={lang.id} value={lang.id}>
                {lang.flag} {lang.name} ({lang.bcp47})
              </option>
            ))}
          </Select>
          <ShareLinkButton params={{ lang: selectedLangId, cmd: cmdMode }} />
        </div>
      </div>

      {/* Browser support guidance */}
      {!isSupported && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
          <div className="space-y-1">
            <p>
              <strong>
                {browserKind === 'firefox'
                  ? 'Firefox chưa hỗ trợ nhận diện giọng nói (SpeechRecognition).'
                  : 'Trình duyệt này không hỗ trợ nhận diện giọng nói của Web Speech API.'}
              </strong>{' '}
              Hãy mở trang này bằng <strong>Google Chrome</strong> hoặc <strong>Microsoft Edge</strong> (hoặc Safari bản mới) để ghi âm bằng Micro.
            </p>
            <p>
              Các công cụ xử lý văn bản bên dưới (lệnh dấu câu, làm sạch, chia đoạn, tìm &amp; thay, xuất .txt/.md/.srt/.vtt) vẫn dùng bình thường: bạn có thể dán hoặc gõ văn bản vào ô bên phải.
            </p>
          </div>
        </div>
      )}
      {isSupported && browserKind === 'safari' && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            Safari chỉ hỗ trợ một phần: có thể hỏi quyền Micro nhiều lần, kết quả tạm thời kém ổn định và nhận diện hay tự ngắt. Chrome hoặc Edge cho trải nghiệm tốt nhất.
          </span>
        </div>
      )}
      {micPerm === 'denied' && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
          <span>
            Quyền Micro đang bị <strong>chặn</strong>. Bấm biểu tượng ổ khóa cạnh thanh địa chỉ, chọn <em>Microphone → Cho phép</em>, rồi tải lại trang.
          </span>
        </div>
      )}

      {/* Main Dual-Column Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
        {/* Left Column */}
        <div className="lg:col-span-5 space-y-3">
          {/* Microphone Recording Console Card */}
          <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-xs space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Mic className="h-3.5 w-3.5 text-red-600" />
                Trung tâm thu âm Micro
              </span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                  {formatTime(duration)}
                </span>
                <span className="text-[11px] text-slate-500">
                  {currentLang.flag} {currentLang.bcp47}
                </span>
              </div>
            </div>

            <div className="flex flex-col items-center justify-center py-4 bg-slate-50/70 rounded-xl border border-slate-100 relative overflow-hidden">
              {isRecording && <div className="absolute inset-0 bg-red-500/5 animate-pulse pointer-events-none" />}

              <div className="flex items-end justify-center gap-1 h-12 w-48 mb-3 px-2">
                {[...Array(16)].map((_, i) => {
                  const barHeight = isRecording
                    ? Math.max(8, Math.min(48, (volumeLevel / 100) * 44 * (1 + Math.sin(i * 0.8) * 0.4)))
                    : 6;
                  return (
                    <div
                      key={i}
                      style={{ height: `${barHeight}px` }}
                      className={`w-1.5 rounded-full transition-all duration-75 ${
                        isRecording ? 'bg-red-500' : 'bg-slate-300'
                      }`}
                    />
                  );
                })}
              </div>

              <button
                type="button"
                onClick={toggleRecording}
                className={`h-16 w-16 rounded-full flex items-center justify-center text-white shadow-md transition-all transform hover:scale-105 active:scale-95 ${
                  isRecording
                    ? 'bg-red-600 ring-4 ring-red-200 animate-pulse'
                    : 'bg-indigo-600 hover:bg-indigo-700 ring-4 ring-indigo-100'
                }`}
                title={isRecording ? 'Bấm để dừng ghi âm' : 'Bấm để bắt đầu ghi âm giọng nói'}
              >
                {isRecording ? <Square className="h-6 w-6" /> : <Mic className="h-7 w-7" />}
              </button>

              <div className="mt-2.5 text-center">
                <span className={`text-xs font-bold ${isRecording ? 'text-red-600' : 'text-slate-700'}`}>
                  {isRecording ? 'Đang lắng nghe... Bấm để kết thúc' : 'Bấm nút để Bắt đầu Nói'}
                </span>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Tự động khởi động lại khi Chrome ngắt vì im lặng
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600">
                <input
                  type="checkbox"
                  checked={autoPunctuate}
                  onChange={(e) => setAutoPunctuate(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                />
                <span>Tự động viết hoa đầu câu</span>
              </label>

              {isRecording && (
                <button onClick={stopRecording} className="text-xs font-medium text-red-600 hover:underline">
                  Dừng &amp; Lưu
                </button>
              )}
            </div>
          </div>

          {/* Voice commands */}
          <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <AlignLeft className="h-3.5 w-3.5 text-indigo-600" />
                Lệnh giọng nói (dấu câu)
              </span>
              <span className="text-[10px] text-slate-400">Miễn phí, chạy trên máy</span>
            </div>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Chế độ lệnh giọng nói">
              {cmdModes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={cmdMode === m.id}
                  title={m.hint}
                  onClick={() => setCmdMode(m.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                    cmdMode === m.id
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {cmdModes.find((m) => m.id === cmdMode)?.hint} Ví dụ: nói “xin chào <strong>phẩy</strong> tôi là Nam <strong>chấm</strong>” →{' '}
              <span className="font-mono">Xin chào, tôi là Nam.</span> Lệnh chỉ áp cho phần nói mới, văn bản đã có không bị đổi.
            </p>
            <details className="group text-xs">
              <summary className="cursor-pointer text-indigo-700 font-medium select-none">Bảng lệnh được hỗ trợ</summary>
              <div className="mt-2 overflow-x-auto rounded-lg border border-slate-100">
                <table className="w-full text-[11px]">
                  <tbody>
                    {VOICE_COMMAND_SHEET.map((c) => (
                      <tr key={c.lang + c.label} className="border-b border-slate-100 last:border-0">
                        <td className="px-2 py-1 text-slate-500 w-8">{c.lang === 'vi' ? 'VI' : 'EN'}</td>
                        <td className="px-2 py-1 text-slate-800">{c.say.join(' / ')}</td>
                        <td className="px-2 py-1 font-mono text-emerald-700 whitespace-pre text-right">{c.out}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>

          {/* Audio File Card (honest) */}
          <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Upload className="h-3.5 w-3.5 text-indigo-600" />
                File âm thanh có sẵn
              </span>
              <span className="text-[10px] text-slate-400">MP3, WAV, M4A, OGG</span>
            </div>

            <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800 leading-relaxed">
              Web Speech API <strong>không thể nhận diện trực tiếp từ file</strong> — trình duyệt chỉ nghe Micro. Bạn chỉ có thể phát file qua loa cho Micro thu lại (chất lượng thấp, dễ nhiễu). Muốn phiên âm file chính xác cần dịch vụ phiên âm riêng.
            </div>

            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="audio/*" className="hidden" />

            {uploadedAudioUrl ? (
              <div className="space-y-2 p-2.5 rounded-lg bg-indigo-50/60 border border-indigo-100">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-indigo-950 truncate max-w-[200px]">{uploadedAudioName}</span>
                  <button
                    onClick={() => {
                      if (uploadedAudioUrl) URL.revokeObjectURL(uploadedAudioUrl);
                      setUploadedAudioUrl(null);
                      setUploadedAudioName(null);
                    }}
                    className="text-[11px] text-red-600 hover:underline"
                  >
                    Gỡ file
                  </button>
                </div>
                <audio ref={audioPlayerRef} src={uploadedAudioUrl} controls className="w-full h-8" />
                <p className="text-[11px] text-indigo-700 leading-tight">
                  Phát file ở âm lượng vừa phải, rồi bấm nút Micro ở trên để thu lại qua loa.
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 px-3 rounded-lg border border-dashed border-slate-300 hover:border-indigo-400 bg-slate-50/50 hover:bg-indigo-50/30 text-xs text-slate-600 transition flex items-center justify-center gap-2"
              >
                <Upload className="h-4 w-4 text-slate-400" />
                <span>Nạp file để phát lại</span>
              </button>
            )}
          </div>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-7 space-y-3">
          <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col h-[520px] overflow-hidden">
            <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/60 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-emerald-600" />
                  Văn bản nhận diện
                </span>
                {isRecording && (
                  <span className="flex items-center gap-1 text-[11px] text-red-600 font-semibold bg-red-50 px-2 py-0.5 rounded-full border border-red-200 animate-pulse">
                    <span className="h-2 w-2 rounded-full bg-red-600" />
                    Đang ghi nhận...
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {canUndo && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleUndo}
                    className="h-7 text-xs px-2 text-slate-600 hover:text-slate-900"
                    title="Hoàn tác thao tác vừa rồi"
                  >
                    <Undo2 className="h-3.5 w-3.5 mr-1" />
                    Hoàn tác
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopy}
                  className="h-7 text-xs px-2 text-slate-600 hover:text-slate-900"
                  title="Sao chép toàn bộ văn bản"
                >
                  {isCopied ? <Check className="h-3.5 w-3.5 mr-1 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                  {isCopied ? 'Đã chép' : 'Sao chép'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearTranscript}
                  className="h-7 text-xs px-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                  title="Xóa trắng văn bản"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Xóa
                </Button>
              </div>
            </div>

            <div className="flex-1 p-3.5 flex flex-col relative overflow-hidden bg-slate-50/30">
              <textarea
                data-handoff
                value={transcript}
                onChange={(e) => commitText(e.target.value, true)}
                placeholder={
                  isRecording
                    ? 'Đang lắng nghe... Lời nói của bạn sẽ xuất hiện trực tiếp tại đây...'
                    : 'Nhấn nút Micro bên trái để bắt đầu nói, hoặc gõ/dán và chỉnh sửa văn bản trực tiếp tại đây...'
                }
                className="w-full flex-1 p-3 text-xs sm:text-sm font-sans bg-white rounded-lg border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden resize-none leading-relaxed text-slate-800"
              />

              {interimTranscript && (
                <div className="mt-2 p-2 rounded-lg bg-slate-100 border border-slate-200 text-xs text-slate-400 italic flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-slate-400 animate-ping shrink-0" />
                  <span>{interimTranscript}...</span>
                </div>
              )}
            </div>

            <div className="p-2.5 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] text-slate-500 font-mono">
                {stats.words} từ · {stats.chars} ký tự · {stats.sentences} câu
                {stats.wpm !== null && ` · ${stats.wpm} từ/phút`}
                {stats.durationMs > 0 && ` · ${formatClock(stats.durationMs)}`}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <SendToButton text={transcript} fromToolId="stt" />
                <button
                  type="button"
                  onClick={handleSendToTTS}
                  className="px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-100 hover:bg-indigo-200 rounded-lg transition flex items-center gap-1.5"
                  title="Đưa văn bản này sang bộ đọc Text-to-Speech"
                >
                  <Volume2 className="h-3.5 w-3.5 text-indigo-600" />
                  Đọc lại bằng TTS
                  <ArrowRight className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={handleSendToMarkdown}
                  className="px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-lg transition flex items-center gap-1.5"
                  title="Đưa văn bản sang trình chuyển đổi Markdown"
                >
                  <FileText className="h-3.5 w-3.5 text-emerald-600" />
                  Chuyển sang Markdown
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>

          {/* Local tools: cleanup, paragraphs, find/replace */}
          <div className="bg-white rounded-xl border border-slate-200/90 p-3.5 shadow-xs space-y-3">
            <div className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Wand2 className="h-3.5 w-3.5 text-emerald-600" />
              Làm sạch &amp; định dạng (miễn phí)
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={removeFillers} onChange={(e) => setRemoveFillers(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600" />
                Bỏ từ đệm
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={collapseRepeats} onChange={(e) => setCollapseRepeats(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600" />
                Gộp từ lặp (“là là là” → “là”)
              </label>
            </div>
            {removeFillers && (
              <label className="block text-[11px] text-slate-500">
                Danh sách từ đệm (cách nhau bằng dấu phẩy, chỉ xóa khi là cả từ):
                <input
                  value={fillerText}
                  onChange={(e) => setFillerText(e.target.value)}
                  className={`${inputCls} w-full mt-1`}
                  spellCheck={false}
                />
              </label>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={handleCleanup} className={`${smallBtn} !bg-emerald-600 !text-white !border-emerald-600 hover:!bg-emerald-700`}>
                <Wand2 className="h-3.5 w-3.5" />
                Làm sạch văn bản
              </button>
              <button type="button" onClick={handleFormat} className={smallBtn} title="Sửa khoảng trắng trước dấu câu và viết hoa đầu câu">
                Sửa khoảng trắng &amp; viết hoa
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 border-t border-slate-100 pt-3">
              <button type="button" onClick={handleParagraphs} className={smallBtn}>
                <AlignLeft className="h-3.5 w-3.5" />
                Chia đoạn
              </button>
              <label className="flex items-center gap-1">
                nghỉ ≥
                <input type="number" min={0.5} max={30} step={0.5} value={pauseSec} onChange={(e) => setPauseSec(Number(e.target.value) || 2.5)} className={`${inputCls} w-16`} />
                giây
              </label>
              <label className="flex items-center gap-1">
                hoặc mỗi
                <input type="number" min={1} max={20} value={sentencesPerPara} onChange={(e) => setSentencesPerPara(Math.max(1, Math.min(20, Number(e.target.value) || 4)))} className={`${inputCls} w-14`} />
                câu
              </label>
              <span className="text-[11px] text-slate-400">
                {!dirty && segments.length > 0 ? 'Dùng khoảng lặng thật giữa các lần nói.' : 'Dùng số câu (văn bản đã chỉnh sửa).'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input value={findText} onChange={(e) => setFindText(e.target.value)} placeholder="Tìm…" className={`${inputCls} w-32`} aria-label="Tìm" />
              <input value={replaceText} onChange={(e) => setReplaceText(e.target.value)} placeholder="Thay bằng…" className={`${inputCls} w-32`} aria-label="Thay bằng" />
              <label className="flex items-center gap-1 text-[11px] text-slate-600 select-none">
                <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} className="h-3 w-3" /> Aa
              </label>
              <label className="flex items-center gap-1 text-[11px] text-slate-600 select-none">
                <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} className="h-3 w-3" /> Cả từ
              </label>
              <button type="button" onClick={handleReplace} disabled={!findText || matchCount === 0} className={smallBtn}>
                Thay tất cả
              </button>
              {findText && <span className="text-[11px] text-slate-500">{matchCount} kết quả</span>}
            </div>
          </div>

          {/* Export */}
          <div className="bg-white rounded-xl border border-slate-200/90 p-3.5 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Download className="h-3.5 w-3.5 text-indigo-600" />
                Xuất file
              </span>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                <input type="checkbox" checked={showTimestamps} onChange={(e) => setShowTimestamps(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600" />
                Kèm mốc thời gian [00:12] khi chép/xuất
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => handleExport('txt')} className={smallBtn}>.txt</button>
              <button type="button" onClick={() => handleExport('md')} className={smallBtn}>.md</button>
              <button type="button" onClick={() => handleExport('srt')} className={smallBtn}>.srt (phụ đề)</button>
              <button type="button" onClick={() => handleExport('vtt')} className={smallBtn}>.vtt (WebVTT)</button>
            </div>
            <p className="text-[11px] text-slate-400">
              Phụ đề chia tối đa 42 ký tự × 2 dòng. {dirty && segments.length > 0 ? 'Văn bản đã chỉnh sửa nên mốc thời gian sẽ được ước lượng.' : 'Mốc thời gian lấy từ lúc nhận diện.'}
            </p>
          </div>

          {/* AI extensions */}
          <AiSection
            requires="any"
            title="Tiện ích AI cho bản ghi"
            description="Có khóa AI: thêm dấu câu chính xác hơn, lập biên bản, tóm tắt và dịch bản ghi."
          >
            <div className="bg-white rounded-xl border border-indigo-200/70 p-3.5 shadow-xs space-y-3">
              <div className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                Mở rộng bằng AI
                <span className="text-[10px] font-medium normal-case text-slate-400">({ai.providerLabel})</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="rounded-lg border border-slate-200 p-2.5 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-800">Thêm dấu câu &amp; làm sạch bằng AI</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
                    <label className="flex items-center gap-1 select-none"><input type="checkbox" checked={aiParagraphs} onChange={(e) => setAiParagraphs(e.target.checked)} className="h-3 w-3" /> Chia đoạn</label>
                    <label className="flex items-center gap-1 select-none"><input type="checkbox" checked={aiFillers} onChange={(e) => setAiFillers(e.target.checked)} className="h-3 w-3" /> Bỏ từ đệm</label>
                  </div>
                  <button type="button" disabled={!!aiRunning} onClick={() => runAi('punctuate')} className={smallBtn}>
                    <Wand2 className="h-3.5 w-3.5" /> Chạy
                  </button>
                </div>
                <div className="rounded-lg border border-slate-200 p-2.5 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-800">Biên bản &amp; việc cần làm</div>
                  <p className="text-[11px] text-slate-500">Tóm tắt, quyết định, checklist việc cần làm.</p>
                  <button type="button" disabled={!!aiRunning} onClick={() => runAi('action-items')} className={smallBtn}>
                    <ListChecks className="h-3.5 w-3.5" /> Chạy
                  </button>
                </div>
                <div className="rounded-lg border border-slate-200 p-2.5 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-800">Tóm tắt</div>
                  <Select value={aiLength} onChange={(e) => setAiLength(e.target.value as 'short' | 'medium' | 'long')} className={inputCls} aria-label="Độ dài tóm tắt">
                    <option value="short">Ngắn</option>
                    <option value="medium">Vừa</option>
                    <option value="long">Chi tiết</option>
                  </Select>
                  <div>
                    <button type="button" disabled={!!aiRunning} onClick={() => runAi('summarize')} className={smallBtn}>
                      <Sparkles className="h-3.5 w-3.5" /> Chạy
                    </button>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 p-2.5 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-800">Dịch</div>
                  <Select searchThreshold={0} value={aiTarget} onChange={(e) => setAiTarget(e.target.value)} className={inputCls} aria-label="Ngôn ngữ đích">
                    {TRANSLATE_TARGETS.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </Select>
                  <div>
                    <button type="button" disabled={!!aiRunning} onClick={() => runAi('translate')} className={smallBtn}>
                      <Languages className="h-3.5 w-3.5" /> Chạy
                    </button>
                  </div>
                </div>
              </div>

              {aiRunning && (
                <div className="flex items-center gap-2 text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Đang xử lý: {AI_TASK_LABEL[aiRunning]}…
                  <button type="button" onClick={cancelAi} className="ml-auto text-red-600 hover:underline inline-flex items-center gap-1">
                    <X className="h-3 w-3" /> Huỷ
                  </button>
                </div>
              )}

              {aiError && !aiRunning && (
                <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span className="flex-1">{aiError}</span>
                  {aiLastRef.current && (
                    <button type="button" onClick={() => runAi(aiLastRef.current as AiTaskKey)} className="inline-flex items-center gap-1 font-medium hover:underline">
                      <RotateCcw className="h-3 w-3" /> Thử lại
                    </button>
                  )}
                </div>
              )}

              {aiResult && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-slate-800">Kết quả: {AI_TASK_LABEL[aiResult.task]}</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button type="button" onClick={copyAiResult} className={smallBtn}><Copy className="h-3.5 w-3.5" /> Sao chép</button>
                      <button type="button" onClick={useAiAsMain} className={`${smallBtn} !bg-indigo-600 !text-white !border-indigo-600 hover:!bg-indigo-700`}>Dùng làm bản chính</button>
                      <button type="button" onClick={() => setAiResult(null)} className={smallBtn} aria-label="Đóng kết quả"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                  <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-800 bg-white rounded-lg border border-slate-200 p-2.5">
                    {aiResult.text}
                  </div>
                </div>
              )}
            </div>
          </AiSection>

          {/* Recent Transcripts History */}
          {historyItems.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200/90 p-3 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5 text-indigo-600" />
                  Lịch sử nhận diện gần đây ({historyItems.length})
                </span>
                <button onClick={clearAllHistory} className="text-[11px] text-slate-400 hover:text-red-600">
                  Xóa tất cả
                </button>
              </div>

              <div className="space-y-1.5">
                {historyItems.slice(0, 5).map((item) => (
                  <div
                    key={item.id}
                    className="p-2 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200/60 text-xs flex items-center justify-between gap-2"
                  >
                    <div className="truncate flex-1">
                      <span className="text-[10px] text-indigo-600 font-semibold mr-1.5">[{item.language}]</span>
                      <span className="text-slate-800">{item.text}</span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => {
                          commitText(item.text, true);
                          showToast('Đã nạp lại văn bản từ lịch sử.');
                        }}
                        className="px-2 py-0.5 rounded text-[10px] bg-white border border-slate-200 hover:bg-indigo-50 text-indigo-700 font-medium"
                      >
                        Nạp lại
                      </button>
                      <button onClick={() => deleteHistoryItem(item.id)} className="p-1 text-slate-400 hover:text-red-600" title="Xóa">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-slate-400 leading-relaxed">
            Mẹo: Chrome/Edge gửi âm thanh tới máy chủ của hãng để nhận diện nên cần có Internet; Firefox chưa hỗ trợ. Nói rõ từng câu, ngừng nghỉ ngắn trước khi nói lệnh như “chấm” hay “xuống dòng” để chế độ An toàn nhận ra.
          </p>
        </div>
      </div>
    </div>
  );
}
