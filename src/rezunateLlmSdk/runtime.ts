/** Checks that the running Node.js version is one the SDK supports (called from index.ts). */

import * as constants from "./constants";

/**
 * Throw a clear error on a Node.js version older than the SDK supports, instead of an unclear
 * failure later. Runtimes without Node's `process` (such as edge workers) are not checked.
 */
export function assertSupportedNode(version: string | undefined): void {
  const major = Number(version?.split(".")[0]);
  if (version && major < constants.MIN_NODE_MAJOR) {
    throw new Error(
      `@rezunatellm/llm-sdk requires Node.js ${constants.MIN_NODE_MAJOR} or newer (you have ${version}).`,
    );
  }
}
