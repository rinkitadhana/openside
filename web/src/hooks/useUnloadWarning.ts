/**
 * HOOK: useUnloadWarning
 *
 * Native "Leave site?" confirmation while `active` - guarding a live capture
 * against a closed/reloaded tab.
 *
 * WHY: the recorder runs inside this page. Closing, reloading, or navigating
 * the tab away tears down MediaRecorder and fires mediaTracker's `pagehide`
 * handler, which stops every track - the take just ends. Chunks are persisted
 * and uploaded every few seconds, so footage up to the last chunk survives,
 * but the tail and a clean stop do not. This makes that irreversible click ask
 * first.
 *
 * The browser owns the dialog: custom text is ignored everywhere, and Chrome
 * only shows it at all once the user has interacted with the page (always true
 * here - a recording begins with a click).
 */

import { useEffect } from "react";

export default function useUnloadWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers only raise the prompt for a non-empty returnValue.
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}
