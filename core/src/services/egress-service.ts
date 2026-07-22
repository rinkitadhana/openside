/**
 * LiveKit Egress - server-side "cloud recording", one per participant.
 *
 * Alongside each participant's high-quality local (browser) recording, we ALSO
 * start a LiveKit Participant Egress that renders THAT participant's published
 * audio+video into an MP4 written straight to R2. This is the robust cloud
 * backup if a participant's local recording/upload fails.
 *
 * Everything here is best-effort: if egress isn't enabled on the LiveKit plan
 * or R2 rejects the write, we log and carry on - local recording is unaffected.
 */

import {
	EgressClient,
	EgressStatus,
	EncodedFileOutput,
	EncodedFileType,
	S3Upload,
} from "livekit-server-sdk";
import {
	type LiveKitInfra,
	resolveLiveKitForRoom,
	resolveLiveKitForSpace,
	resolveR2CredentialsForSpace,
} from "./infra-service.ts";

function getEgressClient(infra: LiveKitInfra): EgressClient {
	const serviceUrl = infra.url
		.replace(/^wss:\/\//, "https://")
		.replace(/^ws:\/\//, "http://");

	return new EgressClient(serviceUrl, infra.apiKey, infra.apiSecret);
}

async function r2Upload(spaceId: string): Promise<S3Upload> {
	// Egress writes to the space host's own bucket when they self-host.
	const creds = await resolveR2CredentialsForSpace(spaceId);
	return new S3Upload({
		accessKey: creds.accessKeyId,
		secret: creds.secretAccessKey,
		region: "auto",
		endpoint: creds.endpoint,
		bucket: creds.bucket,
		forcePathStyle: true,
	});
}

/** Deterministic R2 key for a participant's cloud-recording MP4. */
export function buildCloudRecordingKey(
	spaceId: string,
	recordingSessionId: string,
	participantId: string,
): string {
	return `spaces/${spaceId}/sessions/${recordingSessionId}/${participantId}/cloud/cloud.mp4`;
}

/** R2 key for a participant's screen-share cloud MP4. Keyed by the screen
 *  ParticipantRecording id: each share in a session is its own recording, so
 *  a second share never overwrites the first's cloud file. */
export function buildScreenCloudRecordingKey(
	spaceId: string,
	recordingSessionId: string,
	participantId: string,
	screenRecordingId: string,
): string {
	return `spaces/${spaceId}/sessions/${recordingSessionId}/${participantId}/cloud/screen-${screenRecordingId}.mp4`;
}

/**
 * Start a participant egress to R2. Returns the egress id, or null if it
 * couldn't be started (which is non-fatal for the recording flow).
 *
 * `screenShare: true` records the participant's screenshare +
 * screenshare_audio tracks instead of camera + microphone.
 */
export async function startParticipantEgress(params: {
	roomName: string;
	spaceId: string;
	identity: string;
	filepath: string;
	screenShare?: boolean;
}): Promise<string | null> {
	try {
		const fileOutput = new EncodedFileOutput({
			fileType: EncodedFileType.MP4,
			filepath: params.filepath,
			output: { case: "s3", value: await r2Upload(params.spaceId) },
		});

		const egressClient = getEgressClient(
			await resolveLiveKitForRoom(params.roomName),
		);
		const info = await egressClient.startParticipantEgress(
			params.roomName,
			params.identity,
			{ file: fileOutput },
			params.screenShare ? { screenShare: true } : undefined,
		);

		return info.egressId || null;
	} catch (error) {
		console.error(
			`[Egress] Failed to start participant egress for ${params.identity}:`,
			error,
		);
		return null;
	}
}

/**
 * Look up the current status of an egress (e.g. "EGRESS_COMPLETE"). Used by the
 * poller to mark cloud recordings ready without relying on the webhook.
 * Returns null if it can't be fetched.
 */
export async function getEgressStatus(
	egressId: string | null | undefined,
	spaceId?: string | null,
): Promise<string | null> {
	if (!egressId) return null;

	try {
		const infra = spaceId
			? await resolveLiveKitForSpace(spaceId)
			: await resolveLiveKitForRoom(null);
		const list = await getEgressClient(infra).listEgress({ egressId });
		const info = list?.[0];
		if (!info) return null;
		return typeof info.status === "number" ? EgressStatus[info.status] : null;
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			(error as { code?: unknown }).code === "not_found"
		) {
			return "NOT_FOUND";
		}
		console.error("[Egress] Failed to fetch egress status:", error);
		return null;
	}
}

/** Stop a running egress. Best-effort. */
export async function stopParticipantEgress(
	egressId: string | null | undefined,
	spaceId?: string | null,
): Promise<void> {
	if (!egressId) return;

	try {
		const infra = spaceId
			? await resolveLiveKitForSpace(spaceId)
			: await resolveLiveKitForRoom(null);
		await getEgressClient(infra).stopEgress(egressId);
	} catch (error) {
		console.error("[Egress] Failed to stop egress:", error);
	}
}
