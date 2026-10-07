import { useEffect, useRef, useState } from "react";
import { GameView } from "./game/components/GameView";
import { NetworkGameView } from "./game/components/NetworkGameView";
import type { GameMode } from "./game/types";
import { RoomClient } from "./network/RoomClient";
import {
  CreateRoomView,
  JoinRoomView,
  MatchResultView,
  RoomLobby,
} from "./network/components/MultiplayerViews";
import { useRoomClient } from "./network/useRoomClient";

type View = "menu" | "create-room" | "join-room" | "lobby" | "game" | "result";

const LARGE_CONTROLS_KEY = "tetherbound.largeControls";

export function App() {
  const [initialRoomCode] = useState(
    () => new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "",
  );
  const [view, setView] = useState<View>(initialRoomCode ? "join-room" : "menu");
  const [gameMode, setGameMode] = useState<GameMode>("bot");
  const [roomClient] = useState(() => new RoomClient());
  const roomSession = useRoomClient(roomClient);
  const resumeAttempted = useRef(false);
  const [largeControls, setLargeControls] = useState(
    () => localStorage.getItem(LARGE_CONTROLS_KEY) === "true",
  );

  useEffect(() => {
    localStorage.setItem(LARGE_CONTROLS_KEY, String(largeControls));
  }, [largeControls]);

  useEffect(() => {
    if (resumeAttempted.current || !initialRoomCode) return;
    resumeAttempted.current = true;
    if (roomClient.resumeRoom(initialRoomCode)) setView("lobby");
  }, [initialRoomCode, roomClient]);

  useEffect(() => {
    if (!roomSession.room) return;
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomSession.room.code);
    window.history.replaceState(null, "", url);
    if (roomSession.room.phase === "playing") {
      setGameMode("multiplayer");
      setView("game");
    } else if (roomSession.room.phase === "finished") {
      setGameMode("multiplayer");
      setView("result");
    } else {
      setView("lobby");
    }
  }, [roomSession.room]);

  function startBotGame() {
    roomClient.leave();
    clearRoomFromUrl();
    setGameMode("bot");
    setView("game");
  }

  function leaveMultiplayer() {
    roomClient.leave();
    clearRoomFromUrl();
    setGameMode("bot");
    setView("menu");
  }

  function clearRoomFromUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState(null, "", url);
  }

  async function copyInvitationLink() {
    if (!roomSession.room) return;
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomSession.room.code);
    const text = url.toString();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const field = document.createElement("textarea");
      field.value = text;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
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
            onCreateRoom={() => setView("create-room")}
          />
        )}
        {view === "create-room" && (
          <CreateRoomView connection={roomSession.connection} error={roomSession.error}
            onBack={() => setView("menu")}
            onCreate={(name) => { roomClient.createRoom(name, 2); setView("lobby"); }} />
        )}
        {view === "join-room" && (
          <JoinRoomView code={initialRoomCode} connection={roomSession.connection} error={roomSession.error}
            onBack={leaveMultiplayer}
            onJoin={(name) => { roomClient.joinRoom(initialRoomCode, name); setView("lobby"); }} />
        )}
        {view === "lobby" && roomSession.room && roomSession.playerId && (
          <RoomLobby room={roomSession.room} localPlayerId={roomSession.playerId}
            connection={roomSession.connection} latencyMs={roomSession.latencyMs}
            onCopyLink={copyInvitationLink} onReadyChange={(ready) => roomClient.setReady(ready)}
            onLeave={leaveMultiplayer} />
        )}
        {view === "lobby" && !roomSession.room && (
          <div className="screen screen--room connection-gate">
            <p className="eyebrow">Room server</p><h2>Establishing connection…</h2>
            <p>{roomSession.error ?? "Reserving your place in the mission."}</p>
            <button className="text-button" onClick={leaveMultiplayer}>Cancel</button>
          </div>
        )}
        {view === "game" && gameMode === "bot" && (
          <GameView onLeave={() => setView("menu")} />
        )}
        {view === "game" && gameMode === "multiplayer" && roomSession.room && roomSession.gameState && roomSession.playerId && (
          <NetworkGameView state={roomSession.gameState} room={roomSession.room}
            localPlayerId={roomSession.playerId} connection={roomSession.connection}
            latencyMs={roomSession.latencyMs} onMoveTargetChange={(target) => roomClient.setMoveTarget(target)}
            onDeploy={() => roomClient.deployAnchor()} onLeave={leaveMultiplayer} />
        )}
        {view === "result" && roomSession.room && roomSession.gameState && roomSession.playerId && (
          <MatchResultView state={roomSession.gameState} room={roomSession.room}
            localPlayerId={roomSession.playerId} connection={roomSession.connection}
            onRequestRematch={() => roomClient.requestRematch()} onLeave={leaveMultiplayer} />
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
