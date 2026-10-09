import { useEffect, useRef } from "react";
import { isGameplayKeyboardBlockedTarget } from "./keyboardMovement";
import { isDeployShortcut } from "./keyboardShortcuts";

interface DeployShortcutOptions {
  disabled: boolean;
  onDeploy: () => void;
}

/** Keeps the T tether shortcut active anywhere in the current match UI. */
export function useDeployShortcut({ disabled, onDeploy }: DeployShortcutOptions) {
  const disabledRef = useRef(disabled);
  const deployRef = useRef(onDeploy);
  disabledRef.current = disabled;
  deployRef.current = onDeploy;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        disabledRef.current ||
        !isDeployShortcut(event) ||
        isGameplayKeyboardBlockedTarget(event.target)
      ) return;

      event.preventDefault();
      deployRef.current();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
