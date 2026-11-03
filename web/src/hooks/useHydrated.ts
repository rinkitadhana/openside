import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False while rendering on the server and during hydration of prerendered
 * HTML, true afterwards. Lets browser-only UI match the server's first pass.
 */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
