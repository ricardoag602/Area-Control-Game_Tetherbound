import { describe, expect, it, vi } from "vitest";
import { createClientId } from "./clientId";

describe("createClientId", () => {
  it("uses randomUUID when the browser provides it", () => {
    const randomUUID = vi.fn(() => "browser-generated-uuid");

    expect(createClientId({ randomUUID })).toBe("browser-generated-uuid");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("creates a UUID from random bytes on insecure LAN origins", () => {
    const fillRandomBytes = (values: Uint8Array<ArrayBuffer>) => {
      values.set(Array.from({ length: 16 }, (_, index) => index));
    };

    expect(createClientId({ fillRandomBytes })).toBe(
      "00010203-0405-4607-8809-0a0b0c0d0e0f",
    );
  });

  it("still produces bounded unique IDs when Web Crypto is unavailable", () => {
    const first = createClientId(null);
    const second = createClientId(null);

    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(first.length).toBeLessThanOrEqual(80);
  });
});
