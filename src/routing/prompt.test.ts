import { describe, it, expect } from "vitest";
import type { RetrievedChunk } from "../rag/retrieve.types";
import { assembleChatMessages, type ChatMessage } from "../rag/pure";
import { approxTokens } from "./context";

/**
 * KV reuse of the system prompt. llama.rn keeps the previous completion's KV
 * cache and re-evaluates only from the first token that differs
 * (find_common_prefix_length, llama.rn cpp/rn-completion.cpp), so no app-side
 * state saving is needed: any prompt whose opening tokens repeat is reused
 * for free while the same model stays loaded. This test measures how much of
 * a follow-up question's prompt is that shared prefix with the app's layout.
 * (A layout with sources after the history was tried and reused only ~6%
 * more, because history stores the raw question, not the sources sent with
 * it, so it was not adopted.)
 */
const src = (id: string, title: string, body: string): RetrievedChunk => ({ chunkId: id, docId: id, title, body, score: 1, matchType: "hybrid" });
const serialize = (msgs: ChatMessage[]) => msgs.map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`).join("");
const commonPrefix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
};

describe("system-prompt KV reuse across turns", () => {
  it("shares the whole system instruction between consecutive RAG questions", () => {
    const system = "You are a concise research assistant.";
    const t1 = serialize(
      assembleChatMessages("What is the capital of Australia?", [src("a", "Canberra", "Canberra is the capital city of Australia.")], system)
    );
    const t2 = serialize(
      assembleChatMessages(
        "Who designed it?",
        [src("b", "Walter Burley Griffin", "Walter Burley Griffin was an American architect who designed Canberra.")],
        system,
        { turns: [{ role: "user", text: "What is the capital of Australia?" }, { role: "assistant", text: "Canberra [1]." }] }
      )
    );
    const shared = commonPrefix(t1, t2);
    console.log(`[prompt] turn-2 prompt tokens reusable from KV: ${approxTokens(shared)} of ${approxTokens(t2)}`);
    // Everything up to the context block is identical, grounding instruction included.
    expect(shared).toContain("You have no ability to control real-world devices");
    expect(approxTokens(shared)).toBeGreaterThan(100);
  });
});
