import express, { type Request, type Response } from "express";
import { createServer } from "http";
import cors from "cors";
import { initSocket } from "./sockets/index.ts";
import authRouter from "./routes/auth-route.ts";
import recordingRouter from "./routes/recording-route.ts";
import spaceRouter from "./routes/space-route.ts";
import participantRouter from "./routes/participant-route.ts";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

//middlewares
app.use(express.json())
app.use(
  cors({
    origin: ["http://localhost:3000"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS","PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

//routes
app.get("/", (req: Request, res: Response) => {
  res.send("Asap is live :D")
})
app.use("/api/auth", authRouter)
app.use("/api/recording", recordingRouter)
app.use("/api/space", spaceRouter)
app.use("/api/participant", participantRouter)


const httpServer = createServer(app);

initSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} :D`);
});
