---
name: media_creator
description: Generate creative image, video, and voice assets with model APIs or ComfyUI-style workflows
version: 1.0.0
triggers: image generation, video generation, voice generation, tts, comfyui, poster, icon, trailer
---

# Media Creator Skill

Use this skill when the task asks for generated media assets rather than analysis only.

## Recommended Tools

- `gen.media`
- `media`
- `vision`
- `voice`

## Workflow

1. Clarify output type and style
2. Choose engine: OpenAI or ComfyUI workflow
3. Generate asset or submit job
4. Verify the output is usable
5. Return file path, job id, or next-step instructions

## Rules

- Prefer returning a real file or job result, not only prompt text
- If ComfyUI workflow is missing, create a reusable skill or workflow draft
- If engine access is missing, state the gap clearly and propose the shortest setup path
