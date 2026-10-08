'use client';

import { useState, useEffect, useRef, useMemo, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import {
  Mic,
  MicOff,
  Square,
  Play,
  Pause,
  RotateCcw,
  Copy,
  Check,
  Download,
  Trash2,
  Sparkles,
  Volume2,
  FileText,
  Clock,
  History,
  AlertCircle,
  Upload,
  ArrowRight,
  Headphones,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApp } from '@/components/AppContext';
import { notifyStorageSync, subscribeStorageSync } from '@/lib/storage';

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
  { id: 'vi', name: 'Tiếng Việt', flag: '🇻🇳', bcp47: 'vi-VN' },
  { id: 'en', name: 'Tiếng Anh', flag: '🇬🇧', bcp47: 'en-US' },
  { id: 'zh', name: 'Tiếng Trung', flag: '🇨🇳', bcp47: 'zh-CN' },
  { id: 'ko', name: 'Tiếng Hàn', flag: '🇰🇷', bcp47: 'ko-KR' },
  { id: 'ja', name: 'Tiếng Nhật', flag: '🇯🇵', bcp47: 'ja-JP' },
];

export default function SpeechToTextPage() {
  const router = useRouter();
  const { showToast } = useApp();

  const [selectedLangId, setSelectedLangId] = useState('vi');
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [duration, setDuration] = useState(0);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [isCopied, setIsCopied] = useState(false);
  const [autoPunctuate, setAutoPunctuate] = useState(true);
  const [uploadedAudioUrl, setUploadedAudioUrl] = useState<string | null>(null);
  const [uploadedAudioName, setUploadedAudioName] = useState<string | null>(null);
  const [isSupported] = useState(() => {
    if (typeof window === 'undefined') return true;
    return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  });

  // References
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

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

  const currentLang = STT_LANGUAGES.find((l) => l.id === selectedLangId) || STT_LANGUAGES[0];

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

  // Audio Visualizer loop
  const startVisualizer = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
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
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        setVolumeLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(updateVolume);
      };

      updateVolume();
    } catch {
      // Microphone permission denied or not available
      setVolumeLevel(0);
    }
  };

  const stopVisualizer = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
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

  // Start Voice Recognition
  const startRecording = () => {
    if (typeof window === 'undefined') return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      showToast('Trình duyệt chưa hỗ trợ Web Speech Recognition. Vui lòng dùng Chrome hoặc Edge.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = currentLang.bcp47;

      recognition.onstart = () => {
        setIsRecording(true);
        startVisualizer();
        showToast(`Đang lắng nghe giọng nói (${currentLang.name})... Hãy bắt đầu nói.`);
      };

      recognition.onresult = (event: any) => {
        let interim = '';
        let finalChunk = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0].transcript;
          if (result.isFinal) {
            finalChunk += text + ' ';
          } else {
            interim += text;
          }
        }

        if (finalChunk) {
          setTranscript((prev) => {
            const trimmed = prev.trim();
            const formatted = finalChunk.trim();
            if (!trimmed) return formatted;
            return trimmed + ' ' + formatted;
          });
        }
        setInterimTranscript(interim);
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'no-speech') {
          // ignore silent pause
          return;
        }
        if (event.error === 'not-allowed') {
          showToast('Vui lòng cấp quyền truy cập Microphone trong trình duyệt!');
          stopRecording();
          return;
        }
      };

      recognition.onend = () => {
        // If still flagged as recording, restart seamlessly
        if (isRecording && recognitionRef.current) {
          try {
            recognitionRef.current.start();
          } catch {
            setIsRecording(false);
            stopVisualizer();
          }
        } else {
          setIsRecording(false);
          stopVisualizer();
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      showToast('Không thể kích hoạt microphone. Vui lòng kiểm tra quyền truy cập.');
      setIsRecording(false);
      stopVisualizer();
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    stopVisualizer();
    setInterimTranscript('');

    // Save to history if transcript has content
    if (transcript.trim()) {
      saveSTTHistoryItem(transcript.trim(), currentLang.name, duration);
      showToast('Đã dừng ghi âm và lưu kết quả.');
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const handleClearTranscript = () => {
    setTranscript('');
    setInterimTranscript('');
    setDuration(0);
  };

  const handleCopy = async () => {
    const fullText = (transcript + (interimTranscript ? ' ' + interimTranscript : '')).trim();
    if (!fullText) {
      showToast('Chưa có văn bản để sao chép.');
      return;
    }
    try {
      await navigator.clipboard.writeText(fullText);
      setIsCopied(true);
      showToast('Đã sao chép văn bản vào clipboard!');
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      showToast('Lỗi khi sao chép.');
    }
  };

  const handleDownloadTxt = () => {
    const fullText = (transcript + (interimTranscript ? ' ' + interimTranscript : '')).trim();
    if (!fullText) {
      showToast('Chưa có nội dung để tải về.');
      return;
    }
    const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voice_transcript_${selectedLangId}_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Đã tải xuống file transcript .txt thành công!');
  };

  // Send to TTS
  const handleSendToTTS = () => {
    const fullText = (transcript + (interimTranscript ? ' ' + interimTranscript : '')).trim();
    if (!fullText) {
      showToast('Chưa có văn bản để chuyển sang TTS.');
      return;
    }
    sessionStorage.setItem('stt_to_tts_text', fullText);
    sessionStorage.setItem('stt_to_tts_lang', selectedLangId);
    router.push('/tts');
  };

  // Send to Markdown Converter
  const handleSendToMarkdown = () => {
    const fullText = (transcript + (interimTranscript ? ' ' + interimTranscript : '')).trim();
    if (!fullText) {
      showToast('Chưa có văn bản để chuyển sang Markdown.');
      return;
    }
    sessionStorage.setItem('stt_to_md_text', fullText);
    router.push('/html-to-markdown');
  };

  // History helpers
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

  // Audio File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    setUploadedAudioUrl(url);
    setUploadedAudioName(file.name);
    showToast(`Đã nạp file: ${file.name}. Bạn có thể phát file và nhấn Ghi âm để nhận diện.`);
  };

  // Format mm:ss
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;
  const charCount = transcript.length;

  return (
    <div className="space-y-3.5">
      {/* COMPACT HEADER (Slim, space-efficient top bar) */}
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
                Live Mic & Audio
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Nhận diện trực tiếp qua Micro 5 ngôn ngữ (Việt, Anh, Trung, Hàn, Nhật) với độ chính xác cao.
            </p>
          </div>
        </div>

        {/* Language Tabs Compact Row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-medium text-slate-400 mr-1 hidden md:inline">
            Ngôn ngữ:
          </span>
          {STT_LANGUAGES.map((lang) => {
            const isActive = selectedLangId === lang.id;
            return (
              <button
                key={lang.id}
                onClick={() => {
                  if (isRecording) stopRecording();
                  setSelectedLangId(lang.id);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition flex items-center gap-1 ${
                  isActive
                    ? 'bg-red-600 text-white shadow-xs'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700/60'
                }`}
              >
                <span>{lang.flag}</span>
                <span>{lang.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {!isSupported && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            Trình duyệt của bạn hiện chưa hỗ trợ Web Speech API đầy đủ. Khuyến nghị sử dụng <strong>Google Chrome</strong> hoặc <strong>Microsoft Edge</strong> để có trải nghiệm nhận diện giọng nói mượt mà nhất.
          </span>
        </div>
      )}

      {/* Main Dual-Column Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
        {/* Left Column: Live Audio Controls & Visualizer (5 cols) */}
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

            {/* Big Mic Button & Visualizer */}
            <div className="flex flex-col items-center justify-center py-4 bg-slate-50/70 rounded-xl border border-slate-100 relative overflow-hidden">
              {/* Pulsing indicator when recording */}
              {isRecording && (
                <div className="absolute inset-0 bg-red-500/5 animate-pulse pointer-events-none" />
              )}

              {/* Animated Waveform Visualizer */}
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

              {/* Main Record Button */}
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
                  Micro tự động chuyển lời nói thành chữ
                </p>
              </div>
            </div>

            {/* Quick Action Switches */}
            <div className="flex items-center justify-between text-xs pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600">
                <input
                  type="checkbox"
                  checked={autoPunctuate}
                  onChange={(e) => setAutoPunctuate(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                />
                <span>Tự động viết hoa & ngắt câu</span>
              </label>

              {isRecording && (
                <button
                  onClick={stopRecording}
                  className="text-xs font-medium text-red-600 hover:underline"
                >
                  Dừng & Lưu
                </button>
              )}
            </div>
          </div>

          {/* Audio File Transcription Card */}
          <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Upload className="h-3.5 w-3.5 text-indigo-600" />
                Nạp File Âm thanh có sẵn
              </span>
              <span className="text-[10px] text-slate-400">MP3, WAV, M4A, OGG</span>
            </div>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="audio/*"
              className="hidden"
            />

            {uploadedAudioUrl ? (
              <div className="space-y-2 p-2.5 rounded-lg bg-indigo-50/60 border border-indigo-100">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-indigo-950 truncate max-w-[200px]">
                    {uploadedAudioName}
                  </span>
                  <button
                    onClick={() => {
                      setUploadedAudioUrl(null);
                      setUploadedAudioName(null);
                    }}
                    className="text-[11px] text-red-600 hover:underline"
                  >
                    Gỡ file
                  </button>
                </div>
                <audio
                  ref={audioPlayerRef}
                  src={uploadedAudioUrl}
                  controls
                  className="w-full h-8"
                />
                <p className="text-[11px] text-indigo-700 leading-tight">
                  💡 Bạn có thể bật phát file âm thanh trên loa, sau đó bấm <strong>Bắt đầu Nói</strong> ở trên để nhận diện sang văn bản!
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 px-3 rounded-lg border border-dashed border-slate-300 hover:border-indigo-400 bg-slate-50/50 hover:bg-indigo-50/30 text-xs text-slate-600 transition flex items-center justify-center gap-2"
              >
                <Upload className="h-4 w-4 text-slate-400" />
                <span>Bấm để nạp file ghi âm từ máy tính</span>
              </button>
            )}
          </div>
        </div>

        {/* Right Column: Live Transcript Editor & Export Hub (7 cols) */}
        <div className="lg:col-span-7 space-y-3">
          <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col h-[520px] overflow-hidden">
            {/* Header & Quick Actions */}
            <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-emerald-600" />
                  Văn bản nhận diện (Live Transcript)
                </span>
                {isRecording && (
                  <span className="flex items-center gap-1 text-[11px] text-red-600 font-semibold bg-red-50 px-2 py-0.5 rounded-full border border-red-200 animate-pulse">
                    <span className="h-2 w-2 rounded-full bg-red-600" />
                    Đang ghi nhận...
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
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
                  onClick={handleDownloadTxt}
                  className="h-7 text-xs px-2 text-slate-600 hover:text-slate-900"
                  title="Tải về file .txt"
                >
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Tải .txt
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

            {/* Transcript Area */}
            <div className="flex-1 p-3.5 flex flex-col relative overflow-hidden bg-slate-50/30">
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder={
                  isRecording
                    ? 'Đang lắng nghe... Lời nói của bạn sẽ xuất hiện trực tiếp tại đây...'
                    : 'Nhấn nút Micro bên trái để bắt đầu nói, hoặc gõ và chỉnh sửa văn bản trực tiếp tại đây...'
                }
                className="w-full flex-1 p-3 text-xs sm:text-sm font-sans bg-white rounded-lg border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden resize-none leading-relaxed text-slate-800"
              />

              {/* Interim Real-time Floating Bubble */}
              {interimTranscript && (
                <div className="mt-2 p-2 rounded-lg bg-indigo-50/90 border border-indigo-200 text-xs text-indigo-900 font-medium italic animate-in fade-in flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-indigo-600 animate-ping shrink-0" />
                  <span>{interimTranscript}...</span>
                </div>
              )}
            </div>

            {/* Inter-Tool Cross Integration Hub */}
            <div className="p-2.5 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] text-slate-500 font-mono">
                {wordCount} từ · {charCount} ký tự · Ngôn ngữ: {currentLang.name}
              </div>

              <div className="flex items-center gap-2">
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

          {/* Recent Transcripts History (Collapsible / Compact) */}
          {historyItems.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200/90 p-3 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5 text-indigo-600" />
                  Lịch sử nhận diện gần đây ({historyItems.length})
                </span>
                <button
                  onClick={clearAllHistory}
                  className="text-[11px] text-slate-400 hover:text-red-600"
                >
                  Xóa tất cả
                </button>
              </div>

              <div className="space-y-1.5 max-h-40 overflow-auto">
                {historyItems.slice(0, 5).map((item) => (
                  <div
                    key={item.id}
                    className="p-2 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200/60 text-xs flex items-center justify-between gap-2"
                  >
                    <div className="truncate flex-1">
                      <span className="text-[10px] text-indigo-600 font-semibold mr-1.5">
                        [{item.language}]
                      </span>
                      <span className="text-slate-800">{item.text}</span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => {
                          setTranscript(item.text);
                          showToast('Đã nạp lại văn bản từ lịch sử.');
                        }}
                        className="px-2 py-0.5 rounded text-[10px] bg-white border border-slate-200 hover:bg-indigo-50 text-indigo-700 font-medium"
                      >
                        Nạp lại
                      </button>
                      <button
                        onClick={() => deleteHistoryItem(item.id)}
                        className="p-1 text-slate-400 hover:text-red-600"
                        title="Xóa"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
