/**
 * Transcript Export — generates 3-stage JSON for Gemini Gem handoff.
 *
 * Structure:
 *   stage_1_raw      — raw session transcript entries
 *   stage_2_analysis — computed statistics and patterns
 *   stage_3_handoff  — Gemini-generated coaching recommendations (fixed schema)
 *
 * The stage_3 uses Gemini API with `responseMimeType: "application/json"`
 * and a strict `responseSchema` to guarantee output format consistency.
 */

import { GoogleGenAI } from '@google/genai';
import type { SessionTranscript, TranscriptEntry } from './transcript-store';
import { getScenarioById } from './topic-registry';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;

let ai: GoogleGenAI | null = null;

function getAI(): GoogleGenAI {
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: API_KEY });
  }
  return ai;
}

// ── Export Types (strict, never changes) ──

export interface ExportStage1 {
  session_id: string;
  start_time: string;  // ISO 8601
  end_time: string;    // ISO 8601
  week: number;
  topic: string;
  category: string;
  entries: Array<{
    t: number;
    type: 'user_speech' | 'hint_given' | 'silence_event';
    text: string;
    source?: string;
  }>;
}

export interface ExportStage2 {
  total_duration_sec: number;
  speech_count: number;
  silence_count: number;
  hint_count: number;
  self_response_rate: number;   // 0-100
  avg_silence_ms: number;
  longest_silence_ms: number;
  speech_texts: string[];       // all user utterances in order
  hint_texts: string[];         // all hints given in order
}

export interface ExportStage3 {
  weak_areas: string[];           // max 5 identified weak points
  recommended_chunks: string[];   // max 5 suggested practice phrases
  difficulty_assessment: string;  // e.g. "Week 2 ready" or "Needs more Week 1"
  next_session_focus: string;     // 1-sentence coaching directive
  gem_instruction: string;        // Korean instruction for Gemini Gem
  scenario_gem_prompt?: string;   // Topic-specific Gem prompt from registry
}

export interface SessionExportJSON {
  export_version: '1.0.0';
  exported_at: string;          // ISO 8601
  stage_1_raw: ExportStage1;
  stage_2_analysis: ExportStage2;
  stage_3_handoff: ExportStage3;
}

// ── Stage Builders ──

function buildStage1(session: SessionTranscript): ExportStage1 {
  return {
    session_id: session.sessionId,
    start_time: new Date(session.startTime).toISOString(),
    end_time: new Date(session.endTime || Date.now()).toISOString(),
    week: session.week,
    topic: session.topic,
    category: session.category,
    entries: session.entries.map((e) => ({
      t: e.t,
      type: e.type,
      text: e.text,
      source: e.source,
    })),
  };
}

function buildStage2(session: SessionTranscript): ExportStage2 {
  const speeches = session.entries.filter((e) => e.type === 'user_speech');
  const silences = session.entries.filter((e) => e.type === 'silence_event');
  const hints = session.entries.filter((e) => e.type === 'hint_given');

  // Parse silence durations from the "Xms" text
  const silenceDurations = silences
    .map((e) => parseInt(e.text, 10))
    .filter((n) => !isNaN(n));

  const avgSilence = silenceDurations.length > 0
    ? Math.round(silenceDurations.reduce((a, b) => a + b, 0) / silenceDurations.length)
    : 0;

  const longestSilence = silenceDurations.length > 0
    ? Math.max(...silenceDurations)
    : 0;

  // Self-response rate: speeches that occurred without a preceding hint
  let selfResponses = 0;
  for (let i = 0; i < session.entries.length; i++) {
    const entry = session.entries[i]!;
    if (entry.type === 'user_speech') {
      // Check if the previous entry was NOT a hint
      const prev = i > 0 ? session.entries[i - 1] : null;
      if (!prev || prev.type !== 'hint_given') {
        selfResponses++;
      }
    }
  }

  const selfRate = speeches.length > 0
    ? Math.round((selfResponses / speeches.length) * 100)
    : 0;

  return {
    total_duration_sec: Math.round(
      ((session.endTime || Date.now()) - session.startTime) / 1000,
    ),
    speech_count: speeches.length,
    silence_count: silences.length,
    hint_count: hints.length,
    self_response_rate: selfRate,
    avg_silence_ms: avgSilence,
    longest_silence_ms: longestSilence,
    speech_texts: speeches.map((e) => e.text),
    hint_texts: hints.map((e) => e.text),
  };
}

/**
 * Generate stage 3 via Gemini API with strict JSON schema.
 * Falls back to a computed-only version if API fails.
 */
async function buildStage3(
  stage1: ExportStage1,
  stage2: ExportStage2,
): Promise<ExportStage3> {
  // Fallback (no API or failure)
  const fallback: ExportStage3 = {
    weak_areas: [],
    recommended_chunks: [],
    difficulty_assessment: `Week ${stage1.week} in progress`,
    next_session_focus: 'Continue current topic practice.',
    gem_instruction: `주제: ${stage1.topic}, Week ${stage1.week}. 발화 ${stage2.speech_count}회, 힌트 ${stage2.hint_count}회. 추가 분석이 필요합니다.`,
  };

  if (!API_KEY) return fallback;

  // Build a concise summary for the API
  const speechSample = stage2.speech_texts.slice(0, 10).join(' | ');
  const hintSample = stage2.hint_texts.slice(0, 10).join(' | ');

  const userPrompt = [
    `Session Analysis:`,
    `- Topic: ${stage1.topic} (Week ${stage1.week})`,
    `- Duration: ${stage2.total_duration_sec}s`,
    `- User speeches: ${stage2.speech_count}, Hints given: ${stage2.hint_count}, Silences: ${stage2.silence_count}`,
    `- Self-response rate: ${stage2.self_response_rate}%`,
    `- Avg silence: ${stage2.avg_silence_ms}ms`,
    ``,
    `User said: ${speechSample || '(no speech recorded)'}`,
    `Hints given: ${hintSample || '(none)'}`,
    ``,
    `Analyze this learner's English conversation session and provide coaching recommendations.`,
  ].join('\n');

  const systemPrompt = `You are an English conversation coach analyzing a practice session from smart glasses.
Analyze the session data and provide structured coaching recommendations.
All fields must be filled. The gem_instruction field must be written in Korean (한국어).
Be specific and actionable in your recommendations.`;

  try {
    const genai = getAI();
    const response = await genai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: 500,
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            weak_areas: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: 'Up to 5 identified weak areas in English conversation. Each item is a short phrase.',
            },
            recommended_chunks: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: 'Up to 5 suggested English practice phrases (3-5 words each).',
            },
            difficulty_assessment: {
              type: 'STRING',
              description: 'One-line assessment like "Ready for Week 3" or "Needs more Week 2 practice".',
            },
            next_session_focus: {
              type: 'STRING',
              description: 'One-sentence coaching directive for the next session.',
            },
            gem_instruction: {
              type: 'STRING',
              description: 'Coaching handoff instruction written in Korean (한국어). Summarize learner state and next steps.',
            },
          },
          required: [
            'weak_areas',
            'recommended_chunks',
            'difficulty_assessment',
            'next_session_focus',
            'gem_instruction',
          ],
        } as any,
      },
    });

    const text = response.text?.trim() ?? '';
    if (!text) return fallback;

    const parsed = JSON.parse(text) as ExportStage3;

    // Validate and cap arrays
    return {
      weak_areas: (parsed.weak_areas || []).slice(0, 5),
      recommended_chunks: (parsed.recommended_chunks || []).slice(0, 5),
      difficulty_assessment: parsed.difficulty_assessment || fallback.difficulty_assessment,
      next_session_focus: parsed.next_session_focus || fallback.next_session_focus,
      gem_instruction: parsed.gem_instruction || fallback.gem_instruction,
    };
  } catch (err) {
    console.warn('[Export] Stage 3 Gemini API failed, using fallback:', err);
    return fallback;
  }
}

// ── Main Export Function ──

/**
 * Generate the complete 3-stage export JSON for a given session.
 * This is the main entry point called from the Debrief UI.
 */
export async function generateExportJSON(
  session: SessionTranscript,
): Promise<SessionExportJSON> {
  const stage1 = buildStage1(session);
  const stage2 = buildStage2(session);
  const stage3 = await buildStage3(stage1, stage2);

  // Attach scenario-specific Gem prompt if available
  // category field stores the scenario ID from topic-registry
  const scenario = getScenarioById(session.category);
  if (scenario) {
    stage3.scenario_gem_prompt = scenario.gemPrompt;
  }

  return {
    export_version: '1.0.0',
    exported_at: new Date().toISOString(),
    stage_1_raw: stage1,
    stage_2_analysis: stage2,
    stage_3_handoff: stage3,
  };
}

/**
 * Generate and trigger a file download of the export JSON.
 */
export async function downloadExportJSON(
  session: SessionTranscript,
): Promise<void> {
  const exportData = await generateExportJSON(session);
  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${session.sessionId}_handoff.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
