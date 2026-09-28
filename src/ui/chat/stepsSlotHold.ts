/**
 * SEND-MOTION v2 P3: the minimum height of the slot the steps card and the answer's text share. While the
 * card is there, nothing (it sizes the slot). From the moment the text takes its place, the card's last
 * height, so the crossfade happens in a slot that neither cuts nor jumps; the text grows past it freely.
 * Once the answer is over the hold is let go (animated by the caller), so a short answer ("Canberra.")
 * ends at its own height. Never measured (history, no card): no hold.
 */
export function slotHold(stepsShowing: boolean, reserve: number, letGo: boolean): number | undefined {
  if (stepsShowing || letGo || reserve <= 0) return undefined;
  return reserve;
}
