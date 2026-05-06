import { useEffect, useMemo, useState } from "react";
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

  useEffect(() => {
    if (reactions.length === 0) return;

    const latestReaction = reactions[reactions.length - 1];

    setVisibleReactions((currentReactions) => {
      const xPercent =
        Math.random() * (MAX_X_PERCENT - MIN_X_PERCENT) + MIN_X_PERCENT;
      const nextReactions = [
        ...currentReactions,
        {
          id: latestReaction.id,
          emoji: latestReaction.emoji,
          senderName: latestReaction.senderName,
          isLocal: latestReaction.isLocal,
          xPercent,
        },
      ];

      if (nextReactions.length <= MAX_VISIBLE_REACTIONS) {
        return nextReactions;
      }

      return nextReactions.slice(nextReactions.length - MAX_VISIBLE_REACTIONS);
    });

    const timeoutId = window.setTimeout(() => {
      setVisibleReactions((currentReactions) =>
        currentReactions.filter((item) => item.id !== latestReaction.id),
      );
    }, FLOAT_DURATION_MS + 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [reactions]);

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
          14% { opacity: 1; transform: translateY(-10px) scale(1); }
          82% { opacity: 1; }
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
