/**
 * Ask-to-unmute send helper.
 *
 * LiveKit's server API can force-MUTE a remote track but can never force an
 * UNMUTE (browser privacy model: capture must be a local action). So moderators
 * send a request instead - a targeted text-stream message on this topic.
 *
 * Note: the receiver-side prompt was previously shown as a toast; toasts have
 * been removed site-wide, so only the send helper remains here.
 */

import type { Room } from "livekit-client";

export const MEDIA_REQUEST_TOPIC = "openside-media-requests";

export type MediaRequestSource = "microphone" | "camera";

export async function sendMediaRequest(
  room: Room,
  targetIdentity: string,
  source: MediaRequestSource,
) {
  await room.localParticipant.sendText(source, {
    topic: MEDIA_REQUEST_TOPIC,
    destinationIdentities: [targetIdentity],
    attributes: {
      senderName: room.localParticipant.name || "A host",
    },
  });
}
