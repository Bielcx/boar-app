/**
 * What the composer says about sending, from the model's state. Typing is
 * always allowed; sending waits for a loaded model. A failed load is never
 * reported as "loading": the error card above says what to do.
 */
export type ModelStatus = "ready" | "loading" | "error";

export function modelStatus(ready: boolean, loadError: string | null | undefined): ModelStatus {
  if (loadError) return "error";
  return ready ? "ready" : "loading";
}

/**
 * Why sending is off, as i18n keys: `line` is shown above the field, `hint`
 * is the send button's accessibility hint. On error only the hint remains:
 * the error card already says what happened and what to do (one message per state).
 */
export function composerNotice(status: ModelStatus): { line: string | null; hint: string | null } {
  switch (status) {
    case "loading":
      return { line: "chat.composer.notReady", hint: "chat.composer.notReady" };
    case "error":
      return { line: null, hint: "chat.composer.modelError" };
    default:
      return { line: null, hint: null };
  }
}
