/** The reasoning brain (V3) — a ReAct-style tool-use loop that lets Nomi think
 * in steps and consult its own capabilities (memory, the page, docs, math,
 * intentions, the user profile) BEFORE answering. This is what turns single-
 * shot replies into genuine, grounded reasoning — "intelligent like Claude"
 * over the user's own local data.
 *
 * Provider-agnostic: instead of native function-calling it uses a text protocol
 * (ACTION / OBSERVATION / FINAL) that any model can follow, so it works with
 * Gemini, Ollama, or the free fallback. Pure orchestration here — the model
 * call and the tools are injected, so the loop is fully unit-testable. */

export interface AgentTool {
  name: string;
  desc: string;
  run: (arg: string) => Promise<string>;
}

export interface AgentStep {
  thought?: string;
  action?: { name: string; arg: string };
  final?: string;
}

/** Parse one model turn into an action or a final answer. Tolerant of the
 * model's formatting drift; if it wrote neither marker, treat it as the answer. */
export function parseAgentStep(raw: string): AgentStep {
  const text = raw.trim();
  const finalMatch = text.match(/FINAL:\s*([\s\S]+)$/i);
  if (finalMatch) return { final: finalMatch[1].trim() };

  const actionMatch = text.match(/ACTION:\s*([a-z_]+)\s*\(([\s\S]*?)\)\s*$/im);
  if (actionMatch) {
    const thought = text.match(/THOUGHT:\s*([\s\S]*?)(?:\nACTION:|$)/i)?.[1]?.trim();
    return { thought, action: { name: actionMatch[1].toLowerCase(), arg: actionMatch[2].trim() } };
  }
  // No markers — the model just answered.
  return { final: text };
}

export function buildAgentSystem(base: string, tools: AgentTool[]): string {
  const toolList = tools.map((t) => `- ${t.name}(arg): ${t.desc}`).join('\n');
  return `${base}

You can look things up about the user before answering, using tools. Available tools:
${toolList}

Think step by step. To use a tool, reply with EXACTLY one line:
ACTION: tool_name(argument)
You will then receive an OBSERVATION line with the result. You may call tools several times.
When you have enough to respond, reply:
FINAL: <your answer>

Rules: only call a tool when it genuinely helps; prefer grounding answers in what the tools return over guessing. If you can answer straight away, just reply with FINAL. Keep FINAL concise, warm, and specific — reference the concrete facts you found. Never invent memory you didn't retrieve.`;
}

export interface AgentDeps {
  ask: (system: string, messages: { role: 'user' | 'assistant'; content: string }[]) => Promise<string>;
  tools: AgentTool[];
  base: string;
  maxSteps?: number;
  /** Optional: observe each step (for debugging/telemetry). */
  onStep?: (step: AgentStep, observation?: string) => void;
}

/** Run the loop: reason → (optionally) act → observe → … → final answer. */
export async function runAgent(
  query: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  deps: AgentDeps,
): Promise<string> {
  const maxSteps = deps.maxSteps ?? 4;
  const system = buildAgentSystem(deps.base, deps.tools);
  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    ...history.slice(-6),
    { role: 'user', content: query },
  ];

  for (let step = 0; step < maxSteps; step++) {
    const out = await deps.ask(system, messages);
    const parsed = parseAgentStep(out);
    if (parsed.final !== undefined) {
      deps.onStep?.(parsed);
      return parsed.final;
    }
    const tool = deps.tools.find((t) => t.name === parsed.action!.name);
    let observation: string;
    try {
      observation = tool
        ? (await tool.run(parsed.action!.arg)).slice(0, 1500)
        : `No tool named "${parsed.action!.name}". Available: ${deps.tools.map((t) => t.name).join(', ')}.`;
    } catch {
      observation = `That lookup failed. Try a different approach or answer without it.`;
    }
    deps.onStep?.(parsed, observation);
    messages.push({ role: 'assistant', content: out });
    messages.push({ role: 'user', content: `OBSERVATION: ${observation}` });
  }

  // Out of steps — force a final answer from what we have.
  const forced = await deps.ask(
    system + '\n\nYou have used all your tool steps. Give your best FINAL answer now, from what you already found.',
    messages,
  );
  return parseAgentStep(forced).final ?? forced.trim();
}
