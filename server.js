const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const crypto   = require('crypto');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'benekeup2026';

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// ── Routes HTML ───────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/',      (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── PostgreSQL ────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      icon TEXT DEFAULT 'fas fa-star',
      title_fr TEXT NOT NULL DEFAULT '',
      title_en TEXT NOT NULL DEFAULT '',
      desc_fr TEXT DEFAULT '',
      desc_en TEXT DEFAULT '',
      price TEXT DEFAULT '',
      tag_fr TEXT DEFAULT '',
      tag_en TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS gallery (
      id TEXT PRIMARY KEY,
      filename TEXT DEFAULT '',
      image_data TEXT DEFAULT NULL,
      label_fr TEXT DEFAULT '',
      label_en TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      location TEXT DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      rating INTEGER DEFAULT 5,
      approved BOOLEAN DEFAULT FALSE,
      date TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tokens (
      token TEXT PRIMARY KEY,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Seed services si vide
  const { rowCount: sc } = await pool.query('SELECT 1 FROM services LIMIT 1');
  if (!sc) {
    for (const s of require('./data/services-default.json')) {
      await pool.query(
        'INSERT INTO services(id,icon,title_fr,title_en,desc_fr,desc_en,price,tag_fr,tag_en) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING',
        [s.id, s.icon, s.title_fr, s.title_en, s.desc_fr, s.desc_en, s.price, s.tag_fr, s.tag_en]
      );
    }
  }

  // Seed gallery si vide
  const { rowCount: gc } = await pool.query('SELECT 1 FROM gallery LIMIT 1');
  if (!gc) {
    for (const g of require('./data/gallery-default.json')) {
      await pool.query(
        'INSERT INTO gallery(id,filename,label_fr,label_en) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [g.id, g.filename, g.label_fr, g.label_en]
      );
    }
  }

  // Seed reviews si vide
  const { rowCount: rc } = await pool.query('SELECT 1 FROM reviews LIMIT 1');
  if (!rc) {
    for (const r of require('./data/reviews-default.json')) {
      await pool.query(
        'INSERT INTO reviews(id,name,location,text,rating,approved,date) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
        [r.id, r.name, r.location, r.text, r.rating, r.approved, r.date]
      );
    }
  }

  console.log('✅ Base de données initialisée');
}

// Charge les tokens actifs en mémoire
const activeTokens = new Set();
async function loadTokens() {
  const res = await pool.query("SELECT token FROM tokens WHERE created_at > NOW() - INTERVAL '7 days'");
  res.rows.forEach(r => activeTokens.add(r.token));
}

// ── Upload (mémoire → base64 en DB) ──────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// ── Auth ──────────────────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!activeTokens.has(token)) return res.status(401).json({ error: 'Non autorisé' });
  next();
}

app.post('/api/auth/login', (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  const token = crypto.randomBytes(32).toString('hex');
  activeTokens.add(token);
  pool.query('INSERT INTO tokens(token) VALUES($1) ON CONFLICT DO NOTHING', [token]);
  res.json({ token });
});

app.post('/api/auth/logout', auth, (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  activeTokens.delete(token);
  pool.query('DELETE FROM tokens WHERE token=$1', [token]);
  res.json({ ok: true });
});

// ── Services ──────────────────────────────────────────────────────────────────
app.get('/api/services', async (req, res) => {
  const r = await pool.query('SELECT * FROM services ORDER BY created_at');
  res.json(r.rows);
});

app.post('/api/services', auth, async (req, res) => {
  const { icon, title_fr, title_en, desc_fr, desc_en, price, tag_fr, tag_en } = req.body;
  const id = Date.now().toString();
  await pool.query(
    'INSERT INTO services(id,icon,title_fr,title_en,desc_fr,desc_en,price,tag_fr,tag_en) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, icon, title_fr, title_en, desc_fr, desc_en, price, tag_fr, tag_en]
  );
  res.json({ id, ...req.body });
});

app.put('/api/services/:id', auth, async (req, res) => {
  const { icon, title_fr, title_en, desc_fr, desc_en, price, tag_fr, tag_en } = req.body;
  await pool.query(
    'UPDATE services SET icon=$1,title_fr=$2,title_en=$3,desc_fr=$4,desc_en=$5,price=$6,tag_fr=$7,tag_en=$8 WHERE id=$9',
    [icon, title_fr, title_en, desc_fr, desc_en, price, tag_fr, tag_en, req.params.id]
  );
  res.json({ id: req.params.id, ...req.body });
});

app.delete('/api/services/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM services WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ── Galerie ───────────────────────────────────────────────────────────────────
app.get('/api/gallery', async (req, res) => {
  const r = await pool.query('SELECT id,filename,label_fr,label_en FROM gallery ORDER BY created_at');
  res.json(r.rows);
});

// Sert les images uploadées depuis la DB
app.get('/api/gallery/:id/image', async (req, res) => {
  try {
    const r = await pool.query('SELECT image_data FROM gallery WHERE id=$1', [req.params.id]);
    if (!r.rows.length || !r.rows[0].image_data) return res.status(404).end();
    const buf = Buffer.from(r.rows[0].image_data, 'base64');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch { res.status(500).end(); }
});

app.post('/api/gallery', auth, upload.single('image'), async (req, res) => {
  const id = Date.now().toString();
  let filename = req.body.filename || '';
  let imageData = null;

  if (req.file) {
    imageData = req.file.buffer.toString('base64');
    filename  = `/api/gallery/${id}/image`;
  }

  await pool.query(
    'INSERT INTO gallery(id,filename,image_data,label_fr,label_en) VALUES($1,$2,$3,$4,$5)',
    [id, filename, imageData, req.body.label_fr || '', req.body.label_en || '']
  );
  res.json({ id, filename, label_fr: req.body.label_fr || '', label_en: req.body.label_en || '' });
});

app.put('/api/gallery/:id', auth, upload.single('image'), async (req, res) => {
  const id = req.params.id;
  if (req.file) {
    const imageData = req.file.buffer.toString('base64');
    const filename  = `/api/gallery/${id}/image`;
    await pool.query(
      'UPDATE gallery SET filename=$1,image_data=$2,label_fr=$3,label_en=$4 WHERE id=$5',
      [filename, imageData, req.body.label_fr || '', req.body.label_en || '', id]
    );
  } else {
    await pool.query(
      'UPDATE gallery SET label_fr=$1,label_en=$2 WHERE id=$3',
      [req.body.label_fr || '', req.body.label_en || '', id]
    );
  }
  res.json({ ok: true });
});

app.delete('/api/gallery/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM gallery WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ── Avis ──────────────────────────────────────────────────────────────────────
app.get('/api/reviews', async (req, res) => {
  const r = await pool.query('SELECT * FROM reviews WHERE approved=true ORDER BY created_at');
  res.json(r.rows);
});

app.post('/api/reviews', async (req, res) => {
  const id = Date.now().toString();
  await pool.query(
    'INSERT INTO reviews(id,name,location,text,rating,approved,date) VALUES($1,$2,$3,$4,$5,false,$6)',
    [id,
     (req.body.name     || '').slice(0, 60),
     (req.body.location || '').slice(0, 80),
     (req.body.text     || '').slice(0, 500),
     Math.min(5, Math.max(1, parseInt(req.body.rating) || 5)),
     new Date().toISOString().split('T')[0]]
  );
  res.json({ ok: true });
});

app.get('/api/admin/reviews', auth, async (req, res) => {
  const r = await pool.query('SELECT * FROM reviews ORDER BY created_at DESC');
  res.json(r.rows);
});

app.put('/api/reviews/:id/approve', auth, async (req, res) => {
  const r = await pool.query('UPDATE reviews SET approved = NOT approved WHERE id=$1 RETURNING *', [req.params.id]);
  res.json(r.rows[0]);
});

app.delete('/api/reviews/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM reviews WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ── Démarrage ─────────────────────────────────────────────────────────────────
(async () => {
  try {
    await initDB();
    await loadTokens();
    app.listen(PORT, () => console.log(`🚀 Benekeup Beauty sur le port ${PORT}`));
  } catch (err) {
    console.error('❌ Erreur DB:', err.message);
    // Démarrer quand même sans DB (mode dégradé)
    app.listen(PORT, () => console.log(`⚠️  Démarré sans DB sur le port ${PORT}`));
  }
})();
