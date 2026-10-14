/**
 * Resolves files copied from `public/assets` against Vite's deployment base.
 * This keeps runtime-loaded files working when the game is hosted somewhere
 * other than the domain root, such as `/tetherbound/`.
 */
export function publicAssetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}assets/${path.replace(/^\/+/, "")}`;
}
