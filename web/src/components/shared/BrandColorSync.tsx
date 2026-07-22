/**
 * Applies the signed-in user's chosen brand color to the app's `--brand` accent
 * CSS variable at runtime. `--brand` drives every accent in the theme (buttons,
 * charts, highlights), so overriding it here re-themes the whole app.
 *
 * The value comes from the cached ["get-me"] user, which profile edits update
 * optimistically, so changing the brand color in Settings recolors the app
 * immediately. Clearing it (null) removes the override and falls back to the
 * default purple defined in globals.css (which keeps its light/dark variants).
 */

import { useEffect } from "react";
import { useGetMe } from "@/hooks/useUserQuery";

const BrandColorSync = () => {
  const { data: user } = useGetMe();
  const brandColor = user?.brandColor ?? null;

  useEffect(() => {
    const root = document.documentElement;
    // Inline style on <html> wins over the :root / .dark stylesheet rules, so a
    // single chosen color applies in both themes; removing it restores them.
    if (brandColor) {
      root.style.setProperty("--brand", brandColor);
    } else {
      root.style.removeProperty("--brand");
    }
  }, [brandColor]);

  return null;
};

export default BrandColorSync;
