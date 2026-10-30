import { useEffect, useRef, useState } from "react";
import {
  ASTRONAUT_SPRITES,
  type AstronautSpriteFrame,
} from "../presentation/astronautSprites";

export type AboutStoryChapterId =
  | "frontier"
  | "movement"
  | "tethers"
  | "materials"
  | "conversion"
  | "territory"
  | "disruption"
  | "boost"
  | "victory";

interface AboutStoryChapter {
  id: AboutStoryChapterId;
  eyebrow: string;
  title: string;
  description: string;
  tip: string;
  shortLabel: string;
}

export const ABOUT_STORY_CHAPTERS: readonly AboutStoryChapter[] = [
  {
    id: "frontier",
    eyebrow: "Your mission",
    title: "Claim the unknown",
    description:
      "You are one of the first astronauts sent to colonize an exoplanet—but rival pioneers have arrived with the same dream. With only a few tethers in hand, explore the surface, gather what you need, and build a network that tells the whole world this frontier is yours.",
    tip: "Every rival is chasing the same path to glory.",
    shortLabel: "Mission",
  },
  {
    id: "movement",
    eyebrow: "How to play · 1",
    title: "Move across the frontier",
    description:
      "Steer your astronaut across the planet's surface. Keep moving to find open land, materials, and weak points in rival networks.",
    tip: "Touch and drag to steer, or use W/S to move and A/D to turn.",
    shortLabel: "Move",
  },
  {
    id: "tethers",
    eyebrow: "How to play · 2",
    title: "Place tethers to claim land",
    description:
      "Deploy a tether as you travel. Connected anchors extend your safe zone and claim territory. When two powered nodes are in reach, the new tether bridges both and gives the chain a backup route.",
    tip: "Build the backup while both routes are powered—offline tethers cannot be linked.",
    shortLabel: "Tether",
  },
  {
    id: "materials",
    eyebrow: "How to play · 3",
    title: "Collect scattered material",
    description:
      "Search beyond your borders for glowing material. Drive over each piece to pick it up, then keep it safe until you can return home.",
    tip: "Three materials are enough to create one new tether.",
    shortLabel: "Collect",
  },
  {
    id: "conversion",
    eyebrow: "How to play · 4",
    title: "Return to an anchor to convert",
    description:
      "Bring three materials back to one of your powered anchors. The anchor automatically converts them into another tether, ready for your next expansion.",
    tip: "Watch your tether count rise as the materials convert.",
    shortLabel: "Convert",
  },
  {
    id: "territory",
    eyebrow: "How to play · 5",
    title: "More territory means more points",
    description:
      "Stretch connected tethers around open ground to form a larger territory. The more of the planet your network controls, the faster your score grows.",
    tip: "Build wide—but keep every edge connected and powered.",
    shortLabel: "Score",
  },
  {
    id: "disruption",
    eyebrow: "How to play · 6",
    title: "Break rival territory",
    description:
      "Reach an exposed enemy tether and hold your ground to overload it. A well-timed disruption temporarily cuts power through its downstream branch and opens rival territory for capture.",
    tip: "Attack vulnerable edges while defending the heart of your network.",
    shortLabel: "Disrupt",
  },
  {
    id: "boost",
    eyebrow: "How to play · 7",
    title: "Charge a boost for fast travel",
    description:
      "Charge your suit, aim, and release to burst across the surface. Boosts help you reach distant material, escape danger, or race toward a weak enemy tether.",
    tip: "A charged boost covers ground quickly, so choose your direction first.",
    shortLabel: "Boost",
  },
  {
    id: "victory",
    eyebrow: "How to play · 8",
    title: "Highest score wins",
    description:
      "Keep expanding and disrupting until the timer reaches zero. When regulation ends, the astronaut with the most signal points claims the exoplanet—and the glory.",
    tip: "Build, defend, and watch the clock. A very close finish can trigger overtime.",
    shortLabel: "Victory",
  },
] as const;

interface AboutStoryProps {
  onClose: () => void;
  initialChapterId?: AboutStoryChapterId;
}

export function AboutStory({
  onClose,
  initialChapterId = "frontier",
}: AboutStoryProps) {
  const initialIndex = Math.max(
    0,
    ABOUT_STORY_CHAPTERS.findIndex((chapter) => chapter.id === initialChapterId),
  );
  const [chapterIndex, setChapterIndex] = useState(initialIndex);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const chapter = ABOUT_STORY_CHAPTERS[chapterIndex];
  const isFirstChapter = chapterIndex === 0;
  const isFinalChapter = chapterIndex === ABOUT_STORY_CHAPTERS.length - 1;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [onClose]);

  function showPreviousChapter() {
    setChapterIndex((current) => Math.max(0, current - 1));
  }

  function showNextChapter() {
    if (isFinalChapter) {
      onClose();
      return;
    }
    setChapterIndex((current) => Math.min(ABOUT_STORY_CHAPTERS.length - 1, current + 1));
  }

  return (
    <div
      id="about-story-dialog"
      className="about-story"
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-story-title"
      aria-describedby="about-story-description"
      data-chapter={chapter.id}
      ref={dialogRef}
    >
      <div className="about-story__shell">
        <header className="about-story__header">
          <div className="about-story__brand" aria-label="Tetherbound story">
            <span aria-hidden="true" />
            Tetherbound
          </div>
          <span className="about-story__chapter-count" aria-live="polite">
            {chapterIndex + 1} / {ABOUT_STORY_CHAPTERS.length}
          </span>
          <button
            className="about-story__close"
            type="button"
            onClick={onClose}
            ref={closeButtonRef}
            aria-label="Close About story"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="about-story__chapter" key={chapter.id}>
          <div className="about-story__visual">
            <TutorialScene chapterId={chapter.id} />
          </div>

          <section
            className="about-story__copy"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="about-story__eyebrow">{chapter.eyebrow}</span>
            <h2 id="about-story-title">{chapter.title}</h2>
            <p id="about-story-description">{chapter.description}</p>
            <aside className="about-story__tip">
              <span aria-hidden="true">✦</span>
              <p>{chapter.tip}</p>
            </aside>
          </section>
        </div>

        <footer className="about-story__footer">
          <button
            className="about-story__nav about-story__nav--previous"
            type="button"
            onClick={showPreviousChapter}
            disabled={isFirstChapter}
          >
            <span aria-hidden="true">←</span>
            Previous
          </button>

          <ol className="about-story__progress" aria-label="Story chapters">
            {ABOUT_STORY_CHAPTERS.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={index === chapterIndex ? "is-current" : ""}
                  aria-label={`${index + 1}. ${item.shortLabel}`}
                  aria-current={index === chapterIndex ? "step" : undefined}
                  onClick={() => setChapterIndex(index)}
                >
                  <span aria-hidden="true" />
                  <small>{item.shortLabel}</small>
                </button>
              </li>
            ))}
          </ol>

          <button
            className="about-story__nav about-story__nav--next"
            type="button"
            onClick={showNextChapter}
          >
            {isFinalChapter ? "Return to mission" : "Next"}
            <span aria-hidden="true">{isFinalChapter ? "✓" : "→"}</span>
          </button>
        </footer>
      </div>
    </div>
  );
}

function TutorialScene({ chapterId }: { chapterId: AboutStoryChapterId }) {
  return (
    <figure
      className={`about-story-scene about-story-scene--${chapterId}`}
      data-mechanic={chapterId}
      aria-label={sceneLabel(chapterId)}
    >
      <svg viewBox="0 0 720 440" aria-hidden="true">
        <defs>
          <linearGradient id="about-story-planet" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.34" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.06" />
          </linearGradient>
          <radialGradient id="about-story-glow">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.7" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
          <filter id="about-story-soft-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="8" />
          </filter>
        </defs>

        <g className="about-story-scene__stars">
          <circle cx="76" cy="55" r="2" />
          <circle cx="169" cy="91" r="1.5" />
          <circle cx="282" cy="42" r="2" />
          <circle cx="505" cy="72" r="1.5" />
          <circle cx="638" cy="47" r="2" />
          <circle cx="675" cy="136" r="1.5" />
        </g>
        <ellipse className="about-story-scene__ground" cx="360" cy="344" rx="322" ry="93" />

        {chapterId === "frontier" && <FrontierScene />}
        {chapterId === "movement" && <MovementScene />}
        {chapterId === "tethers" && <TetherScene />}
        {chapterId === "materials" && <MaterialScene />}
        {chapterId === "conversion" && <ConversionScene />}
        {chapterId === "territory" && <TerritoryScene />}
        {chapterId === "disruption" && <DisruptionScene />}
        {chapterId === "boost" && <BoostScene />}
        {chapterId === "victory" && <VictoryScene />}
      </svg>
    </figure>
  );
}

function sceneLabel(chapterId: AboutStoryChapterId) {
  const labels: Record<AboutStoryChapterId, string> = {
    frontier: "Two rival astronauts arrive on an unclaimed exoplanet.",
    movement: "An astronaut follows a curved path across the planet surface.",
    tethers: "An astronaut deploys connected tether anchors to claim land.",
    materials: "An astronaut collects three glowing pieces of material.",
    conversion: "Three materials convert into a new tether at a powered anchor.",
    territory: "A larger connected territory adds more points to the score.",
    disruption: "An astronaut breaks an enemy tether and disconnects part of its network.",
    boost: "A charged astronaut boosts quickly across the planet.",
    victory: "The timer reaches zero and the astronaut with the highest score wins.",
  };

  return labels[chapterId];
}

function FrontierScene() {
  return (
    <g className="about-story-scene__frontier">
      <circle className="about-story-scene__planet-glow" cx="360" cy="244" r="178" />
      <circle className="about-story-scene__planet" cx="360" cy="244" r="142" fill="url(#about-story-planet)" />
      <path className="about-story-scene__continent" d="M271 189c29-51 79-68 124-42 17 10 23 31 46 40 34 13 41 46 21 72-21 28-62 23-82 49-25 32-83 18-95-21-9-29-36-55-14-98Z" />
      <g className="about-story-scene__orbit">
        <ellipse cx="360" cy="244" rx="213" ry="65" />
        <circle cx="566" cy="227" r="7" />
      </g>
      <g className="about-story-scene__astronaut about-story-scene__astronaut--cyan" transform="translate(226 252)">
        <Astronaut tone="cyan" />
      </g>
      <g className="about-story-scene__astronaut about-story-scene__astronaut--red" transform="translate(470 270) scale(-1 1)">
        <Astronaut tone="red" />
      </g>
      <path className="about-story-scene__challenge" d="M306 285c36-26 71-24 106 2" />
    </g>
  );
}

function MovementScene() {
  return (
    <g className="about-story-scene__movement">
      <path className="about-story-scene__route" d="M120 324c92 18 126-87 220-57 89 29 114-91 239-65" />
      <g className="about-story-scene__route-dots">
        <circle cx="127" cy="324" r="6" />
        <circle cx="287" cy="275" r="6" />
        <circle cx="434" cy="249" r="6" />
        <circle cx="581" cy="202" r="6" />
      </g>
      <g className="about-story-scene__astronaut about-story-scene__astronaut--cyan about-story-scene__astronaut--moving" transform="translate(276 218)">
        <Astronaut tone="cyan" frame="walk-right" />
      </g>
      <g className="about-story-scene__direction" transform="translate(538 157)">
        <path d="M0 22h60" />
        <path d="m46 8 14 14-14 14" />
      </g>
      <SceneBadge x={92} y={91} width={214} title="Explore the surface" detail="Find space · find opportunity" />
    </g>
  );
}

function TetherScene() {
  return (
    <g className="about-story-scene__tethers">
      <path className="about-story-scene__territory about-story-scene__territory--cyan" d="M143 327 244 188 398 284 549 181 598 342Z" />
      <g className="about-story-scene__network about-story-scene__network--cyan">
        <path d="M143 327 244 188 398 284 549 181 598 342" />
      </g>
      <Anchor x={143} y={327} />
      <Anchor x={244} y={188} />
      <Anchor x={398} y={284} />
      <g className="about-story-scene__anchor about-story-scene__anchor--deploying" transform="translate(549 181)">
        <AnchorCore />
      </g>
      <Anchor x={598} y={342} />
      <g className="about-story-scene__astronaut about-story-scene__astronaut--cyan" transform="translate(492 151)">
        <Astronaut tone="cyan" />
      </g>
      <SceneBadge x={87} y={76} width={190} title="Network online" detail="Territory connected" />
    </g>
  );
}

function MaterialScene() {
  return (
    <g className="about-story-scene__materials">
      <path className="about-story-scene__route" d="M162 326c86-50 144-47 220-3 87 50 140-12 193-97" />
      <g className="about-story-scene__material about-story-scene__material--one" transform="translate(250 256)">
        <MaterialCrystal />
      </g>
      <g className="about-story-scene__material about-story-scene__material--two" transform="translate(405 302)">
        <MaterialCrystal />
      </g>
      <g className="about-story-scene__material about-story-scene__material--three" transform="translate(560 218)">
        <MaterialCrystal />
      </g>
      <g className="about-story-scene__astronaut about-story-scene__astronaut--cyan about-story-scene__astronaut--collecting" transform="translate(132 272)">
        <Astronaut tone="cyan" frame="walk-right" />
      </g>
      <SceneBadge x={87} y={77} width={214} title="Material collected" detail="0  →  1  →  2  →  3" />
    </g>
  );
}

function ConversionScene() {
  return (
    <g className="about-story-scene__conversion">
      <g className="about-story-scene__network about-story-scene__network--cyan">
        <path d="M120 332 269 242 420 327" />
      </g>
      <Anchor x={120} y={332} />
      <g className="about-story-scene__anchor about-story-scene__anchor--conversion" transform="translate(269 242)">
        <AnchorCore />
      </g>
      <Anchor x={420} y={327} />
      <g className="about-story-scene__astronaut about-story-scene__astronaut--cyan" transform="translate(201 222)">
        <Astronaut tone="cyan" />
      </g>
      <g className="about-story-scene__conversion-materials">
        <g transform="translate(386 176)"><MaterialCrystal /></g>
        <g transform="translate(434 199)"><MaterialCrystal /></g>
        <g transform="translate(396 231)"><MaterialCrystal /></g>
      </g>
      <path className="about-story-scene__conversion-arrow" d="M462 222h56" />
      <g className="about-story-scene__spool" transform="translate(554 222)">
        <circle r="26" />
        <circle r="9" />
        <path d="M-27-17h-12v34h12M27-17h12v34H27" />
      </g>
      <SceneBadge x={425} y={83} width={205} title="Tethers" detail="1  →  2" />
    </g>
  );
}

function TerritoryScene() {
  return (
    <g className="about-story-scene__territory-scene">
      <path className="about-story-scene__territory about-story-scene__territory--red" d="M110 326 181 236 257 321Z" />
      <path className="about-story-scene__territory about-story-scene__territory--cyan about-story-scene__territory--growing" d="M283 327 377 177 521 223 622 329Z" />
      <g className="about-story-scene__network about-story-scene__network--red">
        <path d="M110 326 181 236 257 321" />
      </g>
      <g className="about-story-scene__network about-story-scene__network--cyan">
        <path d="M283 327 377 177 521 223 622 329" />
      </g>
      <g className="about-story-scene__score-comparison">
        <SceneBadge x={68} y={85} width={198} title="18% territory" detail="+0.18 points / sec" tone="red" />
        <SceneBadge x={454} y={76} width={198} title="31% territory" detail="+0.31 points / sec" />
      </g>
    </g>
  );
}

function DisruptionScene() {
  return (
    <g className="about-story-scene__disruption">
      <path className="about-story-scene__territory about-story-scene__territory--red about-story-scene__territory--failing" d="M219 328 302 197 431 242 567 328Z" />
      <g className="about-story-scene__network about-story-scene__network--red about-story-scene__network--failing">
        <path d="M219 328 302 197 431 242" />
        <path className="about-story-scene__broken-line" d="M431 242 567 328" />
      </g>
      <Anchor x={219} y={328} tone="red" />
      <Anchor x={302} y={197} tone="red" />
      <Anchor x={431} y={242} tone="red" />
      <g className="about-story-scene__anchor about-story-scene__anchor--broken about-story-scene__anchor--red" transform="translate(567 328)">
        <AnchorCore />
      </g>
      <g className="about-story-scene__astronaut about-story-scene__astronaut--cyan about-story-scene__astronaut--attacking" transform="translate(528 251)">
        <Astronaut tone="cyan" frame="walk-right" />
      </g>
      <g className="about-story-scene__astronaut about-story-scene__astronaut--red about-story-scene__astronaut--defending" transform="translate(397 153) scale(-1 1)">
        <Astronaut tone="red" frame="walk-left" />
      </g>
      <g className="about-story-scene__impact" transform="translate(567 328)">
        <path d="M0-46v-28M33-33l20-20M46 0h28M33 33l20 20" />
      </g>
      <SceneBadge x={77} y={80} width={230} title="Network disrupted" detail="Rival branch loses power" tone="red" />
    </g>
  );
}

function BoostScene() {
  return (
    <g className="about-story-scene__boost">
      <g className="about-story-scene__boost-trail">
        <path d="M104 299c106 9 163-7 257-53" />
        <path d="M137 323c105 6 173-9 253-54" />
        <path d="M88 271c101 13 174-2 263-44" />
      </g>
      <g className="about-story-scene__charge-rings" transform="translate(390 228)">
        <circle r="56" />
        <circle r="78" />
        <circle r="99" />
      </g>
      <g className="about-story-scene__astronaut about-story-scene__astronaut--cyan about-story-scene__astronaut--boosting" transform="translate(358 184) rotate(8)">
        <Astronaut tone="cyan" frame="walk-right" />
      </g>
      <g className="about-story-scene__direction" transform="translate(489 215)">
        <path d="M0 22h89" />
        <path d="m75 8 14 14-14 14" />
      </g>
      <SceneBadge x={85} y={79} width={220} title="Boost charged" detail="Aim  ·  release  ·  travel" />
    </g>
  );
}

function VictoryScene() {
  return (
    <g className="about-story-scene__victory">
      <g className="about-story-scene__timer" transform="translate(360 91)">
        <circle r="46" />
        <path d="M0-29V0l22 12" />
        <text x="0" y="72" textAnchor="middle">00:00</text>
      </g>
      <g className="about-story-scene__podium" transform="translate(360 324)">
        <path d="M-155 30v-70h94V30M-48 30v-132h96V30M61 30v-94h94V30" />
        <text x="-108" y="-53" textAnchor="middle">2</text>
        <text x="0" y="-115" textAnchor="middle">1</text>
        <text x="108" y="-77" textAnchor="middle">3</text>
      </g>
      <g className="about-story-scene__astronaut about-story-scene__astronaut--cyan about-story-scene__astronaut--winner" transform="translate(328 166)">
        <Astronaut tone="cyan" />
      </g>
      <g className="about-story-scene__crown" transform="translate(360 153)">
        <path d="m-32 13-8-38 24 18L0-36 16-7l24-18-8 38Z" />
      </g>
      <SceneBadge x={70} y={91} width={192} title="1st · 840" detail="Highest territory score" />
      <SceneBadge x={473} y={91} width={176} title="2nd · 710" detail="Time is up" tone="red" />
    </g>
  );
}

function Astronaut({
  tone,
  frame = "idle",
}: {
  tone: "cyan" | "red";
  frame?: AstronautSpriteFrame;
}) {
  const playerId = tone === "cyan" ? "player" : "rival";
  const sprite = ASTRONAUT_SPRITES[playerId][frame];

  return (
    <g>
      <ellipse className="about-story-scene__astronaut-shadow" cx="42" cy="97" rx="31" ry="8" />
      <image
        className="about-story-scene__astronaut-sprite"
        href={sprite}
        x="-16"
        y="-10"
        width="116"
        height="116"
        preserveAspectRatio="xMidYMid meet"
        data-player={playerId}
        data-frame={frame}
      />
    </g>
  );
}

function Anchor({ x, y, tone = "cyan" }: { x: number; y: number; tone?: "cyan" | "red" }) {
  return (
    <g className={`about-story-scene__anchor about-story-scene__anchor--${tone}`} transform={`translate(${x} ${y})`}>
      <AnchorCore />
    </g>
  );
}

function AnchorCore() {
  return (
    <g>
      <circle className="about-story-scene__anchor-glow" r="43" fill="url(#about-story-glow)" />
      <circle className="about-story-scene__anchor-ring" r="21" />
      <circle className="about-story-scene__anchor-core" r="9" />
      <path className="about-story-scene__anchor-pin" d="M0 21v23" />
    </g>
  );
}

function MaterialCrystal() {
  return (
    <g>
      <circle className="about-story-scene__material-glow" r="33" fill="url(#about-story-glow)" />
      <path className="about-story-scene__material-crystal" d="M0-22 17-7 12 17 0 27-14 15-17-8Z" />
      <path className="about-story-scene__material-facet" d="M0-22 3 3 17-7M3 3l9 14M3 3-14 15" />
    </g>
  );
}

function SceneBadge({
  x,
  y,
  width,
  title,
  detail,
  tone = "cyan",
}: {
  x: number;
  y: number;
  width: number;
  title: string;
  detail: string;
  tone?: "cyan" | "red";
}) {
  return (
    <g className={`about-story-scene__badge about-story-scene__badge--${tone}`} transform={`translate(${x} ${y})`}>
      <rect width={width} height="64" rx="16" />
      <circle cx="24" cy="23" r="5" />
      <text className="about-story-scene__badge-title" x="38" y="29">{title}</text>
      <text className="about-story-scene__badge-detail" x="18" y="49">{detail}</text>
    </g>
  );
}
