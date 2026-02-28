require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const matchRoutes = require('./routes/matches');
const seedRoutes = require('./routes/seed');
const healthRoutes = require('./routes/health');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use('/health', healthRoutes);
app.use('/matches', matchRoutes);
app.use('/seed', seedRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[match-service] Running on port ${PORT}`);
});

module.exports = app;
