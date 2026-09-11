const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;
const dataDir = path.join(__dirname, "server-data");
const uploadsDir = path.join(dataDir, "videos");
const stateFile = path.join(dataDir, "state.json");
fs.mkdirSync(uploadsDir, { recursive: true });

const defaultState = { users: [], packages: [], lessons: [], accessCodes: [], progress: {} };
function readState() {
  if (!fs.existsSync(stateFile)) return defaultState;
  try {
    return {
      ...defaultState,
      ...JSON.parse(fs.readFileSync(stateFile, "utf8")),
    };
  } catch {
    return defaultState;
  }
}
function writeState(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}
const storage = multer.diskStorage({
  destination: (_, __, callback) => callback(null, uploadsDir),
  filename: (_, file, callback) =>
    callback(
      null,
      `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "-")}`,
    ),
});
const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (_, file, callback) =>
    callback(null, file.mimetype.startsWith("video/")),
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));
app.use("/videos", express.static(uploadsDir));

app.get("/api/state", (_, response) => response.json(readState()));
app.get("/api/health", (_, response) =>
  response.json({ ok: true, service: "yes-for-english" }),
);
app.put("/api/state", (request, response) => {
  const incoming = request.body || {};
  const current = readState();
  const next = {
    users: Array.isArray(incoming.users) ? incoming.users : current.users,
    packages: Array.isArray(incoming.packages)
      ? incoming.packages
      : current.packages,
    lessons: Array.isArray(incoming.lessons)
      ? incoming.lessons
      : current.lessons,
    accessCodes: Array.isArray(incoming.accessCodes)
      ? incoming.accessCodes
      : current.accessCodes,
    progress:
      incoming.progress && typeof incoming.progress === "object"
        ? incoming.progress
        : current.progress,
  };
  writeState(next);
  response.json(next);
});
app.get("/api/progress/:username", (request, response) => {
  const username = String(request.params.username || "").trim().toLowerCase();
  const state = readState();
  response.json(state.progress?.[username] || null);
});

app.put("/api/progress/:username", (request, response) => {
  const username = String(request.params.username || "").trim().toLowerCase();
  if (!username) return response.status(400).json({ error: "Username is required." });
  const progress = request.body;
  if (!progress || typeof progress !== "object" || Array.isArray(progress))
    return response.status(400).json({ error: "Invalid progress data." });
  const state = readState();
  state.progress = state.progress || {};
  state.progress[username] = progress;
  writeState(state);
  response.json(progress);
});

app.post("/api/videos", upload.single("video"), (request, response) => {
  if (!request.file)
    return response
      .status(400)
      .json({ error: "A valid video file is required." });
  response.json({
    url: `/videos/${request.file.filename}`,
    type: request.file.mimetype,
  });
});
app.listen(port, "0.0.0.0", () =>
  console.log(`Yes for English server running at http://localhost:${port}`),
);
