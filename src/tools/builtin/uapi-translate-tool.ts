import type { ToolDefinition, ToolContext } from "../../core/types.js";

interface UapiTranslateInput {
  text: string;
  to: string;
  from?: string;
}

interface UapiTranslateOutput {
  success: boolean;
  original: string;
  translated: string;
  sourceLang?: string;
  targetLang: string;
  error?: string;
}

// Common language codes
const LANG_CODES: Record<string, string> = {
  "中文": "zh", "英文": "en", "日语": "ja", "韩语": "ko",
  "法语": "fr", "德语": "de", "西班牙语": "es", "葡萄牙语": "pt",
  "俄语": "ru", "阿拉伯语": "ar", "意大利语": "it", "荷兰语": "nl",
  "zh": "zh", "en": "en", "ja": "ja", "ko": "ko",
  "fr": "fr", "de": "de", "es": "es", "pt": "pt",
  "ru": "ru", "ar": "ar", "it": "it", "nl": "nl",
};

function normalizeLang(input: string): string {
  return LANG_CODES[input] || input;
}

export function createUapiTranslateTool(): ToolDefinition<UapiTranslateInput, UapiTranslateOutput> {
  const BASE = "https://uapis.cn/api/v1";

  return {
    id: "uapi.translate",
    description: "AI-powered high-quality translation via UAPI. Supports Chinese, English, Japanese, Korean, French, German, Spanish, Portuguese, Russian, Arabic, Italian, Dutch, and more.",
    requiredScopes: ["web.fetch"],
    riskLevel: "low",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to translate. Max ~5000 characters." },
        to: { type: "string", description: "Target language. Use language name (中文/英文/日语) or code (zh/en/ja/ko/fr/de/es/pt/ru/ar/it/nl)." },
        from: { type: "string", description: "Source language (optional, auto-detected if omitted). Same format as 'to'." }
      },
      required: ["text", "to"]
    },
    async execute(input: UapiTranslateInput, _ctx: ToolContext): Promise<UapiTranslateOutput> {
      const targetLang = normalizeLang(input.to);
      const sourceLang = input.from ? normalizeLang(input.from) : undefined;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 90000); // translation can be slow

        try {
          const body: Record<string, string> = { text: input.text.slice(0, 5000), target_lang: targetLang };
          if (sourceLang) body.source_lang = sourceLang;

          const resp = await fetch(`${BASE}/ai/translate`, {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "DaDa/1.0" },
            body: JSON.stringify(body)
          });

          if (!resp.ok) {
            const errText = await resp.text().catch(() => "");
            return { success: false, original: input.text.slice(0, 200), translated: "", targetLang, error: `UAPI ${resp.status}: ${errText.slice(0, 200)}` };
          }

          const data = await resp.json() as any;
          const translated = data.data?.translated_text || data.translated_text || "";
          console.log(`[uapi.translate] Translated ${input.text.length} chars to ${targetLang} (${translated.length} chars, ${data.performance?.processing_time_ms || "?"}ms)`);
          return { success: true, original: input.text, translated, sourceLang: sourceLang || "auto", targetLang };
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, original: input.text.slice(0, 200), translated: "", targetLang, error: `Translation failed: ${msg.slice(0, 300)}` };
      }
    }
  };
}
