import { describe, expect, it, vi } from "vitest";
import { settleTerrainInitialization } from "./PixiTerrainLayer";

describe("settleTerrainInitialization", () => {
  it("reports readiness only after successful terrain initialization", async () => {
    const onReady = vi.fn();
    const onError = vi.fn();

    await settleTerrainInitialization(
      async () => undefined,
      onReady,
      onError,
    );

    expect(onReady).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("routes texture or renderer failure without falsely reporting readiness", async () => {
    const failure = new Error("terrain texture failed");
    const onReady = vi.fn();
    const onError = vi.fn();

    await settleTerrainInitialization(
      async () => { throw failure; },
      onReady,
      onError,
    );

    expect(onReady).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("does not publish a result after the layer is cancelled", async () => {
    const onReady = vi.fn();
    const onError = vi.fn();

    await settleTerrainInitialization(
      async () => undefined,
      onReady,
      onError,
      () => true,
    );

    expect(onReady).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
