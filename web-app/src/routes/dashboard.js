const express = require('express');
const { requireAuth } = require('../auth');
const { getGameStatus } = require('../k8s');

const router = express.Router();

router.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.redirect('/login');
});

router.get('/dashboard', requireAuth, async (req, res) => {
  const status = await getGameStatus(req.session.userId);
  if ((status.running || status.pending) && !req.query.error) {
    return res.redirect('/play');
  }
  res.render('dashboard', { status, error: req.query.error || null });
});

module.exports = router;
