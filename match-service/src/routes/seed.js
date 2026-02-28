const express = require('express');
const router = express.Router();
const AWS = require('aws-sdk');
const { getGraphClient } = require('../graph/connection');
const { process: gprocess } = require('gremlin');
const __ = gprocess.statics;

const dynamo = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'eu-north-1',
});

const TABLE = process.env.DYNAMO_USERS_TABLE || 'my-circle-users';

// POST /seed/user/:userId
// Reads a user from DynamoDB and writes them into Neptune as a vertex
router.post('/user/:userId', async (req, res, next) => {
  const { userId } = req.params;

  try {
    // 1. Get user from DynamoDB
    const result = await dynamo
      .get({ TableName: TABLE, Key: { userId } })
      .promise();

    if (!result.Item) {
      return res.status(404).json({ error: 'User not found in DynamoDB' });
    }

    const user = result.Item;
    const g = getGraphClient();

    // 2. Create or update User vertex in Neptune
    await g.V().has('User', 'userId', userId).fold()
      .coalesce(
        __.unfold(),
        __.addV('User').property('userId', userId)
      )
      .property('displayName', user.displayName || '')
      .property('city', user.location?.city || '')
      .property('country', user.location?.country || '')
      .next();

    // 3. Add interest edges
    if (user.interests && user.interests.length > 0) {
      for (const interest of user.interests) {
        // Create interest vertex if it doesn't exist
        await g.V().has('Interest', 'label', interest).fold()
          .coalesce(
            __.unfold(),
            __.addV('Interest')
              .property('interestId', interest.toLowerCase().replace(/\s+/g, '_'))
              .property('label', interest)
          )
          .as('i')
          .V().has('User', 'userId', userId)
          .coalesce(
            __.outE('HAS_INTEREST').where(__.inV().has('Interest', 'label', interest)),
            __.addE('HAS_INTEREST').to('i')
          )
          .next();
      }
    }

    // 4. Add school vertex and edge if exists
    if (user.school) {
      await g.V().has('School', 'name', user.school).fold()
        .coalesce(
          __.unfold(),
          __.addV('School').property('schoolId', user.school.toLowerCase().replace(/\s+/g, '_')).property('name', user.school)
        )
        .as('s')
        .V().has('User', 'userId', userId)
        .coalesce(
          __.outE('ATTENDED').where(__.inV().has('School', 'name', user.school)),
          __.addE('ATTENDED').to('s')
        )
        .next();
    }

    res.status(201).json({
      message: 'User seeded into Neptune',
      userId,
      interests: user.interests || [],
      school: user.school || null,
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
