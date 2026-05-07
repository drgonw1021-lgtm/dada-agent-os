import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { deflate } from "node:zlib";
import { promisify } from "node:util";
const deflateAsync = promisify(deflate);
import type { TaskArtifact, TaskResult } from "../core/types.js";
import type { TaskRecord } from "./task-store.js";
import { resolveArtifactFormats, resolveTaskIntent } from "./task-intent.js";

function sanitizeName(value: string): string {
  return value
    .replace(/[^\w一-龥\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "task";
}

function buildMarkdown(task: TaskRecord, result: TaskResult): string {
  const intent = resolveTaskIntent({
    goal: task.goal,
    taskType: task.taskType,
    outputFormat: task.outputFormat,
    attachments: task.attachments
  });

  return [
    `# ${task.goal}`,
    "",
    `- Task ID: ${task.taskId}`,
    `- Task Type: ${intent.taskType}`,
    `- Output: ${intent.outputFormat}`,
    `- Delivery: ${intent.delivery.resultLabel}`,
    `- Primary Artifact: ${intent.delivery.primaryArtifact}`,
    `- Success: ${result.success ? "yes" : "no"}`,
    result.verificationReason ? `- Verification: ${result.verificationReason}` : "",
    "",
    "## Workflow",
    "",
    `- Routed as: ${intent.workflowLabel}`,
    `- Why: ${intent.routingReason}`,
    `- Deliverables: ${intent.deliverables.join("; ")}`,
    `- Completion: ${intent.delivery.completionDefinition}`,
    "",
    "## Summary",
    "",
    result.summary,
    "",
    "## Steps",
    "",
    ...result.steps.map((step) =>
      [
        `### Step ${step.step} ${step.tool ? `- ${step.tool}` : ""}`.trim(),
        "",
        `- Action: ${step.action}`,
        step.reasoning ? `- Reasoning: ${step.reasoning}` : "",
        step.result ? `- Result: \`\`\`json\n${JSON.stringify(step.result, null, 2)}\n\`\`\`` : "",
        ""
      ]
        .filter(Boolean)
        .join("\n")
    )
  ]
    .filter(Boolean)
    .join("\n");
}

// ── PDF generation (supports Latin + CJK via CID font) ──────────────

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 50;
const MARGIN_Y = 50;
const LINE_HEIGHT = 14;
const FONT_SIZE = 11;
const CHARS_PER_LINE_LATIN = 95;
const CHARS_PER_LINE_CJK = 45;

function hasCJK(text: string): boolean {
  return /[一-鿿㐀-䶿豈-﫿]/.test(text);
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function toUtf16BEHex(text: string): string {
  const hexParts: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    hexParts.push(((code >> 8) & 0xff).toString(16).padStart(2, "0"));
    hexParts.push((code & 0xff).toString(16).padStart(2, "0"));
  }
  return hexParts.join("");
}

function wrapLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) return [line];
  const result: string[] = [];
  let remaining = line;
  while (remaining.length > maxChars) {
    result.push(remaining.slice(0, maxChars));
    remaining = remaining.slice(maxChars);
  }
  if (remaining) result.push(remaining);
  return result;
}

function buildPdfPageStream(
  lines: string[],
  useCJK: boolean,
  pdfFontKey: string,
  pageY: number
): { stream: string; linesConsumed: number } {
  const maxLinesPerPage = Math.floor((PAGE_HEIGHT - MARGIN_Y * 2) / LINE_HEIGHT);
  const pageLines = lines.slice(0, maxLinesPerPage);
  const maxChars = useCJK ? CHARS_PER_LINE_CJK : CHARS_PER_LINE_LATIN;

  const wrappedLines: string[] = [];
  for (const line of pageLines) {
    wrappedLines.push(...wrapLine(line, maxChars));
  }

  const contentLines: string[] = ["BT", `/${pdfFontKey} ${FONT_SIZE} Tf`];
  let y = pageY;

  for (let i = 0; i < wrappedLines.length && i < maxLinesPerPage; i++) {
    const text = wrappedLines[i]!.slice(0, useCJK ? 90 : 190);
    if (i === 0) {
      contentLines.push(`${MARGIN_X} ${y} Td`);
    } else {
      y -= LINE_HEIGHT;
      contentLines.push(`0 -${LINE_HEIGHT} Td`);
    }

    if (useCJK) {
      const hex = toUtf16BEHex(text);
      contentLines.push(`<${hex}> Tj`);
    } else {
      const escaped = escapePdfText(text);
      contentLines.push(`(${escaped}) Tj`);
    }
  }

  contentLines.push("ET");
  return { stream: contentLines.join("\n"), linesConsumed: pageLines.length };
}

function buildMultiPagePdf(text: string, title?: string): Buffer {
  const allLines = text.split("\n");
  const useCJK = hasCJK(text);
  const fontKey = useCJK ? "F2" : "F1";
  const totalPages = Math.ceil(allLines.length / Math.floor((PAGE_HEIGHT - MARGIN_Y * 2) / LINE_HEIGHT)) || 1;

  const pdfFonts = useCJK
    ? [
        `5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`,
        `6 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj`,
        `7 0 obj << /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /Identity-H /DescendantFonts [8 0 R] /ToUnicode 9 0 R >> endobj`,
        `8 0 obj << /Type /Font /Subtype /CIDFontType2 /BaseFont /STSong-Light /CIDSystemInfo <</Registry (Adobe)/Ordering (GB1)/Supplement 0>> /FontDescriptor 10 0 R /DW 1000 /W [0 [600]] >> endobj`,
        `9 0 obj << /Length 0 >> stream\n/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo <</Registry (Adobe)/Ordering (GB1)/Supplement 0>> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfchar <0000> <0000> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end\nendstream endobj`,
        `10 0 obj << /Type /FontDescriptor /FontName /STSong-Light /Flags 4 /FontBBox [-500 -200 1200 900] /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >> endobj`
      ]
    : [
        `5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`,
        `6 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj`,
      ];

  const fontResource = useCJK
    ? "/Font << /F1 5 0 R /F2 7 0 R /F3 6 0 R >>"
    : "/Font << /F1 5 0 R /F2 6 0 R >>";

  const pageContents: string[] = [];
  let remainingLines = [...allLines];
  let pageIndex = 0;

  while (remainingLines.length > 0) {
    const pageY = PAGE_HEIGHT - MARGIN_Y;
    const { stream, linesConsumed } = buildPdfPageStream(remainingLines, useCJK, fontKey, pageY);
    // Add header and footer
    const headerTitle = title ? `/${fontKey !== "F1" ? "F2" : "F2"} 8 Tf 0 0 0 rg ${MARGIN_X} ${PAGE_HEIGHT - 30} Td (${escapePdfText(title.slice(0, 80))}) Tj` : "";
    const footerText = `/${fontKey !== "F1" ? "F1" : "F1"} 7 Tf 0.4 0.4 0.4 rg ${PAGE_WIDTH - 100} 25 Td (Page ${pageIndex + 1} of ${totalPages}) Tj`;
    const fullStream = `BT\n${headerTitle}\n${footerText}\nET\n${stream}`;
    pageContents.push(fullStream);
    remainingLines = remainingLines.slice(linesConsumed);
    pageIndex++;
  }

  const objects: string[] = [];
  let nextObjNum = 1;

  // 1: Catalog
  const catalogNum = nextObjNum++;
  // 2: Pages
  const pagesNum = nextObjNum++;
  // 3..N: Page objects
  const pageNums: number[] = [];
  const contentNums: number[] = [];
  for (let i = 0; i < pageContents.length; i++) {
    pageNums.push(nextObjNum++);
    contentNums.push(nextObjNum++);
  }
  const fontStart = nextObjNum;

  // Build page tree entries
  const kids = pageNums.map((n) => `${n} 0 R`).join(" ");
  objects.push(`${catalogNum} 0 obj << /Type /Catalog /Pages ${pagesNum} 0 R >> endobj`);
  objects.push(`${pagesNum} 0 obj << /Type /Pages /Kids [${kids}] /Count ${pageContents.length} >> endobj`);

  for (let i = 0; i < pageContents.length; i++) {
    const streamLen = Buffer.byteLength(pageContents[i]!, "utf8");
    objects.push(`${pageNums[i]} 0 obj << /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentNums[i]} 0 R /Resources << ${fontResource} >> >> endobj`);
    objects.push(`${contentNums[i]} 0 obj << /Length ${streamLen} >> stream\n${pageContents[i]}\nendstream endobj`);
  }

  objects.push(...pdfFonts);

  // Build PDF
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${obj}\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  const totalObjects = objects.length + 1;
  pdf += `xref\n0 ${totalObjects}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]!).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${totalObjects} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

// ── Slides HTML ─────────────────────────────────────────────────────

function buildSlidesHtml(task: TaskRecord, result: TaskResult): string {
  const intent = resolveTaskIntent({
    goal: task.goal,
    taskType: task.taskType,
    outputFormat: task.outputFormat,
    attachments: task.attachments
  });
  const slides = [
    {
      title: "Task Goal",
      body: task.goal
    },
    {
      title: "Executive Summary",
      body: result.summary
    },
    {
      title: "Workflow",
      body: [
        `Type: ${intent.taskType}`,
        `Output: ${intent.outputFormat}`,
        `Delivery: ${intent.delivery.resultLabel}`,
        `Deliverables: ${intent.deliverables.join(", ")}`
      ].join("\n")
    },
    ...result.steps.slice(0, 6).map((step) => ({
      title: `Step ${step.step}`,
      body: step.reasoning || JSON.stringify(step.result ?? {}, null, 2)
    }))
  ];

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${task.goal}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0; background: #0f172a; color: #eef2ff; }
    .deck { display: grid; gap: 24px; padding: 24px; }
    .slide { background: #111827; border: 1px solid #334155; border-radius: 20px; padding: 32px; min-height: 360px; }
    h1 { margin-top: 0; font-size: 32px; }
    pre, p { white-space: pre-wrap; word-break: break-word; line-height: 1.7; }
  </style>
</head>
<body>
  <main class="deck">
    ${slides
      .map(
        (slide) => `<section class="slide"><h1>${slide.title}</h1><p>${slide.body}</p></section>`
      )
      .join("")}
  </main>
</body>
</html>`;
}

// ── PPTX generation (native, no dependency) ───────────────────────────

async function buildZip(files: Array<{ name: string; data: Buffer }>): Promise<Buffer> {
  // Compress all files async first (yields event loop between files)
  const compressedFiles: Array<{ name: string; data: Buffer; compressed: Buffer; crc: number }> = [];
  for (const { name, data } of files) {
    const compressed = await deflateAsync(data);
    compressedFiles.push({ name, data, compressed, crc: crc32(data) });
  }

  const chunks: Buffer[] = [];
  const cdEntries: Array<{ name: string; offset: number; crc: number; size: number; compressedSize: number }> = [];
  let offset = 0;

  for (const { name, data, compressed, crc } of compressedFiles) {
    const nameBytes = Buffer.from(name, "utf8");

    // Local file header
    const localHeader = Buffer.alloc(30 + nameBytes.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4);          // version needed
    localHeader.writeUInt16LE(0, 6);           // flags
    localHeader.writeUInt16LE(8, 8);           // compression (8 = deflate)
    localHeader.writeUInt16LE(0, 10);          // mod time
    localHeader.writeUInt16LE(0, 12);          // mod date
    localHeader.writeUInt32LE(crc, 14);        // crc32
    localHeader.writeUInt32LE(compressed.length, 18); // compressed size
    localHeader.writeUInt32LE(data.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26); // filename length
    localHeader.writeUInt16LE(0, 28);          // extra field length
    nameBytes.copy(localHeader, 30);

    chunks.push(localHeader, compressed);
    cdEntries.push({ name, offset, crc, size: data.length, compressedSize: compressed.length });
    offset += localHeader.length + compressed.length;
  }

  const cdOffset = offset;
  for (const entry of cdEntries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0);  // central dir signature
    cd.writeUInt16LE(20, 4);          // version made by
    cd.writeUInt16LE(20, 6);          // version needed
    cd.writeUInt16LE(0, 8);           // flags
    cd.writeUInt16LE(8, 10);          // compression
    cd.writeUInt16LE(0, 12);          // mod time
    cd.writeUInt16LE(0, 14);          // mod date
    cd.writeUInt32LE(entry.crc, 16);  // crc32
    cd.writeUInt32LE(entry.compressedSize, 20);
    cd.writeUInt32LE(entry.size, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);          // extra length
    cd.writeUInt16LE(0, 32);          // comment length
    cd.writeUInt16LE(0, 34);          // disk start
    cd.writeUInt16LE(0, 36);          // internal attrs
    cd.writeUInt32LE(0, 38);          // external attrs
    cd.writeUInt32LE(entry.offset, 42);
    nameBytes.copy(cd, 46);
    chunks.push(cd);
    offset += cd.length;
  }

  const cdEndOffset = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);  // EOCD signature
  eocd.writeUInt16LE(0, 4);           // disk number
  eocd.writeUInt16LE(0, 6);           // cd start disk
  eocd.writeUInt16LE(cdEntries.length, 8);  // cd entries on disk
  eocd.writeUInt16LE(cdEntries.length, 10); // total cd entries
  eocd.writeUInt32LE(offset - cdOffset, 12); // cd size
  eocd.writeUInt32LE(cdOffset, 16);    // cd offset
  eocd.writeUInt16LE(0, 20);          // comment length
  chunks.push(eocd);

  return Buffer.concat(chunks);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pptxEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildPptxBodyParagraphs(text: string, maxLines: number): string[] {
  const lines = text.split("\n");
  const result: string[] = [];
  let count = 0;

  for (const rawLine of lines) {
    if (count >= maxLines) break;
    let line = rawLine.trim();
    if (!line) continue;

    const bulletMatch = line.match(/^(\s*)([-*•▪▸]\s*|(\d+[.)]\s*))(.+)$/);
    if (bulletMatch) {
      const indentLevel = Math.min(bulletMatch[1]!.length, 6); // 0, 2, 4, 6
      const bulletText = bulletMatch[4]!.trim().substring(0, 200);
      const marginLeft = 685800 + indentLevel * 500000;
      result.push(
        `<a:p>` +
        `<a:pPr marL="${marginLeft}" indent="-285750"/>` +
        `<a:r><a:rPr lang="zh-CN" sz="1200" b="0"/><a:t>${pptxEscape("• " + bulletText)}</a:t></a:r>` +
        `</a:p>`
      );
    } else if (line.startsWith("#")) {
      // Heading
      const headingText = line.replace(/^#+\s*/, "").substring(0, 150);
      result.push(
        `<a:p><a:r><a:rPr lang="zh-CN" sz="1600" b="1"/><a:t>${pptxEscape(headingText)}</a:t></a:r></a:p>`
      );
    } else if (line.startsWith("```")) {
      // Code block delimiter — skip the fence line itself
      continue;
    } else if (line.startsWith("`") && line.endsWith("`") && line.length <= 60) {
      // Inline code
      result.push(
        `<a:p><a:r><a:rPr lang="zh-CN" sz="1100" i="1"/><a:t>${pptxEscape("  " + line.replace(/`/g, "").substring(0, 180))}</a:t></a:r></a:p>`
      );
    } else {
      // Normal text
      result.push(
        `<a:p><a:r><a:rPr lang="zh-CN" sz="1300"/><a:t>${pptxEscape(line.substring(0, 200))}</a:t></a:r></a:p>`
      );
    }
    count++;
  }
  return result;
}

function buildPptxXml(task: TaskRecord, result: TaskResult): string[][] {
  const intent = resolveTaskIntent({
    goal: task.goal, taskType: task.taskType,
    outputFormat: task.outputFormat, attachments: task.attachments
  });

  const slides: string[][] = [];

  // Slide 1: Title
  slides.push([
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">`,
    `<p:cSld><p:spTree>`,
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`,
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`,
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>`,
    `<p:spPr><a:xfrm><a:off x="685800" y="2130425"/><a:ext cx="7772400" cy="1470025"/></a:xfrm></p:spPr>`,
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="3200" b="1"/><a:t>${pptxEscape(task.goal)}</a:t></a:r><a:endParaRPr/></a:p></p:txBody>`,
    `</p:sp>`,
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Subtitle"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="subTitle" idx="1"/></p:nvPr></p:nvSpPr>`,
    `<p:spPr><a:xfrm><a:off x="1371600" y="3886200"/><a:ext cx="6400800" cy="914400"/></a:xfrm></p:spPr>`,
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="1800"/><a:t>${pptxEscape(intent.workflowLabel)} — ${pptxEscape(result.summary.substring(0, 120))}</a:t></a:r></a:p></p:txBody>`,
    `</p:sp>`,
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  ]);

  // Content slides from steps
  let slideNum = 0;
  for (const step of result.steps.slice(0, 16)) {
    slideNum++;
    const text = step.reasoning || (step.result ? JSON.stringify(step.result, null, 2) : "No details");
    const contentParagraphs = buildPptxBodyParagraphs(text, 16);
    slides.push([
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">`,
      `<p:cSld><p:spTree>`,
      `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`,
      `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`,
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>`,
      `<p:spPr><a:xfrm><a:off x="685800" y="274638"/><a:ext cx="7772400" cy="731519"/></a:xfrm></p:spPr>`,
      `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="2400" b="1"/><a:t>Step ${slideNum}: ${step.action}${step.tool ? " — " + pptxEscape(step.tool) : ""}</a:t></a:r></a:p></p:txBody>`,
      `</p:sp>`,
      `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>`,
      `<p:spPr><a:xfrm><a:off x="685800" y="1200000"/><a:ext cx="7772400" cy="5000000"/></a:xfrm></p:spPr>`,
      `<p:txBody><a:bodyPr/><a:lstStyle/>`,
      ...contentParagraphs,
      `</p:txBody></p:sp>`,
      `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
    ]);
  }

  // Summary slide
  const summaryLines = buildPptxBodyParagraphs(result.summary, 10);
  slides.push([
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">`,
    `<p:cSld><p:spTree>`,
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`,
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`,
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>`,
    `<p:spPr><a:xfrm><a:off x="685800" y="274638"/><a:ext cx="7772400" cy="731519"/></a:xfrm></p:spPr>`,
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="2400" b="1"/><a:t>Summary</a:t></a:r></a:p></p:txBody>`,
    `</p:sp>`,
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>`,
    `<p:spPr><a:xfrm><a:off x="685800" y="1200000"/><a:ext cx="7772400" cy="5000000"/></a:xfrm></p:spPr>`,
    `<p:txBody><a:bodyPr/><a:lstStyle/>`,
    ...summaryLines,
    `<a:p><a:r><a:rPr lang="zh-CN" sz="1200" b="1"/><a:t>——</a:t></a:r></a:p>`,
    `<a:p><a:r><a:rPr lang="zh-CN" sz="1200"/><a:t>Task Type: ${pptxEscape(intent.taskType)} | Output: ${pptxEscape(intent.outputFormat)} | Success: ${result.success ? "Yes" : "No"}</a:t></a:r></a:p>`,
    `<a:p><a:r><a:rPr lang="zh-CN" sz="1200"/><a:t>Deliverables: ${pptxEscape(intent.deliverables.join("; "))}</a:t></a:r></a:p>`,
    `</p:txBody></p:sp>`,
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  ]);

  return slides;
}

async function buildPptxFile(task: TaskRecord, result: TaskResult): Promise<Buffer> {
  const slides = buildPptxXml(task, result);
  const slideRefs = slides.map((_, i) => {
    const id = 256 + i;
    return `<p:sldId id="${id}" r:id="rId${id}"/>`;
  }).join("");

  const slideRels = slides.map((_, i) => {
    const id = 256 + i;
    return `<Relationship Id="rId${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`;
  }).join("");

  const files: Array<{ name: string; data: Buffer }> = [
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
        `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
        slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("") +
        `</Types>`, "utf8")
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>` +
        `</Relationships>`, "utf8")
    },
    {
      name: "ppt/_rels/presentation.xml.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        slideRels +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>` +
        `</Relationships>`, "utf8")
    },
    {
      name: "ppt/presentation.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
        `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
        `<p:sldIdLst>${slideRefs}</p:sldIdLst>` +
        `<p:sldSz cx="9144000" cy="6858000"/>` +
        `<p:notesSz cx="6858000" cy="9144000"/>` +
        `</p:presentation>`, "utf8")
    },
    {
      name: "ppt/theme/theme1.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="DaDa">` +
        `<a:themeElements><a:clrScheme name="DaDa"><a:dk1><a:srgbClr val="0F172A"/></a:dk1><a:lt1><a:srgbClr val="EEF2FF"/></a:lt1><a:dk2><a:srgbClr val="1E293B"/></a:dk2><a:lt2><a:srgbClr val="CBD5E1"/></a:lt2><a:accent1><a:srgbClr val="3B82F6"/></a:accent1><a:accent2><a:srgbClr val="10B981"/></a:accent2><a:accent3><a:srgbClr val="F59E0B"/></a:accent3><a:accent4><a:srgbClr val="EF4444"/></a:accent4><a:accent5><a:srgbClr val="8B5CF6"/></a:accent5><a:accent6><a:srgbClr val="EC4899"/></a:accent6><a:hlink><a:srgbClr val="3B82F6"/></a:hlink><a:folHlink><a:srgbClr val="8B5CF6"/></a:folHlink></a:clrScheme>` +
        `<a:fontScheme name="DaDa"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface="Microsoft YaHei"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="Microsoft YaHei"/></a:minorFont></a:fontScheme>` +
        `<a:fmtScheme name="DaDa"><a:fillStyleLst><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="12700"><a:solidFill><a:srgbClr val="3B82F6"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst/><a:bgFillStyleLst><a:solidFill><a:srgbClr val="0F172A"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>` +
        `</a:themeElements></a:theme>`, "utf8")
    }
  ];

  // Add slide files
  for (let i = 0; i < slides.length; i++) {
    files.push({
      name: `ppt/slides/slide${i + 1}.xml`,
      data: Buffer.from(slides[i]!.join("\n"), "utf8")
    });
  }

  return await buildZip(files);
}

// ── Direct artifacts ─────────────────────────────────────────────────

async function collectDirectArtifacts(result: TaskResult): Promise<TaskArtifact[]> {
  const artifacts: TaskArtifact[] = [];

  for (const step of result.steps) {
    const output = step.result as { file?: string; url?: string; action?: string } | undefined;
    if (!output?.file) {
      continue;
    }
    try {
      const info = await stat(output.file);
      const lower = output.file.toLowerCase();
      const kind = lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg")
        ? "image"
        : lower.endsWith(".mp4") || lower.endsWith(".mov")
          ? "video"
          : lower.endsWith(".mp3") || lower.endsWith(".wav")
            ? "audio"
            : "file";
      const mimeType = kind === "image"
        ? lower.endsWith(".png") ? "image/png" : "image/jpeg"
        : kind === "video"
          ? "video/mp4"
          : kind === "audio"
            ? lower.endsWith(".wav") ? "audio/wav" : "audio/mpeg"
            : "application/octet-stream";

      artifacts.push({
        id: randomUUID(),
        name: output.file.split(/[\\/]/).pop() || output.file,
        kind,
        path: output.file,
        url: `/api/artifacts/file?path=${encodeURIComponent(output.file)}`,
        mimeType,
        size: info.size
      });
    } catch {
      // Ignore files that no longer exist.
    }
  }

  return artifacts;
}

// ── ArtifactGenerator ────────────────────────────────────────────────

export class ArtifactGenerator {
  constructor(private readonly rootDir: string) {}

  async generate(task: TaskRecord, result: TaskResult): Promise<TaskArtifact[]> {
    const formats = resolveArtifactFormats(task);
    const directArtifacts = await collectDirectArtifacts(result);
    if (formats.length === 0) {
      return [...(result.artifacts ?? []), ...directArtifacts];
    }

    const dir = resolve(this.rootDir, sanitizeName(task.taskId));
    await mkdir(dir, { recursive: true });
    const base = `${sanitizeName(task.goal)}-${task.taskId.slice(0, 8)}`;
    const markdown = buildMarkdown(task, result);
    const artifacts: TaskArtifact[] = [];

    const addArtifact = async (
      fileName: string,
      kind: TaskArtifact["kind"],
      mimeType: string,
      data: string | Buffer
    ) => {
      const filePath = resolve(dir, fileName);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, data);
      const info = await stat(filePath);
      artifacts.push({
        id: randomUUID(),
        name: fileName,
        kind,
        path: filePath,
        url: `/api/artifacts/file?path=${encodeURIComponent(filePath)}`,
        mimeType,
        size: info.size
      });
    };

    if (formats.includes("markdown")) {
      await addArtifact(`${base}.md`, "markdown", "text/markdown; charset=utf-8", markdown);
    }

    if (formats.includes("pdf")) {
      await addArtifact(`${base}.pdf`, "pdf", "application/pdf", buildMultiPagePdf(markdown, task.goal));
    }

    if (formats.includes("slides")) {
      await addArtifact(`${base}.slides.html`, "slides", "text/html; charset=utf-8", buildSlidesHtml(task, result));
      await addArtifact(`${base}.pptx`, "slides", "application/vnd.openxmlformats-officedocument.presentationml.presentation", await buildPptxFile(task, result));
    }

    if (formats.includes("data")) {
      await addArtifact(`${base}.json`, "data", "application/json; charset=utf-8", JSON.stringify(result, null, 2));
    }

    if (formats.includes("publish_package")) {
      await addArtifact(
        `${base}.publish.json`,
        "publish_package",
        "application/json; charset=utf-8",
        JSON.stringify(
          {
            taskId: task.taskId,
            goal: task.goal,
            summary: result.summary,
            verificationReason: result.verificationReason,
            steps: result.steps,
            publishSafety: {
              requiresAccountSession: true,
              requiresExplicitApproval: true,
              proofRequiredBeforeClaimingPublished: true
            }
          },
          null,
          2
        )
      );
    }

    return [...directArtifacts, ...artifacts];
  }
}
