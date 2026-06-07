/**
 * @fileoverview BrowserDetector — monitors browser-level signals that indicate
 * potential cheating during a proctored interview.  No AI calls are made here;
 * all detections rely on native DOM / browser events.
 *
 * Detected behaviours:
 *  • Tab visibility changes  (visibilitychange)
 *  • Copy / Paste events     (copy, paste)
 *  • Window blur / focus      (blur, focus)
 *  • Suspicious window resize (resize)
 *  • DevTools open attempt    (resize + outer-inner size heuristic)
 *
 * @module detectors/browser-detector
 */

import { VIOLATION_TYPES } from '../detection-types.js';

// ─── Internal Constants ──────────────────────────────────────────────────────

/** Minimum hidden duration (ms) before a tab-switch violation fires. */
const TAB_SWITCH_THRESHOLD_MS = 1_000;

/**
 * Pixel threshold — if `outerWidth - innerWidth` (or height equivalent) exceeds
 * this value *after* a resize, we flag a possible DevTools panel.
 */
const DEVTOOLS_SIZE_DELTA_PX = 200;

/** Minimum resize delta (px) considered "suspicious" (e.g. snapping to half-screen). */
const SUSPICIOUS_RESIZE_DELTA_PX = 300;

/** Cooldown (ms) to prevent duplicate resize / DevTools violations. */
const RESIZE_COOLDOWN_MS = 3_000;

// ─── Violation Factory ───────────────────────────────────────────────────────

/**
 * @typedef {Object} Violation
 * @property {import('../detection-types.js').ViolationType} type
 * @property {number}  timestamp - Unix epoch ms
 * @property {string}  message   - Human-readable description
 * @property {string}  source    - Always 'browser'
 */

/**
 * Creates a normalised violation object.
 *
 * @param {import('../detection-types.js').ViolationType} type
 * @param {string} message
 * @returns {Violation}
 */
function createViolation(type, message) {
  return Object.freeze({
    type,
    timestamp: Date.now(),
    message,
    source: 'browser',
  });
}

// ─── BrowserDetector Class ───────────────────────────────────────────────────

/**
 * Monitors browser-level events that may signal cheating and emits violations
 * through the provided callback.
 *
 * @example
 * const detector = new BrowserDetector({
 *   onViolation: (v) => console.log(v),
 * });
 * detector.start();
 * // … later …
 * detector.stop();
 */
export class BrowserDetector {
  /**
   * @param {Object} config
   * @param {(violation: Violation) => void} config.onViolation
   *   Callback invoked every time a browser-level violation is detected.
   */
  constructor({ onViolation }) {
    if (typeof onViolation !== 'function') {
      throw new TypeError('BrowserDetector requires an onViolation callback');
    }

    /** @private */
    this._onViolation = onViolation;

    /** @private Whether the detector is actively listening. */
    this._running = false;

    // ── Tracking state ──────────────────────────────────────────────────
    /** @private Timestamp when the tab was last hidden. */
    this._hiddenSince = 0;

    /** @private Cumulative time (ms) the tab has been hidden. */
    this._totalTabAwayMs = 0;

    /** @private Last known window dimensions for resize delta. */
    this._lastWidth = 0;
    /** @private */
    this._lastHeight = 0;

    /** @private Timestamp of last resize-based violation (cooldown). */
    this._lastResizeViolationAt = 0;

    /** @private Number of blur events (without matching focus) recorded. */
    this._blurCount = 0;

    /** @private Timestamp when the window last lost focus. */
    this._blurSince = 0;

    // ── Bound handlers (so we can removeEventListener later) ────────────
    /** @private */ this._handleVisibility = this._onVisibilityChange.bind(this);
    /** @private */ this._handleCopy       = this._onCopy.bind(this);
    /** @private */ this._handlePaste      = this._onPaste.bind(this);
    /** @private */ this._handleBlur       = this._onBlur.bind(this);
    /** @private */ this._handleFocus      = this._onFocus.bind(this);
    /** @private */ this._handleResize     = this._onResize.bind(this);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Starts listening for browser events. Safe to call multiple times —
   * subsequent calls are no-ops.
   */
  start() {
    if (this._running) return;
    this._running = true;

    // Snapshot initial dimensions
    this._lastWidth = window.innerWidth;
    this._lastHeight = window.innerHeight;

    document.addEventListener('visibilitychange', this._handleVisibility);
    document.addEventListener('copy', this._handleCopy);
    document.addEventListener('paste', this._handlePaste);
    window.addEventListener('blur', this._handleBlur);
    window.addEventListener('focus', this._handleFocus);
    window.addEventListener('resize', this._handleResize);
  }

  /**
   * Stops listening and resets internal tracking state.
   */
  stop() {
    if (!this._running) return;
    this._running = false;

    document.removeEventListener('visibilitychange', this._handleVisibility);
    document.removeEventListener('copy', this._handleCopy);
    document.removeEventListener('paste', this._handlePaste);
    window.removeEventListener('blur', this._handleBlur);
    window.removeEventListener('focus', this._handleFocus);
    window.removeEventListener('resize', this._handleResize);

    // If tab is currently hidden, account for the remaining time
    if (this._hiddenSince > 0) {
      this._totalTabAwayMs += Date.now() - this._hiddenSince;
      this._hiddenSince = 0;
    }
  }

  /**
   * Returns cumulative time (seconds) the tab has been hidden.
   * @returns {number}
   */
  get totalTabAwaySeconds() {
    let total = this._totalTabAwayMs;
    if (this._hiddenSince > 0) {
      total += Date.now() - this._hiddenSince;
    }
    return +(total / 1_000).toFixed(1);
  }

  /**
   * Returns a snapshot of the detector's internal counters.
   * @returns {{ running: boolean, totalTabAwaySec: number, blurCount: number }}
   */
  getStats() {
    return {
      running: this._running,
      totalTabAwaySec: this.totalTabAwaySeconds,
      blurCount: this._blurCount,
    };
  }

  // ── Event Handlers (private) ────────────────────────────────────────────

  /** @private */
  _onVisibilityChange() {
    if (document.hidden) {
      this._hiddenSince = Date.now();
    } else if (this._hiddenSince > 0) {
      const awayMs = Date.now() - this._hiddenSince;
      this._totalTabAwayMs += awayMs;
      this._hiddenSince = 0;

      if (awayMs >= TAB_SWITCH_THRESHOLD_MS) {
        const awaySec = (awayMs / 1_000).toFixed(1);
        this._emit(
          VIOLATION_TYPES.TAB_SWITCH,
          `Tab switched away for ${awaySec}s (total away: ${this.totalTabAwaySeconds}s)`,
        );
      }
    }
  }

  /** @private */
  _onCopy() {
    this._emit(VIOLATION_TYPES.COPY_PASTE, 'Copy action detected during session');
  }

  /** @private */
  _onPaste() {
    this._emit(VIOLATION_TYPES.COPY_PASTE, 'Paste action detected during session');
  }

  /** @private */
  _onBlur() {
    this._blurCount++;
    this._blurSince = Date.now();
  }

  /** @private */
  _onFocus() {
    if (this._blurSince > 0) {
      const awayMs = Date.now() - this._blurSince;
      this._blurSince = 0;

      if (awayMs >= TAB_SWITCH_THRESHOLD_MS) {
        const awaySec = (awayMs / 1_000).toFixed(1);
        this._emit(
          VIOLATION_TYPES.TAB_SWITCH,
          `Window lost focus for ${awaySec}s`,
        );
      }
    }
  }

  /** @private */
  _onResize() {
    const now = Date.now();
    if (now - this._lastResizeViolationAt < RESIZE_COOLDOWN_MS) return;

    const dw = Math.abs(window.innerWidth - this._lastWidth);
    const dh = Math.abs(window.innerHeight - this._lastHeight);

    // ── DevTools heuristic ──────────────────────────────────────────────
    const widthDelta  = window.outerWidth - window.innerWidth;
    const heightDelta = window.outerHeight - window.innerHeight;

    if (widthDelta > DEVTOOLS_SIZE_DELTA_PX || heightDelta > DEVTOOLS_SIZE_DELTA_PX) {
      this._lastResizeViolationAt = now;
      this._emit(
        VIOLATION_TYPES.TAB_SWITCH,
        `Possible DevTools panel detected (outer-inner delta: ${widthDelta}×${heightDelta}px)`,
      );
    } else if (dw > SUSPICIOUS_RESIZE_DELTA_PX || dh > SUSPICIOUS_RESIZE_DELTA_PX) {
      // ── Suspicious resize (e.g. window snap to make room for notes) ──
      this._lastResizeViolationAt = now;
      this._emit(
        VIOLATION_TYPES.TAB_SWITCH,
        `Suspicious window resize detected (Δ${dw}×${dh}px)`,
      );
    }

    // Update last-known size regardless
    this._lastWidth = window.innerWidth;
    this._lastHeight = window.innerHeight;
  }

  // ── Internals ───────────────────────────────────────────────────────────

  /**
   * Emits a violation through the registered callback.
   * @private
   * @param {import('../detection-types.js').ViolationType} type
   * @param {string} message
   */
  _emit(type, message) {
    try {
      this._onViolation(createViolation(type, message));
    } catch (err) {
      console.error('[BrowserDetector] onViolation callback threw:', err);
    }
  }
}
