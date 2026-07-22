import { spawn } from "node:child_process";
import { ffmpegPath } from "./ffmpeg-path.ts";

let logged = false;

export function logFfmpegAvailability(context: string): void {
	if (logged) return;
	logged = true;

	const proc = spawn(ffmpegPath, ["-version"], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";

	proc.stdout.on("data", (data) => {
		output += data.toString();
	});
	proc.stderr.on("data", (data) => {
		output += data.toString();
	});
	proc.on("error", (error) => {
		console.error(`[${context}] ffmpeg unavailable:`, error);
	});
	proc.on("close", (code) => {
		if (code !== 0) {
			console.error(
				`[${context}] ffmpeg check failed with code ${code}: ${output.slice(0, 500)}`,
			);
			return;
		}

		const firstLine = output.split("\n")[0] || "ffmpeg available";
		console.log(`[${context}] ${firstLine}`);
	});
}
