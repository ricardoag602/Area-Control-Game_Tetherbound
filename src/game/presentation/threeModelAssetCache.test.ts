import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getThreeModelResourcePath,
  loadThreeModelAsset,
  preloadThreeModelAsset,
} from "./threeModelAssetCache";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("threeModelAssetCache", () => {
  it("downloads bytes once while parsing an independently owned GLTF per consumer", async () => {
    const fetchMock = vi.fn(async () => modelResponse());
    vi.stubGlobal("fetch", fetchMock);
    const url = "/game/assets/models/shared-test.gltf?revision=1";

    const [first, second] = await Promise.all([
      loadThreeModelAsset(url),
      loadThreeModelAsset(url),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).not.toBe(second);
    expect(first.scene).not.toBe(second.scene);
  });

  it("suppresses preload rejection, removes the failed entry, and retries for the match", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(modelResponse());
    vi.stubGlobal("fetch", fetchMock);
    const url = "/game/assets/models/retry-test.gltf";

    preloadThreeModelAsset(url);
    await Promise.resolve();
    await Promise.resolve();

    await expect(loadThreeModelAsset(url)).resolves.toMatchObject({
      scene: expect.any(Object),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("derives the resource directory without carrying file query parameters", () => {
    expect(getThreeModelResourcePath(
      "https://example.test/game/assets/models/crew.glb?revision=2#scene",
    )).toBe("https://example.test/game/assets/models/");
    expect(getThreeModelResourcePath("crew.glb")).toBe("./");
  });
});

function modelResponse() {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [] }],
      nodes: [],
    })).buffer,
  } as Response;
}
