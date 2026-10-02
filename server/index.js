import express from 'express';
import multer from 'multer';
import mysql from 'mysql2/promise';
import { createReadStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const databaseName = process.env.MYSQL_DATABASE || 'musetrainer';
if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
  throw new Error('MYSQL_DATABASE must contain only letters, numbers, and underscores');
}

const uploadDir = process.env.UPLOAD_DIR || path.resolve('uploads');
const extensions = new Set(['.xml', '.musicxml', '.mxl']);
const databaseOptions = {
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  port: Number(process.env.MYSQL_PORT || 3306),
};
if (!databaseOptions.host || !databaseOptions.user || !databaseOptions.password) {
  throw new Error('MYSQL_HOST, MYSQL_USER, and MYSQL_PASSWORD are required');
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function recordId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new HttpError(400, 'Invalid ID');
  }
  return Number(value);
}

function requiredText(value, label, maxLength = 255) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maxLength) {
    throw new HttpError(400, `${label} is required and must be ${maxLength} characters or fewer`);
  }
  return text;
}

async function initializeDatabase() {
  const connection = await mysql.createConnection(databaseOptions);
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end();
  }

  const pool = mysql.createPool({
    ...databaseOptions,
    database: databaseName,
    waitForConnections: true,
    connectionLimit: 10,
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS folders (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      parent_id BIGINT UNSIGNED NULL,
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_folder_name (parent_id, name),
      CONSTRAINT folders_parent_fk FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scores (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      folder_id BIGINT UNSIGNED NOT NULL,
      title VARCHAR(255) NOT NULL,
      composer VARCHAR(255) NOT NULL,
      original_filename VARCHAR(255) NOT NULL,
      stored_filename VARCHAR(80) NOT NULL UNIQUE,
      size_bytes BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY scores_folder_title (folder_id, title),
      CONSTRAINT scores_folder_fk FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
  await pool.execute("INSERT IGNORE INTO folders (id, parent_id, name) VALUES (1, NULL, 'Library')");
  return pool;
}

await mkdir(uploadDir, { recursive: true });
const pool = await initializeDatabase();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_request, file, callback) => {
    callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!extensions.has(path.extname(file.originalname).toLowerCase())) {
      callback(new HttpError(400, 'Select a .xml, .musicxml, or .mxl file'));
      return;
    }
    callback(null, true);
  },
});

async function findFolder(id) {
  const [rows] = await pool.execute(
    'SELECT id, parent_id AS parentId, name FROM folders WHERE id = ?',
    [id]
  );
  if (!rows.length) throw new HttpError(404, 'Folder not found');
  return rows[0];
}

async function findScore(id) {
  const [rows] = await pool.execute(
    `SELECT id, folder_id AS folderId, title, composer,
      original_filename AS originalFilename, stored_filename AS storedFilename,
      size_bytes AS sizeBytes FROM scores WHERE id = ?`,
    [id]
  );
  if (!rows.length) throw new HttpError(404, 'Score not found');
  return rows[0];
}

app.get('/api/health', async (_request, response) => {
  await pool.query('SELECT 1');
  response.json({ ok: true });
});

app.get('/api/library/folders/:id', async (request, response) => {
  const id = recordId(request.params.id);
  const folder = await findFolder(id);
  const [folders] = await pool.execute(
    'SELECT id, name FROM folders WHERE parent_id = ? ORDER BY name',
    [id]
  );
  const [scores] = await pool.execute(
    `SELECT id, title, composer, original_filename AS originalFilename,
      size_bytes AS sizeBytes FROM scores WHERE folder_id = ? ORDER BY title, composer`,
    [id]
  );
  response.json({ folder, folders, scores });
});

app.post('/api/library/folders/:id/folders', async (request, response) => {
  const parentId = recordId(request.params.id);
  await findFolder(parentId);
  const name = requiredText(request.body.name, 'Folder name');
  const [result] = await pool.execute(
    'INSERT INTO folders (parent_id, name) VALUES (?, ?)',
    [parentId, name]
  );
  response.status(201).json({ id: result.insertId, name });
});

app.patch('/api/library/folders/:id', async (request, response) => {
  const id = recordId(request.params.id);
  if (id === 1) throw new HttpError(400, 'The library folder cannot be renamed');
  await findFolder(id);
  const name = requiredText(request.body.name, 'Folder name');
  await pool.execute('UPDATE folders SET name = ? WHERE id = ?', [name, id]);
  response.json({ id, name });
});

app.delete('/api/library/folders/:id', async (request, response) => {
  const id = recordId(request.params.id);
  if (id === 1) throw new HttpError(400, 'The library folder cannot be deleted');
  await findFolder(id);
  const [files] = await pool.execute(
    `WITH RECURSIVE descendants AS (
      SELECT id FROM folders WHERE id = ?
      UNION ALL
      SELECT folders.id FROM folders JOIN descendants ON folders.parent_id = descendants.id
    ) SELECT scores.stored_filename AS storedFilename
      FROM scores JOIN descendants ON scores.folder_id = descendants.id`,
    [id]
  );
  await pool.execute('DELETE FROM folders WHERE id = ?', [id]);
  await Promise.all(files.map(file => unlink(path.join(uploadDir, file.storedFilename)).catch(() => {})));
  response.status(204).end();
});

app.post('/api/library/folders/:id/scores', upload.single('file'), async (request, response) => {
  let saved = false;
  try {
    const folderId = recordId(request.params.id);
    await findFolder(folderId);
    const title = requiredText(request.body.title, 'Title');
    const composer = requiredText(request.body.composer, 'Composer');
    if (!request.file) throw new HttpError(400, 'MusicXML file is required');
    const [result] = await pool.execute(
      `INSERT INTO scores (folder_id, title, composer, original_filename, stored_filename, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [folderId, title, composer, request.file.originalname, request.file.filename, request.file.size]
    );
    saved = true;
    response.status(201).json({ id: result.insertId, title, composer });
  } finally {
    if (!saved && request.file) await unlink(request.file.path).catch(() => {});
  }
});

app.patch('/api/library/scores/:id', async (request, response) => {
  const id = recordId(request.params.id);
  await findScore(id);
  const title = requiredText(request.body.title, 'Title');
  const composer = requiredText(request.body.composer, 'Composer');
  await pool.execute('UPDATE scores SET title = ?, composer = ? WHERE id = ?', [title, composer, id]);
  response.json({ id, title, composer });
});

app.delete('/api/library/scores/:id', async (request, response) => {
  const id = recordId(request.params.id);
  const score = await findScore(id);
  await pool.execute('DELETE FROM scores WHERE id = ?', [id]);
  await unlink(path.join(uploadDir, score.storedFilename)).catch(() => {});
  response.status(204).end();
});

app.get('/api/library/scores/:id/file/:filename', async (request, response) => {
  const score = await findScore(recordId(request.params.id));
  if (request.params.filename !== score.originalFilename) {
    throw new HttpError(404, 'Score file not found');
  }
  const extension = path.extname(score.originalFilename).toLowerCase();
  const contentType = extension === '.mxl'
    ? 'application/vnd.recordare.musicxml'
    : 'application/vnd.recordare.musicxml+xml';
  response.set({ 'Content-Type': contentType, 'Cache-Control': 'private, no-store' });
  const stream = createReadStream(path.join(uploadDir, score.storedFilename));
  stream.on('error', () => {
    if (!response.headersSent) response.status(404).json({ error: 'Score file missing from storage' });
    else response.destroy();
  });
  stream.pipe(response);
});

app.use((error, _request, response, _next) => {
  if (error.code === 'ER_DUP_ENTRY') {
    response.status(409).json({ error: 'A folder with that name already exists' });
  } else if (error.code === 'LIMIT_FILE_SIZE') {
    response.status(413).json({ error: 'The MusicXML file must be 20 MB or smaller' });
  } else if (error.status) {
    response.status(error.status).json({ error: error.message });
  } else {
    console.error(error);
    response.status(500).json({ error: 'Server error' });
  }
});

app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {
  console.log(`ScorePlayer API ready on port ${process.env.PORT || 3000}`);
});
