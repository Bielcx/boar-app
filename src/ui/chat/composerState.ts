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
 * is the send button's accessibility hint. One message per state: while loading,
 * the strip at the top already names the model (Prism LD-1), so the field only
 * changes its placeholder; on error, the error card says what to do.
 */
export function composerNotice(status: ModelStatus): { line: string | null; hint: string | null } {
  switch (status) {
    case "loading":
      return { line: null, hint: "chat.composer.notReady" };
    case "error":
      return { line: null, hint: "chat.composer.modelError" };
    default:
      return { line: null, hint: null };
  }
}

/** The field's placeholder: while the model loads it says typing already works. */
export function composerPlaceholderKey(status: ModelStatus): string {
  return status === "loading" ? "chat.composer.placeholderLoading" : "chat.composer.placeholder";
}
