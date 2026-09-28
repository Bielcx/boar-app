import { describe, it, expect } from "vitest";
import { createBottomPin, GLIDE_GUARD_MS, heightChanged } from "./listPin";

describe("heightChanged (audit #8/#10)", () => {
  it("pins on the first layout and while the keyboard moves the list", () => {
    expect(heightChanged(null, 600)).toBe(true);
    expect(heightChanged(600, 580)).toBe(true);
    expect(heightChanged(580, 600)).toBe(true);
  });
  it("ignores layouts that leave the height as it was", () => {
    expect(heightChanged(600, 600)).toBe(false);
    expect(heightChanged(600, 600.4)).toBe(false);
  });
});

function harness() {
  let clock = 0;
  const calls: boolean[] = [];
  let pending: { fn: () => void; at: number } | null = null;
  const pin = createBottomPin({
    scrollToEnd: (animated) => calls.push(animated),
    now: () => clock,
    schedule: (fn, ms) => {
      const task = { fn, at: clock + ms };
      pending = task;
      return () => {
        if (pending === task) pending = null;
      };
    },
  });
  const advance = (ms: number) => {
    clock += ms;
    if (pending && pending.at <= clock) {
      const { fn } = pending;
      pending = null;
      fn();
    }
  };
  return { pin, calls, advance };
}

describe("createBottomPin (SEND-MOTION D4)", () => {
  it("snaps on content changes when nothing glides", () => {
    const h = harness();
    h.pin.pin();
    h.pin.pin();
    expect(h.calls).toEqual([false, false]);
  });

  it("glides once on the content change after a send, not before it", () => {
    const h = harness();
    h.pin.armGlide();
    expect(h.calls).toEqual([]);
    h.pin.pin();
    expect(h.calls).toEqual([true]);
    expect(h.pin.gliding()).toBe(true);
  });

  it("holds snaps during a glide and follows with one more glide", () => {
    const h = harness();
    h.pin.glide();
    h.pin.pin(); // the keyboard closing
    h.pin.pin(); // the steps card measured
    expect(h.calls).toEqual([true]);
    h.advance(GLIDE_GUARD_MS);
    expect(h.calls).toEqual([true, true]);
    h.advance(GLIDE_GUARD_MS);
    expect(h.pin.gliding()).toBe(false);
    h.pin.pin();
    expect(h.calls).toEqual([true, true, false]);
  });

  it("ends a glide quietly when nothing came in", () => {
    const h = harness();
    h.pin.glide();
    h.advance(GLIDE_GUARD_MS);
    expect(h.calls).toEqual([true]);
    expect(h.pin.gliding()).toBe(false);
  });

  it("keeps an armed glide for the content: the keyboard's layouts snap meanwhile, in the same frame", () => {
    const h = harness();
    h.pin.armGlide();
    h.pin.pin(true, "layout");
    expect(h.calls).toEqual([false]);
    h.pin.pin();
    expect(h.calls).toEqual([false, true]);
    h.pin.pin(true, "layout");
    expect(h.calls).toEqual([false, true]);
  });

  it("under reduce motion reaches the end without animating", () => {
    const h = harness();
    h.pin.armGlide();
    h.pin.pin(false);
    expect(h.calls).toEqual([false]);
    expect(h.pin.gliding()).toBe(false);
  });

  it("lets a drag take the list: no trailing glide, no armed glide", () => {
    const h = harness();
    h.pin.glide();
    h.pin.pin();
    h.pin.cancel();
    h.advance(GLIDE_GUARD_MS);
    expect(h.calls).toEqual([true]);
    h.pin.armGlide();
    h.pin.cancel();
    h.pin.pin();
    expect(h.calls).toEqual([true, false]);
  });
});
