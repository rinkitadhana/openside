import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { BiSolidLike } from "react-icons/bi";
import { FaBookmark, FaHeart } from "react-icons/fa";
import { MdModeComment } from "react-icons/md";

// Reaction icons that drift out from behind the left and right edges of the
// preview box, float upward and fade away - the "gaining traction" effect.
// Each loops on its own timing so the stream feels organic.
type Reaction = {
  icon: React.ReactNode;
  color: string;
  side: "left" | "right";
  top: string;
  duration: number;
  delay: number;
};

const REACTIONS: Reaction[] = [
  {
    icon: <FaHeart className="size-7 text-rose-500" />,
    color: "text-rose-500",
    side: "left",
    top: "50%",
    duration: 8.5,
    delay: 0,
  },
  {
    icon: <BiSolidLike className="size-7 text-sky-500" />,
    color: "text-sky-500",
    side: "left",
    top: "30%",
    duration: 9.4,
    delay: 1.8,
  },
  {
    icon: <FaBookmark className="size-7 text-blue-500" />,
    color: "text-blue-500",
    side: "left",
    top: "66%",
    duration: 9.1,
    delay: 3.1,
  },
  {
    icon: <MdModeComment className="size-7 text-emerald-500" />,
    color: "text-emerald-500",
    side: "right",
    top: "44%",
    duration: 8.7,
    delay: 0.9,
  },
  {
    icon: <BiSolidLike className="size-7 text-sky-500" />,
    color: "text-sky-500",
    side: "right",
    top: "26%",
    duration: 9.8,
    delay: 2.4,
  },
  {
    icon: <FaHeart className="size-7 text-rose-500" />,
    color: "text-rose-500",
    side: "right",
    top: "62%",
    duration: 8.1,
    delay: 3.6,
  },
];

const randomCount = () => Math.floor(Math.random() * 9) + 1;

const RisingReaction = ({ reaction }: { reaction: Reaction }) => {
  const dir = reaction.side === "left" ? -1 : 1;
  // Re-roll the number each loop so it reads like a fresh, climbing count.
  const [count, setCount] = useState(randomCount);
  // Ensures the re-roll happens exactly once per cycle (while hidden) instead
  // of firing on every frame the icon is faded out.
  const rolledRef = useRef(false);

  return (
    <motion.div
      initial={{ opacity: 0, x: 0, y: 0, scale: 0.5 }}
      animate={{
        // Stays hidden behind the box until it has cleared the edge, fades in
        // as it emerges, then fades fully out before the loop resets - so it's
        // never visible at the spawn point or during the snap back.
        opacity: [0, 0, 1, 0, 0],
        x: [0, dir * 36, dir * 100, dir * 145, dir * 170],
        y: [0, -55, -150, -221, -260],
        scale: [0.5, 0.85, 1, 1, 1],
      }}
      transition={{
        duration: reaction.duration,
        delay: reaction.delay,
        repeat: Infinity,
        ease: "linear",
        times: [0, 0.18, 0.5, 0.85, 1],
      }}
      onUpdate={(latest) => {
        const opacity = typeof latest.opacity === "number" ? latest.opacity : 1;
        // Re-roll once while the icon is hidden between cycles.
        if (opacity < 0.02) {
          if (!rolledRef.current) {
            rolledRef.current = true;
            setCount((prev) => {
              const next = randomCount();
              return next === prev ? (next % 9) + 1 : next;
            });
          }
        } else if (opacity > 0.5) {
          rolledRef.current = false;
        }
      }}
      style={{
        top: reaction.top,
        [reaction.side]: "2%",
      }}
      className="absolute flex items-center gap-1 drop-shadow-[0_2px_6px_rgba(0,0,0,0.25)]"
    >
      {reaction.icon}
      <span className={`text-sm font-bold ${reaction.color}`}>+{count}</span>
    </motion.div>
  );
};

const FloatingStats = () => {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-visible">
      {REACTIONS.map((reaction, index) => (
        <RisingReaction key={index} reaction={reaction} />
      ))}
    </div>
  );
};

export default FloatingStats;
