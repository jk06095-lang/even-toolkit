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

async function callGeminiWithFallback(
  contents: any,
  config: any,
  models: string[] = ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-3.1-flash-lite']
): Promise<any> {
  const genai = getAI();
  let lastError = null;

  for (const model of models) {
    try {
      console.log(`[Gemini] Attempting call with model: ${model}`);
      const response = await genai.models.generateContent({
        model,
        contents,
        config,
      });
      console.log(`[Gemini] Success with model: ${model}`);
      return response;
    } catch (err: any) {
      console.warn(`[Gemini] Model ${model} failed:`, err.message || err);
      lastError = err;
      // Fallback on transient or availability errors
      continue;
    }
  }

  throw lastError || new Error('All models failed');
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
  /** Recent conversation context from TranscriptAnalyzer */
  conversationContext?: string;
  /** Adaptive difficulty override (1-4), overrides week if provided */
  adaptiveDifficulty?: number;
  /** If user missed a hint, this is the missed hint text for simplification context */
  missedHint?: string;
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

  // Use adaptive difficulty if provided, otherwise use week
  const effectiveDifficulty = req.adaptiveDifficulty ?? req.week;

  // Week 4: random blackout — 40% chance of returning nothing
  if (effectiveDifficulty === 4 && Math.random() < 0.4) {
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
    const response = await callGeminiWithFallback(
      userPrompt,
      {
        systemInstruction: systemPrompt,
        maxOutputTokens: 50,
        temperature: 0.7,
      }
    );

    const text = response.text?.trim() ?? '';
    let chunk = cleanChunk(text);

    // Check if this hint was already used — if so, get a different one
    if (chunk && req.usedHints?.length) {
      const lower = chunk.toLowerCase();
      if (req.usedHints.some(h => h.toLowerCase() === lower)) {
        // Try one more time with explicit instruction
        try {
          const retryResponse = await callGeminiWithFallback(
            userPrompt + `\nDO NOT use any of these phrases: ${req.usedHints.join(', ')}`,
            {
              systemInstruction: systemPrompt,
              maxOutputTokens: 50,
              temperature: 0.9, // Higher temp for variety
            }
          );
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
  const base = `You are an English conversation coach embedded in AR glasses. 
The user is having a live English conversation and just went silent — they're stuck.
You must respond with ONLY a short, helpful English phrase or a fill-in-the-blank sentence that they can use to continue the conversation.
Do NOT provide explanations or translations. Just the recommended phrase.
Format examples: "I was wondering if ___", "What do you think about ___?", "Could you help me with ___?"`;

  switch (week) {
    case 1:
      return `${base}
Week 1 mode: Give a COMPLETE starter phrase with a fill-in-the-blank.
Examples: "I'd like to order ___", "Could you tell me where ___ is?"`;
    case 2:
      return `${base}
Week 2 mode: Give a TEMPLATE connector or transition.
Examples: "On the other hand, ___", "In my experience, ___"`;
    case 3:
      return `${base}
Week 3 mode: Give 2-3 KEYWORDS to jog their memory.
Examples: "recommend / popular", "reservation / available"`;
    case 4:
      return `${base}
Week 4 mode: Give a 1-word nudge.
Examples: "basically", "actually"`;
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
  if (req.conversationContext) {
    prompt += `\nRecent conversation:\n${req.conversationContext}`;
  }
  if (req.lastUtterance) {
    prompt += `\nThe user last said: "${req.lastUtterance}"`;
  }
  if (req.missedHint) {
    prompt += `\nThe user was given "${req.missedHint}" but couldn't use it. Give a SIMPLER, easier alternative expression.`;
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
    const response = await callGeminiWithFallback(
      [
        { text: `Topic: ${req.topic}\nEvaluate the speech:` },
        { inlineData: { mimeType: 'audio/wav', data: base64 } }
      ],
      {
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
      }
    );

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

/**
 * Evaluate the final transcript for grammar and sentence structure.
 * Returns a short correction string if errors are found, or null if fine.
 */
export async function evaluateGrammar(transcript: string, topic: string): Promise<string | null> {
  if (!transcript || transcript.trim().length < 5) return null; // Too short to evaluate

  const systemPrompt = `You are an expert English grammar coach embedded in AR glasses.
The user is practicing an English conversation.
Evaluate the given transcript for grammatical errors, awkward sentence structures, or unnatural phrasing.

RULES:
- If the English is natural and grammatically correct, return EXACTLY: null
- If there is an error, return a SHORT, DIRECT correction (maximum 5 words). 
- Start the correction with "Try:" or "Use:".
- Do not explain why it's wrong.
- Do not use quotes.

Examples:
User: "I go to there yesterday" -> "Try: I went there yesterday"
User: "I am agree with you" -> "Try: I agree with you"
User: "That sounds good" -> "null"`;

  try {
    const response = await callGeminiWithFallback(
      [
        { text: `Topic: ${topic}\nTranscript: "${transcript}"\nProvide correction or null:` }
      ],
      {
        systemInstruction: systemPrompt,
        maxOutputTokens: 50,
        temperature: 0.1,
      }
    );

    const text = response.text?.trim() ?? '';
    if (!text || text.toLowerCase() === 'null') {
      return null;
    }
    
    // Clean up
    let correction = cleanChunk(text);
    if (!correction.toLowerCase().startsWith('try:') && !correction.toLowerCase().startsWith('use:')) {
      correction = 'Try: ' + correction;
    }
    return correction;

  } catch (err) {
    console.warn('[ChunkGen] Grammar evaluation failed:', err);
    return null;
  }
}

/**
 * Simplify a hint expression that the user couldn't use.
 * Returns a simpler, easier-to-use alternative.
 */
export async function simplifyHint(hint: string, topic: string): Promise<string | null> {
  if (!API_KEY) return null;

  const systemPrompt = `You are an English conversation coach. The user was given a hint expression but couldn't use it because it was too difficult.
Simplify the expression to make it easier. Keep the same meaning but use simpler words and shorter phrasing.
Return ONLY the simplified expression, nothing else. Maximum 5 words.`;

  try {
    const response = await callGeminiWithFallback(
      [
        { text: `Topic: ${topic}\nOriginal hint: "${hint}"\nSimplify:` }
      ],
      {
        systemInstruction: systemPrompt,
        maxOutputTokens: 30,
        temperature: 0.3,
      }
    );

    const text = response.text?.trim() ?? '';
    if (!text || text.length < 2) return null;
    return cleanChunk(text);
  } catch (err) {
    console.warn('[ChunkGen] Simplification failed:', err);
    return null;
  }
}
