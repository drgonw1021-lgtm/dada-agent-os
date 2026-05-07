import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";

export interface ExcelInput {
  action: "read" | "write" | "create" | "csv_to_json" | "json_to_csv" | "merge" | "filter" | "sort";
  filePath?: string;
  data?: any[];
  sheet?: string;
  headers?: string[];
  jsonPath?: string;
  key?: string;
  order?: "asc" | "desc";
}

export interface ExcelOutput {
  success: boolean;
  result?: any;
  file?: string;
  error?: string;
}

export function createExcelTool(): ToolDefinition<ExcelInput, ExcelOutput> {
  return {
    id: "excel",
    description: "Excel/CSV 工具：读取、写入、创建表格，数据转换、合并、筛选、排序",
    requiredScopes: ["filesystem.read", "filesystem.write"] as PermissionScope[],
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string" as const, enum: ["read", "write", "create", "csv_to_json", "json_to_csv", "merge", "filter", "sort"], description: "Excel/CSV operation" },
        filePath: { type: "string" as const, description: "Path to Excel/CSV file" },
        data: { type: "array" as const, description: "Array of row objects to write", items: { type: "object" as const, additionalProperties: true } },
        sheet: { type: "string" as const, description: "Sheet name for .xlsx files" },
        headers: { type: "array" as const, description: "Column headers", items: { type: "string" as const } },
        jsonPath: { type: "string" as const, description: "Path for JSON file in csv_to_json/json_to_csv operations" },
        key: { type: "string" as const, description: "Column key to filter or sort by" },
        order: { type: "string" as const, enum: ["asc", "desc"], description: "Sort order (default: asc)" }
      },
      required: ["action"]
    },
    async execute(input: ExcelInput, _context: ToolContext): Promise<ExcelOutput> {
      try {
        switch (input.action) {
          case "read":
            return await readExcel(input.filePath || "", input.sheet);
          case "write":
            return await writeExcel(input.filePath || "", input.data || [], input.headers);
          case "create":
            return await createExcel(input.filePath || "", input.data || [], input.headers || []);
          case "csv_to_json":
            return await csvToJson(input.filePath || "", input.jsonPath || "");
          case "json_to_csv":
            return await jsonToCsv(input.filePath || "", input.data || []);
          case "merge":
            return await mergeData(input.filePath || "", input.data || [], input.jsonPath);
          case "filter":
            return await filterData(input.data || [], input.key || "", input.filePath || "");
          case "sort":
            return await sortData(input.data || [], input.key || "", input.order || "asc");
          default:
            return { success: false, error: "Unknown action" };
        }
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }
  };
}

async function parseCSV(content: string): Promise<any[]> {
  const lines = content.trim().split("\n");
  if (lines.length === 0) return [];

  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  const data: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: any = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || "";
    });
    data.push(row);
  }

  return data;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function toCSV(data: any[], headers: string[]): string {
  const lines: string[] = [headers.join(",")];

  for (const row of data) {
    const values = headers.map(h => {
      const val = row[h]?.toString() || "";
      return val.includes(",") || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
    });
    lines.push(values.join(","));
  }

  return lines.join("\n");
}

async function readExcel(filePath: string, sheet?: string): Promise<ExcelOutput> {
  if (!existsSync(filePath)) {
    return { success: false, error: "File not found" };
  }

  const ext = filePath.toLowerCase();

  if (ext.endsWith(".csv")) {
    const content = await readFile(filePath, "utf-8");
    const data = await parseCSV(content);
    return { success: true, result: data, file: filePath };
  }

  return { success: false, error: "Use node-xlsx or exceljs for .xlsx. For now only CSV is supported." };
}

async function writeExcel(filePath: string, data: any[], headers?: string[]): Promise<ExcelOutput> {
  const csvHeaders = headers || Object.keys(data[0] || {});
  const csv = toCSV(data, csvHeaders);
  const outPath = filePath.replace(/\.xlsx?$/i, ".csv");
  await writeFile(outPath, csv, "utf-8");
  return { success: true, file: outPath, result: `Wrote ${data.length} rows` };
}

async function createExcel(filePath: string, data: any[], headers: string[]): Promise<ExcelOutput> {
  const csv = toCSV(data, headers);
  await writeFile(filePath, csv, "utf-8");
  return { success: true, file: filePath, result: `Created ${filePath}` };
}

async function csvToJson(csvPath: string, jsonPath: string): Promise<ExcelOutput> {
  const content = await readFile(csvPath, "utf-8");
  const data = await parseCSV(content);
  const json = JSON.stringify(data, null, 2);
  const outPath = jsonPath || csvPath.replace(/\.csv?$/i, ".json");
  await writeFile(outPath, json, "utf-8");
  return { success: true, file: outPath, result: `Converted ${data.length} rows` };
}

async function jsonToCsv(jsonPath: string, data?: any[]): Promise<ExcelOutput> {
  let jsonData = data;
  if (!jsonData) {
    if (!existsSync(jsonPath)) {
      return { success: false, error: "File not found" };
    }
    const content = await readFile(jsonPath, "utf-8");
    jsonData = JSON.parse(content);
  }

  if (!jsonData || jsonData.length === 0) {
    return { success: false, error: "No data to convert" };
  }

  const csv = toCSV(jsonData, Object.keys(jsonData[0]));
  const outPath = jsonPath.replace(/\.json$/i, ".csv");
  await writeFile(outPath, csv, "utf-8");
  return { success: true, file: outPath };
}

async function filterData(data: any[], key: string, value: string): Promise<ExcelOutput> {
  const filtered = data.filter(row => {
    const rowVal = row[key]?.toString().toLowerCase();
    return rowVal?.includes(value.toLowerCase());
  });
  return { success: true, result: filtered };
}

async function sortData(data: any[], key: string, order: "asc" | "desc"): Promise<ExcelOutput> {
  const sorted = [...data].sort((a, b) => {
    const aVal = a[key] ?? "";
    const bVal = b[key] ?? "";
    const cmp = String(aVal).localeCompare(String(bVal));
    return order === "desc" ? -cmp : cmp;
  });
  return { success: true, result: sorted };
}

async function mergeData(primaryPath: string, inlineData: any[], secondaryPath?: string): Promise<ExcelOutput> {
  let primaryRows: any[] = [];

  // Read primary file
  if (primaryPath && existsSync(primaryPath)) {
    const content = await readFile(primaryPath, "utf-8");
    primaryRows = await parseCSV(content);
  }

  // Get secondary data — from inline data or secondary file
  let secondaryRows: any[] = [];
  if (inlineData.length > 0) {
    secondaryRows = inlineData;
  } else if (secondaryPath && existsSync(secondaryPath)) {
    const content = await readFile(secondaryPath, "utf-8");
    secondaryRows = await parseCSV(content);
  }

  if (primaryRows.length === 0 && secondaryRows.length === 0) {
    return { success: false, error: "No data to merge — provide filePath with an existing CSV, data array, or jsonPath for a second CSV file" };
  }

  // Union headers
  const primaryHeaders = new Set(primaryRows.length > 0 ? Object.keys(primaryRows[0]) : []);
  const secondaryHeaders = new Set(secondaryRows.length > 0 ? Object.keys(secondaryRows[0]) : []);
  const allHeaders = [...new Set([...primaryHeaders, ...secondaryHeaders])];

  // Normalize rows to include all headers
  const normalize = (rows: any[]) => rows.map(row => {
    const normalized: any = {};
    for (const h of allHeaders) normalized[h] = row[h] ?? "";
    return normalized;
  });

  const merged = [...normalize(primaryRows), ...normalize(secondaryRows)];

  // Write output
  const outPath = primaryPath || secondaryPath?.replace(/\.csv$/i, "_merged.csv") || "merged.csv";
  const csv = toCSV(merged, allHeaders);
  await writeFile(outPath, csv, "utf-8");

  return { success: true, file: outPath, result: `Merged ${merged.length} rows (${primaryRows.length} + ${secondaryRows.length}) with ${allHeaders.length} columns` };
}

export default createExcelTool;