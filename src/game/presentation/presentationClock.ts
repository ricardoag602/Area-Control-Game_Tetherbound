export interface PresentationFrame {
  readonly timeMs: number;
  readonly deltaMs: number;
  readonly deltaSeconds: number;
}

export type PresentationFrameCallback = (frame: PresentationFrame) => void;

export const PRESENTATION_FRAME_PRIORITY = {
  positions: 100,
  camera: 200,
  scene: 300,
  overlay: 400,
} as const;

interface PresentationFrameScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(requestId: number): void;
}

interface PresentationSubscription {
  readonly callback: PresentationFrameCallback;
  readonly priority: number;
  readonly sequence: number;
}

/**
 * One deterministic requestAnimationFrame source for the complete presentation.
 * Subscribers run by priority, then registration order. A snapshot is used for
 * each frame so subscribing or unsubscribing inside a callback only affects the
 * following frame.
 */
export function createPresentationClock(
  scheduler: PresentationFrameScheduler = browserFrameScheduler(),
) {
  const subscriptions = new Map<number, PresentationSubscription>();
  let nextSubscriptionId = 1;
  let nextSequence = 1;
  let requestId: number | null = null;
  let previousTimeMs: number | null = null;
  let orderedSubscriptions: Array<[number, PresentationSubscription]> = [];
  let subscriptionOrderDirty = true;

  const requestNextFrame = () => {
    if (requestId !== null || subscriptions.size === 0) return;
    requestId = scheduler.request(runFrame);
  };

  const runFrame = (timeMs: number) => {
    requestId = null;
    const safeTimeMs = Number.isFinite(timeMs)
      ? Math.max(previousTimeMs ?? timeMs, timeMs)
      : previousTimeMs ?? 0;
    const deltaMs = previousTimeMs === null
      ? 0
      : Math.max(0, safeTimeMs - previousTimeMs);
    previousTimeMs = safeTimeMs;
    const frame = {
      timeMs: safeTimeMs,
      deltaMs,
      deltaSeconds: deltaMs / 1_000,
    } satisfies PresentationFrame;
    if (subscriptionOrderDirty) {
      orderedSubscriptions = [...subscriptions.entries()].sort(
        ([, left], [, right]) =>
          left.priority - right.priority || left.sequence - right.sequence,
      );
      subscriptionOrderDirty = false;
    }
    const ordered = orderedSubscriptions;

    try {
      for (const [subscriptionId, subscription] of ordered) {
        if (!subscriptions.has(subscriptionId)) continue;
        try {
          subscription.callback(frame);
        } catch (error) {
          // A broken visual layer must not stop the shared clock for every
          // other renderer. Surface the failure without losing the next frame.
          console.error("Presentation frame subscriber failed", error);
        }
      }
    } finally {
      requestNextFrame();
    }
  };

  return {
    subscribe(
      callback: PresentationFrameCallback,
      priority: number = PRESENTATION_FRAME_PRIORITY.scene,
    ) {
      const subscriptionId = nextSubscriptionId;
      nextSubscriptionId += 1;
      subscriptions.set(subscriptionId, {
        callback,
        priority: Number.isFinite(priority) ? priority : 0,
        sequence: nextSequence,
      });
      subscriptionOrderDirty = true;
      nextSequence += 1;
      requestNextFrame();

      let active = true;
      return () => {
        if (!active) return;
        active = false;
        subscriptions.delete(subscriptionId);
        subscriptionOrderDirty = true;
        if (subscriptions.size === 0) {
          if (requestId !== null) scheduler.cancel(requestId);
          requestId = null;
          previousTimeMs = null;
          orderedSubscriptions = [];
        }
      };
    },
  };
}

export const presentationClock = createPresentationClock();

export function subscribePresentationFrame(
  callback: PresentationFrameCallback,
  priority: number = PRESENTATION_FRAME_PRIORITY.scene,
) {
  return presentationClock.subscribe(callback, priority);
}

function browserFrameScheduler(): PresentationFrameScheduler {
  return {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (requestId) => cancelAnimationFrame(requestId),
  };
}
