import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { GameState, PlayerId } from "../types";
import type { VideoMode } from "../preferences/video";
import { ArenaRenderer } from "./ArenaRenderer";

export const POST_MATCH_RESULTS_HOLD_MS = 1_000;

interface PostMatchSceneProps {
  state: GameState;
  localPlayerId: PlayerId;
  videoMode?: VideoMode;
  children: ReactNode;
}

export function PostMatchScene({
  state,
  localPlayerId,
  videoMode = "quality",
  children,
}: PostMatchSceneProps) {
  const [overviewSettled, setOverviewSettled] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const settleOverview = useCallback(() => setOverviewSettled(true), []);
  const ignoreMovement = useCallback(() => undefined, []);

  useEffect(() => {
    if (!overviewSettled) return;

    const timerId = window.setTimeout(
      () => setShowResults(true),
      POST_MATCH_RESULTS_HOLD_MS,
    );
    return () => window.clearTimeout(timerId);
  }, [overviewSettled]);

  useEffect(() => {
    if (!showResults) return;

    const frameId = window.requestAnimationFrame(() => {
      dialogRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [showResults]);

  return (
    <div
      className="screen screen--game screen--post-match"
      data-video-mode={videoMode}
    >
      <div className="post-match-map" aria-label="Final map overview">
        <ArenaRenderer
          state={state}
          localPlayerId={localPlayerId}
          videoMode={videoMode}
          disabled
          cameraMode="overview"
          onOverviewSettled={settleOverview}
          onMovementCommand={ignoreMovement}
        />
        <div className="post-match-map__shade" aria-hidden="true" />
      </div>

      {showResults && (
        <div className="match-result-overlay">
          <div
            ref={dialogRef}
            className="match-result-popup"
            role="dialog"
            aria-modal="true"
            aria-label="Match results"
            tabIndex={-1}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
