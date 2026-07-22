import { randomBytes } from "node:crypto";
import { type RecordingType, prisma } from "../db/index.ts";
import {
	DEMO_FPS,
	clampAudioSampleRate,
	clampFps,
	clampRecordingMode,
	clampVideoResolution,
} from "../lib/recording-constants.ts";
import {
	buildCloudRecordingKey,
	buildScreenCloudRecordingKey,
	startParticipantEgress,
	stopParticipantEgress,
} from "./egress-service.ts";
import {
	generateEarlyThumbnailFromChunk,
	maybeFinalizeSession,
} from "./finalization-service.ts";
import { maybeFinalizeScreenSession } from "./screen-finalization-service.ts";
import { deleteObjects } from "./storage-service.ts";
import { assertCanRecord, meterSessionById } from "./usage-service.ts";

interface StartSessionData {
	spaceId: string;
	spaceRecordingSessionId: string;
	/** Per-session cloud backup opt-in (only honored when the plan allows it). */
	cloudBackup?: boolean;
}

interface CreateParticipantRecordingData {
	recordingSessionId: string;
	participantId: string;
	type: RecordingType;
	isScreenShare?: boolean;
	container?: string;
	codec?: string;
	width?: number;
	height?: number;
	fps?: number;
	bitrate?: number;
	sampleRate?: number;
	channels?: number;
	hasAudio?: boolean;
	hasVideo?: boolean;
	startOffsetMs?: number;
}

interface UpdateParticipantRecordingData {
	container?: string;
	codec?: string;
	width?: number;
	height?: number;
	fps?: number;
	bitrate?: number;
	sampleRate?: number;
	channels?: number;
	hasAudio?: boolean;
	hasVideo?: boolean;
	videoQuality?: "P360" | "P480" | "P720" | "P1080" | "P1440" | "P2160";
	audioQuality?: "SR_22050" | "SR_44100" | "SR_48000" | "SR_96000";
	videoLabel?: string;
	audioLabel?: string;
	startOffsetMs?: number;
	durationMs?: number;
	expectedSegments?: number;
}

interface CreateSegmentData {
	participantRecordingId: string;
	spaceRecordingSessionId: string;
	spaceId: string;
	participantId: string;
	sequenceNumber: number;
	assetKey: string;
	startMs: number;
	durationMs: number;
	sizeBytes: bigint;
	checksum?: string;
	// Raw-PCM segments only (undefined for every other track type).
	sampleRate?: number;
	bitDepth?: number;
	channelCount?: number;
}

// Helper Functions

const DERIVED_FORMATS = ["mp4", "mp3", "wav"] as const;
const SCREEN_PROCESSING_TIMEOUT_MS =
	Number(process.env.SCREEN_PROCESSING_TIMEOUT_MS) || 3 * 60 * 60 * 1000;

function addKey(keys: Set<string>, key?: string | null) {
	if (!key) return;
	keys.add(key);
	if (/\.webm$/i.test(key)) {
		for (const format of DERIVED_FORMATS) {
			keys.add(key.replace(/\.webm$/i, `.${format}`));
		}
	}
	// A lossless WAV master (from the PCM track) only ever derives an MP3 (see
	// download-service). Sweep that cached MP3 alongside the WAV.
	if (/\.wav$/i.test(key)) {
		keys.add(key.replace(/\.wav$/i, ".mp3"));
	}
}

function addScreenOutputKeys(keys: Set<string>, outputs: unknown) {
	if (!outputs || typeof outputs !== "object") return;
	for (const value of Object.values(outputs as Record<string, unknown>)) {
		if (!value || typeof value !== "object") continue;
		const key = (value as { key?: unknown }).key;
		if (typeof key === "string") addKey(keys, key);
	}
}

const STALE_RECORDING_UPLOAD_MS =
	Number(process.env.STALE_RECORDING_UPLOAD_MS) || 10 * 60 * 1000;

function hasContiguousSegments(
	segments: { sequenceNumber: number }[],
	expectedSegments: number,
): boolean {
	if (expectedSegments === 0) return true;
	const seen = new Set(segments.map((segment) => segment.sequenceNumber));
	for (
		let sequenceNumber = 0;
		sequenceNumber < expectedSegments;
		sequenceNumber++
	) {
		if (!seen.has(sequenceNumber)) return false;
	}
	return true;
}

function observedExpectedSegments(
	segments: { sequenceNumber: number }[],
): number {
	if (segments.length === 0) return 0;
	return Math.max(...segments.map((segment) => segment.sequenceNumber)) + 1;
}

async function deleteSessionRows(sessionId: string) {
	await prisma.$transaction([
		prisma.finalOutputRendition.deleteMany({
			where: { finalOutput: { recordingSessionId: sessionId } },
		}),
		prisma.finalOutput.deleteMany({ where: { recordingSessionId: sessionId } }),
		prisma.recordingSegment.deleteMany({
			where: { participantRecording: { recordingSessionId: sessionId } },
		}),
		prisma.participantRecording.deleteMany({
			where: { recordingSessionId: sessionId },
		}),
		prisma.recordingComment.deleteMany({
			where: { recordingSessionId: sessionId },
		}),
		prisma.recordingSession.delete({ where: { id: sessionId } }),
	]);
}

/**
 * Delete a recording session, its DB rows, and every stored object it owns -
 * segments, merged files, thumbnails, final outputs, renditions, screen
 * outputs. No ownership check: callers (user-facing deletes do their own,
 * retention sweep is system-initiated) are responsible for authorization.
 */
export async function purgeRecordingSessionCascade(
	sessionId: string,
): Promise<void> {
	const session = await prisma.recordingSession.findUnique({
		where: { id: sessionId },
		select: {
			id: true,
			outputs: true,
			participantRecordings: {
				select: {
					mergedFileKey: true,
					thumbnailKey: true,
					segments: { select: { assetKey: true } },
				},
			},
			finalOutputs: {
				select: {
					masterKey: true,
					audioWavKey: true,
					thumbnailKey: true,
					renditions: { select: { assetKey: true } },
				},
			},
		},
	});

	if (!session) return;

	const keys = new Set<string>();
	addScreenOutputKeys(keys, session.outputs);
	for (const recording of session.participantRecordings) {
		addKey(keys, recording.mergedFileKey);
		addKey(keys, recording.thumbnailKey);
		for (const segment of recording.segments) addKey(keys, segment.assetKey);
	}
	for (const output of session.finalOutputs) {
		addKey(keys, output.masterKey);
		addKey(keys, output.audioWavKey);
		addKey(keys, output.thumbnailKey);
		for (const rendition of output.renditions) addKey(keys, rendition.assetKey);
	}

	await deleteSessionRows(sessionId);
	await deleteObjects([...keys]).catch((error) => {
		console.error(
			`[RecordingCleanup] failed to delete R2 objects for ${sessionId}:`,
			error,
		);
	});
}

export async function isHostOrCoHost(
	spaceId: string,
	participantId: string,
): Promise<boolean> {
	const participant = await prisma.spaceParticipant.findFirst({
		where: {
			id: participantId,
			spaceId,
			role: { in: ["HOST", "CO_HOST"] },
			isActive: true,
		},
	});

	return !!participant;
}

export async function isActiveParticipant(
	spaceId: string,
	participantId: string,
): Promise<boolean> {
	const participant = await prisma.spaceParticipant.findFirst({
		where: {
			id: participantId,
			spaceId,
			isActive: true,
		},
	});

	return !!participant;
}

export async function getParticipantBySessionId(
	spaceId: string,
	participantSessionId: string,
) {
	return await prisma.spaceParticipant.findFirst({
		where: {
			spaceId,
			participantSessionId,
			isActive: true,
		},
	});
}

/**
 * Resolve a participant by session id WITHOUT requiring they still be active.
 *
 * A participant who has LEFT the space must still be able to finish uploading
 * and completing the recording they made while present - otherwise leaving
 * mid-recording abandons whatever they'd already captured. Ownership of the
 * specific recording is still enforced by the caller (owner participantId
 * comparison), so this can't be abused to touch someone else's recording.
 * Rejoin reactivates the same row, so there's exactly one row per session id.
 */
export async function getParticipantBySessionIdAllowInactive(
	spaceId: string,
	participantSessionId: string,
) {
	return await prisma.spaceParticipant.findFirst({
		where: {
			spaceId,
			participantSessionId,
		},
	});
}

// RecordingSession Operations

export async function startRecordingSession(data: StartSessionData) {
	const { spaceId, spaceRecordingSessionId } = data;

	// Check if space exists and is live
	const space = await prisma.space.findUnique({
		where: { id: spaceId },
		select: {
			id: true,
			title: true,
			status: true,
			recordingStatus: true,
			livekitRoomName: true,
			hostId: true,
			host: {
				select: {
					cloudBackupEnabled: true,
					targetFps: true,
					videoResolution: true,
					audioSampleRate: true,
					noiseSuppression: true,
					autoGainControl: true,
					echoCancellation: true,
					recordingMode: true,
				},
			},
		},
	});

	if (!space) {
		throw new Error("SPACE_NOT_FOUND");
	}

	if (space.status !== "LIVE") {
		throw new Error("SPACE_NOT_LIVE");
	}

	if (space.recordingStatus === "RECORDING") {
		throw new Error("RECORDING_ALREADY_ACTIVE");
	}

	// Recording time is billed to the space host. Throws USAGE_EXHAUSTED when
	// their metered credit is spent. Cloud backup defaults to the host's saved
	// preference (Settings → Recording), can be overridden per session by the
	// client, and is only ever honored when the host's plan allows it (never on
	// DEMO). If backup is off, no cloud egress recording is started.
	const entitlements = await assertCanRecord(space.hostId);
	const wantsBackup =
		data.cloudBackup === undefined
			? space.host.cloudBackupEnabled
			: data.cloudBackup === true;
	const cloudBackup = entitlements.cloudBackupAllowed && wantsBackup;

	// Frame rate is chosen ONCE per session by the host and applied to every
	// participant. Snapshot the host's preference now (clamped to 24/30) so
	// finalization can normalize all masters to this single constant rate. DEMO
	// is locked to 24 FPS regardless of the stored preference; only PRO/self-host
	// may pick 30.
	const targetFps =
		entitlements.plan === "demo" ? DEMO_FPS : clampFps(space.host.targetFps);
	// Demo capture is intentionally fixed (the UI mirrors these values) so
	// changed/stale user preferences or direct API calls cannot bypass the plan.
	const videoResolution =
		entitlements.plan === "demo"
			? 720
			: clampVideoResolution(space.host.videoResolution);
	const audioSampleRate =
		entitlements.plan === "demo"
			? 44100
			: clampAudioSampleRate(space.host.audioSampleRate);
	const noiseSuppression = space.host.noiseSuppression;
	const autoGainControl = space.host.autoGainControl;
	const echoCancellation = space.host.echoCancellation;
	const recordingMode = clampRecordingMode(space.host.recordingMode);

	// Atomically claim the space for recording before creating the session. This
	// closes the double-click/socket retry race where two start requests both
	// pass the pre-check and create duplicate ACTIVE sessions.
	const session = await prisma.$transaction(async (tx) => {
		const claimed = await tx.space.updateMany({
			where: {
				id: spaceId,
				status: "LIVE",
				recordingStatus: { not: "RECORDING" },
			},
			data: { recordingStatus: "RECORDING" },
		});

		if (claimed.count === 0) {
			throw new Error("RECORDING_ALREADY_ACTIVE");
		}

		const existingSessionCount = await tx.recordingSession.count({
			where: { spaceId },
		});

		return await tx.recordingSession.create({
			data: {
				spaceId,
				spaceRecordingSessionId,
				title: `Recording ${existingSessionCount + 1}`,
				status: "ACTIVE",
				startedAt: new Date(),
				cloudBackup,
				targetFps,
				videoResolution,
				audioSampleRate,
				noiseSuppression,
				autoGainControl,
				echoCancellation,
				recordingMode,
			},
			include: {
				space: {
					select: {
						id: true,
						title: true,
						joinCode: true,
					},
				},
			},
		});
	});

	// Best-effort per-participant cloud recording via LiveKit egress. Non-fatal:
	// local (browser) recording is the primary path and is unaffected by failures.
	// Only when the host opted in for this session AND their plan allows it.
	if (cloudBackup && space.livekitRoomName) {
		await startParticipantCloudRecordings({
			roomName: space.livekitRoomName,
			spaceId,
			recordingSessionId: session.id,
		}).catch((error) =>
			console.error("[Egress] Failed to start cloud recordings:", error),
		);
	}

	return session;
}

/**
 * Start one LiveKit participant egress per active participant and register a
 * CLOUD per-participant FinalOutput (status QUEUED) for each. The egress id is
 * stashed in processingJobId so the webhook/poll can mark it READY later.
 */
async function startParticipantCloudRecordings(params: {
	roomName: string;
	spaceId: string;
	recordingSessionId: string;
}): Promise<void> {
	const { roomName, spaceId, recordingSessionId } = params;

	const participants = await prisma.spaceParticipant.findMany({
		where: { spaceId, isActive: true, livekitIdentity: { not: null } },
		select: { id: true, livekitIdentity: true },
	});

	for (const participant of participants) {
		if (!participant.livekitIdentity) continue;

		const filepath = buildCloudRecordingKey(
			spaceId,
			recordingSessionId,
			participant.id,
		);

		const egressId = await startParticipantEgress({
			roomName,
			spaceId,
			identity: participant.livekitIdentity,
			filepath,
		});

		if (!egressId) continue;

		await prisma.finalOutput
			.create({
				data: {
					recordingSessionId,
					spaceId,
					type: "PER_PARTICIPANT",
					mode: "MIXED",
					variant: "CLOUD",
					targetParticipantId: participant.id,
					masterKey: filepath,
					mimeType: "video/mp4",
					hasVideo: true,
					hasAudio: true,
					status: "QUEUED",
					processingJobId: egressId,
				},
			})
			.catch((error) =>
				console.error(
					`[Egress] Failed to register cloud output for ${participant.id}:`,
					error,
				),
			);
	}
}

/**
 * Stop all in-flight cloud egresses for a session and mark their outputs as
 * PROCESSING (the egress writes the final MP4 after stop; READY is set when the
 * egress completes).
 */
async function stopParticipantCloudRecordings(
	recordingSessionId: string,
): Promise<void> {
	const cloudOutputs = await prisma.finalOutput.findMany({
		where: {
			recordingSessionId,
			variant: "CLOUD",
			status: { in: ["QUEUED", "PROCESSING"] },
			processingJobId: { not: null },
		},
		select: { id: true, processingJobId: true, spaceId: true },
	});

	for (const output of cloudOutputs) {
		await stopParticipantEgress(output.processingJobId, output.spaceId);
		await prisma.finalOutput
			.update({ where: { id: output.id }, data: { status: "PROCESSING" } })
			.catch(() => undefined);
	}
}

export async function stopRecordingSession(sessionId: string) {
	const session = await prisma.recordingSession.findUnique({
		where: { id: sessionId },
		select: { id: true, status: true, spaceId: true },
	});

	if (!session) {
		throw new Error("SESSION_NOT_FOUND");
	}

	// Credit the final stretch since the last heartbeat before the session
	// stops being ACTIVE (metering only advances on active sessions).
	if (session.status === "ACTIVE") {
		await meterSessionById(sessionId).catch((error) =>
			console.error(
				`[Usage] final meter on stop failed for ${sessionId}:`,
				error,
			),
		);
	}

	if (session.status !== "ACTIVE") {
		const existing = await prisma.recordingSession.findUnique({
			where: { id: sessionId },
			include: {
				space: {
					select: {
						id: true,
						title: true,
						joinCode: true,
					},
				},
				participantRecordings: {
					select: {
						id: true,
						participantId: true,
						type: true,
						status: true,
						uploadedSegments: true,
					},
				},
			},
		});
		if (existing) return existing;
		throw new Error("SESSION_NOT_ACTIVE");
	}

	// Stop the session and release the space's recording lock first. Cloud egress
	// shutdown may take a moment, but it must not block a host from starting the
	// next recording session once the previous one is officially stopped.
	const sessionUpdate = prisma.recordingSession.update({
		where: { id: sessionId },
		data: {
			status: "STOPPED",
			stoppedAt: new Date(),
		},
		include: {
			space: {
				select: {
					id: true,
					title: true,
					joinCode: true,
				},
			},
			participantRecordings: {
				select: {
					id: true,
					participantId: true,
					type: true,
					status: true,
					uploadedSegments: true,
				},
			},
		},
	});

	// SCREEN_RECORDER sessions have no space to update.
	if (!session.spaceId) {
		const updatedSession = await sessionUpdate;
		void maybeFinalizeSession(sessionId);
		return updatedSession;
	}

	const [updatedSession] = await prisma.$transaction([
		sessionUpdate,
		prisma.space.update({
			where: { id: session.spaceId },
			data: { recordingStatus: "STOPPED" },
		}),
	]);

	// Stop per-participant cloud egresses in the background. The egress_ended
	// webhook (or its poll fallback) marks each CLOUD output READY.
	void stopParticipantCloudRecordings(sessionId).catch((error) =>
		console.error("[Egress] Failed to stop cloud recordings:", error),
	);

	void maybeFinalizeSession(sessionId);

	return updatedSession;
}

/**
 * Stop every ACTIVE recording session of a space - final-stretch metering,
 * cloud egress shutdown and finalization included. Every path that ends a
 * space MUST call this: a session left ACTIVE after its space ends is metered
 * wall-clock by the usage sweep and silently burns the owner's credit.
 */
export async function stopActiveSpaceRecordingSessions(
	spaceId: string,
): Promise<void> {
	const sessions = await prisma.recordingSession.findMany({
		where: { spaceId, status: "ACTIVE" },
		select: { id: true },
	});

	for (const session of sessions) {
		await stopRecordingSession(session.id).catch((error) =>
			console.error(
				`[Recording] failed to stop session ${session.id} of ended space ${spaceId}:`,
				error,
			),
		);
	}
}

export async function getRecordingSessionById(sessionId: string) {
	const session = await prisma.recordingSession.findUnique({
		where: { id: sessionId },
		include: {
			space: {
				select: {
					id: true,
					title: true,
					joinCode: true,
					hostId: true,
				},
			},
			participantRecordings: {
				include: {
					participant: {
						select: {
							id: true,
							displayName: true,
							user: {
								select: {
									id: true,
									name: true,
									avatar: true,
								},
							},
						},
					},
				},
			},
		},
	});

	return session;
}

export async function getRecordingSessionsBySpaceId(spaceId: string) {
	// Verify space exists
	const space = await prisma.space.findUnique({
		where: { id: spaceId },
		select: { id: true },
	});

	if (!space) {
		throw new Error("SPACE_NOT_FOUND");
	}

	const sessions = await prisma.recordingSession.findMany({
		where: { spaceId },
		include: {
			space: { select: { title: true } },
			participantRecordings: {
				select: {
					id: true,
					participantId: true,
					type: true,
					status: true,
					isComplete: true,
					isScreenShare: true,
					hasVideo: true,
					hasAudio: true,
					durationMs: true,
					thumbnailKey: true,
					createdAt: true,
					participant: {
						select: {
							id: true,
							displayName: true,
							livekitIdentity: true,
							user: { select: { name: true, avatar: true } },
						},
					},
				},
			},
		},
		orderBy: { startedAt: "desc" },
	});

	for (const session of sessions) {
		const allRecordingsComplete =
			session.participantRecordings.length > 0 &&
			session.participantRecordings.every((recording) => recording.isComplete);
		const hasFailedRecordings = session.participantRecordings.some(
			(recording) => recording.status === "FAILED",
		);

		if (
			((session.status === "STOPPED" || session.status === "FAILED") &&
				allRecordingsComplete) ||
			(session.status === "READY" &&
				allRecordingsComplete &&
				hasFailedRecordings)
		) {
			void maybeFinalizeSession(session.id);
		}
	}

	// Older project recordings have no title. Number all unnamed sessions in
	// chronological order, and also replace the short-lived project-title
	// fallback that was previously stored for project sessions.
	const sessionNumberById = new Map(
		[...sessions]
			.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
			.map((session, index) => [session.id, index + 1]),
	);

	return sessions.map(({ space, ...session }) => ({
		...session,
		title:
			session.title && session.title !== space?.title
				? session.title
				: `Recording ${sessionNumberById.get(session.id)}`,
	}));
}

export async function getActiveSessionBySpaceId(spaceId: string) {
	return await prisma.recordingSession.findFirst({
		where: {
			spaceId,
			status: "ACTIVE",
		},
		select: {
			id: true,
			spaceId: true,
			spaceRecordingSessionId: true,
			startedAt: true,
			stoppedAt: true,
			status: true,
			createdAt: true,
			videoResolution: true,
			audioSampleRate: true,
			noiseSuppression: true,
			autoGainControl: true,
			echoCancellation: true,
			recordingMode: true,
		},
	});
}

// ParticipantRecording Operations

export async function createParticipantRecording(
	data: CreateParticipantRecordingData,
) {
	const {
		recordingSessionId,
		participantId,
		type,
		isScreenShare,
		...metadata
	} = data;

	// Verify recording session exists and is active
	const session = await prisma.recordingSession.findUnique({
		where: { id: recordingSessionId },
		select: {
			id: true,
			status: true,
			spaceId: true,
			cloudBackup: true,
			space: { select: { livekitRoomName: true } },
		},
	});

	if (!session) {
		throw new Error("SESSION_NOT_FOUND");
	}

	if (session.status !== "ACTIVE") {
		throw new Error("SESSION_NOT_ACTIVE");
	}

	// This path is space-only; screen recordings use createScreenRecording.
	if (!session.spaceId) {
		throw new Error("SESSION_NOT_FOUND");
	}

	// Verify participant exists and belongs to the space
	const participant = await prisma.spaceParticipant.findFirst({
		where: {
			id: participantId,
			spaceId: session.spaceId,
		},
	});

	if (!participant) {
		throw new Error("PARTICIPANT_NOT_FOUND");
	}

	// Create participant recording and update participant's hasRecording flag
	const [recording] = await prisma.$transaction([
		prisma.participantRecording.create({
			data: {
				recordingSessionId,
				participantId,
				type,
				isScreenShare: isScreenShare ?? false,
				status: "UPLOADING",
				...metadata,
			},
			include: {
				participant: {
					select: {
						id: true,
						displayName: true,
						user: {
							select: {
								id: true,
								name: true,
								avatar: true,
							},
						},
					},
				},
				recordingSession: {
					select: {
						id: true,
						spaceRecordingSessionId: true,
						spaceId: true,
					},
				},
			},
		}),
		prisma.spaceParticipant.update({
			where: { id: participantId },
			data: { hasRecording: true },
		}),
	]);

	// Cloud-backed session and this is a screen-share track: the camera egress
	// never captures the screenshare tracks, so start a SECOND participant
	// egress in screenShare mode for it. This hook covers both a share active
	// at recording start and one begun mid-session - the client registers the
	// screen ParticipantRecording through here in both cases. Best-effort:
	// the local screen recording is unaffected if egress can't start.
	if (
		isScreenShare &&
		type === "VIDEO" &&
		session.cloudBackup &&
		session.space?.livekitRoomName &&
		participant.livekitIdentity
	) {
		await startScreenShareCloudRecording({
			roomName: session.space.livekitRoomName,
			spaceId: session.spaceId,
			recordingSessionId,
			participantId: participant.id,
			livekitIdentity: participant.livekitIdentity,
			screenRecordingId: recording.id,
			hasAudio: data.hasAudio !== false,
		}).catch((error) =>
			console.error(
				`[Egress] screen cloud recording failed to start for ${recording.id}:`,
				error,
			),
		);
	}

	return recording;
}

/**
 * Start a screenShare-mode participant egress and register its CLOUD
 * FinalOutput. Linked to the screen ParticipantRecording via
 * sourceRecordingId, which is how the UI pairs it with the screen row
 * (the camera cloud output has no sourceRecordingId).
 */
async function startScreenShareCloudRecording(params: {
	roomName: string;
	spaceId: string;
	recordingSessionId: string;
	participantId: string;
	livekitIdentity: string;
	screenRecordingId: string;
	hasAudio: boolean;
}): Promise<void> {
	const filepath = buildScreenCloudRecordingKey(
		params.spaceId,
		params.recordingSessionId,
		params.participantId,
		params.screenRecordingId,
	);

	const egressId = await startParticipantEgress({
		roomName: params.roomName,
		spaceId: params.spaceId,
		identity: params.livekitIdentity,
		filepath,
		screenShare: true,
	});

	if (!egressId) return;

	await prisma.finalOutput.create({
		data: {
			recordingSessionId: params.recordingSessionId,
			spaceId: params.spaceId,
			type: "PER_PARTICIPANT",
			mode: "MIXED",
			variant: "CLOUD",
			targetParticipantId: params.participantId,
			sourceRecordingId: params.screenRecordingId,
			masterKey: filepath,
			mimeType: "video/mp4",
			hasVideo: true,
			// Mirrors the local screen track: a share without system audio
			// produces an audio-less egress too, and offering an mp3 for it
			// would 400 at download time.
			hasAudio: params.hasAudio,
			status: "QUEUED",
			processingJobId: egressId,
		},
	});
}

export async function updateParticipantRecording(
	recordingId: string,
	data: UpdateParticipantRecordingData,
) {
	const recording = await prisma.participantRecording.findUnique({
		where: { id: recordingId },
		select: { id: true },
	});

	if (!recording) {
		throw new Error("RECORDING_NOT_FOUND");
	}

	const updatedRecording = await prisma.participantRecording.update({
		where: { id: recordingId },
		data: {
			...data,
			lastChunkAt: new Date(),
		},
		include: {
			participant: {
				select: {
					id: true,
					displayName: true,
				},
			},
		},
	});

	return updatedRecording;
}

export async function getParticipantRecordingById(recordingId: string) {
	const recording = await prisma.participantRecording.findUnique({
		where: { id: recordingId },
		include: {
			participant: {
				select: {
					id: true,
					displayName: true,
					spaceId: true,
					user: {
						select: {
							id: true,
							name: true,
							avatar: true,
						},
					},
				},
			},
			recordingSession: {
				select: {
					id: true,
					spaceRecordingSessionId: true,
					spaceId: true,
					status: true,
				},
			},
			segments: {
				select: {
					id: true,
					sequenceNumber: true,
					status: true,
				},
				orderBy: { sequenceNumber: "asc" },
			},
		},
	});

	return recording;
}

export async function getRecordingsBySessionId(sessionId: string) {
	// Verify session exists
	const session = await prisma.recordingSession.findUnique({
		where: { id: sessionId },
		select: { id: true },
	});

	if (!session) {
		throw new Error("SESSION_NOT_FOUND");
	}

	const recordings = await prisma.participantRecording.findMany({
		where: { recordingSessionId: sessionId },
		include: {
			participant: {
				select: {
					id: true,
					displayName: true,
					role: true,
					user: {
						select: {
							id: true,
							name: true,
							avatar: true,
						},
					},
				},
			},
		},
		orderBy: { createdAt: "asc" },
	});

	return recordings;
}

export async function markRecordingComplete(
	recordingId: string,
	expectedSegments: number,
) {
	const recording = await prisma.participantRecording.findUnique({
		where: { id: recordingId },
		select: {
			id: true,
			uploadedSegments: true,
			status: true,
			segments: { select: { sequenceNumber: true } },
		},
	});

	if (!recording) {
		throw new Error("RECORDING_NOT_FOUND");
	}

	if (recording.status === "READY") {
		throw new Error("RECORDING_ALREADY_COMPLETE");
	}

	const normalizedExpectedSegments = Math.max(0, Math.round(expectedSegments));
	const actualUploadedSegments = recording.segments.length;
	const isComplete =
		actualUploadedSegments >= normalizedExpectedSegments &&
		hasContiguousSegments(recording.segments, normalizedExpectedSegments);

	const updatedRecording = await prisma.participantRecording.update({
		where: { id: recordingId },
		data: {
			expectedSegments: normalizedExpectedSegments,
			uploadedSegments: actualUploadedSegments,
			isComplete,
			status: isComplete ? "UPLOADED" : "UPLOADING",
		},
		include: {
			participant: {
				select: {
					id: true,
					displayName: true,
				},
			},
			segments: {
				select: {
					id: true,
					sequenceNumber: true,
					status: true,
				},
				orderBy: { sequenceNumber: "asc" },
			},
		},
	});

	// When this recording is fully uploaded, it may be the last one the session
	// was waiting on - try to kick off finalization (no-op if others are pending).
	if (isComplete) {
		void maybeFinalizeSession(updatedRecording.recordingSessionId);
	}

	return updatedRecording;
}

// RecordingSegment Operations

export async function createSegment(data: CreateSegmentData) {
	const { participantRecordingId, ...segmentData } = data;

	// Verify participant recording exists
	const recording = await prisma.participantRecording.findUnique({
		where: { id: participantRecordingId },
		select: { id: true, uploadedSegments: true },
	});

	if (!recording) {
		throw new Error("RECORDING_NOT_FOUND");
	}

	try {
		// Create segment and increment uploadedSegments counter
		const [segment] = await prisma.$transaction([
			prisma.recordingSegment.create({
				data: {
					participantRecordingId,
					...segmentData,
					status: "UPLOADED",
				},
			}),
			prisma.participantRecording.update({
				where: { id: participantRecordingId },
				data: {
					uploadedSegments: { increment: 1 },
					lastChunkAt: new Date(),
				},
			}),
		]);

		// First chunk of a camera track → kick off an early poster thumbnail so
		// it's ready long before finalization. Fire-and-forget; never blocks the
		// upload. Screen shares are skipped (the card shows people, not screens).
		if (segmentData.sequenceNumber === 0) {
			void generateFirstChunkThumbnail(
				participantRecordingId,
				segmentData.assetKey,
			);
		}

		return segment;
	} catch (error) {
		// Handle unique constraint violation (duplicate sequence number)
		if (error instanceof Error && error.message.includes("Unique constraint")) {
			const existing = await prisma.recordingSegment.findUnique({
				where: {
					participantRecordingId_sequenceNumber: {
						participantRecordingId,
						sequenceNumber: segmentData.sequenceNumber,
					},
				},
			});
			if (existing) return existing;
			throw new Error("DUPLICATE_SEQUENCE_NUMBER");
		}
		throw error;
	}
}

/**
 * Resolve the recording's context and, if it's a camera video track that
 * doesn't already have a thumbnail, generate one from its first chunk.
 */
async function generateFirstChunkThumbnail(
	participantRecordingId: string,
	chunkKey: string,
): Promise<void> {
	try {
		const rec = await prisma.participantRecording.findUnique({
			where: { id: participantRecordingId },
			select: {
				id: true,
				hasVideo: true,
				isScreenShare: true,
				participantId: true,
				thumbnailKey: true,
				recordingSession: { select: { id: true, spaceId: true } },
			},
		});

		if (
			!rec ||
			!rec.hasVideo ||
			rec.isScreenShare ||
			!rec.participantId ||
			rec.thumbnailKey ||
			!rec.recordingSession?.spaceId
		) {
			return;
		}

		await generateEarlyThumbnailFromChunk({
			chunkKey,
			spaceId: rec.recordingSession.spaceId,
			recordingSessionId: rec.recordingSession.id,
			participantId: rec.participantId,
			recordingId: rec.id,
		});
	} catch (error) {
		console.error("[Thumbnail] first-chunk thumbnail trigger failed:", error);
	}
}

export async function reconcileStaleRecordingSessions(): Promise<void> {
	const cutoff = new Date(Date.now() - STALE_RECORDING_UPLOAD_MS);
	// Reap ACTIVE sessions with no chunk upload inside the window - the clients
	// are gone (crashed tab, killed browser). Covers BOTH sources: an abandoned
	// session left ACTIVE keeps getting billed wall-clock time by the usage
	// sweep, so this is the billing backstop of last resort. Stopped raw (no
	// stopRecordingSession) on purpose: the dead stretch must NOT be metered.
	const abandoned = await prisma.recordingSession.findMany({
		where: {
			source: { in: ["SPACE", "SCREEN_RECORDER"] },
			status: "ACTIVE",
			startedAt: { lte: cutoff },
			participantRecordings: {
				none: { lastChunkAt: { gt: cutoff } },
			},
		},
		select: { id: true, spaceId: true },
	});

	if (abandoned.length > 0) {
		const abandonedIds = abandoned.map((s) => s.id);
		const abandonedSpaceIds = abandoned
			.map((s) => s.spaceId)
			.filter((id): id is string => id !== null);

		console.warn(
			`[Recording] reaping ${abandoned.length} abandoned ACTIVE session(s): ${abandonedIds.join(", ")}`,
		);

		await prisma.$transaction([
			prisma.recordingSession.updateMany({
				where: { id: { in: abandonedIds }, status: "ACTIVE" },
				data: { status: "STOPPED", stoppedAt: new Date() },
			}),
			// Release the recording lock on any space still LIVE so the host can
			// start a fresh session.
			prisma.space.updateMany({
				where: { id: { in: abandonedSpaceIds }, recordingStatus: "RECORDING" },
				data: { recordingStatus: "STOPPED" },
			}),
		]);
	}

	const sessions = await prisma.recordingSession.findMany({
		where: {
			source: { in: ["SPACE", "SCREEN_RECORDER"] },
			// READY is included on purpose: a late joiner whose client-side
			// /complete never lands (drain timeout, a swallowed request, or a
			// closed tab) leaves their track stuck isComplete:false. Meanwhile the
			// first participant to finish already flipped the session to READY, so
			// without READY here that stuck track would never be force-completed
			// and would never appear in the project. Force-completing it from the
			// segments actually uploaded lets it finalize like everyone else.
			status: { in: ["STOPPED", "PROCESSING", "READY"] },
			stoppedAt: { lte: cutoff },
			participantRecordings: { some: { isComplete: false } },
		},
		select: {
			id: true,
			source: true,
			participantRecordings: {
				where: { isComplete: false },
				select: {
					id: true,
					segments: { select: { sequenceNumber: true } },
				},
			},
		},
		take: 25,
	});

	for (const session of sessions) {
		for (const recording of session.participantRecordings) {
			const expectedSegments = observedExpectedSegments(recording.segments);
			await prisma.participantRecording.update({
				where: { id: recording.id },
				data: {
					expectedSegments,
					uploadedSegments: recording.segments.length,
					isComplete: true,
					status: recording.segments.length > 0 ? "UPLOADED" : "FAILED",
					processingError:
						recording.segments.length > 0
							? null
							: "No segments uploaded before stale upload timeout",
				},
			});
		}

		if (session.source === "SCREEN_RECORDER") {
			await maybeFinalizeScreenSession(session.id);
		} else {
			await maybeFinalizeSession(session.id);
		}
	}

	// Backstop for per-track finalization: a track can reach UPLOADED in the
	// small window after a finalize run already scanned, so its re-trigger gets
	// deduped and it's left uploaded-but-unencoded. These aren't caught above
	// (that pass only looks for isComplete:false), so re-kick any session that
	// still has an uploaded track waiting. No time cutoff - it's ready now.
	//
	// READY is included on purpose: a late joiner finishes uploading AFTER the
	// first participant's track already flipped the session to READY, and their
	// finalize re-trigger is deduped against that finished run. Without READY
	// here, their UPLOADED track would stay orphaned forever and never appear in
	// the project. finalizeSession only claims UPLOADED tracks and never
	// downgrades a READY session, so re-kicking it just picks up the straggler.
	const stuck = await prisma.recordingSession.findMany({
		where: {
			source: "SPACE",
			status: { in: ["STOPPED", "PROCESSING", "READY"] },
			participantRecordings: { some: { status: "UPLOADED" } },
		},
		select: { id: true },
		take: 25,
	});

	for (const session of stuck) {
		await maybeFinalizeSession(session.id);
	}
}

export async function getSegmentsByRecordingId(recordingId: string) {
	// Verify recording exists
	const recording = await prisma.participantRecording.findUnique({
		where: { id: recordingId },
		select: { id: true },
	});

	if (!recording) {
		throw new Error("RECORDING_NOT_FOUND");
	}

	const segments = await prisma.recordingSegment.findMany({
		where: { participantRecordingId: recordingId },
		orderBy: { sequenceNumber: "asc" },
	});

	return segments;
}

// Authorization Helpers

export async function canAccessRecordingSession(
	sessionId: string,
	userId: string,
): Promise<boolean> {
	const session = await prisma.recordingSession.findUnique({
		where: { id: sessionId },
		select: {
			userId: true,
			space: {
				select: {
					hostId: true,
					participants: {
						where: { userId },
						select: { id: true },
					},
				},
			},
		},
	});

	if (!session) return false;

	// SCREEN_RECORDER sessions: only the owning user can access.
	if (!session.space) return session.userId === userId;

	// Host can always access
	if (session.space.hostId === userId) return true;

	// Participant can access
	return session.space.participants.length > 0;
}

export async function getRecordingOwnerParticipantId(
	recordingId: string,
): Promise<string | null> {
	const recording = await prisma.participantRecording.findUnique({
		where: { id: recordingId },
		select: { participantId: true },
	});

	return recording?.participantId ?? null;
}

/**
 * Resolve everything needed to build a deterministic storage key for a chunk:
 * the owning participant, the recording session, and the space.
 */
export async function getRecordingStorageContext(recordingId: string): Promise<{
	participantId: string;
	recordingSessionId: string;
	spaceId: string;
} | null> {
	const recording = await prisma.participantRecording.findUnique({
		where: { id: recordingId },
		select: {
			participantId: true,
			recordingSessionId: true,
			recordingSession: { select: { spaceId: true } },
		},
	});

	if (
		!recording ||
		!recording.participantId ||
		!recording.recordingSession.spaceId
	) {
		return null;
	}

	return {
		participantId: recording.participantId,
		recordingSessionId: recording.recordingSessionId,
		spaceId: recording.recordingSession.spaceId,
	};
}

export async function deleteSpaceRecordingSession(
	sessionId: string,
	userId: string,
): Promise<{ deleted: true }> {
	const session = await prisma.recordingSession.findUnique({
		where: { id: sessionId },
		select: {
			id: true,
			source: true,
			space: { select: { hostId: true } },
			participantRecordings: {
				select: {
					mergedFileKey: true,
					segments: { select: { assetKey: true } },
				},
			},
			finalOutputs: {
				select: {
					masterKey: true,
					audioWavKey: true,
					thumbnailKey: true,
					renditions: { select: { assetKey: true } },
				},
			},
		},
	});

	if (!session || session.source !== "SPACE" || !session.space) {
		throw new Error("SESSION_NOT_FOUND");
	}

	if (session.space.hostId !== userId) {
		throw new Error("FORBIDDEN");
	}

	const keys = new Set<string>();
	for (const recording of session.participantRecordings) {
		addKey(keys, recording.mergedFileKey);
		for (const segment of recording.segments) addKey(keys, segment.assetKey);
	}
	for (const output of session.finalOutputs) {
		addKey(keys, output.masterKey);
		addKey(keys, output.audioWavKey);
		addKey(keys, output.thumbnailKey);
		for (const rendition of output.renditions) addKey(keys, rendition.assetKey);
	}

	await deleteSessionRows(sessionId);
	await deleteObjects([...keys]).catch((error) => {
		console.error(
			`[RecordingCleanup] failed to delete R2 objects for ${sessionId}:`,
			error,
		);
	});

	return { deleted: true };
}

export async function renameSpaceRecordingSession(
	sessionId: string,
	userId: string,
	title: string,
) {
	const session = await prisma.recordingSession.findUnique({
		where: { id: sessionId },
		select: {
			id: true,
			source: true,
			space: { select: { hostId: true } },
		},
	});

	if (!session || session.source !== "SPACE" || !session.space) {
		throw new Error("SESSION_NOT_FOUND");
	}

	if (session.space.hostId !== userId) {
		throw new Error("FORBIDDEN");
	}

	return await prisma.recordingSession.update({
		where: { id: sessionId },
		data: { title },
		select: { id: true, spaceId: true, title: true },
	});
}

// Share links + comments (screen recorder)

/** Unguessable public link id. 192 bits of entropy - the token IS the auth. */
function generateShareToken(): string {
	return randomBytes(24).toString("base64url");
}

async function assertScreenSessionOwner(sessionId: string, userId: string) {
	const session = await prisma.recordingSession.findUnique({
		where: { id: sessionId },
		select: { id: true, source: true, userId: true, shareToken: true },
	});

	if (!session || session.source !== "SCREEN_RECORDER") {
		throw new Error("SESSION_NOT_FOUND");
	}
	if (session.userId !== userId) {
		throw new Error("FORBIDDEN");
	}
	return session;
}

async function assertSpaceSessionOwner(sessionId: string, userId: string) {
	const session = await prisma.recordingSession.findUnique({
		where: { id: sessionId },
		select: {
			id: true,
			source: true,
			shareToken: true,
			space: { select: { hostId: true } },
		},
	});

	if (!session || session.source !== "SPACE" || !session.space) {
		throw new Error("SESSION_NOT_FOUND");
	}
	if (session.space.hostId !== userId) throw new Error("FORBIDDEN");
	return session;
}

/**
 * Turn on public sharing and return the token. Idempotent: an already-shared
 * session keeps its existing token, so re-opening the dialog never invalidates
 * a link the owner already sent out.
 */
export async function enableScreenRecordingShare(
	sessionId: string,
	userId: string,
): Promise<{ shareToken: string }> {
	const session = await assertScreenSessionOwner(sessionId, userId);
	if (session.shareToken) return { shareToken: session.shareToken };

	const updated = await prisma.recordingSession.update({
		where: { id: sessionId },
		data: { shareToken: generateShareToken(), sharedAt: new Date() },
		select: { shareToken: true },
	});
	return { shareToken: updated.shareToken as string };
}

/** Revoke the link. Any URL already handed out stops working immediately. */
export async function disableScreenRecordingShare(
	sessionId: string,
	userId: string,
): Promise<void> {
	await assertScreenSessionOwner(sessionId, userId);
	await prisma.recordingSession.update({
		where: { id: sessionId },
		data: { shareToken: null, sharedAt: null },
	});
}

/** Enable a public share link for one host-owned Space recording session. */
export async function enableSpaceRecordingShare(
	sessionId: string,
	userId: string,
): Promise<{ shareToken: string }> {
	const session = await assertSpaceSessionOwner(sessionId, userId);
	if (session.shareToken) return { shareToken: session.shareToken };

	const updated = await prisma.recordingSession.update({
		where: { id: sessionId },
		data: { shareToken: generateShareToken(), sharedAt: new Date() },
		select: { shareToken: true },
	});
	return { shareToken: updated.shareToken as string };
}

/** Revoke a Space recording's public link immediately. */
export async function disableSpaceRecordingShare(
	sessionId: string,
	userId: string,
): Promise<void> {
	await assertSpaceSessionOwner(sessionId, userId);
	await prisma.recordingSession.update({
		where: { id: sessionId },
		data: { shareToken: null, sharedAt: null },
	});
}

export interface SharedSpaceTrack {
	id: string;
	title: string;
	mimeType: string | null;
	durationMs: number | null;
	width: number | null;
	height: number | null;
	fps: number | null;
	bitrate: number | null;
	hasVideo: boolean;
	hasAudio: boolean;
	/** Screen-share tracks carry only the (lossy) system sound, so they never
	 *  offer a lossless WAV download. */
	isScreenShare: boolean;
	/** The normal track master, plus its optional aligned/cloud counterparts. */
	alignedOutputId: string | null;
	cloudOutputId: string | null;
	cloudHasVideo: boolean;
	cloudHasAudio: boolean;
}

export interface SharedRecordingView {
	id: string;
	source: "SCREEN_RECORDER" | "SPACE";
	title: string | null;
	description: string | null;
	status: string;
	startedAt: Date;
	stoppedAt: Date | null;
	ownerName: string | null;
	/** Output kinds that exist, WITHOUT their storage keys. */
	kinds: string[];
	/** Ready, playable Space tracks. Empty for a screen-recorder session. */
	tracks: SharedSpaceTrack[];
}

/**
 * Public read of a shared recording. Deliberately returns no storage keys, no
 * owner id, and nothing about the session's internals - just what the share
 * page renders. Only READY sessions resolve: a link handed out early must not
 * expose a half-finalized recording.
 */
export async function getSharedRecording(
	token: string,
): Promise<SharedRecordingView | null> {
	const session = await prisma.recordingSession.findUnique({
		where: { shareToken: token },
		select: {
			id: true,
			source: true,
			title: true,
			description: true,
			status: true,
			startedAt: true,
			stoppedAt: true,
			outputs: true,
			user: { select: { name: true } },
			space: {
				select: {
					title: true,
					description: true,
					host: { select: { name: true } },
				},
			},
			finalOutputs: {
				where: { status: "READY", masterKey: { not: null } },
				select: {
					id: true,
					type: true,
					variant: true,
					mimeType: true,
					durationMs: true,
					width: true,
					height: true,
					fps: true,
					bitrate: true,
					hasVideo: true,
					hasAudio: true,
					targetParticipantId: true,
					sourceRecordingId: true,
					sourceRecording: {
						select: {
							isScreenShare: true,
							participant: {
								select: {
									id: true,
									displayName: true,
									user: { select: { name: true } },
								},
							},
						},
					},
				},
			},
		},
	});

	if (!session) return null;

	const outputs =
		(session.outputs as Record<string, { key?: string }> | null) ?? {};
	const kinds = Object.entries(outputs)
		.filter(([, value]) => Boolean(value?.key))
		.map(([kind]) => kind);

	const tracks: SharedSpaceTrack[] = [];
	if (session.source === "SPACE") {
		// This deliberately mirrors the Space project's track grouping: one row per
		// participant recording, with aligned/cloud files as download variants.
		const participantOutputs = session.finalOutputs.filter(
			(output) => output.type === "PER_PARTICIPANT",
		);
		// Camera cloud egresses are keyed by participant (they have no source
		// recording); screen cloud egresses are keyed by the screen recording
		// they were started for, so each pairs with its own screen row.
		const cloudByParticipant = new Map<
			string,
			(typeof participantOutputs)[number]
		>();
		const cloudBySourceRecording = new Map<
			string,
			(typeof participantOutputs)[number]
		>();
		for (const output of participantOutputs) {
			if (output.variant !== "CLOUD") continue;
			if (output.sourceRecordingId) {
				cloudBySourceRecording.set(output.sourceRecordingId, output);
			} else if (
				output.targetParticipantId &&
				!cloudByParticipant.has(output.targetParticipantId)
			) {
				cloudByParticipant.set(output.targetParticipantId, output);
			}
		}

		const localOutputs = participantOutputs.filter(
			(output) => output.variant !== "CLOUD",
		);
		const videoOutputs = localOutputs.filter((output) => output.hasVideo);
		const visibleOutputs =
			videoOutputs.length > 0 ? videoOutputs : localOutputs;
		const groups = new Map<string, typeof participantOutputs>();
		for (const output of visibleOutputs) {
			const key = output.sourceRecordingId ?? output.id;
			const group = groups.get(key) ?? [];
			group.push(output);
			groups.set(key, group);
		}

		const addTrack = (
			primary: (typeof participantOutputs)[number],
			variants: typeof participantOutputs,
			index: number,
			cloud?: (typeof participantOutputs)[number],
		) => {
			const participant = primary.sourceRecording?.participant;
			const name = participant?.displayName || participant?.user?.name;
			const aligned = variants.find((output) => output.variant === "ALIGNED");
			tracks.push({
				id: primary.id,
				title: `${name || `Participant ${index + 1}`}${
					primary.sourceRecording?.isScreenShare ? " · Screen share" : ""
				}`,
				mimeType: primary.mimeType,
				durationMs: primary.durationMs,
				width: primary.width,
				height: primary.height,
				fps: primary.fps,
				bitrate: primary.bitrate,
				hasVideo: !!primary.hasVideo,
				hasAudio: !!primary.hasAudio,
				isScreenShare: !!primary.sourceRecording?.isScreenShare,
				alignedOutputId: aligned?.id ?? null,
				cloudOutputId: cloud?.id ?? null,
				cloudHasVideo: !!cloud?.hasVideo,
				cloudHasAudio: !!cloud?.hasAudio,
			});
		};

		let index = 0;
		const coveredParticipants = new Set<string>();
		for (const variants of groups.values()) {
			const primary =
				variants.find((output) => output.variant === "RAW") ?? variants[0];
			if (!primary) continue;
			index += 1;
			const participantId =
				primary.sourceRecording?.participant?.id ?? primary.targetParticipantId;
			if (participantId) coveredParticipants.add(participantId);
			// Screen rows get their own screenShare egress (never the camera
			// composite); camera rows get the participant-keyed camera egress.
			const cloud = primary.sourceRecording?.isScreenShare
				? primary.sourceRecordingId
					? cloudBySourceRecording.get(primary.sourceRecordingId)
					: undefined
				: participantId
					? cloudByParticipant.get(participantId)
					: undefined;
			addTrack(primary, variants, index, cloud);
		}
		for (const [participantId, cloud] of cloudByParticipant) {
			if (coveredParticipants.has(participantId)) continue;
			index += 1;
			addTrack(cloud, [cloud], index);
		}
	}

	return {
		id: session.id,
		source: session.source,
		title: session.title ?? session.space?.title ?? null,
		description: session.description ?? session.space?.description ?? null,
		status: session.status,
		startedAt: session.startedAt,
		stoppedAt: session.stoppedAt,
		ownerName: session.user?.name ?? session.space?.host?.name ?? null,
		kinds: session.source === "SCREEN_RECORDER" ? kinds : [],
		tracks,
	};
}

/** Resolve a share token to the stored key for one output kind. */
export async function getSharedOutputKey(
	token: string,
	kind: string,
): Promise<{ key: string; title: string | null } | null> {
	const session = await prisma.recordingSession.findUnique({
		where: { shareToken: token },
		select: { source: true, title: true, outputs: true },
	});

	if (!session || session.source !== "SCREEN_RECORDER") return null;

	const outputs =
		(session.outputs as Record<string, { key?: string }> | null) ?? {};
	const key = outputs[kind]?.key;
	if (!key) return null;
	return { key, title: session.title };
}

/** Session id behind a share token, or null when the link is dead/revoked. */
export async function getSessionIdByShareToken(
	token: string,
): Promise<string | null> {
	const session = await prisma.recordingSession.findUnique({
		where: { shareToken: token },
		select: { id: true, source: true },
	});
	return session?.id ?? null;
}

/** Resolve a public Space share token to a playable final-output key. */
export async function getSharedFinalOutputKey(
	token: string,
	outputId: string,
): Promise<{
	key: string;
	title: string | null;
	hasVideo: boolean;
	hasAudio: boolean;
	audioWavKey: string | null;
} | null> {
	const session = await prisma.recordingSession.findUnique({
		where: { shareToken: token },
		select: {
			source: true,
			title: true,
			finalOutputs: {
				where: { id: outputId, status: "READY", masterKey: { not: null } },
				select: {
					masterKey: true,
					hasVideo: true,
					hasAudio: true,
					audioWavKey: true,
				},
			},
		},
	});
	if (!session || session.source !== "SPACE") return null;
	const output = session.finalOutputs[0];
	const key = output?.masterKey;
	return key
		? {
				key,
				title: session.title,
				hasVideo: !!output.hasVideo,
				hasAudio: !!output.hasAudio,
				audioWavKey: output.audioWavKey,
			}
		: null;
}

export async function listRecordingComments(sessionId: string) {
	return await prisma.recordingComment.findMany({
		where: { recordingSessionId: sessionId },
		select: {
			id: true,
			authorName: true,
			body: true,
			createdAt: true,
			user: { select: { id: true, avatar: true } },
		},
		orderBy: { createdAt: "asc" },
		take: 500,
	});
}

export const COMMENT_MAX_LENGTH = 2000;
export const COMMENT_AUTHOR_MAX_LENGTH = 80;

export async function createRecordingComment(data: {
	sessionId: string;
	userId: string | null;
	authorName: string;
	body: string;
}) {
	const session = await prisma.recordingSession.findUnique({
		where: { id: data.sessionId },
		select: { id: true },
	});
	if (!session) throw new Error("SESSION_NOT_FOUND");

	return await prisma.recordingComment.create({
		data: {
			recordingSessionId: data.sessionId,
			userId: data.userId,
			authorName: data.authorName.slice(0, COMMENT_AUTHOR_MAX_LENGTH),
			body: data.body.slice(0, COMMENT_MAX_LENGTH),
		},
		select: {
			id: true,
			authorName: true,
			body: true,
			createdAt: true,
			user: { select: { id: true, avatar: true } },
		},
	});
}

/**
 * Delete a comment. The comment's author may remove their own; the recording's
 * owner may remove any comment on their recording (moderation).
 */
export async function deleteRecordingComment(
	commentId: string,
	userId: string,
): Promise<void> {
	const comment = await prisma.recordingComment.findUnique({
		where: { id: commentId },
		select: {
			id: true,
			userId: true,
			recordingSession: { select: { userId: true } },
		},
	});

	if (!comment) throw new Error("COMMENT_NOT_FOUND");

	const isAuthor = !!comment.userId && comment.userId === userId;
	const isOwner = comment.recordingSession.userId === userId;
	if (!isAuthor && !isOwner) throw new Error("FORBIDDEN");

	await prisma.recordingComment.delete({ where: { id: commentId } });
}

/** Rename a SCREEN_RECORDER session; ownership is the session's userId. */
export async function renameScreenRecordingSession(
	sessionId: string,
	userId: string,
	title: string,
) {
	const session = await prisma.recordingSession.findUnique({
		where: { id: sessionId },
		select: { id: true, source: true, userId: true },
	});

	if (!session || session.source !== "SCREEN_RECORDER") {
		throw new Error("SESSION_NOT_FOUND");
	}

	if (session.userId !== userId) {
		throw new Error("FORBIDDEN");
	}

	return await prisma.recordingSession.update({
		where: { id: sessionId },
		data: { title },
		select: { id: true, title: true },
	});
}

// Screen Recorder Operations (single user, no space / participant)

interface StartScreenSessionData {
	userId: string;
	spaceRecordingSessionId: string;
	title?: string;
	description?: string;
	composition?: unknown;
}

export async function startScreenRecordingSession(
	data: StartScreenSessionData,
) {
	const { userId, spaceRecordingSessionId, title, description, composition } =
		data;

	// Throws USAGE_EXHAUSTED when the user's metered credit is spent.
	await assertCanRecord(userId);

	return await prisma.recordingSession.create({
		data: {
			source: "SCREEN_RECORDER",
			userId,
			spaceRecordingSessionId,
			title: title?.trim() || null,
			description: description?.trim() || null,
			composition: composition as never,
			status: "ACTIVE",
			startedAt: new Date(),
		},
	});
}

export async function stopScreenRecordingSession(
	sessionId: string,
	userId: string,
) {
	const session = await prisma.recordingSession.findUnique({
		where: { id: sessionId },
		select: { id: true, status: true, source: true, userId: true },
	});

	if (
		!session ||
		session.source !== "SCREEN_RECORDER" ||
		session.userId !== userId
	) {
		throw new Error("SESSION_NOT_FOUND");
	}

	if (session.status !== "ACTIVE") {
		throw new Error("SESSION_NOT_ACTIVE");
	}

	// Final meter tick before the session leaves ACTIVE.
	await meterSessionById(sessionId).catch((error) =>
		console.error(
			`[Usage] final meter on stop failed for ${sessionId}:`,
			error,
		),
	);

	return await prisma.recordingSession.update({
		where: { id: sessionId },
		data: { status: "STOPPED", stoppedAt: new Date() },
		include: {
			participantRecordings: {
				select: {
					id: true,
					type: true,
					status: true,
					uploadedSegments: true,
				},
			},
		},
	});
}

interface CreateScreenRecordingData {
	recordingSessionId: string;
	userId: string;
	type: RecordingType;
	isScreenShare?: boolean;
	container?: string;
	codec?: string;
	width?: number;
	height?: number;
	fps?: number;
	bitrate?: number;
	sampleRate?: number;
	channels?: number;
	hasAudio?: boolean;
	hasVideo?: boolean;
}

export async function createScreenRecording(data: CreateScreenRecordingData) {
	const { recordingSessionId, userId, type, isScreenShare, ...metadata } = data;

	const session = await prisma.recordingSession.findUnique({
		where: { id: recordingSessionId },
		select: { id: true, status: true, source: true, userId: true },
	});

	if (
		!session ||
		session.source !== "SCREEN_RECORDER" ||
		session.userId !== userId
	) {
		throw new Error("SESSION_NOT_FOUND");
	}

	if (session.status !== "ACTIVE") {
		throw new Error("SESSION_NOT_ACTIVE");
	}

	// participantId stays null - ownership is the session's userId.
	return await prisma.participantRecording.create({
		data: {
			recordingSessionId,
			type,
			isScreenShare: isScreenShare ?? false,
			status: "UPLOADING",
			...metadata,
		},
	});
}

export async function markScreenRecordingComplete(
	recordingId: string,
	userId: string,
	expectedSegments: number,
) {
	const recording = await prisma.participantRecording.findUnique({
		where: { id: recordingId },
		select: {
			id: true,
			uploadedSegments: true,
			status: true,
			segments: { select: { sequenceNumber: true } },
			recordingSession: { select: { source: true, userId: true } },
		},
	});

	if (
		!recording ||
		recording.recordingSession.source !== "SCREEN_RECORDER" ||
		recording.recordingSession.userId !== userId
	) {
		throw new Error("RECORDING_NOT_FOUND");
	}

	if (recording.status === "READY") {
		throw new Error("RECORDING_ALREADY_COMPLETE");
	}

	const normalizedExpectedSegments = Math.max(0, Math.round(expectedSegments));
	const actualUploadedSegments = recording.segments.length;
	const isComplete =
		actualUploadedSegments >= normalizedExpectedSegments &&
		hasContiguousSegments(recording.segments, normalizedExpectedSegments);

	const updatedRecording = await prisma.participantRecording.update({
		where: { id: recordingId },
		data: {
			expectedSegments: normalizedExpectedSegments,
			uploadedSegments: actualUploadedSegments,
			isComplete,
			status: isComplete ? "UPLOADED" : "UPLOADING",
		},
	});

	if (isComplete) {
		void maybeFinalizeScreenSession(updatedRecording.recordingSessionId);
	}

	return updatedRecording;
}

/** List a user's screen recordings, newest first. */
export async function listScreenRecordings(userId: string) {
	const staleCutoff = new Date(Date.now() - SCREEN_PROCESSING_TIMEOUT_MS);

	await prisma.recordingSession.updateMany({
		where: {
			source: "SCREEN_RECORDER",
			userId,
			status: { in: ["STOPPED", "PROCESSING"] },
			stoppedAt: { lt: staleCutoff },
		},
		data: { status: "FAILED" },
	});

	return await prisma.recordingSession.findMany({
		where: { source: "SCREEN_RECORDER", userId },
		select: {
			id: true,
			title: true,
			description: true,
			status: true,
			startedAt: true,
			stoppedAt: true,
			outputs: true,
			shareToken: true,
			createdAt: true,
			_count: { select: { comments: true } },
		},
		orderBy: { startedAt: "desc" },
	});
}

/** A screen session's outputs, scoped to its owner. */
export async function getScreenSessionForUser(
	sessionId: string,
	userId: string,
) {
	const session = await prisma.recordingSession.findUnique({
		where: { id: sessionId },
		select: { source: true, userId: true, title: true, outputs: true },
	});
	if (
		!session ||
		session.source !== "SCREEN_RECORDER" ||
		session.userId !== userId
	) {
		return null;
	}
	return session;
}

/** Owner userId for a SCREEN_RECORDER participant recording (else null). */
export async function getScreenRecordingOwnerUserId(
	recordingId: string,
): Promise<string | null> {
	const recording = await prisma.participantRecording.findUnique({
		where: { id: recordingId },
		select: {
			recordingSession: { select: { source: true, userId: true } },
		},
	});

	if (!recording || recording.recordingSession.source !== "SCREEN_RECORDER") {
		return null;
	}

	return recording.recordingSession.userId ?? null;
}

/** Resolve {userId, recordingSessionId} for building a screen chunk key. */
export async function getScreenRecordingStorageContext(
	recordingId: string,
): Promise<{
	userId: string;
	recordingSessionId: string;
} | null> {
	const recording = await prisma.participantRecording.findUnique({
		where: { id: recordingId },
		select: {
			recordingSessionId: true,
			recordingSession: { select: { source: true, userId: true } },
		},
	});

	if (
		!recording ||
		recording.recordingSession.source !== "SCREEN_RECORDER" ||
		!recording.recordingSession.userId
	) {
		return null;
	}

	return {
		userId: recording.recordingSession.userId,
		recordingSessionId: recording.recordingSessionId,
	};
}

export async function deleteScreenRecordingSession(
	sessionId: string,
	userId: string,
): Promise<{ deleted: true }> {
	const session = await prisma.recordingSession.findUnique({
		where: { id: sessionId },
		select: {
			id: true,
			source: true,
			userId: true,
			outputs: true,
			participantRecordings: {
				select: {
					mergedFileKey: true,
					segments: { select: { assetKey: true } },
				},
			},
			finalOutputs: {
				select: {
					masterKey: true,
					audioWavKey: true,
					thumbnailKey: true,
					renditions: { select: { assetKey: true } },
				},
			},
		},
	});

	if (
		!session ||
		session.source !== "SCREEN_RECORDER" ||
		session.userId !== userId
	) {
		throw new Error("SESSION_NOT_FOUND");
	}

	const keys = new Set<string>();
	addScreenOutputKeys(keys, session.outputs);
	for (const recording of session.participantRecordings) {
		addKey(keys, recording.mergedFileKey);
		for (const segment of recording.segments) addKey(keys, segment.assetKey);
	}
	for (const output of session.finalOutputs) {
		addKey(keys, output.masterKey);
		addKey(keys, output.audioWavKey);
		addKey(keys, output.thumbnailKey);
		for (const rendition of output.renditions) addKey(keys, rendition.assetKey);
	}

	await deleteSessionRows(sessionId);
	await deleteObjects([...keys]).catch((error) => {
		console.error(
			`[RecordingCleanup] failed to delete R2 objects for ${sessionId}:`,
			error,
		);
	});

	return { deleted: true };
}
