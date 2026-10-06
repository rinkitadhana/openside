import dotenv from "dotenv";

const nodeEnv = process.env.NODE_ENV ?? "development";
const isWorker =
	process.env.OPENSIDE_SERVICE === "worker" ||
	process.env.npm_lifecycle_event?.startsWith("worker") ||
	process.argv.some((arg) => /(?:^|[/\\])worker\.(?:ts|js)$/.test(arg));
const productionEnv = isWorker
	? ".env.production-worker"
	: ".env.production-api";
const envFile = nodeEnv === "production" ? productionEnv : ".env.local";

dotenv.config({ path: envFile });
