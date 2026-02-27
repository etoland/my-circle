const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const AWS = require('aws-sdk');
const verifyToken = require('../middleware/verifyToken');

const dynamo = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const TABLE = process.env.DYNAMO_USERS_TABLE || 'my-circle-users';

// ── GET /profile/me ─────────────────────────────────────
router.get('/me', verifyToken, async (req, res, next) => {
  try {
    const result = await dynamo
      .get({ TableName: TABLE, Key: { userId: req.userId } })
      .promise();

    if (!result.Item) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.status(200).json(result.Item);
  } catch (err) {
    next(err);
  }
});

// ── POST /profile/onboard ───────────────────────────────
// Called after registration to collect interests, school, etc.
// This data will also be written to Neptune by the match-service
router.post(
  '/onboard',
  verifyToken,
  [
    body('displayName').notEmpty(),
    body('interests').isArray({ min: 1 }).withMessage('At least 1 interest required'),
    body('school').optional().isString(),
    body('location').optional().isObject(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { displayName, interests, school, location } = req.body;

    const profile = {
      userId: req.userId,
      displayName,
      interests,
      school: school || null,
      location: location || null,
      communicationFingerprint: {},   // populated later by speech-service
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await dynamo
        .put({ TableName: TABLE, Item: profile })
        .promise();

      // TODO: emit an event to match-service to write this user into Neptune graph
      // This will be wired up via SQS in Phase 2

      res.status(201).json({ message: 'Profile created', profile });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
