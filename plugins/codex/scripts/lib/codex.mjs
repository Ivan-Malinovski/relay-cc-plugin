/**
 * @typedef {import("./llm.mjs").ProgressReporter} ProgressReporter
 */
import { LLM_API_KEY_ENV, LLM_API_BASE_URL_ENV, LLM_MODEL_ENV, getLLMAvailability, runLLMReview, runLLMTurn } from "./llm.mjs";

const DEFAULT_CONTINUE_PROMPT = "Continue from the current state. Pick the next highest-value step and follow through until the task is resolved.";

function emitProgress(onProgress, message, phase = null) {
  if (!onProgress || !message) {
    return;
  }
  onProgress({ message, phase });
}

export function getCodexAvailability(cwd) {
  return getLLMAvailability();
}

export function getSessionRuntimeStatus(env = process.env, cwd = process.cwd()) {
  const apiKey = env?.[LLM_API_KEY_ENV] ?? null;
  const baseUrl = env?.[LLM_API_BASE_URL_ENV] ?? null;
  const model = env?.[LLM_MODEL_ENV] ?? null;

  if (apiKey) {
    return {
      mode: "direct",
      label: "configured",
      detail: `LLM configured: ${baseUrl ?? "(no base URL)"} with ${model ?? "default model"}`,
      endpoint: baseUrl
    };
  }

  return {
    mode: "unconfigured",
    label: "not configured",
    detail: "No LLM API key configured. Set LLM_API_KEY environment variable.",
    endpoint: null
  };
}

export function getCodexLoginStatus(cwd) {
  const availability = getLLMAvailability();
  return {
    available: availability.available,
    loggedIn: availability.available,
    detail: availability.detail
  };
}

export async function interruptAppServerTurn(cwd, { threadId, turnId }) {
  return {
    attempted: false,
    interrupted: false,
    transport: null,
    detail: "LLM connector does not support turn interruption"
  };
}

export async function runAppServerReview(cwd, options = {}) {
  const availability = getLLMAvailability();
  if (!availability.available) {
    throw new Error("LLM is not configured. Set LLM_API_KEY environment variable.");
  }

  emitProgress(options.onProgress, "Starting LLM review.", "starting");

  const reviewContent = options.reviewContent ?? "";
  const result = await runLLMReview(cwd, {
    model: options.model,
    reviewContent,
    systemPrompt: options.systemPrompt ?? "You are a code reviewer. Review the provided code changes and respond with a JSON object containing: { verdict: 'approve' or 'needs-attention', summary: 'brief summary', findings: [{ severity: 'critical|high|medium|low', file: 'filename', line_start: number, line_end: number, recommendation: 'text' }], next_steps: ['action items'] }",
    onProgress: options.onProgress
  });

  return {
    status: result.status,
    threadId: "llm-review-thread",
    sourceThreadId: "llm-review-thread",
    turnId: "llm-review-turn",
    reviewText: result.content,
    reasoningSummary: result.reasoning ? [result.reasoning] : [],
    turn: null,
    error: result.parseError,
    stderr: result.parseError ?? ""
  };
}

export async function runAppServerTurn(cwd, options = {}) {
  const availability = getLLMAvailability();
  if (!availability.available) {
    throw new Error("LLM is not configured. Set LLM_API_KEY environment variable.");
  }

  const prompt = options.prompt?.trim() || options.defaultPrompt || "";
  if (!prompt) {
    throw new Error("A prompt is required for this LLM run.");
  }

  emitProgress(options.onProgress, "Starting LLM task.", "starting");

  const result = await runLLMTurn(cwd, {
    model: options.model,
    prompt,
    systemPrompt: options.systemPrompt ?? "You are a helpful coding assistant. Perform the requested task and respond with your findings.",
    onProgress: options.onProgress
  });

  return {
    status: result.status,
    threadId: "llm-task-thread",
    turnId: "llm-task-turn",
    finalMessage: result.content,
    reasoningSummary: result.reasoning ? [result.reasoning] : [],
    turn: null,
    error: null,
    stderr: "",
    fileChanges: result.fileChanges,
    touchedFiles: result.touchedFiles,
    commandExecutions: []
  };
}

export async function findLatestTaskThread(cwd) {
  return null;
}

export function buildPersistentTaskThreadName(prompt) {
  const excerpt = String(prompt ?? "").trim().replace(/\s+/g, " ").slice(0, 56);
  return excerpt ? `LLM Connector Task: ${excerpt}` : "LLM Connector Task";
}

export function parseStructuredOutput(rawOutput, fallback = {}) {
  if (!rawOutput) {
    return {
      parsed: null,
      parseError: fallback.failureMessage ?? "LLM did not return a structured message.",
      rawOutput: rawOutput ?? "",
      ...fallback
    };
  }

  try {
    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return {
        parsed: JSON.parse(jsonMatch[0]),
        parseError: null,
        rawOutput,
        ...fallback
      };
    }
  } catch (error) {
    return {
      parsed: null,
      parseError: error.message,
      rawOutput,
      ...fallback
    };
  }

  return {
    parsed: null,
    parseError: "No JSON object found in response",
    rawOutput,
    ...fallback
  };
}

export function readOutputSchema(schemaPath) {
  return null;
}

export { DEFAULT_CONTINUE_PROMPT };