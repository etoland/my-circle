const express = require('express');
const router = express.Router();

// ECS uses this to confirm the container is healthy before routing traffic to it
router.get('/', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'user-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

module.exports = router;// trigger
