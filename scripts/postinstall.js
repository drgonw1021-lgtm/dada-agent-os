import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

const red = "\x1b[31m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const reset = "\x1b[0m";

console.log(`
╔═══════════════════════════════════════════════════════════╗
║              Dada Agent - Dependencies Setup              ║
╚═══════════════════════════════════════════════════════════╝
`);

const requiredDeps = [
  { name: "playwright", install: 'npm install playwright', optional: false },
  { name: "tesseract", install: "winget install tesseract", optional: true },
  { name: "ffmpeg", install: "winget install ffmpeg", optional: true },
];

console.log(yellow + "Note: For full browser automation, install Chromium:" + reset);
console.log("  npx playwright install chromium\n");

console.log(yellow + "Optional system tools:" + reset);
console.log("  - Tesseract OCR: winget install tesseract");
console.log("  - FFmpeg (media): winget install ffmpeg");
console.log("  - Whisper (voice): pip install openai-whisper");
console.log("  - Edge TTS: pip install edge-tts\n");

console.log(green + "Core dependencies installed!" + reset);
console.log("Run 'npm run start:ui' to start Dada Agent\n");
