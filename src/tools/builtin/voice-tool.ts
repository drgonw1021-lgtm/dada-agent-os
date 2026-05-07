import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";
import { spawn } from "node:child_process";
import { writeFile, readFile, unlink, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

export interface VoiceInput {
  action: "tts" | "stt" | "speak";
  text?: string;
  voice?: string;
  inputFile?: string;
  language?: string;
}

export interface VoiceOutput {
  success: boolean;
  action: string;
  result?: string;
  file?: string;
  error?: string;
}

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

function getVoiceTool(): ToolDefinition<VoiceInput, VoiceOutput> {
  const ttsAvailable = isWin || isMac; // system voice available
  const whisperPath = detectWhisperCpp();

  return {
    id: "voice",
    description: "语音工具：TTS(文字转语音/朗读)、STT(语音转文字)。TTS 使用系统自带语音引擎，STT 使用 whisper.cpp 本地推理。",
    requiredScopes: ["shell.exec"] as PermissionScope[],
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string" as const, enum: ["tts", "stt", "speak"], description: "tts (generate audio file), stt (transcribe audio), speak (play aloud)" },
        text: { type: "string" as const, description: "Text to speak" },
        voice: { type: "string" as const, description: "Voice name (Windows: voice name in system speech settings)" },
        inputFile: { type: "string" as const, description: "Audio file path for STT (.wav, .mp3)" },
        language: { type: "string" as const, description: "Language code (zh, en, ja, etc.)" }
      },
      required: ["action"]
    },
    async execute(input: VoiceInput, _context: ToolContext): Promise<VoiceOutput> {
      try {
        if (input.action === "tts") {
          return await handleTTS(input.text || "", input.voice, input.language);
        } else if (input.action === "stt") {
          return await handleSTT(input.inputFile || "", input.language);
        } else if (input.action === "speak") {
          return await handleSpeak(input.text || "");
        }
        return { success: false, action: input.action, error: "Unknown action" };
      } catch (e: any) {
        return { success: false, action: input.action, error: e.message };
      }
    }
  };
}

// ─── TTS: System Voice ───────────────────────────────────────────────────────────────

async function handleTTS(text: string, voice?: string, language?: string): Promise<VoiceOutput> {
  if (!text) {
    return { success: false, action: "tts", error: "No text provided" };
  }

  if (isWin) {
    return ttsWindows(text, voice);
  }
  if (isMac) {
    return ttsMac(text, voice);
  }
  return ttsLinux(text, voice);
}

async function ttsWindows(text: string, voice?: string): Promise<VoiceOutput> {
  const outputFile = join(tmpdir(), `tts_${Date.now()}.wav`);
  const escapedText = text.replace(/"/g, '`"');

  // Use PowerShell + System.Speech to generate .wav file
  const psScript = [
    `Add-Type -AssemblyName System.Speech`,
    `$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer`,
    voice ? `$synth.SelectVoice('${voice}')` : "",
    `$synth.SetOutputToWaveFile('${outputFile.replace(/\\/g, "\\\\")}')`,
    `$synth.Speak('${escapedText}')`,
    `$synth.Dispose()`
  ].filter(Boolean).join("; ");

  try {
    await execAsync("powershell", ["-Command", psScript]);
    return { success: true, action: "tts", result: "Audio generated (system voice)", file: outputFile };
  } catch (e: any) {
    return { success: false, action: "tts", error: `Windows TTS failed: ${e.message}` };
  }
}

async function ttsMac(text: string, voice?: string): Promise<VoiceOutput> {
  const outputFile = join(tmpdir(), `tts_${Date.now()}.aiff`);
  const args = ["-o", outputFile];
  if (voice) args.push("-v", voice);
  args.push(text);

  try {
    await execAsync("say", args);
    return { success: true, action: "tts", result: "Audio generated (macOS say)", file: outputFile };
  } catch (e: any) {
    return { success: false, action: "tts", error: `macOS TTS failed: ${e.message}` };
  }
}

async function ttsLinux(text: string, voice?: string): Promise<VoiceOutput> {
  const espeakPath = await which("espeak-ng") || await which("espeak");
  if (!espeakPath) {
    return { success: false, action: "tts", error: "Linux TTS not available. Install espeak-ng: sudo apt install espeak-ng" };
  }
  const outputFile = join(tmpdir(), `tts_${Date.now()}.wav`);
  const args = ["-w", outputFile, text];
  if (voice) args.unshift("-v", voice);

  try {
    await execAsync(espeakPath, args);
    return { success: true, action: "tts", result: "Audio generated (espeak)", file: outputFile };
  } catch (e: any) {
    return { success: false, action: "tts", error: `Linux TTS failed: ${e.message}` };
  }
}

// ─── STT: whisper.cpp ────────────────────────────────────────────────────────────────

const WHISPER_CPP_PATHS = [
  join(process.cwd(), "whisper.cpp", "build", "bin", isWin ? "whisper-cli.exe" : "whisper-cli"),
  join(process.cwd(), "whisper.cpp", isWin ? "main.exe" : "main"),
  join(process.env.LOCALAPPDATA || "", "whisper.cpp", "build", "bin", isWin ? "whisper-cli.exe" : "whisper-cli"),
  isWin ? "whisper-cli.exe" : "whisper-cli",
  "whisper",
];

function detectWhisperCpp(): string | null {
  for (const p of WHISPER_CPP_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function findWhisperBinary(): Promise<string | null> {
  // Check known paths first
  const detected = detectWhisperCpp();
  if (detected) return detected;

  // Try PATH lookup
  return await which(isWin ? "whisper-cli.exe" : "whisper-cli") ||
    await which("whisper");
}

async function findWhisperModel(): Promise<string | null> {
  const modelPaths = [
    join(process.cwd(), "whisper.cpp", "models", "ggml-base.bin"),
    join(process.cwd(), "whisper.cpp", "models", "ggml-small.bin"),
    join(process.cwd(), "whisper.cpp", "models", "ggml-tiny.bin"),
    join(process.cwd(), "whisper.cpp", "models", "ggml-medium.bin"),
  ];
  for (const p of modelPaths) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function handleSTT(inputFile: string, language?: string): Promise<VoiceOutput> {
  if (!inputFile) {
    return { success: false, action: "stt", error: "No input file provided" };
  }
  if (!existsSync(inputFile)) {
    return { success: false, action: "stt", error: `File not found: ${inputFile}` };
  }

  // 1) Try whisper.cpp
  const whisperBin = await findWhisperBinary();
  const whisperModel = whisperBin ? await findWhisperModel() : null;

  if (whisperBin && whisperModel) {
    try {
      const args = ["-m", whisperModel, "-f", inputFile, "-otxt", "-of", inputFile.replace(/\.[^.]+$/, "")];
      if (language) args.push("-l", language);
      await execAsync(whisperBin, args);
      const outPath = inputFile.replace(/\.[^.]+$/, ".txt");
      if (existsSync(outPath)) {
        const transcript = await readFile(outPath, "utf-8");
        await unlink(outPath).catch(() => {});
        return { success: true, action: "stt", result: transcript.trim() };
      }
    } catch (e: any) {
      console.log(`[Voice] whisper.cpp failed: ${e.message}, trying fallback`);
    }
  }

  // 2) Fall back to Python whisper
  const whisperPy = await which("whisper") || await detectPythonWhisper();
  if (whisperPy) {
    return sttPython(whisperPy, inputFile, language);
  }

  // 3) Fall back to OpenAI Whisper API
  const openaiKey = process.env.OPENAI_API_KEY || process.env.CLOUD_API_KEY;
  if (openaiKey) {
    return sttOpenAI(inputFile, language, openaiKey);
  }

  return {
    success: false,
    action: "stt",
    error: "No STT engine found. Install whisper.cpp or set OPENAI_API_KEY for cloud transcription."
  };
}

async function sttPython(whisperCmd: string, inputFile: string, language?: string): Promise<VoiceOutput> {
  try {
    const args = language
      ? [inputFile, "--language", language]
      : [inputFile];
    await execAsync(whisperCmd, args);
    const outPath = inputFile.replace(/\.[^.]+$/, ".txt");
    if (existsSync(outPath)) {
      const transcript = await readFile(outPath, "utf-8");
      return { success: true, action: "stt", result: transcript.trim() };
    }
    return { success: false, action: "stt", error: "whisper ran but no output file found" };
  } catch (e: any) {
    return { success: false, action: "stt", error: `whisper error: ${e.message}` };
  }
}

async function sttOpenAI(inputFile: string, language?: string, apiKey?: string): Promise<VoiceOutput> {
  const key = apiKey || process.env.OPENAI_API_KEY || process.env.CLOUD_API_KEY;
  if (!key) {
    return { success: false, action: "stt", error: "No API key for OpenAI Whisper" };
  }
  try {
    const audioBuffer = await readFile(inputFile);
    const ext = inputFile.split(".").pop()?.toLowerCase() || "webm";
    const mimeMap: Record<string, string> = {
      webm: "audio/webm", wav: "audio/wav", mp3: "audio/mpeg",
      m4a: "audio/mp4", ogg: "audio/ogg", flac: "audio/flac"
    };
    const mimeType = mimeMap[ext] || "audio/webm";
    const fileName = `audio.${ext}`;

    // Build multipart form manually (Node-compatible, no DOM APIs needed)
    const boundary = `----Whisper${Date.now()}`;
    const parts: Buffer[] = [];
    const addPart = (name: string, value: string) => {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    };
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`));
    parts.push(audioBuffer);
    parts.push(Buffer.from(`\r\n`));
    addPart("model", "whisper-1");
    if (language) addPart("language", language);
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);
    const baseUrl = process.env.OPENAI_BASE_URL || process.env.CLOUD_MODEL_ENDPOINT || "https://api.openai.com/v1";
    const endpoint = baseUrl.replace(/\/+$/, "") + "/audio/transcriptions";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`
      },
      body
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return { success: false, action: "stt", error: `Whisper API ${response.status}: ${errText.slice(0, 200)}` };
    }

    const data = await response.json() as { text?: string };
    return { success: true, action: "stt", result: data.text?.trim() || "" };
  } catch (e: any) {
    return { success: false, action: "stt", error: `Whisper API error: ${e.message}` };
  }
}

async function detectPythonWhisper(): Promise<string | null> {
  try {
    const { execSync } = await import("node:child_process");
    execSync("python -m whisper --help", { encoding: "utf8", timeout: 5000, stdio: "pipe" });
    return "python";
  } catch {
    return null;
  }
}

// ─── Speak: Play Audio Directly ─────────────────────────────────────────────────────

async function handleSpeak(text: string): Promise<VoiceOutput> {
  if (!text) {
    return { success: false, action: "speak", error: "No text provided" };
  }

  if (isWin) {
    const escapedText = text.replace(/"/g, '`"').replace(/'/g, "''");
    try {
      await execAsync("powershell", [
        "-Command",
        `Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.Speak('${escapedText}')`
      ]);
      return { success: true, action: "speak", result: "Spoken (Windows SAPI)" };
    } catch (e: any) {
      return { success: false, action: "speak", error: e.message };
    }
  }

  if (isMac) {
    try {
      await execAsync("say", [text]);
      return { success: true, action: "speak", result: "Spoken (macOS say)" };
    } catch (e: any) {
      return { success: false, action: "speak", error: e.message };
    }
  }

  // Linux: try espeak-ng, espeak, festival
  const espeakBin = await which("espeak-ng") || await which("espeak");
  if (espeakBin) {
    try {
      await execAsync(espeakBin, [text]);
      return { success: true, action: "speak", result: "Spoken (espeak)" };
    } catch (e: any) {
      return { success: false, action: "speak", error: e.message };
    }
  }

  return { success: false, action: "speak", error: "Speak not supported on this platform. Install espeak-ng." };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────────

function execAsync(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `exit code ${code}`));
    });
    proc.on("error", reject);
  });
}

async function which(cmd: string): Promise<string | null> {
  const { execSync } = await import("node:child_process");
  try {
    const whereCmd = isWin ? "where" : "which";
    const result = execSync(`${whereCmd} ${cmd}`, { encoding: "utf8", timeout: 5000 });
    return result.split("\n")[0]?.trim() || null;
  } catch {
    return null;
  }
}

export const createVoiceTool = getVoiceTool;
export default getVoiceTool;

export function checkVoiceCapability(): { available: boolean; reason?: string } {
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";
  if (isWin || isMac) return { available: true };
  return { available: false, reason: "System TTS not available on Linux. Install espeak-ng: sudo apt install espeak-ng" };
}
