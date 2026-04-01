# LLM Connector for Claude Code

Use any LLM from inside Claude Code for code reviews or to delegate tasks.

This is a fork of the [Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc) by OpenAI. Instead of requiring the Codex CLI, it makes direct REST API calls to any Anthropic-compatible or OpenAI-compatible LLM endpoint — so you can use providers like MiniMax, OpenAI, or any other API-compatible service alongside Claude.

## What You Get

- `/llm:review` — read-only LLM review of your current changes
- `/llm:adversarial-review` — steerable challenge review
- `/llm:rescue`, `/llm:status`, `/llm:result`, `/llm:cancel` — delegate work and manage background jobs
- `/llm:setup` — check and configure your LLM connection

## Requirements

- **An API key for your chosen LLM provider**
- **The provider's API endpoint URL**
- **Node.js 18.18 or later**

No Codex CLI, no ChatGPT subscription, no OpenAI account required.

## Install

Add the plugin from your local checkout or marketplace:

```bash
/plugin install llm-connector
```

Then run setup:

```bash
/llm:setup
```

## Configuration

Set these environment variables before starting Claude Code:

| Variable | Required | Description |
|---|---|---|
| `LLM_API_KEY` | Yes | API key for your LLM provider |
| `LLM_API_BASE_URL` | Yes | Provider endpoint (see examples below) |
| `LLM_MODEL` | No | Model name (provider default if unset) |

**Example — MiniMax:**
```bash
export LLM_API_KEY=your-key
export LLM_API_BASE_URL=https://api.minimax.io/anthropic
export LLM_MODEL=MiniMax-M2.7
```

**Example — OpenAI:**
```bash
export LLM_API_KEY=your-key
export LLM_API_BASE_URL=https://api.openai.com
export LLM_MODEL=gpt-4o
```

**Example — Anthropic:**
```bash
export LLM_API_KEY=your-key
export LLM_API_BASE_URL=https://api.anthropic.com
export LLM_MODEL=claude-opus-4-6
```

The plugin auto-detects Anthropic-compatible endpoints (URLs containing `anthropic.com` or `/anthropic`) and uses the appropriate request format. All other endpoints are treated as OpenAI-compatible.

## Usage

### `/llm:setup`

Checks whether your LLM is configured and ready.

```bash
/llm:setup
/llm:setup --enable-review-gate
/llm:setup --disable-review-gate
```

### `/llm:review`

Runs a read-only LLM review of your current uncommitted changes or branch.

```bash
/llm:review
/llm:review --base main
/llm:review --background
```

### `/llm:adversarial-review`

Steerable review that challenges implementation decisions, tradeoffs, and risks.

```bash
/llm:adversarial-review
/llm:adversarial-review --base main challenge the caching strategy
/llm:adversarial-review --background look for race conditions
```

### `/llm:rescue`

Delegates a coding task to the LLM via the `codex:codex-rescue` subagent.

```bash
/llm:rescue investigate why the tests are failing
/llm:rescue fix the failing test with the smallest safe patch
/llm:rescue --resume apply the top fix from the last run
/llm:rescue --background investigate the regression
```

### `/llm:status`, `/llm:result`, `/llm:cancel`

Manage background jobs:

```bash
/llm:status
/llm:result task-abc123
/llm:cancel task-abc123
```

## Changes from Upstream

This fork replaces the Codex CLI runtime with a lightweight direct-API client:

| Area | Upstream (openai/codex-plugin-cc) | This fork |
|---|---|---|
| Backend | Codex CLI (`@openai/codex`) | Direct REST API calls |
| Auth | ChatGPT account or OpenAI API key | `LLM_API_KEY` env var |
| Endpoint | OpenAI only | Any Anthropic- or OpenAI-compatible API |
| Provider config | `~/.codex/config.toml` | `LLM_API_BASE_URL` + `LLM_MODEL` env vars |
| Reasoning models | N/A | Handles `thinking` blocks before `text` blocks |
| Commands | `/codex:*` | `/llm:*` |

Technical fixes applied to `llm.mjs`:
- `isAnthropicCompatible()` detects both `anthropic.com` domains and `/anthropic` path prefixes
- `buildEndpoint()` preserves the base URL path (e.g. `https://api.minimax.io/anthropic/v1/messages`)
- Response parser searches for the `text`-type block rather than assuming `content[0]` is text
- Default `maxTokens` set to 1024 for broad provider compatibility

## Credits

Original plugin by **OpenAI** — [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc).
Licensed under the MIT License. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
