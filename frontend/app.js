/* ══════════════════════════════════════════════════════════════
   ProctorAI — Application Controller
   AI Interview Integrity Monitor
   ══════════════════════════════════════════════════════════════ */

import { ProctorEngine } from './proctor-engine.js';
import { VIOLATION_TYPES } from './detection-types.js';

// ── Arc Geometry ──────────────────────────────────────────────
const GAUGE_ARC_LENGTH = 251.33; // Circumference of the semicircular arc

// ── Application State ────────────────────────────────────────
const state = {
  apiKey: localStorage.getItem('proctor_api_key') || '',
  model: 'gemini-2.5-flash',
  frameInterval: 4000,
  candidateName: '',
  interviewPosition: '',
  engine: null,
  isMonitoring: false,
  violations: [],
  sessionStartTime: null,
  timerInterval: null,
  cameraStream: null,
  currentView: 'setup',
  trustScore: 100,
  frameCount: 0,
};

// ── DOM References ───────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {};

function cacheElements() {
  // Topbar
  els.navPills = $$('.nav-pill');
  els.modelSelector = $('#model-selector');

  // Setup
  els.apiKeyInput = $('#api-key-input');
  els.btnToggleKey = $('#btn-toggle-key');
  els.frameInterval = $('#frame-interval');
  els.frameIntervalValue = $('#frame-interval-value');
  els.candidateName = $('#candidate-name');
  els.interviewPosition = $('#interview-position');
  els.btnStart = $('#btn-start');
  els.cameraPreview = $('#camera-preview');
  els.btnTestCamera = $('#btn-test-camera');
  els.permCamera = $('#perm-camera');
  els.permMic = $('#perm-mic');

  // Monitor
  els.monitorVideo = $('#monitor-video');
  els.monitorCanvas = $('#monitor-canvas');
  els.gaugeArc = $('#gauge-arc');
  els.trustScoreNum = $('#trust-score-num');
  els.trustScoreLabel = $('#trust-score-label');
  els.sessionTimer = $('#session-timer');
  els.monitorStatus = $('#monitor-status');
  els.metricFaces = $('#metric-faces');
  els.metricGaze = $('#metric-gaze');
  els.metricTabs = $('#metric-tabs');
  els.metricAudio = $('#metric-audio');
  els.violationTimeline = $('#violation-timeline');
  els.sessionLog = $('#session-log');
  els.btnStop = $('#btn-stop');

  // Report
  els.reportCandidateInfo = $('#report-candidate-info');
  els.reportTimestamp = $('#report-timestamp');
  els.reportFinalScore = $('#report-final-score');
  els.reportVerdict = $('#report-verdict');
  els.reportBreakdownBody = $('#report-breakdown-body');
  els.reportTimelineVisual = $('#report-timeline-visual');
  els.btnExportJSON = $('#btn-export-json');
  els.btnExportText = $('#btn-export-text');

  // Overlays
  els.loadingOverlay = $('#loading-overlay');
  els.loaderStatus = $('#loader-status');
  els.alertOverlay = $('#alert-overlay');
  els.alertMessage = $('#alert-message');
  els.toastContainer = $('#toast-container');

  // Views
  els.views = {
    setup: $('#view-setup'),
    monitor: $('#view-monitor'),
    report: $('#view-report'),
  };
}

// ══════════════════════════════════════════════════════════════
//  INITIALIZATION
// ══════════════════════════════════════════════════════════════

function init() {
  cacheElements();
  restoreState();
  bindEvents();
  addLogEntry('ProctorAI initialized — ready for configuration', 'info');
}

function restoreState() {
  if (state.apiKey) {
    els.apiKeyInput.value = state.apiKey;
  }
}

// ══════════════════════════════════════════════════════════════
//  EVENT BINDING
// ══════════════════════════════════════════════════════════════

function bindEvents() {
  // Navigation
  els.navPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      const view = pill.dataset.view;
      if (view) switchView(view);
    });
  });

  // Model selector
  els.modelSelector.addEventListener('change', (e) => {
    state.model = e.target.value;
    showToast(`Model switched to ${state.model}`, 'info');
  });

  // API Key
  els.apiKeyInput.addEventListener('input', (e) => {
    state.apiKey = e.target.value.trim();
    localStorage.setItem('proctor_api_key', state.apiKey);
  });

  els.btnToggleKey.addEventListener('click', () => {
    const input = els.apiKeyInput;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    els.btnToggleKey.title = isPassword ? 'Hide key' : 'Show key';
  });

  // Frame Interval
  els.frameInterval.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    state.frameInterval = val * 1000;
    els.frameIntervalValue.textContent = `${val}s`;
  });

  // Candidate info
  els.candidateName.addEventListener('input', (e) => {
    state.candidateName = e.target.value.trim();
  });

  els.interviewPosition.addEventListener('input', (e) => {
    state.interviewPosition = e.target.value.trim();
  });

  // Camera test
  els.btnTestCamera.addEventListener('click', testCamera);

  // Start / Stop
  els.btnStart.addEventListener('click', startMonitoring);
  els.btnStop.addEventListener('click', stopMonitoring);

  // Export
  els.btnExportJSON.addEventListener('click', exportReportJSON);
  els.btnExportText.addEventListener('click', exportReportText);

  // Tab visibility detection
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

// ══════════════════════════════════════════════════════════════
//  VIEW NAVIGATION
// ══════════════════════════════════════════════════════════════

function switchView(name) {
  if (!els.views[name]) return;

  state.currentView = name;

  // Update nav pills
  els.navPills.forEach((pill) => {
    pill.classList.toggle('active', pill.dataset.view === name);
  });

  // Update views
  Object.entries(els.views).forEach(([key, view]) => {
    view.classList.toggle('active', key === name);
  });
}

// ══════════════════════════════════════════════════════════════
//  CAMERA
// ══════════════════════════════════════════════════════════════

async function testCamera() {
  els.btnTestCamera.disabled = true;
  els.btnTestCamera.textContent = 'Requesting…';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: true,
    });

    state.cameraStream = stream;
    els.cameraPreview.srcObject = stream;
    els.cameraPreview.classList.add('active');

    // Update permission indicators
    updatePermission(els.permCamera, 'granted', 'Granted');
    updatePermission(els.permMic, 'granted', 'Granted');

    showToast('Camera and microphone access granted', 'success');
    addLogEntry('Camera test successful — permissions granted', 'success');
  } catch (err) {
    console.error('Camera access error:', err);

    if (err.name === 'NotAllowedError') {
      updatePermission(els.permCamera, 'denied', 'Denied');
      updatePermission(els.permMic, 'denied', 'Denied');
      showToast('Camera permission denied — please allow access', 'error');
    } else if (err.name === 'NotFoundError') {
      updatePermission(els.permCamera, 'denied', 'Not found');
      showToast('No camera device found', 'error');
    } else {
      showToast(`Camera error: ${err.message}`, 'error');
    }

    addLogEntry(`Camera test failed: ${err.message}`, 'error');
  } finally {
    els.btnTestCamera.disabled = false;
    els.btnTestCamera.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      Test Camera
    `;
  }
}

function updatePermission(el, status, label) {
  el.classList.remove('granted', 'denied');
  el.classList.add(status);
  el.querySelector('.perm-status').textContent = label;
}

// ══════════════════════════════════════════════════════════════
//  MONITORING
// ══════════════════════════════════════════════════════════════

async function startMonitoring() {
  // Validation
  if (!state.apiKey) {
    showToast('Please enter your Gemini API key', 'error');
    els.apiKeyInput.focus();
    return;
  }

  if (!state.candidateName) {
    showToast('Please enter the candidate name', 'warning');
    els.candidateName.focus();
    return;
  }

  // Show loader
  showLoading('Initializing ProctorAI engine…');

  try {
    // Get camera if not already active
    if (!state.cameraStream) {
      updateLoaderStatus('Requesting camera access…');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: true,
      });
      state.cameraStream = stream;
    }

    // Set up monitor video
    els.monitorVideo.srcObject = state.cameraStream;

    // Reset state for new session
    state.violations = [];
    state.trustScore = 100;
    state.frameCount = 0;
    state.sessionStartTime = Date.now();
    state.isMonitoring = true;

    // Reset UI
    resetMonitorUI();

    // Create engine
    updateLoaderStatus('Starting AI analysis engine…');

    try {
      state.engine = new ProctorEngine({
        apiKey: state.apiKey,
        model: state.model,
        frameInterval: state.frameInterval,
        videoElement: els.monitorVideo,
        canvasElement: els.monitorCanvas,
        candidateName: state.candidateName,
        interviewPosition: state.interviewPosition,
        onViolation: handleViolation,
        onAnalysis: handleAnalysis,
        onTrustScoreUpdate: handleTrustScoreUpdate,
        onStatusChange: handleStatusChange,
        onError: handleEngineError,
      });

      await state.engine.start();
    } catch (engineErr) {
      console.warn('ProctorEngine not available, running in demo mode:', engineErr.message);
      addLogEntry('Engine module not loaded — running in standalone UI mode', 'warning');
    }

    // Start session timer
    state.timerInterval = setInterval(updateSessionTimer, 1000);

    // Switch to monitor view
    switchView('monitor');
    hideLoading();

    addLogEntry(`Monitoring started for ${state.candidateName}`, 'success');
    showToast('Monitoring session started', 'success');
    updateStatusPill('Monitoring', 'active');
  } catch (err) {
    hideLoading();
    console.error('Start monitoring error:', err);
    showToast(`Failed to start monitoring: ${err.message}`, 'error');
    addLogEntry(`Failed to start: ${err.message}`, 'error');
  }
}

function stopMonitoring() {
  state.isMonitoring = false;

  // Stop engine
  if (state.engine) {
    try {
      state.engine.stop();
    } catch (e) {
      console.warn('Engine stop error:', e);
    }
    state.engine = null;
  }

  // Stop timer
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  // Stop camera
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
    state.cameraStream = null;
  }

  addLogEntry('Monitoring session ended', 'info');
  showToast('Monitoring stopped — generating report', 'info');

  // Generate report and switch
  renderReport();
  switchView('report');
}

function resetMonitorUI() {
  // Reset metrics
  els.metricFaces.textContent = '0';
  els.metricGaze.textContent = '0';
  els.metricTabs.textContent = '0';
  els.metricAudio.textContent = '0';

  // Reset gauge
  updateTrustGauge(100);

  // Reset timer
  els.sessionTimer.textContent = '00:00';

  // Clear timeline
  els.violationTimeline.innerHTML = `
    <div class="timeline-empty">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 12 15 16 10"/></svg>
      <p>No violations detected yet</p>
    </div>
  `;

  // Clear log (but keep init message)
  els.sessionLog.innerHTML = '';
}

// ══════════════════════════════════════════════════════════════
//  ENGINE EVENT HANDLERS
// ══════════════════════════════════════════════════════════════

function handleViolation(violation) {
  if (!state.isMonitoring) return;

  state.violations.push({
    ...violation,
    timestamp: Date.now(),
    sessionTime: getSessionElapsed(),
  });

  addViolationToTimeline(violation);
  updateStats();

  // Flash alert for critical violations
  if (violation.severity === 'critical') {
    showAlert(violation.message || `Critical: ${violation.type}`);
  }

  addLogEntry(`Violation: ${violation.type} (${violation.severity})`, 'warning');
}

function handleAnalysis(result) {
  if (!state.isMonitoring) return;
  state.frameCount++;
  addLogEntry(`Frame #${state.frameCount} analyzed`, 'info');
}

function handleTrustScoreUpdate(score) {
  if (!state.isMonitoring) return;
  state.trustScore = score;
  updateTrustGauge(score);
}

function handleStatusChange(status) {
  updateStatusPill(status.label || status, status.level || 'active');
}

function handleEngineError(error) {
  console.error('Engine error:', error);
  addLogEntry(`Engine error: ${error.message || error}`, 'error');
  showToast(`Analysis error: ${error.message || error}`, 'error');
}

// ══════════════════════════════════════════════════════════════
//  TRUST GAUGE
// ══════════════════════════════════════════════════════════════

function updateTrustGauge(score) {
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const offset = GAUGE_ARC_LENGTH * (1 - clampedScore / 100);

  // Update arc
  els.gaugeArc.style.strokeDashoffset = offset;

  // Update color
  let gradientId, label;
  if (clampedScore >= 80) {
    gradientId = 'url(#gauge-green)';
    label = 'Excellent';
  } else if (clampedScore >= 50) {
    gradientId = 'url(#gauge-yellow)';
    label = 'Caution';
  } else {
    gradientId = 'url(#gauge-red)';
    label = 'Critical';
  }

  els.gaugeArc.setAttribute('stroke', gradientId);
  els.trustScoreLabel.textContent = label;

  // Animate number
  animateCounter(els.trustScoreNum, clampedScore);
}

// ══════════════════════════════════════════════════════════════
//  VIOLATION TIMELINE
// ══════════════════════════════════════════════════════════════

function addViolationToTimeline(violation) {
  // Remove empty state
  const empty = els.violationTimeline.querySelector('.timeline-empty');
  if (empty) empty.remove();

  const severity = violation.severity || 'low';
  const time = formatTime(getSessionElapsed());
  const type = violation.type || 'Unknown';
  const detail = violation.detail || violation.message || '';

  const item = document.createElement('div');
  item.className = `timeline-item severity-${severity}`;
  item.innerHTML = `
    <span class="timeline-time">${time}</span>
    <div class="timeline-content">
      <div class="timeline-type">${escapeHTML(type)}</div>
      <div class="timeline-detail">${escapeHTML(detail)}</div>
    </div>
    <span class="timeline-severity-badge badge-${severity}">${severity}</span>
  `;

  // Prepend (newest first)
  els.violationTimeline.prepend(item);

  // Limit visible items
  const items = els.violationTimeline.querySelectorAll('.timeline-item');
  if (items.length > 100) {
    items[items.length - 1].remove();
  }
}

// ══════════════════════════════════════════════════════════════
//  SESSION LOG
// ══════════════════════════════════════════════════════════════

function addLogEntry(message, type = 'info') {
  // Remove empty state
  const empty = els.sessionLog?.querySelector('.log-empty');
  if (empty) empty.remove();

  if (!els.sessionLog) return;

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.innerHTML = `
    <span class="log-time">${timeStr}</span>
    <span class="log-message">${escapeHTML(message)}</span>
  `;

  els.sessionLog.prepend(entry);

  // Limit entries
  const entries = els.sessionLog.querySelectorAll('.log-entry');
  if (entries.length > 200) {
    entries[entries.length - 1].remove();
  }
}

// ══════════════════════════════════════════════════════════════
//  STATS
// ══════════════════════════════════════════════════════════════

function updateStats() {
  const counts = { faces: 0, gaze: 0, tabs: 0, audio: 0 };

  state.violations.forEach((v) => {
    const t = (v.type || '').toLowerCase();
    if (t.includes('face') || t.includes('person') || t.includes('multiple')) {
      counts.faces++;
    } else if (t.includes('gaze') || t.includes('look') || t.includes('eye')) {
      counts.gaze++;
    } else if (t.includes('tab') || t.includes('switch') || t.includes('window') || t.includes('visibility')) {
      counts.tabs++;
    } else if (t.includes('audio') || t.includes('voice') || t.includes('speech') || t.includes('sound')) {
      counts.audio++;
    } else {
      // Default to gaze if unclear
      counts.gaze++;
    }
  });

  animateCounter(els.metricFaces, counts.faces);
  animateCounter(els.metricGaze, counts.gaze);
  animateCounter(els.metricTabs, counts.tabs);
  animateCounter(els.metricAudio, counts.audio);
}

// ══════════════════════════════════════════════════════════════
//  SESSION TIMER
// ══════════════════════════════════════════════════════════════

function updateSessionTimer() {
  if (!state.sessionStartTime) return;
  const elapsed = getSessionElapsed();
  els.sessionTimer.textContent = formatTime(elapsed);
}

function getSessionElapsed() {
  if (!state.sessionStartTime) return 0;
  return Math.floor((Date.now() - state.sessionStartTime) / 1000);
}

function formatTime(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// ══════════════════════════════════════════════════════════════
//  TAB VISIBILITY
// ══════════════════════════════════════════════════════════════

function handleVisibilityChange() {
  if (!state.isMonitoring) return;

  if (document.hidden) {
    handleViolation({
      type: 'Tab Switch',
      severity: 'high',
      detail: 'Candidate switched away from the interview tab',
      message: 'Tab switch detected',
    });
  } else {
    addLogEntry('Candidate returned to interview tab', 'info');
  }
}

// ══════════════════════════════════════════════════════════════
//  STATUS PILL
// ══════════════════════════════════════════════════════════════

function updateStatusPill(text, level) {
  els.monitorStatus.className = 'status-pill';

  if (level === 'warning') {
    els.monitorStatus.classList.add('warning');
  } else if (level === 'critical') {
    els.monitorStatus.classList.add('critical');
  }

  els.monitorStatus.innerHTML = `<span class="status-dot"></span>${escapeHTML(text)}`;
}

// ══════════════════════════════════════════════════════════════
//  REPORT GENERATION
// ══════════════════════════════════════════════════════════════

function renderReport() {
  const sessionDuration = getSessionElapsed();
  const totalViolations = state.violations.length;

  // Header info
  els.reportCandidateInfo.textContent =
    `${state.candidateName || 'Unknown'} — ${state.interviewPosition || 'N/A'}`;

  const now = new Date();
  els.reportTimestamp.textContent = now.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  // Final score
  const finalScore = Math.round(state.trustScore);
  els.reportFinalScore.textContent = finalScore;

  let verdict;
  if (finalScore >= 80) verdict = 'Passed — Low Risk';
  else if (finalScore >= 50) verdict = 'Review Required — Moderate Risk';
  else verdict = 'Failed — High Risk';

  els.reportVerdict.textContent = verdict;

  // Apply score color
  els.reportFinalScore.style.background =
    finalScore >= 80
      ? 'linear-gradient(135deg, #10b981, #34d399)'
      : finalScore >= 50
        ? 'linear-gradient(135deg, #f59e0b, #fbbf24)'
        : 'linear-gradient(135deg, #dc2626, #ef4444)';
  els.reportFinalScore.style.webkitBackgroundClip = 'text';
  els.reportFinalScore.style.backgroundClip = 'text';
  els.reportFinalScore.style.webkitTextFillColor = 'transparent';

  // Breakdown table
  const grouped = {};
  state.violations.forEach((v) => {
    const type = v.type || 'Unknown';
    if (!grouped[type]) {
      grouped[type] = { count: 0, severity: v.severity || 'low', impacts: [] };
    }
    grouped[type].count++;
    if (v.detail) grouped[type].impacts.push(v.detail);
  });

  if (Object.keys(grouped).length === 0) {
    els.reportBreakdownBody.innerHTML = `
      <tr class="empty-row"><td colspan="4">No violations recorded</td></tr>
    `;
  } else {
    els.reportBreakdownBody.innerHTML = Object.entries(grouped)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([type, data]) => {
        const severityBadge = `<span class="timeline-severity-badge badge-${data.severity}">${data.severity}</span>`;
        const impact = data.count > 1
          ? `-${Math.round(data.count * getSeverityWeight(data.severity))} pts`
          : `-${getSeverityWeight(data.severity)} pts`;
        return `
          <tr>
            <td>${escapeHTML(type)}</td>
            <td style="font-family:var(--font-mono);font-weight:700">${data.count}</td>
            <td>${severityBadge}</td>
            <td style="font-family:var(--font-mono);color:var(--color-critical)">${impact}</td>
          </tr>
        `;
      })
      .join('');
  }

  // Timeline visualization
  if (state.violations.length > 0 && sessionDuration > 0) {
    const barHTML = state.violations
      .map((v) => {
        const pct = Math.min(100, ((v.sessionTime || 0) / sessionDuration) * 100);
        const sev = v.severity || 'low';
        return `<div class="timeline-marker marker-${sev}" style="left:${pct}%" title="${escapeHTML(v.type || '')} at ${formatTime(v.sessionTime || 0)}"></div>`;
      })
      .join('');

    els.reportTimelineVisual.innerHTML = `
      <div class="report-timeline-bar">${barHTML}</div>
    `;
  } else {
    els.reportTimelineVisual.innerHTML = `<p class="timeline-empty-text">No violations to visualize</p>`;
  }
}

function getSeverityWeight(severity) {
  switch (severity) {
    case 'critical': return 15;
    case 'high': return 10;
    case 'medium': return 5;
    case 'low': return 2;
    default: return 3;
  }
}

// ══════════════════════════════════════════════════════════════
//  EXPORT
// ══════════════════════════════════════════════════════════════

function exportReportJSON() {
  const report = buildReportData();
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `proctor-report-${sanitizeFilename(state.candidateName)}.json`);
  showToast('Report exported as JSON', 'success');
}

function exportReportText() {
  const report = buildReportData();

  const lines = [
    '═══════════════════════════════════════════════',
    '  ProctorAI — Session Report',
    '═══════════════════════════════════════════════',
    '',
    `Candidate:  ${report.candidate}`,
    `Position:   ${report.position}`,
    `Date:       ${report.date}`,
    `Duration:   ${report.duration}`,
    `Model:      ${report.model}`,
    '',
    '───────────────────────────────────────────────',
    `  TRUST SCORE: ${report.trustScore}/100`,
    `  VERDICT:     ${report.verdict}`,
    '───────────────────────────────────────────────',
    '',
    `Total Violations: ${report.totalViolations}`,
    '',
  ];

  if (report.breakdown.length > 0) {
    lines.push('Violation Breakdown:');
    report.breakdown.forEach((b) => {
      lines.push(`  • ${b.type}: ${b.count} (${b.severity})`);
    });
    lines.push('');
  }

  if (report.violations.length > 0) {
    lines.push('Detailed Timeline:');
    report.violations.forEach((v, i) => {
      lines.push(`  ${i + 1}. [${formatTime(v.sessionTime || 0)}] ${v.type} — ${v.severity}`);
      if (v.detail) lines.push(`     ${v.detail}`);
    });
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════');
  lines.push('  Generated by ProctorAI v1.0');
  lines.push('═══════════════════════════════════════════════');

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  downloadBlob(blob, `proctor-report-${sanitizeFilename(state.candidateName)}.txt`);
  showToast('Report exported as text', 'success');
}

function buildReportData() {
  const sessionDuration = getSessionElapsed();

  const grouped = {};
  state.violations.forEach((v) => {
    const type = v.type || 'Unknown';
    if (!grouped[type]) grouped[type] = { type, count: 0, severity: v.severity || 'low' };
    grouped[type].count++;
  });

  return {
    version: '1.0',
    candidate: state.candidateName || 'Unknown',
    position: state.interviewPosition || 'N/A',
    date: new Date().toISOString(),
    duration: formatTime(sessionDuration),
    durationSeconds: sessionDuration,
    model: state.model,
    trustScore: Math.round(state.trustScore),
    verdict:
      state.trustScore >= 80
        ? 'Passed — Low Risk'
        : state.trustScore >= 50
          ? 'Review Required — Moderate Risk'
          : 'Failed — High Risk',
    totalViolations: state.violations.length,
    breakdown: Object.values(grouped).sort((a, b) => b.count - a.count),
    violations: state.violations.map((v) => ({
      type: v.type,
      severity: v.severity,
      detail: v.detail || v.message || '',
      sessionTime: v.sessionTime || 0,
      timestamp: v.timestamp,
    })),
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name) {
  return (name || 'session')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ══════════════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════════════

function animateCounter(el, target) {
  if (!el) return;

  const current = parseInt(el.textContent, 10) || 0;
  if (current === target) return;

  const diff = target - current;
  const steps = Math.min(Math.abs(diff), 20);
  const stepSize = diff / steps;
  let step = 0;

  const interval = setInterval(() => {
    step++;
    if (step >= steps) {
      el.textContent = target;
      clearInterval(interval);
    } else {
      el.textContent = Math.round(current + stepSize * step);
    }
  }, 30);
}

function showAlert(message) {
  els.alertMessage.textContent = message;
  els.alertOverlay.classList.remove('hidden');

  setTimeout(() => {
    els.alertOverlay.classList.add('hidden');
  }, 1500);
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  els.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function showLoading(status) {
  els.loaderStatus.textContent = status;
  els.loadingOverlay.classList.remove('hidden');
}

function updateLoaderStatus(status) {
  els.loaderStatus.textContent = status;
}

function hideLoading() {
  els.loadingOverlay.classList.add('hidden');
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ══════════════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', init);
