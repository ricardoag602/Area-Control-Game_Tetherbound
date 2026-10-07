import { useState } from "react";
import { getTerritoryScore } from "../../game/simulation";
import type { GameState, PlayerId } from "../../game/types";
import type { ConnectionStatus } from "../RoomClient";
import type { RoomSnapshot } from "../protocol";

interface CreateRoomViewProps {
  connection: ConnectionStatus;
  error: string | null;
  onBack: () => void;
  onCreate: (name: string) => void;
}

export function CreateRoomView({ connection, error, onBack, onCreate }: CreateRoomViewProps) {
  const [name, setName] = useState("Explorer 1");
  const busy = connection === "connecting";

  return (
    <div className="screen screen--room">
      <button className="text-button back-button" onClick={onBack}>← Back</button>
      <header className="section-heading">
        <p className="eyebrow">Establish a link</p>
        <h2>Create room</h2>
        <p>The server will reserve a private two-player room and generate its invitation link.</p>
      </header>
      <div className="room-card">
        <label className="field-label" htmlFor="host-name">Astronaut name</label>
        <input id="host-name" className="text-input" value={name} maxLength={20}
          onChange={(event) => setName(event.target.value)} autoComplete="nickname" />
        <div className="room-rule-row"><span>Player limit</span><strong>2</strong></div>
        <p className="notice">Additional player counts remain disabled until two-player balance is stable.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <button className="button button--primary" disabled={busy || !name.trim()}
        onClick={() => onCreate(name)}>
        {busy ? "Contacting room server…" : "Create Multiplayer Room"}
      </button>
    </div>
  );
}

interface JoinRoomViewProps {
  code: string;
  connection: ConnectionStatus;
  error: string | null;
  onBack: () => void;
  onJoin: (name: string) => void;
}

export function JoinRoomView({ code, connection, error, onBack, onJoin }: JoinRoomViewProps) {
  const [name, setName] = useState("Explorer 2");
  const busy = connection === "connecting" || connection === "reconnecting";

  return (
    <div className="screen screen--room">
      <button className="text-button back-button" onClick={onBack}>← Back</button>
      <header className="section-heading">
        <p className="eyebrow">Incoming signal</p>
        <h2>Join room</h2>
        <p>Enter your astronaut name to join room <strong>{code}</strong>.</p>
      </header>
      <div className="room-card">
        <label className="field-label" htmlFor="guest-name">Astronaut name</label>
        <input id="guest-name" className="text-input" value={name} maxLength={20}
          onChange={(event) => setName(event.target.value)} autoComplete="nickname" />
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <button className="button button--primary" disabled={busy || !name.trim()}
        onClick={() => onJoin(name)}>
        {busy ? "Connecting…" : "Join Room"}
      </button>
    </div>
  );
}

interface RoomLobbyProps {
  room: RoomSnapshot;
  localPlayerId: PlayerId;
  connection: ConnectionStatus;
  latencyMs: number | null;
  onCopyLink: () => Promise<void>;
  onReadyChange: (ready: boolean) => void;
  onLeave: () => void;
}

export function RoomLobby({ room, localPlayerId, connection, latencyMs, onCopyLink, onReadyChange, onLeave }: RoomLobbyProps) {
  const localPlayer = room.players.find((player) => player.id === localPlayerId);
  const connectedCount = room.players.filter((player) => player.connected).length;
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    await onCopyLink();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  return (
    <div className="screen screen--room">
      <button className="text-button back-button" onClick={onLeave}>← Leave room</button>
      <header className="section-heading">
        <p className="eyebrow">Mission lobby</p>
        <h2>{room.code}</h2>
        <p>{connectedCount} of {room.playerLimit} astronauts connected</p>
      </header>
      <div className="connection-strip" data-status={connection}>
        <span>{connection === "reconnecting" ? "Reconnecting…" : "Room server connected"}</span>
        <strong>{latencyMs === null ? "Measuring latency" : `${latencyMs} ms RTT`}</strong>
      </div>
      <div className="room-card lobby-card">
        {(["player", "rival"] as const).map((slot) => {
          const player = room.players.find((candidate) => candidate.id === slot);
          return (
            <div className="lobby-player" key={slot}>
              <span className={`player-dot player-dot--${slot}`} />
              <div><strong>{player?.name ?? "Waiting for astronaut…"}</strong>
                <small>{player ? (player.connected ? "Connected" : "Connection lost") : "Open slot"}</small></div>
              <span className={player?.ready ? "ready-mark ready-mark--on" : "ready-mark"}>
                {player?.ready ? "Ready" : "Not ready"}
              </span>
            </div>
          );
        })}
      </div>
      <button className="button button--secondary" onClick={copyLink}>
        {copied ? "Invitation link copied" : "Copy invitation link"}
      </button>
      <button className="button button--primary" disabled={connection !== "connected"}
        onClick={() => onReadyChange(!localPlayer?.ready)}>
        {localPlayer?.ready ? "Cancel Ready" : "Ready Up"}
      </button>
      <p className="lobby-help">The match starts automatically when both astronauts are connected and ready.</p>
    </div>
  );
}

interface MatchResultViewProps {
  state: GameState;
  room: RoomSnapshot;
  localPlayerId: PlayerId;
  connection: ConnectionStatus;
  onRequestRematch: () => void;
  onLeave: () => void;
}

export function MatchResultView({
  state,
  room,
  localPlayerId,
  connection,
  onRequestRematch,
  onLeave,
}: MatchResultViewProps) {
  const opponentId: PlayerId = localPlayerId === "player" ? "rival" : "player";
  const localScore = getTerritoryScore(state, localPlayerId);
  const opponentScore = getTerritoryScore(state, opponentId);
  const localPlayer = room.players.find((player) => player.id === localPlayerId);
  const opponent = room.players.find((player) => player.id === opponentId);
  const canRematch =
    room.players.length === room.playerLimit && room.players.every((player) => player.connected);
  const isDraw = room.winner === "draw" || (room.winner === null && localScore === opponentScore);
  const didWin = room.winner === localPlayerId || (room.winner === null && localScore > opponentScore);
  const result = isDraw ? "Draw" : didWin ? "Victory" : "Defeat";
  const resultSummary = room.finishReason === "disconnect"
    ? didWin
      ? "The rival signal was lost before it could reconnect."
      : "Your signal was lost before it could reconnect."
    : isDraw
      ? "Both tether networks held equal ground."
      : didWin
        ? "Your tether network controlled more territory."
        : "The rival network controlled more territory.";
  const connectionLabel = getConnectionLabel(connection);

  return (
    <div className="screen screen--room screen--result">
      <header className="section-heading result-heading">
        <p className="eyebrow">Mission complete</p>
        <h2>{result}</h2>
        <p>{resultSummary}</p>
      </header>

      <div className="result-scores" aria-label="Final scores">
        <div className={`result-score result-score--${localPlayerId}`}>
          <span>You</span>
          <strong>{localScore}%</strong>
        </div>
        <div className={`result-score result-score--${opponentId}`}>
          <span>{opponent?.name ?? "Rival"}</span>
          <strong>{opponentScore}%</strong>
        </div>
      </div>

      <div className="connection-strip" data-status={connection}>
        <span>{connectionLabel}</span>
        <strong>Room {room.code}</strong>
      </div>

      <div className="room-card lobby-card">
        {(["player", "rival"] as const).map((playerId) => {
          const player = room.players.find((candidate) => candidate.id === playerId);
          const name = playerId === localPlayerId
            ? `${player?.name ?? "You"} (You)`
            : player?.name ?? "Rival";
          return (
            <div className="lobby-player" key={playerId}>
              <span className={`player-dot player-dot--${playerId}`} />
              <div>
                <strong>{name}</strong>
                <small>{player?.connected ? "Connected" : "Connection lost"}</small>
              </div>
              <span className={player?.ready ? "ready-mark ready-mark--on" : "ready-mark"}>
                {player?.ready ? "Rematch ready" : "Waiting"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="result-actions">
        <button className="button button--primary"
          disabled={connection !== "connected" || !canRematch || localPlayer?.ready}
          onClick={onRequestRematch}>
          {localPlayer?.ready ? "Rematch requested" : "Request rematch"}
        </button>
        <button className="button button--secondary" onClick={onLeave}>Leave room</button>
      </div>
      <p className="lobby-help">
        {canRematch
          ? "A new match starts when both astronauts request a rematch."
          : "The other astronaut has left; return to the menu to create another room."}
      </p>
    </div>
  );
}

function getConnectionLabel(connection: ConnectionStatus) {
  switch (connection) {
    case "connected": return "Room server connected";
    case "reconnecting": return "Reconnecting…";
    case "connecting": return "Connecting…";
    default: return "Connection lost";
  }
}
