// Simple request logger — in production this feeds into CloudWatch automatically
// because ECS Fargate captures stdout/stderr from containers
function logger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      JSON.stringify({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString(),
      })
    );
  });
  next();
}

module.exports = logger;
