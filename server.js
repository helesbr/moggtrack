require('dotenv').config();
const express = require('express');
const path = require('path');

const { MongoClient, ObjectId } = require('mongodb');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DBNAME = process.env.MONGODB_DBNAME || 'moggtrack';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let db, sessionsCol, templatesCol, tasksCol;

async function connectMongo() {
  const client = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
  await client.connect();
  db = client.db(MONGODB_DBNAME);
  sessionsCol = db.collection('sessions');
  templatesCol = db.collection('templates');
  tasksCol = db.collection('tasks');
  console.log('Connecté à MongoDB Atlas');
}

connectMongo().catch(e => { console.error('Erreur MongoDB:', e); process.exit(1); });

// --- Appliquer un template à une semaine (MongoDB) ---
app.post('/api/templates/:id/apply', async (req, res) => {
  try {
    const tpl = await templatesCol.findOne({ id: req.params.id });
    if (!tpl) return res.status(404).json({ error: 'Template introuvable' });
    const { weekStart } = req.body; // "2026-03-23" (lundi)
    if (!weekStart) return res.status(400).json({ error: 'weekStart requis' });
    const created = [];
    for (const tplSession of tpl.sessions) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + (tplSession.dayOfWeek - 1));
      const dateStr = d.toISOString().slice(0, 10);
      const session = {
        id: crypto.randomUUID(),
        date: dateStr,
        name: tplSession.name,
        blocks: tplSession.blocks.map(b => ({
          type: b.type,
          exercises: b.exercises.map(ex => ({
            name: ex.name,
            rest: ex.rest || 0,
            sets: Array.from({ length: ex.setsCount }, () => ({ reps: 0, weight: 0 }))
          }))
        }))
      };
      await sessionsCol.insertOne(session);
      created.push(session);
    }
    res.status(201).json({ message: `${created.length} séances créées`, sessions: created });
  } catch (e) {
    res.status(500).json({ error: 'Erreur MongoDB' });
  }
});

// --- Utilitaire pour extraire tous les exercices d'une séance (pour top-perfs) ---
function flattenExercises(session) {
  const all = [];
  if (!session.blocks) return all;
  session.blocks.forEach(block => {
    (block.exercises || []).forEach(ex => {
      all.push(ex);
    });
  });
  return all;
}

// --- TOP PERFS API (MongoDB) ---
app.get('/api/top-perfs', async (req, res) => {
  try {
    const sessions = await sessionsCol.find({}).toArray();
    const perfs = {};
    sessions.forEach(session => {
      const exercises = flattenExercises(session);
      exercises.forEach(ex => {
        const key = ex.name.toLowerCase();
        (ex.sets || []).forEach(set => {
          if (!perfs[key] || set.weight > perfs[key].weight ||
             (set.weight === perfs[key].weight && set.reps > perfs[key].reps)) {
            perfs[key] = {
              exercise: ex.name,
              weight: set.weight,
              reps: set.reps,
              sessionId: session.id,
              sessionName: session.name,
              date: session.date
            };
          }
        });
      });
    });
    res.json(Object.values(perfs).sort((a, b) => a.exercise.localeCompare(b.exercise)));
  } catch (e) {
    res.status(500).json({ error: 'Erreur MongoDB' });
  }
});


// --- Supprimer une séance (MongoDB) ---
app.delete('/api/sessions/:id', async (req, res) => {
  try {
    const result = await sessionsCol.deleteOne({ id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Séance introuvable' });
    res.json({ message: 'Séance supprimée' });
  } catch (e) {
    res.status(500).json({ error: 'Erreur MongoDB' });
  }
});


// (Déjà présent plus haut: version MongoDB)


app.post('/api/templates', async (req, res) => {
  const { name, weekType, sessions: tplSessions } = req.body;
  if (!name || !Array.isArray(tplSessions))
    return res.status(400).json({ error: 'Données invalides' });
  const tpl = {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 200),
    weekType: (weekType || '').trim().slice(0, 100),
    sessions: tplSessions.map(s => ({
      name: (s.name || '').trim().slice(0, 200),
      dayOfWeek: Math.max(1, Math.min(7, parseInt(s.dayOfWeek) || 1)),
      blocks: (s.blocks || []).map(b => ({
        type: b.type === 'superset' ? 'superset' : 'single',
        exercises: (b.exercises || []).map(ex => ({
          name: (ex.name || '').trim().slice(0, 200),
          setsCount: Math.max(1, Math.min(20, parseInt(ex.setsCount) || 4)),
          rest: Math.max(0, Math.min(3600, parseInt(ex.rest) || 0))
        }))
      }))
    }))
  };
  try {
    await templatesCol.insertOne(tpl);
    res.status(201).json(tpl);
  } catch (e) {
    res.status(500).json({ error: 'Erreur MongoDB' });
  }
});


app.put('/api/templates/:id', async (req, res) => {
  const { name, weekType, sessions: tplSessions } = req.body;
  const update = {};
  if (name) update.name = name.trim().slice(0, 200);
  if (weekType !== undefined) update.weekType = (weekType || '').trim().slice(0, 100);
  if (Array.isArray(tplSessions)) {
    update.sessions = tplSessions.map(s => ({
      name: (s.name || '').trim().slice(0, 200),
      dayOfWeek: Math.max(1, Math.min(7, parseInt(s.dayOfWeek) || 1)),
      blocks: (s.blocks || []).map(b => ({
        type: b.type === 'superset' ? 'superset' : 'single',
        exercises: (b.exercises || []).map(ex => ({
          name: (ex.name || '').trim().slice(0, 200),
          setsCount: Math.max(1, Math.min(20, parseInt(ex.setsCount) || 4)),
          rest: Math.max(0, Math.min(3600, parseInt(ex.rest) || 0))
        }))
      }))
    }));
  }
  try {
    const result = await templatesCol.findOneAndUpdate(
      { id: req.params.id },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result.value) return res.status(404).json({ error: 'Template introuvable' });
    res.json(result.value);
  } catch (e) {
    res.status(500).json({ error: 'Erreur MongoDB' });
  }
});


app.delete('/api/templates/:id', async (req, res) => {
  try {
    const result = await templatesCol.deleteOne({ id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Template introuvable' });
    res.json({ message: 'Template supprimé' });
  } catch (e) {
    res.status(500).json({ error: 'Erreur MongoDB' });
  }
});


// (Déjà présent plus haut: version MongoDB)

// --- TOP PERFS API ---

app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
