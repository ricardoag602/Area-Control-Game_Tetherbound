import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ABOUT_STORY_CHAPTERS,
  AboutStory,
  type AboutStoryChapterId,
} from "./AboutStory";

describe("AboutStory", () => {
  it("organizes the story and every requested mechanic into nine chapters", () => {
    expect(ABOUT_STORY_CHAPTERS).toHaveLength(9);
    expect(ABOUT_STORY_CHAPTERS.map((chapter) => chapter.id)).toEqual([
      "frontier",
      "movement",
      "tethers",
      "materials",
      "conversion",
      "territory",
      "disruption",
      "boost",
      "victory",
    ]);

    const completeCopy = ABOUT_STORY_CHAPTERS
      .flatMap((chapter) => [chapter.title, chapter.description, chapter.tip])
      .join(" ");

    expect(completeCopy).toContain("colonize an exoplanet");
    expect(completeCopy).toContain("Touch and drag to steer");
    expect(completeCopy).toContain("Deploy a tether");
    expect(completeCopy).toContain("Three materials");
    expect(completeCopy).toContain("powered anchors");
    expect(completeCopy).toContain("score grows");
    expect(completeCopy).toContain("disruption");
    expect(completeCopy).toContain("Charge your suit");
    expect(completeCopy).toContain("timer reaches zero");
  });

  it("renders as an accessible, dismissible story dialog", () => {
    const markup = renderStory("frontier");

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="about-story-title"');
    expect(markup).toContain('aria-describedby="about-story-description"');
    expect(markup).toContain('aria-label="Close About story"');
    expect(markup).toContain("Claim the unknown");
    expect(markup).toContain("1 / 9");
    expect(markup).toContain('aria-label="Story chapters"');
    expect(markup).toContain('aria-current="step"');
    expect(markup.match(/<li><button/g)).toHaveLength(9);
    expect(markup).toMatch(/Previous<\/button>/);
    expect(markup).toContain("disabled");
    expect(markup).toContain("Next");
  });

  it.each(ABOUT_STORY_CHAPTERS)(
    "renders a lightweight illustrated $id scene",
    (chapter) => {
      const markup = renderStory(chapter.id);

      expect(markup).toContain(`data-chapter="${chapter.id}"`);
      expect(markup).toContain(`data-mechanic="${chapter.id}"`);
      expect(markup).toContain(`about-story-scene--${chapter.id}`);
      expect(markup).toContain(chapter.title);
      expect(markup).toContain(chapter.description.replaceAll("'", "&#x27;"));
      expect(markup).toContain(chapter.tip);
      expect(markup).toContain("<svg");
    },
  );

  it("shows the tether count changing during material conversion", () => {
    const markup = renderStory("conversion");

    expect(markup).toContain("Tethers");
    expect(markup).toContain("1  →  2");
    expect(markup).toContain("about-story-scene__conversion-materials");
    expect(markup).toContain("about-story-scene__spool");
  });

  it("reuses the game's blue and red astronaut art for the animated examples", () => {
    const movement = renderStory("movement");
    const battle = renderStory("disruption");

    expect(movement).toContain("player-1-blue-walk-right.webp");
    expect(movement).toContain('data-player="player"');
    expect(battle).toContain("player-1-blue-walk-right.webp");
    expect(battle).toContain("player-2-red-walk-left.webp");
    expect(battle).toContain('data-player="rival"');
    expect(battle).toContain("about-story-scene__astronaut--attacking");
    expect(battle).toContain("about-story-scene__astronaut--defending");
  });

  it("ends with the timer, scores, and a return action", () => {
    const markup = renderStory("victory");

    expect(markup).toContain("00:00");
    expect(markup).toContain("1st · 840");
    expect(markup).toContain("2nd · 710");
    expect(markup).toContain("Return to mission");
    expect(markup).toContain("Highest score wins");
  });
});

function renderStory(initialChapterId: AboutStoryChapterId) {
  return renderToStaticMarkup(
    <AboutStory initialChapterId={initialChapterId} onClose={() => undefined} />,
  );
}
