const express = require('express');
const { requireAuth } = require('../auth');
const { startGameForUser, stopGameForUser, getGameStatus, updateActivity } = require('../k8s');

const router = express.Router();

router.post('/game/start', requireAuth, async (req, res) => {
  try {
    await startGameForUser(req.session.userId);
    res.redirect('/play');
  } catch (err) {
    console.error('Failed to start game:', err);
    res.redirect('/dashboard?error=start_failed');
  }
});

router.post('/game/stop', requireAuth, async (req, res) => {
  try {
    await stopGameForUser(req.session.userId);
  } catch (err) {
    console.error('Failed to stop game:', err);
  }
  res.redirect('/dashboard');
});

router.get('/play', requireAuth, async (req, res) => {
  const status = await getGameStatus(req.session.userId);
  if (!status.running && !status.pending) {
    return res.redirect('/dashboard');
  }
  res.render('play', { status });
});

router.post('/api/heartbeat', requireAuth, (req, res) => {
  updateActivity(req.session.userId);
  res.json({ ok: true });
});

module.exports = router;
