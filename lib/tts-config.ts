export interface LanguageOption {
  id: 'vi' | 'en' | 'zh' | 'ko' | 'ja';
  name: string;
  nativeName: string;
  flag: string;
  bcp47: string;
  sampleTexts: { title: string; content: string }[];
}

export interface VoiceOption {
  id: string;
  name: string;
  gender: 'female' | 'male';
  tone: string;
  description: string;
  isAi: boolean;
}

export interface StyleOption {
  id: string;
  name: string;
  description: string;
  badge: string;
  rateMultiplier: number;
  pitchMultiplier: number;
  pauseMultiplier: number;
  eqPreset: 'news' | 'story' | 'friendly' | 'presentation' | 'calm' | 'natural';
}

export interface TTSHistoryItem {
  id: string;
  text: string;
  language: string;
  voice: string;
  style: string;
  engine: 'ai' | 'browser';
  timestamp: number;
  audioBase64?: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  {
    id: 'vi',
    name: 'Tiếng Việt',
    nativeName: 'Tiếng Việt',
    flag: '🇻🇳',
    bcp47: 'vi-VN',
    sampleTexts: [
      {
        title: 'Lời chào & Giới thiệu',
        content: 'Xin chào các bạn! Chào mừng bạn đến với ứng dụng công cụ đa năng. Hôm nay chúng ta sẽ cùng khám phá tính năng chuyển đổi văn bản thành giọng nói thông minh.',
      },
      {
        title: 'Bản tin công nghệ',
        content: 'Tin công nghệ hôm nay: Các mô hình trí tuệ nhân tạo thế hệ mới đang mang lại trải nghiệm tương tác giọng nói tự nhiên, mượt mà và đa ngôn ngữ vượt trội hơn bao giờ hết.',
      },
      {
        title: 'Đoạn văn truyền cảm',
        content: 'Mỗi buổi sáng thức dậy là một cơ hội mới để bạn học hỏi những điều tuyệt vời. Hãy giữ vững niềm tin và nhiệt huyết với đam mê của mình.',
      },
    ],
  },
  {
    id: 'en',
    name: 'Tiếng Anh',
    nativeName: 'English',
    flag: '🇬🇧',
    bcp47: 'en-US',
    sampleTexts: [
      {
        title: 'Welcome & Introduction',
        content: 'Hello everyone! Welcome to our multi-purpose developer studio. This tool converts any text into crystal-clear, natural speech with advanced AI voices.',
      },
      {
        title: 'Product Pitch',
        content: 'Empower your content with life-like speech synthesis. Experience unmatched clarity, responsive pitch adjustments, and seamless cross-language capabilities.',
      },
      {
        title: 'Inspirational Quote',
        content: 'The journey of a thousand miles begins with a single step. Keep coding, keep innovating, and enjoy the adventure of building great software.',
      },
    ],
  },
  {
    id: 'zh',
    name: 'Tiếng Trung',
    nativeName: '中文 (普通话)',
    flag: '🇨🇳',
    bcp47: 'zh-CN',
    sampleTexts: [
      {
        title: '问候与介绍',
        content: '大家好！欢迎来到多功能工具平台。现在体验自然流畅的文字转语音功能，让您的文字内容更加生动动听。',
      },
      {
        title: '科技资讯',
        content: '人工智能技术的迅速发展为多语言沟通带来了前所未有的便利，语音合成效果更加逼真自然。',
      },
      {
        title: '励志短语',
        content: '千里之行，始于足下。坚持每天学习新知识，探索更广阔的技术天地。',
      },
    ],
  },
  {
    id: 'ko',
    name: 'Tiếng Hàn',
    nativeName: '한국어',
    flag: '🇰🇷',
    bcp47: 'ko-KR',
    sampleTexts: [
      {
        title: '인사 및 소개',
        content: '안녕하세요! 다기능 개발 도구에 오신 것을 환영합니다. 인공지능 기반 텍스트 음성 변환 서비스를 경험해보세요.',
      },
      {
        title: '기술 뉴스',
        content: '최신 음성 합성 기술은 자연스러운 억양과 감정 표현으로 더욱 생생하고 매끄러운 오디오를 전달합니다.',
      },
      {
        title: '격려의 말',
        content: '오늘 하루도 힘내세요. 작은 노력이 모여 커다란 성과를 만들어냅니다.',
      },
    ],
  },
  {
    id: 'ja',
    name: 'Tiếng Nhật',
    nativeName: '日本語',
    flag: '🇯🇵',
    bcp47: 'ja-JP',
    sampleTexts: [
      {
        title: '挨拶と紹介',
        content: 'みなさん、こんにちは！多機能ツールスタジオへようこそ。高精度な音声合成で、テキストを自然でクリアな音声に変換します。',
      },
      {
        title: 'テクノロジー情報',
        content: '最新のAI技術により、滑らかな発音と豊かな表現力を持つ音声生成が可能になりました。',
      },
      {
        title: '応援メッセージ',
        content: '今日も素晴らしい一日になりますように。一歩ずつ前進して、新しい目標を達成しましょう。',
      },
    ],
  },
];

export const AI_VOICES: VoiceOption[] = [
  {
    id: 'Kore',
    name: 'Kore (Nữ)',
    gender: 'female',
    tone: 'Ấm áp & Thanh lịch',
    description: 'Giọng nữ chuẩn, ấm áp, truyền cảm, thích hợp đọc tin tức và thuyết trình.',
    isAi: true,
  },
  {
    id: 'Puck',
    name: 'Puck (Nam)',
    gender: 'male',
    tone: 'Trẻ trung & Năng động',
    description: 'Giọng nam tươi sáng, linh hoạt, rất hợp với podcast và nội dung hiện đại.',
    isAi: true,
  },
  {
    id: 'Fenrir',
    name: 'Fenrir (Nam)',
    gender: 'male',
    tone: 'Trầm ấm & Đĩnh đạc',
    description: 'Giọng nam trầm, dứt khoát, uy quyền và mang tính chuyên môn cao.',
    isAi: true,
  },
  {
    id: 'Charon',
    name: 'Charon (Nam)',
    gender: 'male',
    tone: 'Điềm đạm & Sâu lắng',
    description: 'Giọng nam chín chắn, thư thái, thích hợp cho tài liệu học thuật và dẫn truyện.',
    isAi: true,
  },
  {
    id: 'Zephyr',
    name: 'Zephyr (Nữ)',
    gender: 'female',
    tone: 'Dịu dàng & Trong trẻo',
    description: 'Giọng nữ nhẹ nhàng, êm dịu, rất dễ chịu khi nghe lâu.',
    isAi: true,
  },
];

export const SPEAKING_STYLES: StyleOption[] = [
  { 
    id: 'natural', 
    name: 'Tự nhiên & Chuẩn mực', 
    description: 'Nhịp điệu sinh hoạt tự nhiên, ngắt nghỉ cân bằng, âm sắc nguyên bản',
    badge: '1.0x · Cân bằng',
    rateMultiplier: 1.0,
    pitchMultiplier: 1.0,
    pauseMultiplier: 1.0,
    eqPreset: 'natural',
  },
  { 
    id: 'news', 
    name: 'Bản tin thời sự', 
    description: 'Phong thái phát thanh viên, nhịp nhanh dứt khoát, âm sắc trực diện dõng dạc',
    badge: '1.25x Nhanh · Dứt khoát',
    rateMultiplier: 1.25,
    pitchMultiplier: 1.06,
    pauseMultiplier: 0.6,
    eqPreset: 'news',
  },
  { 
    id: 'story', 
    name: 'Kể chuyện truyền cảm', 
    description: 'Biểu cảm sâu lắng, trầm ấm, ngắt nghỉ kịch tính, phong cách dẫn truyện',
    badge: '0.84x Sâu lắng · Trầm ấm',
    rateMultiplier: 0.84,
    pitchMultiplier: 0.88,
    pauseMultiplier: 1.9,
    eqPreset: 'story',
  },
  { 
    id: 'friendly', 
    name: 'Thân thiện & Tươi vui', 
    description: 'Giọng điệu hồ hởi tươi sáng, cao độ sôi nổi, truyền năng lượng tích cực',
    badge: '+16% Cao độ · Sôi nổi',
    rateMultiplier: 1.14,
    pitchMultiplier: 1.16,
    pauseMultiplier: 0.85,
    eqPreset: 'friendly',
  },
  { 
    id: 'presentation', 
    name: 'Thuyết trình chuyên môn', 
    description: 'Điềm đạm, mạch lạc, nhấn mạnh trọng tâm, phong thái diễn giả hội nghị',
    badge: 'Chững chạc · Rõ ràng',
    rateMultiplier: 0.96,
    pitchMultiplier: 0.95,
    pauseMultiplier: 1.5,
    eqPreset: 'presentation',
  },
  { 
    id: 'calm', 
    name: 'Thư giãn & Êm dịu', 
    description: 'Chậm rãi, nhẹ nhàng, du dương như ru ngủ hoặc thiền định thư thái',
    badge: '0.74x Chậm rãi · Ru ngủ',
    rateMultiplier: 0.74,
    pitchMultiplier: 0.84,
    pauseMultiplier: 2.4,
    eqPreset: 'calm',
  },
];

/**
 * Rewrites input text to match the specific tone and phrasing of the selected speaking style.
 */
export function rewriteTextForStyle(text: string, styleId: string, langId = 'vi'): string {
  const clean = text.trim();
  if (!clean) return '';

  if (styleId === 'natural') return clean;

  if (langId === 'vi') {
    switch (styleId) {
      case 'news':
        return `Bản tin hôm nay xin kính chào quý vị và các bạn! Sau đây là nội dung chi tiết: ${clean}. Bản tin của chúng tôi xin được khép lại tại đây, cảm ơn quý vị đã chú ý theo dõi!`;
      case 'story':
        return `Ngày xưa, trong một khoảnh khắc tĩnh lặng của thời gian... ${clean}... Và câu chuyện ấy mãi luôn đọng lại trong tâm trí mỗi chúng ta.`;
      case 'friendly':
        return `Chào bạn nhé! Hôm nay thật tuyệt vời khi được chia sẻ điều này cùng bạn: ${clean}! Chúc bạn luôn tràn đầy năng lượng và có một ngày thật nhiều niềm vui nhé!`;
      case 'presentation':
        return `Kính thưa quý vị đại biểu và các anh chị đồng nghiệp, tôi xin phép được trình bày nội dung trọng tâm hôm nay: ${clean}. Xin trân trọng cảm ơn sự chú ý lắng nghe của toàn thể hội nghị.`;
      case 'calm':
        return `Hãy nhẹ nhàng thả lỏng cơ thể, hít thở thật sâu và lắng nghe những thanh âm bình yên... ${clean}... Chúc bạn có những phút giây thư thái và một giấc ngủ an lành.`;
      default:
        return clean;
    }
  }

  if (langId === 'en') {
    switch (styleId) {
      case 'news':
        return `This is our top news update today. Here is the full report: ${clean}. That concludes our special report, thank you for tuning in!`;
      case 'story':
        return `Once upon a quiet moment in time... ${clean}... And that wondrous journey will forever stay in our hearts.`;
      case 'friendly':
        return `Hey there! It is so wonderful to catch up with you today: ${clean}! Wishing you an amazing day filled with joy and positivity!`;
      case 'presentation':
        return `Distinguished guests and colleagues, let me present the core highlight: ${clean}. Thank you very much for your valued attention.`;
      case 'calm':
        return `Take a gentle deep breath, let go of all tension, and relax... ${clean}... Wishing you peaceful stillness and gentle rest.`;
      default:
        return clean;
    }
  }

  return clean;
}

const TTS_STORAGE_KEY = 'git_downloader_tts_history_v1';

import { notifyStorageSync } from './storage';

export function getTTSHistory(): TTSHistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveTTSHistoryItem(item: Omit<TTSHistoryItem, 'id' | 'timestamp'>): TTSHistoryItem {
  if (typeof window === 'undefined') {
    return { ...item, id: Date.now().toString(), timestamp: Date.now() };
  }
  try {
    const current = getTTSHistory();
    const newItem: TTSHistoryItem = {
      ...item,
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
    };
    // Keep max 30 recent items to stay within localstorage quota
    const updated = [newItem, ...current].slice(0, 30);
    localStorage.setItem(TTS_STORAGE_KEY, JSON.stringify(updated));
    notifyStorageSync();
    return newItem;
  } catch {
    return { ...item, id: Date.now().toString(), timestamp: Date.now() };
  }
}

export function deleteTTSHistoryItem(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getTTSHistory();
    const updated = current.filter((x) => x.id !== id);
    localStorage.setItem(TTS_STORAGE_KEY, JSON.stringify(updated));
    notifyStorageSync();
  } catch {
    // silent catch
  }
}

export function clearTTSHistory(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(TTS_STORAGE_KEY);
    notifyStorageSync();
  } catch {
    // silent catch
  }
}

/**
 * Encodes an AudioBuffer into a 16-bit PCM RIFF WAV ArrayBuffer
 */
export function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const dataSize = numSamples * numChannels * 2;
  const outBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(outBuffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Linear PCM chunk size
  view.setUint16(20, 1, true); // Format 1 = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // 16-bit
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave channels
  let offset = 44;
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(buffer.getChannelData(ch));
  }

  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
      const val = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, val, true);
      offset += 2;
    }
  }

  return outBuffer;
}

/**
 * Helper to detect gender from browser voice name/URI
 */
export function detectVoiceGender(voiceName: string): 'male' | 'female' | 'unknown' {
  const lower = voiceName.toLowerCase();
  const maleKeywords = ['male', 'nam', 'david', 'mark', 'george', 'guy', 'man', 'paul', 'richard', 'james', 'puck', 'fenrir', 'charon'];
  const femaleKeywords = ['female', 'nữ', 'nu', 'zira', 'jenny', 'susan', 'samantha', 'victoria', 'kore', 'zephyr', 'an', 'hoaimy', 'linh', 'mai'];

  if (maleKeywords.some((k) => lower.includes(k))) return 'male';
  if (femaleKeywords.some((k) => lower.includes(k))) return 'female';
  return 'unknown';
}
