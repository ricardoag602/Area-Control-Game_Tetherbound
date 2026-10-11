import { useState, type FormEvent } from "react";
import { sampleScorableTerritory } from "../../game/simulation/scoring";
import type { GameState, MatchFinishReason, PlayerId } from "../../game/types";
import type { ConnectionStatus } from "../RoomClient";
import { isValidRoomCode, normalizeRoomCode } from "../connectionInfo";
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
  onCodeChange: (code: string) => void;
  onJoin: (name: string, code: string) => void;
}

export function JoinRoomView({ code, connection, error, onBack, onCodeChange, onJoin }: JoinRoomViewProps) {
  const [name, setName] = useState("Explorer 2");
  const busy = connection === "connecting" || connection === "reconnecting";
  const validCode = isValidRoomCode(code);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy && validCode && name.trim()) onJoin(name, code);
  }

  return (
    <div className="screen screen--room">
      <button className="text-button back-button" onClick={onBack}>← Back</button>
      <header className="section-heading">
        <p className="eyebrow">Incoming signal</p>
        <h2>Join room</h2>
        <p>Enter the five-character room code shared by the host.</p>
      </header>
      <form className="join-form" onSubmit={submit}>
        <div className="room-card">
          <label className="field-label" htmlFor="room-code">Room code</label>
          <input id="room-code" className="text-input room-code-input" value={code}
            maxLength={5} autoCapitalize="characters" autoComplete="off" autoCorrect="off"
            spellCheck={false} inputMode="text" placeholder="ABCDE"
            aria-describedby="room-code-help" aria-invalid={code.length === 5 && !validCode}
            onChange={(event) => onCodeChange(normalizeRoomCode(event.target.value))} />
          <p id="room-code-help" className="field-help">Five characters. Codes do not use I, O, 0, or 1.</p>
          {code.length === 5 && !validCode && (
            <p className="form-error" role="alert">Check the code—the characters I, O, 0, and 1 are not used.</p>
          )}
          <label className="field-label" htmlFor="guest-name">Astronaut name</label>
          <input id="guest-name" className="text-input" value={name} maxLength={20}
            onChange={(event) => setName(event.target.value)} autoComplete="nickname" />
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <button type="submit" className="button button--primary"
          disabled={busy || !validCode || !name.trim()}>
          {busy ? "Connecting…" : "Join Room"}
        </button>
      </form>
    </div>
  );
}

interface RoomLobbyProps {
  room: RoomSnapshot;
  localPlayerId: PlayerId;
  connection: ConnectionStatus;
  latencyMs: number | null;
  invitationLink: string;
  localAddressOnly: boolean;
  onCopyLink: () => Promise<void>;
  onReadyChange: (ready: boolean) => void;
  onLeave: () => void;
}

export function RoomLobby({ room, localPlayerId, connection, latencyMs, invitationLink, localAddressOnly, onCopyLink, onReadyChange, onLeave }: RoomLobbyProps) {
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
        <h2>Waiting room</h2>
        <p>{connectedCount} of {room.playerLimit} astronauts connected</p>
      </header>
      <div className="connection-strip" data-status={connection}>
        <span>{connection === "reconnecting" ? "Reconnecting…" : "Room server connected"}</span>
        <strong>{latencyMs === null ? "Measuring latency" : `${latencyMs} ms RTT`}</strong>
      </div>
      <div className="room-card invite-card">
        <div className="room-code-block">
          <span>Room code</span>
          <strong>{room.code}</strong>
          <p>The other player can choose Join Multiplayer Room and enter this code.</p>
        </div>
        <span className="field-label">Invitation link</span>
        <code className="invite-url">{invitationLink}</code>
        <button className="button button--secondary button--compact" onClick={copyLink}>
          {copied ? "Invitation link copied" : "Copy invitation link"}
        </button>
        {localAddressOnly && (
          <p className="notice">This localhost link works only on this computer. For another device, open the Network address printed by <code>npm run dev</code> and enter room code <strong>{room.code}</strong>.</p>
        )}
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
  const territory = sampleScorableTerritory(state).fractions;
  const localTerritory = territory[localPlayerId] * 100;
  const opponentTerritory = territory[opponentId] * 100;
  const localPlayer = room.players.find((player) => player.id === localPlayerId);
  const opponent = room.players.find((player) => player.id === opponentId);
  const canRematch =
    room.players.length === room.playerLimit && room.players.every((player) => player.connected);
  const winner = room.winner ?? state.matchOutcome?.winner ?? scoreWinner(state);
  const finishReason = room.finishReason ?? state.matchOutcome?.reason ?? "regulation_score";
  const isDraw = winner === "draw";
  const didWin = winner === localPlayerId;
  const result = isDraw ? "Draw" : didWin ? "Victory" : "Defeat";
  const decidedInOvertime =
    finishReason === "overtime_lead" || finishReason === "overtime_territory";
  const resultSummary = describeFinish(
    finishReason,
    didWin,
    isDraw,
    opponent?.name ?? "The rival",
  );
  const connectionLabel = getConnectionLabel(connection);

  return (
    <div className="screen screen--room screen--result">
      <header className="section-heading result-heading">
        <p className="eyebrow">{finishLabel(finishReason)}</p>
        <h2>{result}</h2>
        <p>{resultSummary}</p>
      </header>

      <div className="result-scores" aria-label="Final scores">
        <div className={`result-score result-score--${localPlayerId}`}>
          <span>You</span>
          <strong>{state.scores[localPlayerId].toFixed(1)}</strong>
          <small>signal · {Math.round(localTerritory)}% final territory</small>
        </div>
        <div className={`result-score result-score--${opponentId}`}>
          <span>{opponent?.name ?? "Rival"}</span>
          <strong>{state.scores[opponentId].toFixed(1)}</strong>
          <small>signal · {Math.round(opponentTerritory)}% final territory</small>
        </div>
      </div>

      {decidedInOvertime && (
        <p className="result-overtime-score">
          <span>Overtime-only signal</span>
          <strong>
            You {state.overtimeScores[localPlayerId].toFixed(1)} ·{" "}
            {opponent?.name ?? "Rival"} {state.overtimeScores[opponentId].toFixed(1)}
          </strong>
        </p>
      )}

      <p className="result-score-explainer">
        {finishReason === "overtime_lead"
          ? "Regulation totals remain above. The separate overtime race ended at a five-point lead."
          : finishReason === "overtime_territory"
            ? "Regulation totals remain above. Live territory decided the match when overtime expired."
            : "Signal score accumulates from uncontested powered territory throughout the match."}
      </p>

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

function scoreWinner(state: GameState): PlayerId | "draw" {
  if (state.scores.player === state.scores.rival) return "draw";
  return state.scores.player > state.scores.rival ? "player" : "rival";
}

function finishLabel(reason: MatchFinishReason | "disconnect") {
  switch (reason) {
    case "disconnect": return "Signal lost";
    case "base_collapse": return "Network collapsed";
    case "overtime_lead": return "Overtime breakthrough";
    case "overtime_territory": return "Overtime expired";
    default: return "Regulation complete";
  }
}

function describeFinish(
  reason: MatchFinishReason | "disconnect",
  didWin: boolean,
  isDraw: boolean,
  opponentName: string,
) {
  if (reason === "disconnect") {
    if (isDraw) {
      return "Both signals were lost before either astronaut could reconnect.";
    }
    return didWin
      ? `${opponentName}'s signal was lost before it could reconnect.`
      : "Your signal was lost before it could reconnect.";
  }
  if (isDraw) {
    if (reason === "base_collapse") {
      return "Both exposed bases collapsed at the same moment.";
    }
    if (reason === "overtime_territory") {
      return "Both networks controlled equal live territory when overtime expired.";
    }
    return "Both networks finished level on signal.";
  }
  switch (reason) {
    case "base_collapse":
      return didWin
        ? `You held ${opponentName}'s exposed base until its network collapsed.`
        : `${opponentName} held your exposed base until your network collapsed.`;
    case "overtime_lead":
      return didWin
        ? "You established the decisive signal lead in overtime."
        : `${opponentName} established the decisive signal lead in overtime.`;
    case "overtime_territory":
      return didWin
        ? "You controlled more live territory when overtime expired."
        : `${opponentName} controlled more live territory when overtime expired.`;
    default:
      return didWin
        ? "Your network accumulated more signal during regulation."
        : `${opponentName}'s network accumulated more signal during regulation.`;
  }
}
