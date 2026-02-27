# match-service

Handles graph traversal against Amazon Neptune to find compatible users.

## Phase 2 — not yet implemented

This service will be built after user-service is deployed to ECS.

### Planned endpoints

- `GET /matches/:userId` — return top 5 matches from Neptune graph
- `POST /matches/:userId/accept` — create CONNECTED_TO edge in Neptune
- `POST /matches/:userId/decline` — log and skip

### Neptune query strategy

Traversal will use Gremlin to find users within 2 degrees of connection
who share 2+ interests and have overlapping communication fingerprints.
