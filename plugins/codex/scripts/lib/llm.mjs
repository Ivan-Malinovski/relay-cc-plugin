/**
 * @typedef {Error & { data?: unknown }} LLMError
 * @typedef {((update: string | { message: string, phase: string | null }) => void)} ProgressReporter
 */
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";

const PLUGIN_MANIFEST_URL = new URL("../../.claude-plugin/plugin.json", import.meta.url);
const PLUGIN_MANIFEST = JSON.parse(await import("node:fs").then((fs) => fs.promises.readFile(PLUGIN_MANIFEST_URL, "utf8")));

export const LLM_API_KEY_ENV = "LLM_API_KEY";
export const LLM_API_BASE_URL_ENV = "LLM_API_BASE_URL";
export const LLM_MODEL_ENV = "LLM_MODEL";

const DEFAULT_CLIENT_INFO = {
  title: "LLM Connector Plugin",
  name: "Claude Code",
  version: PLUGIN_MANIFEST.version ?? "0.0.0"
};

function createLLMError(message, data) {
  const error = /** @type {LLMError} */ (new Error(message));
  error.data = data;
  return error;
}

function parseResponse(body, contentType) {
  if (contentType?.includes("application/json")) {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  return null;
}

export class LLMClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env[LLM_API_KEY_ENV] ?? null;
    this.baseUrl = options.baseUrl ?? process.env[LLM_API_BASE_URL_ENV] ?? "https://api.anthropic.com";
    this.model = options.model ?? process.env[LLM_MODEL_ENV] ?? "claude-sonnet-4-20250514";
    this.maxTokens = options.maxTokens ?? 8192;
  }

  getAuthHeaders() {
    if (this.baseUrl.includes("anthropic.com")) {
      return {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      };
    }
    return {
      "Authorization": `Bearer ${this.apiKey}`,
      "Content-Type": "application/json"
    };
  }

  buildEndpoint(path) {
    const url = new URL(path, this.baseUrl);
    return url.toString();
  }

  async makeRequest(endpoint, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint);
      const isHttps = url.protocol === "https:";
      const transport = isHttps ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers: this.getAuthHeaders()
      };

      const req = transport.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(createLLMError(`LLM API request failed with status ${res.statusCode}`, { body: data, statusCode: res.statusCode }));
            return;
          }
          const parsed = parseResponse(data, res.headers["content-type"]);
          resolve({ data: parsed, raw: data });
        });
      });

      req.on("error", (error) => {
        reject(createLLMError(`LLM API request failed: ${error.message}`, { cause: error }));
      });

      req.write(JSON.stringify(body));
      req.end();
    });
  }

  async complete(prompt, options = {}) {
    const systemPrompt = options.system ?? "";
    const model = options.model ?? this.model;
    const maxTokens = options.maxTokens ?? this.maxTokens;

    const isAnthropic = this.baseUrl.includes("anthropic.com");

    let body;
    if (isAnthropic) {
      body = {
        model,
        max_tokens: maxTokens,
        system: systemPrompt || undefined,
        messages: [{ role: "user", content: prompt }]
      };
    } else {
      body = {
        model,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: prompt }
        ],
        max_tokens: maxTokens
      };
    }

    const endpoint = this.buildEndpoint(isAnthropic ? "/v1/messages" : "/v1/chat/completions");
    const response = await this.makeRequest(endpoint, body);

    if (isAnthropic) {
      const content = response.data.content?.[0]?.text ?? "";
      return {
        content,
        reasoning: response.data.content?.filter((c) => c.type === "reasoning")?.map((c) => c.text).join("\n") ?? "",
        raw: response.data
      };
    } else {
      const content = response.data.choices?.[0]?.message?.content ?? "";
      return {
        content,
        reasoning: "",
        raw: response.data
      };
    }
  }

  async *streamComplete(prompt, options = {}) {
    const systemPrompt = options.system ?? "";
    const model = options.model ?? this.model;
    const maxTokens = options.maxTokens ?? this.maxTokens;

    const isAnthropic = this.baseUrl.includes("anthropic.com");

    let body;
    if (isAnthropic) {
      body = {
        model,
        max_tokens: maxTokens,
        system: systemPrompt || undefined,
        messages: [{ role: "user", content: prompt }],
        stream: true
      };
    } else {
      body = {
        model,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: prompt }
        ],
        max_tokens: maxTokens,
        stream: true
      };
    }

    const endpoint = this.buildEndpoint(isAnthropic ? "/v1/messages" : "/v1/chat/completions");
    const url = new URL(endpoint);

    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;

    const yield_ = yield;

    const response = yield new Promise((resolve, reject) => {
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          ...this.getAuthHeaders(),
          "Accept": "text/event-stream"
        }
      };

      const req = transport.request(options, (res) => {
        let buffer = "";
        res.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                resolve();
                return;
              }
              try {
                const parsed = JSON.parse(data);
                if (isAnthropic) {
                  const text = parsed.content?.[0]?.text ?? "";
                  const reasoning = parsed.content?.filter((c) => c.type === "reasoning")?.map((c) => c.text).join("\n") ?? "";
                  if (text) yield_(text);
                  if (reasoning) yield_(reasoning);
                } else {
                  const text = parsed.choices?.[0]?.delta?.content ?? "";
                  if (text) yield_(text);
                }
              } catch {
                // Skip malformed lines
              }
            }
          }
        });
        res.on("end", () => resolve());
        res.on("error", reject);
      });

      req.on("error", reject);
      req.write(JSON.stringify(body));
      req.end();
    });

    return response;
  }
}

export function getLLMAvailability() {
  const apiKey = process.env[LLM_API_KEY_ENV];
  if (!apiKey) {
    return {
      available: false,
      detail: "LLM_API_KEY environment variable is not set"
    };
  }

  const baseUrl = process.env[LLM_API_BASE_URL_ENV] ?? "https://api.anthropic.com";
  const model = process.env[LLM_MODEL_ENV] ?? "claude-sonnet-4-20250514";

  return {
    available: true,
    detail: `Configured for ${baseUrl} with model ${model}`
  };
}

export async function runLLMReview(cwd, options = {}) {
  const client = new LLMClient();
  const availability = getLLMAvailability();
  if (!availability.available) {
    throw new Error("LLM is not configured. Set LLM_API_KEY environment variable.");
  }

  const systemPrompt = options.systemPrompt ?? "You are a code reviewer. Review the provided code changes and respond with a JSON object containing: { verdict: 'approve' or 'needs-attention', summary: 'brief summary', findings: [{ severity: 'critical|high|medium|low', file: 'filename', line_start: number, line_end: number, recommendation: 'text' }], next_steps: ['action items'] }";
  const reviewContent = options.reviewContent ?? "";

  const result = await client.complete(reviewContent, {
    system: systemPrompt,
    model: options.model
  });

  let parsed = null;
  let parseError = null;
  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    parseError = e.message;
  }

  return {
    status: parsed?.verdict === "approve" ? 0 : 1,
    content: result.content,
    parsed,
    parseError,
    reasoning: result.reasoning
  };
}

export async function runLLMTurn(cwd, options = {}) {
  const client = new LLMClient();
  const availability = getLLMAvailability();
  if (!availability.available) {
    throw new Error("LLM is not configured. Set LLM_API_KEY environment variable.");
  }

  const systemPrompt = options.systemPrompt ?? "You are a helpful coding assistant. Perform the requested task and respond with your findings and any file changes in a structured format.";
  const prompt = options.prompt ?? "";

  const result = await client.complete(prompt, {
    system: systemPrompt,
    model: options.model
  });

  return {
    status: 0,
    content: result.content,
    reasoning: result.reasoning,
    touchedFiles: [],
    fileChanges: []
  };
}