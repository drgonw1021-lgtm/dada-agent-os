---
name: social_publisher
description: Prepare and safely publish short-form social content such as Douyin/TikTok scripts, captions, hashtags, source notes, and posting packages.
triggers:
  - publish
  - douyin
  - tiktok
  - shortform
  - spoken script
  - 口播
  - 发布
---

# Social Publisher Skill

Use this skill when the task asks DaDa to research topics, write social content, and publish or prepare content for a social platform.

## Workflow

1. Identify the target platform, account, audience, tone, duration, and publishing deadline.
2. If the task depends on current events, collect recent evidence with `search`, `web.fetch`, or browser tools.
3. Produce a concise source-backed shortlist before writing the final script.
4. Write a platform-ready package:
   - title
   - spoken script
   - caption
   - hashtags
   - source URLs or evidence notes
   - required media files
5. Call `social.publish` to save the package.
6. Do not claim content was posted unless a platform-specific tool returns proof such as a post URL.

## Safety Rules

- Posting to an account is irreversible and must require explicit approval.
- If no logged-in browser session, cookies, API token, or platform bridge is available, report the blocker and provide a ready-to-post package.
- Do not invent sources for news tasks.
- For breaking or recent news, include source dates when available.
