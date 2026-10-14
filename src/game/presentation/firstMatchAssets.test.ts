import { describe, expect, it } from "vitest";
import {
  allowsFirstMatchPreload,
  FIRST_MATCH_IMAGE_URLS,
} from "./firstMatchAssets";

describe("FIRST_MATCH_IMAGE_URLS", () => {
  it("contains only compact WebP assets with no duplicate requests", () => {
    expect(FIRST_MATCH_IMAGE_URLS).toHaveLength(10);
    expect(new Set(FIRST_MATCH_IMAGE_URLS).size).toBe(FIRST_MATCH_IMAGE_URLS.length);
    expect(FIRST_MATCH_IMAGE_URLS.every((url) => url.endsWith(".webp"))).toBe(true);
  });
});

describe("allowsFirstMatchPreload", () => {
  it("respects constrained-network browser hints", () => {
    expect(allowsFirstMatchPreload(undefined)).toBe(true);
    expect(allowsFirstMatchPreload({ effectiveType: "4g" })).toBe(true);
    expect(allowsFirstMatchPreload({ effectiveType: "2g" })).toBe(false);
    expect(allowsFirstMatchPreload({ effectiveType: "slow-2g" })).toBe(false);
    expect(allowsFirstMatchPreload({ saveData: true, effectiveType: "4g" })).toBe(false);
  });
});
