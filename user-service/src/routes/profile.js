const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const AWS = require('aws-sdk');
const verifyToken = require('../middleware/verifyToken');

const dynamo = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'eu-north-1',
});

const TABLE = process.env.DYNAMO_USERS_TABLE || 'my-circle-users';

// ── Interest schema ─────────────────────────────────────
// Hierarchical interest structure:
// {
//   category: "Music",
//   subcategory: "Alternative Rock",      // optional
//   specific: "Smashing Pumpkins",        // optional
//   weight: 3                             // 1=category, 2=subcategory, 3=specific
// }

function normaliseInterests(interests) {
  return interests.map(interest => {
    // Support both flat strings (legacy) and hierarchical objects
    if (typeof interest === 'string') {
      return {
        category: interest,
        subcategory: null,
        specific: null,
        weight: 1,
      };
    }

    const weight = interest.specific ? 3 : interest.subcategory ? 2 : 1;
    return {
      category: interest.category,
      subcategory: interest.subcategory || null,
      specific: interest.specific || null,
      weight,
    };
  });
}

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
router.post(
  '/onboard',
  verifyToken,
  [
    body('displayName').notEmpty().withMessage('Display name required'),
    body('interests')
      .isArray({ min: 1 })
      .withMessage('At least 1 interest required'),
    body('interests.*.category')
      .optional()
      .isString()
      .withMessage('Interest category must be a string'),
    body('school').optional().isString(),
    body('location').optional().isObject(),
    body('bio').optional().isString(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { displayName, interests, school, location, bio } = req.body;

    const normalisedInterests = normaliseInterests(interests);

    const profile = {
      userId: req.userId,
      displayName,
      interests: normalisedInterests,
      school: school || null,
      location: location || null,
      bio: bio || null,
      communicationFingerprint: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await dynamo
        .put({ TableName: TABLE, Item: profile })
        .promise();

      res.status(201).json({ message: 'Profile created', profile });
    } catch (err) {
      next(err);
    }
  }
);

// ── PUT /profile/interests ──────────────────────────────
// Add or update interests after onboarding
router.put(
  '/interests',
  verifyToken,
  [
    body('interests')
      .isArray({ min: 1 })
      .withMessage('At least 1 interest required'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { interests } = req.body;
    const normalisedInterests = normaliseInterests(interests);

    try {
      await dynamo.update({
        TableName: TABLE,
        Key: { userId: req.userId },
        UpdateExpression: 'SET interests = :interests, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':interests': normalisedInterests,
          ':updatedAt': new Date().toISOString(),
        },
      }).promise();

      res.status(200).json({
        message: 'Interests updated',
        interests: normalisedInterests,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;