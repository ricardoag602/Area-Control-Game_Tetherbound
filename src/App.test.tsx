import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MainMenu, OfflineBotChoices } from "./App";
import type { VideoMode } from "./game/preferences/video";

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
  it("offers a dedicated About story from the main menu", () => {
    const markup = renderMainMenu(false);

    expect(markup).toMatch(
      /<button class="about-story-trigger"[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"[^>]*aria-controls="about-story-dialog"[^>]*>About<\/button>/,
    );
  });

  it("starts with one collapsed offline play button", () => {
    const markup = renderMainMenu(false);

    expect(markup).toContain("Play Offline");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls="offline-player-options"');
    expect(markup).not.toContain("2-player bot match");
  });

  it("presents simple text choices for every offline player count", () => {
    const markup = renderToStaticMarkup(
      <OfflineBotChoices onBotGame={() => undefined} />,
    );

    expect(markup).toContain('role="group"');
    expect(markup).toContain("2-player bot match");
    expect(markup).toContain("3-player bot match");
    expect(markup).toContain("4-player bot match");
    expect(markup).not.toContain("<small>");
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
    const gameplayStart = markup.indexOf('id="settings-panel-gameplay"');
    const audioStart = markup.indexOf('id="settings-panel-audio"');
    const settings = markup.slice(gameplayStart, audioStart);

    expect(gameplayStart).toBeGreaterThan(-1);
    expect(audioStart).toBeGreaterThan(gameplayStart);
    expect(settings).toContain("Guided setup");
    expect(settings).toContain("Show the first-match movement and objective guide");
    expect(settings).toMatch(
      /<strong>Guided setup<\/strong>[\s\S]*?<input type="checkbox" checked=""\/\>/,
    );
    expect(markup).not.toContain("Recommended · first match");
    expect(markup).not.toContain("Dismiss guided setup recommendation");
  });
});

describe("MainMenu settings tabs", () => {
  it("organizes gameplay, audio, and video controls into accessible tabs", () => {
    const markup = renderMainMenu(false);

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Settings sections"');
    expect(markup).toMatch(
      /id="settings-tab-gameplay"[^>]*role="tab"[^>]*aria-selected="true"/,
    );
    expect(markup).toMatch(
      /id="settings-tab-audio"[^>]*role="tab"[^>]*aria-selected="false"/,
    );
    expect(markup).toMatch(
      /id="settings-tab-video"[^>]*role="tab"[^>]*aria-selected="false"/,
    );
    expect(markup).toMatch(
      /id="settings-panel-audio"[^>]*role="tabpanel"[^>]*hidden=""/,
    );
    expect(markup).toMatch(
      /id="settings-panel-video"[^>]*role="tabpanel"[^>]*hidden=""/,
    );
  });

  it("offers persistent quality and performance video presets", () => {
    const markup = renderMainMenu(false, false, false, 1, 1, "performance");

    expect(markup).toContain("Sharper rendering, antialiasing, full lighting");
    expect(markup).toContain("Lower render resolution with lighter blur and particle effects");
    expect(markup).toMatch(
      /type="radio" name="video-mode" value="quality"/,
    );
    expect(markup).toMatch(
      /type="radio" name="video-mode" checked="" value="performance"/,
    );
    expect(markup).toContain("Selected");
  });
});

describe("MainMenu audio mix", () => {
  it("offers independent accessible music and SFX volume sliders", () => {
    const markup = renderMainMenu(false, false, false, 0.65, 0.4);

    expect(markup).toContain("Music volume");
    expect(markup).toContain("Ambient score and match music");
    expect(markup).toContain("SFX volume");
    expect(markup).toContain("Footsteps, movement, tethers, and world effects");
    expect(markup).toMatch(
      /id="music-volume" type="range" min="0" max="100" step="5"[^>]*value="65"/,
    );
    expect(markup).toContain('aria-valuetext="65%"');
    expect(markup).toMatch(
      /id="sfx-volume" type="range" min="0" max="100" step="5"[^>]*value="40"/,
    );
    expect(markup).toContain('aria-valuetext="40%"');
    expect(markup).toContain('for="music-volume">65%</output>');
    expect(markup).toContain('for="sfx-volume">40%</output>');
  });
});

function renderMainMenu(
  alwaysShowJoystick: boolean,
  tutorialRecommendationDismissed = false,
  tutorialEnabled = false,
  musicVolume = 1,
  sfxVolume = 1,
  videoMode: VideoMode = "quality",
) {
  return renderToStaticMarkup(
    <MainMenu
      alwaysShowJoystick={alwaysShowJoystick}
      audioEnabled={false}
      largeControls={false}
      musicVolume={musicVolume}
      sfxVolume={sfxVolume}
      tutorialEnabled={tutorialEnabled}
      tutorialRecommendationDismissed={tutorialRecommendationDismissed}
      videoMode={videoMode}
      onAlwaysShowJoystickChange={() => undefined}
      onAudioEnabledChange={() => undefined}
      onLargeControlsChange={() => undefined}
      onMusicVolumeChange={() => undefined}
      onSfxVolumeChange={() => undefined}
      onTutorialEnabledChange={() => undefined}
      onTutorialRecommendationDismiss={() => undefined}
      onVideoModeChange={() => undefined}
      onBotGame={() => undefined}
      onCreateRoom={() => undefined}
      onJoinRoom={() => undefined}
      gameAddress="https://example.test/tetherbound/"
      roomServerAddress="https://example.test/tetherbound/api/rooms"
      localAddressOnly={false}
    />,
  );
}
