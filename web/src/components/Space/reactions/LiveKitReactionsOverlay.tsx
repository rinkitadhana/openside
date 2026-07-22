import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveKitReactions } from "./LiveKitReactionsProvider";

interface FloatingReaction {
  id: string;
  emoji: string;
  senderName: string;
  isLocal: boolean;
  xPercent: number;
}

const FLOAT_DURATION_MS = 2600;
const MAX_VISIBLE_REACTIONS = 20;
const LEFT_REACTION_AREA_WIDTH_PX = 420;
const MIN_X_PERCENT = 2;
const MAX_X_PERCENT = 98;

const LiveKitReactionsOverlay = () => {
  const { reactions } = useLiveKitReactions();
  const [visibleReactions, setVisibleReactions] = useState<FloatingReaction[]>(
    [],
  );
  // How many reactions we've already animated - everything after this index
  // is new. Handles several reactions landing in one render (the old
  // "last element only" approach skipped the rest of a batch).
  const processedCountRef = useRef(0);
  // Removal timers must outlive the effect run that created them: cleaning
  // them up on every new reaction (the old behavior) cancelled the PREVIOUS
  // reaction's removal, so finished reactions piled up invisibly in the DOM.
  const removalTimeoutsRef = useRef<number[]>([]);

  useEffect(() => {
    if (reactions.length <= processedCountRef.current) {
      // The provider caps its list, so the length can shrink - resync.
      processedCountRef.current = reactions.length;
      return;
    }

    const newReactions = reactions
      .slice(processedCountRef.current)
      .map((reaction) => ({
        id: reaction.id,
        emoji: reaction.emoji,
        senderName: reaction.senderName,
        isLocal: reaction.isLocal,
        xPercent:
          Math.random() * (MAX_X_PERCENT - MIN_X_PERCENT) + MIN_X_PERCENT,
      }));
    processedCountRef.current = reactions.length;

    setVisibleReactions((currentReactions) => {
      const nextReactions = [...currentReactions, ...newReactions];
      return nextReactions.length <= MAX_VISIBLE_REACTIONS
        ? nextReactions
        : nextReactions.slice(nextReactions.length - MAX_VISIBLE_REACTIONS);
    });

    for (const reaction of newReactions) {
      removalTimeoutsRef.current.push(
        window.setTimeout(() => {
          setVisibleReactions((currentReactions) =>
            currentReactions.filter((item) => item.id !== reaction.id),
          );
        }, FLOAT_DURATION_MS + 250),
      );
    }
  }, [reactions]);

  useEffect(() => {
    const removalTimeouts = removalTimeoutsRef.current;
    return () => {
      removalTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, []);

  const reactionNodes = useMemo(
    () =>
      visibleReactions.map((reaction) => (
        <div
          key={reaction.id}
          className="pointer-events-none absolute bottom-3 z-40"
          style={{
            left: `${reaction.xPercent}%`,
            animation: `reaction-float-up ${FLOAT_DURATION_MS}ms cubic-bezier(0.2, 0.6, 0.2, 1) forwards`,
          }}
        >
          <div className="flex min-w-[72px] flex-col items-center gap-1.5 px-2.5 py-2">
            <span className="text-5xl leading-none">{reaction.emoji}</span>
            <span className="max-w-[120px] truncate rounded-full bg-blue-500/55 px-2.5 py-0.5 text-[0.68rem] font-medium text-white">
              {reaction.isLocal ? "You" : reaction.senderName}
            </span>
          </div>
        </div>
      )),
    [visibleReactions],
  );

  return (
    <>
      <style>
        {`@keyframes reaction-float-up {
          0% { transform: translateY(0) scale(0.85); opacity: 0; }
          50% { transform: translateY(-160px) scale(1); opacity: 1; }
          100% { transform: translateY(-320px) scale(1.1); opacity: 0; }
        }`}
      </style>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full"
          style={{ width: `${LEFT_REACTION_AREA_WIDTH_PX}px` }}
        >
          {reactionNodes}
        </div>
      </div>
    </>
  );
};

export default LiveKitReactionsOverlay;
