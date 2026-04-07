import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();
console.log("SERVER CHECK: Is Gemini Key Loaded?", !!process.env.VITE_GEMINI_API_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const requestedPort = process.env.PORT ? Number(process.env.PORT) : 3000;
  let port = Number.isSafeInteger(requestedPort) && requestedPort > 0 ? requestedPort : 3000;
  const maxPortAttempts = 5;

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // YouTube OAuth Helper (Simplified for this demo, usually handled by client-side Firebase + Google Auth)
  // But for background tasks, we might need server-side tokens.
  // For now, we'll assume the client sends the necessary data to the backend.

  app.post("/api/notify", async (req, res) => {
    const { email, videoTitle, channelName, summary, videoLink, publishedAt } = req.body;

    try {
      // Send Email
      if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
          },
        });

        const dateStr = publishedAt ? new Date(publishedAt).toLocaleString() : 'N/A';

        await transporter.sendMail({
          from: `"YouTube Notifier" <${process.env.EMAIL_USER}>`,
          to: email,
          subject: `New Video from ${channelName}: ${videoTitle}`,
          text: `Channel: ${channelName}\nPublished: ${dateStr}\nSummary: ${summary}\nLink: ${videoLink}`,
          html: `
            <h3>New Video from ${channelName}</h3>
            <p><strong>Title:</strong> ${videoTitle}</p>
            <p><strong>Published:</strong> ${dateStr}</p>
            <p><strong>Summary:</strong> ${summary}</p>
            <p><a href="${videoLink}">Watch Video</a></p>
          `,
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Notification error:", error);
      res.status(500).json({ error: "Failed to send notifications" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  for (let attempt = 0; attempt < maxPortAttempts; attempt += 1) {
    try {
      await new Promise<void>((resolve, reject) => {
        const server = app.listen(port, "0.0.0.0", () => {
          console.log(`Server running on http://localhost:${port}`);
          resolve();
        });
        server.on("error", reject);
      });
      break;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "EADDRINUSE") {
        console.warn(`Port ${port} is already in use, trying port ${port + 1}...`);
        port += 1;
      } else {
        console.error("Server error:", error);
        process.exit(1);
      }
    }
  }
}

startServer();
