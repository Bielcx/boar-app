import type { ConversationTurn } from "../../rag/retrieve";
import type { ChatMessageRecord } from "../../services/chatHistory";
import { stripThinking } from "../../services/thinking";
import type { AnswerState } from "./answerReducer";
import { answerTextForHistory, fromStoredAnswer } from "./answerRecord";

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "assistant";
      id: string;
      question: string;
      answer: AnswerState;
      feedback: "up" | "down" | null;
      interrupted?: boolean;
    };

/** Rebuilds the conversation from stored rows; each answer remembers the question before it. */
export function itemsFromRecords(records: ChatMessageRecord[]): ChatItem[] {
  let question = "";
  return records.map((r): ChatItem => {
    if (r.role === "user") {
      question = r.text;
      return { kind: "user", id: r.id, text: r.text };
    }
    return { kind: "assistant", id: r.id, question, answer: fromStoredAnswer(r.id, r.text, r.meta), feedback: r.feedback };
  });
}

/** The last `count` messages as prompt history: answers without their reasoning, empty turns dropped. */
export function historyTurns(items: ChatItem[], count: number): ConversationTurn[] {
  return items
    .map((m): ConversationTurn =>
      m.kind === "user" ? { role: "user", text: m.text } : { role: "assistant", text: stripThinking(answerTextForHistory(m.answer)) }
    )
    .filter((turn) => turn.text.trim().length > 0)
    .slice(-count);
}

/** Applies `update` to the answer of message `id`, leaving every other item untouched. */
export function updateAnswer(items: ChatItem[], id: string, update: (a: AnswerState) => AnswerState): ChatItem[] {
  return items.map((m) => (m.kind === "assistant" && m.id === id ? { ...m, answer: update(m.answer) } : m));
}
