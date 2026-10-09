export interface KeyboardShortcutState {
  code: string;
  repeat: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
}

/** A physical T press, without a browser/editor modifier chord. */
export function isDeployShortcut(event: KeyboardShortcutState) {
  return event.code === "KeyT" &&
    !event.repeat &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.isComposing;
}
