import { randomBytes } from "node:crypto";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../middlewares/auth-middleware";
import { findOrCreateUser } from "../services/auth-service";
import {
	sendScheduledInvites,
	sendSpaceInvite,
} from "../services/email-service";
import { toPublicParticipant } from "../services/participant-service";
import {
	activateScheduledSpace,
	createSpace,
	deleteSpace,
	endSpace,
	getSpaceById,
	getSpaceByJoinCode,
	getUserSpaces,
	isUserParticipant,
	resumeHostSpace,
	scheduleSpace,
	updateSpace,
	verifySpaceEndPermission,
	verifySpaceHost,
} from "../services/space-service";

function generateJoinCode(): string {
	// Uppercase letters + digits with every visually confusable character
	// removed: 0/O, 1/I/L, 5/S, 2/Z, 8/B, 6/G, U/V, D/Q. 25 characters remain.
	const alphabet = "ABCDEFGHJKMNPRTUWXY234579";
	const length = 5;
	// 25 doesn't divide 256, so reject bytes >= 250 (largest multiple of 25)
	// to avoid modulo bias; every character stays equally likely.
	const max = Math.floor(256 / alphabet.length) * alphabet.length;
	let code = "";

	while (code.length < length) {
		const byte = randomBytes(1)[0];
		if (byte === undefined || byte >= max) continue;
		code += alphabet.charAt(byte % alphabet.length);
	}

	return code;
}

type ParticipantForPublicResponse = Parameters<typeof toPublicParticipant>[0];

function toPublicSpace<T>(
	space: T & { participants?: ParticipantForPublicResponse[] },
) {
	const { participants, ...publicSpace } = space;
	return {
		...publicSpace,
		...(participants
			? { participants: participants.map(toPublicParticipant) }
			: {}),
	};
}

export async function createSpaceController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		if (!req.user) {
			res
				.status(401)
				.json({ success: false, data: null, message: "No user context!" });
			return;
		}

		const { title, description, joinCode, participantSessionId } = req.body;

		if (
			joinCode !== undefined &&
			(typeof joinCode !== "string" || joinCode.trim().length === 0)
		) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Join code must be a non-empty string!",
			});
			return;
		}

		if (
			!participantSessionId ||
			typeof participantSessionId !== "string" ||
			participantSessionId.trim().length === 0
		) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Participant session ID is required!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);
		const spaceTitle = title?.trim() || `${user.name}'s Space`;
		const spaceDescription =
			description?.trim() || `This is ${user.name}'s space`;

		const requestedJoinCode = joinCode?.trim();
		let space: Awaited<ReturnType<typeof createSpace>> | undefined;
		let attempts = 0;

		while (attempts < 5) {
			attempts += 1;

			try {
				space = await createSpace({
					title: spaceTitle,
					description: spaceDescription,
					joinCode: requestedJoinCode || generateJoinCode(),
					hostId: user.id,
					hostName: user.name,
					hostParticipantSessionId: participantSessionId.trim(),
				});
				break;
			} catch (error) {
				if (error instanceof Error && error.message === "JOIN_CODE_EXISTS") {
					// Server-generated code collided: just try another one.
					if (!requestedJoinCode) {
						continue;
					}

					// Client requested a specific code (the room id). A retried/double-
					// fired create races with itself, so if this host already owns that
					// live space, resume it idempotently instead of failing.
					const resumed = await resumeHostSpace(
						requestedJoinCode,
						user.id,
						participantSessionId.trim(),
					);

					if (resumed) {
						space = resumed;
						break;
					}
				}

				throw error;
			}
		}

		if (!space) {
			throw new Error("JOIN_CODE_EXISTS");
		}

		res.status(201).json({
			success: true,
			data: space ? toPublicSpace(space) : null,
			message: "Space created and started successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error && error.message === "JOIN_CODE_EXISTS") {
			res.status(409).json({
				success: false,
				data: null,
				message: "A space with this join code already exists!",
			});
			return;
		}
		if (error instanceof Error && error.message === "LIVEKIT_NOT_CONFIGURED") {
			res.status(503).json({
				success: false,
				data: null,
				message: "LiveKit is not configured on the server!",
			});
			return;
		}

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to create space: ${errorMessage}!`,
		});
	}
}

export async function scheduleSpaceController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		if (!req.user) {
			res
				.status(401)
				.json({ success: false, data: null, message: "No user context!" });
			return;
		}

		const {
			title,
			description,
			scheduledFor,
			durationMinutes,
			invitees,
			participantSessionId,
		} = req.body;

		if (
			!participantSessionId ||
			typeof participantSessionId !== "string" ||
			participantSessionId.trim().length === 0
		) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Participant session ID is required!",
			});
			return;
		}

		if (!scheduledFor || typeof scheduledFor !== "string") {
			res.status(400).json({
				success: false,
				data: null,
				message: "A scheduled date/time is required!",
			});
			return;
		}

		const scheduledDate = new Date(scheduledFor);
		if (Number.isNaN(scheduledDate.getTime())) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Scheduled date/time is invalid!",
			});
			return;
		}

		if (scheduledDate.getTime() <= Date.now()) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Scheduled date/time must be in the future!",
			});
			return;
		}

		// Optional meeting length (drives the calendar-invite end time). Clamp to a
		// sane range and fall back to 60 minutes when absent/invalid.
		let durationMins = 60;
		if (durationMinutes !== undefined) {
			const parsed = Number(durationMinutes);
			if (Number.isFinite(parsed) && parsed > 0) {
				durationMins = Math.min(Math.round(parsed), 24 * 60);
			}
		}

		let inviteeEmails: string[] = [];
		if (invitees !== undefined) {
			if (
				!Array.isArray(invitees) ||
				invitees.some((e) => typeof e !== "string")
			) {
				res.status(400).json({
					success: false,
					data: null,
					message: "Invitees must be an array of emails!",
				});
				return;
			}
			inviteeEmails = Array.from(
				new Set(
					invitees
						.map((e: string) => e.trim().toLowerCase())
						.filter((e: string) => e.includes("@")),
				),
			);
		}

		const user = await findOrCreateUser(req.user);
		const spaceTitle = title?.trim() || `${user.name}'s Space`;
		const spaceDescription =
			description?.trim() || `This is ${user.name}'s space`;

		let space: Awaited<ReturnType<typeof scheduleSpace>> | undefined;
		let attempts = 0;

		while (attempts < 5) {
			attempts += 1;
			try {
				space = await scheduleSpace({
					title: spaceTitle,
					description: spaceDescription,
					joinCode: generateJoinCode(),
					scheduledFor: scheduledDate,
					invitees: inviteeEmails,
					hostId: user.id,
					hostName: user.name,
					hostParticipantSessionId: participantSessionId.trim(),
				});
				break;
			} catch (error) {
				if (error instanceof Error && error.message === "JOIN_CODE_EXISTS") {
					continue;
				}
				throw error;
			}
		}

		if (!space) {
			throw new Error("JOIN_CODE_EXISTS");
		}

		// Best-effort: invite emails never block the scheduling response.
		const invite = await sendScheduledInvites({
			spaceId: space.id,
			title: space.title,
			description: space.description,
			joinCode: space.joinCode,
			scheduledFor: scheduledDate,
			durationMinutes: durationMins,
			invitees: inviteeEmails,
			hostName: user.name,
			hostEmail: user.email,
		});

		res.status(201).json({
			success: true,
			data: { ...toPublicSpace(space), invitesSent: invite.sent },
			message: "Meeting scheduled successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error && error.message === "JOIN_CODE_EXISTS") {
			res.status(409).json({
				success: false,
				data: null,
				message: "Could not generate a unique join code, please try again!",
			});
			return;
		}

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to schedule meeting: ${errorMessage}!`,
		});
	}
}

export async function activateSpaceController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		if (!req.user) {
			res
				.status(401)
				.json({ success: false, data: null, message: "No user context!" });
			return;
		}

		const spaceId = req.params.spaceId as string | undefined;
		const { participantSessionId } = req.body ?? {};

		if (!spaceId) {
			res
				.status(400)
				.json({ success: false, data: null, message: "Space ID is required!" });
			return;
		}

		if (
			!participantSessionId ||
			typeof participantSessionId !== "string" ||
			participantSessionId.trim().length === 0
		) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Participant session ID is required!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);

		const space = await activateScheduledSpace(
			spaceId,
			user.id,
			participantSessionId.trim(),
		);

		res.status(200).json({
			success: true,
			data: toPublicSpace(space),
			message: "Meeting started successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error) {
			if (error.message === "SPACE_NOT_FOUND") {
				res
					.status(404)
					.json({ success: false, data: null, message: "Space not found!" });
				return;
			}
			if (error.message === "NOT_HOST") {
				res.status(403).json({
					success: false,
					data: null,
					message: "Only the host can start this meeting!",
				});
				return;
			}
			if (error.message === "SPACE_NOT_SCHEDULED") {
				res.status(400).json({
					success: false,
					data: null,
					message: "This meeting can no longer be started!",
				});
				return;
			}
			if (error.message === "LIVEKIT_NOT_CONFIGURED") {
				res.status(503).json({
					success: false,
					data: null,
					message: "LiveKit is not configured on the server!",
				});
				return;
			}
		}

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to start meeting: ${errorMessage}!`,
		});
	}
}

export async function deleteSpaceController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		if (!req.user) {
			res
				.status(401)
				.json({ success: false, data: null, message: "No user context!" });
			return;
		}

		const spaceId = req.params.spaceId as string | undefined;
		if (!spaceId) {
			res
				.status(400)
				.json({ success: false, data: null, message: "Space ID is required!" });
			return;
		}

		const user = await findOrCreateUser(req.user);
		const result = await deleteSpace(spaceId, user.id);

		res.status(200).json({
			success: true,
			data: result,
			message: "Project deleted permanently!",
		});
	} catch (error: unknown) {
		if (error instanceof Error) {
			if (error.message === "SPACE_NOT_FOUND") {
				res
					.status(404)
					.json({ success: false, data: null, message: "Project not found!" });
				return;
			}
			if (error.message === "FORBIDDEN") {
				res.status(403).json({
					success: false,
					data: null,
					message: "Only the host can delete this project!",
				});
				return;
			}
		}

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to delete project: ${errorMessage}!`,
		});
	}
}

export async function updateSpaceController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		if (!req.user) {
			res
				.status(401)
				.json({ success: false, data: null, message: "No user context!" });
			return;
		}

		const spaceId = req.params.spaceId as string | undefined;

		if (!spaceId) {
			res
				.status(400)
				.json({ success: false, data: null, message: "Space ID is required!" });
			return;
		}

		const { title, description } = req.body;

		if (title === undefined && description === undefined) {
			res.status(400).json({
				success: false,
				data: null,
				message: "At least one field (title or description) must be provided!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);

		const isHost = await verifySpaceHost(spaceId, user.id);
		if (!isHost) {
			res.status(403).json({
				success: false,
				data: null,
				message: "Only the host can update space details!",
			});
			return;
		}

		const space = await updateSpace(spaceId, {
			...(title !== undefined && { title: title.trim() }),
			...(description !== undefined && { description: description?.trim() }),
		});

		res.status(200).json({
			success: true,
			data: toPublicSpace(space),
			message: "Space updated successfully!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to update space: ${errorMessage}!`,
		});
	}
}

export async function endSpaceController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		const spaceId = req.params.spaceId as string | undefined;
		const { participantSessionId } = req.body ?? {};

		if (!spaceId) {
			res
				.status(400)
				.json({ success: false, data: null, message: "Space ID is required!" });
			return;
		}

		let userId: string | undefined;
		if (req.user) {
			const user = await findOrCreateUser(req.user);
			userId = user.id;
		}

		const sessionId =
			typeof participantSessionId === "string"
				? participantSessionId.trim()
				: undefined;

		if (!userId && !sessionId) {
			res.status(401).json({
				success: false,
				data: null,
				message: "No user context!",
			});
			return;
		}

		const canEndSpace = await verifySpaceEndPermission(
			spaceId,
			userId,
			sessionId,
		);
		if (!canEndSpace) {
			res.status(403).json({
				success: false,
				data: null,
				message: "Only the host or co-host can end the space!",
			});
			return;
		}

		const space = await endSpace(spaceId);

		res.status(200).json({
			success: true,
			data: space ? toPublicSpace(space) : null,
			message: "Space ended successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error) {
			if (error.message === "SPACE_NOT_FOUND") {
				res
					.status(404)
					.json({ success: false, data: null, message: "Space not found!" });
				return;
			}
			if (error.message === "SPACE_NOT_LIVE") {
				res.status(400).json({
					success: false,
					data: null,
					message: "Space is not currently live!",
				});
				return;
			}
			if (error.message === "LIVEKIT_NOT_CONFIGURED") {
				res.status(503).json({
					success: false,
					data: null,
					message: "LiveKit is not configured on the server!",
				});
				return;
			}
		}

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to end space: ${errorMessage}!`,
		});
	}
}

export async function getSpaceByIdController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		if (!req.user) {
			res
				.status(401)
				.json({ success: false, data: null, message: "No user context!" });
			return;
		}

		const spaceId = req.params.spaceId as string | undefined;

		if (!spaceId) {
			res
				.status(400)
				.json({ success: false, data: null, message: "Space ID is required!" });
			return;
		}

		const user = await findOrCreateUser(req.user);

		const space = await getSpaceById(spaceId);

		if (!space) {
			res.status(404).json({
				success: false,
				data: null,
				message: "Space not found!",
			});
			return;
		}

		const isHost = space.hostId === user.id;
		const isParticipant = await isUserParticipant(spaceId, user.id);

		if (!isHost && !isParticipant) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You are not authorized to view this space!",
			});
			return;
		}

		res.status(200).json({
			success: true,
			data: toPublicSpace(space),
			message: "Space retrieved successfully!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to get space: ${errorMessage}!`,
		});
	}
}

export async function getSpaceByJoinCodeController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		const joinCode = req.params.joinCode as string | undefined;

		if (!joinCode) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Join code is required!",
			});
			return;
		}

		const space = await getSpaceByJoinCode(joinCode);

		if (!space) {
			res.status(404).json({
				success: false,
				data: null,
				message: "Space not found with this join code!",
			});
			return;
		}

		res.status(200).json({
			success: true,
			data: space,
			message: "Space retrieved successfully!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to get space: ${errorMessage}!`,
		});
	}
}

export async function getUserSpacesController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		if (!req.user) {
			res
				.status(401)
				.json({ success: false, data: null, message: "No user context!" });
			return;
		}

		const { filter } = req.query;

		// Validate filter if provided
		const validFilters = ["hosted", "participated", "all"];
		if (filter && !validFilters.includes(filter as string)) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Filter must be 'hosted', 'participated', or 'all'!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);

		const spaces = await getUserSpaces(
			user.id,
			filter as "hosted" | "participated" | "all" | undefined,
		);

		res.status(200).json({
			success: true,
			data: {
				spaces,
				count: spaces.length,
			},
			message: "User spaces retrieved successfully!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to get user spaces: ${errorMessage}!`,
		});
	}
}

export async function sendSpaceInviteController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		if (!req.user) {
			res
				.status(401)
				.json({ success: false, data: null, message: "No user context!" });
			return;
		}

		const spaceId = req.params.spaceId as string | undefined;
		const { email } = req.body;

		if (!spaceId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Space ID is required!",
			});
			return;
		}

		const recipient =
			typeof email === "string" ? email.trim().toLowerCase() : "";
		if (!recipient.includes("@")) {
			res.status(400).json({
				success: false,
				data: null,
				message: "A valid email address is required!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);

		// Only the host can invite people to their space.
		const isHost = await verifySpaceHost(spaceId, user.id);
		if (!isHost) {
			res.status(403).json({
				success: false,
				data: null,
				message: "Only the host can send invites!",
			});
			return;
		}

		const space = await getSpaceById(spaceId);
		if (!space) {
			res.status(404).json({
				success: false,
				data: null,
				message: "Space not found!",
			});
			return;
		}

		const invite = await sendSpaceInvite({
			to: recipient,
			title: space.title,
			description: space.description,
			joinCode: space.joinCode,
			hostName: user.name,
		});

		if (invite.skipped) {
			res.status(503).json({
				success: false,
				data: null,
				message: "Email sending is not configured!",
			});
			return;
		}

		res.status(200).json({
			success: true,
			data: { sent: invite.sent },
			message: `Invite sent to ${recipient}!`,
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to send invite: ${errorMessage}!`,
		});
	}
}
