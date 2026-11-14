const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const OUTPUT_DIR = path.join(DATA_DIR, "outputs");
const FRAMES_DIR = path.join(DATA_DIR, "frames");
for (const dir of [DATA_DIR, UPLOAD_DIR, OUTPUT_DIR, FRAMES_DIR]) fs.mkdirSync(dir, { recursive: true });

const PORT = parseInt(process.env.PORT || "3000", 10);
process.env.DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "app.db");
const db = require("./lib/db");
const encoder = require("./lib/encoder");
const queue = require("./lib/queue");
const { authRequired, DEMO } = require("./lib/whop");

const MAX_MB = parseInt(process.env.MAX_MB || "800", 10);
const MAX_DURATION_MIN = parseInt(process.env.MAX_DURATION_MIN || "12", 10);
const MAX_PENDING_PER_USER = parseInt(process.env.MAX_PENDING_PER_USER || "2", 10);
const TTL_HOURS = parseInt(process.env.OUTPUT_TTL_HOURS || "12", 10);
const EST_FACTOR_FAST = parseFloat(process.env.EST_FACTOR_FAST || "1.5");
const EST_FACTOR_BEST = parseFloat(process.env.EST_FACTOR_BEST || "4");
const EST_FACTOR_120 = parseFloat(process.env.EST_FACTOR_120 || "10");
const MAX_DURATION_MIN_120 = parseInt(process.env.MAX_DURATION_MIN_120 || "5", 10);

const app = express();
app.set("trust proxy", true);
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ ok: true, demo: DEMO === true });
});

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname || ".mp4")),
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});

app.get("/api/me", authRequired((req, res, user) => {
  res.json({
    user: user.userId,
    demo: user.demo === true,
    level: user.level,
    limits: {
      max_mb: MAX_MB,
      max_minutes: MAX_DURATION_MIN,
      max_minutes_120: MAX_DURATION_MIN_120,
      max_pending: MAX_PENDING_PER_USER,
      ttl_hours: TTL_HOURS,
    },
    modes: [
      { id: "fast", name: "1080p Fast", eta_factor: EST_FACTOR_FAST },
      { id: "best", name: "1080p Ultra-Best", eta_factor: EST_FACTOR_BEST },
      { id: "fps120", name: "1080p 120fps", eta_factor: EST_FACTOR_120 },
    ],
  });
}));

const ALLOWED_EXT = new Set([".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".ts", ".m2ts", ".flv", ".wmv"]);

app.post("/api/upload", authRequired(async (req, res, user) => {
  upload.single("video")(req, res, async (err) => {
    if (err) {
      const tooBig = err && err.code === "LIMIT_FILE_SIZE";
      return res.status(tooBig ? 413 : 400).json({
        error: tooBig ? `That file is bigger than the ${MAX_MB} MB limit.` : "Upload error.",
      });
    }
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file received." });
    try {
      const title = String(req.body.title || file.originalname || "video").slice(0, 120);
      const mode = ["fast", "best", "fps120"].includes(req.body.mode) ? req.body.mode : "fast";
      const look = ["capcut", "cinematic", "none"].includes(req.body.look) ? req.body.look : "capcut";
      const ext = path.extname(file.filename).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) throw new Error("That file type is not supported.");

      const pending = queueCount(user.userId);
      if (pending >= MAX_PENDING_PER_USER) {
        await cleanupUpload(file.path);
        return res.status(429).json({ error: `You already have ${MAX_PENDING_PER_USER} videos in the queue. Wait for them to finish.` });
      }

      const meta = await encoder.probe(file.path).catch(() => null);
      if (!meta) {
        await cleanupUpload(file.path);
        return res.status(400).json({ error: "This file is not a readable video." });
      }
      if (meta.durationMs > (mode === "fps120" ? MAX_DURATION_MIN_120 : MAX_DURATION_MIN) * 60 * 1000) {
        const cap = mode === "fps120" ? `${MAX_DURATION_MIN_120} minute (120fps mode limit)` : `the ${MAX_DURATION_MIN} minute limit`;
        await cleanupUpload(file.path);
        return res.status(400).json({ error: `This video is longer than ${cap}.` });
      }
      const estFactor = mode === "fps120" ? EST_FACTOR_120 : mode === "best" ? EST_FACTOR_BEST : EST_FACTOR_FAST;      const estMs = Math.round(meta.durationMs * estFactor);
      const id = crypto.randomUUID();
      const now = Date.now();
      db.prepare(
        `INSERT INTO jobs (id, user_id, title, status, phase, mode, look, duration_ms, src_w, src_h, input_size, in_path, est_ms, created_at)
         VALUES (?, ?, ?, 'queued', '', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, user.userId, title, mode, look, meta.durationMs, meta.width, meta.height, file.size, file.path, estMs, now);
      queue.kick();
      res.json({ job: rowToJob(job(id)) });
    } catch (e) {
      console.error("Upload failed:", e.message);
      if (file.path && fs.existsSync(file.path)) await cleanupUpload(file.path).catch(() => {});
      return res.status(500).json({ error: "Processing this upload failed on the server." });
    }
  });
}));

db.prepare(`UPDATE jobs SET status='failed', error='Server restarted mid-job, please re-upload.', finished_at=? WHERE status='processing'`).run(Date.now());
queue.enqueue(runJob);

function job(id) {
  return db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);
}

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    phase: row.phase,
    progress: Math.max(0, Math.min(100, row.progress)),
    mode: row.mode,
    est_ms: row.est_ms,
    duration_ms: row.duration_ms,
    src_w: row.src_w,
    src_h: row.src_h,
    out_w: row.out_w,
    out_h: row.out_h,
    input_size: row.input_size,
    output_size: row.output_size,
    queue_position: row.status === "queued" ? queue.position(row.id) : 0,
    error: row.error || null,
    created_at: row.created_at,
    finished_at: row.finished_at,
    expire_ms: row.status === "done" ? (row.finished_at || 0) + TTL_HOURS * 3600 * 1000 - Date.now() : null,
    has_src: row.status === "done" && !!row.src_frame && fs.existsSync(row.src_frame),
    has_out: row.status === "done" && !!row.out_frame && fs.existsSync(row.out_frame),
  };
}

function queueCount(userId) {
  return db.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE user_id = ? AND status IN ('queued','processing')`).get(userId).c;
}

async function cleanupUpload(p) {
  try { await fs.promises.unlink(p); } catch (err) {}
}

async function runJob(job) {
  const started = Date.now();
  db.prepare(`UPDATE jobs SET status='processing', phase='preparing', progress=0 WHERE id=? AND status='queued'`).run(job.id);
  const inPath = job.in_path;
  if (!inPath) throw new Error("File for this job has already been deleted.");
  const meta = await encoder.probe(inPath);
  const target = encoder.targets(meta);
  const factor = job.mode === "fps120" ? EST_FACTOR_120 : job.mode === "best" ? EST_FACTOR_BEST : EST_FACTOR_FAST;
  db.prepare(`UPDATE jobs SET phase='encoding', duration_ms=?, est_ms=?, src_w=?, src_h=?, out_w=?, out_h=? WHERE id=?`)
    .run(meta.durationMs, Math.round(meta.durationMs * factor), target.srcW, target.srcH, target.outW, target.outH, job.id);

  const outPath = path.join(OUTPUT_DIR, job.id + ".mp4");
  let lastWrite = 0;
  await encoder.run(job, meta, outPath, (pct) => {
    const now = Date.now();
    if (now - lastWrite < 1000 && pct < 100) return;
    lastWrite = now;
    db.prepare(`UPDATE jobs SET progress=? WHERE id=? AND status='processing'`).run(pct, job.id);
  });

  const stat = await fs.promises.stat(outPath);
  db.prepare(`UPDATE jobs SET status='done', phase='', progress=100, output_size=?, output_name=?, finished_at=? WHERE id=?`)
    .run(stat.size, job.id + ".mp4", Date.now(), job.id);
  const t = Math.max(0.5, Math.min(((meta.durationMs || 3000) / 1000) * 0.35, (meta.durationMs || 3000) / 1000 - 0.5));
  const srcFrame = path.join(FRAMES_DIR, job.id + "-src.jpg");
  const outFrame = path.join(FRAMES_DIR, job.id + "-out.jpg");
  const gotSrc = await encoder.grabFrame(inPath, t, srcFrame);
  const gotOut = await encoder.grabFrame(outPath, t, outFrame);
  if (gotSrc || gotOut) {
    db.prepare(`UPDATE jobs SET src_frame=?, out_frame=? WHERE id=?`).run(gotSrc ? srcFrame : null, gotOut ? outFrame : null, job.id);
  }
  await cleanupUpload(inPath);
  console.log(`[done] ${job.title || job.id} -> 4K in ${((Date.now() - started) / 60000).toFixed(1)} min (${(stat.size / 1048576).toFixed(0)} MB)`);
}

app.get("/api/jobs", authRequired((req, res, user) => {
  const rows = db.prepare(`SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`).all(user.userId);
  res.json({ jobs: rows.map(rowToJob) });
}));

app.get("/api/jobs/:id", authRequired((req, res, user) => {
  const row = job(req.params.id);
  if (!row || row.user_id !== user.userId) return res.status(404).json({ error: "Job not found." });
  res.json({ job: rowToJob(row) });
}));

app.get("/api/files/:id", authRequired((req, res, user) => {
  const row = job(req.params.id);
  if (!row || row.user_id !== user.userId || row.status !== "done") return res.status(404).json({ error: "Not ready." });
  const p = path.join(OUTPUT_DIR, row.id + ".mp4");
  if (!fs.existsSync(p)) return res.status(404).json({ error: "File expired." });
  const isInline = req.query.inline === "1";
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Cache-Control", "no-store");
  if (!isInline) res.setHeader("Content-Disposition", `attachment; filename="${(row.title || "video").replace(/[^\w .@()-]+/g, "_").slice(0, 80)} [4K].mp4"`);
  fs.createReadStream(p).pipe(res);
}));

app.get("/api/files/:id/frame/:which", authRequired((req, res, user) => {
  const row = job(req.params.id);
  if (!row || row.user_id !== user.userId || row.status !== "done") return res.status(404).json({ error: "Not ready." });
  const p = req.params.which === "src" ? row.src_frame : req.params.which === "out" ? row.out_frame : null;
  if (!p || !fs.existsSync(p)) return res.status(404).json({ error: "No frame." });
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.sendFile(p);
}));

app.get("/app", (req, res) => res.sendFile(path.join(__dirname, "public", "app.html")));

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "not_found" });
  next();
});

setInterval(() => {
  const cutoff = Date.now() - TTL_HOURS * 3600 * 1000;
  const rows = db.prepare(`SELECT id, out_path, src_frame, out_frame FROM jobs WHERE finished_at IS NOT NULL AND finished_at < ?`).all(cutoff);
  for (const row of rows) {
    try { if (row.out_path && fs.existsSync(row.out_path)) fs.unlinkSync(row.out_path); } catch (err) {}
    try { if (row.src_frame && fs.existsSync(row.src_frame)) fs.unlinkSync(row.src_frame); } catch (err) {}
    try { if (row.out_frame && fs.existsSync(row.out_frame)) fs.unlinkSync(row.out_frame); } catch (err) {}
  }
  db.prepare(`DELETE FROM jobs WHERE finished_at IS NOT NULL AND finished_at < ?`).run(cutoff);
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`4K Enhancer server running on port ${PORT}${DEMO ? " (demo mode)" : ""}`);
});

process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));
process.on("uncaughtException", (err) => console.error("Uncaught exception:", err));
