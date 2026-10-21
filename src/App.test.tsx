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

function renderMainMenu(alwaysShowJoystick: boolean) {
  return renderToStaticMarkup(
    <MainMenu
      alwaysShowJoystick={alwaysShowJoystick}
      audioEnabled={false}
      largeControls={false}
      tutorialEnabled={false}
      onAlwaysShowJoystickChange={() => undefined}
      onAudioEnabledChange={() => undefined}
      onLargeControlsChange={() => undefined}
      onTutorialEnabledChange={() => undefined}
      onBotGame={() => undefined}
      onCreateRoom={() => undefined}
      onJoinRoom={() => undefined}
      gameAddress="https://example.test/tetherbound/"
      roomServerAddress="https://example.test/tetherbound/api/rooms"
      localAddressOnly={false}
    />,
  );
}
