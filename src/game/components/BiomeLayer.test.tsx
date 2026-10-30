import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BiomeLayer } from "./BiomeLayer";

describe("BiomeLayer", () => {
  it("renders the shared wider neutral lanes in compact minimap mode", () => {
    const markup = renderToStaticMarkup(<svg><BiomeLayer compact /></svg>);

    expect(markup).toContain('class="biome-layer biome-layer--compact"');
    expect(markup).toContain(
      'data-region="vertical-neutral-corridor" x="160" y="0" width="30" height="350"',
    );
    expect(markup).toContain(
      'data-region="horizontal-neutral-corridor" x="0" y="160" width="350" height="30"',
    );
  });
});
