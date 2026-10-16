import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";

export const THREE_MODEL_REQUEST_TIMEOUT_MS = 30_000;

const rawModelRequests = new Map<string, Promise<ArrayBuffer>>();

/**
 * Starts one cacheable byte request without exposing its rejection. The real
 * loader still awaits the original promise, so failures are reported when a
 * match consumes the model rather than becoming unhandled menu errors.
 */
export function preloadThreeModelAsset(url: string) {
  void getThreeModelBytes(url).catch(() => undefined);
}

/**
 * Shares only immutable downloaded bytes. Every consumer parses its own GLTF,
 * which keeps scene ownership and disposal isolated across mounts/StrictMode.
 */
export async function loadThreeModelAsset(url: string): Promise<GLTF> {
  const bytes = await getThreeModelBytes(url);
  return new GLTFLoader().parseAsync(
    bytes.slice(0),
    getThreeModelResourcePath(url),
  );
}

export function getThreeModelResourcePath(url: string) {
  const cleanUrl = url.split(/[?#]/, 1)[0] ?? url;
  const finalSlash = cleanUrl.lastIndexOf("/");
  return finalSlash >= 0 ? cleanUrl.slice(0, finalSlash + 1) : "./";
}

function getThreeModelBytes(url: string) {
  const existing = rawModelRequests.get(url);
  if (existing) return existing;

  const pending = fetchThreeModelBytes(url);
  rawModelRequests.set(url, pending);
  // Register a rejection handler immediately so fire-and-forget preloads are
  // always safe. Keep the original rejecting promise for match-time callers.
  void pending.catch(() => {
    if (rawModelRequests.get(url) === pending) rawModelRequests.delete(url);
  });
  return pending;
}

async function fetchThreeModelBytes(url: string) {
  if (typeof fetch !== "function") {
    throw new Error(`Unable to load 3D model without fetch support: ${url}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`3D model request timed out: ${url}`)),
    THREE_MODEL_REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      cache: "force-cache",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`3D model request failed (${response.status}): ${url}`);
    }
    return await response.arrayBuffer();
  } finally {
    clearTimeout(timeout);
  }
}
