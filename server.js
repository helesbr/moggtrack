

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

app.delete('/api/sessions/:id', (req, res) => {
  const idx = data.sessions.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Séance introuvable' });
  const removed = data.sessions.splice(idx, 1);
  saveData(data);
  res.json({ message: 'Séance supprimée', session: removed[0] });
});

// --- TEMPLATES API ---
// Template: { id, name, weekType, sessions: [{ name, dayOfWeek (1=Lun..7=Dim), blocks: [{ type, exercises: [{ name, setsCount }] }] }] }
app.get('/api/templates', (req, res) => res.json(data.templates));

app.get('/api/templates/:id', (req, res) => {
  const t = data.templates.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Template introuvable' });
  res.json(t);
});

app.post('/api/templates', (req, res) => {
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
  data.templates.push(tpl);
  saveData(data);
  res.status(201).json(tpl);
});

app.put('/api/templates/:id', (req, res) => {
  const idx = data.templates.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Template introuvable' });
  const { name, weekType, sessions: tplSessions } = req.body;
  if (name) data.templates[idx].name = name.trim().slice(0, 200);
  if (weekType !== undefined) data.templates[idx].weekType = (weekType || '').trim().slice(0, 100);
  if (Array.isArray(tplSessions)) {
    data.templates[idx].sessions = tplSessions.map(s => ({
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
  saveData(data);
  res.json(data.templates[idx]);
});

app.delete('/api/templates/:id', (req, res) => {
  const idx = data.templates.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Template introuvable' });
  data.templates.splice(idx, 1);
  saveData(data);
  res.json({ message: 'Template supprimé' });
});

// Appliquer un template à une semaine
app.post('/api/templates/:id/apply', (req, res) => {
  const tpl = data.templates.find(t => t.id === req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Template introuvable' });
  const { weekStart } = req.body; // "2026-03-23" (lundi)
  if (!weekStart) return res.status(400).json({ error: 'weekStart requis' });

  const created = [];
  tpl.sessions.forEach(tplSession => {
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
    data.sessions.push(session);
    created.push(session);
  });
  saveData(data);
  res.status(201).json({ message: `${created.length} séances créées`, sessions: created });
});

// --- TOP PERFS API ---
app.get('/api/top-perfs', (req, res) => {
  const perfs = {};
  data.sessions.forEach(session => {
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
});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
