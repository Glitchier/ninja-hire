import express from "express";
import cors from "cors";
import { success } from "zod";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Hello Docs",
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Express working correctly.",
  });
});

export default app;
