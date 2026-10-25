import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MainMenu } from "./App";

describe("MainMenu joystick preference", () => {
  it("offers the always-visible mobile joystick setting", () => {
    const markup = renderMainMenu(true);

    expect(markup).toContain("Always show joystick");
    expect(markup).toContain("Keep the mobile movement control visible on screen");
    expect(markup).toMatch(
      /<strong>Always show joystick<\/strong>[\s\S]*?<input type="checkbox" checked=""\/\>/,
    );
  });

  it("renders the setting off by default when requested", () => {
    const markup = renderMainMenu(false);
    const joystickSetting = markup.match(
      /<strong>Always show joystick<\/strong>[\s\S]*?<\/label>/,
    )?.[0];

    expect(joystickSetting).toBeDefined();
    expect(joystickSetting).not.toContain("checked");
  });
});

describe("MainMenu play choices", () => {
  it("offers two-, three-, and four-player bot matches", () => {
    const markup = renderMainMenu(false);

    expect(markup).toContain("2-Player Bot Match");
    expect(markup).toContain("You + 1 bot");
    expect(markup).toContain("3-Player Bot Match");
    expect(markup).toContain("You + 2 bots");
    expect(markup).toContain("4-Player Bot Match");
    expect(markup).toContain("You + 3 bots");
  });
});

describe("MainMenu guided setup recommendation", () => {
  it("shows a dismissible recommendation before it is dismissed", () => {
    const markup = renderMainMenu(false, false, true);

    expect(markup).toContain("Recommended · first match");
    expect(markup).toContain('aria-label="Dismiss guided setup recommendation"');
  });

  it("moves the guide toggle into game settings after dismissal", () => {
    const markup = renderMainMenu(false, true, true);
    const settings = markup.match(
      /<div class="menu-settings"[\s\S]*?<\/div>/,
    )?.[0];

    expect(settings).toContain("Guided setup");
    expect(settings).toContain("Show the first-match movement and objective guide");
    expect(settings).toMatch(
      /<strong>Guided setup<\/strong>[\s\S]*?<input type="checkbox" checked=""\/\>/,
    );
    expect(markup).not.toContain("Recommended · first match");
    expect(markup).not.toContain("Dismiss guided setup recommendation");
  });
});

function renderMainMenu(
  alwaysShowJoystick: boolean,
  tutorialRecommendationDismissed = false,
  tutorialEnabled = false,
) {
  return renderToStaticMarkup(
    <MainMenu
      alwaysShowJoystick={alwaysShowJoystick}
      audioEnabled={false}
      largeControls={false}
      tutorialEnabled={tutorialEnabled}
      tutorialRecommendationDismissed={tutorialRecommendationDismissed}
      onAlwaysShowJoystickChange={() => undefined}
      onAudioEnabledChange={() => undefined}
      onLargeControlsChange={() => undefined}
      onTutorialEnabledChange={() => undefined}
      onTutorialRecommendationDismiss={() => undefined}
      onBotGame={() => undefined}
      onCreateRoom={() => undefined}
      onJoinRoom={() => undefined}
      gameAddress="https://example.test/tetherbound/"
      roomServerAddress="https://example.test/tetherbound/api/rooms"
      localAddressOnly={false}
    />,
  );
}
