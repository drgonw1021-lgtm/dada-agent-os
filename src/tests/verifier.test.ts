import test from "node:test";
import assert from "node:assert/strict";
import { verifyTask, modelDrivenCritique, critiqueAndVerify, deepContentVerify, formatContentQualityForReason } from "../runtime/verifier.js";
import type { ExecutionStep } from "../core/types.js";

function exec(tool: string, step = 1): ExecutionStep {
  return { step, action: "execute", tool, result: {} };
}

function errorStep(tool: string, reasoning: string): ExecutionStep {
  return { step: 1, action: "error", tool, reasoning };
}

// ── Rule-based verifier ──────────────────────────────────────────────────────

test("verifier enforces write goals", () => {
  const ok = verifyTask("请写入文件", [exec("fs.write_file")], "done");
  assert.equal(ok.success, true);

  const fail = verifyTask("write output to file", [exec("web.fetch")], "");
  assert.equal(fail.success, false);
});

test("verifier fails on error steps with no tools attempted", () => {
  const result = verifyTask(
    "read file",
    [errorStep("fs.read_file", "denied")],
    ""
  );
  assert.equal(result.success, false);
});

test("verifier handles read intent", () => {
  const ok = verifyTask("read the config file", [exec("fs.read_file")], "done");
  assert.equal(ok.success, true);

  const fail = verifyTask("analyze file contents", [], "");
  assert.equal(fail.success, false);
});

test("verifier handles web intent", () => {
  const ok = verifyTask("fetch web page content", [exec("web.fetch")], "done");
  assert.equal(ok.success, true);

  const fail = verifyTask("visit the URL and extract data", [], "");
  assert.equal(fail.success, false);
});

test("verifier passes on auto-save", () => {
  const result = verifyTask("do something complex", [], "auto-saved report");
  assert.equal(result.success, true);
});

test("verifier fails on max steps", () => {
  const result = verifyTask("do something", [exec("search")], "max steps reached");
  assert.equal(result.success, false);
});

test("verifier detects no progress fallback", () => {
  const result = verifyTask("do something", [], "no progress in fallback");
  assert.equal(result.success, false);
});

// ── Model-driven critic ──────────────────────────────────────────────────────

test("modelDrivenCritique parses valid JSON from model", async () => {
  const mockComplete = async (_model: string, _messages: { role: string; content: string }[]) => {
    return JSON.stringify({
      success: true,
      confidence: 0.92,
      score: 8,
      reason: "Task completed successfully with well-structured output.",
      gaps: ["Could have included more citations"]
    });
  };

  const result = await modelDrivenCritique(
    mockComplete,
    "test-model",
    "Write a report on AI",
    [exec("search", 1), exec("fs.write_file", 2)],
    "Report saved",
    "research",
    "markdown"
  );

  assert.ok(result);
  assert.equal(result.success, true);
  assert.equal(result.confidence, 0.92);
  assert.equal(result.score, 8);
  assert.equal(result.gaps.length, 1);
});

test("modelDrivenCritique parses JSON in code fence", async () => {
  const mockComplete = async () => {
    return '```json\n{"success": false, "confidence": 0.45, "score": 2, "reason": "No output file created.", "gaps": ["Missing deliverable", "Incomplete research"]}\n```';
  };

  const result = await modelDrivenCritique(
    mockComplete,
    "test-model",
    "Write a report",
    [exec("search")],
    "done",
    "research",
    "markdown"
  );

  assert.ok(result);
  assert.equal(result.success, false);
  assert.equal(result.confidence, 0.45);
  assert.equal(result.score, 2);
  assert.equal(result.gaps.length, 2);
});

test("modelDrivenCritique returns null on malformed JSON", async () => {
  const mockComplete = async () => "This is just rambling text, no JSON here.";

  const result = await modelDrivenCritique(
    mockComplete,
    "test-model",
    "do something",
    [exec("search")],
    "done"
  );

  assert.equal(result, null);
});

test("modelDrivenCritique returns null on model error", async () => {
  const mockComplete = async () => { throw new Error("Model unavailable"); };

  const result = await modelDrivenCritique(
    mockComplete,
    "test-model",
    "do something",
    [exec("search")],
    "done"
  );

  assert.equal(result, null);
});

test("modelDrivenCritique clamps confidence and score", async () => {
  const mockComplete = async () => {
    return JSON.stringify({
      success: true,
      confidence: 1.5,
      score: 15,
      reason: "Overconfident",
      gaps: []
    });
  };

  const result = await modelDrivenCritique(
    mockComplete,
    "test-model",
    "do something",
    [exec("search")],
    "done"
  );

  assert.ok(result);
  assert.equal(result.confidence, 1.0);
  assert.equal(result.score, 10);
});

test("modelDrivenCritique handles missing optional fields", async () => {
  const mockComplete = async () => {
    return JSON.stringify({ success: true });
  };

  const result = await modelDrivenCritique(
    mockComplete,
    "test-model",
    "do something",
    [exec("write")],
    "done"
  );

  assert.ok(result);
  assert.equal(result.success, true);
  assert.equal(result.confidence, 0.7); // default
  assert.equal(result.score, 5); // default
  assert.equal(result.gaps.length, 0);
});

// ── Orchestrator ─────────────────────────────────────────────────────────────

test("critiqueAndVerify uses model result when available", async () => {
  const mockComplete = async () => {
    return JSON.stringify({
      success: true,
      confidence: 0.95,
      score: 9,
      reason: "Excellent work.",
      gaps: []
    });
  };

  const result = await critiqueAndVerify(
    mockComplete,
    "test-model",
    "write a file",
    [], // empty steps — rule-based would fail
    "done",
    "code",
    "markdown"
  );

  // Model says success — should override rule-based fail
  assert.equal(result.success, true);
  assert.equal(result.confidence, 0.95);
  assert.equal(result.score, 9);
});

test("critiqueAndVerify falls back to rules when model fails", async () => {
  const mockComplete = async () => { throw new Error("Down"); };

  const result = await critiqueAndVerify(
    mockComplete,
    "test-model",
    "write file",
    [exec("fs.write_file")],
    "done"
  );

  // Rule-based sees write intent + write tool = success, adds auto-confidence
  assert.equal(result.success, true);
  assert.equal(result.confidence, 0.9);
  assert.equal(result.score, undefined);
});

test("critiqueAndVerify falls back to rules when no model provided", async () => {
  const result = await critiqueAndVerify(
    undefined,
    undefined,
    "read something",
    [exec("fs.read_file")],
    "done"
  );

  assert.equal(result.success, true);
  assert.equal(result.reason, "done");
});

test("critiqueAndVerify falls back when model returns null (parse failure)", async () => {
  const mockComplete = async () => "Not JSON at all.";

  const result = await critiqueAndVerify(
    mockComplete,
    "test-model",
    "write output file",
    [exec("fs.write_file")],
    "completed"
  );

  // Falls back to rule-based — write intent with write tool = success
  assert.equal(result.success, true);
});

test("critiqueAndVerify model says fail but rules would pass", async () => {
  const mockComplete = async () => {
    return JSON.stringify({
      success: false,
      confidence: 0.6,
      score: 3,
      reason: "Output file is empty — task not truly complete.",
      gaps: ["Empty output", "No actual content generated"]
    });
  };

  const result = await critiqueAndVerify(
    mockComplete,
    "test-model",
    "write report",
    [exec("fs.write_file")],
    "File written"
  );

  // Rule-based succeeds with executed tools — short-circuits before model critic
  assert.equal(result.success, true);
  assert.equal(result.confidence, 0.9);
  assert.equal(result.gaps, undefined);
});

// ── Deep content verification ────────────────────────────────────────────────

const sampleReport = `# AI Market Analysis Report

## Executive Summary
The global AI market reached $200B in 2025, growing at 35% CAGR.

## Market Data
| Segment | 2024 | 2025 | 2026E |
|---------|------|------|-------|
| NLP     | 45B  | 62B  | 85B   |
| Vision  | 38B  | 51B  | 70B   |

## Competitive Landscape
OpenAI leads with 32% market share, followed by Anthropic at 18%.

## Recommendations
1. Invest in open-source model infrastructure
2. Build vertical AI applications for healthcare
3. Develop multilingual model capabilities

*Sources: Industry reports, public filings*`;

test("deepContentVerify parses valid content quality JSON", async () => {
  const mockComplete = async () => {
    return JSON.stringify({
      overallScore: 7,
      factualAccuracy: 6,
      completeness: 8,
      structure: 9,
      dataQuality: 5,
      citations: 4,
      strengths: ["Well-structured sections", "Clear data tables"],
      weaknesses: ["Citations lack specific sources", "Some data points unverified"],
      recommendation: "Add specific source references and verify 2026 projections."
    });
  };

  const report = await deepContentVerify(
    mockComplete,
    "test-model",
    "Research AI market and write report",
    sampleReport,
    "research",
    "markdown"
  );

  assert.ok(report);
  assert.equal(report.overallScore, 7);
  assert.equal(report.dimensions.factualAccuracy, 6);
  assert.equal(report.dimensions.completeness, 8);
  assert.equal(report.dimensions.structure, 9);
  assert.equal(report.dimensions.dataQuality, 5);
  assert.equal(report.dimensions.citations, 4);
  assert.equal(report.strengths.length, 2);
  assert.equal(report.weaknesses.length, 2);
  assert.ok(report.recommendation.length > 10);
});

test("deepContentVerify clamps dimension scores to 0-10", async () => {
  const mockComplete = async () => {
    return JSON.stringify({
      overallScore: 15,
      factualAccuracy: -2,
      completeness: 8,
      structure: 6,
      dataQuality: 99,
      citations: -5,
      strengths: [],
      weaknesses: [],
      recommendation: "ok"
    });
  };

  const report = await deepContentVerify(
    mockComplete, "test-model", "goal", sampleReport
  );

  assert.ok(report);
  assert.equal(report.overallScore, 10);
  assert.equal(report.dimensions.factualAccuracy, 0);
  assert.equal(report.dimensions.dataQuality, 10);
  assert.equal(report.dimensions.citations, 0);
});

test("deepContentVerify returns null on too-short content", async () => {
  let called = false;
  const mockComplete = async () => { called = true; return "{}"; };

  const report = await deepContentVerify(mockComplete, "test-model", "goal", "short");
  assert.equal(report, null);
  assert.equal(called, false);
});

test("deepContentVerify returns null on model error", async () => {
  const mockComplete = async () => { throw new Error("Down"); };

  const report = await deepContentVerify(mockComplete, "test-model", "goal", sampleReport);
  assert.equal(report, null);
});

test("deepContentVerify returns null on malformed JSON", async () => {
  const mockComplete = async () => "No JSON here.";

  const report = await deepContentVerify(mockComplete, "test-model", "goal", sampleReport);
  assert.equal(report, null);
});

test("deepContentVerify handles code-fenced JSON", async () => {
  const mockComplete = async () => {
    return '```json\n{"overallScore":6,"factualAccuracy":5,"completeness":7,"structure":6,"dataQuality":5,"citations":3,"strengths":["Good structure"],"weaknesses":["Missing citations"],"recommendation":"Add sources"}\n```';
  };

  const report = await deepContentVerify(mockComplete, "test-model", "goal", sampleReport);
  assert.ok(report);
  assert.equal(report.overallScore, 6);
  assert.equal(report.strengths[0], "Good structure");
});

test("deepContentVerify handles missing optional fields", async () => {
  const mockComplete = async () => {
    return JSON.stringify({ overallScore: 5, factualAccuracy: 5, completeness: 5, structure: 5, dataQuality: 5, citations: 5 });
  };

  const report = await deepContentVerify(mockComplete, "test-model", "goal", sampleReport);
  assert.ok(report);
  assert.equal(report.strengths.length, 0);
  assert.equal(report.weaknesses.length, 0);
  assert.equal(report.recommendation, "");
});

test("deepContentVerify truncates long content", async () => {
  const longContent = "x".repeat(10000);
  let receivedContent = "";
  const mockComplete = async (_model: string, messages: { role: string; content: string }[]) => {
    receivedContent = messages[1]!.content;
    return JSON.stringify({ overallScore: 3, factualAccuracy: 3, completeness: 3, structure: 3, dataQuality: 3, citations: 3 });
  };

  await deepContentVerify(mockComplete, "test-model", "goal", longContent);
  // Content should be truncated — shouldn't contain all 10000 chars
  assert.ok(receivedContent.length < longContent.length + 500);
  assert.ok(receivedContent.includes("[truncated]"));
});

test("formatContentQualityForReason formats report into string", () => {
  const report = {
    overallScore: 6,
    dimensions: { factualAccuracy: 5, completeness: 7, structure: 8, dataQuality: 4, citations: 3 },
    strengths: ["Clear structure", "Good data tables"],
    weaknesses: ["Poor citations", "Unverified claims"],
    recommendation: "Add sources and verify data."
  };

  const formatted = formatContentQualityForReason(report);
  assert.ok(formatted.includes("[Content: 6/10"));
  assert.ok(formatted.includes("factualAccuracy=5/10"));
  assert.ok(formatted.includes("citations=3/10"));
  assert.ok(formatted.includes("Poor citations"));
});
