import { describe, expect, it } from "vitest";
import { getUrl, OPENAI_BASE_URL, OPENAI_CHAT_ENDPOINT } from "../src/providers/endpoints";

// Expected values were produced by running the Python `get_url` on the same inputs.
describe("getUrl", () => {
  it("joins a base URL and an endpoint", () => {
    expect(getUrl(OPENAI_BASE_URL, OPENAI_CHAT_ENDPOINT)).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("handles a trailing slash on the base URL", () => {
    expect(getUrl("https://api.openai.com/v1/", "/chat/completions")).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("handles an endpoint without a leading slash", () => {
    expect(getUrl("https://api.openai.com/v1", "chat/completions")).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("fills in the model name", () => {
    expect(
      getUrl(
        "https://generativelanguage.googleapis.com/v1beta",
        "/models/{model}:generateContent",
        "gemini-pro",
      ),
    ).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent");
  });

  it("keeps a query string intact", () => {
    expect(
      getUrl(
        "https://generativelanguage.googleapis.com/v1beta",
        "/models/{model}:streamGenerateContent?alt=sse",
        "gemini-pro",
      ),
    ).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent?alt=sse",
    );
  });
});
