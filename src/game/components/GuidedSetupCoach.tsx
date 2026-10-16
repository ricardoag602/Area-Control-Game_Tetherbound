import {
  GUIDED_SETUP_MATERIAL_GOAL,
  type TutorialStepId,
} from "../tutorial/guidedSetup";

interface GuidedSetupCoachProps {
  step: TutorialStepId;
  completedStepIds: readonly TutorialStepId[];
  materialsCollected: number;
  materialsAvailable?: number;
  targetAvailable?: boolean;
}

interface StepPresentation {
  id: TutorialStepId;
  label: string;
  title: string;
  instruction: string;
  touchHint: string;
  keyboardHint: string;
}

export const GUIDED_SETUP_PRESENTATIONS: readonly StepPresentation[] = [
  {
    id: "move",
    label: "Move",
    title: "Move into the frontier",
    instruction: "Travel a few steps away from your starting point.",
    touchHint: "Drag anywhere",
    keyboardHint: "W/S move · A/D turn",
  },
  {
    id: "boost",
    label: "Burst",
    title: "Launch a charged burst",
    instruction: "Build power, then release to rocket forward.",
    touchHint: "Tap · hold nearby · release",
    keyboardHint: "Tap W/S · hold again · release",
  },
  {
    id: "deploy",
    label: "Tether",
    title: "Plant your first tether",
    instruction: "Cyan zones restore oxygen and claim scoring territory.",
    touchHint: "Tap the glowing Deploy control",
    keyboardHint: "Press T",
  },
  {
    id: "salvage",
    label: "Collect 3",
    title: "Collect 3 gold materials",
    instruction: "Follow the gold markers until all 3 recipe slots are filled.",
    touchHint: "Drag toward the gold signal",
    keyboardHint: "Drive over the gold signal",
  },
  {
    id: "bank",
    label: "Convert",
    title: "Convert material into a tether",
    instruction: "Bring all 3 materials back to your powered cyan tether anchor. They automatically become a new tether.",
    touchHint: "Follow the cyan anchor marker",
    keyboardHint: "Return to your cyan tether anchor",
  },
  {
    id: "break",
    label: "Disrupt",
    title: "Break an enemy tether",
    instruction: "Stay beside the marked powered tether until its ring closes and the enemy network goes dark.",
    touchHint: "Hold position beside the marked tether",
    keyboardHint: "Drive beside it and hold position",
  },
] as const;

export function GuidedSetupCoach({
  step,
  completedStepIds,
  materialsCollected,
  materialsAvailable = materialsCollected,
  targetAvailable = true,
}: GuidedSetupCoachProps) {
  const currentIndex = GUIDED_SETUP_PRESENTATIONS.findIndex(
    (presentation) => presentation.id === step,
  );
  const presentation = GUIDED_SETUP_PRESENTATIONS[currentIndex];
  const completed = new Set(completedStepIds);
  const materialProgress = Math.min(
    GUIDED_SETUP_MATERIAL_GOAL,
    Math.max(0, Math.floor(materialsCollected)),
  );
  const availableMaterialProgress = Math.min(
    GUIDED_SETUP_MATERIAL_GOAL,
    Math.max(0, Math.floor(materialsAvailable)),
  );
  const remainingMaterials = GUIDED_SETUP_MATERIAL_GOAL - availableMaterialProgress;
  const needsMoreMaterials = step === "bank" && remainingMaterials > 0;
  const instruction = !targetAvailable && step === "break"
    ? "Waiting for a vulnerable enemy tether. Your earlier progress is saved."
    : !targetAvailable && step === "salvage"
      ? "Waiting for the next gold material signal. Your collection progress is saved."
      : !targetAvailable && needsMoreMaterials
        ? "Waiting for the next gold material signal. Your earlier collection progress is saved."
        : !targetAvailable && step === "bank"
          ? "Waiting for one of your tether anchors to reconnect. Your materials are saved."
          : needsMoreMaterials
            ? `Collect ${remainingMaterials} more gold ${remainingMaterials === 1 ? "material" : "materials"}, then return to your tether anchor.`
            : presentation.instruction;
  const waitingForTarget = !targetAvailable &&
    (step === "salvage" || step === "bank" || step === "break");

  return (
    <aside
      className="guided-setup"
      data-step={step}
    >
      <div className="guided-setup__card" key={step}>
        <div className="guided-setup__glyph" aria-hidden="true">
          <TutorialGlyph step={step} />
        </div>

        <div
          className="guided-setup__content"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="guided-setup__heading">
            <span>First-match guide</span>
            <strong>{currentIndex + 1}/{GUIDED_SETUP_PRESENTATIONS.length}</strong>
          </div>
          <h2>{presentation.title}</h2>
          <p>{instruction}</p>
          {step === "salvage" && (
            <div
              className="guided-setup__material-progress"
              role="progressbar"
              aria-label="Gold materials collected"
              aria-valuemin={0}
              aria-valuemax={GUIDED_SETUP_MATERIAL_GOAL}
              aria-valuenow={materialProgress}
            >
              <span className="guided-setup__material-slots" aria-hidden="true">
                {Array.from({ length: GUIDED_SETUP_MATERIAL_GOAL }, (_, index) => (
                  <i
                    className={index < materialProgress ? "is-filled" : ""}
                    key={index}
                  />
                ))}
              </span>
              <strong>{materialProgress} / {GUIDED_SETUP_MATERIAL_GOAL}</strong>
            </div>
          )}
          {step === "bank" && (
            <div
              className="guided-setup__conversion"
              aria-label={`${availableMaterialProgress} of ${GUIDED_SETUP_MATERIAL_GOAL} materials ready; ${GUIDED_SETUP_MATERIAL_GOAL} materials convert into 1 tether`}
            >
              <span className="guided-setup__material-slots" aria-hidden="true">
                {Array.from({ length: GUIDED_SETUP_MATERIAL_GOAL }, (_, index) => (
                  <i
                    className={index < availableMaterialProgress ? "is-filled" : ""}
                    key={index}
                  />
                ))}
              </span>
              <b aria-hidden="true">→</b>
              <span className="guided-setup__conversion-spool" aria-hidden="true" />
              <strong>1 tether</strong>
            </div>
          )}
          <div className="guided-setup__controls">
            <span className="guided-setup__touch-hint">
              <i aria-hidden="true" />
              {waitingForTarget
                ? "Target marker appears automatically"
                : needsMoreMaterials
                  ? "Follow the gold material marker"
                  : presentation.touchHint}
            </span>
            <span className="guided-setup__keyboard-hint">
              <kbd aria-hidden="true">⌨</kbd>
              {waitingForTarget
                ? "Keep moving while you wait"
                : needsMoreMaterials
                  ? "Collect enough material for the recipe"
                  : presentation.keyboardHint}
            </span>
          </div>
        </div>
      </div>

      <ol className="guided-setup__progress" aria-label="Guided setup progress">
        {GUIDED_SETUP_PRESENTATIONS.map((item, index) => {
          const isComplete = completed.has(item.id);
          const isCurrent = item.id === step;
          return (
            <li
              key={item.id}
              className={`${isComplete ? "is-complete" : ""}${isCurrent ? " is-current" : ""}`}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span aria-hidden="true">{isComplete ? "✓" : index + 1}</span>
              <small>{item.label}</small>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

export function GuidedSetupObjectiveReminder() {
  return (
    <aside className="guided-setup guided-setup--objective">
      <div className="guided-setup__card">
        <div className="guided-setup__glyph" aria-hidden="true">
          <svg viewBox="0 0 64 64">
            <path d="M12 49 24 37l9 7 19-24" />
            <path d="M39 20h13v13" />
            <circle cx="12" cy="49" r="5" />
            <circle cx="24" cy="37" r="5" />
            <circle cx="33" cy="44" r="5" />
          </svg>
        </div>

        <div
          className="guided-setup__content"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="guided-setup__heading">
            <span>Training complete</span>
            <strong>Mission live</strong>
          </div>
          <h2>Claim the frontier</h2>
          <p>
            Spread your tether network to cover more territory and rack up signal
            points. When the clock hits zero, the highest score wins.
          </p>
        </div>
      </div>
    </aside>
  );
}

function TutorialGlyph({ step }: { step: TutorialStepId }) {
  if (step === "move") {
    return (
      <svg viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="9" />
        <path d="M32 3v17M32 3l-6 7M32 3l6 7M32 61V44M32 61l-6-7M32 61l6-7M3 32h17M3 32l7-6M3 32l7 6M61 32H44M61 32l-7-6M61 32l-7 6" />
      </svg>
    );
  }
  if (step === "boost") {
    return (
      <svg viewBox="0 0 64 64">
        <path d="M32 5c9 9 14 18 14 29 0 9-6 18-14 25-8-7-14-16-14-25C18 23 23 14 32 5Z" />
        <path d="M32 19c4 6 6 11 6 16 0 5-2 9-6 13-4-4-6-8-6-13 0-5 2-10 6-16Z" />
        <path d="M13 44 6 56l14-5M51 44l7 12-14-5" />
      </svg>
    );
  }
  if (step === "deploy") {
    return (
      <svg viewBox="0 0 64 64">
        <circle cx="14" cy="42" r="7" />
        <circle cx="50" cy="22" r="9" />
        <path d="m20 39 22-13" />
        <path d="M50 13V5M59 22h-8M50 31v8M41 22h-8" />
      </svg>
    );
  }
  if (step === "salvage") {
    return (
      <svg viewBox="0 0 64 64">
        <path d="m32 7 20 20-20 30L12 27 32 7Z" />
        <path d="m12 27 20 8 20-8M32 7v28M32 35v22" />
      </svg>
    );
  }
  if (step === "bank") {
    return (
      <svg viewBox="0 0 64 64">
        <circle cx="18" cy="32" r="11" />
        <circle cx="49" cy="32" r="7" />
        <path d="M29 32h13M36 26l6 6-6 6" />
        <path d="m18 24 8 8-8 8-8-8 8-8Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64">
      <path d="M7 20h13l10 12-10 12H7M57 20H44L34 32l10 12h13" />
      <path d="m28 10 3 9M36 45l3 9M26 49l-4 7M39 8l-4 8" />
    </svg>
  );
}
