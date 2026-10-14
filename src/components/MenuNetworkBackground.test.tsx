import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MenuNetworkBackground } from "./MenuNetworkBackground";

describe("MenuNetworkBackground", () => {
    it("renders a decorative, non-interactive network with all gameplay tones", () => {
        const markup = renderToStaticMarkup(<MenuNetworkBackground />);

        expect(markup).toContain('class="menu-network-background"');
        expect(markup).toContain('aria-hidden="true"');
        expect(markup).toContain('focusable="false"');
        expect(markup).toContain("menu-network-background__tone--cyan");
        expect(markup).toContain("menu-network-background__tone--amber");
        expect(markup).toContain("menu-network-background__tone--coral");
        expect(markup).toContain("menu-network-background__link-energy");
        expect(markup).toContain("menu-network-background__link-signal");
        expect(markup).toContain("menu-network-background__node--anchor");
    });
});
