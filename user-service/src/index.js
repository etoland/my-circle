require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const logger = require('./middleware/logger');
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const healthRoutes = require('./routes/health');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(logger);

// ── Routes ──────────────────────────────────────────────
app.use('/health', healthRoutes);
app.use('/auth', authRoutes);
app.use('/profile', profileRoutes);

// ── Global error handler ────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

app.listen(PORT, () => {
  console.log(`[user-service] Running on port ${PORT}`);
  console.log(`[user-service] Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
