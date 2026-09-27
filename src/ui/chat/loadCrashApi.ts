/**
 * Where the chat learns that loading a model killed the app last time (Boar
 * CR-2): the engine writes a mark before a load and, on the next start, falls
 * back to the previous model. consumeLoadCrash() returns that record once and
 * clears it. PROVISIONAL (proposed to Tusk): replace with a re-export from the
 * engine when it publishes the contract.
 */
export interface LoadCrash {
  crashedModelId: string;
  crashedLabel: string;
  fallbackModelId: string;
  fallbackLabel: string;
  /** When the crashed load started (ms since epoch). */
  at: number;
}

export async function consumeLoadCrash(): Promise<LoadCrash | null> {
  return null;
}
