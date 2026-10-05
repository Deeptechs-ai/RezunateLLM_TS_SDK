# rezunate-llm-sdk (TypeScript)

Unified TypeScript SDK for chat completions across multiple AI providers, using the OpenAI request/response format. It is the TypeScript version of the Python SDK [`rezunate-llm-sdk`](https://pypi.org/project/rezunate-llm-sdk/).

>**Work in progress.** Normal (non-streaming) chat works with all providers. Other features of the Python SDK are being ported; see [Status](#status). The package is not published to npm yet.

## Status

| Feature | Status |
|---|---|
| Chat completion with OpenAI, Anthropic, Google (Gemini), Grok (xAI), DeepSeek, Qwen (Alibaba) and Meta | ✅ Done |
| Provider factory and registry (same design as the Python SDK) | ✅ Done |
| Automatic retries (one rule for all providers), timeouts, errors returned as a response | ✅ Done |
| Organization-level API keys (`organization`, `project`, `workspaceId`) | ✅ Done |
| Streaming | ⏳ Planned |
| Tool calls | ⏳ Planned |
| Prompts (fetch and render saved prompts) | ⏳ Planned |
| Guardrails (local rules and server-side PII masking) | ⏳ Planned |
| `Gateway` class | ⏳ Planned |
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
    ├── gateway.ts           # chatComplete()
    ├── models.ts            # request/response models (zod)
    ├── constants.ts
    └── providers/           # one file per provider, plus base, factory and endpoints
tests/                       # one *.test.ts per area; fixtures.ts holds shared test data
```

The `rezunate-guard` CLI will live next to the library in `src/rezunateGuard/`, as in the Python repository.

## Differences from the Python SDK

The TypeScript SDK is meant to behave like the Python SDK. These differences are intentional:

1. **One retry rule for every provider.** All seven providers retry through the SDK's own loop (429/500/502/503/504, timeouts and connection errors; 1s → 2s → 4s; `maxRetries` and `retryDelay` always apply). In Python, OpenAI, Grok and DeepSeek are retried by the `openai` library with its own rules (it also retries 408 and 409, and ignores `retry_delay`), and the others by the SDK's loop.
2. **`retries_attempted` is filled in, for every provider.** When a request finally fails, `error.retries_attempted` shows how many retries were made (for example `3` after 4 failed attempts, `0` when the error was not retried). In Python it is always empty.
3. **Finish reasons never break a reply.** Anthropic, Gemini and the OpenAI-format providers keep adding new stop/finish reasons (for example Anthropic's `refusal`, `pause_turn` and `model_context_window_exceeded`, or Gemini's `IMAGE_SAFETY`). The TS SDK translates every value the providers document today, and any value it doesn't know yet becomes `"stop"`, instead of failing. The provider's original value is always kept in `choices[].provider_finish_reason`. The Python SDK only accepts a fixed list, so a reply with a newer value (even ones its own mapping handles, such as Gemini's `BLOCKLIST` or `PROHIBITED_CONTENT`) is rejected and returned as an error.
4. **`meta` replaces `llama`.** Meta retired the Llama API (`api.llama.com`). The `meta` provider uses Meta's new OpenAI-compatible Meta Model API (`https://api.meta.ai/v1`) with the Muse Spark models. The Python SDK still has the `llama` provider for the retired API.
5. **Organization-level API keys are supported** (`organization`, `project`, `workspaceId`; see above). The Python SDK has none of these, so, for example, an organization-level Anthropic key fails there with "not scoped to a workspace".
6. **Blocked Gemini prompts are reported.** When Gemini blocks the question itself (it returns no answer, only `promptFeedback.blockReason`), the TS SDK returns one choice with no content, `finish_reason: "content_filter"` and the reason in `provider_finish_reason` (e.g. `"SAFETY"`), the same way a blocked answer is reported. The Python SDK drops the reason and returns no choices and no error.
7. **TypeScript naming and style.** Functions and options use camelCase (`chatComplete`, `apiKey`), and the inputs are passed as one object (`chatComplete({ provider, apiKey, request })`). JSON fields sent to and received from providers keep their original names (`max_tokens`, `finish_reason`, and so on).

## Known limitations

These behave the same as in the Python SDK and will be improved in later features:

- **Several system messages (Anthropic, Google):** these providers take a single system prompt, so when a request has more than one `system` message, only the last one is sent.
- **Tool calls are not supported yet:** `tools` and `tool_choice` are not translated for Anthropic and Google, `tool_calls` in replies are dropped, and `tool` messages are sent as `user` messages (Qwen rejects them). Full tool-call support is planned.
- **Streaming:** `stream: true` throws "Streaming is not supported yet".

## License

MIT, see [LICENSE](LICENSE).
