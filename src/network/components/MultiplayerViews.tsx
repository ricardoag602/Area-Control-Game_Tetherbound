import { useState, type FormEvent } from "react";
import { PostMatchScene } from "../../game/components/PostMatchScene";
import { sampleScorableTerritory } from "../../game/simulation/scoring";
import { PLAYER_IDS, type GameState, type MatchFinishReason, type PlayerId, type PlayerLimit } from "../../game/types";
import type { ConnectionStatus } from "../RoomClient";
import { isValidRoomCode, normalizeRoomCode } from "../connectionInfo";
import type { PublicRoomSummary, RoomSnapshot, RoomVisibility } from "../protocol";

interface CreateRoomViewProps {
  connection: ConnectionStatus;
  error: string | null;
  onBack: () => void;
  onCreate: (name: string, playerLimit: PlayerLimit, visibility: RoomVisibility) => void;
}

export function CreateRoomView({ connection, error, onBack, onCreate }: CreateRoomViewProps) {
  const [name, setName] = useState("Explorer 1");
  const [playerLimit, setPlayerLimit] = useState<PlayerLimit>(2);
  const [visibility, setVisibility] = useState<RoomVisibility>("private");
  const busy = connection === "connecting";

  return (
    <div className="screen screen--room">
      <button className="text-button back-button" onClick={onBack}>← Back</button>
      <header className="section-heading">
        <p className="eyebrow">Establish a link</p>
        <h2>Create room</h2>
        <p>Choose a balanced room for two, three, or four astronauts.</p>
      </header>
      <div className="room-card">
        <label className="field-label" htmlFor="host-name">Astronaut name</label>
        <input id="host-name" className="text-input" value={name} maxLength={20}
          onChange={(event) => setName(event.target.value)} autoComplete="nickname" />
        <fieldset className="room-choice-fieldset">
          <legend className="field-label">Room visibility</legend>
          <div className="visibility-picker">
            <label className={visibility === "public" ? "visibility-option visibility-option--selected" : "visibility-option"}>
              <input type="radio" name="room-visibility" value="public"
                checked={visibility === "public"} onChange={() => setVisibility("public")} />
              <span className="visibility-option__icon" aria-hidden="true">◎</span>
              <span><strong>Public</strong><small>Listed for anyone looking for a crew</small></span>
              <span className="visibility-option__check" aria-hidden="true" />
            </label>
            <label className={visibility === "private" ? "visibility-option visibility-option--selected" : "visibility-option"}>
              <input type="radio" name="room-visibility" value="private"
                checked={visibility === "private"} onChange={() => setVisibility("private")} />
              <span className="visibility-option__icon" aria-hidden="true">⌁</span>
              <span><strong>Private</strong><small>Only people with your code or invite link</small></span>
              <span className="visibility-option__check" aria-hidden="true" />
            </label>
          </div>
        </fieldset>
        <span className="field-label">Player limit</span>
        <div className="player-limit-picker" aria-label="Player limit">
          {([2, 3, 4] as const).map((limit) => (
            <button
              key={limit}
              type="button"
              className={limit === playerLimit ? "player-limit-option player-limit-option--selected" : "player-limit-option"}
              aria-pressed={limit === playerLimit}
              onClick={() => setPlayerLimit(limit)}
            >
              <strong>{limit}</strong>
              <span>players</span>
            </button>
          ))}
        </div>
        <p className="notice">Every room size uses equal-distance spawns and mirrored starting resources.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <button className="button button--primary" disabled={busy || !name.trim()}
        onClick={() => onCreate(name, playerLimit, visibility)}>
        {busy ? "Contacting room service…" : "Create Multiplayer Room"}
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
  loadPublicRooms: () => Promise<PublicRoomSummary[]>;
}

type JoinMethod = "code" | "public";
type PublicRoomListStatus = "idle" | "loading" | "ready" | "error";

export function JoinRoomView({
  code,
  connection,
  error,
  onBack,
  onCodeChange,
  onJoin,
  loadPublicRooms,
}: JoinRoomViewProps) {
  const [name, setName] = useState("Explorer 2");
  const [joinMethod, setJoinMethod] = useState<JoinMethod>("code");
  const [publicRooms, setPublicRooms] = useState<PublicRoomSummary[]>([]);
  const [publicRoomStatus, setPublicRoomStatus] = useState<PublicRoomListStatus>("idle");
  const [publicRoomError, setPublicRoomError] = useState<string | null>(null);
  const [joiningRoomCode, setJoiningRoomCode] = useState<string | null>(null);
  const busy = connection === "connecting" || connection === "reconnecting";
  const validCode = isValidRoomCode(code);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy && validCode && name.trim()) onJoin(name, code);
  }

  async function refreshPublicRooms() {
    if (publicRoomStatus === "loading") return;
    setPublicRoomStatus("loading");
    setPublicRoomError(null);
    try {
      const rooms = await loadPublicRooms();
      setPublicRooms([...rooms].sort((left, right) => right.updatedAt - left.updatedAt));
      setPublicRoomStatus("ready");
    } catch (loadError) {
      setPublicRoomStatus("error");
      setPublicRoomError(loadError instanceof Error
        ? loadError.message
        : "Public rooms could not be loaded. Try again.");
    }
  }

  function selectJoinMethod(method: JoinMethod) {
    setJoinMethod(method);
    if (method === "public" && publicRoomStatus === "idle") {
      void refreshPublicRooms();
    }
  }

  function joinPublicRoom(room: PublicRoomSummary) {
    if (busy || !name.trim()) return;
    setJoiningRoomCode(room.code);
    onCodeChange(room.code);
    onJoin(name, room.code);
  }

  return (
    <div className="screen screen--room">
      <button className="text-button back-button" onClick={onBack}>← Back</button>
      <header className="section-heading">
        <p className="eyebrow">Incoming signal</p>
        <h2>Join room</h2>
        <p>Choose your call sign, then use an invite code or find an open public crew.</p>
      </header>
      <div className="join-form">
        <div className="room-card join-identity-card">
          <label className="field-label" htmlFor="guest-name">Astronaut name</label>
          <input id="guest-name" className="text-input" value={name} maxLength={20}
            onChange={(event) => setName(event.target.value)} autoComplete="nickname" />
          <p className="field-help">This is how your crew will see you in the lobby.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>

        <div className="join-method-tabs" role="tablist" aria-label="Ways to join a room">
          <button type="button" role="tab" id="join-code-tab" aria-controls="join-code-panel"
            aria-selected={joinMethod === "code"}
            className={joinMethod === "code" ? "join-method-tab join-method-tab--selected" : "join-method-tab"}
            onClick={() => selectJoinMethod("code")}>
            <span aria-hidden="true">#</span> Join by code
          </button>
          <button type="button" role="tab" id="join-public-tab" aria-controls="join-public-panel"
            aria-selected={joinMethod === "public"}
            className={joinMethod === "public" ? "join-method-tab join-method-tab--selected" : "join-method-tab"}
            onClick={() => selectJoinMethod("public")}>
            <span aria-hidden="true">◎</span> Public rooms
          </button>
        </div>

        {joinMethod === "code" && (
          <form id="join-code-panel" role="tabpanel" aria-labelledby="join-code-tab"
            className="room-card join-method-panel" onSubmit={submit}>
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
            <button type="submit" className="button button--primary"
              disabled={busy || !validCode || !name.trim()}>
              {busy ? "Connecting…" : "Join with code"}
            </button>
          </form>
        )}

        {joinMethod === "public" && (
          <PublicRoomDirectory
            rooms={publicRooms}
            status={publicRoomStatus}
            error={publicRoomError}
            busy={busy}
            canJoin={Boolean(name.trim())}
            joiningRoomCode={joiningRoomCode}
            onJoin={joinPublicRoom}
            onRefresh={() => { void refreshPublicRooms(); }}
          />
        )}
      </div>
    </div>
  );
}

interface PublicRoomDirectoryProps {
  rooms: PublicRoomSummary[];
  status: PublicRoomListStatus;
  error: string | null;
  busy: boolean;
  canJoin: boolean;
  joiningRoomCode: string | null;
  onJoin: (room: PublicRoomSummary) => void;
  onRefresh: () => void;
}

export function PublicRoomDirectory({
  rooms,
  status,
  error,
  busy,
  canJoin,
  joiningRoomCode,
  onJoin,
  onRefresh,
}: PublicRoomDirectoryProps) {
  return (
    <section id="join-public-panel" role="tabpanel" aria-labelledby="join-public-tab"
      className="room-card public-room-browser" aria-busy={status === "loading"}>
      <div className="public-room-browser__header">
        <div>
          <span className="field-label">Available crews</span>
          <p>Open rooms with space for another astronaut.</p>
        </div>
        <button type="button" className="refresh-rooms-button" onClick={onRefresh}
          disabled={status === "loading"} aria-label="Refresh public rooms">
          <span aria-hidden="true">↻</span> Refresh
        </button>
      </div>

      {status === "loading" && (
        <div className="public-room-state" role="status">
          <span className="signal-loader" aria-hidden="true" />
          <strong>Scanning for open signals…</strong>
          <small>Checking the public room network</small>
        </div>
      )}

      {status === "error" && (
        <div className="public-room-state public-room-state--error" role="alert">
          <span className="public-room-state__icon" aria-hidden="true">!</span>
          <strong>Signal scan failed</strong>
          <small>{error ?? "Public rooms could not be loaded."}</small>
          <button type="button" className="button button--secondary button--compact" onClick={onRefresh}>
            Try again
          </button>
        </div>
      )}

      {status === "ready" && rooms.length === 0 && (
        <div className="public-room-state" role="status">
          <span className="public-room-state__icon" aria-hidden="true">◇</span>
          <strong>No public rooms yet</strong>
          <small>Start a public room and be the first signal on the network.</small>
        </div>
      )}

      {status === "ready" && rooms.length > 0 && (
        <div className="public-room-list" aria-label={`${rooms.length} public ${rooms.length === 1 ? "room" : "rooms"}`}>
          {rooms.map((room) => {
            const joining = busy && joiningRoomCode === room.code;
            const spaces = room.playerLimit - room.playerCount;
            return (
              <button key={room.code} type="button" className="public-room-option"
                disabled={busy || !canJoin} onClick={() => onJoin(room)}
                aria-label={`Join ${room.hostName}'s room, ${room.playerCount} of ${room.playerLimit} players`}>
                <span className="public-room-option__signal" aria-hidden="true"><i /></span>
                <span className="public-room-option__copy">
                  <strong>{room.hostName}<small>’s crew</small></strong>
                  <small>Code {room.code} · {spaces} {spaces === 1 ? "seat" : "seats"} open</small>
                </span>
                <span className="public-room-option__count">
                  <strong>{room.playerCount}/{room.playerLimit}</strong>
                  <small>{joining ? "Joining…" : "Join"}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!canJoin && status === "ready" && rooms.length > 0 && (
        <p className="public-room-browser__hint">Enter your astronaut name above to join a crew.</p>
      )}
    </section>
  );
}

interface RoomLobbyProps {
  room: RoomSnapshot;
  localPlayerId: PlayerId;
  connection: ConnectionStatus;
  error: string | null;
  latencyMs: number | null;
  invitationLink: string;
  localAddressOnly: boolean;
  onCopyLink: () => Promise<void>;
  onReadyChange: (ready: boolean) => void;
  onRetry: () => void;
  onLeave: () => void;
}

export function RoomLobby({ room, localPlayerId, connection, error, latencyMs, invitationLink, localAddressOnly, onCopyLink, onReadyChange, onRetry, onLeave }: RoomLobbyProps) {
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
        <span>{getConnectionLabel(connection)}</span>
        <strong>{latencyMs === null ? "Measuring latency" : `${latencyMs} ms RTT`}</strong>
      </div>
      {connection === "offline" && (
        <div className="connection-retry" role="alert">
          <p>{error ?? "The room connection was lost."}</p>
          <button className="button button--primary button--compact" onClick={onRetry}>Reconnect</button>
        </div>
      )}
      <div className="room-card invite-card">
        <div className={`room-visibility-badge room-visibility-badge--${room.visibility}`}>
          <span aria-hidden="true">{room.visibility === "public" ? "◎" : "⌁"}</span>
          <div>
            <strong>{room.visibility === "public" ? "Public room" : "Private room"}</strong>
            <small>{room.visibility === "public"
              ? "Listed while this lobby is open"
              : "Available only by code or invite link"}</small>
          </div>
        </div>
        <div className="room-code-block">
          <span>Room code</span>
          <strong>{room.code}</strong>
          <p>Other players can choose Join Multiplayer Room and enter this code.</p>
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
        {PLAYER_IDS.slice(0, room.playerLimit).map((slot) => {
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
      <p className="lobby-help">The match starts automatically when all astronauts are connected and ready.</p>
    </div>
  );
}

interface MatchResultViewProps {
  state: GameState;
  room: RoomSnapshot;
  localPlayerId: PlayerId;
  connection: ConnectionStatus;
  error: string | null;
  onRetry: () => void;
  onRequestRematch: () => void;
  onLeave: () => void;
}

export function MatchResultView({
  state,
  room,
  localPlayerId,
  connection,
  error,
  onRetry,
  onRequestRematch,
  onLeave,
}: MatchResultViewProps) {
  const territory = sampleScorableTerritory(state).fractions;
  const localPlayer = room.players.find((player) => player.id === localPlayerId);
  const canRematch =
    room.players.length === room.playerLimit && room.players.every((player) => player.connected);
  const winner = room.winner ?? state.matchOutcome?.winner ?? scoreWinner(state);
  const finishReason = room.finishReason ?? state.matchOutcome?.reason ?? "regulation_score";
  const isDraw = winner === "draw";
  const didWin = winner === localPlayerId;
  const winnerName = winner === "draw"
    ? null
    : winner === localPlayerId
      ? "You"
      : room.players.find((player) => player.id === winner)?.name ?? "A rival";
  const result = isDraw ? "Draw" : didWin ? "Victory" : "Defeat";
  const decidedInOvertime =
    finishReason === "overtime_lead" || finishReason === "overtime_territory";
  const resultSummary = describeFinish(finishReason, didWin, isDraw, winnerName);
  const connectionLabel = getConnectionLabel(connection);

  return (
    <PostMatchScene state={state} localPlayerId={localPlayerId}>
      <header className="section-heading result-heading">
        <p className="eyebrow">{finishLabel(finishReason)}</p>
        <h2>{result}</h2>
        <p>{resultSummary}</p>
      </header>

      <div className="result-scores" aria-label="Final scores">
        {state.activePlayerIds.map((playerId) => {
          const player = room.players.find((candidate) => candidate.id === playerId);
          return (
            <div className={`result-score result-score--${playerId}`} key={playerId}>
              <span>{playerId === localPlayerId ? "You" : player?.name ?? "Rival"}</span>
              <strong>{state.scores[playerId].toFixed(1)}</strong>
              <small>signal · {Math.round(territory[playerId] * 100)}% final territory</small>
            </div>
          );
        })}
      </div>

      {decidedInOvertime && (
        <p className="result-overtime-score">
          <span>Overtime-only signal</span>
          <strong>
            {state.activePlayerIds.map((playerId) => {
              const name = playerId === localPlayerId
                ? "You"
                : room.players.find((player) => player.id === playerId)?.name ?? "Rival";
              return `${name} ${state.overtimeScores[playerId].toFixed(1)}`;
            }).join(" · ")}
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
      {connection === "offline" && (
        <div className="connection-retry" role="alert">
          <p>{error ?? "The room connection was lost."}</p>
          <button className="button button--primary button--compact" onClick={onRetry}>Reconnect</button>
        </div>
      )}

      <div className="room-card lobby-card">
        {state.activePlayerIds.map((playerId) => {
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
          ? "A new match starts when every astronaut requests a rematch."
          : "An astronaut has left; return to the menu to create another room."}
      </p>
    </PostMatchScene>
  );
}

function getConnectionLabel(connection: ConnectionStatus) {
  switch (connection) {
    case "connected": return "Room service connected";
    case "reconnecting": return "Reconnecting…";
    case "connecting": return "Connecting…";
    case "offline": return "Room service unavailable";
    default: return "Connection lost";
  }
}

function scoreWinner(state: GameState): PlayerId | "draw" {
  const best = Math.max(...state.activePlayerIds.map((playerId) => state.scores[playerId]));
  const leaders = state.activePlayerIds.filter(
    (playerId) => Math.abs(state.scores[playerId] - best) <= 1e-9,
  );
  return leaders.length === 1 ? leaders[0] : "draw";
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
  winnerName: string | null,
) {
  if (reason === "disconnect") {
    if (isDraw) {
      return "Both signals were lost before either astronaut could reconnect.";
    }
    return didWin
      ? "The disconnected signal did not recover in time."
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
        ? "You held an exposed base until its network collapsed."
        : `${winnerName ?? "A rival"} completed a decisive base collapse.`;
    case "overtime_lead":
      return didWin
        ? "You established the decisive signal lead in overtime."
        : `${winnerName ?? "A rival"} established the decisive signal lead in overtime.`;
    case "overtime_territory":
      return didWin
        ? "You controlled more live territory when overtime expired."
        : `${winnerName ?? "A rival"} controlled more live territory when overtime expired.`;
    default:
      return didWin
        ? "Your network accumulated more signal during regulation."
        : `${winnerName ?? "A rival"} accumulated the most signal during regulation.`;
  }
}
