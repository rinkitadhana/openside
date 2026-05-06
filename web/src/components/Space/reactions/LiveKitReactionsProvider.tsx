import React, {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import type { Room } from "livekit-client";

export interface LiveKitReactionEvent {
  id: string;
  emoji: string;
  senderId: string;
  senderName: string;
  isLocal: boolean;
  sentAt: string;
}

interface LiveKitReactionsContextValue {
  reactions: LiveKitReactionEvent[];
  sendReaction: (emoji: string) => Promise<void>;
}

const REACTIONS_TOPIC = "openside-call-reactions";
type TextStreamHandler = Parameters<Room["registerTextStreamHandler"]>[1];
type TextStreamReader = Parameters<TextStreamHandler>[0];

const LiveKitReactionsContext =
  createContext<LiveKitReactionsContextValue | null>(null);

export const useLiveKitReactions = () => {
  const context = useContext(LiveKitReactionsContext);

  if (!context) {
    throw new Error(
      "useLiveKitReactions must be used inside LiveKitReactionsProvider",
    );
  }

  return context;
};

export const LiveKitReactionsProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [reactions, setReactions] = useState<LiveKitReactionEvent[]>([]);

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
      const emoji = (await reader.readAll()).trim();
      if (!emoji) return;

      const participant =
        room.remoteParticipants.get(participantInfo.identity) ||
        (participantInfo.identity === room.localParticipant.identity
          ? room.localParticipant
          : null);

      const nextReaction: LiveKitReactionEvent = {
        id: reader.info.id,
        emoji,
        senderId: participantInfo.identity,
        senderName:
          reader.info.attributes?.senderName ||
          participant?.name ||
          participantInfo.identity ||
          "Guest",
        isLocal: participantInfo.identity === localSenderId,
        sentAt: new Date(reader.info.timestamp || Date.now()).toISOString(),
      };

      setReactions((currentReactions) =>
        currentReactions.some((item) => item.id === nextReaction.id)
          ? currentReactions
          : [...currentReactions, nextReaction],
      );
    };

    room.registerTextStreamHandler(REACTIONS_TOPIC, handleTextStream);

    return () => {
      room.unregisterTextStreamHandler(REACTIONS_TOPIC);
    };
  }, [localSenderId, room]);

  const sendReaction = useCallback(
    async (emoji: string) => {
      const trimmedEmoji = emoji.trim();
      if (!trimmedEmoji) return;

      const streamInfo = await room.localParticipant.sendText(trimmedEmoji, {
        topic: REACTIONS_TOPIC,
        attributes: {
          senderName: localSenderName,
        },
      });

      const localReaction: LiveKitReactionEvent = {
        id: streamInfo.id,
        emoji: trimmedEmoji,
        senderId: localSenderId,
        senderName: localSenderName,
        isLocal: true,
        sentAt: new Date(streamInfo.timestamp || Date.now()).toISOString(),
      };

      setReactions((currentReactions) =>
        currentReactions.some((item) => item.id === localReaction.id)
          ? currentReactions
          : [...currentReactions, localReaction],
      );
    },
    [localSenderId, localSenderName, room.localParticipant],
  );

  const value = useMemo(
    () => ({
      reactions,
      sendReaction,
    }),
    [reactions, sendReaction],
  );

  return (
    <LiveKitReactionsContext.Provider value={value}>
      {children}
    </LiveKitReactionsContext.Provider>
  );
};
