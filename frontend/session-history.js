/**
 * @fileoverview ProctorAI Session History Manager
 * Manages persistent storage of interview proctoring sessions in
 * localStorage with FIFO eviction, unique ID generation, and
 * storage usage tracking.
 *
 * @module session-history
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** localStorage key used to persist sessions. */
const STORAGE_KEY = 'proctor_sessions';

/** Maximum number of sessions stored before FIFO eviction. */
const MAX_SESSIONS = 50;

/**
 * Estimated total localStorage quota in bytes.
 * Most browsers allow ~5 MB per origin.
 */
const ESTIMATED_QUOTA_BYTES = 5 * 1024 * 1024;

// ─── Type Definitions ────────────────────────────────────────────────────────

/**
 * @typedef {Object} SessionData
 * @property {string}                    id                  - Unique session ID (UUID v4)
 * @property {string}                    candidate           - Candidate name
 * @property {string}                    position            - Job position title
 * @property {string}                    date                - ISO 8601 date string
 * @property {number}                    duration            - Session duration in seconds
 * @property {number}                    trustScore          - Final trust score (0–100)
 * @property {string}                    verdict             - Session verdict string
 * @property {number}                    totalViolations     - Total violation count
 * @property {Record<string, number>}    violationBreakdown  - Violation counts by type
 * @property {string}                    model               - Gemini model used
 */

/**
 * @typedef {Object} StorageUsage
 * @property {number} used       - Bytes used by proctor sessions
 * @property {number} total      - Estimated total quota in bytes
 * @property {number} percentage - Percentage of quota used (0–100)
 */

// ─── SessionHistory ──────────────────────────────────────────────────────────

export class SessionHistory {
  /**
   * Saves a session to localStorage. Automatically generates an `id` and
   * `date` if not already present. Enforces the maximum session limit
   * using FIFO eviction (oldest sessions are removed first).
   *
   * @param {Partial<SessionData> & { candidate: string, position: string }} sessionData
   * @returns {SessionData} The saved session object (with generated fields).
   * @throws {Error} If localStorage is unavailable or write fails.
   */
  static saveSession(sessionData) {
    if (!sessionData || typeof sessionData !== 'object') {
      throw new Error('SessionHistory.saveSession requires a session data object');
    }

    /** @type {SessionData} */
    const session = {
      id:                  sessionData.id ?? crypto.randomUUID(),
      candidate:           sessionData.candidate ?? 'Unknown',
      position:            sessionData.position ?? 'Unknown',
      date:                sessionData.date ?? new Date().toISOString(),
      duration:            typeof sessionData.duration === 'number' ? sessionData.duration : 0,
      trustScore:          typeof sessionData.trustScore === 'number'
        ? Math.min(Math.max(sessionData.trustScore, 0), 100)
        : 100,
      verdict:             sessionData.verdict ?? 'N/A',
      totalViolations:     typeof sessionData.totalViolations === 'number' ? sessionData.totalViolations : 0,
      violationBreakdown:  sessionData.violationBreakdown ?? {},
      model:               sessionData.model ?? 'unknown',
    };

    const sessions = SessionHistory._readStore();

    // Prevent duplicate IDs
    const existingIdx = sessions.findIndex((s) => s.id === session.id);
    if (existingIdx !== -1) {
      sessions[existingIdx] = session;
    } else {
      sessions.push(session);
    }

    // FIFO eviction: remove oldest entries that exceed the limit
    while (sessions.length > MAX_SESSIONS) {
      sessions.shift();
    }

    SessionHistory._writeStore(sessions);
    return session;
  }

  /**
   * Retrieves all stored sessions, sorted newest-first by date.
   *
   * @returns {SessionData[]}
   */
  static getSessions() {
    const sessions = SessionHistory._readStore();

    // Sort descending by date (newest first)
    sessions.sort((a, b) => {
      const dateA = new Date(a.date).getTime() || 0;
      const dateB = new Date(b.date).getTime() || 0;
      return dateB - dateA;
    });

    return sessions;
  }

  /**
   * Retrieves a single session by its unique ID.
   *
   * @param {string} id - The session UUID to look up.
   * @returns {SessionData | null} The session, or null if not found.
   */
  static getSession(id) {
    if (!id || typeof id !== 'string') return null;

    const sessions = SessionHistory._readStore();
    return sessions.find((s) => s.id === id) ?? null;
  }

  /**
   * Deletes a specific session by ID.
   *
   * @param {string} id - The session UUID to delete.
   * @returns {boolean} True if a session was deleted, false if not found.
   */
  static deleteSession(id) {
    if (!id || typeof id !== 'string') return false;

    const sessions = SessionHistory._readStore();
    const filtered = sessions.filter((s) => s.id !== id);

    if (filtered.length === sessions.length) {
      return false; // Nothing was removed
    }

    SessionHistory._writeStore(filtered);
    return true;
  }

  /**
   * Removes all stored sessions from localStorage.
   */
  static clearAll() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.error('[SessionHistory] Failed to clear storage:', err);
    }
  }

  /**
   * Returns an estimate of localStorage usage for proctor sessions.
   *
   * @returns {StorageUsage}
   */
  static getStorageUsage() {
    let usedBytes = 0;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        // Each JS char is stored as 2 bytes (UTF-16) in most browsers
        usedBytes = raw.length * 2;
      }
    } catch {
      // localStorage unavailable
    }

    const percentage = ESTIMATED_QUOTA_BYTES > 0
      ? +((usedBytes / ESTIMATED_QUOTA_BYTES) * 100).toFixed(2)
      : 0;

    return {
      used: usedBytes,
      total: ESTIMATED_QUOTA_BYTES,
      percentage,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PRIVATE — STORAGE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Reads the sessions array from localStorage.
   * Returns an empty array on any failure (corrupt data, missing key, etc.).
   *
   * @private
   * @returns {SessionData[]}
   */
  static _readStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        console.warn('[SessionHistory] Corrupt store data — expected array, resetting');
        return [];
      }

      return parsed;
    } catch (err) {
      console.error('[SessionHistory] Failed to read store:', err);
      return [];
    }
  }

  /**
   * Writes the sessions array to localStorage.
   *
   * @private
   * @param {SessionData[]} sessions
   * @throws {Error} If localStorage is full or unavailable.
   */
  static _writeStore(sessions) {
    try {
      const serialized = JSON.stringify(sessions);
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch (err) {
      // Handle QuotaExceededError — try to free space by removing oldest
      if (err?.name === 'QuotaExceededError' && sessions.length > 1) {
        console.warn('[SessionHistory] Storage quota exceeded — evicting oldest sessions');
        const trimmed = sessions.slice(Math.ceil(sessions.length / 2));
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
          return;
        } catch {
          // Still failing — give up
        }
      }
      throw new Error(`Failed to write session history: ${err.message}`);
    }
  }
}
