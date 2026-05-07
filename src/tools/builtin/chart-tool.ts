import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";

export interface ChartInput {
  /** Chart type */
  type: "bar" | "line" | "pie" | "doughnut" | "radar" | "scatter" | "polarArea";
  /** Data labels */
  labels: string[];
  /** Dataset(s) */
  datasets: Array<{
    label?: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string | string[];
  }>;
  /** Chart title */
  title?: string;
  /** Output path (e.g., "charts/market_share.png") */
  outputPath?: string;
  /** Width in pixels (default 800) */
  width?: number;
  /** Height in pixels (default 500) */
  height?: number;
}

export interface ChartOutput {
  success: boolean;
  /** Path to the generated chart image, relative to working directory */
  path?: string;
  /** Base64-encoded PNG data (if no outputPath specified) */
  base64?: string;
  error?: string;
}

// Color palette for charts
const COLORS = [
  "rgba(54, 162, 235, 0.8)",
  "rgba(255, 99, 132, 0.8)",
  "rgba(255, 206, 86, 0.8)",
  "rgba(75, 192, 192, 0.8)",
  "rgba(153, 102, 255, 0.8)",
  "rgba(255, 159, 64, 0.8)",
  "rgba(199, 199, 199, 0.8)",
  "rgba(83, 102, 255, 0.8)",
];

const BORDER_COLORS = [
  "rgba(54, 162, 235, 1)",
  "rgba(255, 99, 132, 1)",
  "rgba(255, 206, 86, 1)",
  "rgba(75, 192, 192, 1)",
  "rgba(153, 102, 255, 1)",
  "rgba(255, 159, 64, 1)",
  "rgba(199, 199, 199, 1)",
  "rgba(83, 102, 255, 1)",
];

export function createChartTool(): ToolDefinition<ChartInput, ChartOutput> {
  return {
    id: "gen.chart",
    description:
      "Generate chart images (PNG) for reports and presentations. Supports bar, line, pie, doughnut, radar, scatter, and polarArea charts. Outputs a PNG file you can reference in reports.",
    requiredScopes: ["web.fetch"] as PermissionScope[],
    riskLevel: "low",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["bar", "line", "pie", "doughnut", "radar", "scatter", "polarArea"],
          description: "Chart type",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Labels for each data point",
        },
        datasets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Dataset label" },
              data: { type: "array", items: { type: "number" }, description: "Data values" },
              backgroundColor: { type: "string", description: "Override background color(s)" },
              borderColor: { type: "string", description: "Override border color(s)" },
            },
            required: ["data"],
          },
          description: "One or more datasets",
        },
        title: { type: "string", description: "Chart title" },
        outputPath: {
          type: "string",
          description: "File path to save the chart image. If omitted, returns base64.",
        },
        width: { type: "number", description: "Width in pixels (default 800)" },
        height: { type: "number", description: "Height in pixels (default 500)" },
      },
      required: ["type", "labels", "datasets"],
    },
    async execute(input: ChartInput, _context: ToolContext): Promise<ChartOutput> {
      try {
        const { type, labels, title, outputPath, width = 800, height = 500 } = input;

        // Auto-assign colors if not provided
        const datasets = input.datasets.map((ds, i) => ({
          ...ds,
          backgroundColor: ds.backgroundColor || (type === "pie" || type === "doughnut" || type === "polarArea"
            ? COLORS.slice(0, labels.length)
            : COLORS[i % COLORS.length]),
          borderColor: ds.borderColor || (type === "pie" || type === "doughnut" || type === "polarArea"
            ? BORDER_COLORS.slice(0, labels.length)
            : BORDER_COLORS[i % BORDER_COLORS.length]),
        }));

        const chartConfig: Record<string, unknown> = {
          type,
          data: { labels, datasets },
          options: {
            responsive: false,
            plugins: {
              legend: { display: datasets.length > 1 || type === "pie" || type === "doughnut" },
              title: title ? { display: true, text: title, font: { size: 18 } } : undefined,
            },
            scales: type === "pie" || type === "doughnut" || type === "polarArea"
              ? undefined
              : {
                  y: { beginAtZero: true },
                },
          },
        };

        const chartUrl = `https://quickchart.io/chart?w=${width}&h=${height}&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;

        console.log(`[gen.chart] Generating ${type} chart (${width}x${height})`);

        const response = await fetch(chartUrl, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) {
          return { success: false, error: `QuickChart returned ${response.status}: ${response.statusText}` };
        }

        const buffer = Buffer.from(await response.arrayBuffer());

        if (outputPath) {
          const { writeFileSync, mkdirSync } = await import("node:fs");
          const { dirname } = await import("node:path");
          const dir = dirname(outputPath);
          if (dir && dir !== ".") {
            mkdirSync(dir, { recursive: true });
          }
          writeFileSync(outputPath, buffer);
          console.log(`[gen.chart] Saved to ${outputPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
          return { success: true, path: outputPath };
        }

        return {
          success: true,
          base64: buffer.toString("base64"),
        };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
