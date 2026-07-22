import React, {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { ArrowUp, X } from "lucide-react";
import { BsChatRight } from "react-icons/bs";
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // True while the user is at (or near) the bottom of the message list,
  // updated on scroll. Read by the autoscroll effect below.
  const isNearBottomRef = useRef(true);

  const handleMessagesScroll = () => {
    const messagesContainer = messagesContainerRef.current;
    if (!messagesContainer) return;

    isNearBottomRef.current =
      messagesContainer.scrollHeight -
        messagesContainer.scrollTop -
        messagesContainer.clientHeight <
      80;
  };

  useEffect(() => {
    const messagesContainer = messagesContainerRef.current;
    if (!messagesContainer) return;

    // Only follow new messages when the user is already at the bottom or just
    // sent one themselves - yanking them down while they're reading older
    // messages loses their place.
    const lastMessage = messages[messages.length - 1];
    const lastIsMine = !!lastMessage && lastMessage.senderId === localSenderId;
    if (!lastIsMine && !isNearBottomRef.current) return;

    messagesContainer.scrollTo({
      top: messagesContainer.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, localSenderId]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const maxHeight = 140;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);

  const submitDraft = async () => {
    const message = draft.trim();
    if (!message) return;

    setDraft("");

    try {
      await sendMessage(message);
    } catch {
      setDraft(message);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitDraft();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitDraft();
    }
  };

  return (
    <div className="flex h-full flex-col p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Chat</h3>
        <button
          onClick={onClose}
          className="select-none rounded-full border border-border bg-background p-1.5 transition-all duration-300 hover:bg-primary"
          type="button"
          aria-label="Close chat"
        >
          <X size={17} />
        </button>
      </div>

      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        className="my-5 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-secondary-text">
            <BsChatRight size={32} className="text-foreground/40" />
            <p className="text-sm">No messages yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => {
              const isMine = message.senderId === localSenderId;

              return (
                <div
                  key={message.id}
                  className={`flex items-start gap-2.5 ${
                    isMine ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  <div
                    className={`flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border text-xs font-medium ${
                      message.senderAvatar
                        ? "bg-muted text-foreground/70"
                        : "bg-brand text-white"
                    }`}
                  >
                    {message.senderAvatar ? (
                      <img
                        src={message.senderAvatar}
                        alt={message.senderName}
                        className="size-full object-cover"
                      />
                    ) : (
                      message.senderName.charAt(0).toUpperCase()
                    )}
                  </div>

                  <div
                    className={`flex min-w-0 max-w-[78%] flex-col ${
                      isMine ? "items-end" : "items-start"
                    }`}
                  >
                    <div
                      className={`whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm leading-5 ${
                        isMine
                          ? "rounded-br-sm bg-muted text-foreground"
                          : "rounded-bl-sm bg-muted text-foreground"
                      }`}
                    >
                      {message.message}
                    </div>
                    <div className="mt-1 flex items-center gap-2 px-0.5 text-[0.7rem] text-foreground/45">
                      <span className="truncate font-medium">
                        {isMine ? "You" : message.senderName}
                      </span>
                      <span>{formatMessageTime(message.sentAt)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 rounded-xl border border-border bg-background pl-3.5 pr-1.5 py-1.5 transition-colors focus-within:border-mainclr"
      >
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          className="scrollbar-thin min-w-0 flex-1 resize-none overflow-hidden bg-transparent py-1.5 text-sm leading-5 outline-none placeholder:text-foreground/40"
          maxLength={1000}
          placeholder="Message everyone"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-white transition-all duration-200 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:opacity-40"
          aria-label="Send message"
        >
          <ArrowUp size={18} strokeWidth={1.75} />
        </button>
      </form>
      {sendError && <p className="mt-2 text-xs text-red-400">{sendError}</p>}
    </div>
  );
};

export default ChatSidebar;
