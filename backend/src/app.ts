import express from "express";
import cors from "cors";
import jobsRouter from "./routes/jobs.routes.js";
import applicationsRouter from "./routes/applications.routes.js";
import exportRouter from "./routes/export.routes.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ success: true, message: "ATS Backend is running healthy" });
});

// Mount Routes
app.use("/jobs", jobsRouter);
app.use("/jobs", exportRouter);
app.use("/applications", applicationsRouter);

// Mount Global Error Handler
app.use(errorHandler);

export default app;
