interface ClientCrypto {
  randomUUID?: () => string;
  fillRandomBytes?: (values: Uint8Array<ArrayBuffer>) => void;
}

let fallbackCounter = 0;

/**
 * Creates IDs for retry deduplication, not authentication. LAN development
 * pages use plain HTTP, where randomUUID may be unavailable even though
 * getRandomValues is supported.
 */
export function createClientId(
  cryptoSource: ClientCrypto | null = browserCryptoSource(),
) {
  if (typeof cryptoSource?.randomUUID === "function") {
    return cryptoSource.randomUUID();
  }

  if (typeof cryptoSource?.fillRandomBytes === "function") {
    const bytes = new Uint8Array(16);
    cryptoSource.fillRandomBytes(bytes);
    // Mark the random bytes as an RFC 4122 version 4 UUID.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10, 16).join(""),
    ].join("-");
  }

  // A final compatibility fallback keeps request IDs unique within this page.
  fallbackCounter += 1;
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  return `client-${time}-${fallbackCounter.toString(36)}-${random}`;
}

function browserCryptoSource(): ClientCrypto | null {
  const cryptoSource = globalThis.crypto;
  if (!cryptoSource) return null;

  return {
    ...(typeof cryptoSource.randomUUID === "function"
      ? { randomUUID: () => cryptoSource.randomUUID() }
      : {}),
    ...(typeof cryptoSource.getRandomValues === "function"
      ? { fillRandomBytes: (values: Uint8Array<ArrayBuffer>) => { cryptoSource.getRandomValues(values); } }
      : {}),
  };
}
