/** A visibility change animates only when it opens, or closes a sheet that is on screen (perf audit #12). */
export function sheetAnimates(visible: boolean, mounted: boolean): boolean {
  return visible || mounted;
}
