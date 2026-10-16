import { useEffect, useRef, useState } from "react";
import { MenuNetworkBackground } from "./components/MenuNetworkBackground";
import { GameView } from "./game/components/GameView";
import { NetworkGameView } from "./network/components/NetworkGameView";
import type { GameMode } from "./game/types";
import { getRoomServerUrl, RoomClient } from "./network/RoomClient";
import {
    createGameAddress,
    createInvitationLink,
    isLoopbackHostname,
    normalizeRoomCode,
} from "./network/connectionInfo";
import {
    CreateRoomView,
    JoinRoomView,
    MatchResultView,
    RoomLobby,
} from "./network/components/MultiplayerViews";
import { useRoomClient } from "./network/useRoomClient";
import {
    AUDIO_PREFERENCE_KEY,
    readAudioPreference,
} from "./game/audio/gameAudio";
import {
    preloadThreeGameplayAssets,
    scheduleFirstMatchAssetPreload,
} from "./game/presentation/firstMatchAssets";
import {
    readTutorialPreference,
    writeTutorialPreference,
} from "./game/tutorial/guidedSetup";

type View = "menu" | "create-room" | "join-room" | "lobby" | "game" | "result";

const LARGE_CONTROLS_KEY = "tetherbound.largeControls";

export function App() {
    const [initialRoomCode] = useState(
        () => normalizeRoomCode(new URLSearchParams(window.location.search).get("room") ?? ""),
    );
    const [joinRoomCode, setJoinRoomCode] = useState(initialRoomCode);
    const [view, setView] = useState<View>(initialRoomCode ? "join-room" : "menu");
    const [gameMode, setGameMode] = useState<GameMode>("bot");
    const [roomClient] = useState(() => new RoomClient());
    const [gameAddress] = useState(() => createGameAddress(window.location.href));
    const [roomServerAddress] = useState(() => getRoomServerUrl());
    const roomSession = useRoomClient(roomClient);
    const resumeAttempted = useRef(false);
    const [largeControls, setLargeControls] = useState(
        () => localStorage.getItem(LARGE_CONTROLS_KEY) === "true",
    );
    const [audioEnabled, setAudioEnabled] = useState(readAudioPreference);
    const [tutorialEnabled, setTutorialEnabled] = useState(readTutorialPreference);

    useEffect(() => {
        localStorage.setItem(LARGE_CONTROLS_KEY, String(largeControls));
    }, [largeControls]);

    useEffect(() => {
        try {
            localStorage.setItem(AUDIO_PREFERENCE_KEY, String(audioEnabled));
        } catch {
            // Audio still follows the in-memory preference when storage is blocked.
        }
    }, [audioEnabled]);

    useEffect(() => {
        writeTutorialPreference(tutorialEnabled);
    }, [tutorialEnabled]);

    useEffect(() => {
        if (view !== "menu") return;
        return scheduleFirstMatchAssetPreload();
    }, [view]);

    useEffect(() => {
        if (view !== "lobby" || !roomSession.room) return;
        preloadThreeGameplayAssets(
            roomSession.room.players.map((player) => player.id),
        );
    }, [roomSession.room, view]);

    useEffect(() => {
        if (resumeAttempted.current || !initialRoomCode) return;
        resumeAttempted.current = true;
        roomClient.resumeRoom(initialRoomCode);
    }, [initialRoomCode, roomClient]);

    useEffect(() => {
        if (!roomSession.room) return;
        setGameMode("multiplayer");
        const url = new URL(window.location.href);
        url.searchParams.set("room", roomSession.room.code);
        window.history.replaceState(null, "", url);
        if (roomSession.room.phase === "playing") {
            setView("game");
        } else if (roomSession.room.phase === "finished") {
            setView("result");
        } else {
            setView("lobby");
        }
    }, [roomSession.room]);

    useEffect(() => {
        if (
            gameMode !== "multiplayer" ||
            roomSession.connection !== "offline" ||
            !roomSession.error ||
            (view !== "lobby" && view !== "game" && view !== "result")
        ) {
            return;
        }

        // A non-recoverable resume failure (for example, returning after the
        // reserved slot expired) must not strand the player on a frozen match.
        // Keep the code and server explanation visible so they can retry or leave.
        if (roomSession.room?.code) setJoinRoomCode(roomSession.room.code);
        setView("join-room");
    }, [
        gameMode,
        roomSession.connection,
        roomSession.error,
        roomSession.room?.code,
        view,
    ]);

    function startBotGame() {
        preloadThreeGameplayAssets(["player", "rival"]);
        roomClient.leave();
        clearRoomFromUrl();
        setGameMode("bot");
        setView("game");
    }

    function leaveMultiplayer() {
        roomClient.leave();
        clearRoomFromUrl();
        setJoinRoomCode("");
        setGameMode("bot");
        setView("menu");
    }

    function clearRoomFromUrl() {
        const url = new URL(window.location.href);
        url.searchParams.delete("room");
        window.history.replaceState(null, "", url);
    }

    async function copyInvitationLink() {
        if (!invitationLink) return;
        try {
            await navigator.clipboard.writeText(invitationLink);
        } catch {
            const field = document.createElement("textarea");
            field.value = invitationLink;
            field.style.position = "fixed";
            field.style.opacity = "0";
            document.body.appendChild(field);
            field.select();
            document.execCommand("copy");
            field.remove();
        }
    }

    const invitationLink = roomSession.room
        ? createInvitationLink(window.location.href, roomSession.room.code)
        : "";
    const localAddressOnly = isLoopbackHostname(window.location.hostname);

    return (
        <main className={largeControls ? "app app--large-controls" : "app"}>
            {view === "menu" && <MenuNetworkBackground />}
            <div className="space-noise" aria-hidden="true" />
            <section className="view-stage">
                {view === "menu" && (
                    <MainMenu
                        audioEnabled={audioEnabled}
                        largeControls={largeControls}
                        tutorialEnabled={tutorialEnabled}
                        onAudioEnabledChange={setAudioEnabled}
                        onLargeControlsChange={setLargeControls}
                        onTutorialEnabledChange={setTutorialEnabled}
                        onBotGame={startBotGame}
                        onCreateRoom={() => setView("create-room")}
                        onJoinRoom={() => { setJoinRoomCode(""); setView("join-room"); }}
                        gameAddress={gameAddress}
                        roomServerAddress={roomServerAddress}
                        localAddressOnly={localAddressOnly}
                    />
                )}
                {view === "create-room" && (
                    <CreateRoomView connection={roomSession.connection} error={roomSession.error}
                        onBack={() => setView("menu")}
                        onCreate={(name, playerLimit, visibility) => {
                            roomClient.createRoom(name, playerLimit, visibility);
                            setView("lobby");
                        }} />
                )}
                {view === "join-room" && (
                    <JoinRoomView code={joinRoomCode} connection={roomSession.connection} error={roomSession.error}
                        onBack={leaveMultiplayer}
                        onCodeChange={setJoinRoomCode}
                        onJoin={(name, code) => { setJoinRoomCode(code); roomClient.joinRoom(code, name); }}
                        loadPublicRooms={() => roomClient.listPublicRooms()} />
                )}
                {view === "lobby" && roomSession.room && roomSession.playerId && (
                    <RoomLobby room={roomSession.room} localPlayerId={roomSession.playerId}
                        connection={roomSession.connection} latencyMs={roomSession.latencyMs}
                        error={roomSession.error}
                        invitationLink={invitationLink} localAddressOnly={localAddressOnly}
                        onCopyLink={copyInvitationLink} onReadyChange={(ready) => roomClient.setReady(ready)}
                        onRetry={() => roomClient.retry()} onLeave={leaveMultiplayer} />
                )}
                {view === "lobby" && !roomSession.room && (
                    <div className="screen screen--room connection-gate">
                        <p className="eyebrow">Room service</p>
                        <h2>{roomSession.connection === "offline" ? "Connection unavailable" : "Establishing connection…"}</h2>
                        <p>{roomSession.error ?? "Reserving your place in the mission."}</p>
                        <div className="connection-gate__actions">
                            {roomSession.connection === "offline" && (
                                <button className="button button--primary" onClick={() => roomClient.retry()}>
                                    Try Again
                                </button>
                            )}
                            <button className="button button--secondary" onClick={leaveMultiplayer}>Cancel</button>
                        </div>
                    </div>
                )}
                {view === "game" && gameMode === "bot" && (
                    <GameView
                        audioEnabled={audioEnabled}
                        tutorialEnabled={tutorialEnabled}
                        onLeave={() => setView("menu")}
                    />
                )}
                {view === "game" && gameMode === "multiplayer" && roomSession.room && roomSession.gameState && roomSession.playerId && (
                    <NetworkGameView state={roomSession.gameState} room={roomSession.room}
                        audioEnabled={audioEnabled}
                        tutorialEnabled={tutorialEnabled}
                        localPlayerId={roomSession.playerId} connection={roomSession.connection}
                        latencyMs={roomSession.latencyMs} error={roomSession.error}
                        onMovementCommand={(command) => roomClient.sendMovementCommand(command)}
                        onDeploy={() => roomClient.deployAnchor()} onRetry={() => roomClient.retry()}
                        onLeave={leaveMultiplayer} />
                )}
                {view === "result" && roomSession.room && roomSession.gameState && roomSession.playerId && (
                    <MatchResultView state={roomSession.gameState} room={roomSession.room}
                        localPlayerId={roomSession.playerId} connection={roomSession.connection}
                        error={roomSession.error} onRetry={() => roomClient.retry()}
                        onRequestRematch={() => roomClient.requestRematch()} onLeave={leaveMultiplayer} />
                )}
            </section>
        </main>
    );
}

interface MainMenuProps {
    audioEnabled: boolean;
    largeControls: boolean;
    tutorialEnabled: boolean;
    onAudioEnabledChange: (enabled: boolean) => void;
    onLargeControlsChange: (enabled: boolean) => void;
    onTutorialEnabledChange: (enabled: boolean) => void;
    onBotGame: () => void;
    onCreateRoom: () => void;
    onJoinRoom: () => void;
    gameAddress: string;
    roomServerAddress: string;
    localAddressOnly: boolean;
}

function MainMenu({
    audioEnabled,
    largeControls,
    tutorialEnabled,
    onAudioEnabledChange,
    onLargeControlsChange,
    onTutorialEnabledChange,
    onBotGame,
    onCreateRoom,
    onJoinRoom,
    gameAddress,
    roomServerAddress,
    localAddressOnly,
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

            <label className="setting-card setting-card--tutorial">
                <span className="setting-card__tutorial-icon" aria-hidden="true">
                    <i />
                </span>
                <span className="setting-card__copy">
                    <span className="setting-card__title-row">
                        <strong>Guided setup</strong>
                        <em>Recommended · first match</em>
                    </span>
                    <small>Learn movement, collect 3 materials, build tethers, and disrupt rival networks at your own pace.</small>
                </span>
                <input
                    type="checkbox"
                    checked={tutorialEnabled}
                    onChange={(event) => onTutorialEnabledChange(event.target.checked)}
                />
                <span className="switch" aria-hidden="true" />
            </label>

            <div className="menu-actions">
                <button className="button button--primary" onClick={onBotGame}>
                    <span>Start Bot Game</span>
                    <small>Test the frontier alone</small>
                </button>
                <button className="button button--secondary" onClick={onCreateRoom}>
                    <span>Create Multiplayer Room</span>
                    <small>Invite up to three astronauts</small>
                </button>
                <button className="button button--secondary" onClick={onJoinRoom}>
                    <span>Join Multiplayer Room</span>
                    <small>Enter a code or browse public rooms</small>
                </button>
            </div>

            <details className="connection-details">
                <summary>Connection details</summary>
                <dl>
                    <div><dt>Open this game</dt><dd><code>{gameAddress}</code></dd></div>
                    <div><dt>Room service</dt><dd><code>{roomServerAddress}</code></dd></div>
                </dl>
                <p>Players open the game address, then enter a room code. The room service address is shown for troubleshooting only.</p>
                {localAddressOnly && (
                    <p className="connection-warning">This localhost address works only on this computer. For a phone, use the Network address printed by <code>npm run dev</code>.</p>
                )}
            </details>

            <div className="menu-settings" aria-label="Game settings">
                <label className="setting-card">
                    <span className="setting-card__copy">
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

                <label className="setting-card">
                    <span className="setting-card__copy">
                        <strong>Audio</strong>
                        <small>Music, biome footsteps, movement, and world effects</small>
                    </span>
                    <input
                        type="checkbox"
                        checked={audioEnabled}
                        onChange={(event) => onAudioEnabledChange(event.target.checked)}
                    />
                    <span className="switch" aria-hidden="true" />
                </label>
            </div>

            <footer className="credits">Created by <span>Ricardo Guerrero</span></footer>
        </div>
    );
}
