/**
 * Chunk Generator — calls Gemini Text API to produce
 * a short English chunk when the user is stuck.
 *
 * Uses @google/genai (Gemini 2.0 Flash) for minimum latency.
 * Falls back to static chunk pool on network failure.
 */

import { GoogleGenAI } from '@google/genai';
import { getRandomFallbackChunk, type ChunkCategory } from './fallback-chunks';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;

let ai: GoogleGenAI | null = null;

function getAI(): GoogleGenAI {
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: API_KEY });
  }
  return ai;
}

export interface ChunkRequest {
  /** Current session topic / scenario */
  topic: string;
  /** Current week (1-4) affects prompt style */
  week: number;
  /** Category for fallback selection */
  category?: ChunkCategory;
  /** Recent context (last thing user said, if captured) */
  lastUtterance?: string;
  /** Previously used hints — avoid repeating these */
  usedHints?: string[];
  /** Scenario-specific coaching context from topic registry */
  scenarioContext?: string;
}

export interface ChunkResult {
  chunk: string;
  source: 'gemini' | 'fallback';
  latencyMs: number;
}

export interface SpeechEvaluationResult {
  transcript: string;
  chunk: string | null;
  source: 'gemini';
  latencyMs: number;
}

/**
 * Generate a hint chunk via Gemini API.
 * Returns within ~500ms (Flash model) or falls back to static pool.
 */
export async function generateChunk(req: ChunkRequest): Promise<ChunkResult> {
  const start = Date.now();

  // Week 4: random blackout — 40% chance of returning nothing
  if (req.week === 4 && Math.random() < 0.4) {
    return {
      chunk: '',
      source: 'gemini',
      latencyMs: Date.now() - start,
    };
  }

  if (!API_KEY) {
    return {
      chunk: getRandomFallbackChunk(req.category ?? 'general'),
      source: 'fallback',
      latencyMs: Date.now() - start,
    };
  }

  const systemPrompt = buildSystemPrompt(req.week);
  const userPrompt = buildUserPrompt(req);

  try {
    const genai = getAI();
    const response = await genai.models.generateContent({
      model: 'gemini-3.1-flash-lite-preview',
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: 30,
        temperature: 0.7,
      },
    });

    const text = response.text?.trim() ?? '';
    let chunk = cleanChunk(text);

    // Check if this hint was already used — if so, get a different one
    if (chunk && req.usedHints?.length) {
      const lower = chunk.toLowerCase();
      if (req.usedHints.some(h => h.toLowerCase() === lower)) {
        // Try one more time with explicit instruction
        try {
          const retryResponse = await genai.models.generateContent({
            model: 'gemini-3.1-flash-lite-preview',
            contents: userPrompt + `\nDO NOT use any of these phrases: ${req.usedHints.join(', ')}`,
            config: {
              systemInstruction: systemPrompt,
              maxOutputTokens: 30,
              temperature: 0.9, // Higher temp for variety
            },
          });
          const retryText = retryResponse.text?.trim() ?? '';
          const retryChunk = cleanChunk(retryText);
          if (retryChunk && !req.usedHints.some(h => h.toLowerCase() === retryChunk.toLowerCase())) {
            chunk = retryChunk;
          } else {
            // Fallback to static pool for variety
            chunk = getRandomFallbackChunk(req.category ?? 'general');
          }
        } catch {
          chunk = getRandomFallbackChunk(req.category ?? 'general');
        }
      }
    }

    return {
      chunk: chunk || getRandomFallbackChunk(req.category ?? 'general'),
      source: chunk ? 'gemini' : 'fallback',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    console.warn('[ChunkGen] Gemini API failed, using fallback:', err);
    return {
      chunk: getRandomFallbackChunk(req.category ?? 'general'),
      source: 'fallback',
      latencyMs: Date.now() - start,
    };
  }
}

function buildSystemPrompt(week: number): string {
  const base = `You are a stealth English coach embedded in smart glasses. 
The user is having a live English conversation and just went silent — they're stuck.
You must respond with ONLY a short English chunk (3-5 words max). 
No explanation, no translation, no punctuation except what's natural in speech.
Just the chunk. Nothing else.`;

  switch (week) {
    case 1:
      return `${base}
Week 1 mode: Give a COMPLETE starter phrase they can parrot immediately.
Examples: "I'd recommend", "What I mean is", "The thing about"`;
    case 2:
      return `${base}
Week 2 mode: Give a TEMPLATE connector, not a complete thought.
Examples: "Not only A but", "In terms of", "What stands out is"`;
    case 3:
      return `${base}
Week 3 mode: Give only 2-3 KEYWORDS, no structure. Make them think.
Examples: "authentic vibe", "worth visiting", "local favorite"`;
    case 4:
      return `${base}
Week 4 mode: Give the shortest possible nudge — 1-2 words max.
Examples: "basically", "moreover", "honestly"`;
    default:
      return base;
  }
}

import { float32ToWav } from '@toolkit/stt/audio/pcm-utils';

function buildUserPrompt(req: ChunkRequest): string {
  let prompt = `Topic: ${req.topic}`;
  if (req.scenarioContext) {
    prompt += `\nScenario context: ${req.scenarioContext}`;
  }
  if (req.lastUtterance) {
    prompt += `\nThe user last said: "${req.lastUtterance}"`;
  }
  if (req.usedHints?.length) {
    prompt += `\nPreviously given hints (DO NOT repeat): ${req.usedHints.slice(-5).join(', ')}`;
  }
  prompt += '\nThey are now silent and stuck. Give the chunk:';
  return prompt;
}

/**
 * Clean up Gemini output — remove quotes, brackets, extra whitespace.
 */
function cleanChunk(raw: string): string {
  return raw
    .replace(/^["'\[\(]+/, '')
    .replace(/["'\]\)]+$/, '')
    .replace(/\n/g, ' ')
    .trim()
    .slice(0, 50); // hard cap
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      resolve(base64!);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Evaluate spoken audio directly via Gemini.
 * 
 * HINT POLICY (permissive):
 * - Return hint ONLY if speech contains filler words (um, uh, hmm), 
 *   non-English language, or is completely unintelligible.
 * - If the user is speaking understandable English (even with minor errors), 
 *   return hint as null — let them keep going.
 */
export async function evaluateSpeech(audio: Float32Array, req: ChunkRequest): Promise<SpeechEvaluationResult | null> {
  // Ignore audio shorter than 0.5s
  if (audio.length < 16000 * 0.5) return null;

  const start = Date.now();
  const wavBlob = float32ToWav(audio, 16000);
  const base64 = await blobToBase64(wavBlob);

  const systemPrompt = `You are an English conversation coach. Listen to the audio and evaluate it.

TRANSCRIPTION: Write exactly what you hear in the "transcript" field.

HINT RULES — BE VERY PERMISSIVE:
- Set "hint" to null if the user is speaking ANY understandable English, even with:
  - Grammar mistakes → hint: null (let them speak!)
  - Simple vocabulary → hint: null
  - Slow speech → hint: null
  - Accent → hint: null
  - Minor hesitations → hint: null

- Set "hint" to a short 3-5 word English phrase ONLY if:
  - The user uses filler sounds for most of the audio ("umm...", "uhh...", "ahh...")
  - The user speaks in a NON-ENGLISH language (Korean, Japanese, Chinese, etc.)
  - The audio is completely unintelligible noise
  - The user clearly gives up mid-sentence and trails off

When in doubt, set hint to null. The user is practicing — let them try!`;

  try {
    const genai = getAI();
    const response = await genai.models.generateContent({
      model: 'gemini-3.1-flash-lite-preview',
      contents: [
        { text: `Topic: ${req.topic}\nEvaluate the speech:` },
        { inlineData: { mimeType: 'audio/wav', data: base64 } }
      ],
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: 100,
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            transcript: { type: "STRING" },
            hint: { type: "STRING", nullable: true }
          },
          required: ["transcript"]
        } as any,
      },
    });

    const text = response.text?.trim() ?? '';
    if (!text) return null;

    const data = JSON.parse(text);
    
    // Double-check: if the transcript is reasonable English, suppress the hint
    const transcript = (data.transcript || '').trim();
    let hint = data.hint ? cleanChunk(data.hint) : null;
    
    if (hint && transcript) {
      // If transcript has 3+ English words, it's probably fine — suppress hint
      const englishWordCount = (transcript.match(/[a-zA-Z]{2,}/g) || []).length;
      if (englishWordCount >= 3) {
        console.log(`[ChunkGen] Suppressing hint — transcript has ${englishWordCount} English words: "${transcript}"`);
        hint = null;
      }
    }

    // Check against used hints
    if (hint && req.usedHints?.length) {
      const lower = hint.toLowerCase();
      if (req.usedHints.some(h => h.toLowerCase() === lower)) {
        // Don't show same hint twice — get a new one via generateChunk
        console.log(`[ChunkGen] Hint "${hint}" already used — will generate fresh one`);
        const fresh = await generateChunk(req);
        hint = fresh.chunk || null;
      }
    }

    return {
      transcript,
      chunk: hint,
      source: 'gemini',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    console.warn('[ChunkGen] Speech evaluation failed:', err);
    return null;
  }
}
