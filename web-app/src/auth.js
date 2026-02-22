const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const SALT_ROUNDS = 10;

const stmts = {
  insertUser: db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)'),
  findByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  findById: db.prepare('SELECT * FROM users WHERE id = ?'),
};

async function createUser(email, password) {
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const id = uuidv4();
  stmts.insertUser.run(id, email, hash);
  return { id, email };
}

async function verifyPassword(email, password) {
  const user = stmts.findByEmail.get(email);
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.password_hash);
  return valid ? { id: user.id, email: user.email } : null;
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

module.exports = { createUser, verifyPassword, requireAuth };
