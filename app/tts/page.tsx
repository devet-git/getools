'use client';

import { useState, useEffect, useRef, useMemo, useSyncExternalStore } from 'react';
import {
  Volume2,
  Play,
  Pause,
  RotateCcw,
  Download,
  Sparkles,
  Sliders,
  Trash2,
  Copy,
  Check,
  Upload,
  Radio,
  Headphones,
  History,
  Loader2,
  User,
  Zap,
  Mic2,
  Wand2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApp } from '@/components/AppContext';
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
  detectVoiceGender,
  rewriteTextForStyle,
} from '@/lib/tts-config';
import { subscribeStorageSync } from '@/lib/storage';

const emptyArrayString = () => '[]';

function getTTSHistorySnapshot(): string {
  if (typeof window === 'undefined') return '[]';
  try {
    return localStorage.getItem('git_downloader_tts_history_v1') || '[]';
  } catch {
    return '[]';
  }
}

export default function TextToSpeechPage() {
  const { showToast, keys } = useApp();

  // State
  const [selectedLangId, setSelectedLangId] = useState<'vi' | 'en' | 'zh' | 'ko' | 'ja'>('vi');
  const [text, setText] = useState(() => {
    if (typeof window !== 'undefined') {
      const incoming = sessionStorage.getItem('stt_to_tts_text');
      if (incoming) {
        sessionStorage.removeItem('stt_to_tts_text');
        return incoming;
      }
    }
    return SUPPORTED_LANGUAGES[0].sampleTexts[0].content;
  });
  const [engine, setEngine] = useState<'ai' | 'browser'>('ai');
  const [selectedVoice, setSelectedVoice] = useState('Puck');
  const [selectedGender, setSelectedGender] = useState<'male' | 'female' | 'all'>('male');
  const [selectedStyle, setSelectedStyle] = useState('natural');
  const [autoAdaptStyleText, setAutoAdaptStyleText] = useState(false);
  const [originalTextBackup, setOriginalTextBackup] = useState<string>('');
  const [speed, setSpeed] = useState(1.0);
  const [pitch, setPitch] = useState(1.0);

  // Audio Playback & Blob State
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null);
  const [currentAudioMime, setCurrentAudioMime] = useState<string>('audio/wav');
  const [audioDuration, setAudioDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [copied, setCopied] = useState(false);

  // Browser speech state
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedBrowserVoiceURI, setSelectedBrowserVoiceURI] = useState<string>('');

  // History state via useSyncExternalStore
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

  // Audio element reference
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentLang = SUPPORTED_LANGUAGES.find((l) => l.id === selectedLangId) || SUPPORTED_LANGUAGES[0];
  const currentStyleObj = SPEAKING_STYLES.find((s) => s.id === selectedStyle) || SPEAKING_STYLES[0];
  const currentVoiceObj = AI_VOICES.find((v) => v.id === selectedVoice);

  // Initialize browser voices
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const loadVoices = () => {
      const allVoices = window.speechSynthesis.getVoices();
      setBrowserVoices(allVoices);
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Filter browser voices for current language
  const availableBrowserVoices = useMemo(() => {
    const langPrefix = currentLang.bcp47.split('-')[0].toLowerCase();
    return browserVoices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix));
  }, [browserVoices, currentLang.bcp47]);

  // Auto-select browser voice based on gender or first available
  useEffect(() => {
    if (availableBrowserVoices.length === 0) return;

    const matchGender = (gender: 'male' | 'female') => {
      return availableBrowserVoices.find((v) => detectVoiceGender(v.name) === gender);
    };

    if (selectedGender === 'male') {
      const maleVoice = matchGender('male');
      if (maleVoice) {
        setSelectedBrowserVoiceURI(maleVoice.voiceURI);
        return;
      }
    } else if (selectedGender === 'female') {
      const femaleVoice = matchGender('female');
      if (femaleVoice) {
        setSelectedBrowserVoiceURI(femaleVoice.voiceURI);
        return;
      }
    }

    if (!availableBrowserVoices.some((v) => v.voiceURI === selectedBrowserVoiceURI)) {
      setSelectedBrowserVoiceURI(availableBrowserVoices[0].voiceURI);
    }
  }, [selectedLangId, availableBrowserVoices, selectedGender, selectedBrowserVoiceURI]);

  // Audio element event listeners
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

  // Update speed on audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  // Handle language change
  const handleLanguageChange = (lang: LanguageOption) => {
    setSelectedLangId(lang.id);
    const isSample = SUPPORTED_LANGUAGES.some((l) =>
      l.sampleTexts.some((s) => s.content.trim() === text.trim())
    );
    if (!text.trim() || isSample) {
      setText(lang.sampleTexts[0].content);
    }
    stopAudio();
  };

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
  };

  // Helper to process audio through Web Audio DSP for authentic male/female formant AND distinct speaking style
  const processAndCreateAudioUrl = async (
    arrayBuffer: ArrayBuffer,
    targetGender: 'male' | 'female',
    mime: string,
    targetStyle: string
  ): Promise<string> => {
    if (typeof window === 'undefined') return '';
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) {
        const blob = new Blob([arrayBuffer], { type: mime });
        return URL.createObjectURL(blob);
      }

      const audioCtx = new AudioCtx();
      const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));

      const styleObj = SPEAKING_STYLES.find((s) => s.id === targetStyle) || SPEAKING_STYLES[0];

      // Base gender pitch ratio
      const genderBaseRatio = targetGender === 'male' ? 0.83 : 1.02;
      // Combined rate considering style multiplier
      const combinedRate = genderBaseRatio * styleObj.rateMultiplier;

      const newLength = Math.max(1, Math.round(decodedBuffer.length / combinedRate));
      const offlineCtx = new OfflineAudioContext(
        decodedBuffer.numberOfChannels,
        newLength,
        decodedBuffer.sampleRate
      );

      const source = offlineCtx.createBufferSource();
      source.buffer = decodedBuffer;
      source.playbackRate.value = combinedRate;

      let lastNode: AudioNode = source;

      // 1. Gender resonance filter
      if (targetGender === 'male') {
        const maleChest = offlineCtx.createBiquadFilter();
        maleChest.type = 'lowshelf';
        maleChest.frequency.value = 160;
        maleChest.gain.value = 3.0;
        lastNode.connect(maleChest);
        lastNode = maleChest;
      } else {
        const femalePresence = offlineCtx.createBiquadFilter();
        femalePresence.type = 'highshelf';
        femalePresence.frequency.value = 4500;
        femalePresence.gain.value = 1.8;
        lastNode.connect(femalePresence);
        lastNode = femalePresence;
      }

      // 2. Distinct style acoustic filter EQ
      if (targetStyle === 'news') {
        // Broadcast news anchor filter: tight bass, bright presence peak
        const hp = offlineCtx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 110;

        const midBoost = offlineCtx.createBiquadFilter();
        midBoost.type = 'peaking';
        midBoost.frequency.value = 3200;
        midBoost.Q.value = 1.2;
        midBoost.gain.value = 3.5;

        lastNode.connect(hp);
        hp.connect(midBoost);
        lastNode = midBoost;
      } else if (targetStyle === 'story') {
        // Warm storytelling filter: deep resonant warmth, gentle top-end rolloff
        const warmth = offlineCtx.createBiquadFilter();
        warmth.type = 'peaking';
        warmth.frequency.value = 240;
        warmth.Q.value = 1.0;
        warmth.gain.value = 3.5;

        const softTop = offlineCtx.createBiquadFilter();
        softTop.type = 'highshelf';
        softTop.frequency.value = 5500;
        softTop.gain.value = -2.5;

        lastNode.connect(warmth);
        warmth.connect(softTop);
        lastNode = softTop;
      } else if (targetStyle === 'friendly') {
        // Upbeat, cheerful, smiling filter: bright and airy
        const smilePeak = offlineCtx.createBiquadFilter();
        smilePeak.type = 'peaking';
        smilePeak.frequency.value = 2800;
        smilePeak.Q.value = 1.2;
        smilePeak.gain.value = 3.0;

        const air = offlineCtx.createBiquadFilter();
        air.type = 'highshelf';
        air.frequency.value = 8000;
        air.gain.value = 2.0;

        lastNode.connect(smilePeak);
        smilePeak.connect(air);
        lastNode = air;
      } else if (targetStyle === 'presentation') {
        // Executive presentation filter: crisp articulation, strong speaker fundamental
        const articulation = offlineCtx.createBiquadFilter();
        articulation.type = 'peaking';
        articulation.frequency.value = 1800;
        articulation.Q.value = 1.1;
        articulation.gain.value = 2.5;

        lastNode.connect(articulation);
        lastNode = articulation;
      } else if (targetStyle === 'calm') {
        // Relaxing, soothing meditation filter: smooth lowpass, eliminating harsh sibilance
        const gentleLP = offlineCtx.createBiquadFilter();
        gentleLP.type = 'lowpass';
        gentleLP.frequency.value = 4200;

        const softPad = offlineCtx.createBiquadFilter();
        softPad.type = 'lowshelf';
        softPad.frequency.value = 180;
        softPad.gain.value = 2.0;

        lastNode.connect(gentleLP);
        gentleLP.connect(softPad);
        lastNode = softPad;
      }

      lastNode.connect(offlineCtx.destination);
      source.start(0);

      const renderedBuffer = await offlineCtx.startRendering();
      await audioCtx.close();

      // Encode to pristine 16-bit PCM WAV
      const wavArrayBuffer = audioBufferToWav(renderedBuffer);
      const wavBlob = new Blob([wavArrayBuffer], { type: 'audio/wav' });
      setCurrentAudioMime('audio/wav');
      return URL.createObjectURL(wavBlob);
    } catch (e) {
      console.warn('Web Audio processing fallback:', e);
      const blob = new Blob([arrayBuffer], { type: mime });
      setCurrentAudioMime(mime);
      return URL.createObjectURL(blob);
    }
  };

  // Generate / Speak
  const handleGenerateAndPlay = async (customStyle?: string) => {
    if (!text.trim()) {
      showToast('Vui lòng nhập văn bản cần đọc!');
      return;
    }

    const styleToUse = customStyle || selectedStyle;
    stopAudio();

    if (engine === 'browser') {
      playBrowserSpeech(styleToUse);
      return;
    }

    // Use AI / Neural Studio TTS API
    setIsGenerating(true);
    try {
      const activeVoice = AI_VOICES.find((v) => v.id === selectedVoice);
      const effectiveGender = selectedGender === 'all' ? (activeVoice?.gender || 'male') : selectedGender;
      const styleObj = SPEAKING_STYLES.find((s) => s.id === styleToUse) || SPEAKING_STYLES[0];

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (keys.gemini) {
        headers['x-gemini-key'] = keys.gemini.trim();
      }

      const textToSpeak = autoAdaptStyleText
        ? rewriteTextForStyle(text.trim(), styleToUse, selectedLangId)
        : text.trim();

      const res = await fetch('/api/tts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          text: textToSpeak,
          language: selectedLangId,
          voice: selectedVoice,
          gender: effectiveGender,
          style: styleToUse,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success || !data.audioBase64) {
        if (data.fallbackToBrowser) {
          showToast('Chuyển sang chế độ giọng đọc Trình duyệt do máy chủ chưa khả dụng.');
          playBrowserSpeech(styleToUse);
        } else {
          showToast(data.error || 'Lỗi khi tạo giọng nói từ AI.');
        }
        setIsGenerating(false);
        return;
      }

      // Decode base64 to ArrayBuffer
      const byteCharacters = atob(data.audioBase64);
      const byteNumbers = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }

      // Process audio through Web Audio for authentic male / female rendering & style DSP
      const audioUrl = await processAndCreateAudioUrl(
        byteNumbers.buffer,
        effectiveGender,
        data.mimeType || 'audio/wav',
        styleToUse
      );

      if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
      }

      setCurrentAudioUrl(audioUrl);

      // Save to TTS History
      saveTTSHistoryItem({
        text: text.trim(),
        language: selectedLangId,
        voice: `${selectedVoice} (${effectiveGender === 'male' ? 'Nam' : 'Nữ'})`,
        style: styleObj.name,
        engine: 'ai',
        audioBase64: data.audioBase64.length < 600000 ? data.audioBase64 : undefined,
      });

      showToast(`Đã áp dụng: Giọng ${effectiveGender === 'male' ? 'Nam' : 'Nữ'} · Phong cách: ${styleObj.name}`);

      // Auto play
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.playbackRate = speed;
          audioRef.current.play().catch(() => {});
        }
      }, 100);
    } catch {
      showToast('Không thể kết nối máy chủ. Đang chuyển sang giọng đọc trình duyệt...');
      playBrowserSpeech(styleToUse);
    } finally {
      setIsGenerating(false);
    }
  };

  const playBrowserSpeech = (customStyle?: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      showToast('Trình duyệt không hỗ trợ Web Speech Synthesis.');
      return;
    }

    const styleToUse = customStyle || selectedStyle;
    const styleObj = SPEAKING_STYLES.find((s) => s.id === styleToUse) || SPEAKING_STYLES[0];
    const activeVoice = AI_VOICES.find((v) => v.id === selectedVoice);
    const effectiveGender = selectedGender === 'all' ? (activeVoice?.gender || 'male') : selectedGender;

    const textToSpeak = autoAdaptStyleText
      ? rewriteTextForStyle(text.trim(), styleToUse, selectedLangId)
      : text.trim();

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.lang = currentLang.bcp47;

    // Apply speed adjusted by style multiplier
    utterance.rate = Math.max(0.5, Math.min(2.0, speed * styleObj.rateMultiplier));

    // Apply distinct pitch for male vs female combined with style multiplier
    if (effectiveGender === 'male') {
      utterance.pitch = Math.min(0.85, Math.max(0.55, pitch * 0.78 * styleObj.pitchMultiplier));
    } else {
      utterance.pitch = Math.max(1.02, Math.min(1.50, pitch * 1.08 * styleObj.pitchMultiplier));
    }

    // Try to match appropriate browser voice if available
    if (selectedBrowserVoiceURI) {
      const match = browserVoices.find((v) => v.voiceURI === selectedBrowserVoiceURI);
      if (match) utterance.voice = match;
    } else if (availableBrowserVoices.length > 0) {
      const matchedByGender = availableBrowserVoices.find(
        (v) => detectVoiceGender(v.name) === effectiveGender
      );
      if (matchedByGender) {
        utterance.voice = matchedByGender;
      } else {
        utterance.voice = availableBrowserVoices[0];
      }
    }

    utterance.onstart = () => setIsPlaying(true);
    utterance.onend = () => setIsPlaying(false);
    utterance.onerror = (e: any) => {
      // Normal cancellation/interruption events fired when previous speech is canceled
      setIsPlaying(false);
      if (!e || e?.error === 'canceled' || e?.error === 'interrupted') {
        return;
      }
    };

    // Safe execution avoiding Chromium speech cancel collision
    const speakNow = () => {
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        setIsPlaying(false);
      }
    };

    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
      setTimeout(speakNow, 80);
    } else {
      speakNow();
    }

    showToast(`Đang đọc: Giọng ${effectiveGender === 'male' ? 'Nam' : 'Nữ'} · ${styleObj.name} (${styleObj.badge})`);

    // Save to history
    saveTTSHistoryItem({
      text: text.trim(),
      language: selectedLangId,
      voice: `${effectiveGender === 'male' ? 'Nam (Browser)' : 'Nữ (Browser)'}`,
      style: styleObj.name,
      engine: 'browser',
    });
  };

  const togglePlayPause = () => {
    if (engine === 'browser') {
      if (isPlaying) {
        window.speechSynthesis.cancel();
        setIsPlaying(false);
      } else {
        playBrowserSpeech();
      }
      return;
    }

    if (!audioRef.current || !currentAudioUrl) {
      handleGenerateAndPlay();
      return;
    }

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
  };

  // Direct Universal Audio Downloader
  const handleDownloadSpeech = async (customUrl?: string, customFilename?: string) => {
    const targetUrl = customUrl || currentAudioUrl;

    if (targetUrl) {
      const a = document.createElement('a');
      a.href = targetUrl;
      const cleanName = (customFilename || text).trim().slice(0, 24).replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g, '_');
      const ext = currentAudioMime.includes('wav') ? 'wav' : 'mp3';
      a.download = `speech_${selectedLangId}_${selectedStyle}_${cleanName || 'audio'}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
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
      const effectiveGender = selectedGender === 'all' ? (activeVoice?.gender || 'male') : selectedGender;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (keys.gemini) {
        headers['x-gemini-key'] = keys.gemini.trim();
      }

      const res = await fetch('/api/tts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          text: text.trim(),
          language: selectedLangId,
          voice: selectedVoice,
          gender: effectiveGender,
          style: selectedStyle,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success || !data.audioBase64) {
        throw new Error(data.error || 'Không thể tạo file âm thanh');
      }

      const byteCharacters = atob(data.audioBase64);
      const byteNumbers = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }

      const url = await processAndCreateAudioUrl(
        byteNumbers.buffer,
        effectiveGender,
        data.mimeType || 'audio/wav',
        selectedStyle
      );

      setCurrentAudioUrl(url);

      // Trigger download
      const a = document.createElement('a');
      a.href = url;
      const cleanName = text.trim().slice(0, 24).replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g, '_');
      const ext = currentAudioMime.includes('wav') ? 'wav' : 'mp3';
      a.download = `speech_${selectedLangId}_${selectedStyle}_${cleanName || 'audio'}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      showToast('Tải file âm thanh thành công!');
    } catch (e: any) {
      showToast(e?.message || 'Lỗi khi tải file âm thanh.');
    } finally {
      setIsDownloading(false);
    }
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 200 * 1024) {
      showToast('Vui lòng chọn file văn bản nhỏ hơn 200KB!');
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

  const handlePlayHistory = (item: TTSHistoryItem) => {
    setText(item.text);
    if (['vi', 'en', 'zh', 'ko', 'ja'].includes(item.language)) {
      setSelectedLangId(item.language as any);
    }
    if (item.audioBase64) {
      const byteCharacters = atob(item.audioBase64);
      const byteNumbers = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const blob = new Blob([byteNumbers], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
      setCurrentAudioUrl(url);
      setEngine('ai');
      setTimeout(() => {
        if (audioRef.current) audioRef.current.play();
      }, 100);
      showToast('Đang phát lại đoạn âm thanh đã lưu!');
    } else {
      showToast('Đã khôi phục nội dung văn bản. Bạn có thể nhấn Tạo & Phát âm!');
    }
  };

  const handleDownloadHistoryItem = async (item: TTSHistoryItem) => {
    if (item.audioBase64) {
      const byteCharacters = atob(item.audioBase64);
      const byteNumbers = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const blob = new Blob([byteNumbers], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const clean = item.text.trim().slice(0, 20).replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g, '_');
      a.download = `tts_history_${item.language}_${clean || 'audio'}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Đã tải file âm thanh từ lịch sử!');
    } else {
      setText(item.text);
      if (['vi', 'en', 'zh', 'ko', 'ja'].includes(item.language)) {
        setSelectedLangId(item.language as any);
      }
      await handleDownloadSpeech(undefined, item.text);
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Filtered voice list by gender
  const filteredVoices = useMemo(() => {
    if (selectedGender === 'all') return AI_VOICES;
    return AI_VOICES.filter((v) => v.gender === selectedGender);
  }, [selectedGender]);

  // When changing gender filter, make sure selectedVoice matches the gender
  const handleSelectGenderFilter = (gender: 'male' | 'female' | 'all') => {
    setSelectedGender(gender);
    if (gender === 'male') {
      const current = AI_VOICES.find((v) => v.id === selectedVoice);
      if (!current || current.gender !== 'male') {
        setSelectedVoice('Puck');
      }
    } else if (gender === 'female') {
      const current = AI_VOICES.find((v) => v.id === selectedVoice);
      if (!current || current.gender !== 'female') {
        setSelectedVoice('Kore');
      }
    }
    stopAudio();
  };

  const handleApplyStyleToText = (styleId?: string) => {
    const targetStyle = styleId || selectedStyle;
    if (!text.trim()) {
      showToast('Vui lòng nhập hoặc nạp văn bản trước!');
      return;
    }
    if (!originalTextBackup) {
      setOriginalTextBackup(text);
    }
    const adapted = rewriteTextForStyle(text, targetStyle, selectedLangId);
    setText(adapted);
    const targetObj = SPEAKING_STYLES.find((s) => s.id === targetStyle);
    showToast(`Đã diễn đạt lại văn bản theo phong cách: ${targetObj?.name}`);
  };

  const handleRestoreOriginalText = () => {
    if (originalTextBackup) {
      setText(originalTextBackup);
      showToast('Đã khôi phục văn bản gốc ban đầu.');
    }
  };

  // Change speaking style with instant notification & auto-play if already loaded
  const handleSelectStyle = (styleId: string) => {
    setSelectedStyle(styleId);
    const targetObj = SPEAKING_STYLES.find((s) => s.id === styleId);
    showToast(`Đã chọn phong cách: ${targetObj?.name} (${targetObj?.badge})`);
    
    if (autoAdaptStyleText && text.trim()) {
      if (!originalTextBackup) {
        setOriginalTextBackup(text);
      }
      const adapted = rewriteTextForStyle(text, styleId, selectedLangId);
      setText(adapted);
    }

    // If audio is already active, re-generate immediately so the user hears the distinct acoustic profile!
    if (currentAudioUrl || isPlaying) {
      handleGenerateAndPlay(styleId);
    }
  };

  return (
    <div className="space-y-3.5">
      {/* Hidden audio element */}
      <audio ref={audioRef} src={currentAudioUrl || undefined} preload="auto" />
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".txt,.md,.text"
        className="hidden"
      />

      {/* COMPACT SLIM HEADER */}
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0">
            <Volume2 className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-bold tracking-tight">
                Chuyển văn bản thành giọng nói (Text-to-Speech)
              </h1>
              <span className="px-2 py-0.2 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                AI Neural Studio
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              5 ngôn ngữ (Việt, Anh, Trung, Hàn, Nhật) · Giọng Nam/Nữ · 6 phong cách diễn đạt âm học
            </p>
          </div>
        </div>

        {/* Compact Language Switcher */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-medium text-slate-400 mr-1 hidden md:inline">
            Ngôn ngữ:
          </span>
          {SUPPORTED_LANGUAGES.map((lang) => {
            const isActive = selectedLangId === lang.id;
            return (
              <button
                key={lang.id}
                onClick={() => handleLanguageChange(lang)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition flex items-center gap-1 ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-xs'
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

      {/* Main Workspace (Two Columns) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
        {/* Left Column: Text Input & Audio Studio Player (7 cols) */}
        <div className="lg:col-span-7 space-y-3">
          <div className="bg-white rounded-xl border border-border p-4 shadow-xs space-y-3">
            {/* Toolbar */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">{currentLang.flag}</span>
                <div>
                  <h2 className="font-semibold text-sm text-slate-900">
                    Văn bản đầu vào ({currentLang.name})
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Mã BCP-47: <code className="font-mono text-indigo-600">{currentLang.bcp47}</code>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleApplyStyleToText()}
                  className="h-7 text-xs px-2.5 text-amber-800 bg-amber-50 hover:bg-amber-100 border-amber-300 font-medium"
                  title="Biến đổi văn bản đầu vào theo phong cách diễn đạt đang chọn"
                >
                  <Wand2 className="h-3.5 w-3.5 mr-1 text-amber-600" />
                  Diễn đạt lại theo phong cách
                </Button>
                {originalTextBackup && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRestoreOriginalText}
                    className="h-7 text-xs px-2 text-slate-600 hover:text-slate-900"
                    title="Khôi phục lại văn bản ban đầu"
                  >
                    <RotateCcw className="h-3 w-3 mr-1 text-slate-500" />
                    Bản gốc
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-7 text-xs px-2 text-slate-600 hover:text-slate-900"
                  title="Tải văn bản từ file .txt hoặc .md"
                >
                  <Upload className="h-3.5 w-3.5 mr-1" />
                  Nạp file
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyText}
                  className="h-7 text-xs px-2 text-slate-600 hover:text-slate-900"
                  title="Sao chép văn bản"
                >
                  {copied ? <Check className="h-3.5 w-3.5 mr-1 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                  {copied ? 'Đã chép' : 'Sao chép'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setText('');
                    setOriginalTextBackup('');
                  }}
                  className="h-7 text-xs px-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                  title="Xóa trắng"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Xóa
                </Button>
              </div>
            </div>

            {/* Textarea */}
            <div className="relative">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`Nhập đoạn văn bản bằng ${currentLang.name} cần chuyển đổi sang giọng nói...`}
                rows={7}
                className="w-full text-sm p-3.5 rounded-lg border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-hidden transition resize-y font-sans leading-relaxed text-slate-800"
              />
              <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1.5 px-1">
                <span>
                  {text.trim().split(/\s+/).filter(Boolean).length} từ · {text.length} ký tự
                </span>
                <span>Hỗ trợ ngữ điệu, ngắt nghỉ, thanh điệu chuẩn xác</span>
              </div>
            </div>

            {/* Quick Sample Texts */}
            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                <span className="text-xs font-semibold text-slate-700">Mẫu câu nhanh ({currentLang.name}):</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {currentLang.sampleTexts.map((sample, idx) => (
                  <button
                    key={idx}
                    onClick={() => setText(sample.content)}
                    className="text-xs text-left px-2.5 py-1.5 rounded-md bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200/80 hover:border-indigo-200 text-slate-700 transition"
                  >
                    <span className="font-medium block">{sample.title}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Audio Player & Studio Bar */}
          <div className="bg-slate-900 text-white rounded-xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                  <Headphones className="h-4.5 w-4.5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2">
                    <span>Audio Studio Player</span>
                    <span className={`text-[10px] font-bold px-2 py-0.2 rounded-full ${
                      (currentVoiceObj?.gender === 'male' || selectedGender === 'male')
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                        : 'bg-pink-500/20 text-pink-300 border border-pink-500/30'
                    }`}>
                      {(currentVoiceObj?.gender === 'male' || selectedGender === 'male') ? '👨 Giọng Nam' : '👩 Giọng Nữ'}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {engine === 'ai' 
                      ? `Mô hình: ${selectedVoice} (${(currentVoiceObj?.gender === 'male' || selectedGender === 'male') ? 'Nam' : 'Nữ'}) · ${currentLang.name}`
                      : `Trình duyệt: ${currentLang.bcp47} (${selectedGender === 'male' ? 'Nam' : 'Nữ'})`}
                  </p>
                </div>
              </div>

              {/* Engine Badge */}
              <div className="flex items-center gap-1.5 text-xs">
                {engine === 'ai' ? (
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5 font-medium">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    AI Neural
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 font-medium">
                    Web Speech
                  </span>
                )}
              </div>
            </div>

            {/* Active Style Indicator Chip Banner */}
            <div className="flex items-center justify-between bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/60 text-xs">
              <div className="flex items-center gap-2">
                <Mic2 className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-slate-300 font-medium">Phong cách hiện tại:</span>
                <span className="font-bold text-amber-300">{currentStyleObj.name}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-200 border border-amber-500/30 font-mono">
                  {currentStyleObj.badge}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 hidden sm:block">
                Tốc độ hiệu dụng: <span className="font-mono text-cyan-300 font-bold">{(speed * currentStyleObj.rateMultiplier).toFixed(2)}x</span>
              </div>
            </div>

            {/* Waveform Visualization Simulator */}
            <div className="h-12 bg-slate-950/60 rounded-lg border border-slate-800 flex items-center justify-center gap-1 px-4 overflow-hidden">
              {Array.from({ length: 48 }).map((_, i) => {
                const heightPercent = isPlaying
                  ? Math.sin(i * 0.4 + currentTime * 8) * 40 + 50
                  : Math.sin(i * 0.3) * 15 + 25;
                return (
                  <div
                    key={i}
                    style={{ height: `${Math.max(10, Math.min(95, heightPercent))}%` }}
                    className={`w-1 rounded-full transition-all duration-75 ${
                      isPlaying
                        ? (selectedGender === 'male' ? 'bg-gradient-to-t from-cyan-500 to-indigo-400' : 'bg-gradient-to-t from-pink-500 to-indigo-400')
                        : 'bg-slate-700/60'
                    }`}
                  />
                );
              })}
            </div>

            {/* Seek Bar */}
            {engine === 'ai' && (
              <div className="space-y-1">
                <input
                  type="range"
                  min="0"
                  max={audioDuration || 100}
                  step="0.01"
                  value={currentTime}
                  onChange={handleSeek}
                  disabled={!currentAudioUrl}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 disabled:opacity-40"
                />
                <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(audioDuration)}</span>
                </div>
              </div>
            )}

            {/* Action Buttons: Play, Pause, Stop, Download */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-800/80">
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => handleGenerateAndPlay()}
                  disabled={isGenerating || !text.trim()}
                  className="h-10 px-5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg shadow-sm gap-2"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Đang tạo âm thanh...</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 fill-white" />
                      <span>Tạo & Phát âm</span>
                    </>
                  )}
                </Button>

                {currentAudioUrl && engine === 'ai' && (
                  <Button
                    variant="outline"
                    onClick={togglePlayPause}
                    className="h-10 px-3 border-slate-700 hover:bg-slate-800 text-slate-200"
                    title={isPlaying ? 'Tạm dừng' : 'Tiếp tục phát'}
                  >
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                )}

                <Button
                  variant="ghost"
                  onClick={stopAudio}
                  className="h-10 px-3 hover:bg-slate-800 text-slate-400 hover:text-white"
                  title="Dừng phát"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>

              {/* Tải về âm thanh */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleDownloadSpeech()}
                  disabled={isDownloading || !text.trim()}
                  className="h-10 px-4 border-slate-700 hover:bg-slate-800 text-emerald-400 hover:text-emerald-300 gap-2 text-xs font-semibold shadow-xs"
                  title="Tải đoạn âm thanh đã tạo về máy tính (.wav/.mp3)"
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
          </div>
        </div>

        {/* Right Column: Voice & Speech Engine Settings (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-xl border border-border p-5 shadow-xs space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-indigo-600" />
                <h2 className="font-semibold text-sm text-slate-900">Thiết lập giọng đọc</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowHistory(!showHistory)}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
              >
                <History className="h-3.5 w-3.5" />
                <span>Lịch sử ({historyItems.length})</span>
              </button>
            </div>

            {/* Engine Selection */}
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-2">Công nghệ phát giọng:</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEngine('ai');
                    stopAudio();
                  }}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    engine === 'ai'
                      ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-500'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-900">AI Neural Studio</span>
                    <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                  </div>
                  <p className="text-[11px] text-slate-500 leading-tight">
                    Cảm xúc tự nhiên, xuất file âm thanh WAV/MP3, giọng Nam & Nữ chuẩn.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setEngine('browser');
                    stopAudio();
                  }}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    engine === 'browser'
                      ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-500'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-900">Web Speech API</span>
                    <Radio className="h-3.5 w-3.5 text-sky-600" />
                  </div>
                  <p className="text-[11px] text-slate-500 leading-tight">
                    Phát trực tiếp trên trình duyệt, không cần mạng, tùy biến cao độ.
                  </p>
                </button>
              </div>
            </div>

            {/* GENDER FILTER TABS (Nam vs Nữ) */}
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
                <button
                  type="button"
                  onClick={() => handleSelectGenderFilter('male')}
                  className={`py-1.5 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 ${
                    selectedGender === 'male'
                      ? 'bg-white text-cyan-800 shadow-xs ring-1 ring-cyan-500'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>👨 Giọng Nam</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectGenderFilter('female')}
                  className={`py-1.5 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 ${
                    selectedGender === 'female'
                      ? 'bg-white text-pink-800 shadow-xs ring-1 ring-pink-500'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>👩 Giọng Nữ</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectGenderFilter('all')}
                  className={`py-1.5 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 ${
                    selectedGender === 'all'
                      ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-300'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>Tất cả ({AI_VOICES.length})</span>
                </button>
              </div>
            </div>

            {/* Voice Personas (AI Engine) */}
            {engine === 'ai' ? (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-700 block">
                  Danh sách nhân vật giọng AI ({filteredVoices.length} lựa chọn):
                </label>
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
                            ? (isMale
                                ? 'border-cyan-600 bg-cyan-50/60 text-cyan-950 ring-1 ring-cyan-500'
                                : 'border-pink-600 bg-pink-50/60 text-pink-950 ring-1 ring-pink-500')
                            : 'border-slate-200 hover:border-slate-300 bg-white text-slate-800'
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs">{v.name}</span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                              isMale
                                ? 'bg-cyan-100 text-cyan-700'
                                : 'bg-pink-100 text-pink-700'
                            }`}>
                              {isMale ? 'Nam' : 'Nữ'}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                              {v.tone}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                            {v.description}
                          </p>
                        </div>
                        {isSelected && (
                          <div className={`h-2.5 w-2.5 rounded-full mt-1.5 shrink-0 ${isMale ? 'bg-cyan-600' : 'bg-pink-600'}`} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Browser Voice selection */
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-700 block">
                  Giọng trình duyệt ({availableBrowserVoices.length} giọng cho {currentLang.name}):
                </label>
                {availableBrowserVoices.length > 0 ? (
                  <select
                    value={selectedBrowserVoiceURI}
                    onChange={(e) => setSelectedBrowserVoiceURI(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500"
                  >
                    {availableBrowserVoices.map((v) => {
                      const detected = detectVoiceGender(v.name);
                      return (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {v.name} ({detected === 'male' ? 'Nam' : detected === 'female' ? 'Nữ' : v.lang})
                        </option>
                      );
                    })}
                  </select>
                ) : (
                  <p className="text-xs text-amber-600 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                    Trình duyệt chưa cài sẵn gói giọng địa phương cho {currentLang.name}. Vui lòng chuyển sang <strong>AI Neural Studio</strong> để trải nghiệm âm thanh chân thực nhất!
                  </p>
                )}
              </div>
            )}

            {/* SPEAKING STYLE SELECTION WITH ACOUSTIC PROFILES (Active in BOTH AI and Browser modes) */}
            <div className="space-y-2.5 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  <span>Phong cách diễn đạt (Acoustic & Style Profile):</span>
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
                        isSelected
                          ? 'border-amber-500 bg-amber-50/70 text-amber-950 ring-1 ring-amber-400 shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60 text-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="font-bold text-xs leading-tight">{st.name}</span>
                        {isSelected && (
                          <div className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                        )}
                      </div>
                      
                      <div className="flex items-center justify-between gap-1 mb-1.5">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.2 rounded font-mono ${
                          isSelected ? 'bg-amber-200/70 text-amber-900' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {st.badge}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectStyle(st.id);
                            handleApplyStyleToText(st.id);
                          }}
                          className="text-[10px] font-medium text-amber-700 hover:text-amber-900 hover:bg-amber-100/80 px-1.5 py-0.5 rounded transition flex items-center gap-1"
                          title="Áp dụng cấu trúc văn phong này vào khung soạn thảo"
                        >
                          <Wand2 className="h-2.5 w-2.5" />
                          Đổi lời văn
                        </button>
                      </div>

                      <p className="text-[11px] text-slate-500 leading-snug line-clamp-2">
                        {st.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Speed & Pitch Controls */}
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div>
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

              {engine === 'browser' && (
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-semibold text-slate-700">Cao độ gốc (Base Pitch):</span>
                    <span className="font-mono text-indigo-600 font-bold">{pitch}</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="1.5"
                    step="0.1"
                    value={pitch}
                    onChange={(e) => setPitch(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* History Slide-down / Panel */}
      {showHistory && (
        <div className="bg-white rounded-xl border border-border p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-slate-500" />
              <h3 className="font-semibold text-sm text-slate-900">Lịch sử tạo giọng nói gần đây</h3>
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
            <p className="text-xs text-slate-400 italic py-4 text-center">
              Chưa có đoạn âm thanh nào được lưu. Hãy thử nhập văn bản và nhấn &quot;Tạo &amp; Phát âm&quot;!
            </p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
              {historyItems.map((item) => (
                <div key={item.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-1.5 py-0.2 rounded bg-slate-100 font-medium text-slate-700 text-[10px] uppercase">
                        {item.language}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-[10px] text-indigo-600 font-medium">
                        {item.voice} · {item.style}
                      </span>
                    </div>
                    <p className="truncate text-slate-700">{item.text}</p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePlayHistory(item)}
                      className="h-7 text-xs px-2.5"
                      title="Phát lại đoạn văn bản này"
                    >
                      <Play className="h-3 w-3 mr-1" />
                      Phát
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownloadHistoryItem(item)}
                      className="h-7 text-xs px-2.5 text-emerald-700 hover:text-emerald-800 border-emerald-200 hover:bg-emerald-50"
                      title="Tải đoạn âm thanh này về máy"
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
                      title="Xóa mục"
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
