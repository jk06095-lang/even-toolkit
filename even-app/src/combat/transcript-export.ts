/**
 * Transcript Export — generates 3-stage JSON for coaching handoff.
 *
 * Structure:
 *   stage_1_raw      — raw session transcript entries
 *   stage_2_analysis — computed statistics and patterns
 *   stage_3_handoff  — proxy-generated coaching recommendations (fixed schema)
 *
 * The stage_3 calls the ECHO API proxy. If the proxy is unavailable, the
 * export remains usable with computed-only fallback recommendations.
 */

import { isEchoApiConfigured, requestSessionAnalysis } from '../services/echo-api';
import type { SessionTranscript } from './transcript-store';
import { getScenarioById } from './topic-registry';

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
    type: 'user_speech' | 'hint_given' | 'silence_event' | 'hint_used' | 'hint_missed' | 'hint_simplified';
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
 * Generate stage 3 via the ECHO API proxy.
 * Falls back to a computed-only version if API fails.
 */
async function buildStage3(
  stage1: ExportStage1,
  stage2: ExportStage2,
  allowCloudProcessing = true,
): Promise<ExportStage3> {
  // Fallback (no API or failure)
  const fallback: ExportStage3 = {
    weak_areas: [],
    recommended_chunks: [],
    difficulty_assessment: `Week ${stage1.week} in progress`,
    next_session_focus: 'Continue current topic practice.',
    gem_instruction: `주제: ${stage1.topic}, Week ${stage1.week}. 발화 ${stage2.speech_count}회, 힌트 ${stage2.hint_count}회. 추가 분석이 필요합니다.`,
  };

  if (!allowCloudProcessing || !isEchoApiConfigured()) return fallback;

  try {
    const requestId = `${stage1.session_id}:session-analysis:${Date.now()}`;
    console.info(`[Export] Session analysis request ${requestId}`);
    const response = await requestSessionAnalysis<ExportStage3 | string>({
      task: 'session_handoff',
      clientSessionId: stage1.session_id,
      requestId,
      stage_1_raw: stage1,
      stage_2_analysis: stage2,
    });

    const parsed =
      typeof response === 'string'
        ? (JSON.parse(response) as ExportStage3)
        : response;

    // Validate and cap arrays
    return {
      weak_areas: (parsed.weak_areas || []).slice(0, 5),
      recommended_chunks: (parsed.recommended_chunks || []).slice(0, 5),
      difficulty_assessment: parsed.difficulty_assessment || fallback.difficulty_assessment,
      next_session_focus: parsed.next_session_focus || fallback.next_session_focus,
      gem_instruction: parsed.gem_instruction || fallback.gem_instruction,
    };
  } catch (err) {
    console.warn('[Export] Stage 3 ECHO API failed, using fallback:', err);
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
  options: { allowCloudProcessing?: boolean } = {},
): Promise<SessionExportJSON> {
  const stage1 = buildStage1(session);
  const stage2 = buildStage2(session);
  const stage3 = await buildStage3(stage1, stage2, options.allowCloudProcessing ?? true);

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
  options: { allowCloudProcessing?: boolean } = {},
): Promise<void> {
  const exportData = await generateExportJSON(session, options);
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
