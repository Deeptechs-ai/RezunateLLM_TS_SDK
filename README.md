# Rezunate LLM SDK (TypeScript)

Unified TypeScript SDK for chat completions, prompt management, and PII guardrails across OpenAI, Anthropic, Google Gemini, Grok (xAI), DeepSeek, Meta, and Qwen (Alibaba). All requests and responses use the OpenAI format, regardless of provider — streaming included.

Get an API key and learn more at [rezunatellm.com](https://rezunatellm.com). Also available for Python: [`rezunate-llm-sdk` on PyPI](https://pypi.org/project/rezunate-llm-sdk/).

## What's Included

| Feature | Cost | Requires |
|---|---|---|
| Unified chat completions across seven providers, streaming or not | **Free** | Your own provider API key |
| Local regex guardrails (block / flag / redact PII in inputs and outputs) | **Free** | Nothing — runs client-side |
| Server-side PII detection, with reversible masking | Hosted | Rezunate API key |
| Prompt management with versioning | Hosted | Rezunate API key |
| `rezunate-guard` — PII redaction for Claude Code, no code required | Hosted | Coming soon to the TypeScript package |

You only need a Rezunate API key for the hosted features.

## Installation

```bash
npm install rezunate-llm-sdk
```

Requires Node.js 22 or newer. Works with `pnpm add` and `yarn add` too, and ships both ESM and CommonJS builds with TypeScript types.

## Quickstart

```ts
import { Gateway } from "rezunate-llm-sdk";

const gateway = new Gateway({
  defaultProvider: "anthropic",
  defaultApiKey: "your-provider-api-key",
});

const response = await gateway.chatComplete({
  model: "claude-sonnet-4-5",
  messages: [{ role: "user", content: "Hello!" }],
  max_tokens: 100,
});

console.log(response.choices[0]?.message.content);
```

The stateless form is also available when you don't want a long-lived gateway:

```ts
import { chatComplete } from "rezunate-llm-sdk";

const response = await chatComplete({
  provider: "openai",
  apiKey: "your-openai-api-key",
  request: {
    model: "gpt-4o",
    messages: [{ role: "user", content: "Hello!" }],
  },
});
```

Responses always come back in OpenAI format (`response.choices[0].message.content`, `response.usage.total_tokens`, etc.) — whichever provider served the call.

**Errors.** An invalid request (an unknown provider, a wrong `role`) throws right away. A provider or network failure (a wrong API key, a rate limit, a timeout) does not throw: the response has `error` set (`message`, `code`, `retries_attempted`) and empty `choices`, so check `response.error`. Failed calls are retried automatically on 429, 5xx, timeouts and connection errors (3 retries by default).

## Providers

Seven providers ship with the SDK, all behind the same request and response shape:

| Provider | `provider` | Wire protocol |
|---|---|---|
| OpenAI | `openai` | OpenAI Chat Completions |
| Anthropic | `anthropic` | Anthropic Messages |
| Google Gemini | `google` | Gemini `generateContent` |
| Grok (xAI) | `grok` | OpenAI-compatible |
| DeepSeek | `deepseek` | OpenAI-compatible |
| Meta | `meta` | Meta Model API (OpenAI-compatible) |
| Qwen (Alibaba) | `qwen` | DashScope native |

The SDK ships with a factory that creates provider instances on demand. You bring your own API key per provider — Rezunate doesn't proxy or charge for these calls.

```ts
import { getAvailableProviders, getProvider } from "rezunate-llm-sdk";

// List the providers the SDK supports
console.log(getAvailableProviders());
// ["openai", "anthropic", "google", "grok", "meta", "deepseek", "qwen"]

// Build a provider instance directly (skips the Gateway/chatComplete facade)
const provider = getProvider("anthropic", "your-anthropic-key", {
  maxRetries: 5, // optional: retries, retryDelay and timeout (in seconds)
});
const response = await provider.chatComplete({
  model: "claude-sonnet-4-5",
  messages: [{ role: "user", content: "Hi!" }],
});
```

You can also switch providers at call time on a single `Gateway`:

```ts
const gateway = new Gateway();

await gateway.chatComplete(request, { provider: "openai", apiKey: openaiKey });
await gateway.chatComplete(request, { provider: "anthropic", apiKey: anthropicKey });
await gateway.chatComplete(request, { provider: "google", apiKey: googleKey });
```

A gateway's `defaultApiKey` is only used with its `defaultProvider`; a call that switches to another provider must pass that provider's own `apiKey`.

**Organization-level keys.** Pass `organization` / `project` (OpenAI) or `workspaceId` (Anthropic, Qwen) with a call when your key spans several organizations or workspaces:

```ts
await gateway.chatComplete(request, {
  provider: "anthropic",
  apiKey: anthropicKey,
  workspaceId: "wrkspc_01J...",
});
```

### Request Parameters

The request follows the OpenAI schema and supports the common knobs:

```ts
await gateway.chatComplete({
  model: "gpt-4o",
  messages: [
    { role: "system", content: "You are concise." },
    { role: "user", content: "Summarize the last commit." },
  ],
  temperature: 0.2,
  max_tokens: 500,
  top_p: 0.9,
  frequency_penalty: 0.0,
  presence_penalty: 0.0,
  stop: ["END"],
});
```

Provider-specific arguments (e.g. Google `top_k`, `safety_settings`) are accepted as extra fields and forwarded by each provider's transformer.

## Streaming

Set `stream: true` and the call returns an async iterable of `ChatCompletionChunk` objects instead of a single response. Every provider streams, and every one yields the same OpenAI chunk shape.

```ts
const stream = gateway.chatComplete({
  model: "claude-sonnet-4-5",
  messages: [{ role: "user", content: "Write a haiku about latency." }],
  max_tokens: 200,
  stream: true,
});

for await (const chunk of stream) {
  if (chunk.error) {
    console.error("stream failed:", chunk.error.message);
    break;
  }
  for (const choice of chunk.choices) {
    process.stdout.write(choice.delta.content ?? "");
  }
}
```

`delta.role` is set on the first chunk only, `finish_reason` on the last. Nothing throws on a stream — not a provider or network failure, and not an invalid request: the stream yields a single chunk with `error` populated and stops, so check `chunk.error` in the loop. Only opening the stream is retried; once text has arrived, a failure ends the stream with an error chunk.

Guardrails behave differently on a stream: local regex `block` rules end the stream with an error chunk (`error.type: "guardrail_error"`), but local `redact` rules only log (deltas are not rewritten). Hosted guardrails buffer output to a sentence boundary, scan, and emit redacted text — use `serverGuardrails: true` when redacting streamed output matters.

## Tool Calling

Define tools in OpenAI format and the SDK translates them to each provider's native shape (Anthropic `tool_use`, Google `functionCall`) and normalizes the response back to OpenAI `tool_calls`.

Tool support by provider: OpenAI, Grok, DeepSeek and Meta pass tools through natively; Anthropic and Google are translated both ways; Qwen sends them in DashScope's tool format.

```ts
import { type ChatCompletionRequest, Gateway } from "rezunate-llm-sdk";

const gateway = new Gateway({ defaultProvider: "anthropic", defaultApiKey: "your-anthropic-key" });

const tools: ChatCompletionRequest["tools"] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Look up the current weather for a city",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    },
  },
];

const messages: ChatCompletionRequest["messages"] = [
  { role: "user", content: "What's the weather in Tokyo?" },
];

const response = await gateway.chatComplete({
  model: "claude-sonnet-4-5",
  messages,
  tools,
  tool_choice: "auto", // "auto" | "required" | "none" | { type: "function", function: { name: "get_weather" } }
  max_tokens: 300,
});

const choice = response.choices[0];
const call = choice?.message.tool_calls?.[0];
if (choice?.finish_reason === "tool_calls" && call) {
  console.log(call.function.name); // "get_weather"
  console.log(call.function.arguments); // '{"city":"Tokyo"}'  (a JSON string)
}
```

Run the tool, then send the result back as a `tool` message to get the final answer:

```ts
const args = JSON.parse(call.function.arguments);
const result = `Sunny, 22C in ${args.city}`; // your real tool goes here

messages.push(
  { role: "assistant", content: null, tool_calls: choice.message.tool_calls },
  { role: "tool", content: result, tool_call_id: call.id },
);

const final = await gateway.chatComplete({
  model: "claude-sonnet-4-5",
  messages,
  tools,
  max_tokens: 300,
});
console.log(final.choices[0]?.message.content);
```

With `stream: true`, tool calls arrive in pieces in `delta.tool_calls` (OpenAI's format) for every provider: join the pieces by `index`, adding each piece's `function.arguments` to the call.

## Local Regex Guardrails (Free)

Define regex patterns in YAML to **block**, **flag**, or **redact** sensitive content (PII or anything custom) in both user inputs and model outputs. Everything is free and runs client-side — no RezunateLLM account needed, no data leaves your machine.

Create a config file:

```yaml
# guardrails.yaml
guardrails:
  - name: block-ssn
    pattern: '\b\d{3}-\d{2}-\d{4}\b'
    description: "Block Social Security Numbers"
    action: block

  # Redact PII instead of blocking the whole request/response.
  - name: redact-email
    pattern: '\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'
    description: "Redact email addresses"
    action: redact
    replacement: "[EMAIL]"

  - name: flag-credit-card
    pattern: '\b(?:\d[ -]*?){13,16}\b'
    description: "Flag potential credit card numbers"
    action: flag
```

Each rule needs:
- `name` — identifier
- `pattern` — regex to match (a JavaScript regular expression)
- `description` — human-readable description
- `action` — one of:
  - `block` — throws `GuardrailsError`, stopping the request (input) or response (output)
  - `flag` — records a violation and logs it, but lets the content through unchanged
  - `redact` — replaces every match with `replacement` (defaults to `[REDACTED]`) in both the prompt sent to the provider and the model's response
- `replacement` — text substituted for each match when `action: redact` (optional; defaults to `[REDACTED]`)

Use it in two ways:

**Pass it explicitly to a Gateway:**

```ts
import { Gateway, loadGuardrails } from "rezunate-llm-sdk";

const guardrailsConfig = loadGuardrails("guardrails.yaml");
const gateway = new Gateway({
  defaultProvider: "anthropic",
  defaultApiKey: "your-anthropic-key",
  guardrailsConfig,
});

// Both input and output are checked on every chatComplete call.
await gateway.chatComplete(request);
```

**Or enable automatic loading via env var:**

```bash
export GUARDRAILS_FILE_PATH=path/to/guardrails.yaml
```

When set, the SDK loads the file once and applies the rules on every `chatComplete` call without explicit wiring.

You can also call the checker directly. `checkGuardrails` returns a `[redactedText, violations]` pair and throws `GuardrailsError` on a `block` rule:

```ts
import { checkGuardrails, GuardrailsError, loadGuardrails } from "rezunate-llm-sdk";

const config = loadGuardrails("guardrails.yaml"); // with a redact rule for emails
try {
  const [redacted, violations] = checkGuardrails("Email me at alex@example.com", config, "output");
  console.log(redacted); // -> "Email me at [EMAIL]"  (redact rules applied)
  // 'flag' rules show up in `violations`; 'block' rules throw GuardrailsError
} catch (error) {
  if (error instanceof GuardrailsError) {
    console.log(`Blocked by rule '${error.ruleName}' on ${error.direction}`);
  }
}
```

## Hosted Features

These call the Rezunate API and require a Rezunate API key (passed to `Gateway` as `rezunateLlmApiKey`, or set as `REZUNATE_LLM_API_KEY`).

### Server-side PII Detection (Premium Feature)

Detect PII entities using the workspace guardrail config managed in RezunateLLM. Returns model-detected entities, with labels, scores, and offsets.

```ts
const gateway = new Gateway({ rezunateLlmApiKey: "your-rezunate-api-key" });

const result = await gateway.guardrails.scan(
  "My SSN is 123-45-6789 and my email is alex@example.com.",
);

for (const entity of result.entities) {
  console.log(`${entity.label}: ${JSON.stringify(entity.text)} (score=${entity.score.toFixed(2)})`);
}

console.log("action:", result.action); // action taken per workspace config
console.log("blocked:", result.blocked); // whether the request was blocked
console.log("text:", result.text); // processed text (e.g. with PII redacted)
```

#### Automatic PII guardrails on input and output

Set `serverGuardrails: true` and the Gateway scans every `chatComplete` call with the hosted PII service, applying the workspace config automatically:

- if the scan **blocks** the content → throws `ServerGuardrailsError` (in a stream: an error chunk)
- if the scan **redacts** it → the content is replaced with the server's redacted text (the prompt before it's sent, or the response after)

```ts
import { Gateway, ServerGuardrailsError } from "rezunate-llm-sdk";

const gateway = new Gateway({
  defaultProvider: "openai",
  defaultApiKey: "your-openai-key",
  serverGuardrails: true, // scan input AND output via hosted PII service
  rezunateLlmApiKey: "your-rezunate-api-key",
});

try {
  const response = await gateway.chatComplete(request);
  console.log(response.choices[0]?.message.content); // PII redacted by the server
} catch (error) {
  if (error instanceof ServerGuardrailsError) {
    console.log(`Blocked on ${error.direction} — detected ${error.entities.map((e) => e.label)}`);
  }
}
```

**Choosing which side to scan.** `true` scans both the prompt (input) and the model response (output). To scan only one side, pass `directions`:

```ts
const gateway = new Gateway({
  defaultProvider: "openai",
  defaultApiKey: "your-openai-key",
  serverGuardrails: { directions: ["output"] }, // output only
  rezunateLlmApiKey: "your-rezunate-api-key",
});
```

| `serverGuardrails` value | Scans |
|---|---|
| `true` | input **and** output |
| `{ directions: ["input"] }` | input only |
| `{ directions: ["output"] }` | output only |
| `false` (default) | nothing |

You can also override it per call: `gateway.chatComplete(request, { serverGuardrails: ... })`. This runs alongside any local regex guardrails.

#### Reversible masking

With `reversible: true`, PII in the prompt is replaced with placeholders before it's sent (for example `[EMAIL_ADDRESS_7f3a]`), and the placeholders in the response are put back to the real values. The model never sees the PII, but your users get a complete answer. Placeholders come from the hosted scan and from local `redact` rules.

```ts
import { MaskVault } from "rezunate-llm-sdk";

// Sent as "My email is [EMAIL_ADDRESS_7f3a]"; the response comes back with the real email.
const answer = await gateway.chatComplete(
  { model: "gpt-4o", messages: [{ role: "user", content: "My email is alex@example.com" }] },
  { serverGuardrails: { directions: ["input"] }, reversible: true },
);

// To keep the same placeholders across a conversation, pass your own vault and save it:
const vault = new MaskVault();
await gateway.chatComplete(request, { vault });
const saved = vault.dumps(); // holds real PII: store it encrypted
const resumed = MaskVault.loads(saved);
```

Each call uses a new vault unless you pass one. Keep one vault per end-user, and never share a vault between users.

### Prompt Management

Fetch and render prompts stored on Rezunate LLM. Pin to a specific version, or omit `version` to use the current one. Variables are interpolated into the template before returning.

```ts
const gateway = new Gateway({
  defaultProvider: "anthropic",
  defaultApiKey: "your-anthropic-api-key",
  rezunateLlmApiKey: "your-rezunate-api-key",
});

const systemPrompt = await gateway.getPrompt(
  "customer-support-greeting",
  { name: "Alex", tier: "premium" },
  3, // optional — defaults to current version
);

const response = await gateway.chatComplete({
  model: "claude-sonnet-4-5",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: "Where's my order?" },
  ],
});
```

A missing variable throws `Missing template variables: …`, and a prompt or version that doesn't exist throws `RouterAPIError`.

## Claude Code PII Guard

`rezunate-guard` redacts PII from your files **before Claude Code sends them to the model**, with no code required. It is available today in the [Python package](https://pypi.org/project/rezunate-llm-sdk/) and is coming soon to the TypeScript package.

## Environment Variables

| Variable | Purpose |
|---|---|
| `REZUNATE_LLM_API_KEY` | Rezunate API key — required for hosted features (prompts, server-side scan) |
| `OPENAI_API_KEY` | OpenAI provider key — used by your application code |
| `ANTHROPIC_API_KEY` | Anthropic provider key — used by your application code |
| `GEMINI_API_KEY` | Google Gemini provider key — used by your application code |
| `GUARDRAILS_FILE_PATH` | Optional path to a local guardrails YAML config; loaded automatically when set |
| `REZUNATE_LLM_BASE_URL` | Rezunate API base URL (default `https://rezunatellm.com`) |

## License

MIT, see [LICENSE](LICENSE).
