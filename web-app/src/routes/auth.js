const express = require('express');
const { createUser, verifyPassword } = require('../auth');

const router = express.Router();

router.get('/register', (req, res) => {
  res.render('register', { error: null });
});

router.post('/register', async (req, res) => {
  const { email, password, confirmPassword } = req.body;

  if (!email || !password) {
    return res.render('register', { error: 'Email and password are required.' });
  }
  if (password !== confirmPassword) {
    return res.render('register', { error: 'Passwords do not match.' });
  }
  if (password.length < 8) {
    return res.render('register', { error: 'Password must be at least 8 characters.' });
  }

  try {
    const user = await createUser(email, password);
    req.session.userId = user.id;
    res.redirect('/dashboard');
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.render('register', { error: 'An account with that email already exists.' });
    }
    throw err;
  }
});

router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const user = await verifyPassword(email, password);
  if (!user) {
    return res.render('login', { error: 'Invalid email or password.' });
  }

  req.session.userId = user.id;
  res.redirect('/dashboard');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
