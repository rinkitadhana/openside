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

export interface ChatMessageData {
  id: string;
  senderId: string;
  senderName: string;
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
type TextStreamHandler = Parameters<Room["registerTextStreamHandler"]>[1];
type TextStreamReader = Parameters<TextStreamHandler>[0];

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
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);

  const localSenderId = localParticipant.identity;
  const localSenderName = useMemo(
    () => localParticipant.name || localParticipant.identity || "Guest",
    [localParticipant.identity, localParticipant.name],
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
        message,
        sentAt: new Date(reader.info.timestamp || Date.now()).toISOString(),
      };

      setMessages((currentMessages) =>
        currentMessages.some((item) => item.id === receivedMessage.id)
          ? currentMessages
          : [...currentMessages, receivedMessage],
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
        },
      });

      const localMessage: ChatMessageData = {
        id: streamInfo.id,
        senderId: localSenderId,
        senderName: localSenderName,
        message: trimmedMessage,
        sentAt: new Date(streamInfo.timestamp || Date.now()).toISOString(),
      };

      setMessages((currentMessages) =>
        currentMessages.some((item) => item.id === localMessage.id)
          ? currentMessages
          : [...currentMessages, localMessage],
      );
    } catch (error) {
      setSendError(
        error instanceof Error ? error.message : "Unable to send message.",
      );
      throw error;
    }
  }, [localSenderId, localSenderName, room.localParticipant]);

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
