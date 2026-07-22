import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import type { Room } from "livekit-client";
import { useGetMe } from "@/hooks/useUserQuery";

export interface ChatMessageData {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  message: string;
  sentAt: string;
}

interface LiveKitChatContextValue {
  localSenderId: string;
  messages: ChatMessageData[];
  sendError: string | null;
  sendMessage: (message: string) => Promise<void>;
}

const CHAT_TOPIC = "openside-call-chat";
// Cap kept messages so a marathon call can't grow memory unboundedly.
const MAX_CHAT_MESSAGES = 500;

const appendMessage = (
  currentMessages: ChatMessageData[],
  message: ChatMessageData,
): ChatMessageData[] => {
  if (currentMessages.some((item) => item.id === message.id)) {
    return currentMessages;
  }
  const next = [...currentMessages, message];
  return next.length > MAX_CHAT_MESSAGES
    ? next.slice(next.length - MAX_CHAT_MESSAGES)
    : next;
};
type TextStreamHandler = Parameters<Room["registerTextStreamHandler"]>[1];
type TextStreamReader = Parameters<TextStreamHandler>[0];

interface ParticipantLike {
  attributes?: Record<string, string>;
  metadata?: string;
}

const getParticipantAvatar = (participant: ParticipantLike | null) => {
  if (!participant) return "";
  if (participant.attributes?.avatar) return participant.attributes.avatar;

  if (!participant.metadata) return "";

  try {
    const metadata = JSON.parse(participant.metadata) as { avatar?: unknown };
    return typeof metadata.avatar === "string" ? metadata.avatar : "";
  } catch {
    return "";
  }
};

const LiveKitChatContext = createContext<LiveKitChatContextValue | null>(null);

export const useLiveKitChat = () => {
  const context = useContext(LiveKitChatContext);

  if (!context) {
    throw new Error("useLiveKitChat must be used inside LiveKitChatProvider");
  }

  return context;
};

export const LiveKitChatProvider = ({ children }: { children: ReactNode }) => {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const { data: localUser } = useGetMe();
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);

  const localSenderId = localParticipant.identity;
  const localSenderName = useMemo(
    () => localParticipant.name || localParticipant.identity || "Guest",
    [localParticipant.identity, localParticipant.name],
  );
  const localSenderAvatar = useMemo(
    () => getParticipantAvatar(localParticipant) || localUser?.avatar || "",
    [localParticipant, localUser?.avatar],
  );

  useEffect(() => {
    const handleTextStream = async (
      reader: TextStreamReader,
      participantInfo: { identity: string },
    ) => {
      const message = (await reader.readAll()).trim();
      if (!message) return;

      const participant =
        room.remoteParticipants.get(participantInfo.identity) ||
        (participantInfo.identity === room.localParticipant.identity
          ? room.localParticipant
          : null);

      const receivedMessage: ChatMessageData = {
        id: reader.info.id,
        senderId: participantInfo.identity,
        senderName:
          reader.info.attributes?.senderName ||
          participant?.name ||
          participantInfo.identity ||
          "Guest",
        senderAvatar:
          reader.info.attributes?.senderAvatar ||
          getParticipantAvatar(participant),
        message,
        sentAt: new Date(reader.info.timestamp || Date.now()).toISOString(),
      };

      setMessages((currentMessages) =>
        appendMessage(currentMessages, receivedMessage),
      );
    };

    room.registerTextStreamHandler(CHAT_TOPIC, handleTextStream);

    return () => {
      room.unregisterTextStreamHandler(CHAT_TOPIC);
    };
  }, [room]);

  const sendMessage = useCallback(async (message: string) => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) return;

    setSendError(null);

    try {
      const streamInfo = await room.localParticipant.sendText(trimmedMessage, {
        topic: CHAT_TOPIC,
        attributes: {
          senderName: localSenderName,
          ...(localSenderAvatar ? { senderAvatar: localSenderAvatar } : {}),
        },
      });

      const localMessage: ChatMessageData = {
        id: streamInfo.id,
        senderId: localSenderId,
        senderName: localSenderName,
        senderAvatar: localSenderAvatar,
        message: trimmedMessage,
        sentAt: new Date(streamInfo.timestamp || Date.now()).toISOString(),
      };

      setMessages((currentMessages) =>
        appendMessage(currentMessages, localMessage),
      );
    } catch (error) {
      setSendError(
        error instanceof Error ? error.message : "Unable to send message.",
      );
      throw error;
    }
  }, [localSenderId, localSenderName, localSenderAvatar, room.localParticipant]);

  const value = useMemo(
    () => ({
      localSenderId,
      messages,
      sendError,
      sendMessage,
    }),
    [localSenderId, messages, sendError, sendMessage],
  );

  return (
    <LiveKitChatContext.Provider value={value}>
      {children}
    </LiveKitChatContext.Provider>
  );
};
