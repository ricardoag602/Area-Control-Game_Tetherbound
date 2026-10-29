import { useEffect, useRef, useState } from "react";
import { MenuNetworkBackground } from "./components/MenuNetworkBackground";
import { GAME_RULES } from "./game/constants";
import { AppMusicLayer } from "./game/components/AppMusicLayer";
import { UiTactileFeedbackLayer } from "./game/components/UiTactileFeedbackLayer";
import { GameView } from "./game/components/GameView";
import { NetworkGameView } from "./network/components/NetworkGameView";
import {
    PLAYER_IDS,
    type GameMode,
    type GameState,
    type PlayerLimit,
} from "./game/types";
import type { GameMusicPresentation } from "./game/audio/gameMusic";
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
    MUSIC_VOLUME_PREFERENCE_KEY,
    SFX_VOLUME_PREFERENCE_KEY,
    normalizeAudioVolume,
    readAudioPreference,
    readMusicVolumePreference,
    readSfxVolumePreference,
} from "./game/audio/gameAudio";
import {
    preloadThreeGameplayAssets,
    scheduleFirstMatchAssetPreload,
} from "./game/presentation/firstMatchAssets";
import {
    readAlwaysShowJoystickPreference,
    writeAlwaysShowJoystickPreference,
} from "./game/preferences/joystick";
import {
    readTutorialRecommendationDismissed,
    readTutorialPreference,
    writeTutorialRecommendationDismissed,
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
    const [botPlayerLimit, setBotPlayerLimit] = useState<PlayerLimit>(2);
    const [localMusicState, setLocalMusicState] = useState<
        Pick<GameState, "matchPhase" | "remainingMs">
    >({ matchPhase: "setup", remainingMs: GAME_RULES.matchDurationMs });
    const [roomClient] = useState(() => new RoomClient());
    const [gameAddress] = useState(() => createGameAddress(window.location.href));
    const [roomServerAddress] = useState(() => getRoomServerUrl());
    const roomSession = useRoomClient(roomClient);
    const resumeAttempted = useRef(false);
    const [largeControls, setLargeControls] = useState(
        () => localStorage.getItem(LARGE_CONTROLS_KEY) === "true",
    );
    const [audioEnabled, setAudioEnabled] = useState(readAudioPreference);
    const [musicVolume, setMusicVolume] = useState(readMusicVolumePreference);
    const [sfxVolume, setSfxVolume] = useState(readSfxVolumePreference);
    const [tutorialEnabled, setTutorialEnabled] = useState(readTutorialPreference);
    const [tutorialRecommendationDismissed, setTutorialRecommendationDismissed] =
        useState(readTutorialRecommendationDismissed);
    const [alwaysShowJoystick, setAlwaysShowJoystick] = useState(
        readAlwaysShowJoystickPreference,
    );

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
        try {
            localStorage.setItem(MUSIC_VOLUME_PREFERENCE_KEY, String(musicVolume));
        } catch {
            // Volume still follows the in-memory preference when storage is blocked.
        }
    }, [musicVolume]);

    useEffect(() => {
        try {
            localStorage.setItem(SFX_VOLUME_PREFERENCE_KEY, String(sfxVolume));
        } catch {
            // Volume still follows the in-memory preference when storage is blocked.
        }
    }, [sfxVolume]);

    useEffect(() => {
        writeTutorialPreference(tutorialEnabled);
    }, [tutorialEnabled]);

    useEffect(() => {
        writeTutorialRecommendationDismissed(tutorialRecommendationDismissed);
    }, [tutorialRecommendationDismissed]);

    useEffect(() => {
        writeAlwaysShowJoystickPreference(alwaysShowJoystick);
    }, [alwaysShowJoystick]);

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

    function startBotGame(playerLimit: PlayerLimit) {
        preloadThreeGameplayAssets(PLAYER_IDS.slice(0, playerLimit));
        roomClient.leave();
        clearRoomFromUrl();
        setLocalMusicState({
            matchPhase: "setup",
            remainingMs: GAME_RULES.matchDurationMs,
        });
        setBotPlayerLimit(playerLimit);
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
    const musicPresentation: GameMusicPresentation = (() => {
        if (view === "result") return { scene: "finished" };
        if (view !== "game") return { scene: "menu" };

        const match = gameMode === "multiplayer"
            ? roomSession.gameState
            : localMusicState;
        if (!match) return { scene: "menu" };
        if (match.matchPhase === "finished") return { scene: "finished" };
        return {
            scene: "gameplay",
            matchPhase: match.matchPhase,
            remainingMs: match.remainingMs,
        };
    })();

    return (
        <main className={largeControls ? "app app--large-controls" : "app"}>
            <AppMusicLayer
                enabled={audioEnabled}
                presentation={musicPresentation}
                volume={musicVolume}
            />
            <UiTactileFeedbackLayer
                enabled={audioEnabled}
                volume={sfxVolume}
            />
            {view === "menu" && <MenuNetworkBackground />}
            <div className="space-noise" aria-hidden="true" />
            <section className="view-stage">
                {view === "menu" && (
                    <MainMenu
                        alwaysShowJoystick={alwaysShowJoystick}
                        audioEnabled={audioEnabled}
                        largeControls={largeControls}
                        musicVolume={musicVolume}
                        sfxVolume={sfxVolume}
                        tutorialEnabled={tutorialEnabled}
                        tutorialRecommendationDismissed={tutorialRecommendationDismissed}
                        onAlwaysShowJoystickChange={setAlwaysShowJoystick}
                        onAudioEnabledChange={setAudioEnabled}
                        onLargeControlsChange={setLargeControls}
                        onMusicVolumeChange={setMusicVolume}
                        onSfxVolumeChange={setSfxVolume}
                        onTutorialEnabledChange={setTutorialEnabled}
                        onTutorialRecommendationDismiss={() => {
                            setTutorialEnabled(false);
                            setTutorialRecommendationDismissed(true);
                        }}
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
                        alwaysShowJoystick={alwaysShowJoystick}
                        audioEnabled={audioEnabled}
                        sfxVolume={sfxVolume}
                        tutorialEnabled={tutorialEnabled}
                        playerLimit={botPlayerLimit}
                        onMusicStateChange={setLocalMusicState}
                        onLeave={() => setView("menu")}
                    />
                )}
                {view === "game" && gameMode === "multiplayer" && roomSession.room && roomSession.gameState && roomSession.playerId && (
                    <NetworkGameView state={roomSession.gameState} room={roomSession.room}
                        alwaysShowJoystick={alwaysShowJoystick}
                        audioEnabled={audioEnabled}
                        sfxVolume={sfxVolume}
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
    alwaysShowJoystick: boolean;
    audioEnabled: boolean;
    largeControls: boolean;
    musicVolume: number;
    sfxVolume: number;
    tutorialEnabled: boolean;
    tutorialRecommendationDismissed: boolean;
    onAlwaysShowJoystickChange: (enabled: boolean) => void;
    onAudioEnabledChange: (enabled: boolean) => void;
    onLargeControlsChange: (enabled: boolean) => void;
    onMusicVolumeChange: (volume: number) => void;
    onSfxVolumeChange: (volume: number) => void;
    onTutorialEnabledChange: (enabled: boolean) => void;
    onTutorialRecommendationDismiss: () => void;
    onBotGame: (playerLimit: PlayerLimit) => void;
    onCreateRoom: () => void;
    onJoinRoom: () => void;
    gameAddress: string;
    roomServerAddress: string;
    localAddressOnly: boolean;
}

export function MainMenu({
    alwaysShowJoystick,
    audioEnabled,
    largeControls,
    musicVolume,
    sfxVolume,
    tutorialEnabled,
    tutorialRecommendationDismissed,
    onAlwaysShowJoystickChange,
    onAudioEnabledChange,
    onLargeControlsChange,
    onMusicVolumeChange,
    onSfxVolumeChange,
    onTutorialEnabledChange,
    onTutorialRecommendationDismiss,
    onBotGame,
    onCreateRoom,
    onJoinRoom,
    gameAddress,
    roomServerAddress,
    localAddressOnly,
}: MainMenuProps) {
    const [offlineOptionsOpen, setOfflineOptionsOpen] = useState(false);

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

            {!tutorialRecommendationDismissed && (
                <div className="setting-card setting-card--tutorial setting-card--recommendation">
                    <label className="setting-card__recommendation-toggle">
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
                    <button
                        className="setting-card__dismiss"
                        type="button"
                        aria-label="Dismiss guided setup recommendation"
                        onClick={onTutorialRecommendationDismiss}
                    >
                        ×
                    </button>
                </div>
            )}

            <div className="menu-actions">
                <button
                    className="button button--primary"
                    type="button"
                    aria-expanded={offlineOptionsOpen}
                    aria-controls="offline-player-options"
                    onClick={() => setOfflineOptionsOpen((open) => !open)}
                >
                    <span>Play Offline</span>
                </button>
                {offlineOptionsOpen && <OfflineBotChoices onBotGame={onBotGame} />}
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
                {tutorialRecommendationDismissed && (
                    <label className="setting-card">
                        <span className="setting-card__copy">
                            <strong>Guided setup</strong>
                            <small>Show the first-match movement and objective guide</small>
                        </span>
                        <input
                            type="checkbox"
                            checked={tutorialEnabled}
                            onChange={(event) => onTutorialEnabledChange(event.target.checked)}
                        />
                        <span className="switch" aria-hidden="true" />
                    </label>
                )}
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
                        <strong>Always show joystick</strong>
                        <small>Keep the mobile movement control visible on screen</small>
                    </span>
                    <input
                        type="checkbox"
                        checked={alwaysShowJoystick}
                        onChange={(event) => onAlwaysShowJoystickChange(event.target.checked)}
                    />
                    <span className="switch" aria-hidden="true" />
                </label>

                <label className="setting-card">
                    <span className="setting-card__copy">
                        <strong>Audio</strong>
                        <small>Master switch for music and sound effects</small>
                    </span>
                    <input
                        type="checkbox"
                        checked={audioEnabled}
                        onChange={(event) => onAudioEnabledChange(event.target.checked)}
                    />
                    <span className="switch" aria-hidden="true" />
                </label>

                <VolumeControl
                    id="music-volume"
                    label="Music volume"
                    description="Ambient score and match music"
                    value={musicVolume}
                    onChange={onMusicVolumeChange}
                />

                <VolumeControl
                    id="sfx-volume"
                    label="SFX volume"
                    description="Footsteps, movement, tethers, and world effects"
                    value={sfxVolume}
                    onChange={onSfxVolumeChange}
                />
            </div>

            <footer className="credits">Created by <span>Ricardo Guerrero</span></footer>
        </div>
    );
}

function VolumeControl({
    id,
    label,
    description,
    value,
    onChange,
}: {
    id: string;
    label: string;
    description: string;
    value: number;
    onChange: (volume: number) => void;
}) {
    const percent = Math.round(normalizeAudioVolume(value) * 100);
    return (
        <label className="volume-card" htmlFor={id}>
            <span className="volume-card__header">
                <span className="setting-card__copy">
                    <strong>{label}</strong>
                    <small>{description}</small>
                </span>
                <output htmlFor={id}>{percent}%</output>
            </span>
            <input
                id={id}
                type="range"
                min="0"
                max="100"
                step="5"
                value={percent}
                aria-label={label}
                aria-valuetext={`${percent}%`}
                onChange={(event) => onChange(Number(event.target.value) / 100)}
            />
        </label>
    );
}

export function OfflineBotChoices({
    onBotGame,
}: {
    onBotGame: (playerLimit: PlayerLimit) => void;
}) {
    return (
        <div
            className="offline-player-options"
            id="offline-player-options"
            role="group"
            aria-label="Offline player count"
        >
            <button className="button button--secondary" onClick={() => onBotGame(2)}>
                2-player bot match
            </button>
            <button className="button button--secondary" onClick={() => onBotGame(3)}>
                3-player bot match
            </button>
            <button className="button button--secondary" onClick={() => onBotGame(4)}>
                4-player bot match
            </button>
        </div>
    );
}
