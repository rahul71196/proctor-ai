/**
 * @fileoverview ProctorAI Interview Questions Manager
 * Manages a built-in AI mock interview system powered by Google Gemini.
 * Generates position-specific interview questions, tracks timing, and
 * manages question progression throughout the interview session.
 *
 * @module interview-questions
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Base endpoint for Gemini generativeLanguage API. */
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Minimum questions to generate per session. */
const MIN_QUESTIONS = 8;

/** Maximum questions to generate per session. */
const MAX_QUESTIONS = 10;

// ─── Type Definitions ────────────────────────────────────────────────────────

/**
 * @typedef {'behavioral' | 'technical' | 'system-design' | 'coding'} QuestionCategory
 */

/**
 * @typedef {'easy' | 'medium' | 'hard'} QuestionDifficulty
 */

/**
 * @typedef {Object} InterviewQuestion
 * @property {string}             text       - The question text
 * @property {QuestionCategory}   category   - Question category
 * @property {number}             timeLimit  - Time limit in seconds (60–180)
 * @property {QuestionDifficulty} difficulty - Difficulty level
 */

/**
 * @typedef {Object} QuestionState
 * @property {number}            index     - Zero-based index of the current question
 * @property {number}            total     - Total number of questions
 * @property {string}            text      - The question text
 * @property {QuestionCategory}  category  - Question category
 * @property {number}            timeLimit - Time limit in seconds
 */

/**
 * @typedef {Object} QuestionHistoryEntry
 * @property {InterviewQuestion} question   - The question asked
 * @property {number}            startedAt  - Unix timestamp when the question was shown
 * @property {number | null}     endedAt    - Unix timestamp when the candidate moved on
 * @property {number}            elapsed    - Seconds spent on this question
 */

/**
 * @typedef {Object} InterviewProgress
 * @property {number} current       - Current question number (1-based)
 * @property {number} total         - Total number of questions
 * @property {number} timeElapsed   - Total time elapsed in seconds since first question
 * @property {number} timeRemaining - Estimated remaining time in seconds
 */

/**
 * @typedef {Object} InterviewManagerConfig
 * @property {string}   apiKey                      - Google Gemini API key
 * @property {string}   [model='gemini-2.5-flash']  - Gemini model name
 * @property {string}   position                    - Job position title
 * @property {string}   candidateName               - Candidate's name
 * @property {(q: QuestionState) => void}  [onQuestionReady]     - Fired when a question is ready
 * @property {(stats: Object) => void}     [onInterviewComplete] - Fired when all questions are done
 */

// ─── Fallback Questions ──────────────────────────────────────────────────────

/**
 * Hardcoded fallback questions used when the Gemini API call fails.
 * Provides a balanced mix across all four categories and difficulties.
 *
 * @type {InterviewQuestion[]}
 */
const FALLBACK_QUESTIONS = Object.freeze([
  {
    text: 'Tell me about a time you had to work under a tight deadline. How did you prioritize your tasks?',
    category: 'behavioral',
    timeLimit: 120,
    difficulty: 'easy',
  },
  {
    text: 'Explain the difference between a stack and a queue. When would you choose one over the other?',
    category: 'technical',
    timeLimit: 90,
    difficulty: 'easy',
  },
  {
    text: 'How would you design a URL shortener service like bit.ly? Walk me through the high-level architecture.',
    category: 'system-design',
    timeLimit: 180,
    difficulty: 'medium',
  },
  {
    text: 'Write a function that finds the first non-repeating character in a string. What is its time complexity?',
    category: 'coding',
    timeLimit: 120,
    difficulty: 'medium',
  },
  {
    text: 'Describe a situation where you disagreed with a teammate. How did you resolve the conflict?',
    category: 'behavioral',
    timeLimit: 120,
    difficulty: 'medium',
  },
  {
    text: 'What is the difference between TCP and UDP? Give examples of when you would use each.',
    category: 'technical',
    timeLimit: 90,
    difficulty: 'medium',
  },
  {
    text: 'Design a real-time chat application that supports millions of concurrent users. Discuss scaling strategies.',
    category: 'system-design',
    timeLimit: 180,
    difficulty: 'hard',
  },
  {
    text: 'Given an array of integers, find two numbers such that they add up to a specific target. Optimize for time.',
    category: 'coding',
    timeLimit: 90,
    difficulty: 'easy',
  },
  {
    text: 'Explain the CAP theorem and its implications for distributed database design.',
    category: 'technical',
    timeLimit: 120,
    difficulty: 'hard',
  },
  {
    text: 'Tell me about a project that failed. What did you learn and what would you do differently?',
    category: 'behavioral',
    timeLimit: 120,
    difficulty: 'medium',
  },
]);

// ─── InterviewManager ────────────────────────────────────────────────────────

export class InterviewManager {
  /**
   * Creates a new InterviewManager.
   *
   * @param {InterviewManagerConfig} config
   * @throws {Error} If required config fields are missing.
   */
  constructor(config) {
    if (!config?.apiKey) {
      throw new Error('InterviewManager requires an apiKey');
    }
    if (!config?.position) {
      throw new Error('InterviewManager requires a position');
    }

    /** @private */ this._apiKey   = config.apiKey;
    /** @private */ this._model    = config.model ?? 'gemini-2.5-flash';
    /** @private */ this._position = config.position;
    /** @private */ this._candidate = config.candidateName ?? 'Candidate';

    // Callbacks
    /** @private */ this._onQuestionReady     = config.onQuestionReady     ?? (() => {});
    /** @private */ this._onInterviewComplete = config.onInterviewComplete ?? (() => {});

    // ── State ────────────────────────────────────────────────────────────
    /** @private @type {InterviewQuestion[]} */
    this._questions = [];

    /** @private */ this._currentIndex = -1;

    /** @private @type {QuestionHistoryEntry[]} */
    this._history = [];

    /** @private */ this._sessionStartTime = 0;
    /** @private */ this._questionStartTime = 0;
    /** @private */ this._completed = false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generates interview questions by calling Gemini API.
   * Falls back to hardcoded questions if the API call fails.
   * Automatically advances to the first question.
   *
   * @returns {Promise<InterviewQuestion[]>} The generated questions.
   */
  async generateQuestions() {
    let questions;

    try {
      questions = await this._fetchQuestionsFromGemini();
      console.info(`[InterviewManager] Generated ${questions.length} questions via Gemini`);
    } catch (err) {
      console.warn('[InterviewManager] Gemini question generation failed, using fallback:', err.message);
      questions = [...FALLBACK_QUESTIONS];
    }

    // Validate and clamp question count
    questions = this._validateQuestions(questions);
    if (questions.length < MIN_QUESTIONS) {
      console.warn('[InterviewManager] Too few valid questions, supplementing with fallbacks');
      const needed = MIN_QUESTIONS - questions.length;
      const supplement = FALLBACK_QUESTIONS
        .filter((fb) => !questions.some((q) => q.text === fb.text))
        .slice(0, needed);
      questions = [...questions, ...supplement];
    }

    this._questions = questions.slice(0, MAX_QUESTIONS);
    this._currentIndex = -1;
    this._history = [];
    this._completed = false;
    this._sessionStartTime = Date.now();

    // Auto-advance to first question
    this.nextQuestion();

    return [...this._questions];
  }

  /**
   * Returns the current question as a structured object.
   *
   * @returns {QuestionState | null} Current question, or null if none active.
   */
  getCurrentQuestion() {
    if (this._currentIndex < 0 || this._currentIndex >= this._questions.length) {
      return null;
    }

    const q = this._questions[this._currentIndex];
    return {
      index: this._currentIndex,
      total: this._questions.length,
      text: q.text,
      category: q.category,
      timeLimit: q.timeLimit,
    };
  }

  /**
   * Advances to the next question. Finalises timing for the current question
   * and fires the appropriate callback.
   *
   * @returns {QuestionState | null} The new question, or null if the interview is complete.
   */
  nextQuestion() {
    // Finalise current question timing
    if (this._currentIndex >= 0 && this._currentIndex < this._questions.length) {
      const now = Date.now();
      const entry = this._history[this._currentIndex];
      if (entry && entry.endedAt === null) {
        entry.endedAt = now;
        entry.elapsed = +((now - entry.startedAt) / 1_000).toFixed(1);
      }
    }

    this._currentIndex++;

    // Check completion
    if (this._currentIndex >= this._questions.length) {
      this._completed = true;
      this._emitComplete();
      return null;
    }

    // Set up new question timing
    const now = Date.now();
    this._questionStartTime = now;

    this._history.push({
      question: { ...this._questions[this._currentIndex] },
      startedAt: now,
      endedAt: null,
      elapsed: 0,
    });

    const state = this.getCurrentQuestion();

    try {
      this._onQuestionReady(state);
    } catch (err) {
      console.error('[InterviewManager] onQuestionReady callback threw:', err);
    }

    return state;
  }

  /**
   * Returns progress information for the current interview session.
   *
   * @returns {InterviewProgress}
   */
  getProgress() {
    const current = Math.min(this._currentIndex + 1, this._questions.length);
    const total = this._questions.length;
    const timeElapsed = this._sessionStartTime
      ? +((Date.now() - this._sessionStartTime) / 1_000).toFixed(1)
      : 0;

    // Estimate remaining time from remaining questions' time limits
    const remaining = this._questions
      .slice(this._currentIndex + 1)
      .reduce((sum, q) => sum + q.timeLimit, 0);

    // Include remaining time for current question if active
    let currentRemaining = 0;
    if (this._currentIndex >= 0 && this._currentIndex < this._questions.length) {
      const q = this._questions[this._currentIndex];
      const spent = (Date.now() - this._questionStartTime) / 1_000;
      currentRemaining = Math.max(0, q.timeLimit - spent);
    }

    return {
      current,
      total,
      timeElapsed,
      timeRemaining: +(remaining + currentRemaining).toFixed(1),
    };
  }

  /**
   * Returns whether the interview is complete (all questions answered).
   *
   * @returns {boolean}
   */
  isComplete() {
    return this._completed;
  }

  /**
   * Returns a copy of the question history with timing data.
   *
   * @returns {QuestionHistoryEntry[]}
   */
  getHistory() {
    return this._history.map((entry) => ({ ...entry, question: { ...entry.question } }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PRIVATE — GEMINI API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calls Gemini API to generate interview questions for the given position.
   *
   * @private
   * @returns {Promise<InterviewQuestion[]>}
   * @throws {Error} If the API call or response parsing fails.
   */
  async _fetchQuestionsFromGemini() {
    const url = `${GEMINI_API_BASE}/${this._model}:generateContent?key=${this._apiKey}`;

    const prompt = [
      `Generate ${MIN_QUESTIONS} technical interview questions for a ${this._position} role.`,
      'Mix of behavioral, technical, and system design.',
      'JSON response: { "questions": [{ "text": string,',
      '"category": "behavioral"|"technical"|"system-design"|"coding",',
      '"timeLimit": number (seconds, 60-180),',
      '"difficulty": "easy"|"medium"|"hard" }] }',
    ].join(' ');

    const body = {
      contents: [{
        parts: [{ text: prompt }],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.8,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '(no body)');
      throw new Error(`Gemini API error ${res.status}: ${errorBody}`);
    }

    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error('Gemini response missing text content');
    }

    const parsed = JSON.parse(text);

    if (!Array.isArray(parsed?.questions)) {
      throw new Error('Gemini response missing "questions" array');
    }

    return parsed.questions;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PRIVATE — VALIDATION & HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validates and normalises an array of questions from the API response.
   * Strips any malformed entries and clamps time limits.
   *
   * @private
   * @param {any[]} raw - Raw question objects from Gemini.
   * @returns {InterviewQuestion[]}
   */
  _validateQuestions(raw) {
    const validCategories = new Set(['behavioral', 'technical', 'system-design', 'coding']);
    const validDifficulties = new Set(['easy', 'medium', 'hard']);

    return raw
      .filter((q) => {
        if (!q || typeof q.text !== 'string' || q.text.trim().length === 0) return false;
        return true;
      })
      .map((q) => ({
        text: q.text.trim(),
        category: validCategories.has(q.category) ? q.category : 'technical',
        timeLimit: typeof q.timeLimit === 'number'
          ? Math.min(Math.max(q.timeLimit, 60), 180)
          : 120,
        difficulty: validDifficulties.has(q.difficulty) ? q.difficulty : 'medium',
      }));
  }

  /**
   * Fires the onInterviewComplete callback with session statistics.
   *
   * @private
   */
  _emitComplete() {
    const totalTime = this._sessionStartTime
      ? +((Date.now() - this._sessionStartTime) / 1_000).toFixed(1)
      : 0;

    const stats = {
      candidate: this._candidate,
      position: this._position,
      totalQuestions: this._questions.length,
      totalTimeSec: totalTime,
      history: this.getHistory(),
      averageTimeSec: this._history.length > 0
        ? +(this._history.reduce((s, h) => s + h.elapsed, 0) / this._history.length).toFixed(1)
        : 0,
    };

    try {
      this._onInterviewComplete(stats);
    } catch (err) {
      console.error('[InterviewManager] onInterviewComplete callback threw:', err);
    }
  }
}
