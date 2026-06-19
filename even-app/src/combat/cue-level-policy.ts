import type { Cue, CueLevel } from '@toolkit/echo-domain-v2';

const LEVEL_ONE_MAX_WORDS = 3;
const LEVEL_TWO_MAX_WORDS = 5;
const COMPLETE_SENTENCE_WORD_FLOOR = 4;
const WORD_PATTERN = /[a-zA-Z][a-zA-Z'-]*/g;
const TERMINAL_PUNCTUATION_PATTERN = /[.!?]$/;
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'can',
  'could',
  'do',
  'does',
  'for',
  'i',
  'is',
  'it',
  'me',
  'of',
  'please',
  'that',
  'the',
  'to',
  'you',
  'your',
]);

export function constrainCueForLevel(cue: Cue, maxCueLevel: CueLevel): Cue {
  const level = cue.level <= maxCueLevel ? cue.level : maxCueLevel;
  if (cue.level <= maxCueLevel) return cue;

  const phrase = shapeCuePhraseForLevel(cue.phrase, level);
  return {
    ...cue,
    level,
    phrase,
    alternatives: cue.alternatives
      .map((alternative) => shapeCuePhraseForLevel(alternative, level))
      .filter((alternative, index, alternatives) => (
        alternative.length > 0 &&
        alternative.toLowerCase() !== phrase.toLowerCase() &&
        alternatives.findIndex((item) => item.toLowerCase() === alternative.toLowerCase()) === index
      )),
  };
}

export function shapeCuePhraseForLevel(phrase: string, level: CueLevel): string {
  const cleaned = normalizeCueText(phrase);
  if (!cleaned) return '';
  if (level === 3) return cleaned;
  if (level === 2) return sentenceStarterCue(cleaned);
  return keywordCue(cleaned);
}

function sentenceStarterCue(phrase: string): string {
  const words = phrase.match(WORD_PATTERN) ?? [];
  if (words.length === 0) return phrase.slice(0, 50).trim();

  const isCompleteSentence = TERMINAL_PUNCTUATION_PATTERN.test(phrase) && words.length >= COMPLETE_SENTENCE_WORD_FLOOR;
  if (!isCompleteSentence && words.length <= LEVEL_TWO_MAX_WORDS) return phrase;

  const limit = Math.max(1, Math.min(LEVEL_TWO_MAX_WORDS, words.length - 1));
  return `${words.slice(0, limit).join(' ')}...`;
}

function keywordCue(phrase: string): string {
  const words = phrase.match(WORD_PATTERN) ?? [];
  const contentWords = words
    .map((word) => word.replace(/^'+|'+$/g, ''))
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word.toLowerCase()));
  const selected = (contentWords.length > 0 ? contentWords : words).slice(0, LEVEL_ONE_MAX_WORDS);
  return selected.join(' ') || phrase.slice(0, 50).trim();
}

function normalizeCueText(phrase: string): string {
  return phrase
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}
