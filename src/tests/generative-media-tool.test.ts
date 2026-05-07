import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkGenerativeMediaCapability, ComfyUiClient, createGenerativeMediaTool } from "../tools/builtin/generative-media-tool.js";

test("ComfyUI client extracts generated output files from history", () => {
  const client = new ComfyUiClient("http://127.0.0.1:8188");
  const files = client.extractOutputFiles(
    {
      prompt_1: {
        outputs: {
          "9": {
            images: [{ filename: "demo.png", subfolder: "", type: "output" }],
            videos: [{ filename: "demo.mp4", subfolder: "clips", type: "output" }]
          }
        }
      }
    },
    "prompt_1"
  );

  assert.deepEqual(files, [
    { filename: "demo.png", subfolder: "", type: "output" },
    { filename: "demo.mp4", subfolder: "clips", type: "output" }
  ]);
});

test("gen.media waits for ComfyUI outputs and downloads files", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dada-comfy-"));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/prompt")) {
        return new Response(JSON.stringify({ prompt_id: "prompt_2" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith("/history/prompt_2")) {
        return new Response(
          JSON.stringify({
            prompt_2: {
              outputs: {
                "5": {
                  images: [{ filename: "asset.png", subfolder: "", type: "output" }]
                }
              }
            }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
      if (url.includes("/view?")) {
        return new Response(Buffer.from("image-bytes"), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const tool = createGenerativeMediaTool({
      comfyuiEndpoint: "http://127.0.0.1:8188",
      openaiImageModel: "gpt-image-1",
      openaiTtsModel: "gpt-4o-mini-tts",
      openaiTtsVoice: "alloy",
      outputDir: tempDir
    });

    const result = await tool.execute(
      {
        action: "comfy_workflow",
        workflow: { "1": { class_type: "CheckpointLoaderSimple" } },
        wait: true,
        options: { timeoutMs: 1000, pollMs: 250 }
      },
      {
        now: new Date(),
        taskId: "media-1",
        taskLineageId: "media-1",
        goal: "generate image"
      }
    );

    assert.equal(result.success, true);
    assert.equal(result.promptId, "prompt_2");
    assert.equal(result.files?.length, 1);
    assert.equal(readFileSync(result.files?.[0] ?? "", "utf8"), "image-bytes");
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ── Capability check: provider-aware detection ─────────────────────────

test("gen.media capability: unavailable when no backend configured", async () => {
  const result = await checkGenerativeMediaCapability({
    comfyuiEndpoint: "",
    openaiImageModel: "gpt-image-1",
    openaiTtsModel: "gpt-4o-mini-tts",
    openaiTtsVoice: "alloy",
  });
  assert.equal(result.available, false);
  assert.ok(result.reason?.includes("COMFYUI_ENDPOINT"));
});

test("gen.media capability: available with ComfyUI endpoint", async () => {
  const result = await checkGenerativeMediaCapability({
    comfyuiEndpoint: "http://127.0.0.1:8188",
    openaiImageModel: "gpt-image-1",
    openaiTtsModel: "gpt-4o-mini-tts",
    openaiTtsVoice: "alloy",
  });
  assert.equal(result.available, true);
});

test("gen.media capability: available with cloud API key (non-DeepSeek)", async () => {
  const result = await checkGenerativeMediaCapability({
    comfyuiEndpoint: "",
    cloudModelEndpoint: "https://api.openai.com/v1",
    openaiApiKey: "sk-test",
    openaiImageModel: "gpt-image-1",
    openaiTtsModel: "gpt-4o-mini-tts",
    openaiTtsVoice: "alloy",
  });
  assert.equal(result.available, true);
});

test("gen.media capability: unavailable with DeepSeek cloud and no ComfyUI", async () => {
  const result = await checkGenerativeMediaCapability({
    comfyuiEndpoint: "",
    cloudModelEndpoint: "https://api.deepseek.com/v1",
    openaiApiKey: "sk-deepseek-test",
    openaiImageModel: "gpt-image-1",
    openaiTtsModel: "gpt-4o-mini-tts",
    openaiTtsVoice: "alloy",
  });
  assert.equal(result.available, false);
  assert.ok(result.reason?.includes("text-only"), `Reason should mention text-only, got: ${result.reason}`);
});

test("gen.media capability: available with DeepSeek cloud + ComfyUI fallback", async () => {
  const result = await checkGenerativeMediaCapability({
    comfyuiEndpoint: "http://127.0.0.1:8188",
    cloudModelEndpoint: "https://api.deepseek.com/v1",
    openaiApiKey: "sk-deepseek-test",
    openaiImageModel: "gpt-image-1",
    openaiTtsModel: "gpt-4o-mini-tts",
    openaiTtsVoice: "alloy",
  });
  assert.equal(result.available, true);
});
