/**
 * Segment-gap detection shared by the Space and screen-recorder finalizers.
 *
 * A single dropped chunk used to throw and fail an entire recording - losing a
 * whole track over one lost fragment. Instead we salvage what arrived:
 *  - a TRAILING gap (recorder cut off before its last chunks uploaded) just
 *    shortens the video and is harmless;
 *  - an INTERIOR gap may cause a brief glitch at the seam, but the rest of the
 *    footage is still recoverable, so we keep it and only flag the seam.
 */

/**
 * A recording can be marked complete with zero segments in hand: the client
 * reports `expectedSegments: 0` when its last (often only, for a <5s take)
 * chunk was still mid-upload at the moment it checked whether its queue was
 * drained. That segment usually lands in the DB a moment later, but
 * finalization can be triggered before it does. Before condemning a
 * zero-segment track as FAILED, give that in-flight chunk a short window to
 * actually arrive and re-check straight from the DB.
 */
export async function waitForLateSegments<
	T extends { sequenceNumber: number },
>(
	participantRecordingId: string,
	fetchSegments: () => Promise<T[]>,
	{ attempts = 4, delayMs = 1500 }: { attempts?: number; delayMs?: number } = {},
): Promise<T[]> {
	for (let attempt = 0; attempt < attempts; attempt++) {
		if (attempt > 0) {
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
		const segments = await fetchSegments();
		if (segments.length > 0) return segments;
	}
	return [];
}

export interface SegmentGaps {
	/** Sequence numbers missing between the first and last chunk we received. */
	interiorMissing: number[];
	/** How many expected chunks past the last one we received never arrived. */
	trailingMissing: number;
}

/** Reports gaps in the uploaded segment sequence WITHOUT failing the track. */
export function findSegmentGaps(
	segments: { sequenceNumber: number }[],
	expectedSegments?: number | null,
): SegmentGaps {
	if (segments.length === 0) {
		return {
			interiorMissing: [],
			trailingMissing: Math.max(0, Math.round(expectedSegments ?? 0)),
		};
	}

	const seen = new Set(segments.map((segment) => segment.sequenceNumber));
	const maxSeq = Math.max(...seen);
	const interiorMissing: number[] = [];
	for (let sequenceNumber = 0; sequenceNumber < maxSeq; sequenceNumber++) {
		if (!seen.has(sequenceNumber)) interiorMissing.push(sequenceNumber);
	}

	const expected =
		typeof expectedSegments === "number" && expectedSegments > maxSeq + 1
			? Math.round(expectedSegments)
			: maxSeq + 1;

	return { interiorMissing, trailingMissing: expected - (maxSeq + 1) };
}

/** Short human-readable gap note for logs/processingError, or null if clean. */
export function describeSegmentGaps(gaps: SegmentGaps): string | null {
	if (gaps.interiorMissing.length === 0 && gaps.trailingMissing <= 0) {
		return null;
	}
	const parts: string[] = [];
	if (gaps.interiorMissing.length > 0) {
		const shown = gaps.interiorMissing.slice(0, 20).join(", ");
		const more = gaps.interiorMissing.length > 20 ? "…" : "";
		parts.push(
			`${gaps.interiorMissing.length} interior chunk(s) missing [${shown}${more}]`,
		);
	}
	if (gaps.trailingMissing > 0) {
		parts.push(`${gaps.trailingMissing} trailing chunk(s) never uploaded`);
	}
	return `Recovered with gaps: ${parts.join("; ")}`;
}
