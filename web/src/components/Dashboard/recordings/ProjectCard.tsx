import { useState } from "react";
import { FiEdit2, FiMoreVertical, FiTrash2 } from "react-icons/fi";
import { PiRecordFill } from "react-icons/pi";
import { useGetOutputsBySpace } from "@/hooks/useFinalOutputs";
import { useDeleteSpace, useRenameSpace } from "@/hooks/useSpace";
import { useEntitlements } from "@/hooks/useUsage";
import type { Space } from "@/types/spaceTypes";
import type { FinalOutput } from "@/types/outputTypes";
import { cn } from "@/lib/utils";
import {
  formatRetentionRemaining,
  retentionExpiryMs,
} from "@/lib/retention";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shared/ui/dropdown-menu";

const formatDate = (value?: string) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";

const recordingLabel = (count: number) =>
  `${count} recording${count === 1 ? "" : "s"}`;

// A single stored R2 thumbnail. Older outputs without a generated poster fall
// back to the recording icon rather than downloading and decoding the video.
const OutputThumb = ({ output }: { output: FinalOutput }) => {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const [thumbnailLoaded, setThumbnailLoaded] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const thumbnail = output.thumbnailUrl ?? null;
  const participant = output.sourceRecording?.participant;
  const avatar = participant?.user?.avatar ?? null;
  const name = participant?.displayName || participant?.user?.name || "";

  if (thumbnail && !thumbnailFailed) {
    return (
      <div className="relative h-full w-full">
        {/* Shiny skeleton fills the frame until the poster finishes decoding. */}
        {!thumbnailLoaded && (
          <div className="skeleton-shimmer absolute inset-0 h-full w-full" />
        )}
        <img
          src={thumbnail}
          alt=""
          loading="lazy"
          onLoad={() => setThumbnailLoaded(true)}
          onError={() => setThumbnailFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            thumbnailLoaded ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>
    );
  }

  // No poster → camera-off style: the person's round profile picture, or their
  // first initial when they have no picture, falling back to the record icon.
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-foreground/10">
      {name || avatar ? (
        <span className="flex aspect-square h-1/3 min-h-8 max-w-[80%] shrink-0 items-center justify-center overflow-hidden rounded-full bg-purple-500 text-lg font-semibold text-white">
          {avatar && !avatarFailed ? (
            <img
              src={avatar}
              alt=""
              loading="lazy"
              onError={() => setAvatarFailed(true)}
              className="h-full w-full rounded-full object-cover"
            />
          ) : (
            (name.trim()[0] || "?").toUpperCase()
          )}
        </span>
      ) : (
        <PiRecordFill className="size-12 animate-pulse text-foreground/25" />
      )}
    </div>
  );
};

// Mosaic of participant video tiles: one tile per participant (up to four), so a
// one-person recording shows a single frame, two split, three a mix.
const ProjectThumbnail = ({ spaceId }: { spaceId: string }) => {
  const { data: outputs } = useGetOutputsBySpace(spaceId);

  const ready = (outputs ?? []).filter(
    (o) => o.status === "READY" && o.hasVideo,
  );

  const byParticipant = new Map<string, FinalOutput>();
  for (const output of ready) {
    if (output.type !== "PER_PARTICIPANT" || output.variant === "CLOUD")
      continue;
    const pid =
      output.sourceRecording?.participant?.id ??
      output.targetParticipantId ??
      output.id;
    if (!byParticipant.has(pid)) byParticipant.set(pid, output);
  }

  let tiles = Array.from(byParticipant.values()).slice(0, 4);
  if (tiles.length === 0) {
    const composite = ready.find((o) => o.type === "COMPOSITE");
    if (composite) tiles = [composite];
  }

  if (tiles.length === 0) {
    return (
      <div className="skeleton-shimmer aspect-video overflow-hidden rounded-lg" />
    );
  }

  const count = tiles.length;

  return (
    <div
      className={cn(
        "grid aspect-video gap-0.5 overflow-hidden rounded-lg",
        count === 1 && "grid-cols-1",
        count === 2 && "grid-cols-2",
        count >= 3 && "grid-cols-2 grid-rows-2",
      )}
    >
      {tiles.map((tile, index) => (
        <div
          key={tile.id}
          className={cn(
            "overflow-hidden",
            count === 3 && index === 0 && "row-span-2",
          )}
        >
          <OutputThumb output={tile} />
        </div>
      ))}
    </div>
  );
};

// Soonest deletion in the project = the OLDEST recording's expiry, since each
// recording ages out on its own clock. Null (never / no recordings) renders nothing.
const ProjectRetentionNote = ({ spaceId }: { spaceId: string }) => {
  const { data: outputs } = useGetOutputsBySpace(spaceId);
  const { data: entitlements } = useEntitlements();
  const retentionHours = entitlements?.retentionHours ?? null;

  if (retentionHours == null) return null;

  let soonest: number | null = null;
  for (const output of outputs ?? []) {
    if (output.status !== "READY") continue;
    const session = output.recordingSession;
    const expiry = retentionExpiryMs(
      session?.stoppedAt ?? session?.startedAt ?? output.createdAt,
      retentionHours,
    );
    if (expiry != null && (soonest == null || expiry < soonest)) soonest = expiry;
  }

  const remaining = formatRetentionRemaining(soonest);
  if (!remaining) return null;

  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-foreground/45"
      title="Recordings auto-delete when they reach your plan's retention window."
    >
      <span>·</span>
      <span>oldest deletes in {remaining}</span>
    </span>
  );
};

interface ProjectCardProps {
  space: Space;
  onOpen: (space: Space) => void;
  /** Show the ⋮ rename/delete menu. Hidden e.g. on the dashboard recent list. */
  showOptions?: boolean;
  /** Show the "oldest deletes in X" retention note. Hidden on the recent list. */
  showRetention?: boolean;
}

const ProjectCard = ({
  space,
  onOpen,
  showOptions = true,
  showRetention = true,
}: ProjectCardProps) => {
  const sessionCount = space._count?.recordingSessions ?? 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(space.title || "");
  const renameSpace = useRenameSpace();
  const deleteSpace = useDeleteSpace();

  const openRename = () => {
    setTitle(space.title || "");
    setRenaming(true);
  };

  const submitRename = () => {
    const next = title.trim();
    setRenaming(false);
    if (!next || next === (space.title || "")) return;
    // Optimistic: the hook updates the cache instantly and rolls back on
    // failure, so close the dialog immediately - no loader, no toast.
    renameSpace.mutate({ spaceId: space.id, title: next });
  };

  const handleDelete = () => {
    if (
      !window.confirm(
        "Delete this project permanently? This removes all its recordings and cannot be undone.",
      )
    ) {
      return;
    }
    // Optimistic: the card disappears immediately; the hook rolls back on error.
    deleteSpace.mutate(space.id);
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(space)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(space);
          }
        }}
        className="flex cursor-pointer flex-col gap-3 overflow-hidden rounded-xl border border-call-border bg-call-primary p-3 text-left transition-opacity hover:opacity-80"
      >
        <ProjectThumbnail spaceId={space.id} />

        <div className="flex items-end justify-between gap-2 px-1 pb-1">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate text-sm font-semibold text-foreground">
              {space.title || "Untitled space"}
            </p>
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-foreground/45">
              <span className="whitespace-nowrap">
                {recordingLabel(sessionCount)}
              </span>
              {space.createdAt && (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span>·</span>
                  <span>{formatDate(space.createdAt)}</span>
                </span>
              )}
              {showRetention && <ProjectRetentionNote spaceId={space.id} />}
            </p>
          </div>

          {showOptions && (
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(event) => event.stopPropagation()}
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-call-background hover:text-foreground",
                    menuOpen
                      ? "bg-call-background text-foreground"
                      : "text-foreground/45",
                  )}
                >
                  <FiMoreVertical className="size-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onClick={(event) => event.stopPropagation()}
              >
                <DropdownMenuItem onSelect={openRename}>
                  <FiEdit2 />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void handleDelete()}
                  className="text-red-500 focus:bg-red-500/10 focus:text-red-500 [&_svg]:!text-red-500"
                >
                  <FiTrash2 />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

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
              className="mt-4 w-full rounded-md border border-border bg-primary px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/30"
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
    </>
  );
};

export default ProjectCard;
