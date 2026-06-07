# ProctorAI — AI Interview Integrity Monitor

<p align="center">
  <strong>Real-time AI-powered interview proctoring using Google Gemini Vision</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Gemini-2.5_Flash-4285F4?logo=google&logoColor=white" alt="Gemini">
  <img src="https://img.shields.io/badge/Deploy-Vercel-000?logo=vercel" alt="Vercel">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT">
  <img src="https://img.shields.io/badge/Type-Static_Frontend-06b6d4" alt="Static">
</p>

---

## What is ProctorAI?

ProctorAI is a browser-based interview integrity monitor that uses **Google Gemini Vision API** to detect cheating behaviors during video interviews in real-time. It runs entirely in the browser — no backend, no data storage, complete privacy.

### 🔍 Detection Capabilities

| Detection | Method | Severity |
|-----------|--------|----------|
| 👀 **Eye Gaze Tracking** | AI vision analysis of eye direction | Medium |
| 👥 **Multiple Face Detection** | AI counts faces in webcam frame | Critical |
| 🖥️ **Tab Switch Detection** | Browser Visibility API | High |
| 📱 **Phone/Device Detection** | AI detects phones, tablets, screens | High |
| 🎭 **Head Pose Estimation** | AI tracks head orientation | Medium |
| 🔊 **Background Voice Detection** | AI analyzes audio for extra voices | High |
| 📋 **Copy/Paste Detection** | Clipboard event monitoring | Medium |
| 🚫 **Screen Obstruction** | AI detects camera blocking | High |

### ⚡ Key Features

- **Real-Time Trust Score** — Composite score (0-100) updated live with every analysis
- **Live Violation Timeline** — Scrolling feed of detected violations with severity badges
- **Animated Dashboard** — Premium dark theme with glassmorphism and micro-animations
- **Session Reports** — Exportable JSON/text reports with violation breakdown
- **Zero Backend** — Everything runs in-browser. Your video never touches a server.
- **Configurable** — Adjust frame analysis interval, choose Gemini model

---

## 🚀 Quick Start

### 1. Get a Gemini API Key
- Go to [Google AI Studio](https://aistudio.google.com/apikey)
- Create a free API key

### 2. Run Locally
```bash
# Clone the repo
git clone https://github.com/rahul71196/proctor-ai.git
cd proctor-ai

# Serve the frontend (any static server works)
npx serve frontend

# Open http://localhost:3000
```

### 3. Deploy to Vercel
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```
Or import the repo directly at [vercel.com/new](https://vercel.com/new).

---

## 🏗️ Architecture

```
proctor-ai/
├── frontend/
│   ├── index.html           # Three-view layout (Setup → Monitor → Report)
│   ├── style.css            # Premium dark theme design system
│   ├── app.js               # Application controller & state management
│   ├── proctor-engine.js    # Core detection orchestrator
│   ├── detection-types.js   # Violation type definitions
│   └── detectors/
│       └── browser-detector.js  # Browser API monitoring (tabs, clipboard)
├── vercel.json              # Vercel deployment config
├── .gitignore
└── README.md
```

### How It Works

1. **Frame Capture** — Webcam frames are captured every N seconds via Canvas API
2. **AI Analysis** — Frames are sent to Gemini Vision API with structured prompts
3. **Violation Detection** — AI responses are parsed and mapped to violation types
4. **Trust Scoring** — Weighted composite score updated in real-time
5. **Audio Monitoring** — Periodic audio clips analyzed for background voices

---

## 🔒 Privacy

- **No backend** — All processing happens in your browser
- **No storage** — Video/audio is never saved or uploaded to any server (only sent to Google Gemini API for analysis)
- **No tracking** — Zero analytics, cookies, or telemetry
- **API key stays local** — Stored only in your browser's localStorage

---

## 🛠️ Tech Stack

- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES Modules)
- **AI**: Google Gemini 2.5 Flash (Vision + Audio)
- **APIs**: MediaDevices, Web Audio, Canvas, Visibility, Clipboard
- **Deployment**: Vercel (static)
- **Design**: Glassmorphism, CSS animations, SVG gauges

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
