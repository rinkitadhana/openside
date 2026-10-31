// Copy and data shared by the marketing pages.

import {
  Briefcase,
  Bug,
  Code2,
  EyeOff,
  Headphones,
  KeyRound,
  Layers,
  Lock,
  MessageSquareQuote,
  MessagesSquare,
  Mic,
  Monitor,
  Podcast,
  Presentation,
  Server,
  Share2,
  ShieldCheck,
  UploadCloud,
  Users,
} from "lucide-react";

export const features = [
  {
    icon: Mic,
    title: "High-quality local recording",
    description:
      "Recording happens locally in your browser, so bad internet never lowers quality. If your connection drops, the file uploads later.",
  },
  {
    icon: Layers,
    title: "Tracks, downloads, and backup",
    description:
      "You get separate audio and video files for each person. Download them as MP4, MP3, or WAV, and turn on cloud backup.",
  },
  {
    icon: Monitor,
    title: "Screen recorder",
    description:
      "A Loom-like way to record quick demos, tutorials, and updates. Capture what you need, then share it with a single link.",
  },
  {
    icon: Share2,
    title: "Share links and comments",
    description:
      "Send each recording with its own link. People can leave comments on it, and you can disable or replace that link any time you want.",
  },
];

export const useCases = [
  {
    icon: Podcast,
    title: "Podcasts",
    description:
      "Multi-host remote podcasts with a separate, studio-quality track for every guest.",
    image: "/img/landing/usecase-podcasts.jpg",
  },
  {
    icon: MessagesSquare,
    title: "Interviews",
    description:
      "Video interviews and panel discussions, recorded locally so a bad connection never ruins the take.",
    image: "/img/landing/usecase-interviews.jpg",
  },
  {
    icon: MessageSquareQuote,
    title: "Testimonials",
    description:
      "Record high-quality testimonials from your users. They join from a link, and every take is captured locally in full quality.",
    image: "/img/landing/usecase-testimonials.jpg",
  },
  {
    icon: Presentation,
    title: "Product demos & tutorials",
    description:
      "Loom-style screen recordings for walkthroughs, onboarding, and course content.",
    image: "/img/landing/usecase-demos.jpg",
  },
  {
    icon: Briefcase,
    title: "Client & consulting calls",
    description:
      "Record sessions with clients or stakeholders and share a private link when it's ready.",
    image: "/img/landing/usecase-client-calls.jpg",
  },
  {
    icon: Bug,
    title: "Bug reports & async updates",
    description:
      "A quick screen recording that replaces a status meeting or a hard-to-explain bug.",
    image: "/img/landing/usecase-bug-reports.jpg",
  },
  {
    icon: Users,
    title: "Team meetings",
    description:
      "Keep a record of standups and all-hands, with separate tracks if you need to review who said what.",
    image: "/img/landing/usecase-team-meetings.jpg",
  },
  {
    icon: Headphones,
    title: "Voiceover & audio-only",
    description:
      "Just need audio? Record clean, uncompressed WAV or MP3 without touching video.",
    image: "/img/landing/usecase-voiceover.jpg",
  },
];

export const faqs = [
  {
    question: "Is Openside free to use?",
    answer:
      "Openside is open source and free to self-host. Bring your own LiveKit and Cloudflare R2 storage and pay only for the infrastructure you use; managed demo and paid plans are also available.",
  },
  {
    question: "How does Openside work?",
    answer:
      "Create a recording space, invite participants with a link, and record from your browsers. When you finish, Openside processes the files into a mixed recording and separate participant tracks that you can download or share.",
  },
  {
    question: "What happens if someone's internet connection is unstable?",
    answer:
      "Openside records each person's audio and video in their browser, rather than relying on a compressed live stream. A brief connection drop will not lower the quality of footage already captured; it uploads when the connection returns.",
  },
  {
    question: "Will I get separate tracks for every participant?",
    answer:
      "Yes. Multi-person recordings include separate audio and video tracks for each participant, alongside a mixed recording for quick review and sharing.",
  },
  {
    question: "Can I download and share my recordings?",
    answer:
      "Yes. Download video as MP4 or WebM and audio as MP3 or WAV. You can also create a share link so viewers can watch the recording in their browser, then disable or replace that link whenever you need to.",
  },
];

export const recordingPoints = [
  {
    icon: Lock,
    title: "Recorded on your device",
    description:
      "Your audio and video are captured right in your browser and saved in small chunks as you record.",
  },
  {
    icon: UploadCloud,
    title: "Sent straight to storage",
    description:
      "Each chunk uploads directly to storage over an encrypted connection, instead of streaming through our servers.",
  },
  {
    icon: Share2,
    title: "Private until you share",
    description:
      "Recordings are private by default. You create a share link only when you want to, and can switch it off anytime.",
  },
  {
    icon: ShieldCheck,
    title: "Delete whenever you want",
    description:
      "Remove any recording at any time. It's gone from storage, not just hidden from view.",
  },
];

export const selfHostPoints = [
  {
    icon: Server,
    title: "Run it on your own infra",
    description:
      "Connect your own LiveKit and R2 to keep recordings on your infrastructure.",
  },
  {
    icon: KeyRound,
    title: "Your keys are encrypted",
    description:
      "The API keys you add are encrypted with AES-256-GCM before they're stored, so they're never saved in plain text.",
  },
  {
    icon: EyeOff,
    title: "Keys are never read back",
    description:
      "Once saved, your keys are masked everywhere. The app only ever shows you a hidden preview, never the full value.",
  },
  {
    icon: Code2,
    title: "Open source and auditable",
    description:
      "Every line of Openside is public, so you can check for yourself exactly how your data and keys are handled.",
  },
];

export const pricingPlans = [
  {
    name: "Demo",
    price: "Free",
    priceSuffix: "",
    description: "Try Openside instantly, no keys or setup required.",
    features: [
      "720p recording",
      "44.1kHz audio",
      "15 minutes of recording",
      "Up to 2 participants",
      "48-hour retention",
      "Includes watermark",
      "Separate participant tracks",
      "Screen recorder",
      "No setup required",
    ],
    cta: "Try the demo",
    featured: false,
  },
  {
    name: "Pro",
    price: "$8.99",
    priceSuffix: "/mo",
    description:
      "Managed infrastructure with zero setup. Just hit record and we handle the rest.",
    features: [
      "Up to 4K recording",
      "48kHz audio",
      "20 hours of recording per month",
      "Up to 5 participants",
      "30-day recording retention",
      "No watermark",
      "Separate participant tracks",
      "Cloud backup",
      "Screen recorder",
    ],
    cta: "Start with Pro",
    featured: true,
  },
  {
    name: "Self-host",
    price: "Free",
    priceSuffix: "",
    description:
      "Unlimited and free when you run it on your own LiveKit and R2 keys.",
    features: [
      "Up to 4K recording",
      "48kHz audio",
      "Unlimited recording",
      "Unlimited participants",
      "Unlimited retention",
      "No watermark",
      "Separate participant tracks",
      "Cloud backup",
      "Screen recorder",
    ],
    cta: "Get started",
    featured: false,
  },
];

export const sponsorUrl = "https://github.com/sponsors/rinkitadhana";

// Add sponsors here as they come in; the section shows an empty state until
// then. `avatar` is a company logo or a person's photo; without one the card
// shows initials. Example:
// { name: "Jane Doe", amount: 10, interval: "month", since: "Nov 2026",
//   message: "Keep it up!", socials: { x: "https://x.com/jane" } }
export const sponsors: {
  name: string;
  amount: number;
  interval: "month" | "once";
  // When they started sponsoring, or when they gave if one-time.
  since: string;
  message?: string;
  avatar?: string;
  socials?: {
    website?: string;
    x?: string;
    github?: string;
    linkedin?: string;
  };
}[] = [];

export type UseCase = (typeof useCases)[number];
