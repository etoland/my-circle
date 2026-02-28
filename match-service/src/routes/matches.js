const express = require('express');
const router = express.Router();
const AWS = require('aws-sdk');
const { getGraphClient } = require('../graph/connection');
const { process: gprocess } = require('gremlin');
const __ = gprocess.statics;
const { order, desc } = gprocess;

const dynamo = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'eu-north-1',
});

const TABLE = process.env.DYNAMO_USERS_TABLE || 'my-circle-users';
const MATCH_LIMIT = parseInt(process.env.MATCH_LIMIT || '10');
const MIN_INTERESTS = parseInt(process.env.MATCH_MIN_INTERESTS || '2');

function verifyToken(req, res, next) {
  const jwt = require('jsonwebtoken');
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.decode(token);
    if (!decoded) return res.status(401).json({ error: 'Invalid token' });
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < now) return res.status(401).json({ error: 'Token expired' });
    req.userId = decoded.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalid' });
  }
}

// GET /matches/:userId
// Returns top matches for a user based on shared interests in Neptune
router.get('/:userId', verifyToken, async (req, res, next) => {
  const { userId } = req.params;

  try {
    const g = getGraphClient();

    // Tier 1 — find users sharing 2+ interests
    const matchResults = await g.V()
      .has('User', 'userId', userId)
      .out('HAS_INTEREST')
      .in_('HAS_INTEREST')
      .where(__.not(__.has('User', 'userId', userId)))
      .groupCount()
      .unfold()
      .where(__.select(gprocess.column.values).is(gprocess.P.gte(MIN_INTERESTS)))
      .order().by(__.select(gprocess.column.values), gprocess.order.desc)
      .limit(MATCH_LIMIT)
      .select(gprocess.column.keys)
      .valueMap('userId')
      .toList();

    if (!matchResults || matchResults.length === 0) {
      return res.status(200).json({ matches: [] });
    }

    // Enrich with DynamoDB profile data
const matchedUserIds = matchResults.map(r => {
  if (r instanceof Map) return r.get('userId')[0];
  return r.userId?.[0] || r.userId;
}).filter(Boolean);

    const enrichedMatches = await Promise.all(
      matchedUserIds.map(async (matchedUserId) => {
        try {
          const result = await dynamo
            .get({ TableName: TABLE, Key: { userId: matchedUserId } })
            .promise();

          if (!result.Item) return null;

          const profile = result.Item;

          // Get shared interest count for match score
          const sharedCount = await g.V()
            .has('User', 'userId', userId)
            .out('HAS_INTEREST')
            .in_('HAS_INTEREST')
            .has('User', 'userId', matchedUserId)
            .count()
            .next();

          const shared = sharedCount.value || 0;
          const matchScore = Math.min(Math.round(50 + (shared * 15)), 99);

          return {
            userId: matchedUserId,
            displayName: profile.displayName,
            location: profile.location || null,
            school: profile.school || null,
            interests: profile.interests || [],
            vibe: profile.communicationFingerprint?.vibe || null,
            matchScore,
            voucher: null,
          };
        } catch (err) {
          return null;
        }
      })
    );

    const matches = enrichedMatches
      .filter(Boolean)
      .sort((a, b) => b.matchScore - a.matchScore);

    res.status(200).json({ matches });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
