import { Clapperboard } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { backdropMotion, panelMotion, usePresence } from "@/hooks/usePresence";
import {
  FiCalendar,
  FiChevronDown,
  FiChevronLeft,
  FiCheck,
  FiEdit2,
  FiEye,
  FiFilter,
  FiFolder,
  FiLoader,
  FiMonitor,
  FiShare2,
  FiTrash2,
  FiVideo,
} from "react-icons/fi";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/shared/ui/dropdown-menu";
import {
  useDeleteSpace,
  useGetSpaceById,
  useGetUserSpaces,
  useRenameSpace,
} from "@/hooks/useSpace";
import {
  useGetOutputsBySpace,
  useInlineOutputUrl,
} from "@/hooks/useFinalOutputs";
import {
  useDeleteRecordingSession,
  useGetRecordingSessionsBySpace,
  useUpdateRecordingSession,
  useShareSpaceRecording,
  useUnshareSpaceRecording,
} from "@/hooks/useRecording";
import { useScreenRecordings } from "@/hooks/useScreenRecordings";
import { useGetMe } from "@/hooks/useUserQuery";
import type { DownloadFormat, FinalOutput } from "@/types/outputTypes";
import type {
  ParticipantRecording,
  RecordingSession,
} from "@/types/recordingTypes";
import OutputCard from "./OutputCard";
import RecordingDescription from "./RecordingDescription";
import ProjectCard from "./ProjectCard";
import ScreenRecordingsSection from "./ScreenRecordingsSection";
import VideoPlayer from "@/components/shared/VideoPlayer";
import InlineTitle, {
  type InlineTitleHandle,
} from "@/components/shared/InlineTitle";
import ShareLinkDialog from "@/components/shared/ShareLinkDialog";
import { toast } from "@/lib/toast";
import { useCommentsRailResizer } from "@/components/shared/CommentsRailResizer";
import { useScreenRecordingContext } from "@/components/ScreenRecorder/ScreenRecordingProvider";

const PROJECTS_PER_PAGE = 8;
const shareUrlFor = (token: string) =>
  `${window.location.origin}/share/${token}`;

const formatDay = (value?: string) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";

const recordingLabel = (count: number) =>
  `${count} recording${count === 1 ? "" : "s"}`;

// "Oct 18, 9:30 PM". Length and quality vary per track, so they're shown on
// each track row, not for the recording as a whole.
const sessionDate = (session: RecordingSession) => {
  const started = new Date(session.startedAt);
  return Number.isNaN(started.getTime())
    ? null
    : started.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
};

const groupOutputVariants = (outputs: FinalOutput[]) => {
  const grouped = outputs.reduce<Record<string, FinalOutput[]>>(
    (acc, output) => {
      const key =
        output.sourceRecordingId ??
        (output.type === "COMPOSITE"
          ? `${output.type}-${output.recordingSessionId}`
          : `${output.type}-${output.variant}-${output.id}`);
      (acc[key] ??= []).push(output);
      return acc;
    },
    {},
  );

  return Object.values(grouped).map((variants) => {
    const primary =
      variants.find((output) => output.variant === "RAW") ??
      variants.find((output) => output.variant === "CLOUD") ??
      variants[0];

    return {
      primary,
      variants: variants.sort((a, b) => {
        const order = { RAW: 0, ALIGNED: 1, CLOUD: 2 };
        return order[a.variant] - order[b.variant];
      }),
    };
  });
};

type TrackRow = {
  primary: FinalOutput;
  aligned?: FinalOutput;
  cloud?: FinalOutput;
};

// Small player above the track list. Plays the selected track's master in its
// NATIVE format (mp4 for CFR-normalized video masters, webm for legacy ones) so
// it's served directly with no transcode - playback is instant either way.
const TrackPlayer = ({ output }: { output: FinalOutput | null }) => {
  const format: DownloadFormat =
    output?.mimeType === "video/mp4" ? "mp4" : "webm";
  const { data: url } = useInlineOutputUrl(output?.id ?? "", format, !!output);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-border/50">
      {!output ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-white/45">
          <FiVideo className="size-6" />
          <span className="text-sm">Select a track to play it here</span>
        </div>
      ) : url ? (
        <VideoPlayer key={url} src={url} />
      ) : (
        <div className="flex h-full items-center justify-center gap-2 text-sm text-white/60">
          <FiLoader className="size-4 animate-spin" /> Loading…
        </div>
      )}
    </div>
  );
};

// Beside a recording's title: Share (green "Shared" once public), Rename and
// Delete, each its own button. Only the host gets them.
const RecordingSessionActions = ({
  shareToken,
  onRename,
  onShare,
  onDelete,
}: {
  shareToken?: string | null;
  /** Starts editing the title in place. */
  onRename?: () => void;
  onShare?: () => void;
  onDelete?: () => void;
}) => {
  if (!onRename && !onShare && !onDelete) return null;
  return (
    <div
      role="group"
      aria-label="Recording actions"
      className="flex shrink-0 items-center gap-1.5"
    >
      {onShare && (
        <button
          type="button"
          onClick={onShare}
          className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-opacity hover:opacity-80 cursor-pointer ${
            shareToken
              ? "bg-success/10 text-success"
              : "bg-muted text-foreground"
          }`}
        >
          <FiShare2 className="size-3.5" />
          {shareToken ? "Shared" : "Share"}
        </button>
      )}
      {onRename && (
        <button
          type="button"
          onClick={onRename}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-medium text-foreground transition-opacity hover:opacity-80 cursor-pointer"
        >
          <FiEdit2 className="size-3.5" />
          Rename
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-danger/10 px-3 text-xs font-medium text-danger transition-colors hover:bg-danger/15 cursor-pointer"
        >
          <FiTrash2 className="size-3.5" />
          Delete
        </button>
      )}
    </div>
  );
};

// Above the player: the recording's title (click to rename) and when it was
// recorded, with its views and the share + options actions on the right.
const RecordingHeader = ({
  title,
  session,
  processing = false,
  onRename,
  ...actions
}: {
  title: string;
  session?: RecordingSession;
  processing?: boolean;
  shareToken?: string | null;
  onShare?: () => void;
  onRename?: (title: string) => void;
  onDelete?: () => void;
}) => {
  const date = session ? sessionDate(session) : null;
  const views = session?.viewCount ?? 0;
  const titleRef = useRef<InlineTitleHandle>(null);
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-1.5">
        <h3 className="text-[0.95rem] font-semibold leading-tight tracking-[-0.01em] text-foreground">
          <InlineTitle
            ref={titleRef}
            value={title}
            onSave={onRename}
            className="truncate"
          />
        </h3>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
          {processing ? (
            <span className="flex items-center gap-1.5 font-medium text-warning">
              <FiLoader className="size-3 animate-spin" />
              Processing…
            </span>
          ) : (
            date && (
              <span className="flex items-center gap-1.5">
                <FiCalendar className="size-3" />
                {date}
              </span>
            )
          )}
        </div>
      </div>
      {/* Views only exist once there's a share link to open. */}
      {session && actions.shareToken && (
        <span className="mr-1 flex h-8 shrink-0 items-center gap-1.5 px-1 text-xs text-fg-muted">
          <FiEye className="size-3.5" />
          {views} {views === 1 ? "view" : "views"}
        </span>
      )}
      <RecordingSessionActions
        {...actions}
        onRename={onRename ? () => titleRef.current?.edit() : undefined}
      />
    </div>
  );
};

const SpaceRecordingShareDialog = ({
  session,
  spaceId,
  onClose,
  isClosing,
}: {
  session: RecordingSession;
  spaceId: string;
  onClose: () => void;
  isClosing: boolean;
}) => {
  const share = useShareSpaceRecording(spaceId);
  const unshare = useUnshareSpaceRecording(spaceId);
  const token = session.shareToken;

  return (
    <ShareLinkDialog
      recordingTitle={session.title ?? undefined}
      url={token ? shareUrlFor(token) : null}
      accessNote="watch and download this recording"
      isStopping={unshare.isPending}
      onCreate={() =>
        share.mutate(session.id, {
          onError: () => {
            toast.error("Couldn't create a share link.");
            onClose();
          },
        })
      }
      onStop={() => unshare.mutate(session.id, { onSuccess: onClose })}
      onClose={onClose}
      isClosing={isClosing}
    />
  );
};

// One recording (a single start→stop run within the meeting): its finished
// track rows, plus tracks still being produced. A take with no rows yet is
// still processing as a whole.
type Take = {
  id: string;
  title: string;
  session?: RecordingSession;
  startedAt: string | null;
  rows: TrackRow[];
  cooking: ParticipantRecording[];
  processing: boolean;
};

// Group a participant's segments together (Part 1 / Part 2 after a refresh),
// each group oldest part first.
const groupRowsByParticipant = (rows: TrackRow[]) => {
  const groups = new Map<string, TrackRow[]>();
  rows.forEach((row, index) => {
    const key =
      row.primary.sourceRecording?.participant?.id ??
      row.primary.targetParticipantId ??
      `solo-${row.primary.sourceRecordingId ?? row.primary.id ?? index}`;
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  });
  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        new Date(a.primary.createdAt).getTime() -
        new Date(b.primary.createdAt).getTime(),
    );
  }
  return [...groups.values()];
};

// Track rows carry a name, stats and a Download button, so their rail starts
// at this width; it can be dragged narrower down to TRACKS_RAIL_MIN_WIDTH.
const TRACKS_RAIL_WIDTH = 560;
const TRACKS_RAIL_MIN_WIDTH = 380;
const TRACKS_RAIL_OPTIONS = {
  storageKey: "openside:tracks-rail-width",
  label: "Resize tracks",
  defaultWidth: TRACKS_RAIL_WIDTH,
  minWidth: TRACKS_RAIL_MIN_WIDTH,
  maxWidth: 900,
};

const TAB_TITLE_MAX = 22;

// Cut at a fixed length and drop trailing spaces, so the "…" sits right
// against the last word ("Weekly sync…", never "Weekly sync …").
const shortTabTitle = (title: string) =>
  title.length > TAB_TITLE_MAX
    ? `${title.slice(0, TAB_TITLE_MAX).trimEnd()}…`
    : title;

// Header tabs above the player for switching between a project's recordings,
// underlined like page tabs. Scrolls sideways when there are many.
const TakeTabs = ({
  takes,
  activeId,
  onSelect,
}: {
  takes: Take[];
  activeId: string;
  onSelect: (id: string) => void;
}) => {
  const stripRef = useRef<HTMLDivElement>(null);

  // Keep the selected tab in view as the selection moves.
  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>(`[data-take="${activeId}"]`)
      ?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
  }, [activeId]);

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label="Recordings"
      className="flex h-12 shrink-0 items-end gap-6 overflow-x-auto border-b border-border scrollbar-hide lg:px-6"
    >
      {takes.map((take) => {
        const active = take.id === activeId;
        const date = take.session ? sessionDate(take.session) : null;
        return (
          <button
            key={take.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-take={take.id}
            onClick={() => onSelect(take.id)}
            title={date ? `${take.title} · ${date}` : take.title}
            className={`relative flex h-full shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors cursor-pointer ${
              active ? "text-blue-500" : "text-fg-muted hover:text-foreground"
            }`}
          >
            {take.processing && <FiLoader className="size-3.5 animate-spin" />}
            {/* Long names end in "…" so the tabs stay tidy; full name on hover. */}
            <span>{shortTabTitle(take.title)}</span>
            {active && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-blue-500" />
            )}
          </button>
        );
      })}
    </div>
  );
};

// A track is still being produced (uploaded/queued/encoding) - i.e. not yet a
// downloadable master and not failed.
const COOKING_STATUSES = new Set(["UPLOADING", "UPLOADED", "PROCESSING"]);
const isCookingTrack = (rec: ParticipantRecording) =>
  !!rec.hasVideo && COOKING_STATUSES.has(rec.status);
const isSessionProcessing = (session: RecordingSession) =>
  session.status !== "ACTIVE" &&
  (session.participantRecordings ?? []).some(isCookingTrack);

// Server exposes no granular finalize progress, so estimate a track's progress
// from elapsed time on an easing curve and snap to done only when it actually
// turns READY. Caps below 100 while cooking so the bar never claims completion
// before the master exists.
const EASE_TAU_MS = 22000;
const estimateTrackProgress = (rec: ParticipantRecording, now: number) => {
  const created = new Date(rec.createdAt).getTime();
  const elapsed = Math.max(0, now - created);
  // Encoding (PROCESSING) is allowed closer to the finish line than a track
  // that's only finished uploading and is still queued.
  const cap = rec.status === "PROCESSING" ? 0.95 : 0.6;
  const eased = 1 - Math.exp(-elapsed / EASE_TAU_MS);
  return Math.round(Math.min(cap, eased) * 100);
};

// Re-render on a fixed interval so time-based progress advances smoothly between
// the query's slower polls.
const useTick = (intervalMs: number) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
};

// One still-processing track: a placeholder thumbnail, the participant's name,
// and a completion bar with a live percentage.
const ProcessingTrackCard = ({
  track,
  index,
}: {
  track: ParticipantRecording;
  index: number;
}) => {
  const now = useTick(1000);
  const failed = track.status === "FAILED";
  // The track's own record says READY but its downloadable row hasn't loaded in
  // the outputs query yet - it's a step away from playable, so show a settled
  // "Finalizing" state rather than a mid-progress bar that looks stuck.
  const finalizing = track.status === "READY";
  const name =
    track.participant?.displayName ||
    track.participant?.user?.name ||
    `Participant ${index + 1}`;
  const avatar = track.participant?.user?.avatar;
  const pct = estimateTrackProgress(track, now);

  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <span className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
        {avatar ? (
          <img src={avatar} alt="" className="h-full w-full object-cover" />
        ) : (
          <FiVideo className="size-4 text-fg-subtle" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        {failed ? (
          <span className="mt-1 inline-block rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
            Failed
          </span>
        ) : finalizing ? (
          <span className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted">
            <FiLoader className="size-3 animate-spin" />
            Finalizing…
          </span>
        ) : (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-foreground/60 transition-[width] duration-1000 ease-linear"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-fg-muted">
              {pct}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

const SpaceOutputs = ({
  outputs,
  sessions,
  canManage,
  initialTakeId,
  onRenameSession,
  onDescribeSession,
  onDeleteSession,
  onShareSession,
}: {
  outputs: FinalOutput[];
  sessions: RecordingSession[];
  canManage: boolean;
  /** Recording to open on first, e.g. from a deep link. */
  initialTakeId?: string | null;
  onRenameSession: (sessionId: string, title: string) => void;
  onDescribeSession: (sessionId: string, description: string) => void;
  onDeleteSession: (sessionId: string, title: string) => void;
  onShareSession: (session: RecordingSession) => void;
}) => {
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(
    initialTakeId ?? null,
  );
  // The chosen track per recording, so switching recordings and back keeps it.
  const [selectedTrackByTake, setSelectedTrackByTake] = useState<
    Record<string, string>
  >({});
  const railResizer = useCommentsRailResizer(TRACKS_RAIL_OPTIONS);

  const participantOutputs = outputs.filter(
    (output) => output.type === "PER_PARTICIPANT",
  );

  // Per-participant cloud recordings (LiveKit egress) are offered as a download
  // option on each track - not shown as their own row. Camera egresses are
  // keyed by participant (no source recording); screen-share egresses are keyed
  // by the screen ParticipantRecording they were started for, so each pairs
  // with its own screen row instead of the camera composite.
  const cloudByParticipant = new Map<string, FinalOutput>();
  const cloudBySourceRecording = new Map<string, FinalOutput>();
  for (const output of participantOutputs) {
    if (output.variant !== "CLOUD") continue;
    if (output.sourceRecordingId) {
      cloudBySourceRecording.set(output.sourceRecordingId, output);
    } else if (
      output.targetParticipantId &&
      !cloudByParticipant.has(output.targetParticipantId)
    ) {
      cloudByParticipant.set(output.targetParticipantId, output);
    }
  }

  // Build one row per participant from the local (browser) recordings. Audio is
  // offered only inside the Download menu; show video tracks, falling back to
  // all local outputs if a session is audio-only.
  const localOutputs = participantOutputs.filter(
    (output) => output.variant !== "CLOUD",
  );
  const videoOutputs = localOutputs.filter((output) => output.hasVideo);
  const trackGroups = groupOutputVariants(
    videoOutputs.length > 0 ? videoOutputs : localOutputs,
  );

  const rows = trackGroups
    .filter((group): group is typeof group & { primary: FinalOutput } =>
      Boolean(group.primary),
    )
    .map(({ primary, variants }) => {
      const participantId =
        primary.sourceRecording?.participant?.id ?? primary.targetParticipantId;
      // The ALIGNED variant only exists for participants who joined late - it
      // carries the black lead-in so tracks line up on an editing timeline.
      const aligned = variants.find((output) => output.variant === "ALIGNED");
      // Screen rows pair with their own screenShare egress; camera rows with
      // the participant's camera egress.
      const cloud = primary.sourceRecording?.isScreenShare
        ? primary.sourceRecordingId
          ? cloudBySourceRecording.get(primary.sourceRecordingId)
          : undefined
        : participantId
          ? cloudByParticipant.get(participantId)
          : undefined;
      return { primary, aligned, cloud };
    });

  // The cloud (egress) backup is a download option on a participant's real
  // track - never its own row. The one exception is a participant who has NO
  // local camera track at all (their browser recording never registered), where
  // the cloud file is the only artifact we can show. Crucially this includes
  // participants whose local track is still processing or failed: they already
  // have a row or a live status card, so adding a cloud row would make a phantom
  // second track flash in during processing and vanish when the local row lands.
  const participantsWithLocalTrack = new Set<string>();
  for (const row of rows) {
    if (row.primary.sourceRecording?.isScreenShare) continue;
    const pid =
      row.primary.sourceRecording?.participant?.id ??
      row.primary.targetParticipantId;
    if (pid) participantsWithLocalTrack.add(pid);
  }
  for (const session of sessions) {
    for (const rec of session.participantRecordings ?? []) {
      if (rec.hasVideo && !rec.isScreenShare) {
        participantsWithLocalTrack.add(rec.participantId);
      }
    }
  }
  for (const [participantId, cloud] of cloudByParticipant) {
    if (!participantsWithLocalTrack.has(participantId)) {
      rows.push({ primary: cloud, aligned: undefined, cloud: undefined });
    }
  }

  // A track stays visible until its OWN output row exists - keyed on row
  // coverage, NEVER on ParticipantRecording status. The sessions poll and the
  // outputs poll are independent, so a track flips READY in the sessions data a
  // beat before its FinalOutput row lands in the outputs data; gating on status
  // made it belong to neither list during that gap and blink out of the UI.
  const rowsCoverRecordingIds = new Set(
    rows
      .map((row) => row.primary.sourceRecordingId)
      .filter((value): value is string => !!value),
  );
  const sessionsWithRows = new Set(
    rows.map((row) => row.primary.recordingSessionId),
  );

  // Per non-active session, the video tracks that don't yet have a row (still
  // uploading, stitching, failed, or just waiting for the outputs poll to catch
  // up). Rendered as live status cards so they never disappear.
  const pendingBySession = new Map<string, ParticipantRecording[]>();
  for (const session of sessions) {
    if (session.status === "ACTIVE") continue;
    const pending = (session.participantRecordings ?? [])
      .filter((rec) => rec.hasVideo && !rowsCoverRecordingIds.has(rec.id))
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    if (pending.length > 0) pendingBySession.set(session.id, pending);
  }

  // Sessions with no row yet: their pending tracks show as a standalone block
  // above the finished recordings. Sessions that already have rows render their
  // remaining pending tracks INSIDE that block (cookingBySession, below).
  const processingBlocks = sessions
    .filter(
      (session) =>
        !sessionsWithRows.has(session.id) && pendingBySession.has(session.id),
    )
    .map((session) => ({
      id: session.id,
      title: session.title || "Recording",
      session,
      startedAt: session.startedAt,
      tracks: pendingBySession.get(session.id) ?? [],
    }));
  const cookingBySession = new Map<string, ParticipantRecording[]>();
  for (const [sessionId, pending] of pendingBySession) {
    if (sessionsWithRows.has(sessionId)) {
      cookingBySession.set(sessionId, pending);
    }
  }

  if (rows.length === 0 && processingBlocks.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-20 text-center">
        <FiVideo className="size-7 text-fg-subtle" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            No finished recordings yet
          </p>
          <p className="text-xs text-fg-subtle">
            Recordings appear here once processing completes.
          </p>
        </div>
      </div>
    );
  }

  // One meeting can be recorded more than once (start → stop → start again).
  // Each run is a take, oldest first, picked from the slider.
  const rowsByTake = new Map<string, TrackRow[]>();
  for (const row of rows) {
    const key = row.primary.recordingSessionId;
    const existing = rowsByTake.get(key);
    if (existing) existing.push(row);
    else rowsByTake.set(key, [row]);
  }
  const takes: Take[] = [
    ...processingBlocks.map((block) => ({
      id: block.id,
      title: block.title,
      session: block.session,
      startedAt: block.startedAt,
      rows: [],
      cooking: block.tracks,
      processing: true,
    })),
    ...[...rowsByTake.entries()].map(([id, takeRows]) => {
      const session = sessions.find((candidate) => candidate.id === id);
      return {
        id,
        title:
          session?.title || takeRows[0]?.primary.recordingSession?.title || "",
        session,
        startedAt:
          session?.startedAt ??
          takeRows[0]?.primary.recordingSession?.startedAt ??
          takeRows[0]?.primary.createdAt ??
          null,
        rows: takeRows,
        cooking: cookingBySession.get(id) ?? [],
        processing: false,
      };
    }),
  ]
    .sort(
      (a, b) =>
        new Date(a.startedAt ?? 0).getTime() -
        new Date(b.startedAt ?? 0).getTime(),
    )
    .map((take, index) => ({
      ...take,
      title: take.title || `Recording ${index + 1}`,
    }));

  // Default to the first take; fall back to it if the chosen one was deleted.
  const activeTake =
    takes.find((take) => take.id === selectedTakeId) ?? takes[0];
  const groupedRows = groupRowsByParticipant(activeTake.rows);
  const playableIds = groupedRows
    .flat()
    .filter((row) => row.primary.status === "READY" && row.primary.hasVideo)
    .map((row) => row.primary.id);
  const chosenTrack = selectedTrackByTake[activeTake.id];
  const activeTrackId =
    chosenTrack && playableIds.includes(chosenTrack)
      ? chosenTrack
      : (playableIds[0] ?? null);
  const activeOutput =
    groupedRows.flat().find((row) => row.primary.id === activeTrackId)
      ?.primary ?? null;

  return (
    <div
      style={railResizer.gridStyle}
      className="relative grid gap-6 px-6 py-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_var(--comments-rail-width)] lg:gap-0 lg:p-0"
    >
      {railResizer.handle}
      <div className="flex min-w-0 flex-col lg:min-h-0 lg:border-r lg:border-border">
        <TakeTabs
          takes={takes}
          activeId={activeTake.id}
          onSelect={setSelectedTakeId}
        />
        <div className="flex flex-col gap-4 pt-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:p-6">
          <RecordingHeader
            title={activeTake.title}
            session={activeTake.session}
            processing={activeTake.processing}
            shareToken={activeTake.session?.shareToken}
            onRename={
              canManage
                ? (next: string) => onRenameSession(activeTake.id, next)
                : undefined
            }
            onDelete={
              canManage
                ? () => onDeleteSession(activeTake.id, activeTake.title)
                : undefined
            }
            onShare={
              canManage && activeTake.session
                ? () => onShareSession(activeTake.session as RecordingSession)
                : undefined
            }
          />
          {activeTake.processing ? (
            <div className="relative flex aspect-video w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl bg-black text-white/60 ring-1 ring-border/50">
              <FiLoader className="size-6 animate-spin" />
              <span className="text-sm">Processing your recording…</span>
              <span className="px-6 text-center text-xs text-white/40">
                Tracks become playable as they finish. You can leave this page
                and it keeps going.
              </span>
            </div>
          ) : (
            <TrackPlayer output={activeOutput} />
          )}
          {/* Keyed per recording so an unsaved edit never carries across. */}
          <RecordingDescription
            key={activeTake.id}
            value={activeTake.session?.description ?? null}
            onSave={
              canManage && activeTake.session
                ? (next) => onDescribeSession(activeTake.id, next)
                : undefined
            }
          />
        </div>
      </div>

      {/* Tracks of the selected recording, full height beside the player. */}
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/50 bg-primary lg:rounded-none lg:border-0 lg:bg-transparent">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <h3 className="text-sm font-semibold text-foreground">Tracks</h3>
        </div>
        <div className="flex min-w-0 flex-col divide-y divide-border/50 lg:[&>*:last-child]:border-b lg:[&>*:last-child]:border-border/50 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {groupedRows.flatMap((group, groupIndex) =>
            group.map(({ primary, aligned, cloud }, partIndex) => (
              <OutputCard
                key={primary.sourceRecordingId ?? primary.id}
                output={primary}
                alignedOutput={aligned}
                cloudOutput={cloud}
                partLabel={
                  group.length > 1 ? `Part ${partIndex + 1}` : undefined
                }
                fallbackTitle={`Participant ${groupIndex + 1}`}
                selected={primary.id === activeTrackId}
                onSelect={() =>
                  setSelectedTrackByTake((current) => ({
                    ...current,
                    [activeTake.id]: primary.id,
                  }))
                }
              />
            )),
          )}
          {activeTake.cooking.map((track, index) => (
            <ProcessingTrackCard
              key={track.id}
              track={track}
              index={groupedRows.length + index}
            />
          ))}
        </div>
      </aside>
    </div>
  );
};

// Boxed exactly like ProjectCard / ScreenRecordingCard: thumbnail, title, meta.
const SkeletonCard = () => (
  <div className="flex flex-col gap-3 rounded-xl border border-border bg-primary p-3 dark:border-border/50">
    <div className="skeleton-shimmer aspect-video rounded-lg" />
    <div className="space-y-2 px-1 pb-1">
      <div className="skeleton-shimmer h-3.5 w-3/4 rounded" />
      <div className="skeleton-shimmer h-3 w-1/2 rounded" />
    </div>
  </div>
);

const SkeletonSection = ({ title }: { title: string }) => (
  <section className="flex flex-col gap-4">
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
    </div>
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  </section>
);

// Mirrors the projects page: the heading + filter button, then the same
// sections the filter shows (Space Recordings, Screen recordings).
const ProjectsListSkeleton = ({ filter }: { filter: ProjectFilter }) => (
  <div
    aria-label="Loading projects"
    className="flex flex-col gap-6 px-2 pb-2 pt-0"
  >
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Projects</h1>
        <p className="text-sm text-fg-muted">
          <span className="sm:hidden">
            Preview and download your recordings.
          </span>
          <span className="hidden sm:inline">
            Your recordings, ready to preview and download.
          </span>
        </p>
      </div>
      <div className="skeleton-shimmer size-9 shrink-0 rounded-lg sm:w-36" />
    </div>
    {filter !== "screen" && <SkeletonSection title="Space Recordings" />}
    {filter !== "space" && <SkeletonSection title="Screen recordings" />}
  </div>
);

// Mirrors the loaded page: header, recording tabs, the recording's title +
// actions, player and description, and the tracks rail at its saved width.
const ProjectDetailSkeleton = () => {
  const { gridStyle } = useCommentsRailResizer(TRACKS_RAIL_OPTIONS);
  return (
    <div className="-m-4 flex flex-col lg:h-[calc(100%+2rem)] lg:min-h-0">
      <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border pl-2 pr-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-9 shrink-0 animate-pulse rounded-md bg-muted" />
          <div className="min-w-0 space-y-1.5">
            <div className="h-4 w-44 animate-pulse rounded-md bg-muted" />
            <div className="h-3 w-32 animate-pulse rounded-md bg-muted" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="h-9 w-24 animate-pulse rounded-lg bg-muted" />
          <div className="h-9 w-20 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
      <div
        style={gridStyle}
        className="grid gap-6 px-6 py-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_var(--comments-rail-width)] lg:gap-0 lg:p-0"
      >
        {/* Recording tabs, then its title + actions and the player */}
        <section className="flex min-w-0 flex-col lg:border-r lg:border-border">
          <div className="flex h-12 shrink-0 items-stretch gap-6 border-b border-border lg:px-6">
            {["w-28", "w-24", "w-24"].map((width, index) => (
              <div key={index} className="relative flex items-center">
                <div
                  className={`h-4 animate-pulse rounded-md bg-muted ${width}`}
                />
                {/* The selected tab's underline */}
                {index === 0 && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-muted" />
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-4 pt-4 lg:p-6">
            <div className="flex items-center justify-between gap-3">
              {/* Title, then the calendar + date line */}
              <div className="space-y-2">
                <div className="h-4 w-40 animate-pulse rounded-md bg-muted" />
                <div className="h-3 w-32 animate-pulse rounded-md bg-muted" />
              </div>
              {/* Views, Share, Rename, Delete */}
              <div className="flex shrink-0 items-center gap-1.5">
                <div className="mr-1 h-4 w-14 animate-pulse rounded-md bg-muted" />
                <div className="h-8 w-[74px] animate-pulse rounded-lg bg-muted" />
                <div className="h-8 w-[86px] animate-pulse rounded-lg bg-muted" />
                <div className="h-8 w-[78px] animate-pulse rounded-lg bg-muted" />
              </div>
            </div>
            <div className="aspect-video w-full animate-pulse rounded-xl bg-muted" />
            {/* Description */}
            <div className="mt-1 border-t border-border/60 pt-4">
              <div className="mb-3 h-5 w-28 animate-pulse rounded-md bg-muted" />
              <div className="h-3.5 w-3/4 animate-pulse rounded-md bg-muted" />
            </div>
          </div>
        </section>
        {/* Tracks rail */}
        <aside className="flex flex-col overflow-hidden rounded-2xl border border-border/50 bg-primary lg:rounded-none lg:border-0 lg:bg-transparent">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
            <div className="h-4 w-14 animate-pulse rounded-md bg-muted" />
          </div>
          <div className="flex flex-col divide-y divide-border/50 lg:[&>*:last-child]:border-b lg:[&>*:last-child]:border-border/50">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="flex items-center gap-3 px-3.5 py-2.5"
              >
                <div className="size-9 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-3.5 w-28 animate-pulse rounded-md bg-muted" />
                  <div className="h-3 w-40 animate-pulse rounded-md bg-muted" />
                </div>
                {/* Download menu */}
                <div className="h-8 w-28 shrink-0 animate-pulse rounded-lg bg-muted" />
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
};

export const ProjectDetail = ({ spaceId }: { spaceId: string }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [recordingToDelete, setRecordingToDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [sharingSession, setSharingSession] = useState<RecordingSession | null>(
    null,
  );
  // Keep each dialog mounted through its exit animation.
  const deleteDialog = usePresence(deleteConfirmOpen);
  const recordingDeleteDialog = usePresence(recordingToDelete);
  const shareDialog = usePresence(sharingSession);
  const focusedRecordingSessionId = searchParams.get("recordingSessionId");
  const { data: user } = useGetMe();
  const renameSpace = useRenameSpace();
  const projectTitleRef = useRef<InlineTitleHandle>(null);
  const deleteSpace = useDeleteSpace();
  const updateRecordingSession = useUpdateRecordingSession(spaceId);
  const deleteRecordingSession = useDeleteRecordingSession(spaceId);
  const {
    data: space,
    isLoading: isSpaceLoading,
    isError: isSpaceError,
  } = useGetSpaceById(spaceId);
  const { data: sessionsData, isLoading: areSessionsLoading } =
    useGetRecordingSessionsBySpace(spaceId, true, (query) => {
      const data = query.state.data as {
        sessions: RecordingSession[];
      } | null;
      return data && data.sessions.some(isSessionProcessing) ? 2500 : false;
    });
  // Start the output request alongside the project and session requests. The
  // detail page reveals once, after all of its own data is ready, rather than
  // showing a library loader followed by a second recording loader.
  //
  // Keep polling outputs until every non-failed session video track has its
  // FinalOutput row - NOT merely while sessions report "processing". The outputs
  // query lags the sessions query, so stopping when sessions go READY could
  // leave a just-finished track's row unfetched (and its card stuck). The
  // callback closes over the latest sessionsData and compares it to the outputs
  // it already has.
  const { data: outputs, isLoading: areOutputsLoading } = useGetOutputsBySpace(
    spaceId,
    true,
    (query) => {
      // Only LOCAL outputs produce a track row - a CLOUD egress is a download
      // option, not a row. This MUST match the display's coverage: a screen
      // cloud egress shares its sourceRecordingId with the local screen track,
      // so counting cloud here would mark the track "covered" and stop polling
      // before the local screen row lands, freezing it on "Finalizing".
      const outputRecordingIds = new Set(
        (query.state.data ?? [])
          .filter((output) => output.variant !== "CLOUD")
          .map((output) => output.sourceRecordingId)
          .filter(Boolean),
      );
      const hasPending = (sessionsData?.sessions ?? []).some(
        (session) =>
          session.status !== "ACTIVE" &&
          (session.participantRecordings ?? []).some(
            (rec) =>
              rec.hasVideo &&
              rec.status !== "FAILED" &&
              !outputRecordingIds.has(rec.id),
          ),
      );
      return hasPending ? 3000 : false;
    },
  );
  const isInitialLoading =
    isSpaceLoading || areSessionsLoading || areOutputsLoading;

  if (isInitialLoading) return <ProjectDetailSkeleton />;

  if (!space) {
    return (
      <div className="flex flex-col gap-4 p-2">
        <button
          type="button"
          onClick={() => navigate("/dashboard/project")}
          className="group -ml-2 flex h-9 w-fit items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-fg-muted transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <FiChevronLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
          All projects
        </button>
        <div className="rounded-2xl border border-dashed border-border bg-primary/60 px-6 py-16 text-center">
          <p className="text-sm font-medium text-foreground">
            {isSpaceError ? "Couldn't load this project" : "Project not found"}
          </p>
          <p className="mt-1 text-xs text-fg-subtle">
            {isSpaceError
              ? "Check your connection and try again."
              : "It may have been deleted or you may no longer have access."}
          </p>
        </div>
      </div>
    );
  }

  const sessions = sessionsData?.sessions ?? [];
  const sessionCount = space._count?.recordingSessions ?? sessions.length;
  const canManage = user?.id === space.hostId;

  const openDeleteConfirmation = () => {
    setDeleteConfirmOpen(true);
  };

  const handleDelete = () => {
    // The mutation removes this project from the cached project lists before
    // the request resolves, so leave the detail page immediately as well.
    deleteSpace.mutate(space.id);
    setDeleteConfirmOpen(false);
    navigate("/dashboard/project");
  };

  // Optimistic: the hook updates the cache instantly and rolls back on failure.
  const renameRecording = (sessionId: string, nextTitle: string) => {
    updateRecordingSession.mutate({ sessionId, title: nextTitle });
  };

  const openRecordingDelete = (sessionId: string, sessionTitle: string) => {
    setRecordingToDelete({ id: sessionId, title: sessionTitle });
  };

  const handleRecordingDelete = () => {
    if (!recordingToDelete) return;
    // Optimistic: the recording disappears immediately; the hook rolls back on
    // error, so close the warning dialog right away.
    deleteRecordingSession.mutate(recordingToDelete.id);
    setRecordingToDelete(null);
  };

  return (
    <>
      {/* Cancel the wrapper's p-4 so the header spans edge to edge like the
          dashboard header above it. On desktop the page is exactly the
          container's height: the player pane and tracks rail scroll on their
          own. */}
      <div className="-m-4 flex flex-col lg:h-[calc(100%+2rem)] lg:min-h-0">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border pl-2 pr-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/dashboard/project")}
              aria-label="Back to all projects"
              title="All projects"
              className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground transition-opacity hover:opacity-80 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
            >
              <FiChevronLeft className="size-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold leading-tight text-foreground">
                <InlineTitle
                  ref={projectTitleRef}
                  value={space.title || "Untitled space"}
                  maxLength={100}
                  onSave={
                    canManage
                      ? (next) =>
                          renameSpace.mutate({ spaceId: space.id, title: next })
                      : undefined
                  }
                  className="truncate"
                />
              </h1>
              <p className="flex items-center gap-x-2 truncate text-xs text-fg-subtle">
                <span>{recordingLabel(sessionCount)}</span>
                {space.createdAt && (
                  <>
                    <span>·</span>
                    <span>Created {formatDay(space.createdAt)}</span>
                  </>
                )}
              </p>
            </div>
          </div>
          {canManage && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => projectTitleRef.current?.edit()}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-muted px-3 text-sm font-medium text-foreground transition-opacity hover:opacity-80 cursor-pointer"
              >
                <FiEdit2 className="size-3.5" />
                Rename
              </button>
              <button
                type="button"
                onClick={openDeleteConfirmation}
                disabled={deleteSpace.isPending}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-danger/10 px-3 text-sm font-medium text-danger transition-colors hover:bg-danger/15 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                {deleteSpace.isPending ? (
                  <FiLoader className="size-3.5 animate-spin" />
                ) : (
                  <FiTrash2 className="size-3.5" />
                )}
                Delete
              </button>
            </div>
          )}
        </header>
        <SpaceOutputs
          outputs={outputs ?? []}
          sessions={sessions}
          canManage={canManage}
          initialTakeId={focusedRecordingSessionId}
          onRenameSession={renameRecording}
          onDescribeSession={(sessionId, description) =>
            updateRecordingSession.mutate({ sessionId, description })
          }
          onDeleteSession={openRecordingDelete}
          onShareSession={setSharingSession}
        />
      </div>
      {shareDialog.rendered && (
        <SpaceRecordingShareDialog
          session={
            sessions.find(
              (session) => session.id === shareDialog.rendered?.id,
            ) ?? shareDialog.rendered
          }
          spaceId={spaceId}
          onClose={() => setSharingSession(null)}
          isClosing={shareDialog.isClosing}
        />
      )}
      {recordingDeleteDialog.rendered && (
        <div
          className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm ${backdropMotion(recordingDeleteDialog.isClosing)}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-recording-title"
          aria-describedby="delete-recording-description"
          onClick={() => setRecordingToDelete(null)}
        >
          <div
            className={`w-full max-w-[420px] rounded-2xl border border-border/50 bg-[#f9f9fb] p-5 dark:bg-[#0f0f11] ${panelMotion(recordingDeleteDialog.isClosing)}`}
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id="delete-recording-title"
              className="text-base font-semibold text-foreground"
            >
              Delete this recording?
            </h2>
            <p
              id="delete-recording-description"
              className="mt-1.5 text-sm leading-6 text-fg-muted"
            >
              <span className="font-medium text-foreground">
                {recordingDeleteDialog.rendered.title}
              </span>{" "}
              and all of its tracks will be permanently deleted. This action
              cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRecordingToDelete(null)}
                className="h-9 rounded-lg bg-muted px-3.5 text-sm font-medium text-foreground transition-opacity hover:opacity-80 cursor-pointer"
              >
                Keep recording
              </button>
              <button
                type="button"
                onClick={handleRecordingDelete}
                className="h-9 rounded-lg bg-danger px-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-85 cursor-pointer"
              >
                Delete recording
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteDialog.rendered && (
        <div
          className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm ${backdropMotion(deleteDialog.isClosing)}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-project-title"
          aria-describedby="delete-project-description"
          onClick={() => {
            if (!deleteSpace.isPending) setDeleteConfirmOpen(false);
          }}
        >
          <div
            className={`w-full max-w-[420px] rounded-2xl border border-border/50 bg-[#f9f9fb] p-5 dark:bg-[#0f0f11] ${panelMotion(deleteDialog.isClosing)}`}
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id="delete-project-title"
              className="text-base font-semibold text-foreground"
            >
              Delete this project?
            </h2>
            <p
              id="delete-project-description"
              className="mt-1.5 text-sm leading-6 text-fg-muted"
            >
              <span className="font-medium text-foreground">
                {space.title || "Untitled space"}
              </span>{" "}
              and all of its recordings will be permanently deleted. This action
              cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={deleteSpace.isPending}
                className="h-9 rounded-lg bg-muted px-3.5 text-sm font-medium text-foreground transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
              >
                Keep project
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleteSpace.isPending}
                className="flex h-9 min-w-28 items-center justify-center gap-2 rounded-lg bg-danger px-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
              >
                {deleteSpace.isPending && (
                  <FiLoader className="size-4 animate-spin" />
                )}
                {deleteSpace.isPending ? "Deleting…" : "Delete project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

type ProjectFilter = "all" | "space" | "screen";

const PROJECT_FILTERS: {
  value: ProjectFilter;
  label: string;
  icon: typeof FiFolder;
}[] = [
  { value: "all", label: "All projects", icon: FiFolder },
  { value: "space", label: "Space recordings", icon: FiVideo },
  { value: "screen", label: "Screen recordings", icon: FiMonitor },
];

const RecordingsLibrary = () => {
  const navigate = useNavigate();
  // Kept in the URL so the choice survives opening a project and coming back.
  const [searchParams, setSearchParams] = useSearchParams();
  const filter: ProjectFilter =
    PROJECT_FILTERS.find((item) => item.value === searchParams.get("type"))
      ?.value ?? "all";
  const setFilter = (next: ProjectFilter) =>
    setSearchParams(
      (params) => {
        if (next === "all") params.delete("type");
        else params.set("type", next);
        return params;
      },
      { replace: true },
    );
  const [visibleSpaceCount, setVisibleSpaceCount] = useState(PROJECTS_PER_PAGE);
  const { data: spaces, isLoading } = useGetUserSpaces("hosted");
  const { data: screenRecordings, isLoading: areScreenRecordingsLoading } =
    useScreenRecordings();
  const screenRecs = screenRecordings ?? [];

  const spacesWithRecordings = useMemo(
    () =>
      (spaces ?? []).filter(
        (space) => (space._count?.recordingSessions ?? 0) > 0,
      ),
    [spaces],
  );
  const visibleSpaces = spacesWithRecordings.slice(0, visibleSpaceCount);
  const remainingSpaces = Math.max(
    0,
    spacesWithRecordings.length - visibleSpaces.length,
  );

  const activeFilterLabel =
    PROJECT_FILTERS.find((item) => item.value === filter)?.label ?? "";

  if (isLoading || areScreenRecordingsLoading)
    return <ProjectsListSkeleton filter={filter} />;

  const hasNoRecordings =
    spacesWithRecordings.length === 0 && screenRecs.length === 0;

  return (
    <div className="flex flex-col gap-6 px-2 pb-2 pt-0">
      {/* Title and filter share one line on phones too: short copy and an
          icon-only filter button below sm. */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold text-foreground">Projects</h1>
          <p className="text-sm text-fg-muted">
            <span className="sm:hidden">
              Preview and download your recordings.
            </span>
            <span className="hidden sm:inline">
              Your recordings, ready to preview and download.
            </span>
          </p>
        </div>
        {!hasNoRecordings && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Filter: ${activeFilterLabel}`}
                className="flex size-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border/50 bg-primary text-sm font-medium text-foreground transition-colors hover:bg-muted data-[state=open]:bg-muted cursor-pointer sm:w-auto sm:px-3"
              >
                <FiFilter size={14} className="text-fg-subtle" />
                {/* Phones: just the icon - the names are in the menu. */}
                <span className="hidden sm:inline">{activeFilterLabel}</span>
                <FiChevronDown
                  size={14}
                  className="hidden text-fg-subtle sm:block"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={6}
              className="w-52 rounded-xl border-border/50 bg-primary p-1"
            >
              <DropdownMenuRadioGroup
                value={filter}
                onValueChange={(value) => setFilter(value as ProjectFilter)}
              >
                {PROJECT_FILTERS.map((item) => (
                  <DropdownMenuRadioItem
                    key={item.value}
                    value={item.value}
                    // Hide the stock radio dot; the check on the right marks it.
                    className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg-muted focus:bg-muted focus:text-foreground data-[state=checked]:text-foreground [&>span:first-child]:hidden"
                  >
                    <item.icon size={15} />
                    <span className="flex-1">{item.label}</span>
                    {item.value === filter && (
                      <FiCheck size={14} className="text-foreground" />
                    )}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {hasNoRecordings && (
        <div className="flex flex-col items-center gap-4 pt-28 text-center">
          <span className="flex size-14 items-center justify-center rounded-xl bg-muted ring-1 ring-border">
            <Clapperboard className="size-7 text-fg-subtle" />
          </span>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold text-foreground">
              No recordings yet
            </h2>
            <p className="max-w-sm text-sm text-fg-muted">
              Start a call and hit record. Your processed recordings will show
              up here, ready to preview and download.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/dashboard/home")}
            className="h-9 cursor-pointer rounded-lg bg-brand px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Start a call
          </button>
        </div>
      )}

      {!hasNoRecordings &&
        filter === "space" &&
        spacesWithRecordings.length === 0 && <FilterEmpty kind="space" />}
      {!hasNoRecordings && filter === "screen" && screenRecs.length === 0 && (
        <FilterEmpty kind="screen" />
      )}

      {filter !== "screen" && spacesWithRecordings.length > 0 ? (
        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              Space Recordings
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {visibleSpaces.map((space) => (
              <ProjectCard
                key={space.id}
                space={space}
                onOpen={(item) => navigate(`/dashboard/project/${item.id}`)}
                showOptions={false}
              />
            ))}
          </div>
          {remainingSpaces > 0 && (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                onClick={() =>
                  setVisibleSpaceCount((count) =>
                    Math.min(
                      count + PROJECTS_PER_PAGE,
                      spacesWithRecordings.length,
                    ),
                  )
                }
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-primary px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Show more
                <span className="text-fg-subtle">({remainingSpaces} more)</span>
                <FiChevronDown size={14} />
              </button>
            </div>
          )}
        </section>
      ) : null}

      {filter !== "space" && (
        <ScreenRecordingsSection recordings={screenRecs} />
      )}
    </div>
  );
};

const FILTER_EMPTY: Record<
  "space" | "screen",
  {
    icon: typeof FiFolder;
    title: string;
    description: string;
    cta: string;
    /** Null opens the floating screen recorder instead of navigating. */
    to: string | null;
  }
> = {
  space: {
    icon: FiVideo,
    title: "No space recordings yet",
    description:
      "Start a call and hit record. Every participant's track lands here, ready to preview and download.",
    cta: "Start a call",
    to: "/dashboard/home",
  },
  screen: {
    icon: FiMonitor,
    title: "No screen recordings yet",
    description:
      "Capture your screen, camera, or both. Finished recordings show up here.",
    cta: "Open screen recorder",
    to: null,
  },
};

const FilterEmpty = ({ kind }: { kind: "space" | "screen" }) => {
  const navigate = useNavigate();
  const { openRecorder } = useScreenRecordingContext();
  const { icon: Icon, title, description, cta, to } = FILTER_EMPTY[kind];

  return (
    <div className="flex flex-col items-center gap-4 pt-24 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-muted ring-1 ring-border">
        <Icon size={20} className="text-fg-subtle" />
      </span>
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="max-w-sm text-sm text-fg-muted">{description}</p>
      </div>
      <button
        type="button"
        onClick={() => (to ? navigate(to) : openRecorder())}
        className="h-9 cursor-pointer rounded-lg bg-brand px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        {cta}
      </button>
    </div>
  );
};

export default RecordingsLibrary;
