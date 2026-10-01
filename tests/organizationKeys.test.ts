/**
 * Tests for organization-level key settings (`organization`, `project`, `workspaceId`).
 * New in the TS port (known difference #4): the Python SDK has no such settings.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { chatComplete } from "../src/rezunateLlmSdk/gateway";
import { getProvider } from "../src/rezunateLlmSdk/providers";
import {
  anthropicResponse,
  deepseekResponse,
  googleResponse,
  grokResponse,
  metaResponse,
  mockApiKey,
  mockFetch,
  openaiResponse,
  qwenResponse,
} from "./fixtures";

const ORG_SETTINGS = { organization: "org-abc123", project: "proj_xyz789" };
const WORKSPACE_ID = "wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The headers and URL of the first request sent through the mocked fetch. */
function sent(fetch: ReturnType<typeof mockFetch>) {
  return {
    url: String(fetch.mock.calls[0]?.[0]),
    headers: new Headers(fetch.mock.calls[0]?.[1]?.headers),
  };
}

async function callProvider(provider: string, model: string, settings: Record<string, string>) {
  return chatComplete({
    provider,
    apiKey: mockApiKey,
    request: { model, messages: [{ role: "user", content: "Hi" }] },
    ...settings,
  });
}

describe("provider settings", () => {
  it("default to null when not given", () => {
    const provider = getProvider("openai", mockApiKey);

    expect(provider.organization).toBeNull();
    expect(provider.project).toBeNull();
    expect(provider.workspaceId).toBeNull();
  });

  it("are stored when given", () => {
    const provider = getProvider("anthropic", mockApiKey, {
      ...ORG_SETTINGS,
      workspaceId: WORKSPACE_ID,
    });

    expect(provider.organization).toBe("org-abc123");
    expect(provider.project).toBe("proj_xyz789");
    expect(provider.workspaceId).toBe(WORKSPACE_ID);
  });
});

describe("OpenAI organization and project", () => {
  it("sends the OpenAI-Organization and OpenAI-Project headers when set", async () => {
    const fetch = mockFetch({ json: openaiResponse() });

    const result = await callProvider("openai", "gpt-4", ORG_SETTINGS);

    const { headers } = sent(fetch);
    expect(result.error).toBeNull();
    expect(headers.get("OpenAI-Organization")).toBe("org-abc123");
    expect(headers.get("OpenAI-Project")).toBe("proj_xyz789");
  });

  it("sends neither header when not set", async () => {
    const fetch = mockFetch({ json: openaiResponse() });

    await callProvider("openai", "gpt-4", {});

    const { headers } = sent(fetch);
    expect(headers.has("OpenAI-Organization")).toBe(false);
    expect(headers.has("OpenAI-Project")).toBe(false);
  });

  it.each([
    ["grok", "grok-3-mini", grokResponse],
    ["deepseek", "deepseek-chat", deepseekResponse],
    ["meta", "muse-spark-1.3", metaResponse],
  ])("is ignored by %s (OpenAI-only setting)", async (provider, model, response) => {
    const fetch = mockFetch({ json: response() });

    const result = await callProvider(provider, model, ORG_SETTINGS);

    const { headers } = sent(fetch);
    expect(result.error).toBeNull();
    expect(headers.has("OpenAI-Organization")).toBe(false);
    expect(headers.has("OpenAI-Project")).toBe(false);
  });
});

describe("Anthropic workspace", () => {
  it("sends the anthropic-workspace-id header when set", async () => {
    const fetch = mockFetch({ json: anthropicResponse() });

    const result = await callProvider("anthropic", "claude-haiku-4-5", {
      workspaceId: WORKSPACE_ID,
    });

    expect(result.error).toBeNull();
    expect(sent(fetch).headers.get("anthropic-workspace-id")).toBe(WORKSPACE_ID);
  });

  it("sends no workspace header when not set", async () => {
    const fetch = mockFetch({ json: anthropicResponse() });

    await callProvider("anthropic", "claude-haiku-4-5", {});

    expect(sent(fetch).headers.has("anthropic-workspace-id")).toBe(false);
  });
});

describe("Qwen workspace", () => {
  it("uses the workspace-specific domain when set", async () => {
    const fetch = mockFetch({ json: qwenResponse() });

    const result = await callProvider("qwen", "qwen-plus", { workspaceId: "ws-abc123" });

    expect(result.error).toBeNull();
    expect(sent(fetch).url).toBe(
      "https://ws-abc123.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
    );
  });

  it("uses the default domain when not set", async () => {
    const fetch = mockFetch({ json: qwenResponse() });

    await callProvider("qwen", "qwen-plus", {});

    expect(sent(fetch).url).toBe(
      "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
    );
  });
});

describe("workspaceId on providers without workspaces", () => {
  it("is ignored by Google", async () => {
    const fetch = mockFetch({ json: googleResponse() });

    const result = await callProvider("google", "gemini-2.5-flash", { workspaceId: WORKSPACE_ID });

    const { url, headers } = sent(fetch);
    expect(result.error).toBeNull();
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    expect(headers.has("anthropic-workspace-id")).toBe(false);
  });

  it("is ignored by OpenAI", async () => {
    const fetch = mockFetch({ json: openaiResponse() });

    await callProvider("openai", "gpt-4", { workspaceId: WORKSPACE_ID });

    expect(sent(fetch).headers.has("anthropic-workspace-id")).toBe(false);
  });
});
