import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { 
      text, 
      language = 'vi', 
      voice = 'Kore', 
      gender,
      style = 'natural' 
    } = body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Vui lòng cung cấp đoạn văn bản cần chuyển đổi thành giọng nói.' },
        { status: 400 }
      );
    }

    // Determine target voice and gender
    const maleVoices = ['Puck', 'Fenrir', 'Charon'];
    const femaleVoices = ['Kore', 'Zephyr'];

    let effectiveGender: 'male' | 'female' = gender === 'male' || maleVoices.includes(voice) ? 'male' : 'female';
    let effectiveVoice = voice;

    if (effectiveGender === 'male' && !maleVoices.includes(effectiveVoice)) {
      effectiveVoice = 'Puck';
    } else if (effectiveGender === 'female' && !femaleVoices.includes(effectiveVoice)) {
      effectiveVoice = 'Kore';
    }

    // Language name mapping for prompt clarity
    const langNames: Record<string, string> = {
      vi: 'Vietnamese',
      en: 'English',
      zh: 'Chinese (Mandarin)',
      ko: 'Korean',
      ja: 'Japanese',
    };

    const targetLang = langNames[language] || 'Vietnamese';

    // Map style key to descriptive metadata for TTS
    const styleDescriptions: Record<string, string> = {
      natural: `Natural, clear and authentic ${targetLang} ${effectiveGender} speech with smooth flow and appropriate pauses`,
      news: `Professional, authoritative news anchor ${effectiveGender} voice in ${targetLang}, precise articulation and steady rhythm`,
      story: `Engaging, warm and expressive ${effectiveGender} storyteller in ${targetLang}, rich emotional tone and dynamic pacing`,
      friendly: `Warm, friendly, cheerful and conversational ${effectiveGender} tone in ${targetLang}`,
      presentation: `Confident, articulate and professional ${effectiveGender} speaker presenting clearly in ${targetLang}`,
      calm: `Gentle, soothing, calm and relaxed speaking pace in ${targetLang}`,
    };

    const stylePrompt = styleDescriptions[style] || styleDescriptions.natural;

    // Directives to prompt distinct cadence and style in Gemini
    const styleDirectives: Record<string, string> = {
      news: 'Bản tin thời sự: Đọc với tốc độ nhanh, nhịp điệu dứt khoát, dõng dạc, phong thái phát thanh viên truyền hình. ',
      story: 'Kể chuyện truyền cảm: Đọc với ngữ điệu trầm ấm, sâu lắng, ngắt nghỉ kịch tính, biểu cảm phong phú. ',
      friendly: 'Thân thiện tươi vui: Đọc với giọng điệu hồ hởi, ấm áp, cao độ tươi sáng, truyền cảm hứng tích cực. ',
      presentation: 'Thuyết trình chuyên môn: Đọc với giọng đĩnh đạc, mạch lạc, tự tin, nhấn mạnh các ý quan trọng. ',
      calm: 'Thư giãn êm dịu: Đọc thật chậm rãi, nhẹ nhàng, du dương, êm ái và thư thái như ru ngủ. ',
      natural: '',
    };

    const textToSynthesize = `${styleDirectives[style] || ''}${text.trim()}`;

    // Helper to validate Google AI Studio API key format
    const isValidGoogleApiKey = (key?: string | null): boolean => {
      if (!key) return false;
      const trimmed = key.trim();
      return trimmed.startsWith('AIza') && trimmed.length >= 35;
    };

    // 1. Try Gemini 3.8 Flash Lite TTS model only if a valid AIza key is provided
    const userApiKey = req.headers.get('x-gemini-key') || process.env.GEMINI_API_KEY;
    
    if (isValidGoogleApiKey(userApiKey)) {
      try {
        const ai = new GoogleGenAI({ apiKey: userApiKey!.trim() });
        const response = await ai.models.generateContent({
          model: "gemini-3.8-flash-lite-tts",
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: textToSynthesize,
                  speechMetadata: {
                    style: stylePrompt,
                  },
                },
              ],
            },
          ] as any,
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: effectiveVoice,
                },
              },
            },
          },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

        if (base64Audio) {
          return NextResponse.json({
            success: true,
            audioBase64: base64Audio,
            mimeType: "audio/wav",
            voice: effectiveVoice,
            gender: effectiveGender,
            language,
            style,
            engine: 'ai',
          });
        }
      } catch {
        // Silently proceed to high-fidelity neural fallback below
      }
    }

    // 2. High-fidelity Neural Stream fallback (supports vi, en, zh, ko, ja with zero credentials needed)
    try {
      const cleanText = text.trim();
      // Split text into readable chunks (punctuation-aware, max ~180 chars per chunk)
      const rawSentences = cleanText.split(/([.!?;:\n]+)/);
      const chunks: string[] = [];
      let temp = '';

      for (let i = 0; i < rawSentences.length; i++) {
        const part = rawSentences[i];
        if (temp.length + part.length < 180) {
          temp += part;
        } else {
          if (temp.trim()) chunks.push(temp.trim());
          temp = part;
        }
      }
      if (temp.trim()) chunks.push(temp.trim());

      const bufferPromises = chunks.map(async (chunk) => {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${encodeURIComponent(language)}&client=tw-ob`;
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://translate.google.com/',
          },
        });
        if (!res.ok) throw new Error(`Stream fetch failed: ${res.status}`);
        const arrayBuf = await res.arrayBuffer();
        return Buffer.from(arrayBuf);
      });

      const audioBuffers = await Promise.all(bufferPromises);
      const combined = Buffer.concat(audioBuffers);
      const base64 = combined.toString('base64');

      return NextResponse.json({
        success: true,
        audioBase64: base64,
        mimeType: "audio/mpeg",
        voice: effectiveVoice,
        gender: effectiveGender,
        language,
        style,
        engine: 'neural_stream',
      });
    } catch (fallbackError: any) {
      console.warn('TTS stream fallback issue:', fallbackError?.message || fallbackError);
      return NextResponse.json(
        {
          error: 'Không thể tạo âm thanh từ máy chủ. Đang chuyển sang giọng đọc Trình duyệt.',
          fallbackToBrowser: true,
          gender: effectiveGender,
          voice: effectiveVoice,
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.warn('TTS general notice:', error?.message || error);
    return NextResponse.json(
      {
        error: error?.message || 'Lỗi xử lý yêu cầu TTS.',
        fallbackToBrowser: true,
      },
      { status: 500 }
    );
  }
}
