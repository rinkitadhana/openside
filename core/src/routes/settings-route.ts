import express, { type Response } from "express";
import {
	ALLOWED_AUDIO_SAMPLE_RATES,
	ALLOWED_FPS,
	ALLOWED_VIDEO_RESOLUTIONS,
	RECORDING_MODES,
} from "../lib/recording-constants.ts";
import type { AuthenticatedRequest } from "../middlewares/auth-middleware.ts";
import { authMiddleware } from "../middlewares/auth-middleware.ts";
import { findOrCreateUser } from "../services/auth-service.ts";
import {
	presignAvatarUpload,
	updateProfile,
	updateRecordingSettings,
} from "../services/profile-service.ts";
import {
	deleteSelfHostConfig,
	getSelfHostView,
	saveSelfHostConfig,
	setSelfHostEnabled,
} from "../services/selfhost-service.ts";

const router = express.Router();

// Profile (name / avatar). Email is the Clerk login identity and
// is intentionally not editable here.

router.patch(
	"/profile",
	authMiddleware,
	async (req: AuthenticatedRequest, res: Response): Promise<void> => {
		try {
			if (!req.user) {
				res.status(401).json({
					success: false,
					data: null,
					message: "Authentication required!",
				});
				return;
			}
			const user = await findOrCreateUser(req.user);
			const profile = await updateProfile(user.id, {
				name: typeof req.body?.name === "string" ? req.body.name : undefined,
				avatarKey:
					req.body?.avatarKey === undefined ? undefined : req.body.avatarKey,
			});
			res
				.status(200)
				.json({ success: true, data: profile, message: "Profile updated!" });
		} catch (error) {
			const code =
				error instanceof Error &&
				["NAME_REQUIRED", "NAME_TOO_LONG", "INVALID_AVATAR_KEY"].includes(
					error.message,
				)
					? error.message
					: null;
			if (code) {
				res.status(400).json({
					success: false,
					data: { code },
					message: `Invalid profile update: ${code}`,
				});
				return;
			}
			console.error("[Settings] profile update failed:", error);
			res.status(500).json({
				success: false,
				data: null,
				message: "Failed to update profile!",
			});
		}
	},
);

router.post(
	"/avatar/presign",
	authMiddleware,
	async (req: AuthenticatedRequest, res: Response): Promise<void> => {
		try {
			if (!req.user) {
				res.status(401).json({
					success: false,
					data: null,
					message: "Authentication required!",
				});
				return;
			}
			const contentType = req.body?.contentType;
			if (!contentType || typeof contentType !== "string") {
				res.status(400).json({
					success: false,
					data: null,
					message: "contentType is required!",
				});
				return;
			}
			const user = await findOrCreateUser(req.user);
			const result = await presignAvatarUpload(user.id, contentType);
			res
				.status(200)
				.json({ success: true, data: result, message: "Upload URL created!" });
		} catch (error) {
			if (
				error instanceof Error &&
				error.message === "UNSUPPORTED_AVATAR_TYPE"
			) {
				res.status(400).json({
					success: false,
					data: { code: "UNSUPPORTED_AVATAR_TYPE" },
					message: "Avatar must be a PNG, JPEG, WebP, or GIF image!",
				});
				return;
			}
			console.error("[Settings] avatar presign failed:", error);
			res.status(500).json({
				success: false,
				data: null,
				message: "Failed to prepare avatar upload!",
			});
		}
	},
);

// Recording preferences (user-level cloud-backup default).

router.patch(
	"/recording",
	authMiddleware,
	async (req: AuthenticatedRequest, res: Response): Promise<void> => {
		try {
			if (!req.user) {
				res.status(401).json({
					success: false,
					data: null,
					message: "Authentication required!",
				});
				return;
			}
			const {
				cloudBackupEnabled,
				targetFps,
				videoResolution,
				audioSampleRate,
				noiseSuppression,
				autoGainControl,
				echoCancellation,
				recordingMode,
			} = req.body ?? {};
			const hasCloudBackup = cloudBackupEnabled !== undefined;
			const hasTargetFps = targetFps !== undefined;
			const hasVideoResolution = videoResolution !== undefined;
			const hasAudioSampleRate = audioSampleRate !== undefined;
			const hasNoiseSuppression = noiseSuppression !== undefined;
			const hasAutoGainControl = autoGainControl !== undefined;
			const hasEchoCancellation = echoCancellation !== undefined;
			const hasRecordingMode = recordingMode !== undefined;

			if (hasCloudBackup && typeof cloudBackupEnabled !== "boolean") {
				res.status(400).json({
					success: false,
					data: null,
					message: "cloudBackupEnabled must be a boolean!",
				});
				return;
			}
			if (hasTargetFps && !ALLOWED_FPS.includes(targetFps)) {
				res.status(400).json({
					success: false,
					data: null,
					message: `targetFps must be one of ${ALLOWED_FPS.join(", ")}!`,
				});
				return;
			}
			if (
				hasVideoResolution &&
				!ALLOWED_VIDEO_RESOLUTIONS.includes(videoResolution)
			) {
				res.status(400).json({
					success: false,
					data: null,
					message: "videoResolution must be 720, 1080, or 2160!",
				});
				return;
			}
			if (
				hasAudioSampleRate &&
				!ALLOWED_AUDIO_SAMPLE_RATES.includes(audioSampleRate)
			) {
				res.status(400).json({
					success: false,
					data: null,
					message: "audioSampleRate must be 44100 or 48000!",
				});
				return;
			}
			for (const [name, value, present] of [
				["noiseSuppression", noiseSuppression, hasNoiseSuppression],
				["autoGainControl", autoGainControl, hasAutoGainControl],
				["echoCancellation", echoCancellation, hasEchoCancellation],
			] as const) {
				if (present && typeof value !== "boolean") {
					res.status(400).json({
						success: false,
						data: null,
						message: `${name} must be a boolean!`,
					});
					return;
				}
			}
			if (hasRecordingMode && !RECORDING_MODES.includes(recordingMode)) {
				res.status(400).json({
					success: false,
					data: null,
					message: "recordingMode must be VIDEO_AND_AUDIO or AUDIO_ONLY!",
				});
				return;
			}
			if (
				!hasCloudBackup &&
				!hasTargetFps &&
				!hasVideoResolution &&
				!hasAudioSampleRate &&
				!hasNoiseSuppression &&
				!hasAutoGainControl &&
				!hasEchoCancellation &&
				!hasRecordingMode
			) {
				res.status(400).json({
					success: false,
					data: null,
					message: "At least one recording setting is required!",
				});
				return;
			}

			const user = await findOrCreateUser(req.user);
			const profile = await updateRecordingSettings(user.id, {
				cloudBackupEnabled: hasCloudBackup ? cloudBackupEnabled : undefined,
				targetFps: hasTargetFps ? targetFps : undefined,
				videoResolution: hasVideoResolution ? videoResolution : undefined,
				audioSampleRate: hasAudioSampleRate ? audioSampleRate : undefined,
				noiseSuppression: hasNoiseSuppression ? noiseSuppression : undefined,
				autoGainControl: hasAutoGainControl ? autoGainControl : undefined,
				echoCancellation: hasEchoCancellation ? echoCancellation : undefined,
				recordingMode: hasRecordingMode ? recordingMode : undefined,
			});
			res.status(200).json({
				success: true,
				data: profile,
				message: "Recording settings updated!",
			});
		} catch (error) {
			console.error("[Settings] recording update failed:", error);
			res.status(500).json({
				success: false,
				data: null,
				message: "Failed to update recording settings!",
			});
		}
	},
);

const SELF_HOST_FIELDS = [
	"livekitUrl",
	"livekitApiKey",
	"livekitApiSecret",
	"r2AccountId",
	"r2AccessKeyId",
	"r2SecretAccessKey",
	"r2Bucket",
] as const;

router.get(
	"/selfhost",
	authMiddleware,
	async (req: AuthenticatedRequest, res: Response): Promise<void> => {
		try {
			if (!req.user) {
				res.status(401).json({
					success: false,
					data: null,
					message: "Authentication required!",
				});
				return;
			}
			const user = await findOrCreateUser(req.user);
			const config = await getSelfHostView(user.id);
			res.status(200).json({
				success: true,
				data: config,
				message: config
					? "Self-host config retrieved!"
					: "No self-host config.",
			});
		} catch (error) {
			console.error("[Settings] selfhost get failed:", error);
			res.status(500).json({
				success: false,
				data: null,
				message: "Failed to load settings!",
			});
		}
	},
);

router.put(
	"/selfhost",
	authMiddleware,
	async (req: AuthenticatedRequest, res: Response): Promise<void> => {
		try {
			if (!req.user) {
				res.status(401).json({
					success: false,
					data: null,
					message: "Authentication required!",
				});
				return;
			}

			for (const field of SELF_HOST_FIELDS) {
				const value = req.body?.[field];
				if (!value || typeof value !== "string" || !value.trim()) {
					res.status(400).json({
						success: false,
						data: null,
						message: `${field} is required!`,
					});
					return;
				}
			}

			const user = await findOrCreateUser(req.user);
			const config = await saveSelfHostConfig(user.id, {
				livekitUrl: req.body.livekitUrl,
				livekitApiKey: req.body.livekitApiKey,
				livekitApiSecret: req.body.livekitApiSecret,
				r2AccountId: req.body.r2AccountId,
				r2AccessKeyId: req.body.r2AccessKeyId,
				r2SecretAccessKey: req.body.r2SecretAccessKey,
				r2Bucket: req.body.r2Bucket,
			});

			res.status(200).json({
				success: true,
				data: config,
				message: "Keys validated and saved. You're now on the self-host plan!",
			});
		} catch (error) {
			if (error instanceof Error && error.message === "LIVEKIT_KEYS_INVALID") {
				res.status(400).json({
					success: false,
					data: { code: "LIVEKIT_KEYS_INVALID" },
					message:
						"Could not connect to LiveKit with those keys. Check the URL, API key, and secret!",
				});
				return;
			}
			if (error instanceof Error && error.message === "R2_KEYS_INVALID") {
				res.status(400).json({
					success: false,
					data: { code: "R2_KEYS_INVALID" },
					message:
						"Could not access that R2 bucket with those keys. Check the account ID, keys, and bucket name!",
				});
				return;
			}
			console.error("[Settings] selfhost save failed:", error);
			res.status(500).json({
				success: false,
				data: null,
				message: "Failed to save settings!",
			});
		}
	},
);

router.patch(
	"/selfhost",
	authMiddleware,
	async (req: AuthenticatedRequest, res: Response): Promise<void> => {
		try {
			if (!req.user) {
				res.status(401).json({
					success: false,
					data: null,
					message: "Authentication required!",
				});
				return;
			}
			if (typeof req.body?.enabled !== "boolean") {
				res.status(400).json({
					success: false,
					data: null,
					message: "enabled (boolean) is required!",
				});
				return;
			}
			const user = await findOrCreateUser(req.user);
			const config = await setSelfHostEnabled(user.id, req.body.enabled);
			res.status(200).json({
				success: true,
				data: config,
				message: config.enabled ? "Self-host enabled!" : "Self-host disabled!",
			});
		} catch (error) {
			console.error("[Settings] selfhost toggle failed:", error);
			res.status(500).json({
				success: false,
				data: null,
				message: "Failed to update settings!",
			});
		}
	},
);

router.delete(
	"/selfhost",
	authMiddleware,
	async (req: AuthenticatedRequest, res: Response): Promise<void> => {
		try {
			if (!req.user) {
				res.status(401).json({
					success: false,
					data: null,
					message: "Authentication required!",
				});
				return;
			}
			const user = await findOrCreateUser(req.user);
			await deleteSelfHostConfig(user.id);
			res.status(200).json({
				success: true,
				data: null,
				message: "Self-host config removed!",
			});
		} catch (error) {
			console.error("[Settings] selfhost delete failed:", error);
			res.status(500).json({
				success: false,
				data: null,
				message: "Failed to remove settings!",
			});
		}
	},
);

export default router;
