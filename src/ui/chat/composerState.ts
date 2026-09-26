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

/** i18n key of the line above the field (and the send button's hint), or null when sending works. */
export function composerNoticeKey(status: ModelStatus): string | null {
  switch (status) {
    case "loading":
      return "chat.composer.notReady";
    case "error":
      return "chat.composer.modelError";
    default:
      return null;
  }
}
