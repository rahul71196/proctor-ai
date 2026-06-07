/**
 * @fileoverview ProctorAI Trust Score Chart
 * Renders a real-time trust score line chart on a Canvas element.
 * Features smooth bezier curves, gradient fills, threshold indicators,
 * violation markers, and responsive DPI-aware rendering.
 *
 * @module trust-chart
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** @private Chart padding in CSS pixels. */
const PADDING = { top: 20, right: 20, bottom: 40, left: 50 };

/** @private Default line color (cyan). */
const LINE_COLOR = '#22d3ee';

/** @private Color for the green threshold line (score ≥ 80). */
const THRESHOLD_GREEN = '#4ade80';

/** @private Color for the yellow threshold line (score ≥ 50). */
const THRESHOLD_YELLOW = '#facc15';

/** @private Color for violation dots. */
const VIOLATION_DOT_COLOR = '#ef4444';

/** @private Grid line color. */
const GRID_COLOR = 'rgba(255, 255, 255, 0.06)';

/** @private Axis label color. */
const LABEL_COLOR = 'rgba(255, 255, 255, 0.5)';

/** @private Font used for labels and values. */
const FONT_FAMILY = "'Inter', 'Segoe UI', system-ui, sans-serif";

/** @private Maximum number of data points before oldest are evicted. */
const MAX_DATA_POINTS = 300;

/** @private Duration (ms) of the draw-in animation per new point. */
const ANIMATION_DURATION_MS = 300;

// ─── Type Definitions ────────────────────────────────────────────────────────

/**
 * @typedef {Object} DataPoint
 * @property {number}  score      - Trust score (0–100)
 * @property {number}  timestamp  - Unix timestamp in ms
 * @property {boolean} violation  - Whether this point represents a violation
 */

/**
 * @typedef {Object} TrustChartOptions
 * @property {string}  [lineColor]            - Main line color (default: cyan)
 * @property {number}  [lineWidth=2.5]        - Line thickness in CSS pixels
 * @property {boolean} [showGrid=true]        - Whether to draw grid lines
 * @property {boolean} [showThresholds=true]  - Whether to draw threshold lines
 * @property {boolean} [animate=true]         - Whether to animate new data points
 */

// ─── TrustChart ──────────────────────────────────────────────────────────────

export class TrustChart {
  /**
   * Creates a new TrustChart bound to the given canvas element.
   *
   * @param {HTMLCanvasElement} canvasElement - The canvas to render into.
   * @param {TrustChartOptions} [options={}]
   * @throws {Error} If canvasElement is not a valid HTMLCanvasElement.
   */
  constructor(canvasElement, options = {}) {
    if (!(canvasElement instanceof HTMLCanvasElement)) {
      throw new Error('TrustChart requires an HTMLCanvasElement');
    }

    /** @private */ this._canvas  = canvasElement;
    /** @private */ this._ctx     = /** @type {CanvasRenderingContext2D} */ (
      canvasElement.getContext('2d')
    );

    // Options
    /** @private */ this._lineColor      = options.lineColor      ?? LINE_COLOR;
    /** @private */ this._lineWidth      = options.lineWidth      ?? 2.5;
    /** @private */ this._showGrid       = options.showGrid       ?? true;
    /** @private */ this._showThresholds = options.showThresholds ?? true;
    /** @private */ this._animate        = options.animate        ?? true;

    // ── Data ─────────────────────────────────────────────────────────────
    /** @private @type {DataPoint[]} */
    this._dataPoints = [];

    // ── Animation state ──────────────────────────────────────────────────
    /** @private */ this._animationProgress = 1;
    /** @private */ this._animationFrameId  = 0;
    /** @private */ this._animationStart    = 0;

    // ── DPI & resize ─────────────────────────────────────────────────────
    /** @private */ this._dpr = window.devicePixelRatio || 1;

    /** @private */
    this._resizeObserver = new ResizeObserver(() => this._handleResize());
    this._resizeObserver.observe(this._canvas);

    // Initial sizing
    this._handleResize();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Adds a new data point to the chart.
   *
   * @param {number}  score                - Trust score (0–100)
   * @param {number}  [timestamp=Date.now()] - Unix timestamp in ms
   * @param {boolean} [isViolation=false]  - Mark this point as a violation
   */
  addDataPoint(score, timestamp = Date.now(), isViolation = false) {
    const clampedScore = Math.min(Math.max(score, 0), 100);

    this._dataPoints.push({
      score: clampedScore,
      timestamp,
      violation: isViolation,
    });

    // FIFO eviction
    if (this._dataPoints.length > MAX_DATA_POINTS) {
      this._dataPoints.splice(0, this._dataPoints.length - MAX_DATA_POINTS);
    }

    if (this._animate) {
      this._startAnimation();
    } else {
      this.render();
    }
  }

  /**
   * Renders the chart (full redraw).
   */
  render() {
    const ctx = this._ctx;
    const w = this._canvas.width;
    const h = this._canvas.height;

    // Clear (transparent background)
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.scale(this._dpr, this._dpr);

    const cssW = w / this._dpr;
    const cssH = h / this._dpr;

    const plotX = PADDING.left;
    const plotY = PADDING.top;
    const plotW = cssW - PADDING.left - PADDING.right;
    const plotH = cssH - PADDING.top - PADDING.bottom;

    if (plotW <= 0 || plotH <= 0) {
      ctx.restore();
      return;
    }

    // Draw layers
    if (this._showGrid) {
      this._drawGrid(ctx, plotX, plotY, plotW, plotH);
    }

    if (this._showThresholds) {
      this._drawThresholds(ctx, plotX, plotY, plotW, plotH);
    }

    this._drawYAxis(ctx, plotX, plotY, plotW, plotH);
    this._drawXAxis(ctx, plotX, plotY, plotW, plotH);

    if (this._dataPoints.length >= 2) {
      this._drawCurve(ctx, plotX, plotY, plotW, plotH);
      this._drawGradientFill(ctx, plotX, plotY, plotW, plotH);
    }

    this._drawViolationDots(ctx, plotX, plotY, plotW, plotH);
    this._drawLatestScore(ctx, plotX, plotY, plotW, plotH);

    ctx.restore();
  }

  /**
   * Clears all data points and redraws the empty chart.
   */
  clear() {
    this._dataPoints = [];
    this._cancelAnimation();
    this.render();
  }

  /**
   * Returns the chart contents as a base64-encoded PNG string.
   *
   * @returns {string} Data URL of the chart image.
   */
  getImageData() {
    // Ensure latest render
    this.render();
    return this._canvas.toDataURL('image/png');
  }

  /**
   * Tears down the chart: disconnects the ResizeObserver and cancels
   * any running animation. Call this before discarding the instance.
   */
  destroy() {
    this._resizeObserver.disconnect();
    this._cancelAnimation();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PRIVATE — RESIZE & ANIMATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handles canvas resize: adjusts the internal bitmap to match the
   * display size × devicePixelRatio for crisp rendering.
   *
   * @private
   */
  _handleResize() {
    this._dpr = window.devicePixelRatio || 1;
    const rect = this._canvas.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) return;

    this._canvas.width  = Math.round(rect.width  * this._dpr);
    this._canvas.height = Math.round(rect.height * this._dpr);

    this.render();
  }

  /**
   * Starts the draw-in animation for a newly added point.
   * @private
   */
  _startAnimation() {
    this._cancelAnimation();
    this._animationProgress = 0;
    this._animationStart = performance.now();

    const tick = (now) => {
      const elapsed = now - this._animationStart;
      this._animationProgress = Math.min(elapsed / ANIMATION_DURATION_MS, 1);
      this.render();

      if (this._animationProgress < 1) {
        this._animationFrameId = requestAnimationFrame(tick);
      }
    };

    this._animationFrameId = requestAnimationFrame(tick);
  }

  /**
   * Cancels any in-progress animation frame.
   * @private
   */
  _cancelAnimation() {
    if (this._animationFrameId) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = 0;
    }
    this._animationProgress = 1;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PRIVATE — COORDINATE MAPPING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Maps a data point index to its (x, y) canvas position within the plot area.
   *
   * @private
   * @param {number} index  - Index in the data points array
   * @param {number} plotX  - Plot area left edge
   * @param {number} plotY  - Plot area top edge
   * @param {number} plotW  - Plot area width
   * @param {number} plotH  - Plot area height
   * @returns {{ x: number, y: number }}
   */
  _pointToCanvas(index, plotX, plotY, plotW, plotH) {
    const total = this._dataPoints.length;
    const point = this._dataPoints[index];

    const x = total === 1
      ? plotX + plotW / 2
      : plotX + (index / (total - 1)) * plotW;

    const y = plotY + plotH - (point.score / 100) * plotH;

    // Apply animation easing to the latest point
    if (index === total - 1 && this._animationProgress < 1) {
      const prevY = index > 0
        ? plotY + plotH - (this._dataPoints[index - 1].score / 100) * plotH
        : y;
      const eased = this._easeOutCubic(this._animationProgress);
      return { x, y: prevY + (y - prevY) * eased };
    }

    return { x, y };
  }

  /**
   * Cubic ease-out function.
   * @private
   * @param {number} t - Progress (0–1)
   * @returns {number}
   */
  _easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PRIVATE — DRAWING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Draws subtle background grid lines.
   * @private
   */
  _drawGrid(ctx, plotX, plotY, plotW, plotH) {
    ctx.save();
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;

    // Horizontal grid lines (every 20 score units)
    for (let score = 0; score <= 100; score += 20) {
      const y = plotY + plotH - (score / 100) * plotH;
      ctx.beginPath();
      ctx.moveTo(plotX, y);
      ctx.lineTo(plotX + plotW, y);
      ctx.stroke();
    }

    // Vertical grid lines (up to 6)
    const vLines = Math.min(this._dataPoints.length, 6);
    if (vLines >= 2) {
      for (let i = 0; i < vLines; i++) {
        const x = plotX + (i / (vLines - 1)) * plotW;
        ctx.beginPath();
        ctx.moveTo(x, plotY);
        ctx.lineTo(x, plotY + plotH);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  /**
   * Draws horizontal dashed threshold lines at 80 (green) and 50 (yellow).
   * @private
   */
  _drawThresholds(ctx, plotX, plotY, plotW, plotH) {
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;

    // 80-score threshold (green)
    const y80 = plotY + plotH - (80 / 100) * plotH;
    ctx.strokeStyle = THRESHOLD_GREEN;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(plotX, y80);
    ctx.lineTo(plotX + plotW, y80);
    ctx.stroke();

    // 50-score threshold (yellow)
    const y50 = plotY + plotH - (50 / 100) * plotH;
    ctx.strokeStyle = THRESHOLD_YELLOW;
    ctx.beginPath();
    ctx.moveTo(plotX, y50);
    ctx.lineTo(plotX + plotW, y50);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /**
   * Draws Y-axis labels (0, 20, 40, 60, 80, 100).
   * @private
   */
  _drawYAxis(ctx, plotX, plotY, _plotW, plotH) {
    ctx.save();
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = `11px ${FONT_FAMILY}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let score = 0; score <= 100; score += 20) {
      const y = plotY + plotH - (score / 100) * plotH;
      ctx.fillText(String(score), plotX - 8, y);
    }

    ctx.restore();
  }

  /**
   * Draws X-axis time labels in MM:SS format.
   * @private
   */
  _drawXAxis(ctx, plotX, plotY, plotW, plotH) {
    if (this._dataPoints.length < 2) return;

    ctx.save();
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = `10px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const labelY = plotY + plotH + 8;
    const firstTs = this._dataPoints[0].timestamp;

    // Show up to 6 evenly-spaced labels
    const labelCount = Math.min(this._dataPoints.length, 6);
    for (let i = 0; i < labelCount; i++) {
      const idx = labelCount === 1
        ? 0
        : Math.round((i / (labelCount - 1)) * (this._dataPoints.length - 1));
      const point = this._dataPoints[idx];
      const elapsed = Math.max(0, (point.timestamp - firstTs) / 1_000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = Math.floor(elapsed % 60);
      const label = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

      const x = plotX + (idx / (this._dataPoints.length - 1)) * plotW;
      ctx.fillText(label, x, labelY);
    }

    ctx.restore();
  }

  /**
   * Draws the smooth bezier curve connecting all data points.
   * @private
   */
  _drawCurve(ctx, plotX, plotY, plotW, plotH) {
    if (this._dataPoints.length < 2) return;

    ctx.save();
    ctx.strokeStyle = this._lineColor;
    ctx.lineWidth = this._lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const path = this._buildBezierPath(plotX, plotY, plotW, plotH);
    ctx.beginPath();

    const first = this._pointToCanvas(0, plotX, plotY, plotW, plotH);
    ctx.moveTo(first.x, first.y);

    for (const segment of path) {
      ctx.bezierCurveTo(
        segment.cp1x, segment.cp1y,
        segment.cp2x, segment.cp2y,
        segment.x, segment.y,
      );
    }

    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draws the gradient fill under the curve (line color to transparent).
   * @private
   */
  _drawGradientFill(ctx, plotX, plotY, plotW, plotH) {
    if (this._dataPoints.length < 2) return;

    ctx.save();

    const gradient = ctx.createLinearGradient(0, plotY, 0, plotY + plotH);
    gradient.addColorStop(0, this._hexToRgba(this._lineColor, 0.3));
    gradient.addColorStop(1, this._hexToRgba(this._lineColor, 0.0));

    ctx.fillStyle = gradient;

    const path = this._buildBezierPath(plotX, plotY, plotW, plotH);
    ctx.beginPath();

    const first = this._pointToCanvas(0, plotX, plotY, plotW, plotH);
    ctx.moveTo(first.x, first.y);

    for (const segment of path) {
      ctx.bezierCurveTo(
        segment.cp1x, segment.cp1y,
        segment.cp2x, segment.cp2y,
        segment.x, segment.y,
      );
    }

    // Close the fill area down to the baseline
    const last = this._pointToCanvas(this._dataPoints.length - 1, plotX, plotY, plotW, plotH);
    ctx.lineTo(last.x, plotY + plotH);
    ctx.lineTo(first.x, plotY + plotH);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  /**
   * Draws red dots at data points flagged as violations.
   * @private
   */
  _drawViolationDots(ctx, plotX, plotY, plotW, plotH) {
    ctx.save();

    for (let i = 0; i < this._dataPoints.length; i++) {
      if (!this._dataPoints[i].violation) continue;

      const { x, y } = this._pointToCanvas(i, plotX, plotY, plotW, plotH);

      // Outer glow
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
      ctx.fill();

      // Inner dot
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = VIOLATION_DOT_COLOR;
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Highlights the latest score value with a label and a filled dot.
   * @private
   */
  _drawLatestScore(ctx, plotX, plotY, plotW, plotH) {
    if (this._dataPoints.length === 0) return;

    const lastIdx = this._dataPoints.length - 1;
    const { x, y } = this._pointToCanvas(lastIdx, plotX, plotY, plotW, plotH);
    const score = this._dataPoints[lastIdx].score;

    ctx.save();

    // Outer glow ring
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = this._hexToRgba(this._lineColor, 0.25);
    ctx.fill();

    // Filled dot
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = this._lineColor;
    ctx.fill();

    // Score label
    ctx.font = `bold 12px ${FONT_FAMILY}`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(Math.round(score).toString(), x, y - 12);

    ctx.restore();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PRIVATE — BEZIER PATH COMPUTATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Builds cubic bezier control points for smooth curve interpolation
   * between all data points. Uses a Catmull-Rom → Bezier conversion.
   *
   * @private
   * @param {number} plotX
   * @param {number} plotY
   * @param {number} plotW
   * @param {number} plotH
   * @returns {Array<{ cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number }>}
   */
  _buildBezierPath(plotX, plotY, plotW, plotH) {
    const points = [];
    for (let i = 0; i < this._dataPoints.length; i++) {
      points.push(this._pointToCanvas(i, plotX, plotY, plotW, plotH));
    }

    /** @type {Array<{ cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number }>} */
    const segments = [];
    const tension = 0.3;

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];

      const cp1x = p1.x + (p2.x - p0.x) * tension;
      const cp1y = p1.y + (p2.y - p0.y) * tension;
      const cp2x = p2.x - (p3.x - p1.x) * tension;
      const cp2y = p2.y - (p3.y - p1.y) * tension;

      segments.push({ cp1x, cp1y, cp2x, cp2y, x: p2.x, y: p2.y });
    }

    return segments;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PRIVATE — UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Converts a hex color string to an rgba() CSS value.
   *
   * @private
   * @param {string} hex   - Hex color (e.g. '#22d3ee')
   * @param {number} alpha - Alpha channel (0–1)
   * @returns {string}
   */
  _hexToRgba(hex, alpha) {
    const cleaned = hex.replace('#', '');
    const r = parseInt(cleaned.substring(0, 2), 16);
    const g = parseInt(cleaned.substring(2, 4), 16);
    const b = parseInt(cleaned.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}
