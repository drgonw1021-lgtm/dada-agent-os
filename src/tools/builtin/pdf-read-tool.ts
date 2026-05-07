import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

export interface PdfReadInput {
  path: string;
  /** Page range: "1-5" or "1,3,5" */
  pages?: string;
}

export interface PdfReadOutput {
  success: boolean;
  text?: string;
  pageCount?: number;
  error?: string;
  method?: "python" | "raw";
}

function extractWithPython(filePath: string, pages?: string): string | null {
  try {
    let script: string;
    if (pages) {
      script = `
import sys
try:
    import pdfplumber
    with pdfplumber.open(sys.argv[1]) as pdf:
        text = ""
        pages = [int(p.strip())-1 for p in "${pages}".replace(",", " ").split() if p.strip()]
        for i in (pages or range(len(pdf.pages))):
            if i < len(pdf.pages):
                text += pdf.pages[i].extract_text() or ""
        print(text[:5000])
except ImportError:
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(sys.argv[1])
        pages = [int(p.strip())-1 for p in "${pages}".replace(",", " ").split() if p.strip()]
        for i in (pages or range(len(reader.pages))):
            if i < len(reader.pages):
                print(reader.pages[i].extract_text() or "")
    except ImportError:
        print("__NO_PYTHON_PDF__")
`;
    } else {
      script = `
import sys
try:
    import pdfplumber
    with pdfplumber.open(sys.argv[1]) as pdf:
        for page in pdf.pages[:10]:
            text = page.extract_text()
            if text: print(text[:5000])
except ImportError:
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(sys.argv[1])
        for page in reader.pages[:10]:
            print(page.extract_text() or "")
    except ImportError:
        print("__NO_PYTHON_PDF__")
`;
    }

    const result = execSync(`python -c "${script.replace(/"/g, '\\"').replace(/\n/g, '; ')}" "${filePath}"`, {
      timeout: 30000,
      stdio: "pipe",
      shell: true,
    } as any);
    const output = result.toString().trim();
    if (output.includes("__NO_PYTHON_PDF__") || !output) return null;
    return output;
  } catch {
    return null;
  }
}

function extractRaw(filePath: string): string | null {
  try {
    const buffer = readFileSync(filePath);
    const text = buffer.toString("utf-8");
    // Basic PDF text extraction: look for text between BT/ET markers
    const btEtMatches = text.match(/BT\s*([\s\S]*?)\s*ET/g);
    if (btEtMatches && btEtMatches.length > 0) {
      const extracted = btEtMatches
        .map((m) => {
          const tj = m.match(/\(([^)]*)\)\s*Tj/g);
          if (tj) return tj.map((t) => t.match(/\(([^)]*)\)/)?.[1] || "").join("");
          return "";
        })
        .join("\n")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .trim();
      if (extracted) return extracted.substring(0, 10000);
    }
    return null;
  } catch {
    return null;
  }
}

export function createPdfReadTool(): ToolDefinition<PdfReadInput, PdfReadOutput> {
  return {
    id: "pdf.read",
    description: "Read and extract text from PDF files. Uses Python (pdfplumber/PyPDF2) if available, with raw fallback. " +
      "Install Python PDF support: pip install pdfplumber or pip install PyPDF2",
    requiredScopes: ["filesystem.read"] as PermissionScope[],
    riskLevel: "low",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the PDF file" },
        pages: { type: "string", description: "Page range to extract, e.g. '1-5' or '1,3,5' (default: first 10 pages)" },
      },
      required: ["path"],
    },
    async execute(input: PdfReadInput, _context: ToolContext): Promise<PdfReadOutput> {
      if (!existsSync(input.path)) {
        return { success: false, error: `File not found: ${input.path}` };
      }

      // Try Python extraction first
      const pythonText = extractWithPython(input.path, input.pages);
      if (pythonText) {
        return {
          success: true,
          text: pythonText,
          pageCount: pythonText.split("\f").length || 1,
          method: "python",
        };
      }

      // Fall back to raw extraction
      const rawText = extractRaw(input.path);
      if (rawText) {
        return { success: true, text: rawText, method: "raw" };
      }

      return {
        success: false,
        error: "Could not extract text from PDF. Install Python PDF support: pip install pdfplumber",
      };
    },
  };
}
