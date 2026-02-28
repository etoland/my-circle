const gremlin = require('gremlin');

let g = null;
let dc = null;

function getGraphClient() {
  if (g) return g;

  const endpoint = process.env.NEPTUNE_ENDPOINT;
  const port = process.env.NEPTUNE_PORT || 8182;

  dc = new gremlin.driver.DriverRemoteConnection(
    `wss://${endpoint}:${port}/gremlin`,
    {
      mimeType: 'application/vnd.gremlin-v2.0+json',
      pingEnabled: false,
      connectOnStartup: false,
      rejectUnauthorized: false,
    }
  );

  g = gremlin.process.AnonymousTraversalSource.traversal().withRemote(dc);

  console.log(`[match-service] Neptune connected: ${endpoint}`);
  return g;
}

async function closeGraphClient() {
  if (dc) await dc.close();
}

module.exports = { getGraphClient, closeGraphClient };