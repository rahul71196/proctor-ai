/**
 * @fileoverview ProctorAI Detection Types & Constants
 * Defines all violation types, severity levels, and helper utilities
 * used across the detection engine.
 * @module detection-types
 */

// ─── Violation Type Definitions ──────────────────────────────────────────────

/**
 * @typedef {Object} ViolationType
 * @property {string} id          - Unique identifier for the violation
 * @property {string} label       - Human-readable label
 * @property {string} severity    - Severity level: 'low' | 'medium' | 'high' | 'critical'
 * @property {number} weight      - Numeric weight used in trust-score calculation
 * @property {string} icon        - Emoji icon for UI display
 * @property {string} color       - Hex color associated with this violation
 */

/** @type {Record<string, ViolationType>} */
export const VIOLATION_TYPES = Object.freeze({
  GAZE_AWAY: {
    id: 'gaze_away',
    label: 'Gaze Away',
    severity: 'medium',
    weight: 3,
    icon: '👀',
    color: '#fbbf24',
  },
  MULTIPLE_FACES: {
    id: 'multiple_faces',
    label: 'Multiple Faces',
    severity: 'critical',
    weight: 10,
    icon: '👥',
    color: '#ef4444',
  },
  TAB_SWITCH: {
    id: 'tab_switch',
    label: 'Tab Switch',
    severity: 'high',
    weight: 7,
    icon: '🖥️',
    color: '#f97316',
  },
  PHONE_DETECTED: {
    id: 'phone_detected',
    label: 'Phone Detected',
    severity: 'high',
    weight: 8,
    icon: '📱',
    color: '#f97316',
  },
  HEAD_TURNED: {
    id: 'head_turned',
    label: 'Head Turned',
    severity: 'medium',
    weight: 4,
    icon: '🎭',
    color: '#fbbf24',
  },
  BACKGROUND_VOICE: {
    id: 'background_voice',
    label: 'Background Voice',
    severity: 'high',
    weight: 6,
    icon: '🔊',
    color: '#f97316',
  },
  COPY_PASTE: {
    id: 'copy_paste',
    label: 'Copy/Paste',
    severity: 'medium',
    weight: 3,
    icon: '📋',
    color: '#fbbf24',
  },
  SCREEN_OBSTRUCTION: {
    id: 'screen_obstruction',
    label: 'Screen Obstruction',
    severity: 'high',
    weight: 5,
    icon: '🚫',
    color: '#f97316',
  },
});

// ─── Severity Levels ─────────────────────────────────────────────────────────

/**
 * Severity levels ordered by priority (higher = more severe).
 * The `multiplier` is applied when computing trust-score penalties.
 *
 * @typedef {Object} SeverityLevel
 * @property {number} priority    - Numeric priority (1 = lowest)
 * @property {number} multiplier  - Multiplier applied to violation weight
 * @property {string} color       - Hex color for UI severity badge
 * @property {string} label       - Human-readable label
 */

/** @type {Record<string, SeverityLevel>} */
export const SEVERITY_LEVELS = Object.freeze({
  low: {
    priority: 1,
    multiplier: 0.5,
    color: '#a3e635',
    label: 'Low',
  },
  medium: {
    priority: 2,
    multiplier: 1.0,
    color: '#fbbf24',
    label: 'Medium',
  },
  high: {
    priority: 3,
    multiplier: 1.5,
    color: '#f97316',
    label: 'High',
  },
  critical: {
    priority: 4,
    multiplier: 2.0,
    color: '#ef4444',
    label: 'Critical',
  },
});

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Returns the hex color associated with a severity level.
 *
 * @param {string} severity - One of 'low', 'medium', 'high', 'critical'
 * @returns {string} Hex color string (defaults to medium color if unknown)
 *
 * @example
 * getSeverityColor('critical'); // '#ef4444'
 */
export function getSeverityColor(severity) {
  const level = SEVERITY_LEVELS[severity];
  return level ? level.color : SEVERITY_LEVELS.medium.color;
}

/**
 * Looks up a ViolationType by its string `id`.
 *
 * @param {string} id - The violation id (e.g. 'gaze_away')
 * @returns {ViolationType | undefined} The matching violation type, or undefined
 *
 * @example
 * const v = getViolationType('phone_detected');
 * console.log(v.label); // 'Phone Detected'
 */
export function getViolationType(id) {
  return Object.values(VIOLATION_TYPES).find((v) => v.id === id);
}
