import { exec, spawn } from "node:child_process";
import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";

export interface NotifyInput {
  action: "email" | "slack" | "discord" | "sms" | "system";
  to?: string;
  subject?: string;
  message?: string;
  channel?: string;
  webhook?: string;
}

export interface NotifyOutput {
  success: boolean;
  result?: string;
  error?: string;
}

export function createNotifyTool(): ToolDefinition<NotifyInput, NotifyOutput> {
  return {
    id: "notify",
    description: "Notification tool: email, Slack, Discord, system notifications",
    requiredScopes: ["shell.exec", "web.fetch"] as PermissionScope[],
    riskLevel: "medium",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string" as const, enum: ["email", "slack", "discord", "sms", "system"], description: "Notification channel" },
        to: { type: "string" as const, description: "Recipient (email address or phone number)" },
        subject: { type: "string" as const, description: "Email subject" },
        message: { type: "string" as const, description: "Notification message content" },
        channel: { type: "string" as const, description: "Slack channel name" },
        webhook: { type: "string" as const, description: "Webhook URL for Slack/Discord (falls back to env vars)" }
      },
      required: ["action", "message"]
    },
    async execute(input: NotifyInput, _context: ToolContext): Promise<NotifyOutput> {
      try {
        switch (input.action) {
          case "email":
            return await sendEmail(input.to || "", input.subject || "", input.message || "");
          case "slack":
            return await sendSlack(input.message || "", input.channel || "", input.webhook);
          case "discord":
            return await sendDiscord(input.message || "", input.webhook);
          case "sms":
            return await sendSMS(input.to || "", input.message || "");
          case "system":
            return await sendSystemNotify(input.message || "");
          default:
            return { success: false, error: "Unknown action" };
        }
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  };
}

function shellEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

async function sendEmail(to: string, subject: string, body: string): Promise<NotifyOutput> {
  if (!process.env.SMTP_HOST) {
    return { success: false, error: "SMTP_HOST not configured" };
  }

  const smtp = shellEscape(process.env.SMTP_HOST);
  const port = shellEscape(process.env.SMTP_PORT || "587");
  const user = shellEscape(process.env.SMTP_USER || "");
  const pass = shellEscape(process.env.SMTP_PASS || "");
  const from = shellEscape(process.env.SMTP_FROM || "dada@agent.local");

  // Write email script to temp file instead of inline to avoid injection
  const scriptContent = `
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
  host: ${JSON.stringify(smtp)},
  port: ${port},
  secure: false,
  auth: { user: ${JSON.stringify(user)}, pass: ${JSON.stringify(pass)} }
});
transporter.sendMail({
  from: ${JSON.stringify(from)},
  to: ${JSON.stringify(to)},
  subject: ${JSON.stringify(subject)},
  text: ${JSON.stringify(body)}
}).then(() => console.log('Sent')).catch(e => console.error(e));
`;

  return new Promise((resolve) => {
    const child = spawn("node", ["-e", scriptContent], { shell: false, timeout: 30000 });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve({ success: true, result: `Email sent to ${to}` });
      else resolve({ success: false, error: stderr || `node exited with code ${code}` });
    });
    child.on("error", (err) => resolve({ success: false, error: err.message }));
  });
}

async function sendSlack(message: string, channel?: string, webhook?: string): Promise<NotifyOutput> {
  const url = webhook || process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    return { success: false, error: "SLACK_WEBHOOK_URL not configured" };
  }

  try {
    const payload = JSON.stringify({
      text: message,
      ...(channel && { channel })
    });

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload
    });

    return { success: true, result: "Slack message sent" };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function sendDiscord(message: string, webhook?: string): Promise<NotifyOutput> {
  const url = webhook || process.env.DISCORD_WEBHOOK_URL;
  if (!url) {
    return { success: false, error: "DISCORD_WEBHOOK_URL not configured" };
  }

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message })
    });

    return { success: true, result: "Discord message sent" };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function sendSMS(to: string, message: string): Promise<NotifyOutput> {
  if (!process.env.TWILIO_SID) {
    return { success: false, error: "TWILIO_SID not configured" };
  }

  const sid = process.env.TWILIO_SID;
  const token = process.env.TWILIO_TOKEN;
  const from = process.env.TWILIO_PHONE;

  if (!token || !from) {
    return { success: false, error: "TWILIO_TOKEN and TWILIO_PHONE must be configured" };
  }

  return new Promise((resolve) => {
    const child = spawn("curl", [
      "-X", "POST",
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages`,
      "-u", `${sid}:${token}`,
      "-d", `To=${to}`,
      "-d", `From=${from}`,
      "-d", `Body=${message}`
    ], { shell: false, timeout: 30000 });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve({ success: true, result: "SMS sent" });
      else resolve({ success: false, error: stderr || `curl exited with code ${code}` });
    });
    child.on("error", (err) => resolve({ success: false, error: err.message }));
  });
}

async function sendSystemNotify(message: string): Promise<NotifyOutput> {
  const platform = process.platform;
  const safeMsg = message.replace(/["`$\\]/g, "");

  if (platform === "win32") {
    return new Promise((resolve) => {
      const psMsg = safeMsg.replace(/'/g, "''");
      const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${psMsg}', 'Dada Agent')`;
      const child = spawn("powershell", ["-Command", ps], { shell: false, timeout: 10000 });
      child.on("close", (code) => {
        resolve({ success: code === 0, result: "Notification shown" });
      });
      child.on("error", () => resolve({ success: false, error: "PowerShell not available" }));
    });
  }

  if (platform === "darwin") {
    return new Promise((resolve) => {
      const child = spawn("osascript", ["-e", `display notification "${safeMsg}" with title "Dada Agent"`], { shell: false, timeout: 10000 });
      child.on("close", (code) => {
        resolve({ success: code === 0, result: "Notification shown" });
      });
      child.on("error", () => resolve({ success: false, error: "osascript not available" }));
    });
  }

  // Linux
  return new Promise((resolve) => {
    const child = spawn("notify-send", ["Dada Agent", safeMsg], { shell: false, timeout: 10000 });
    child.on("close", (code) => {
      resolve({ success: code === 0, result: code === 0 ? "Notification shown" : "notify-send failed" });
    });
    child.on("error", () => resolve({ success: false, error: "notify-send not available" }));
  });
}

export default createNotifyTool;
