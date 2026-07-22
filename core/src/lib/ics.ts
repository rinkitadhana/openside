// Minimal RFC 5545 (iCalendar) generator for meeting invites. Hand-rolled so we
// don't pull a dependency for what is a small, stable format. Produces a single
// VEVENT that, when attached to an email, lets the recipient add the meeting to
// any calendar (Google / Apple / Outlook) with the join link inside.

interface IcsEvent {
	uid: string; // stable unique id (we use the join code-derived id)
	title: string;
	description?: string;
	start: Date;
	end: Date;
	url: string; // join link, surfaced in the event body + URL field
	organizerName?: string;
	organizerEmail?: string;
}

// iCalendar wants UTC timestamps as YYYYMMDDTHHMMSSZ.
function toIcsDate(date: Date): string {
	return date
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}/, "");
}

// Escape per RFC 5545 §3.3.11: backslash, semicolon, comma, and newlines.
function escapeText(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,")
		.replace(/\r?\n/g, "\\n");
}

// Lines longer than 75 octets must be folded with CRLF + a leading space.
function foldLine(line: string): string {
	if (line.length <= 75) return line;
	const chunks: string[] = [];
	let remaining = line;
	chunks.push(remaining.slice(0, 75));
	remaining = remaining.slice(75);
	while (remaining.length > 0) {
		chunks.push(` ${remaining.slice(0, 74)}`);
		remaining = remaining.slice(74);
	}
	return chunks.join("\r\n");
}

export function buildIcs(event: IcsEvent): string {
	const descriptionParts = [event.description, `Join: ${event.url}`].filter(
		Boolean,
	) as string[];

	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Openside//Meetings//EN",
		"CALSCALE:GREGORIAN",
		"METHOD:REQUEST",
		"BEGIN:VEVENT",
		`UID:${event.uid}`,
		`DTSTAMP:${toIcsDate(new Date())}`,
		`DTSTART:${toIcsDate(event.start)}`,
		`DTEND:${toIcsDate(event.end)}`,
		`SUMMARY:${escapeText(event.title)}`,
		`DESCRIPTION:${escapeText(descriptionParts.join("\n"))}`,
		`URL:${event.url}`,
	];

	if (event.organizerEmail) {
		const cn = event.organizerName
			? `;CN=${escapeText(event.organizerName)}`
			: "";
		lines.push(`ORGANIZER${cn}:mailto:${event.organizerEmail}`);
	}

	lines.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR");

	return lines.map(foldLine).join("\r\n");
}
