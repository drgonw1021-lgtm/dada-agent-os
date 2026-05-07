import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { exec } from "node:child_process";

// ─── Types ────────────────────────────────────────────────────────────────────────

export type PublishPlatform = "douyin" | "xiaohongshu" | "kuaishou" | "wechat_channels" | "bilibili";

export interface PublishDraft {
  id: string;
  platform: PublishPlatform;
  status: "draft" | "ready" | "publishing" | "published" | "failed" | "draft_saved";
  title: string;
  description: string;
  hashtags: string[];
  mediaFiles: string[];
  coverFile?: string;
  /** Browser cookie jar path for session reuse */
  sessionPath?: string;
  scheduledAt?: string;
  publishedAt?: string;
  publishedUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface PublishResult {
  success: boolean;
  draftId: string;
  platform: PublishPlatform;
  status: "published" | "failed" | "draft_saved";
  url?: string;
  error?: string;
  nextStep: string;
  /** Browser automation script for manual execution */
  automationScript?: string;
}

export interface SessionState {
  platform: PublishPlatform;
  cookies: unknown[];
  localStorage: Record<string, string>;
  expiresAt: string;
  verified: boolean;
}

export interface BridgeConfig {
  /** Directory for session storage */
  sessionsDir: string;
  /** Directory for draft storage */
  draftsDir: string;
  /** Playwright/Chrome executable path */
  browserExecutable?: string;
  /** Whether to run browser in headless mode */
  headless: boolean;
  /** Default timeout for browser operations */
  timeoutMs: number;
}

// ─── Platform Publisher URLs ─────────────────────────────────────────────────────

const PLATFORM_URLS: Record<PublishPlatform, { creator: string; login: string; name: string }> = {
  douyin: {
    creator: "https://creator.douyin.com/creator-micro/content/upload",
    login: "https://creator.douyin.com/",
    name: "抖音",
  },
  xiaohongshu: {
    creator: "https://creator.xiaohongshu.com/publish/publish",
    login: "https://creator.xiaohongshu.com/",
    name: "小红书",
  },
  kuaishou: {
    creator: "https://cp.kuaishou.com/article/publish",
    login: "https://cp.kuaishou.com/",
    name: "快手",
  },
  wechat_channels: {
    creator: "https://channels.weixin.qq.com/platform/post/create",
    login: "https://channels.weixin.qq.com/",
    name: "微信视频号",
  },
  bilibili: {
    creator: "https://member.bilibili.com/platform/upload/video/frame",
    login: "https://member.bilibili.com/",
    name: "B站",
  },
};

// ─── Bridge ──────────────────────────────────────────────────────────────────────

export class SocialPublishBridge {
  private config: BridgeConfig;
  private sessions: Map<string, SessionState> = new Map();

  constructor(config: Partial<BridgeConfig> = {}) {
    this.config = {
      sessionsDir: config.sessionsDir || "./.agent/sessions",
      draftsDir: config.draftsDir || "./.agent/drafts",
      browserExecutable: config.browserExecutable,
      headless: config.headless !== false,
      timeoutMs: config.timeoutMs || 60000,
    };
  }

  async initialize(): Promise<void> {
    await mkdir(this.config.sessionsDir, { recursive: true });
    await mkdir(this.config.draftsDir, { recursive: true });
    await this.loadSessions();
  }

  // ─── Draft Management ──────────────────────────────────────────────────────

  async createDraft(params: {
    platform: PublishPlatform;
    title: string;
    description: string;
    hashtags: string[];
    mediaFiles: string[];
    coverFile?: string;
    scheduledAt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<PublishDraft> {
    const draft: PublishDraft = {
      id: randomUUID(),
      platform: params.platform,
      status: "draft",
      title: params.title,
      description: params.description,
      hashtags: params.hashtags,
      mediaFiles: params.mediaFiles,
      coverFile: params.coverFile,
      scheduledAt: params.scheduledAt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    await this.saveDraft(draft);
    return draft;
  }

  async getDraft(id: string): Promise<PublishDraft | null> {
    const path = join(this.config.draftsDir, `${id}.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(await readFile(path, "utf8")) as PublishDraft;
    } catch {
      return null;
    }
  }

  async listDrafts(platform?: PublishPlatform): Promise<PublishDraft[]> {
    try {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(this.config.draftsDir);
      const drafts: PublishDraft[] = [];

      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const draft = JSON.parse(
            await readFile(join(this.config.draftsDir, file), "utf8")
          ) as PublishDraft;
          if (!platform || draft.platform === platform) {
            drafts.push(draft);
          }
        } catch { /* skip */ }
      }

      return drafts.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    } catch {
      return [];
    }
  }

  async updateDraftStatus(
    id: string,
    status: PublishDraft["status"],
    extra?: { publishedUrl?: string; error?: string }
  ): Promise<PublishDraft | null> {
    const draft = await this.getDraft(id);
    if (!draft) return null;

    draft.status = status;
    draft.updatedAt = new Date().toISOString();
    if (status === "published") {
      draft.publishedAt = new Date().toISOString();
      draft.publishedUrl = extra?.publishedUrl;
    }
    if (status === "failed" && extra?.error) {
      draft.error = extra.error;
    }

    await this.saveDraft(draft);
    return draft;
  }

  async deleteDraft(id: string): Promise<boolean> {
    const path = join(this.config.draftsDir, `${id}.json`);
    if (!existsSync(path)) return false;
    await unlink(path);
    return true;
  }

  // ─── Session Management ────────────────────────────────────────────────────

  async saveSession(platform: PublishPlatform, cookies: unknown[], localStorage: Record<string, string> = {}): Promise<void> {
    const session: SessionState = {
      platform,
      cookies,
      localStorage,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      verified: true,
    };

    this.sessions.set(platform, session);
    await writeFile(
      join(this.config.sessionsDir, `${platform}.json`),
      JSON.stringify(session, null, 2),
      "utf8"
    );
  }

  async getSession(platform: PublishPlatform): Promise<SessionState | null> {
    const cached = this.sessions.get(platform);
    if (cached && new Date(cached.expiresAt).getTime() > Date.now()) {
      return cached;
    }
    return null;
  }

  hasValidSession(platform: PublishPlatform): boolean {
    const session = this.sessions.get(platform);
    return session !== undefined && new Date(session.expiresAt).getTime() > Date.now();
  }

  // ─── Publishing Workflows ──────────────────────────────────────────────────

  /** Build a Playwright automation script to publish content */
  buildPublishScript(draft: PublishDraft): string {
    const platform = PLATFORM_URLS[draft.platform];
    const session = this.sessions.get(draft.platform);

    const scripts: Record<PublishPlatform, string> = {
      douyin: this.buildDouyinScript(draft, session),
      xiaohongshu: this.buildXiaohongshuScript(draft, session),
      kuaishou: this.buildKuaishouScript(draft, session),
      wechat_channels: this.buildWechatChannelsScript(draft, session),
      bilibili: this.buildBilibiliScript(draft, session),
    };

    return scripts[draft.platform];
  }

  /** Generate a helper script users can run to publish via browser */
  generateAutomationScript(draft: PublishDraft): string {
    const platform = PLATFORM_URLS[draft.platform];
    const mediaFiles = draft.mediaFiles.map(f => resolve(f)).join('", "');
    const hashtags = draft.hashtags.map(h => h.startsWith("#") ? h : `#${h}`).join(" ");

    return [
      `# ${platform.name} 发布自动化脚本`,
      `# 草稿 ID: ${draft.id}`,
      `# 标题: ${draft.title}`,
      "",
      `# 方式1: 使用 Playwright (推荐)`,
      `npx playwright chromium --headed \\`,
      `  --url="${platform.creator}" \\`,
      `  --script="dada-publish-${draft.platform}.js"`,
      "",
      `# 方式2: 手动发布`,
      `# 1. 打开 ${platform.creator}`,
      `# 2. 扫码登录`,
      `# 3. 上传文件: ${mediaFiles || "(无)"}`,
      `# 4. 填写标题: ${draft.title}`,
      `# 5. 填写描述: ${draft.description}`,
      `# 6. 添加标签: ${hashtags}`,
      `# 7. 点击发布`,
    ].join("\n");
  }

  /** Build a complete publishing workflow for a platform */
  buildPublishingWorkflow(draft: PublishDraft): PublishResult {
    const hasSession = this.hasValidSession(draft.platform);
    const hasMedia = draft.mediaFiles.length > 0;

    if (!hasMedia) {
      return {
        success: false,
        draftId: draft.id,
        platform: draft.platform,
        status: "failed",
        error: "No media files provided. Video/image content is required for publishing.",
        nextStep: "Generate or attach media files before publishing.",
      };
    }

    if (!hasSession) {
      return {
        success: false,
        draftId: draft.id,
        platform: draft.platform,
        status: "draft_saved",
        error: `No active login session for ${PLATFORM_URLS[draft.platform].name}. Login required.`,
        nextStep: `Open ${PLATFORM_URLS[draft.platform].login} in browser, scan QR code to login, then save session cookies.`,
        automationScript: this.generateAutomationScript(draft),
      };
    }

    return {
      success: true,
      draftId: draft.id,
      platform: draft.platform,
      status: "published",
      nextStep: "Execute the publishing script via browser automation tool.",
      automationScript: this.buildPublishScript(draft),
    };
  }

  /** Execute a Playwright publishing script for real */
  async executePublishScript(draft: PublishDraft): Promise<{ success: boolean; output: string; error?: string }> {
    const script = this.buildPublishScript(draft);
    const scriptPath = join(tmpdir(), `dada-publish-${draft.platform}-${draft.id.slice(0, 8)}.js`);

    await writeFile(scriptPath, script, "utf-8");

    return new Promise((resolve) => {
      exec(
        `node "${scriptPath}"`,
        {
          timeout: this.config.timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env, DADA_PUBLISH_DRAFT_ID: draft.id },
        },
        async (err, stdout, stderr) => {
          try { await unlink(scriptPath); } catch { /* cleanup */ }

          if (err) {
            const errorMsg = stderr || err.message || "Unknown publish error";
            resolve({ success: false, output: stdout, error: errorMsg });
          } else {
            resolve({ success: true, output: stdout });
          }
        }
      );
    });
  }

  /** Publish a draft — execute via Playwright if session available, otherwise generate manual instructions */
  async publish(draftId: string, opts?: { dryRun?: boolean; headless?: boolean }): Promise<PublishResult> {
    const draft = await this.getDraft(draftId);
    if (!draft) {
      return {
        success: false,
        draftId,
        platform: "douyin",
        status: "failed",
        error: "Draft not found",
        nextStep: "Create a draft first.",
      };
    }

    await this.updateDraftStatus(draftId, "publishing");

    // Dry run: only generate script, don't execute
    if (opts?.dryRun) {
      const workflow = this.buildPublishingWorkflow(draft);
      await this.updateDraftStatus(draftId, workflow.status as PublishDraft["status"], { error: workflow.error });
      return workflow;
    }

    const hasSession = this.hasValidSession(draft.platform);
    const hasMedia = draft.mediaFiles.length > 0;

    if (!hasMedia) {
      await this.updateDraftStatus(draftId, "failed", { error: "No media files provided" });
      return {
        success: false, draftId, platform: draft.platform, status: "failed",
        error: "No media files provided. Video/image content is required for publishing.",
        nextStep: "Generate or attach media files before publishing.",
      };
    }

    if (!hasSession) {
      await this.updateDraftStatus(draftId, "draft_saved", {
        error: `No active login session for ${PLATFORM_URLS[draft.platform].name}`,
      });
      return {
        success: false, draftId, platform: draft.platform, status: "draft_saved",
        error: `No active login session for ${PLATFORM_URLS[draft.platform].name}. Login required.`,
        nextStep: `Open ${PLATFORM_URLS[draft.platform].login} in browser, scan QR code to login, then save session cookies.`,
        automationScript: this.generateAutomationScript(draft),
      };
    }

    // Execute the Playwright script for real
    console.log(`[SocialPublishBridge] Executing publish script for ${draft.platform}...`);
    const execResult = await this.executePublishScript(draft);

    if (execResult.success) {
      const publishedUrl = this.extractPublishedUrl(execResult.output, draft.platform);
      await this.updateDraftStatus(draftId, "published", { publishedUrl: publishedUrl || undefined });
      return {
        success: true, draftId, platform: draft.platform, status: "published",
        url: publishedUrl || undefined,
        nextStep: "Content published via browser automation. Verify on the platform.",
      };
    } else {
      await this.updateDraftStatus(draftId, "failed", { error: execResult.error });
      return {
        success: false, draftId, platform: draft.platform, status: "failed",
        error: execResult.error,
        nextStep: "Publishing failed. Check the error, fix issues, and retry. You can also publish manually using the automation script.",
        automationScript: this.generateAutomationScript(draft),
      };
    }
  }

  /** Try to extract published URL from Playwright script output */
  private extractPublishedUrl(output: string, _platform: PublishPlatform): string | null {
    const patterns = [
      /published[:\s]+(https?:\/\/[^\s]+)/i,
      /post[:\s]+url[:\s]+(https?:\/\/[^\s]+)/i,
      /(https?:\/\/[^\s]*(?:douyin|xiaohongshu|kuaishou|bilibili|weixin\.qq\.com)[^\s]*)/i,
    ];
    for (const p of patterns) {
      const m = output.match(p);
      if (m) return m[1];
    }
    return null;
  }

  // ─── Platform-Specific Scripts ─────────────────────────────────────────────

  private buildDouyinScript(draft: PublishDraft, session?: SessionState | null): string {
    const mediaPath = draft.mediaFiles[0] ? resolve(draft.mediaFiles[0]) : "";
    const coverPath = draft.coverFile ? resolve(draft.coverFile) : mediaPath;
    const tags = draft.hashtags.map(h => h.replace(/^#/, "")).join(",");

    return `
// Douyin (抖音) Creator Studio Publisher
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN',
  });

  // Restore session if available
  ${session ? `
  await context.addCookies(${JSON.stringify(session.cookies)});
  ` : ""}

  const page = await context.newPage();

  try {
    // Navigate to creator studio
    await page.goto('https://creator.douyin.com/creator-micro/content/upload', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // If redirected to login, notify user
    if (page.url().includes('login')) {
      console.log('需要扫码登录抖音创作者平台');
      console.log('请在浏览器中扫描二维码登录...');
      await page.waitForURL('**/creator-micro/**', { timeout: 120000 });
      console.log('登录成功');
    }

    // Upload video
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles('${mediaPath}');
    console.log('视频上传中，等待处理完成...');

    // Wait for video processing
    await page.waitForSelector('[class*="upload-complete"], [class*="processing-complete"]', {
      timeout: 300000,
    });
    console.log('视频处理完成');

    // Set cover if provided
    ${coverPath && coverPath !== mediaPath ? `
    const coverInput = page.locator('input[accept*="image"]');
    await coverInput.setInputFiles('${coverPath}');
    ` : ""}

    // Fill title
    const titleInput = page.locator('[placeholder*="标题"], [class*="title"] input');
    await titleInput.fill(${JSON.stringify(draft.title)});

    // Fill description / hashtags
    ${tags ? `
    const tagInput = page.locator('[placeholder*="标签"], [class*="tag"] input, [placeholder*="描述"]');
    await tagInput.fill('${tags}');
    ` : ""}

    // Fill description text if separate
    const descInput = page.locator('[placeholder*="描述"], textarea');
    if (await descInput.count() > 0) {
      await descInput.first().fill(${JSON.stringify(draft.description)});
    }

    console.log('内容已填写完成，请在浏览器中确认并点击发布');
    console.log('完成后运行: npm.cmd run dada -- --action=confirm-publish --draft=${draft.id}');

    // Keep browser open for manual confirmation
    await new Promise(() => {}); // Never resolves — user closes browser
  } catch (e) {
    console.error('发布失败:', e.message);
    await browser.close();
    process.exit(1);
  }
})();
`.trim();
  }

  private buildXiaohongshuScript(draft: PublishDraft, session?: SessionState | null): string {
    const mediaPath = draft.mediaFiles[0] ? resolve(draft.mediaFiles[0]) : "";
    const tags = draft.hashtags.map(h => h.replace(/^#/, "")).join(" ");

    return `
// Xiaohongshu (小红书) Creator Publisher
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN',
  });

  ${session ? `
  await context.addCookies(${JSON.stringify(session.cookies)});
  ` : ""}

  const page = await context.newPage();

  try {
    await page.goto('https://creator.xiaohongshu.com/publish/publish', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    if (page.url().includes('login')) {
      console.log('需要扫码登录小红书创作者平台');
      console.log('请在浏览器中扫描二维码登录...');
      await page.waitForURL('**/publish/**', { timeout: 120000 });
      console.log('登录成功');
    }

    // Upload images/video
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(${JSON.stringify(draft.mediaFiles.map(f => resolve(f)))});
    console.log('素材上传中...');
    await page.waitForTimeout(5000);

    // Fill title
    const titleInput = page.locator('[placeholder*="标题"]');
    await titleInput.fill(${JSON.stringify(draft.title)});

    // Fill body text with hashtags
    const bodyText = ${JSON.stringify(draft.description + "\n\n" + tags)};
    const bodyInput = page.locator('[contenteditable="true"], [placeholder*="正文"], #post-textarea');
    await bodyInput.first().fill(bodyText);
    console.log('内容已填写完成');

    console.log('请在浏览器中确认并点击发布');
    await new Promise(() => {});
  } catch (e) {
    console.error('发布失败:', e.message);
    await browser.close();
    process.exit(1);
  }
})();
`.trim();
  }

  private buildKuaishouScript(draft: PublishDraft, session?: SessionState | null): string {
    const mediaPath = draft.mediaFiles[0] ? resolve(draft.mediaFiles[0]) : "";
    return this.genericUploadScript("kuaishou", draft, session, mediaPath);
  }

  private buildWechatChannelsScript(draft: PublishDraft, session?: SessionState | null): string {
    const mediaPath = draft.mediaFiles[0] ? resolve(draft.mediaFiles[0]) : "";
    return this.genericUploadScript("wechat_channels", draft, session, mediaPath);
  }

  private buildBilibiliScript(draft: PublishDraft, session?: SessionState | null): string {
    const mediaPath = draft.mediaFiles[0] ? resolve(draft.mediaFiles[0]) : "";
    return this.genericUploadScript("bilibili", draft, session, mediaPath);
  }

  private genericUploadScript(
    platformKey: PublishPlatform,
    draft: PublishDraft,
    session: SessionState | null | undefined,
    mediaPath: string
  ): string {
    const platform = PLATFORM_URLS[platformKey];

    return `
// ${platform.name} Publisher (generic)
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN',
  });

  ${session ? `await context.addCookies(${JSON.stringify(session.cookies)});` : ""}

  const page = await context.newPage();

  try {
    await page.goto('${platform.creator}', { waitUntil: 'networkidle', timeout: 30000 });

    if (page.url().includes('login')) {
      console.log('需要扫码登录 ${platform.name} 创作者平台');
      await page.waitForURL('**/upload/**', { timeout: 120000 }).catch(() => {});
    }

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles('${mediaPath}');
    console.log('素材上传中...');
    await page.waitForTimeout(10000);

    const titleInput = page.locator('[placeholder*="标题"], input[name*="title"]');
    if (await titleInput.count() > 0) {
      await titleInput.first().fill(${JSON.stringify(draft.title)});
    }

    const descInput = page.locator('[placeholder*="简介"], textarea, [contenteditable="true"]');
    if (await descInput.count() > 0) {
      await descInput.first().fill(${JSON.stringify(draft.description)});
    }

    console.log('内容已填写完成，请在浏览器中确认并发布');
    await new Promise(() => {});
  } catch (e) {
    console.error('发布失败:', e.message);
    await browser.close();
    process.exit(1);
  }
})();
`.trim();
  }

  // ─── Interactive Login Flow (QR Code) ──────────────────────────────────────

  /**
   * Launch a Playwright browser for the user to scan QR code and login.
   * Auto-detects successful login and saves the session cookies.
   * Returns the session state on success.
   */
  async loginWithQR(platform: PublishPlatform, opts?: {
    timeoutMs?: number;
    headless?: boolean;
  }): Promise<{ success: boolean; session?: SessionState; error?: string }> {
    const platformInfo = PLATFORM_URLS[platform];
    const timeout = opts?.timeoutMs || 180000;

    // Check if Playwright is available
    let playwright: any;
    try {
      playwright = require("playwright");
    } catch {
      return {
        success: false,
        error: "Playwright is not installed. Run: npm install playwright && npx playwright install chromium",
      };
    }

    const browser = await playwright.chromium.launch({
      headless: opts?.headless ?? false,
    });

    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        locale: "zh-CN",
      });

      const page = await context.newPage();
      await page.goto(platformInfo.login, { waitUntil: "networkidle", timeout: 30000 });

      console.log(`[SocialPublishBridge] ${platformInfo.name} login page opened — waiting for QR scan...`);

      // Wait for redirect from login to creator dashboard
      try {
        await page.waitForURL((url: URL) => !url.toString().includes("login"), { timeout });
        console.log(`[SocialPublishBridge] ${platformInfo.name} login successful`);
      } catch {
        await browser.close();
        return {
          success: false,
          error: `Login timeout: QR code not scanned within ${timeout / 1000}s. Please try again.`,
        };
      }

      // Extract cookies and save session
      const cookies = await context.cookies();
      const localStorage = await page.evaluate(() => {
        const data: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) data[key] = localStorage.getItem(key) || "";
        }
        return data;
      });

      await this.saveSession(platform, cookies, localStorage);
      await browser.close();

      const session = this.sessions.get(platform);
      console.log(`[SocialPublishBridge] Session saved for ${platformInfo.name} — expires ${session?.expiresAt}`);

      return { success: true, session };
    } catch (e: any) {
      await browser.close().catch(() => {});
      return { success: false, error: e.message };
    }
  }

  /** Check if all configured platforms have valid sessions */
  getPlatformStatus(): Array<{
    platform: PublishPlatform;
    name: string;
    hasSession: boolean;
    expiresAt?: string;
  }> {
    return Object.entries(PLATFORM_URLS).map(([key, info]) => ({
      platform: key as PublishPlatform,
      name: info.name,
      hasSession: this.hasValidSession(key as PublishPlatform),
      expiresAt: this.sessions.get(key as PublishPlatform)?.expiresAt,
    }));
  }

  // ─── Post-Publish Verification ──────────────────────────────────────────────

  /**
   * Verify that published content is accessible on the platform.
   * Tries to fetch the published URL and check for success indicators.
   */
  async verifyPublished(draftId: string): Promise<{
    verified: boolean;
    url?: string;
    status: "live" | "not_found" | "pending" | "error";
    error?: string;
  }> {
    const draft = await this.getDraft(draftId);
    if (!draft) {
      return { verified: false, status: "error", error: "Draft not found" };
    }

    if (draft.status !== "published") {
      return {
        verified: false,
        status: draft.status === "failed" ? "error" : "pending",
        error: `Draft status is ${draft.status}, not published`,
      };
    }

    const url = draft.publishedUrl;
    if (!url) {
      return {
        verified: false,
        status: "not_found",
        error: "No published URL recorded. Check the platform manually.",
      };
    }

    // Try to fetch the published URL
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        redirect: "follow",
      });

      if (response.ok) {
        const text = await response.text();
        // Check for platform-specific "not found" / "deleted" indicators
        const notFoundIndicators = [
          "页面不存在", "内容不存在", "内容已删除", "page not found",
          "作品不见了", "笔记不见了", "视频不见了",
        ];
        const isGone = notFoundIndicators.some(ind => text.includes(ind));

        if (isGone) {
          return { verified: false, url, status: "not_found", error: "Content appears to be removed or not accessible" };
        }

        return { verified: true, url, status: "live" };
      }

      return {
        verified: false,
        url,
        status: response.status === 404 ? "not_found" : "error",
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    } catch (e: any) {
      return {
        verified: false,
        url,
        status: "error",
        error: `Failed to verify URL: ${e.message}`,
      };
    }
  }

  // ─── Risk Assessment ────────────────────────────────────────────────────────

  /**
   * Pre-publish risk assessment: check for common publishing risks.
   * Returns risk level and actionable warnings.
   */
  assessPublishRisk(draft: PublishDraft): {
    riskLevel: "low" | "medium" | "high";
    warnings: string[];
  } {
    const warnings: string[] = [];

    // Content length checks
    if (draft.title.length === 0) warnings.push("Missing title — post may be rejected");
    if (draft.title.length > 50) warnings.push("Title exceeds 50 chars — may be truncated by platform");
    if (draft.description.length > 1000) warnings.push("Description exceeds 1000 chars — may be truncated");

    // Platform-specific limits
    if (draft.platform === "douyin" && draft.title.length > 55) {
      warnings.push("抖音标题限制55字，当前可能超限");
    }
    if (draft.platform === "xiaohongshu" && draft.description.length > 1000) {
      warnings.push("小红书正文限制1000字");
    }

    // Hashtag checks
    if (draft.hashtags.length === 0) warnings.push("No hashtags — discoverability will be limited");
    if (draft.hashtags.length > 10) warnings.push("Too many hashtags — may look spammy");

    // Media checks
    if (draft.mediaFiles.length === 0) warnings.push("No media files — most platforms require images or video");
    if (draft.mediaFiles.length > 9 && draft.platform === "xiaohongshu") {
      warnings.push("小红书最多9张图片/视频，当前超过限制");
    }

    // Session check
    if (!this.hasValidSession(draft.platform)) {
      warnings.push(`No valid session for ${PLATFORM_URLS[draft.platform].name} — login required to publish`);
    }

    let riskLevel: "low" | "medium" | "high" = "low";
    if (warnings.filter(w => w.includes("login") || w.includes("limit") || w.includes("reject")).length > 0) {
      riskLevel = "high";
    } else if (warnings.length >= 3) {
      riskLevel = "medium";
    }

    return { riskLevel, warnings };
  }

  // ─── Session Helpers ───────────────────────────────────────────────────────

  private async loadSessions(): Promise<void> {
    try {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(this.config.sessionsDir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const session = JSON.parse(
            await readFile(join(this.config.sessionsDir, file), "utf8")
          ) as SessionState;
          if (new Date(session.expiresAt).getTime() > Date.now()) {
            this.sessions.set(session.platform, session);
          }
        } catch { /* skip */ }
      }
      console.log(`[SocialPublishBridge] Loaded ${this.sessions.size} active sessions`);
    } catch { /* no sessions yet */ }
  }

  private async saveDraft(draft: PublishDraft): Promise<void> {
    await writeFile(
      join(this.config.draftsDir, `${draft.id}.json`),
      JSON.stringify(draft, null, 2),
      "utf8"
    );
  }
}
