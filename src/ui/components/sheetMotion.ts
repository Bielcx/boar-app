/** A visibility change animates only when it opens, or closes a sheet that is on screen (perf audit #12). */
export function sheetAnimates(visible: boolean, mounted: boolean): boolean {
  return visible || mounted;
}

/**
 * How far the sheet slides: its own measured height, so the top is off screen on the first frame
 * whatever the sheet's size (a fixed 400 pt left the top of a taller sheet already showing, Iris
 * TR-4). Before the first layout, the window height. Reduce motion: no slide, the sheet fades.
 */
export function sheetTravel(measured: number, windowHeight: number, reduceMotion: boolean): number {
  if (reduceMotion) return 0;
  return measured > 0 ? measured : windowHeight;
}
