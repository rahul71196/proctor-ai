/**
 * @fileoverview ProctorEngine — the main orchestrator for ProctorAI's
 * real-time interview cheating detection.
 *
 * Responsibilities:
 *  1. Webcam frame capture → Gemini Vision analysis → violation mapping
 *  2. Microphone audio capture → Gemini Audio analysis → violation mapping
 *  3. Browser-event monitoring via {@link BrowserDetector}
 *  4. Trust-score computation & lifecycle management
 *
 * All Gemini API calls use structured JSON output (`responseMimeType`).
 *
 * @module proctor-engine
 */

import { VIOLATION_TYPES, SEVERITY_LEVELS } from './detection-types.js';
import { BrowserDetector } from './detectors/browser-detector.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Base endpoint for Gemini generativeLanguage API. */
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** JPEG quality used when capturing webcam frames (0–1). */
const JPEG_QUALITY = 0.6;

/** How often (ms) to record an audio clip. */
const AUDIO_CYCLE_INTERVAL_MS = 15_000;

/** Duration (ms) of each audio recording clip. */
const AUDIO_CLIP_DURATION_MS = 5_000;

/** Trust-score recovery points awarded per clean frame analysis. */
const CLEAN_ANALYSIS_RECOVERY = 0.5;

/** Maximum trust score. */
const MAX_TRUST_SCORE = 100;

/** Minimum trust score. */
const MIN_TRUST_SCORE = 0;

// ─── Prompts ─────────────────────────────────────────────────────────────────

const VISION_PROMPT = [
  'You are an AI interview proctor. Analyze this webcam frame.',
  'Respond in JSON: { "looking_at_screen": bool, "gaze_direction": string,',
  '"face_count": number, "head_orientation": string, "phone_visible": bool,',
  '"screen_obstructed": bool, "suspicious_objects": string[],',
  '"confidence": number, "notes": string }',
].join(' ');

const AUDIO_PROMPT = [
  'Analyze this interview audio. JSON response:',
  '{ "single_speaker": bool, "background_voices": bool,',
  '"tts_detected": bool, "whispering": bool,',
  '"confidence": number, "notes": string }',
].join(' ');

// ─── Type Definitions ────────────────────────────────────────────────────────

/**
 * @typedef {Object} ProctorEngineConfig
 * @property {string}   apiKey                 - Google Gemini API key
 * @property {string}   [model='gemini-2.5-flash'] - Gemini model name
 * @property {number}   [frameInterval=4000]   - ms between webcam frame analyses
 * @property {(v: import('./detectors/browser-detector.js').Violation) => void} [onViolation]
 * @property {(analysis: Object) => void}     [onAnalysis]
 * @property {(score: number) => void}        [onTrustScoreUpdate]
 * @property {(status: string) => void}       [onStatusChange]
 */

/**
 * @typedef {Object} VisionAnalysis
 * @property {boolean}  looking_at_screen
 * @property {string}   gaze_direction
 * @property {number}   face_count
 * @property {string}   head_orientation
 * @property {boolean}  phone_visible
 * @property {boolean}  screen_obstructed
 * @property {string[]} suspicious_objects
 * @property {number}   confidence
 * @property {string}   notes
 */

/**
 * @typedef {Object} AudioAnalysis
 * @property {boolean} single_speaker
 * @property {boolean} background_voices
 * @property {boolean} tts_detected
 * @property {boolean} whispering
 * @property {number}  confidence
 * @property {string}  notes
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Clamps a number between min and max.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Converts a Blob to a base64-encoded string (without the data-URI prefix).
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = /** @type {string} */ (reader.result);
      // Strip the "data:…;base64," prefix
      resolve(dataUrl.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── ProctorEngine ───────────────────────────────────────────────────────────

export class ProctorEngine {
  /**
   * @param {ProctorEngineConfig} config
   */
  constructor(config) {
    if (!config?.apiKey) {
      throw new Error('ProctorEngine requires an apiKey');
    }

    /** @private */ this._apiKey        = config.apiKey;
    /** @private */ this._model         = config.model ?? 'gemini-2.5-flash';
    /** @private */ this._frameInterval = config.frameInterval ?? 4_000;

    // Callbacks (all optional — default to no-ops)
    /** @private */ this._onViolation       = config.onViolation       ?? (() => {});
    /** @private */ this._onAnalysis        = config.onAnalysis        ?? (() => {});
    /** @private */ this._onTrustScoreUpdate = config.onTrustScoreUpdate ?? (() => {});
    /** @private */ this._onStatusChange    = config.onStatusChange    ?? (() => {});

    // ── Runtime state ────────────────────────────────────────────────────
    /** @private */ this._isRunning       = false;
    /** @private */ this._trustScore      = MAX_TRUST_SCORE;
    /** @private */ this._violations      = /** @type {Array} */ ([]);
    /** @private */ this._analysisCount   = 0;
    /** @private */ this._sessionStartTime = 0;

    // ── Media handles ────────────────────────────────────────────────────
    /** @private @type {MediaStream | null} */  this._mediaStream   = null;
    /** @private @type {HTMLVideoElement | null} */ this._videoEl    = null;
    /** @private @type {HTMLCanvasElement | null} */ this._canvasEl  = null;
    /** @private @type {CanvasRenderingContext2D | null} */ this._ctx = null;

    // ── Timers ───────────────────────────────────────────────────────────
    /** @private @type {number | null} */ this._frameTimer = null;
    /** @private @type {number | null} */ this._audioCycleTimer = null;

    // ── Audio recording ──────────────────────────────────────────────────
    /** @private @type {MediaRecorder | null} */ this._mediaRecorder = null;

    // ── Sub-detectors ────────────────────────────────────────────────────
    /** @private */ this._browserDetector = new BrowserDetector({
      onViolation: (v) => this._handleViolation(v),
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Requests webcam + microphone access, initialises capture elements, and
   * starts the frame-analysis loop, audio-analysis cycle, and browser detector.
   *
   * @returns {Promise<void>}
   * @throws {Error} If media permissions are denied or streams cannot be acquired.
   */
  async start() {
    if (this._isRunning) {
      console.warn('[ProctorEngine] Already running');
      return;
    }

    this._setStatus('requesting_permissions');

    try {
      this._mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: true,
      });
    } catch (err) {
      this._setStatus('permission_denied');
      throw new Error(`Failed to acquire media: ${err.message}`);
    }

    // ── Video element (off-screen) ────────────────────────────────────────
    this._videoEl = document.createElement('video');
    this._videoEl.srcObject = this._mediaStream;
    this._videoEl.setAttribute('playsinline', '');
    this._videoEl.muted = true;
    await this._videoEl.play();

    // ── Canvas for frame capture ──────────────────────────────────────────
    this._canvasEl = document.createElement('canvas');
    this._canvasEl.width = this._videoEl.videoWidth || 640;
    this._canvasEl.height = this._videoEl.videoHeight || 480;
    this._ctx = this._canvasEl.getContext('2d');

    // ── Start loops ───────────────────────────────────────────────────────
    this._isRunning = true;
    this._sessionStartTime = Date.now();
    this._trustScore = MAX_TRUST_SCORE;
    this._violations = [];
    this._analysisCount = 0;

    this._startFrameLoop();
    this._startAudioCycle();
    this._browserDetector.start();

    this._setStatus('running');
  }

  /**
   * Stops all capture loops, releases media streams, and tears down the
   * browser detector.
   */
  stop() {
    if (!this._isRunning) return;
    this._isRunning = false;

    // Timers
    if (this._frameTimer !== null) {
      clearInterval(this._frameTimer);
      this._frameTimer = null;
    }
    if (this._audioCycleTimer !== null) {
      clearInterval(this._audioCycleTimer);
      this._audioCycleTimer = null;
    }

    // MediaRecorder
    if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
      try { this._mediaRecorder.stop(); } catch { /* ignore */ }
    }
    this._mediaRecorder = null;

    // Media stream tracks
    if (this._mediaStream) {
      this._mediaStream.getTracks().forEach((t) => t.stop());
      this._mediaStream = null;
    }

    // Video element
    if (this._videoEl) {
      this._videoEl.srcObject = null;
      this._videoEl = null;
    }

    this._canvasEl = null;
    this._ctx = null;

    this._browserDetector.stop();
    this._setStatus('stopped');
  }

  /**
   * Returns a snapshot of the engine's current state.
   *
   * @returns {{
   *   isRunning: boolean,
   *   trustScore: number,
   *   violations: Array,
   *   analysisCount: number,
   *   sessionStartTime: number
   * }}
   */
  getState() {
    return {
      isRunning: this._isRunning,
      trustScore: this._trustScore,
      violations: [...this._violations],
      analysisCount: this._analysisCount,
      sessionStartTime: this._sessionStartTime,
    };
  }

  /**
   * Returns a summary object of session statistics.
   *
   * @returns {{
   *   durationSec: number,
   *   trustScore: number,
   *   totalViolations: number,
   *   violationsByType: Record<string, number>,
   *   analysisCount: number,
   *   tabAwaySec: number
   * }}
   */
  getSessionStats() {
    const durationMs = this._sessionStartTime
      ? Date.now() - this._sessionStartTime
      : 0;

    /** @type {Record<string, number>} */
    const byType = {};
    for (const v of this._violations) {
      const id = v.type?.id ?? 'unknown';
      byType[id] = (byType[id] ?? 0) + 1;
    }

    return {
      durationSec: +(durationMs / 1_000).toFixed(1),
      trustScore: this._trustScore,
      totalViolations: this._violations.length,
      violationsByType: byType,
      analysisCount: this._analysisCount,
      tabAwaySec: this._browserDetector.totalTabAwaySeconds,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  FRAME CAPTURE & VISION ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════

  /** @private */
  _startFrameLoop() {
    // Fire immediately, then repeat
    this._captureAndAnalyzeFrame();
    this._frameTimer = setInterval(
      () => this._captureAndAnalyzeFrame(),
      this._frameInterval,
    );
  }

  /** @private */
  async _captureAndAnalyzeFrame() {
    if (!this._isRunning || !this._ctx || !this._videoEl) return;

    let base64Frame;
    try {
      this._ctx.drawImage(this._videoEl, 0, 0, this._canvasEl.width, this._canvasEl.height);
      const dataUrl = this._canvasEl.toDataURL('image/jpeg', JPEG_QUALITY);
      base64Frame = dataUrl.split(',')[1];
    } catch (err) {
      console.error('[ProctorEngine] Frame capture failed:', err);
      return;
    }

    try {
      const analysis = await this._callGeminiVision(base64Frame);
      this._analysisCount++;
      this._onAnalysis({ type: 'vision', data: analysis, timestamp: Date.now() });
      this._processVisionResult(analysis);
    } catch (err) {
      console.error('[ProctorEngine] Vision analysis failed:', err);
    }
  }

  /**
   * Calls Gemini Vision API with a base64 JPEG frame.
   * @private
   * @param {string} base64
   * @returns {Promise<VisionAnalysis>}
   */
  async _callGeminiVision(base64) {
    const url = `${GEMINI_API_BASE}/${this._model}:generateContent?key=${this._apiKey}`;

    const body = {
      contents: [{
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: base64 } },
          { text: VISION_PROMPT },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
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

    return JSON.parse(text);
  }

  /**
   * Maps a VisionAnalysis result to zero or more violations.
   * @private
   * @param {VisionAnalysis} result
   */
  _processVisionResult(result) {
    let isClean = true;

    if (result.face_count > 1) {
      isClean = false;
      this._handleViolation({
        type: VIOLATION_TYPES.MULTIPLE_FACES,
        timestamp: Date.now(),
        message: `${result.face_count} faces detected in frame`,
        source: 'vision',
      });
    }

    if (result.looking_at_screen === false) {
      isClean = false;
      this._handleViolation({
        type: VIOLATION_TYPES.GAZE_AWAY,
        timestamp: Date.now(),
        message: `Gaze directed ${result.gaze_direction ?? 'away from screen'}`,
        source: 'vision',
      });
    }

    if (result.phone_visible) {
      isClean = false;
      this._handleViolation({
        type: VIOLATION_TYPES.PHONE_DETECTED,
        timestamp: Date.now(),
        message: 'Phone or mobile device visible in frame',
        source: 'vision',
      });
    }

    if (result.screen_obstructed) {
      isClean = false;
      this._handleViolation({
        type: VIOLATION_TYPES.SCREEN_OBSTRUCTION,
        timestamp: Date.now(),
        message: result.notes || 'Screen or camera view is obstructed',
        source: 'vision',
      });
    }

    const headDir = (result.head_orientation ?? '').toLowerCase();
    if (headDir && headDir !== 'forward' && headDir !== 'center' && headDir !== 'facing camera') {
      isClean = false;
      this._handleViolation({
        type: VIOLATION_TYPES.HEAD_TURNED,
        timestamp: Date.now(),
        message: `Head orientation: ${result.head_orientation}`,
        source: 'vision',
      });
    }

    // Award recovery for a clean frame
    if (isClean) {
      this._recoverTrustScore();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  AUDIO CAPTURE & ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════

  /** @private */
  _startAudioCycle() {
    // First clip after a short initial delay
    this._audioCycleTimer = setInterval(
      () => this._recordAndAnalyzeAudio(),
      AUDIO_CYCLE_INTERVAL_MS,
    );
  }

  /** @private */
  async _recordAndAnalyzeAudio() {
    if (!this._isRunning || !this._mediaStream) return;

    let base64Audio;
    try {
      base64Audio = await this._recordAudioClip();
    } catch (err) {
      console.error('[ProctorEngine] Audio recording failed:', err);
      return;
    }

    try {
      const analysis = await this._callGeminiAudio(base64Audio);
      this._analysisCount++;
      this._onAnalysis({ type: 'audio', data: analysis, timestamp: Date.now() });
      this._processAudioResult(analysis);
    } catch (err) {
      console.error('[ProctorEngine] Audio analysis failed:', err);
    }
  }

  /**
   * Records an audio clip from the active media stream.
   * @private
   * @returns {Promise<string>} base64-encoded webm audio
   */
  _recordAudioClip() {
    return new Promise((resolve, reject) => {
      const audioTracks = this._mediaStream?.getAudioTracks();
      if (!audioTracks || audioTracks.length === 0) {
        return reject(new Error('No audio tracks available'));
      }

      const audioStream = new MediaStream(audioTracks);

      /** @type {Blob[]} */
      const chunks = [];

      let recorder;
      try {
        // Prefer webm/opus; fall back to browser default
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : '';
        recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
      } catch (err) {
        return reject(err);
      }

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          const b64 = await blobToBase64(blob);
          resolve(b64);
        } catch (err) {
          reject(err);
        }
      };

      recorder.onerror = (e) => reject(e.error ?? new Error('MediaRecorder error'));

      this._mediaRecorder = recorder;
      recorder.start();

      // Stop after AUDIO_CLIP_DURATION_MS
      setTimeout(() => {
        if (recorder.state !== 'inactive') {
          try { recorder.stop(); } catch { /* ignore */ }
        }
      }, AUDIO_CLIP_DURATION_MS);
    });
  }

  /**
   * Calls Gemini Audio API with a base64 webm audio clip.
   * @private
   * @param {string} base64
   * @returns {Promise<AudioAnalysis>}
   */
  async _callGeminiAudio(base64) {
    const url = `${GEMINI_API_BASE}/${this._model}:generateContent?key=${this._apiKey}`;

    const body = {
      contents: [{
        parts: [
          { inline_data: { mime_type: 'audio/webm', data: base64 } },
          { text: AUDIO_PROMPT },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
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

    return JSON.parse(text);
  }

  /**
   * Maps an AudioAnalysis result to zero or more violations.
   * @private
   * @param {AudioAnalysis} result
   */
  _processAudioResult(result) {
    let isClean = true;

    if (result.background_voices) {
      isClean = false;
      this._handleViolation({
        type: VIOLATION_TYPES.BACKGROUND_VOICE,
        timestamp: Date.now(),
        message: result.notes || 'Background voices detected in audio',
        source: 'audio',
      });
    }

    if (result.tts_detected) {
      isClean = false;
      this._handleViolation({
        type: VIOLATION_TYPES.BACKGROUND_VOICE,
        timestamp: Date.now(),
        message: 'Text-to-speech audio detected — possible AI assistant',
        source: 'audio',
      });
    }

    if (result.whispering) {
      isClean = false;
      this._handleViolation({
        type: VIOLATION_TYPES.BACKGROUND_VOICE,
        timestamp: Date.now(),
        message: 'Whispering detected — possible off-screen communication',
        source: 'audio',
      });
    }

    if (isClean) {
      this._recoverTrustScore();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  TRUST SCORE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handles an incoming violation from any source (vision, audio, browser).
   * Updates trust score and emits the violation event.
   * @private
   * @param {Object} violation
   */
  _handleViolation(violation) {
    this._violations.push(violation);

    // Compute penalty
    const severity = violation.type?.severity ?? 'medium';
    const weight = violation.type?.weight ?? 3;
    const multiplier = SEVERITY_LEVELS[severity]?.multiplier ?? 1;
    const penalty = weight * multiplier;

    this._trustScore = clamp(
      this._trustScore - penalty,
      MIN_TRUST_SCORE,
      MAX_TRUST_SCORE,
    );

    this._onTrustScoreUpdate(this._trustScore);

    try {
      this._onViolation(violation);
    } catch (err) {
      console.error('[ProctorEngine] onViolation callback threw:', err);
    }
  }

  /**
   * Adds a small recovery increment to the trust score after a clean analysis.
   * @private
   */
  _recoverTrustScore() {
    if (this._trustScore >= MAX_TRUST_SCORE) return;

    this._trustScore = clamp(
      this._trustScore + CLEAN_ANALYSIS_RECOVERY,
      MIN_TRUST_SCORE,
      MAX_TRUST_SCORE,
    );

    this._onTrustScoreUpdate(this._trustScore);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  STATUS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Updates the engine status and notifies the listener.
   * @private
   * @param {string} status
   */
  _setStatus(status) {
    try {
      this._onStatusChange(status);
    } catch (err) {
      console.error('[ProctorEngine] onStatusChange callback threw:', err);
    }
  }
}
