import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  FiChevronDown,
  FiChevronLeft,
  FiCheck,
  FiCopy,
  FiEdit2,
  FiFolder,
  FiLink,
  FiLoader,
  FiMoreVertical,
  FiShare2,
  FiTrash2,
  FiVideo,
} from "react-icons/fi";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shared/ui/dropdown-menu";
import { cn } from "@/lib/utils";
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
  useRenameRecordingSession,
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
import ProjectCard from "./ProjectCard";
import ScreenRecordingsSection from "./ScreenRecordingsSection";

const PROJECTS_PER_PAGE = 8;
const shareUrlFor = (token: string) => `${window.location.origin}/share/${token}`;

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
    <div className="relative aspect-video w-full max-w-2xl self-start overflow-hidden rounded-lg bg-black ring-1 ring-border">
      {!output ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-white/45">
          <FiVideo className="size-6" />
          <span className="text-sm">Select a track to play it here</span>
        </div>
      ) : url ? (
        <video src={url} controls playsInline className="h-full w-full" />
      ) : (
        <div className="flex h-full items-center justify-center gap-2 text-sm text-white/60">
          <FiLoader className="size-4 animate-spin" /> Loading…
        </div>
      )}
    </div>
  );
};

const RecordingSessionActions = ({
  onRename,
  onDelete,
}: {
  onRename: () => void;
  onDelete: () => void;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Recording options"
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60",
            menuOpen
              ? "bg-background text-foreground"
              : "text-fg-subtle",
          )}
        >
          <FiMoreVertical className="size-4.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onRename}>
          <FiEdit2 />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onDelete}
          className="text-danger focus:bg-danger/10 focus:text-danger [&_svg]:!text-danger"
        >
          <FiTrash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const SpaceRecordingShareDialog = ({
  session,
  spaceId,
  onClose,
}: {
  session: RecordingSession;
  spaceId: string;
  onClose: () => void;
}) => {
  const [copied, setCopied] = useState(false);
  const share = useShareSpaceRecording(spaceId);
  const unshare = useUnshareSpaceRecording(spaceId);
  const token = session.shareToken;
  const url = token ? shareUrlFor(token) : "";

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The field remains selectable when clipboard permission is unavailable.
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-space-recording-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[460px] rounded-xl border border-border bg-background p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="share-space-recording-title" className="text-lg font-semibold text-foreground">
          Share this recording
        </h2>
        <p className="mt-2 text-sm leading-6 text-fg-muted">
          {token
            ? "Anyone with this link can watch and download this recording. No account needed."
            : "Create a link that lets anyone watch and download this recording. No account needed."}
        </p>
        {token ? (
          <>
            <div className="mt-4 flex items-center gap-2">
              <input
                readOnly
                value={url}
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 rounded-md border border-border bg-primary px-3 py-2 text-sm text-fg-muted outline-none"
              />
              <button
                type="button"
                onClick={() => void copy()}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-semibold text-background transition-opacity hover:opacity-85"
              >
                {copied ? <FiCheck className="size-4" /> : <FiCopy className="size-4" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="mt-6 flex justify-between gap-2">
              <button
                type="button"
                onClick={() => unshare.mutate(session.id)}
                disabled={unshare.isPending}
                className="flex items-center gap-1.5 rounded-md border border-danger/25 bg-danger/10 px-3.5 py-2 text-sm font-medium text-danger transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {unshare.isPending && <FiLoader className="size-4 animate-spin" />}
                Stop sharing
              </button>
              <button type="button" onClick={onClose} className="rounded-md border border-border bg-primary px-3.5 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70">
                Done
              </button>
            </div>
          </>
        ) : (
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border bg-primary px-3.5 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => share.mutate(session.id)}
              disabled={share.isPending}
              className="flex items-center gap-1.5 rounded-md bg-foreground px-3.5 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {share.isPending ? <FiLoader className="size-4 animate-spin" /> : <FiLink className="size-4" />}
              Create link
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// One recording (a single start→stop run within the meeting). Has its own
// player and its own track list, with its own selected track.
const RecordingBlock = ({
  id,
  rows,
  cooking = [],
  title,
  showDivider,
  onRename,
  onDelete,
  shareToken,
  onShare,
}: {
  id: string;
  rows: TrackRow[];
  /** Session tracks whose masters are still being stitched - shown as
   *  processing cards below the ready rows so they never leave the screen. */
  cooking?: ParticipantRecording[];
  title: string;
  showDivider: boolean;
  onRename?: () => void;
  onDelete?: () => void;
  shareToken?: string | null;
  onShare?: () => void;
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Group a participant's segments together (Part 1 / Part 2 after a refresh).
  const participantGroups = new Map<string, TrackRow[]>();
  rows.forEach((row, index) => {
    const key =
      row.primary.sourceRecording?.participant?.id ??
      row.primary.targetParticipantId ??
      `solo-${row.primary.sourceRecordingId ?? row.primary.id ?? index}`;
    const existing = participantGroups.get(key);
    if (existing) existing.push(row);
    else participantGroups.set(key, [row]);
  });
  for (const group of participantGroups.values()) {
    group.sort(
      (a, b) =>
        new Date(a.primary.createdAt).getTime() -
        new Date(b.primary.createdAt).getTime(),
    );
  }
  const groupedRows = [...participantGroups.values()];

  // Playable tracks are the ready video ones. Default the player to the first.
  const playableIds = groupedRows
    .flat()
    .filter((row) => row.primary.status === "READY" && row.primary.hasVideo)
    .map((row) => row.primary.id);
  const activeId =
    selectedId && playableIds.includes(selectedId)
      ? selectedId
      : (playableIds[0] ?? null);
  const activeOutput =
    groupedRows.flat().find((row) => row.primary.id === activeId)?.primary ??
    null;

  return (
    <section
      id={`recording-session-${id}`}
      className={`flex flex-col gap-4 ${showDivider ? "mt-6 border-t border-border pt-12" : ""}`}
    >
      <div className="flex w-full max-w-2xl flex-col gap-3 rounded-xl border border-border bg-primary p-3">
        <TrackPlayer output={activeOutput} />
        <div className="flex w-full items-center justify-between gap-2 px-0.5 pb-0.5">
          <p className="min-w-0 truncate text-base font-semibold text-foreground">
            {title}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {onShare && (
              <button
                type="button"
                onClick={onShare}
                className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-opacity hover:opacity-70 ${shareToken ? "border-success/25 bg-success/10 text-success" : "border-border bg-muted text-foreground"}`}
              >
                <FiShare2 className="size-3.5" />
                {shareToken ? "Shared" : "Share"}
              </button>
            )}
            {onRename && onDelete && (
              <RecordingSessionActions onRename={onRename} onDelete={onDelete} />
            )}
          </div>
        </div>
      </div>
      <h3 className="text-sm font-semibold text-fg-muted">Tracks</h3>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {groupedRows.flatMap((group, groupIndex) =>
          group.map(({ primary, aligned, cloud }, partIndex) => (
            <OutputCard
              key={primary.sourceRecordingId ?? primary.id}
              output={primary}
              alignedOutput={aligned}
              cloudOutput={cloud}
              partLabel={group.length > 1 ? `Part ${partIndex + 1}` : undefined}
              fallbackTitle={`Participant ${groupIndex + 1}`}
              selected={primary.id === activeId}
              onSelect={() => setSelectedId(primary.id)}
            />
          )),
        )}
        {cooking.map((track, index) => (
          <ProcessingTrackCard
            key={track.id}
            track={track}
            index={groupedRows.length + index}
          />
        ))}
      </div>
    </section>
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
  // The early poster (extracted from the first chunk) is usually ready even while
  // the track is still processing - show it; fall back to the avatar / icon.
  const thumbnail = track.thumbnailUrl ?? null;
  const avatar = track.participant?.user?.avatar;
  const pct = estimateTrackProgress(track, now);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-primary px-2.5 py-1.5">
      <span className="relative flex aspect-[4/3] h-14 shrink-0 items-center justify-center overflow-hidden rounded bg-muted ring-1 ring-border">
        {thumbnail ? (
          <img src={thumbnail} alt="" className="h-full w-full object-cover" />
        ) : avatar ? (
          <span className="flex size-8 items-center justify-center overflow-hidden rounded-full">
            <img src={avatar} alt="" className="h-full w-full object-cover" />
          </span>
        ) : (
          <FiVideo className="size-5 text-fg-subtle" />
        )}
        {!failed && !thumbnail && (
          <span className="absolute inset-0 animate-pulse bg-muted" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold text-foreground">
          {name}
        </p>
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
                className="block h-full rounded-full bg-warning transition-[width] duration-1000 ease-linear"
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

// A recording that has stopped and is still being stitched into downloadable
// masters. Shows a processing player placeholder plus a card per track.
const ProcessingRecordingBlock = ({
  id,
  tracks,
  title,
  showDivider,
  onRename,
  onDelete,
  shareToken,
  onShare,
}: {
  id: string;
  tracks: ParticipantRecording[];
  title: string;
  showDivider: boolean;
  onRename?: () => void;
  onDelete?: () => void;
  shareToken?: string | null;
  onShare?: () => void;
}) => (
  <section
    id={`recording-session-${id}`}
    className={`flex flex-col gap-4 ${showDivider ? "border-t border-border pt-6" : ""}`}
  >
    <div className="flex w-full max-w-2xl flex-col gap-3 rounded-xl border border-border bg-primary p-3">
      <div className="relative flex aspect-video w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-lg bg-black text-white/60 ring-1 ring-border">
        <FiLoader className="size-6 animate-spin" />
        <span className="text-sm">Processing your recording…</span>
        <span className="px-6 text-center text-xs text-white/40">
          Tracks become playable as they finish. You can leave this page and it
          keeps going.
        </span>
      </div>
      <div className="flex w-full items-center justify-between gap-2 px-0.5 pb-0.5">
        <p className="min-w-0 truncate text-base font-semibold text-foreground">
          {title}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {onShare && (
            <button
              type="button"
              onClick={onShare}
              className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-opacity hover:opacity-70 ${shareToken ? "border-success/25 bg-success/10 text-success" : "border-border bg-muted text-foreground"}`}
            >
              <FiShare2 className="size-3.5" />
              {shareToken ? "Shared" : "Share"}
            </button>
          )}
          {onRename && onDelete && (
            <RecordingSessionActions onRename={onRename} onDelete={onDelete} />
          )}
        </div>
      </div>
    </div>
    <h3 className="text-sm font-semibold text-fg-muted">Tracks</h3>
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      {tracks.map((track, index) => (
        <ProcessingTrackCard key={track.id} track={track} index={index} />
      ))}
    </div>
  </section>
);

const SpaceOutputs = ({
  outputs,
  sessions,
  canManage,
  onRenameSession,
  onDeleteSession,
  onShareSession,
}: {
  outputs: FinalOutput[];
  sessions: RecordingSession[];
  canManage: boolean;
  onRenameSession: (sessionId: string, title: string) => void;
  onDeleteSession: (sessionId: string, title: string) => void;
  onShareSession: (session: RecordingSession) => void;
}) => {
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
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-primary/60 py-20 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-background text-fg-subtle">
          <FiVideo className="size-6" />
        </span>
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

  // Group tracks into recordings - one meeting can be recorded more than once
  // (start → stop → start again). Each recording is its own block with its own
  // player + tracks, ordered oldest-first so the first recording is on top.
  const recordingsMap = new Map<string, TrackRow[]>();
  for (const row of rows) {
    const key = row.primary.recordingSessionId;
    const existing = recordingsMap.get(key);
    if (existing) existing.push(row);
    else recordingsMap.set(key, [row]);
  }
  const recordings = [...recordingsMap.entries()]
    .map(([id, recRows], index) => ({
      id,
      rows: recRows,
      cooking: cookingBySession.get(id) ?? [],
      session: sessions.find((session) => session.id === id),
      title:
        sessions.find((session) => session.id === id)?.title ||
        recRows[0]?.primary.recordingSession?.title ||
        `Recording ${index + 1}`,
      startedAt:
        recRows[0]?.primary.recordingSession?.startedAt ??
        recRows[0]?.primary.createdAt ??
        null,
    }))
    .sort(
      (a, b) =>
        new Date(a.startedAt ?? 0).getTime() -
        new Date(b.startedAt ?? 0).getTime(),
    );

  return (
    <section className="flex flex-col gap-4">
      {processingBlocks.map((block, index) => (
        <ProcessingRecordingBlock
          key={block.id}
          id={block.id}
          tracks={block.tracks}
          title={block.title}
          showDivider={index > 0}
          onRename={
            canManage ? () => onRenameSession(block.id, block.title) : undefined
          }
          onDelete={
            canManage ? () => onDeleteSession(block.id, block.title) : undefined
          }
          shareToken={block.session.shareToken}
          onShare={canManage ? () => onShareSession(block.session) : undefined}
        />
      ))}
      {recordings.map((rec, index) => (
        <RecordingBlock
          key={rec.id}
          id={rec.id}
          rows={rec.rows}
          cooking={rec.cooking}
          title={rec.title}
          showDivider={processingBlocks.length + index > 0}
          onRename={
            canManage ? () => onRenameSession(rec.id, rec.title) : undefined
          }
          onDelete={
            canManage ? () => onDeleteSession(rec.id, rec.title) : undefined
          }
          shareToken={rec.session?.shareToken}
          onShare={
            canManage && rec.session
              ? () => onShareSession(rec.session as RecordingSession)
              : undefined
          }
        />
      ))}
    </section>
  );
};

const SkeletonCard = () => (
  <div className="flex flex-col gap-3 rounded-xl border border-border bg-primary p-3">
    <div className="aspect-video animate-pulse rounded-lg bg-muted" />
    <div className="space-y-2 px-1 pb-1">
      <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
    </div>
  </div>
);

const SpaceRecordingsSkeleton = () => (
  <section className="flex flex-col gap-4">
    <h2 className="text-sm font-semibold text-foreground">Space Recordings</h2>
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  </section>
);

const ProjectDetailSkeleton = () => (
  <div className="flex flex-col gap-6 p-2">
    <div className="h-9 w-28 animate-pulse rounded-md bg-muted" />
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
      <div className="min-w-0 space-y-2">
        <div className="h-6 w-52 animate-pulse rounded bg-muted" />
        <div className="h-3 w-36 animate-pulse rounded bg-muted" />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />
        <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />
      </div>
    </div>
    <section className="flex flex-col gap-4">
      <div className="flex w-full max-w-2xl flex-col gap-3 rounded-xl border border-border bg-primary p-3">
        <div className="aspect-video w-full animate-pulse rounded-lg bg-muted" />
        <div className="flex items-center justify-between gap-2 px-0.5 pb-0.5">
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted" />
        </div>
      </div>
      <div className="h-4 w-16 animate-pulse rounded bg-muted" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="flex items-center gap-3 rounded-lg border border-border bg-primary px-2.5 py-1.5"
          >
            <div className="aspect-[4/3] h-14 shrink-0 animate-pulse rounded bg-muted" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </section>
  </div>
);

export const ProjectDetail = ({ spaceId }: { spaceId: string }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [renaming, setRenaming] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [recordingToRename, setRecordingToRename] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [recordingToDelete, setRecordingToDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [sharingSession, setSharingSession] =
    useState<RecordingSession | null>(null);
  const focusedRecordingSessionId = searchParams.get("recordingSessionId");
  const { data: user } = useGetMe();
  const renameSpace = useRenameSpace();
  const deleteSpace = useDeleteSpace();
  const renameRecordingSession = useRenameRecordingSession(spaceId);
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

  useEffect(() => {
    if (!focusedRecordingSessionId || isInitialLoading || !space) return;
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(`recording-session-${focusedRecordingSessionId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedRecordingSessionId, isInitialLoading, space]);

  if (isInitialLoading) return <ProjectDetailSkeleton />;

  if (!space) {
    return (
      <div className="flex flex-col gap-4 p-2">
        <button
          type="button"
          onClick={() => navigate("/dashboard/project")}
          className="group flex h-9 w-fit items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm font-medium text-foreground transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <FiChevronLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
          All projects
        </button>
        <div className="rounded-xl border border-dashed border-border bg-primary/60 px-6 py-16 text-center">
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

  const openRename = () => {
    setTitle(space.title || "");
    setRenaming(true);
  };

  const submitRename = () => {
    const next = title.trim();
    setRenaming(false);
    if (!next || next === (space.title || "")) return;
    renameSpace.mutate({ spaceId: space.id, title: next });
  };

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

  const openRecordingRename = (sessionId: string, sessionTitle: string) => {
    setRecordingToRename({ id: sessionId, title: sessionTitle });
  };

  const submitRecordingRename = () => {
    if (!recordingToRename) return;
    const nextTitle = recordingToRename.title.trim();
    if (!nextTitle) return;
    // Optimistic: the hook updates the cache instantly and rolls back on
    // failure, so close the dialog immediately - no loader, no await.
    renameRecordingSession.mutate({
      sessionId: recordingToRename.id,
      title: nextTitle,
    });
    setRecordingToRename(null);
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
      <div className="flex flex-col gap-6 p-2">
        <button
          type="button"
          onClick={() => navigate("/dashboard/project")}
          className="group flex h-9 w-fit items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm font-medium text-foreground transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <FiChevronLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
          All projects
        </button>
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
          <div className="min-w-0 space-y-1">
            <h1 className="truncate text-xl font-semibold text-foreground">
              {space.title || "Untitled space"}
            </h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-subtle">
              <span>{recordingLabel(sessionCount)}</span>
              {space.createdAt && (
                <>
                  <span>·</span>
                  <span>Created {formatDay(space.createdAt)}</span>
                </>
              )}
            </p>
          </div>
          {canManage && (
            <div
              role="group"
              aria-label="Project actions"
              className="flex shrink-0 items-center gap-2"
            >
              <button
                type="button"
                onClick={openRename}
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-muted px-3 text-sm font-medium text-foreground transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
              >
                <FiEdit2 className="size-4" />
                Rename
              </button>
              <button
                type="button"
                onClick={openDeleteConfirmation}
                disabled={deleteSpace.isPending}
                className="flex h-9 items-center gap-1.5 rounded-md border border-danger/25 bg-danger/10 px-3 text-sm font-medium text-danger transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleteSpace.isPending ? (
                  <FiLoader className="size-4 animate-spin" />
                ) : (
                  <FiTrash2 className="size-4" />
                )}
                Delete
              </button>
            </div>
          )}
        </div>
        <SpaceOutputs
          outputs={outputs ?? []}
          sessions={sessions}
          canManage={canManage}
          onRenameSession={openRecordingRename}
          onDeleteSession={openRecordingDelete}
          onShareSession={setSharingSession}
        />
      </div>
      {sharingSession && (
        <SpaceRecordingShareDialog
          session={
            sessions.find((session) => session.id === sharingSession.id) ??
            sharingSession
          }
          spaceId={spaceId}
          onClose={() => setSharingSession(null)}
        />
      )}
      {renaming && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setRenaming(false)}
        >
          <div
            className="w-full max-w-[380px] rounded-lg border border-border bg-background p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-foreground">
              Rename project
            </h2>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitRename();
                if (event.key === "Escape") setRenaming(false);
              }}
              placeholder="Project name"
              className="mt-4 w-full rounded-md border border-border bg-primary px-3 py-2 text-sm text-foreground outline-none focus:border-fg-faint"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenaming(false)}
                className="rounded-md border border-border bg-primary px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-primary/85"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitRename}
                disabled={!title.trim()}
                className="rounded-md bg-foreground px-3.5 py-2 text-sm font-semibold text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {recordingToRename && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-recording-title"
          onClick={() => setRecordingToRename(null)}
        >
          <div
            className="w-full max-w-[380px] rounded-lg border border-border bg-background p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id="rename-recording-title"
              className="text-base font-semibold text-foreground"
            >
              Rename recording
            </h2>
            <input
              autoFocus
              value={recordingToRename.title}
              onChange={(event) =>
                setRecordingToRename((recording) =>
                  recording
                    ? { ...recording, title: event.target.value }
                    : recording,
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") submitRecordingRename();
                if (event.key === "Escape") setRecordingToRename(null);
              }}
              maxLength={120}
              placeholder="Recording name"
              className="mt-4 w-full rounded-md border border-border bg-primary px-3 py-2 text-sm text-foreground outline-none focus:border-fg-faint"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRecordingToRename(null)}
                className="rounded-md border border-border bg-primary px-3.5 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitRecordingRename}
                disabled={!recordingToRename.title.trim()}
                className="rounded-md bg-foreground px-3.5 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {recordingToDelete && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-recording-title"
          aria-describedby="delete-recording-description"
          onClick={() => setRecordingToDelete(null)}
        >
          <div
            className="w-full max-w-[420px] rounded-xl border border-border bg-background p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id="delete-recording-title"
              className="text-lg font-semibold text-foreground"
            >
              Delete this recording?
            </h2>
            <p
              id="delete-recording-description"
              className="mt-2 text-sm leading-6 text-fg-muted"
            >
              <span className="font-medium text-foreground">
                {recordingToDelete.title}
              </span>{" "}
              and all of its tracks will be permanently deleted. This action
              cannot be undone.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRecordingToDelete(null)}
                className="rounded-md border border-border bg-primary px-3.5 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70"
              >
                Keep recording
              </button>
              <button
                type="button"
                onClick={handleRecordingDelete}
                className="rounded-md bg-danger px-3.5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-85"
              >
                Delete recording
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteConfirmOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-project-title"
          aria-describedby="delete-project-description"
          onClick={() => {
            if (!deleteSpace.isPending) setDeleteConfirmOpen(false);
          }}
        >
          <div
            className="w-full max-w-[420px] rounded-xl border border-border bg-background p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id="delete-project-title"
              className="text-lg font-semibold text-foreground"
            >
              Delete this project?
            </h2>
            <p
              id="delete-project-description"
              className="mt-2 text-sm leading-6 text-fg-muted"
            >
              <span className="font-medium text-foreground">
                {space.title || "Untitled space"}
              </span>{" "}
              and all of its recordings will be permanently deleted. This action
              cannot be undone.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={deleteSpace.isPending}
                className="rounded-md border border-border bg-primary px-3.5 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Keep project
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleteSpace.isPending}
                className="flex min-w-28 items-center justify-center gap-2 rounded-md bg-danger px-3.5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
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

const RecordingsLibrary = () => {
  const navigate = useNavigate();
  const [visibleSpaceCount, setVisibleSpaceCount] =
    useState(PROJECTS_PER_PAGE);
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

  if (
    !isLoading &&
    !areScreenRecordingsLoading &&
    spacesWithRecordings.length === 0 &&
    screenRecs.length === 0
  ) {
    return (
      <div className="flex min-h-[calc(100vh-3rem)] flex-col items-center justify-start gap-4 p-4 pt-40 text-center">
        <span className="flex size-14 items-center justify-center rounded-xl bg-muted ring-1 ring-border">
          <FiFolder className="size-7 text-fg-subtle" />
        </span>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-foreground">
            No recordings yet
          </h1>
          <p className="max-w-sm text-sm text-fg-muted">
            Start a call and hit record. Your processed recordings will show up
            here, ready to preview and download.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 p-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-foreground">Projects</h1>
          <p className="text-sm text-fg-muted">
            Your recordings, ready to preview and download.
          </p>
        </div>
      </div>

      {isLoading ? (
        <SpaceRecordingsSkeleton />
      ) : spacesWithRecordings.length > 0 ? (
        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              Space Recordings
            </h2>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-[0.7rem] font-medium text-fg-muted ring-1 ring-border">
              {spacesWithRecordings.length}
            </span>
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
                className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-4 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70"
              >
                Show more
                <span className="text-fg-subtle">
                  ({remainingSpaces} more)
                </span>
                <FiChevronDown size={14} />
              </button>
            </div>
          )}
        </section>
      ) : null}

      <ScreenRecordingsSection
        recordings={screenRecs}
        isLoading={areScreenRecordingsLoading}
      />
    </div>
  );
};

export default RecordingsLibrary;
