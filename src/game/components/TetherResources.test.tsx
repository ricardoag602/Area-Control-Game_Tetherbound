import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TetherResources } from "./TetherResources";

describe("tether resource presentation", () => {
  it("uses the neutral panel while neither fabrication nor deployment is ready", () => {
    const markup = renderToStaticMarkup(
      <TetherResources
        bankedSalvage={0}
        carriedSalvage={1}
        tetherKits={0}
        deployReady={false}
      />,
    );

    expect(markup).not.toContain("tether-resources--fabrication-ready");
    expect(markup).not.toContain("tether-resources--deploy-ready");
  });

  it("highlights enough combined material to fabricate a tether", () => {
    const markup = renderToStaticMarkup(
      <TetherResources
        bankedSalvage={1}
        carriedSalvage={2}
        tetherKits={0}
        deployReady={false}
      />,
    );

    expect(markup).toContain("tether-resources--fabrication-ready");
  });

  it("marks a tether that can be deployed at the current position", () => {
    const markup = renderToStaticMarkup(
      <TetherResources
        bankedSalvage={0}
        carriedSalvage={0}
        tetherKits={1}
        deployReady
      />,
    );

    expect(markup).toContain("tether-resources--deploy-ready");
  });
});
