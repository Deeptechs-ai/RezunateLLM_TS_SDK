# rezunate-llm-sdk (TypeScript)

Unified TypeScript SDK for chat completions across multiple AI providers, using the OpenAI request/response format. It is the TypeScript version of the Python SDK [`rezunate-llm-sdk`](https://pypi.org/project/rezunate-llm-sdk/).

>**Work in progress.** Chat and tool calls, normal and streaming, work with all providers. Other features of the Python SDK are being ported; see [Status](#status). The package is not published to npm yet.

## Status

| Feature | Status |
|---|---|
| Chat completion with OpenAI, Anthropic, Google (Gemini), Grok (xAI), DeepSeek, Qwen (Alibaba) and Meta | ✅ Done |
| Provider factory and registry (same design as the Python SDK) | ✅ Done |
| Automatic retries (one rule for all providers), timeouts, errors returned as a response | ✅ Done |
| Organization-level API keys (`organization`, `project`, `workspaceId`) | ✅ Done |
| Streaming, with the same retries and error rule for all providers | ✅ Done |
| Tool calls (all providers, normal chat and streaming) | ✅ Done |
| Prompts (fetch and render prompts saved on the Rezunate website) | ✅ Done |
| Local guardrails (regex rules from a YAML file: block, flag, redact) | ✅ Done |
| Server guardrails (hosted PII scan and reversible masking) | ⏳ Planned |
| `Gateway` class (defaults, prompts, chat and local guardrails; server guardrail options come later) | ✅ Done |
| `rezunate-guard` CLI | ⏳ Planned |

## Requirements

- Node.js **22 or newer** (see `.nvmrc`)
- [pnpm](https://pnpm.io/) for development

## Quick start

Every provider takes the same OpenAI-format request and returns the same OpenAI-format response:

```ts
import { chatComplete, type ChatCompletionRequest } from "rezunate-llm-sdk";

const messages: ChatCompletionRequest["messages"] = [
  { role: "system", content: "You are a helpful assistant." },
  { role: "user", content: "In one sentence, what is TypeScript?" },
];

const response = await chatComplete({
  provider: "openai",
  apiKey: process.env.OPENAI_API_KEY!,
  request: { model: "gpt-4o-mini", messages },
});

if (response.error) {
  console.error(response.error.code, response.error.message);
} else {
  console.log(response.choices[0]?.message.content);
  console.log(response.choices[0]?.finish_reason); // "stop", "length", "content_filter" or "tool_calls"
  console.log(response.choices[0]?.provider_finish_reason); // the provider's own value (OpenAI: "stop", Anthropic: "end_turn")
  console.log(response.usage); // { prompt_tokens, completion_tokens, total_tokens }
}
```

To use another provider, change only `provider`, `apiKey` and `model`:

```ts
await chatComplete({
  provider: "anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY!,
  request: { model: "claude-haiku-4-5", messages, max_tokens: 200 },
});
```

### Errors

The SDK follows one rule:

| What went wrong | Example | What you get |
|---|---|---|
| **Your request is invalid** | unknown provider, wrong `role`, a setting with the wrong type (e.g. `top_k: "abc"`) | `chatComplete` **throws** right away, so the mistake shows up during development |
| **The provider or the network failed** | wrong API key, rate limit, server error, timeout | a normal response with **`error`** set (`message`, `code`, `retries_attempted`) and empty `choices`; nothing is thrown |

```ts
try {
  const response = await chatComplete({
    provider: "openai",
    apiKey: process.env.OPENAI_API_KEY!,
    request: { model: "gpt-4o-mini", messages },
  });
  if (response.error) {
    // The provider or network failed (after retries).
    console.error(response.error.code, response.error.message);
  }
} catch (err) {
  // The request itself was invalid: fix the code.
}
```

Streaming works differently: nothing throws, every problem comes as an error chunk (see [Streaming](#streaming)).

### Retries

Every provider uses the same retry rule. A failed call is retried on **429, 500, 502, 503, 504**, timeouts and connection errors, waiting 1s, 2s, then 4s (plus a small random delay). Other errors, such as 400 or 401, are not retried. After the last attempt, `error.retries_attempted` says how many retries were made.

The defaults are 3 retries, a 1-second base delay and a 60-second timeout. To change them, create the provider yourself:

```ts
import { getProvider } from "rezunate-llm-sdk";

const provider = getProvider("openai", process.env.OPENAI_API_KEY!, {
  maxRetries: 5,
  retryDelay: 2, // seconds
  timeout: 30, // seconds
});
const response = await provider.chatComplete({ model: "gpt-4o-mini", messages });
```

### Streaming

Set `stream: true` to get the answer in small pieces (chunks) as it is written. `chatComplete` then returns the chunks to loop over with `for await` (no `await` before `chatComplete`):

```ts
const stream = chatComplete({
  provider: "anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY!,
  request: { model: "claude-haiku-4-5", messages, stream: true },
});

for await (const chunk of stream) {
  if (chunk.error) {
    console.error(chunk.error.code, chunk.error.message);
    break;
  }
  process.stdout.write(chunk.choices[0]?.delta.content ?? "");
  if (chunk.choices[0]?.finish_reason) {
    console.log("\n", chunk.choices[0].finish_reason, chunk.usage);
  }
}
```

Every provider sends chunks in the OpenAI format (`object: "chat.completion.chunk"`):

- The first chunk usually has `delta.role: "assistant"`; the next ones have the new text in `delta.content`.
- The last chunk has `finish_reason` and `provider_finish_reason`, the same as in a normal response.
- `usage` is filled when the provider sends it, usually in the last chunk. OpenAI-format providers send it only when you ask with `stream_options: { include_usage: true }` in the request.

How problems are reported:

- **Everything comes as a chunk.** With `stream: true` nothing throws, not even for an invalid request or an unknown provider: you get one chunk with `error` set (`message`, `code`, `retries_attempted`) and empty `choices`, and the stream ends. `error.type` is `"invalid_request_error"` when your request was the problem, and `"api_error"` when the provider or the network failed.
- **Only the start is retried.** If the stream cannot be opened (429, 5xx, timeout, connection error), it is retried with the [same rule](#retries) as normal chat. Once text has arrived it is never retried, because that would repeat the text; the stream ends with an error chunk instead, after the chunks already sent.
- **The timeout counts silence, not total time.** A stream fails only when no data arrives for `timeout` seconds, so long answers are not cut off.

To stop early, `break` out of the loop; the connection is closed.

### Tool calls

Give the model your functions in `tools` (OpenAI format). When it wants one, the reply has `message.tool_calls` and `finish_reason: "tool_calls"`. Run the function, send the result back as a `tool` message, and ask again:

```ts
const tools: ChatCompletionRequest["tools"] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the current weather for a city",
      parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    },
  },
];
const history: ChatCompletionRequest["messages"] = [
  { role: "user", content: "What's the weather in Paris?" },
];

const first = await chatComplete({
  provider: "anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY!,
  request: { model: "claude-haiku-4-5", messages: history, tools },
});

const call = first.choices[0]?.message.tool_calls?.[0];
if (call) {
  const args = JSON.parse(call.function.arguments); // { city: "Paris" }
  const result = { city: args.city, temp_c: 18 }; // run your real function here

  history.push(
    { role: "assistant", content: first.choices[0]?.message.content ?? null, tool_calls: [call] },
    { role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) },
  );

  const final = await chatComplete({
    provider: "anthropic",
    apiKey: process.env.ANTHROPIC_API_KEY!,
    request: { model: "claude-haiku-4-5", messages: history, tools },
  });
  console.log(final.choices[0]?.message.content);
}
```

`tool_choice` can be `"auto"`, `"none"`, `"required"` or `{ type: "function", function: { name: "get_weather" } }`.

| `provider` | How tools are handled |
|---|---|
| `openai`, `grok`, `deepseek`, `meta` | Sent and returned as they are (OpenAI format) |
| `anthropic` | Translated to and from Anthropic's `tool_use` / `tool_result` blocks |
| `google` | Translated to and from Gemini's `functionCall` / `functionResponse` parts. Gemini sends no call id, so one is made up (`call_…`) |
| `qwen` | Sent under DashScope's `parameters` (also accepts `parallel_tool_calls`) |

#### Tool calls in streams

With `stream: true`, tool calls arrive in pieces in `delta.tool_calls`, in OpenAI's format for every provider. The first piece of a call has `index`, `id` and `function.name`; later pieces add to `function.arguments`. Join the pieces by `index` (`tools` and `history` as in the example above):

```ts
const calls: { id: string; name: string; arguments: string }[] = [];

for await (const chunk of chatComplete({
  provider: "anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY!,
  request: { model: "claude-haiku-4-5", messages: history, tools, stream: true },
})) {
  for (const piece of chunk.choices[0]?.delta.tool_calls ?? []) {
    calls[piece.index] ??= { id: "", name: "", arguments: "" };
    const call = calls[piece.index]!;
    call.id ||= piece.id ?? "";
    call.name ||= piece.function?.name ?? "";
    call.arguments += piece.function?.arguments ?? "";
  }
  if (chunk.choices[0]?.finish_reason === "tool_calls") {
    console.log(calls); // [{ id: "toolu_…", name: "get_weather", arguments: '{"city":"Paris"}' }]
  }
}
```

Some providers send a whole call in one piece (Gemini, Grok); the same code works for both.

## Providers

| `provider` | Example model | API | Notes |
|---|---|---|---|
| `openai` | `gpt-4o-mini` | OpenAI (official `openai` library) | Optional `organization` / `project` |
| `anthropic` | `claude-haiku-4-5` | Anthropic Messages API | `max_tokens` defaults to 1024. Optional `workspaceId` |
| `google` | `gemini-2.5-flash` | Gemini API | |
| `grok` | `grok-3-mini` | xAI (OpenAI-compatible) | |
| `deepseek` | `deepseek-chat` | DeepSeek (OpenAI-compatible) | |
| `qwen` | `qwen-plus` | Alibaba DashScope (Singapore region) | Optional `workspaceId` |
| `meta` | `muse-spark-1.3` | Meta Model API (OpenAI-compatible) | US developers, public preview. Keys at [dev.meta.ai](https://dev.meta.ai) |

Model names change often; check each provider's documentation for the current list. `getAvailableProviders()` returns the provider names above.

### Organization-level API keys

Some providers let one key work across several organizations, projects or workspaces. Pass the extra setting to `chatComplete`; providers that don't use a setting ignore it.

| Setting | Used by | Effect |
|---|---|---|
| `organization` | OpenAI | Sent as the `OpenAI-Organization` header |
| `project` | OpenAI | Sent as the `OpenAI-Project` header |
| `workspaceId` | Anthropic | Sent as the `anthropic-workspace-id` header (required for organization-level keys) |
| `workspaceId` | Qwen | Uses the workspace domain `https://{workspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1`. Because the ID becomes part of the hostname, only letters, numbers and `-` are allowed; anything else throws before a request is sent. |

```ts
await chatComplete({
  provider: "anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY!,
  workspaceId: process.env.ANTHROPIC_WORKSPACE_ID, // e.g. "wrkspc_01J..."
  request: { model: "claude-haiku-4-5", messages },
});
```

## The Gateway and prompts

### The Gateway

`Gateway` remembers your settings, so you don't pass them on every call:

```ts
import { Gateway } from "rezunate-llm-sdk";

const gateway = new Gateway({
  defaultProvider: "openai",
  defaultApiKey: process.env.OPENAI_API_KEY,
  rezunateLlmApiKey: process.env.REZUNATE_LLM_API_KEY, // only needed for prompts
});

const response = await gateway.chatComplete({ model: "gpt-4o-mini", messages });

// Use another provider for one call:
await gateway.chatComplete(
  { model: "claude-haiku-4-5", messages },
  { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY },
);
```

`gateway.chatComplete` works like `chatComplete` (streaming, tool calls, the same error rule). Without a provider or API key it throws `Provider must be specified` / `API key must be specified` (with `stream: true`, these come as an error chunk). The Rezunate client is created on first use, so chat alone needs no Rezunate key. Pass `guardrailsConfig` to apply [local guardrails](#local-guardrails) on every call; server guardrail options will come with that feature.

### Prompts

Write prompts on the [Rezunate website](https://rezunatellm.com) (Dashboard → Prompts), with `{{variable}}` placeholders. Each prompt gets a `slug_id` (for example `customer_support_reply_0nqr73`) and a version that increases with every edit. The SDK fetches a prompt by its `slug_id` and fills in the placeholders, so prompts can change without changing code.

You need a Rezunate API key (Dashboard → API Keys). Pass it as `rezunateLlmApiKey` (as above), or set the `REZUNATE_LLM_API_KEY` environment variable. With the `gateway` from above:

```ts
const systemPrompt = await gateway.getPrompt("customer_support_reply_0nqr73", {
  company_name: "Acme",
  customer_name: "Ali",
  customer_message: "My order hasn't arrived yet.",
  tone: "friendly",
  max_words: "80",
});

const reply = await gateway.chatComplete({
  model: "gpt-4o-mini",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: "Where is my order?" },
  ],
});
```

- Without a version, the prompt's current version is used; pass one to pin it: `gateway.getPrompt(slug, variables, 1)`.
- A placeholder without a value throws `Missing template variables: …`; extra values are ignored.
- A failed request throws `RouterAPIError` with the server's message and `statusCode` (for example `Prompt not found`, 404). Prompts follow the "invalid request throws" side of the [error rule](#errors).

The same steps are available on their own: `new RouterClient({ apiKey })`, `getPrompt(client, slugId, version)` and `renderPrompt(content, variables)`.

## Local guardrails

Define rules in a YAML file to **block**, **flag** or **redact** sensitive content (PII or anything custom) in the messages you send and in the model's replies. Everything runs in your app: no Rezunate account is needed and no data leaves your machine.

```yaml
# guardrails.yaml
guardrails:
  - name: block-ssn
    pattern: '\b\d{3}-\d{2}-\d{4}\b'
    description: "Block Social Security Numbers"
    action: block

  - name: redact-email
    pattern: '\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'
    description: "Redact email addresses"
    action: redact
    replacement: "[EMAIL]"

  - name: flag-api-key
    pattern: '\bsk-[A-Za-z0-9]{20,}\b'
    description: "Flag leaked API keys"
    action: flag
```

Each rule has a `name`, a `pattern` and optionally a `description`, an `action` and a `replacement`. Rules are checked in order.

| `action` | What happens when the pattern matches |
|---|---|
| `block` (default) | Throws `GuardrailsError` (`Guardrail 'block-ssn' triggered on INPUT: …`) |
| `redact` | Replaces every match with `replacement` (default `[REDACTED]`) |
| `flag` | Lets the text through unchanged and prints a warning |

**`pattern` is a JavaScript regular expression.** Common patterns, like the ones above, are the same as in Python. `loadGuardrails` checks every pattern when the file is loaded and throws `Invalid regex in rule '…'` for one that isn't valid.

Use the rules in one of two ways:

```ts
import { Gateway, loadGuardrails } from "rezunate-llm-sdk";

const guardrailsConfig = loadGuardrails("guardrails.yaml");

// For every call of a gateway (or pass `guardrailsConfig` to a single chatComplete call):
const guarded = new Gateway({
  defaultProvider: "openai",
  defaultApiKey: process.env.OPENAI_API_KEY,
  guardrailsConfig,
});
await guarded.chatComplete({ model: "gpt-4o-mini", messages });
```

Or set the `GUARDRAILS_FILE_PATH` environment variable to the file's path: it's loaded once and applied to every call that doesn't pass its own `guardrailsConfig`. If the file can't be loaded, a warning is printed and no rules are applied.

How the rules are applied:

- **Messages you send:** every message is checked before the request. `redact` changes the text that is sent, and also your own `messages` objects, as in the Python SDK (so they hold `[EMAIL]` afterwards).
- **Replies:** every choice is checked. `redact` replaces the text in the reply; `block` throws.
- **Streams:** each chunk is checked. A `block` rule ends the stream with an error chunk (`error.type: "guardrail_error"`), like every other stream problem. `flag` and `redact` only print a warning and chunks pass unchanged, because a match can be split across chunks.
- **Warnings:** violations are printed with `console.warn`, in the Python SDK's format, including the matched text: `GUARDRAIL FLAG [OUTPUT]: rule_name='flag-api-key' rule_description='…' match='sk-…'`.

You can also check a text yourself. `checkGuardrails` returns `[redactedText, violations]` and throws `GuardrailsError` for a `block` rule:

```ts
import { checkGuardrails, GuardrailsError, loadGuardrails } from "rezunate-llm-sdk";

const config = loadGuardrails("guardrails.yaml");
try {
  const [redacted, violations] = checkGuardrails("Email me at alex@example.com", config, "output");
  console.log(redacted); // "Email me at [EMAIL]"
  console.log(violations); // the rules that matched
} catch (error) {
  if (error instanceof GuardrailsError) {
    console.log(`Blocked by '${error.ruleName}' on ${error.direction}`);
  }
}
```

## Try it locally (for testers)

The package is not on npm yet. To test it the way a user would, build it, pack it, and install it in a separate folder:

```bash
# 1. In this repo: build and pack (creates rezunate-llm-sdk-0.0.0.tgz)
nvm use
pnpm install
pnpm build
pnpm pack

# 2. In a new folder outside the repo
mkdir ../rezunate-sdk-playground && cd ../rezunate-sdk-playground
echo 22 > .nvmrc && nvm use
npm init -y
npm pkg set type=module
npm install ../RezunateLLM_TS_SDK/rezunate-llm-sdk-0.0.0.tgz
```

Put your API keys in a `.env` file in that folder, write a `test.ts` that imports `chatComplete` from `"rezunate-llm-sdk"` (see [Quick start](#quick-start)), and run it:

```bash
node --env-file=.env test.ts
```

Node 22 runs `.ts` files directly. These calls use real API keys and cost a small amount.

## Development

```bash
nvm use        # Node 22
pnpm install   # also installs the pre-commit hook
```

| Command | What it does |
|---|---|
| `pnpm test` | Run all tests (no real network calls; HTTP is mocked) |
| `pnpm typecheck` | TypeScript type check |
| `pnpm lint` | Biome lint and format check (`pnpm lint:fix` to fix) |
| `pnpm build` | Build ESM + CJS + type declarations into `dist/` |

Before every commit, a pre-commit hook runs Biome on the staged files, the type check and the tests, and blocks the commit if any of them fail.

### Project layout

```
src/
└── rezunateLlmSdk/          # the library (rezunate_llm_sdk/ in Python)
    ├── index.ts             # public exports
    ├── gateway.ts           # chatComplete() and the Gateway class
    ├── client.ts            # RouterClient for the Rezunate LLM API
    ├── api.ts               # Rezunate LLM API endpoints (getPrompt)
    ├── prompts.ts           # renderPrompt()
    ├── guardrails.ts        # loadGuardrails() and checkGuardrails() (local guardrails)
    ├── models.ts            # request/response models (zod)
    ├── constants.ts
    ├── providers/           # one file per provider, plus base, factory and endpoints
    └── streaming/           # SSE parser used by the streaming providers
tests/                       # one *.test.ts per area; fixtures.ts holds shared test data
```

The `rezunate-guard` CLI will live next to the library in `src/rezunateGuard/`, as in the Python repository.

## Differences from the Python SDK

The TypeScript SDK is meant to behave like the Python SDK. These differences are intentional:

1. **One retry rule for every provider.** All seven providers retry through the SDK's own loop (429/500/502/503/504, timeouts and connection errors; 1s → 2s → 4s; `maxRetries` and `retryDelay` always apply). In Python, OpenAI, Grok and DeepSeek are retried by the `openai` library with its own rules (it also retries 408 and 409, and ignores `retry_delay`), and the others by the SDK's loop.
2. **`retries_attempted` is filled in, for every provider.** When a request finally fails, `error.retries_attempted` shows how many retries were made (for example `3` after 4 failed attempts, `0` when the error was not retried). In Python it is always empty.
3. **Finish reasons never break a reply.** Anthropic, Gemini and the OpenAI-format providers keep adding new stop/finish reasons (for example Anthropic's `refusal`, `pause_turn` and `model_context_window_exceeded`, or Gemini's `TOO_MANY_TOOL_CALLS`). The TS SDK translates every value the providers document today, and any value it doesn't know yet becomes `"stop"`, instead of failing. The provider's original value is always kept in `choices[].provider_finish_reason`. Gemini's image-only reasons (`IMAGE_SAFETY`, `IMAGE_PROHIBITED_CONTENT`, `IMAGE_RECITATION`, `IMAGE_OTHER`, `NO_IMAGE`) are not translated, because the SDK is text-only, so they also become `"stop"`. The same applies to streams. The Python SDK only accepts a fixed list, so a reply with a newer value (even ones its own mapping handles, such as Gemini's `BLOCKLIST` or `PROHIBITED_CONTENT`) is rejected and returned as an error.
4. **`meta` replaces `llama`.** Meta retired the Llama API (`api.llama.com`). The `meta` provider uses Meta's new OpenAI-compatible Meta Model API (`https://api.meta.ai/v1`) with the Muse Spark models. The Python SDK still has the `llama` provider for the retired API.
5. **Organization-level API keys are supported** (`organization`, `project`, `workspaceId`; see above). The Python SDK has none of these, so, for example, an organization-level Anthropic key fails there with "not scoped to a workspace".
6. **Blocked Gemini prompts are reported.** When Gemini blocks the question itself (it returns no answer, only `promptFeedback.blockReason`), the TS SDK returns one choice with no content, `finish_reason: "content_filter"` and the reason in `provider_finish_reason` (e.g. `"SAFETY"`), the same way a blocked answer is reported. In a stream, the same comes as one chunk. The Python SDK drops the reason and returns no choices and no error (in a stream: no chunks at all).
7. **TypeScript naming and style.** Functions and options use camelCase (`chatComplete`, `apiKey`), and the inputs are passed as one object (`chatComplete({ provider, apiKey, request })`). JSON fields sent to and received from providers keep their original names (`max_tokens`, `finish_reason`, and so on).
8. **The start of a stream is retried, for every provider.** In Python, Anthropic, Google and Qwen streams are never retried, and OpenAI-format streams are retried by the `openai` library with its own rules.
9. **Stream problems never throw.** With `stream: true`, every problem, including an invalid request or an unknown provider, comes as an error chunk. In Python, an invalid streaming request throws, and only provider and network failures come as error chunks.
10. **Error messages include the provider's explanation.** When a provider rejects a request, `error.message` adds the provider's own message (for example `404 Not Found for url: … - model: xyz`), in normal chat and in streams. In Python, Anthropic, Google and Qwen errors have only the status and the URL; the OpenAI-format providers include the message in both.
11. **Qwen supports tool calls.** Tools, `tool_choice`, `parallel_tool_calls`, tool calls in replies and `tool` messages work with Qwen (DashScope uses OpenAI's tool format). The Python SDK drops tools on Qwen and rejects `tool` messages.
12. **`function_call` means a tool call.** `function_call` is OpenAI's old name for `tool_calls`, and OpenAI-compatible APIs such as Meta's may still send it. The TS SDK translates it to `finish_reason: "tool_calls"`; the Python SDK rejects the reply.
13. **Gemini tool results find their function name.** Gemini matches a tool result by function name, not by id. When a `tool` message has no `name`, the TS SDK takes the name from the tool call with the same `tool_call_id` earlier in the conversation. The Python SDK sends the `tool_call_id` as the name, which Gemini may not match.
14. **Anthropic `tool_choice: "none"` is sent.** The TS SDK sends it as `{ "type": "none" }`, so Claude calls no tools. The Python SDK leaves it out, so Anthropic's default (`auto`) applies and the model may still call a tool.
15. **Gemini gets parallel tool results together.** When the model calls several tools at once, Gemini needs all their results in one message. The TS SDK groups `tool` messages that follow each other into one message; the Python SDK sends one message per result, which Gemini rejects.
16. **Gemini accepts full JSON Schema for tools.** The TS SDK sends a tool's schema to Gemini as `parametersJsonSchema`, so keywords such as `additionalProperties` (required by OpenAI's strict mode) and `$ref` work. The Python SDK uses Gemini's older `parameters` field, which rejects them with a 400 error.
17. **Tool calls work in streams.** With `stream: true`, tool calls arrive as pieces in `delta.tool_calls` (OpenAI's format) for every provider, and Gemini ends with `finish_reason: "tool_calls"`. In the Python SDK, stream chunks carry only text, so the tool call is lost (Gemini even ends with `"stop"`).
18. **A guardrail block in a stream comes as an error chunk.** With `stream: true`, a `block` rule ends the stream with one error chunk (`error.type: "guardrail_error"`), like every other stream problem. The Python SDK raises `GuardrailsError` in the middle of the stream. Without `stream`, both throw `GuardrailsError`.

## Known limitations

These behave the same as in the Python SDK and will be improved in later features:

- **Several system messages (Anthropic, Google):** these providers take a single system prompt, so when a request has more than one `system` message, only the last one is sent.

## License

MIT, see [LICENSE](LICENSE).
