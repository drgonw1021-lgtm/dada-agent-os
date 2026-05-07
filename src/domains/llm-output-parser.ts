export function parseJsonFromLLMOutput(output: string): any {
  if (!output) return null;

  const trimmed = output.trim();

  // Try direct parse first
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to extraction
  }

  // Try to extract JSON from markdown code blocks
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Continue
    }
  }

  // Try to find JSON object in the text
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // Continue
    }
  }

  // Try to find JSON array in the text
  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      // Continue
    }
  }

  // Return raw output if no JSON found
  return output;
}

export function extractFieldFromLLM(output: string, field: string): any {
  const parsed = parseJsonFromLLMOutput(output);
  if (!parsed) return null;

  // Handle nested fields like "data.items"
  const fields = field.split(".");
  let result = parsed;
  for (const f of fields) {
    if (result && typeof result === "object" && f in result) {
      result = result[f];
    } else {
      return null;
    }
  }
  return result;
}
