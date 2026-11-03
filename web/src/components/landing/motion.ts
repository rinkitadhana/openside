// Shared framer-motion presets for the marketing pages.

// Snappy easeOutExpo curve so things decelerate cleanly instead of drifting.
export const EASE = [0.16, 1, 0.3, 1] as const;

export const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.18, delayChildren: 0.1 },
  },
};

export const riseVariants = {
  hidden: { opacity: 0, y: 18, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 1, ease: EASE },
  },
};
