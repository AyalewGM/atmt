import { API_KEY } from "../config/constants";

// Lightweight helpers kept private to the module
function pcmToWav(pcmData, sampleRate) {
  const buffer = new ArrayBuffer(44 + pcmData.length * 2);
  const view = new DataView(buffer);
  let offset = 0;

  function writeString(str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset++, str.charCodeAt(i));
  }
  function writeUint32(val) { view.setUint32(offset, val, true); offset += 4; }
  function writeUint16(val) { view.setUint16(offset, val, true); offset += 2; }

  writeString('RIFF');
  writeUint32(36 + pcmData.length * 2);
  writeString('WAVE');
  writeString('fmt ');
  writeUint32(16);
  writeUint16(1);
  writeUint16(1);
  writeUint32(sampleRate);
  writeUint32(sampleRate * 2);
  writeUint16(2);
  writeUint16(16);
  writeString('data');
  writeUint32(pcmData.length * 2);
  for (let i = 0; i < pcmData.length; i++) { view.setInt16(offset, pcmData[i], true); offset += 2; }
  return new Blob([view], { type: 'audio/wav' });
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes.buffer;
}

export class ApiService {
  static async callGemini(prompt, responseSchema = null) {
    const maxRetries = 5;
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        const payload = {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, topK: 1, topP: 1, maxOutputTokens: 8192 },
        };
        if (responseSchema) {
          payload.generationConfig.responseMimeType = "application/json";
          payload.generationConfig.responseSchema = responseSchema;
        }
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;
        const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) {
          let errorBody;
          try { errorBody = await response.json(); } catch { errorBody = await response.text(); }
          if (response.status === 429 || response.status >= 500) {
            const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
            await new Promise(r => setTimeout(r, delay));
            attempt++; continue;
          }
          const errorMessage = errorBody?.error?.message || `API request failed with status ${response.status}`;
          throw new Error(errorMessage);
        }
        const result = await response.json();
        if (!result.candidates?.length) {
          if (result.promptFeedback?.blockReason) throw new Error(`Content generation blocked. Reason: ${result.promptFeedback.blockReason}.`);
          throw new Error("Error: API returned no candidates.");
        }
        const candidate = result.candidates[0];
        if (candidate?.content?.parts?.[0]?.text) {
          let text = candidate.content.parts[0].text;
          if (candidate.finishReason === 'MAX_TOKENS') text += "\n\n[WARNING: The generated content was too long and has been cut short.]";
          return text;
        }
        if (candidate.finishReason) throw new Error(`Content generation stopped unexpectedly. Reason: ${candidate.finishReason}.`);
        throw new Error("Error: An unknown issue occurred with the API response.");
      } catch (error) {
        if (attempt === maxRetries || !(error.message.includes("Failed to fetch") || error.message.includes("NetworkError"))) throw error;
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        await new Promise(r => setTimeout(r, delay));
        attempt++;
      }
    }
    throw new Error("Max retries reached for Gemini API call.");
  }

  static async callImagen(prompt, aspectRatio = "1:1") {
    const maxRetries = 5; let attempt = 0;
    while (attempt < maxRetries) {
      try {
        const payload = { instances: [{ prompt: `${prompt}` }], parameters: { sampleCount: 1, aspectRatio } };
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${API_KEY}`;
        const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) {
          let errorBody; try { errorBody = await response.json(); } catch { errorBody = await response.text(); }
          if (response.status === 429 || response.status >= 500) {
            const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000; await new Promise(r => setTimeout(r, delay)); attempt++; continue;
          }
          const errorMessage = errorBody?.error?.message || `Image Generation API call failed with status ${response.status}`;
          throw new Error(errorMessage);
        }
        const result = await response.json();
        const data = result.predictions?.[0]?.bytesBase64Encoded;
        if (!data) throw new Error("Unexpected response from Imagen API or content filter triggered.");
        return data;
      } catch (error) {
        if (attempt === maxRetries || !(error.message.includes("Failed to fetch") || error.message.includes("NetworkError"))) throw error;
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000; await new Promise(r => setTimeout(r, delay)); attempt++;
      }
    }
    throw new Error("Max retries reached for Imagen API call.");
  }

  static async callGeminiTTS(text, voiceName = "Kore") {
    const maxRetries = 5; let attempt = 0;
    while (attempt < maxRetries) {
      try {
        const payload = {
          contents: [{ parts: [{ text }] }],
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
          model: "gemini-2.5-flash-preview-tts",
        };
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${API_KEY}`;
        const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) {
          if (response.status === 429 || response.status >= 500) { const d = Math.pow(2, attempt) * 1000 + Math.random() * 1000; await new Promise(r => setTimeout(r, d)); attempt++; continue; }
          throw new Error(`TTS API failed with status: ${response.status}`);
        }
        const result = await response.json();
        const part = result?.candidates?.[0]?.content?.parts?.[0];
        const audioData = part?.inlineData?.data; const mimeType = part?.inlineData?.mimeType;
        if (audioData && mimeType && mimeType.startsWith("audio/")) {
          const sampleRate = parseInt(mimeType.match(/rate=(\d+)/)?.[1] || '24000', 10);
          const pcmData = base64ToArrayBuffer(audioData); const pcm16 = new Int16Array(pcmData);
          const wavBlob = pcmToWav(pcm16, sampleRate);
          return URL.createObjectURL(wavBlob);
        }
        throw new Error("Invalid audio data from TTS API.");
      } catch (error) {
        if (attempt === maxRetries || !(error.message.includes("Failed to fetch") || error.message.includes("NetworkError"))) throw error;
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000; await new Promise(r => setTimeout(r, delay)); attempt++;
      }
    }
    throw new Error("Max retries reached for TTS API call.");
  }

  static async callGeminiVision(prompt, base64ImageData, mimeType) {
    const maxRetries = 5; let attempt = 0;
    while (attempt < maxRetries) {
      try {
        const payload = {
          contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: base64ImageData } }] }],
          generationConfig: { temperature: 0.4, topK: 32, topP: 1, maxOutputTokens: 4096 },
        };
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;
        const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) {
          let errorBody; try { errorBody = await response.json(); } catch { errorBody = await response.text(); }
          if (response.status === 429 || response.status >= 500) {
            const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000; await new Promise(r => setTimeout(r, delay)); attempt++; continue;
          }
          const errorMessage = errorBody?.error?.message || `Vision API request failed with status ${response.status}`;
          throw new Error(errorMessage);
        }
        const result = await response.json();
        const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("Error: An unknown issue occurred with the Vision API response.");
        return text;
      } catch (error) {
        if (attempt === maxRetries || !(error.message.includes("Failed to fetch") || error.message.includes("NetworkError"))) throw error;
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000; await new Promise(r => setTimeout(r, delay)); attempt++;
      }
    }
    throw new Error("Max retries reached for Gemini Vision API call.");
  }

  static async getRecommendedBooks(topicOrContent) {
    const prompt = `You are a librarian and theologian for "Ancient Truths, Modern Times". Based on the following topic or content, recommend 3-5 highly relevant and authoritative books (titles and authors) from an Ethiopian Orthodox Tewahedo or broader Patristic perspective for further reading. If no specific books come to mind, suggest relevant themes or areas of study. Return a JSON object with a 'books' array, where each item has 'title' and 'author'.\n\nTopic/Content:\n${topicOrContent.substring(0, 3000)}\n`;
    const schema = { type: "OBJECT", properties: { books: { type: "ARRAY", items: { type: "OBJECT", properties: { title: { type: "STRING" }, author: { type: "STRING" } }, required: ["title", "author"] } } }, required: ["books"] };
    try {
      const resultText = await ApiService.callGemini(prompt, schema);
      const parsedResult = JSON.parse(resultText);
      return parsedResult.books || [];
    } catch (err) {
      console.error("Failed to get book recommendations:", err);
      return [];
    }
  }
}

export default ApiService;

