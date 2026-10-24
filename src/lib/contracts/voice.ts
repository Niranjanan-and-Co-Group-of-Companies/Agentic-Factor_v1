// Voice, shared by the website and the app: the languages a customer can choose, and the speech detector
// that decides when someone has really spoken. No imports: the app bundles this file as it is.

// ── Languages ──

export interface LanguageOption {
  /** ISO 639-1 code, saved in the account (user_metadata.language). */
  code: string;
  /** English name, as the assistant is told. */
  name: string;
  /** The name in its own script, as the menu shows it. */
  native: string;
  /** Locale for Google's transcription, when Google lists the language (it handles Indian languages best). */
  googleLocale?: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', googleLocale: 'hi-IN' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', googleLocale: 'bn-IN' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', googleLocale: 'te-IN' },
  { code: 'mr', name: 'Marathi', native: 'मराठी', googleLocale: 'mr-IN' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', googleLocale: 'gu-IN' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', googleLocale: 'kn-IN' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', googleLocale: 'ml-IN' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', googleLocale: 'pa-IN' },
  { code: 'ur', name: 'Urdu', native: 'اردو' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली' },
  { code: 'si', name: 'Sinhala', native: 'සිංහල' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
];

export const languageOf = (code: string | null | undefined): LanguageOption | null =>
  LANGUAGES.find(l => l.code === code) ?? null;

/** What the assistant is told about the customer's language (empty for automatic). */
export function languageRule(code: string | null | undefined): string {
  const lang = languageOf(code);
  if (!lang) return '';
  return `The customer's language is ${lang.name}. Reply in ${lang.name}${lang.code === 'en' ? '' : ` (in its own script)`} unless they write to you in another language; keep app names, numbers, emails and links exactly as they are.`;
}

/** POST /api/whisper/transcribe → */
export interface TranscriptionResult {
  text: string;
  /** The language heard, when the engine says. */
  language: string | null;
  /** Too little real speech in the recording: nothing was sent to be transcribed. */
  noSpeech?: boolean;
}

// ── Speech detection ──
//
// A recording only counts as speech when the voice is clearly above the room's own noise for long
// enough: a cough, a door or a fan is not speech. This matters because transcription engines make up
// sentences ("Thank you for watching") from silence or noise — so silence is never sent to them at all.

export const VAD = {
  /** The first moments set the room's noise level. */
  calibrateMs: 300,
  /** Louder than the room for this long in a row before it counts as voice (not a click or a knock). */
  onsetMs: 180,
  /** Voice in total before the recording counts as speech. */
  minSpeechMs: 450,
  /** A pause this long after speech ends the turn (voice mode). */
  pauseMs: 1300,
  /** Speaking into the message box stops after a longer pause (the words are then checked, not sent). */
  dictationPauseMs: 2500,
  dictationMaxMs: 180_000,
  /** Short bursts that never added up to speech are forgotten after this much quiet. */
  forgetMs: 1500,
  /** Nothing said for this long: voice mode stops listening. */
  nothingMs: 20_000,
  /** One turn at most. */
  maxMs: 60_000,
  /** How far above the room's noise counts as voice (dB), and the quietest level that can (dBFS). */
  aboveFloorDb: 14,
  minVoiceDb: -42,
} as const;

export interface VadState {
  elapsedMs: number;
  /** The room's noise level (dBFS), learned and slowly re-learned. */
  floorDb: number;
  /** Loud for this long in a row. */
  runMs: number;
  /** Voice counted so far. */
  voicedMs: number;
  /** Quiet since the last voice. */
  quietMs: number;
  /** Enough voice to count as speech. */
  heard: boolean;
}

export type VadEvent = 'none' | 'end' | 'nothing';

export const newVad = (): VadState => ({ elapsedMs: 0, floorDb: Infinity, runMs: 0, voicedMs: 0, quietMs: 0, heard: false });

/**
 * Feeds one level reading (dBFS, e.g. −160 to 0) taken `dtMs` after the last. Returns the new state and
 * whether the turn ended: 'end' after speech and a pause (send it), 'nothing' when no speech came.
 * Speaking into the message box passes a longer pause and time limit.
 */
export function vadStep(
  prev: VadState, db: number, dtMs: number,
  { pauseMs = VAD.pauseMs, maxMs = VAD.maxMs }: { pauseMs?: number; maxMs?: number } = {},
): { state: VadState; event: VadEvent } {
  const s: VadState = { ...prev, elapsedMs: prev.elapsedMs + dtMs };
  const level = Number.isFinite(db) ? Math.max(db, -100) : -100;
  if (s.elapsedMs <= VAD.calibrateMs) {
    s.floorDb = Math.min(s.floorDb, level);
    return { state: s, event: 'none' };
  }
  // The floor follows the room down at once and back up slowly (0.5 dB a second), so speech can't raise it.
  s.floorDb = Math.min(level, s.floorDb + 0.0005 * dtMs);
  const voiceAt = Math.max(VAD.minVoiceDb, s.floorDb + VAD.aboveFloorDb);
  if (level > voiceAt) {
    const run = s.runMs + dtMs;
    // The run counts once it is long enough, and from then on as it goes.
    s.voicedMs += run >= VAD.onsetMs ? (s.runMs >= VAD.onsetMs ? dtMs : run) : 0;
    s.runMs = run;
    s.quietMs = 0;
  } else {
    s.runMs = 0;
    // Softer than voice but not quiet (between words): not a pause yet.
    s.quietMs = level > voiceAt - 6 ? 0 : s.quietMs + dtMs;
    if (!s.heard && s.voicedMs > 0 && s.quietMs >= VAD.forgetMs) s.voicedMs = 0;
  }
  s.heard = s.heard || s.voicedMs >= VAD.minSpeechMs;
  if (s.heard && (s.quietMs >= pauseMs || s.elapsedMs >= maxMs)) return { state: s, event: 'end' };
  if (!s.heard && (s.elapsedMs >= VAD.nothingMs || s.elapsedMs >= maxMs)) return { state: s, event: 'nothing' };
  return { state: s, event: 'none' };
}

/** Recording level as 0–1, for a moving dot or circle. */
export const loudness = (db: number | undefined) => (db === undefined ? 0 : Math.min(1, Math.max(0, (db + 60) / 50)));
