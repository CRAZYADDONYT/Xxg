import express from 'express';
import session from 'express-session';
import SQLiteStoreFactory from 'connect-sqlite3';
import cookieParser from 'cookie-parser';
import Database from 'better-sqlite3';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const uploadsDir = path.join(rootDir, 'uploads');
const videoUploadsDir = path.join(uploadsDir, 'videos');
const thumbUploadsDir = path.join(uploadsDir, 'thumbs');
const maxUploadSize = 500 * 1024 * 1024;
const allowedMimes = new Set(['video/mp4', 'video/quicktime', 'video/x-msvideo']);
const allowedExt = new Set(['.mp4', '.mov', '.avi']);

fs.mkdirSync(videoUploadsDir, { recursive: true });
fs.mkdirSync(thumbUploadsDir, { recursive: true });

const app = express();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
const db = new Database(path.join(__dirname, '../app.db'));
const SQLiteStore = SQLiteStoreFactory(session);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_name TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  video_url TEXT NOT NULL,
  thumbnail_url TEXT NOT NULL,
  duration_label TEXT DEFAULT '00:00',
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  size_bytes INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  original_name TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

app.use(express.json());
app.use(cookieParser());
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, '..') }),
  secret: process.env.SESSION_SECRET || 'xxgs-secret-change-me',
  resave: false,
  saveUninitialized: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: false }
}));

// Ensure each browser session is attached to a channel/account.
app.use((req, res, next) => {
  if (req.session.userId) return next();
  const channelName = `XXG Creator ${Math.floor(Math.random() * 9000) + 1000}`;
  const info = db.prepare('INSERT INTO users (channel_name) VALUES (?)').run(channelName);
  req.session.userId = info.lastInsertRowid;
  req.session.channelName = channelName;
  next();
});

app.use('/uploads', express.static(uploadsDir));
app.use(express.static(rootDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, file.fieldname === 'videoFile' ? videoUploadsDir : thumbUploadsDir),
  filename: (req, file, cb) => {
    const safeBase = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeBase}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: maxUploadSize },
  fileFilter: (req, file, cb) => {
    if (file.fieldname !== 'videoFile') return cb(null, true);
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExt.has(ext) || !allowedMimes.has(file.mimetype)) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'videoFile'));
    }
    return cb(null, true);
  }
});

function timeAgo(iso) {
  const diffHrs = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 36e5));
  if (diffHrs < 24) return `${diffHrs} hours ago`;
  const days = Math.floor(diffHrs / 24);
  return `${days} days ago`;
}

app.get('/api/account/session', (req, res) => {
  res.json({ userId: req.session.userId, channelName: req.session.channelName });
});

app.post('/api/account/channel', (req, res) => {
  const channelName = String(req.body.channelName || '').trim();
  if (!channelName || channelName.length > 50) return res.status(400).json({ error: 'Channel name must be 1-50 characters.' });
  db.prepare('UPDATE users SET channel_name = ? WHERE id = ?').run(channelName, req.session.userId);
  req.session.channelName = channelName;
  return res.json({ ok: true, channelName });
});

app.get('/api/videos', (req, res) => {
  const { q = '', category = '' } = req.query;
  const rows = db.prepare(`SELECT * FROM videos WHERE title LIKE ? AND (? = '' OR category = ?) ORDER BY id DESC`).all(`%${q}%`, category, category);
  return res.json(rows.map((r) => ({ ...r, time_ago: timeAgo(r.created_at) })));
});

app.post('/api/videos/upload', upload.fields([{ name: 'videoFile', maxCount: 1 }, { name: 'thumbnailFile', maxCount: 1 }]), async (req, res) => {
  try {
    const { titleInput, descriptionInput, categoryInput } = req.body;
    const video = req.files?.videoFile?.[0];
    const thumb = req.files?.thumbnailFile?.[0];

    if (!titleInput || !descriptionInput || !categoryInput) return res.status(400).json({ error: 'Missing title, description, or category.' });
    if (!video || !thumb) return res.status(400).json({ error: 'Video file and thumbnail are required.' });

    const record = db.prepare(`INSERT INTO videos (user_id, title, description, category, channel_name, video_url, thumbnail_url, duration_label, size_bytes, mime_type, original_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.session.userId, titleInput.trim(), descriptionInput.trim(), categoryInput, req.session.channelName, `/uploads/videos/${video.filename}`, `/uploads/thumbs/${thumb.filename}`, '00:00', video.size, video.mimetype, video.originalname);

    return res.status(201).json({ ok: true, videoId: record.lastInsertRowid });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to save upload.' });
  }
});

app.use((err, req, res, next) => {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Video exceeds 500MB max size.' });
    return res.status(400).json({ error: 'Invalid file type. Allowed: mp4, mov, avi.' });
  }
  return res.status(500).json({ error: 'Upload failed unexpectedly.' });
});

app.get('/api/videos/:id', (req, res) => {
  db.prepare('UPDATE videos SET views = views + 1 WHERE id = ?').run(req.params.id);
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Not found' });
  const comments = db.prepare('SELECT * FROM comments WHERE video_id = ? ORDER BY id DESC').all(req.params.id);
  return res.json({ video: { ...video, time_ago: timeAgo(video.created_at) }, comments });
});
app.post('/api/videos/:id/like', (req, res) => { db.prepare('UPDATE videos SET likes = likes + 1 WHERE id = ?').run(req.params.id); res.json({ ok: true }); });
app.post('/api/videos/:id/subscribe', (req, res) => res.json({ ok: true }));
app.post('/api/videos/:id/comments', (req, res) => {
  const { author = 'Guest', body } = req.body;
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'Comment cannot be empty.' });
  db.prepare('INSERT INTO comments (video_id, author, body) VALUES (?, ?, ?)').run(req.params.id, author, body.trim());
  return res.status(201).json({ ok: true });
});

app.get('*', (req, res) => res.sendFile(path.join(rootDir, 'index.html')));
app.listen(3000, () => console.log("XXG's running at http://localhost:3000"));
