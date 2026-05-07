export type ParsedAction =
  | { type: "tool"; tool: string; input: Record<string, unknown> }
  | { type: "note"; text: string }
  | { type: "done"; text: string }
  | { type: "think"; text: string }
  | { type: "plan"; text: string }
  | { type: "ask"; text: string };

function extractInvokeParams(text: string): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  // <parameter name="k" string="true">v</parameter>
  const paramRegex = /<parameter\s+name="([^"]+)"(?:\s+string="([^"]*)")?\s*>(.*?)<\/parameter>/gi;
  let pm;
  while ((pm = paramRegex.exec(text)) !== null) {
    const pname = pm[1];
    let pvalue: unknown = pm[3];
    if (pm[2] === "false") {
      try { pvalue = JSON.parse(pm[3]); } catch { /* keep string */ }
    }
    input[pname] = pvalue;
  }
  // Also self-closing: <parameter name="k" value="v"/>
  const spRegex = /<parameter\s+name="([^"]+)"\s+value="([^"]*)"\s*\/>/gi;
  let spm;
  while ((spm = spRegex.exec(text)) !== null) {
    input[spm[1]] = spm[2];
  }
  return input;
}

// DeepSeek V4 wraps XML tags with fullwidth vertical bars + "DSML":
//   <dada_invoke name="x">  →  <invoke name="x">
// where "dada_" = ｜｜DSML｜｜
const DSML = "｜DSML｜";
function normalizeDSML(text: string): string {
  return text
    .replace(new RegExp(`</?${DSML}(invoke|parameter)`, "gi"),
      (match, tag) => match.startsWith("</") ? `</${tag}` : `<${tag}`)
    // Strip DSML-wrapped tool_calls wrapper tags entirely
    .replace(new RegExp(`</?${DSML}(tool_calls)\\s*>`, "gi"), "");
}

export function parsePlanActions(planText: string): ParsedAction[] {
  const lines = normalizeDSML(planText).split("\n");
  const actions: ParsedAction[] = [];
  let currentParagraph = "";
  let inCodeBlock = false;
  let inInvokeBlock = false;
  let invokeTool = "";
  let invokeParams = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      currentParagraph += line + "\n";
      continue;
    }

    if (inInvokeBlock) {
      if (line === "</invoke>" || line.startsWith("</invoke>")) {
        const input = extractInvokeParams(invokeParams);
        if (Object.keys(input).length > 0) {
          actions.push({ type: "tool", tool: invokeTool, input });
        } else {
          actions.push({ type: "note", text: `Invoke ${invokeTool} with no parameters extracted` });
        }
        inInvokeBlock = false;
        invokeTool = "";
        invokeParams = "";
        continue;
      }
      invokeParams += line + "\n";
      continue;
    }

    // Single-line invoke(s): <invoke name="t"><parameter.../></invoke> <invoke name="t2">...</invoke>
    // Use a non-greedy global match to capture each invoke block individually
    const inlineInvokeRegex = /<invoke\s+name="([^"]+)"\s*>(.*?)<\/invoke>/gi;
    let iim;
    const inlineInvokes: Array<{ tool: string; params: string }> = [];
    while ((iim = inlineInvokeRegex.exec(line)) !== null) {
      inlineInvokes.push({ tool: iim[1], params: iim[2] });
    }
    if (inlineInvokes.length > 0) {
      if (currentParagraph.trim()) {
        actions.push({ type: "note", text: currentParagraph.trim() });
        currentParagraph = "";
      }
      for (const inv of inlineInvokes) {
        const input = extractInvokeParams(inv.params);
        if (Object.keys(input).length > 0) {
          actions.push({ type: "tool", tool: inv.tool, input });
        } else {
          const simpleParams: Record<string, unknown> = {};
          const kvRegex = /(\w+)="([^"]*)"/g;
          let km;
          while ((km = kvRegex.exec(inv.params)) !== null) {
            simpleParams[km[1]] = km[2];
          }
          Object.assign(input, simpleParams);
          if (Object.keys(input).length > 0) {
            actions.push({ type: "tool", tool: inv.tool, input });
          } else {
            actions.push({ type: "note", text: `Invoke ${inv.tool} with no parameters extracted` });
          }
        }
      }
      continue;
    }

    // Multi-line invoke open: <invoke name="tool">
    const invokeOpenMatch = line.match(/^<invoke\s+name="([^"]+)"\s*>$/i);
    if (invokeOpenMatch) {
      if (currentParagraph.trim()) {
        actions.push({ type: "note", text: currentParagraph.trim() });
        currentParagraph = "";
      }
      inInvokeBlock = true;
      invokeTool = invokeOpenMatch[1];
      invokeParams = "";
      continue;
    }

    // tool_calls JSON block: {"tool_calls":[{"function":{"name":"x","arguments":"{...}"}}]}
    // DeepSeek sometimes outputs this in text
    if (line.startsWith(`{"tool_calls"`) || line.startsWith(`{ "tool_calls"`)) {
      try {
        const parsed = JSON.parse(line) as { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> };
        if (parsed.tool_calls) {
          if (currentParagraph.trim()) {
            actions.push({ type: "note", text: currentParagraph.trim() });
            currentParagraph = "";
          }
          for (const tc of parsed.tool_calls) {
            if (tc.function?.name) {
              try {
                const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
                actions.push({ type: "tool", tool: tc.function.name, input: args });
              } catch {
                actions.push({ type: "note", text: `Unparseable tool_call: ${line}` });
              }
            }
          }
          continue;
        }
      } catch { /* not JSON, fall through */ }
    }

    if (line.startsWith("DONE")) {
      if (currentParagraph.trim()) {
        actions.push({ type: "note", text: currentParagraph.trim() });
        currentParagraph = "";
      }
      actions.push({ type: "done", text: line.replace(/^DONE\s*/, "") || "completed" });
      continue;
    }

    if (line.startsWith("THINK:")) {
      if (currentParagraph.trim()) {
        actions.push({ type: "note", text: currentParagraph.trim() });
        currentParagraph = "";
      }
      actions.push({ type: "think", text: line.replace(/^THINK:\s*/, "") });
      continue;
    }

    if (line.startsWith("PLAN:")) {
      if (currentParagraph.trim()) {
        actions.push({ type: "note", text: currentParagraph.trim() });
        currentParagraph = "";
      }
      const planText = line.replace(/^PLAN:\s*/, "");
      actions.push({ type: "plan", text: planText });
      continue;
    }

    if (line.match(/^\d+\.\s+/) || line.match(/^[-*]\s+/)) {
      if (currentParagraph.trim()) {
        actions.push({ type: "note", text: currentParagraph.trim() });
        currentParagraph = "";
      }
      actions.push({ type: "plan", text: line });
      continue;
    }

    if (line.startsWith("ASK")) {
      if (currentParagraph.trim()) {
        actions.push({ type: "note", text: currentParagraph.trim() });
        currentParagraph = "";
      }
      actions.push({ type: "ask", text: line.replace(/^ASK\s*/, "") });
      continue;
    }

    if (line.startsWith("TOOL ")) {
      if (currentParagraph.trim()) {
        actions.push({ type: "note", text: currentParagraph.trim() });
        currentParagraph = "";
      }
      const payload = line.replace(/^TOOL\s+/, "");
      const idx = payload.indexOf(" ");
      if (idx > 0) {
        const tool = payload.slice(0, idx);
        const json = payload.slice(idx + 1).trim();
        try {
          const input = JSON.parse(json) as Record<string, unknown>;
          actions.push({ type: "tool", tool, input });
          continue;
        } catch {
          actions.push({ type: "note", text: `Invalid TOOL JSON: ${line}` });
          continue;
        }
      }
      actions.push({ type: "note", text: line });
      continue;
    }

    if (line) {
      currentParagraph += line + " ";
    } else if (currentParagraph.trim()) {
      actions.push({ type: "note", text: currentParagraph.trim() });
      currentParagraph = "";
    }
  }

  if (currentParagraph.trim()) {
    actions.push({ type: "note", text: currentParagraph.trim() });
  }

  return actions;
}
