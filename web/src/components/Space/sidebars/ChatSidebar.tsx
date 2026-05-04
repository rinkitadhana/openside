import React, { FormEvent, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { IoMdSend } from "react-icons/io";
import { useLiveKitChat } from "../chat/LiveKitChatProvider";

interface ChatSidebarProps {
  onClose: () => void;
}

const formatMessageTime = (sentAt: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(sentAt));

const ChatSidebar: React.FC<ChatSidebarProps> = ({ onClose }) => {
  const { localSenderId, messages, sendError, sendMessage } = useLiveKitChat();
  const [draft, setDraft] = useState("");
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const messagesContainer = messagesContainerRef.current;
    if (!messagesContainer) return;

    messagesContainer.scrollTo({
      top: messagesContainer.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const message = draft.trim();
    if (!message) return;

    setDraft("");

    try {
      await sendMessage(message);
    } catch {
      setDraft(message);
    }
  };

  return (
    <div className="flex h-full flex-col p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Chat</h3>
        <button
          onClick={onClose}
          className="select-none rounded-full border border-call-border bg-call-background p-1.5 transition-all duration-300 hover:bg-primary-hover"
          type="button"
          aria-label="Close chat"
        >
          <X size={17} />
        </button>
      </div>

      <div
        ref={messagesContainerRef}
        className="my-5 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-secondary-text">
            No chat yet.
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => {
              const isMine = message.senderId === localSenderId;

              return (
                <div
                  key={message.id}
                  className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}
                >
                  <div className="mb-1 flex max-w-[85%] items-center gap-2 px-1 text-[0.7rem] text-foreground/45">
                    {!isMine && (
                      <span className="truncate font-medium">
                        {message.senderName}
                      </span>
                    )}
                    <span>{formatMessageTime(message.sentAt)}</span>
                  </div>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm leading-5 ${
                      isMine
                        ? "bg-mainclr text-white"
                        : "border border-call-border bg-call-background text-foreground"
                    }`}
                  >
                    {message.message}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-call-border bg-call-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-foreground/40 focus:border-mainclr"
          maxLength={1000}
          placeholder="Message everyone"
          type="text"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-text transition-all duration-200 hover:bg-primary/85 disabled:cursor-not-allowed disabled:bg-call-background disabled:text-foreground/35"
          aria-label="Send message"
        >
          <IoMdSend size={19} />
        </button>
      </form>
      {sendError && <p className="mt-2 text-xs text-red-400">{sendError}</p>}
    </div>
  );
};

export default ChatSidebar;
