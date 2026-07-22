import React, { useState, useEffect, useRef } from "react";
import { X, SquarePen, Link2, Hash, Mail } from "lucide-react";
import { useParams } from "react-router-dom";
import { useGetSpaceByJoinCode, useUpdateSpace, useSendSpaceInvite } from "@/hooks/useSpace";
import { useGetMe } from "@/hooks/useUserQuery";
import { toast } from "@/lib/toast";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface SidebarContentProps {
  onClose: () => void;
}

const formatStartTime = (iso?: string) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const InfoSidebar: React.FC<SidebarContentProps> = ({ onClose }) => {
  const { roomId } = useParams<{ roomId: string }>();
  const { data: spaceData, isLoading } = useGetSpaceByJoinCode(roomId ?? "");
  const { data: user } = useGetMe();
  const updateSpace = useUpdateSpace(spaceData?.id ?? "");

  const isHost = !!user && !!spaceData && user.id === spaceData.host?.id;

  const sendInvite = useSendSpaceInvite(spaceData?.id ?? "");

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [copied, setCopied] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const titleTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const descriptionTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const inviteLink = `${window.location.origin}/${roomId}`;

  useEffect(() => {
    if (spaceData) {
      setTitle(spaceData.title ?? "");
      setDescription(spaceData.description ?? "");
    }
  }, [spaceData]);

  const resizeTextareaToContent = (textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  useEffect(() => {
    if (!editing) return;

    resizeTextareaToContent(titleTextareaRef.current);
    resizeTextareaToContent(descriptionTextareaRef.current);
  }, [editing, title, description]);

  const handleSave = () => {
    setEditing(false);
    updateSpace.mutate({
      title: title.trim(),
      description: description.trim(),
    });
  };

  const handleCancel = () => {
    setTitle(spaceData?.title ?? "");
    setDescription(spaceData?.description ?? "");
    setEditing(false);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendInvite = async () => {
    const trimmed = inviteEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed)) {
      return;
    }
    try {
      await sendInvite.mutateAsync(trimmed);
      setInviteEmail("");
      toast.success(`Invite sent to ${trimmed}`);
    } catch {
      toast.error("Couldn't send the invite. Please try again.");
    }
  };

  const host = spaceData?.host;
  const startedAt = formatStartTime(spaceData?.startTime);

  return (
    <div className="flex h-full flex-col p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Space Details</h3>
        <button
          onClick={onClose}
          className="select-none cursor-pointer rounded-full border border-border bg-background p-1.5 transition-all duration-300 hover:bg-primary"
          aria-label="Close"
        >
          <X size={17} />
        </button>
      </div>

      <div className="scrollbar-thin -mr-1 mt-5 flex flex-1 flex-col gap-5 overflow-y-auto pr-1">
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <div className="h-10 w-2/3 animate-pulse rounded-lg bg-primary" />
            <div className="h-16 w-full animate-pulse rounded-lg bg-primary" />
            <div className="h-24 w-full animate-pulse rounded-xl bg-primary" />
          </div>
        ) : (
          <>
            {/* Title & description */}
            {editing && isHost ? (
              <div className="flex flex-col gap-3">
                <textarea
                  ref={titleTextareaRef}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  rows={1}
                  className="min-h-9 w-full resize-y overflow-hidden rounded-xl border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-foreground/40"
                  placeholder="Space title"
                />
                <textarea
                  ref={descriptionTextareaRef}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="min-h-32 w-full resize-y overflow-hidden rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-foreground/40"
                  placeholder="Add a description..."
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={handleSave}
                    disabled={updateSpace.isPending}
                    className="cursor-pointer rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white transition-all duration-150 hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updateSpace.isPending ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={handleCancel}
                    className="cursor-pointer rounded-lg bg-muted px-4 py-1.5 text-sm font-medium text-foreground transition-all duration-150 hover:opacity-80"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 whitespace-pre-wrap break-words text-xl font-semibold text-foreground">
                    {spaceData?.title || "Untitled Space"}
                  </p>
                  {isHost && (
                    <button
                      onClick={() => setEditing(true)}
                      className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-foreground/20 bg-muted px-2.5 py-1 text-xs text-foreground transition-all duration-150 hover:opacity-80"
                    >
                      <SquarePen size={12} />
                      Edit
                    </button>
                  )}
                </div>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/65">
                  {spaceData?.description || "No description added yet."}
                </p>
              </div>
            )}

            {/* Host */}
            {host && (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
                <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-medium text-foreground/70">
                  {host.avatar ? (
                    <img
                      src={host.avatar}
                      alt={host.name}
                      className="size-full object-cover"
                    />
                  ) : (
                    host.name?.charAt(0).toUpperCase() || "H"
                  )}
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">
                    {host.name}
                  </span>
                  <span className="text-xs text-foreground">
                    Host{startedAt ? ` · Started ${startedAt}` : ""}
                  </span>
                </div>
              </div>
            )}

            <div className="border-t border-border" />

            {/* Joining info */}
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-foreground">Joining info</p>

              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <Link2 size={13} />
                  Invite link
                </span>
                <div className="flex items-stretch gap-1.5 rounded-xl border border-border bg-background p-1.5 pl-3 transition-colors duration-150">
                  <p className="flex min-w-0 flex-1 items-center truncate text-sm text-foreground/70">
                    {inviteLink}
                  </p>
                  <button
                    onClick={handleCopy}
                    className="flex shrink-0 cursor-pointer items-center rounded-lg bg-muted px-3 py-2 text-xs font-semibold text-foreground transition-all duration-150 hover:opacity-80"
                    title={copied ? "Copied!" : "Copy link"}
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium text-foreground/60">
                  <Mail size={13} />
                  Invite by email
                </span>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleSendInvite();
                  }}
                  className="flex items-stretch gap-1.5 rounded-xl border border-border bg-background p-1.5 pl-3 transition-colors duration-150"
                >
                  <input
                    type="email"
                    name="info-sidebar-email"
                    required
                    autoComplete="off"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="Enter email address"
                    className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/35"
                  />
                  <button
                    type="submit"
                    disabled={sendInvite.isPending}
                    className="flex shrink-0 cursor-pointer items-center rounded-lg bg-muted px-3 py-2 text-xs font-semibold text-foreground transition-all duration-150 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sendInvite.isPending ? "Sending" : "Send"}
                  </button>
                </form>
              </div>

              {spaceData?.joinCode && (
                <div className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <Hash size={13} />
                    Recording code
                  </span>
                  <p className="w-fit rounded-lg bg-primary px-3 py-1.5 font-mono text-sm tracking-wide text-foreground">
                    {spaceData.joinCode}
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default InfoSidebar;
