import React, { useState, useEffect } from "react";
import { X, SquarePen, Check, Copy } from "lucide-react";
import { useParams } from "react-router-dom";
import { useGetSpaceByJoinCode, useUpdateSpace } from "@/hooks/useSpace";
import { useGetMe } from "@/hooks/useUserQuery";

interface SidebarContentProps {
  onClose: () => void;
}

const InfoSidebar: React.FC<SidebarContentProps> = ({ onClose }) => {
  const { roomId } = useParams<{ roomId: string }>();
  const { data: spaceData, isLoading } = useGetSpaceByJoinCode(roomId ?? "");
  const { data: user } = useGetMe();
  const updateSpace = useUpdateSpace(spaceData?.id ?? "");

  const isHost = !!user && !!spaceData && user.id === spaceData.host?.id;

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [copied, setCopied] = useState(false);

  const inviteLink = `${window.location.origin}/${roomId}`;

  useEffect(() => {
    if (spaceData) {
      setTitle(spaceData.title ?? "");
      setDescription(spaceData.description ?? "");
    }
  }, [spaceData]);

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

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Space Details</h3>
        <button
          onClick={onClose}
          className="select-none p-1.5 rounded-full bg-call-background hover:bg-primary-hover border border-call-border cursor-pointer transition-all duration-300"
        >
          <X size={17} />
        </button>
      </div>

      <div className="flex-1 mt-6 flex flex-col gap-4">
        {/* Joining info */}
        <div className="flex flex-col gap-2">
          <p className="text-base font-medium text-foreground">Joining info</p>
          <div className="flex flex-col gap-2">
            <p className="w-fit rounded-lg bg-primary-hover px-3 py-2 text-sm font-light text-foreground/70 break-all">{inviteLink}</p>
            <button
              onClick={handleCopy}
              className="flex w-fit items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-blue-300 hover:bg-primary-hover transition-colors cursor-pointer"
              title={copied ? "Copied!" : "Copy link"}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              Copy Joining Link
            </button>
          </div>
        </div>

        <div className="border-t border-call-border" />

        {/* Title & description */}
        {isLoading ? (
          <div className="text-sm text-muted-foreground animate-pulse">Loading...</div>
        ) : editing ? (
          <div className="mt-1 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <textarea
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                rows={2}
                className="min-h-12 w-full resize-y rounded-xl border border-call-border bg-primary-hover px-3 py-2.5 text-sm font-normal text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-blue-300"
                placeholder="Space title"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="min-h-28 w-full resize-y rounded-xl border border-call-border bg-primary-hover px-3 py-2.5 text-sm font-normal text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-blue-300"
                placeholder="Add a description..."
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={updateSpace.isPending}
                className="rounded-lg bg-primary-hover px-3 py-1.5 text-sm font-medium text-foreground hover:bg-foreground/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save
              </button>
              <button
                onClick={handleCancel}
                className="rounded-lg bg-primary-hover px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-1 flex min-w-0 flex-col gap-2">
            <p className="whitespace-pre-wrap break-words text-lg font-medium text-foreground">
              {spaceData?.title || "Untitled Space"}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm font-normal text-foreground/70">
              {spaceData?.description || "No description."}
            </p>
            {isHost && (
              <button
                onClick={() => setEditing(true)}
                className="flex w-fit items-center gap-2 rounded-full bg-primary-hover px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition-colors cursor-pointer"
              >
                <SquarePen size={12} />
                Edit
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default InfoSidebar;
