import { useEffect, useMemo, useState } from "react";
import { GameView } from "./game/components/GameView";
import type { GameMode } from "./game/types";

type View = "menu" | "room" | "game";

const LARGE_CONTROLS_KEY = "tetherbound.largeControls";

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  // Use browser-provided random bytes, then map each byte to a readable character.
  const values = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}

export function App() {
  const [view, setView] = useState<View>("menu");
  const [gameMode, setGameMode] = useState<GameMode>("bot");
  const [largeControls, setLargeControls] = useState(
    () => localStorage.getItem(LARGE_CONTROLS_KEY) === "true",
  );

  useEffect(() => {
    localStorage.setItem(LARGE_CONTROLS_KEY, String(largeControls));
  }, [largeControls]);

  function startBotGame() {
    setGameMode("bot");
    setView("game");
  }

  function startMultiplayerGame() {
    setGameMode("multiplayer");
    setView("game");
  }

  return (
    <main className={largeControls ? "app app--large-controls" : "app"}>
      <div className="space-noise" aria-hidden="true" />
      <section className="view-stage" aria-live="polite">
        {view === "menu" && (
          <MainMenu
            largeControls={largeControls}
            onLargeControlsChange={setLargeControls}
            onBotGame={startBotGame}
            onCreateRoom={() => setView("room")}
          />
        )}
        {view === "room" && (
          <RoomSetup onBack={() => setView("menu")} onStart={startMultiplayerGame} />
        )}
        {view === "game" && (
          <GameView mode={gameMode} onLeave={() => setView("menu")} />
        )}
      </section>
    </main>
  );
}

interface MainMenuProps {
  largeControls: boolean;
  onLargeControlsChange: (enabled: boolean) => void;
  onBotGame: () => void;
  onCreateRoom: () => void;
}

function MainMenu({
  largeControls,
  onLargeControlsChange,
  onBotGame,
  onCreateRoom,
}: MainMenuProps) {
  return (
    <div className="screen screen--menu">
      <div className="orbit-mark" aria-hidden="true">
        <span className="orbit-mark__core" />
        <span className="orbit-mark__ring orbit-mark__ring--one" />
        <span className="orbit-mark__ring orbit-mark__ring--two" />
      </div>

      <header className="hero">
        <p className="eyebrow">Signal acquired</p>
        <h1>Tetherbound</h1>
        <p className="tagline">How far from safety will you go for power?</p>
      </header>

      <div className="menu-actions">
        <button className="button button--primary" onClick={onBotGame}>
          <span>Start Bot Game</span>
          <small>Test the frontier alone</small>
        </button>
        <button className="button button--secondary" onClick={onCreateRoom}>
          <span>Create Multiplayer Room</span>
          <small>Invite another astronaut</small>
        </button>
      </div>

      <label className="setting-card">
        <span>
          <strong>Large controls</strong>
          <small>Increase buttons and interaction targets</small>
        </span>
        <input
          type="checkbox"
          checked={largeControls}
          onChange={(event) => onLargeControlsChange(event.target.checked)}
        />
        <span className="switch" aria-hidden="true" />
      </label>

      <footer className="credits">Created by <span>Your name</span></footer>
    </div>
  );
}

interface RoomSetupProps {
  onBack: () => void;
  onStart: () => void;
}

function RoomSetup({ onBack, onStart }: RoomSetupProps) {
  const [playerLimit, setPlayerLimit] = useState(2);
  const [copied, setCopied] = useState(false);
  // An empty dependency list keeps this room code stable for this screen's lifetime.
  const roomCode = useMemo(createRoomCode, []);
  const roomLink = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;

  async function copyRoomLink() {
    await navigator.clipboard.writeText(roomLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="screen screen--room">
      <button className="text-button back-button" onClick={onBack}>
        <span aria-hidden="true">←</span> Back
      </button>

      <header className="section-heading">
        <p className="eyebrow">Establish a link</p>
        <h2>Create room</h2>
        <p>Configure the mission, then share the signal with another player.</p>
      </header>

      <div className="room-card">
        <label className="field-label" htmlFor="player-limit">
          Player limit
        </label>
        <div className="stepper">
          <button
            onClick={() => setPlayerLimit((value) => Math.max(2, value - 1))}
            disabled={playerLimit === 2}
            aria-label="Decrease player limit"
          >
            −
          </button>
          <output id="player-limit" aria-live="polite">{playerLimit}</output>
          <button
            onClick={() => setPlayerLimit((value) => Math.min(8, value + 1))}
            disabled={playerLimit === 8}
            aria-label="Increase player limit"
          >
            +
          </button>
        </div>
        {playerLimit > 2 && (
          <p className="notice">The first playable is balanced for two players. Larger rooms are planned.</p>
        )}

        <div className="room-code-block">
          <span>Room code</span>
          <strong>{roomCode}</strong>
          <p>{roomLink}</p>
          <button className="button button--compact" onClick={copyRoomLink}>
            {copied ? "Link copied" : "Copy room link"}
          </button>
        </div>
      </div>

      <button className="button button--primary" onClick={onStart}>
        Enter Waiting Room
      </button>
    </div>
  );
}
