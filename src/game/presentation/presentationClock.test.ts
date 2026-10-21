import { describe, expect, it, vi } from "vitest";
import {
  createPresentationClock,
  PRESENTATION_FRAME_PRIORITY,
} from "./presentationClock";

function testScheduler() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    scheduler: {
      request(callback: FrameRequestCallback) {
        const id = nextId;
        nextId += 1;
        callbacks.set(id, callback);
        return id;
      },
      cancel(id: number) {
        callbacks.delete(id);
      },
    },
    flush(timeMs: number) {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(timeMs);
    },
    pendingCount() {
      return callbacks.size;
    },
  };
}

describe("presentation clock", () => {
  it("shares one animation request and runs subscribers deterministically", () => {
    const harness = testScheduler();
    const clock = createPresentationClock(harness.scheduler);
    const order: string[] = [];

    clock.subscribe(() => order.push("scene-first"), PRESENTATION_FRAME_PRIORITY.scene);
    clock.subscribe(() => order.push("positions"), PRESENTATION_FRAME_PRIORITY.positions);
    clock.subscribe(() => order.push("scene-second"), PRESENTATION_FRAME_PRIORITY.scene);
    clock.subscribe(() => order.push("camera"), PRESENTATION_FRAME_PRIORITY.camera);

    expect(harness.pendingCount()).toBe(1);
    harness.flush(100);
    expect(order).toEqual([
      "positions",
      "camera",
      "scene-first",
      "scene-second",
    ]);
    expect(harness.pendingCount()).toBe(1);
  });

  it("publishes one shared, monotonic frame delta", () => {
    const harness = testScheduler();
    const clock = createPresentationClock(harness.scheduler);
    const first = vi.fn();
    const second = vi.fn();
    clock.subscribe(first);
    clock.subscribe(second);

    harness.flush(1_000);
    harness.flush(1_016);

    expect(first).toHaveBeenNthCalledWith(1, {
      timeMs: 1_000,
      deltaMs: 0,
      deltaSeconds: 0,
    });
    expect(second).toHaveBeenNthCalledWith(2, {
      timeMs: 1_016,
      deltaMs: 16,
      deltaSeconds: 0.016,
    });
  });

  it("stops when empty and defers subscription changes to the next frame", () => {
    const harness = testScheduler();
    const clock = createPresentationClock(harness.scheduler);
    const calls: string[] = [];
    let unsubscribeSecond: () => void = () => undefined;
    const unsubscribeFirst = clock.subscribe(() => {
      calls.push("first");
      unsubscribeSecond();
      clock.subscribe(() => calls.push("late"));
    }, 1);
    unsubscribeSecond = clock.subscribe(() => calls.push("second"), 2);

    harness.flush(10);
    expect(calls).toEqual(["first"]);
    harness.flush(20);
    expect(calls).toEqual(["first", "first", "late"]);

    unsubscribeFirst();
    // The subscriber created in the callback intentionally remains active.
    expect(harness.pendingCount()).toBe(1);
  });

  it("cancels the pending request after the final unsubscribe", () => {
    const harness = testScheduler();
    const clock = createPresentationClock(harness.scheduler);
    const unsubscribe = clock.subscribe(() => undefined);

    expect(harness.pendingCount()).toBe(1);
    unsubscribe();
    expect(harness.pendingCount()).toBe(0);
  });

  it("isolates a failing visual layer and keeps the shared clock alive", () => {
    const harness = testScheduler();
    const clock = createPresentationClock(harness.scheduler);
    const healthy = vi.fn();
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    clock.subscribe(() => {
      throw new Error("renderer failed");
    }, 1);
    clock.subscribe(healthy, 2);

    harness.flush(10);
    harness.flush(20);

    expect(healthy).toHaveBeenCalledTimes(2);
    expect(harness.pendingCount()).toBe(1);
    expect(report).toHaveBeenCalledTimes(2);
    report.mockRestore();
  });
});
