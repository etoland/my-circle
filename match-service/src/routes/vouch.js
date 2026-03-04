const express = require('express');
const router = express.Router();
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const { getGraphClient } = require('../graph/connection');
const { process: gprocess } = require('gremlin');
const __ = gprocess.statics;
const jwt = require('jsonwebtoken');

const dynamo = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'eu-north-1',
});

const USERS_TABLE = process.env.DYNAMO_USERS_TABLE || 'my-circle-users';
const VOUCHES_TABLE = process.env.DYNAMO_VOUCHES_TABLE || 'my-circle-vouches';
const VOUCH_EXPIRY_HOURS = parseInt(process.env.VOUCH_EXPIRY_HOURS || '48');

function verifyToken(req, res, next) {
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

// ── POST /vouch ──────────────────────────────────────────
// Creates a vouch introducing userA to userB
// Body: { userAId, userBId, vouchNote }
router.post('/', verifyToken, async (req, res, next) => {
  const fromUserId = req.userId;
  const { userAId, userBId, vouchNote } = req.body;

  if (!userAId || !userBId) {
    return res.status(400).json({ error: 'userAId and userBId are required' });
  }

  if (userAId === userBId) {
    return res.status(400).json({ error: 'Cannot vouch a user for themselves' });
  }

  if (!vouchNote || vouchNote.trim().length === 0) {
    return res.status(400).json({ error: 'Vouch note is required' });
  }

  if (vouchNote.length > 140) {
    return res.status(400).json({ error: 'Vouch note must be 140 characters or less' });
  }

  try {
    // Verify all three users exist
    const [fromUser, userA, userB] = await Promise.all([
      dynamo.get({ TableName: USERS_TABLE, Key: { userId: fromUserId } }).promise(),
      dynamo.get({ TableName: USERS_TABLE, Key: { userId: userAId } }).promise(),
      dynamo.get({ TableName: USERS_TABLE, Key: { userId: userBId } }).promise(),
    ]);

    if (!fromUser.Item) return res.status(404).json({ error: 'Voucher profile not found' });
    if (!userA.Item) return res.status(404).json({ error: 'User A not found' });
    if (!userB.Item) return res.status(404).json({ error: 'User B not found' });

    // Check vouch doesn't already exist
    const existingVouches = await dynamo.query({
      TableName: VOUCHES_TABLE,
      IndexName: 'fromUserId-index',
      KeyConditionExpression: 'fromUserId = :fromUserId',
      FilterExpression: 'userAId = :userAId AND userBId = :userBId AND #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':fromUserId': fromUserId,
        ':userAId': userAId,
        ':userBId': userBId,
        ':status': 'PENDING',
      },
    }).promise();

    if (existingVouches.Items && existingVouches.Items.length > 0) {
      return res.status(409).json({ error: 'You already have a pending vouch for these two people' });
    }

    // Create vouch record
    const vouchId = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + VOUCH_EXPIRY_HOURS * 60 * 60 * 1000);

    const vouch = {
      vouchId,
      fromUserId,
      fromDisplayName: fromUser.Item.displayName,
      userAId,
      userADisplayName: userA.Item.displayName,
      userBId,
      userBDisplayName: userB.Item.displayName,
      vouchNote: vouchNote.trim(),
      status: 'PENDING',
      userAResponse: null,
      userBResponse: null,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    await dynamo.put({ TableName: VOUCHES_TABLE, Item: vouch }).promise();

    // Write VOUCHED_FOR edge in Neptune
    try {
      const g = getGraphClient();
      await g.V().has('User', 'userId', userAId)
        .coalesce(
          __.outE('VOUCHED_FOR')
            .where(__.inV().has('User', 'userId', userBId))
            .where(__.has('vouchId', vouchId)),
          __.addE('VOUCHED_FOR')
            .to(__.V().has('User', 'userId', userBId))
            .property('vouchId', vouchId)
            .property('fromUserId', fromUserId)
            .property('status', 'PENDING')
            .property('createdAt', now.toISOString())
        )
        .next();
    } catch (graphErr) {
      console.error('Neptune vouch edge error:', graphErr.message);
      // Don't fail the request if Neptune write fails
    }

    res.status(201).json({
      message: 'Vouch sent successfully',
      vouchId,
      status: 'PENDING',
      expiresAt: expiresAt.toISOString(),
      introducing: {
        userA: { userId: userAId, displayName: userA.Item.displayName },
        userB: { userId: userBId, displayName: userB.Item.displayName },
      },
    });

  } catch (err) {
    next(err);
  }
});

// ── POST /vouch/:vouchId/respond ─────────────────────────
// Body: { response: 'ACCEPT' | 'DECLINE' }
router.post('/:vouchId/respond', verifyToken, async (req, res, next) => {
  const { vouchId } = req.params;
  const { response } = req.body;
  const userId = req.userId;

  if (!['ACCEPT', 'DECLINE'].includes(response)) {
    return res.status(400).json({ error: 'Response must be ACCEPT or DECLINE' });
  }

  try {
    const result = await dynamo.get({
      TableName: VOUCHES_TABLE,
      Key: { vouchId },
    }).promise();

    if (!result.Item) {
      return res.status(404).json({ error: 'Vouch not found' });
    }

    const vouch = result.Item;

    // Check vouch hasn't expired
    if (new Date() > new Date(vouch.expiresAt)) {
      await dynamo.update({
        TableName: VOUCHES_TABLE,
        Key: { vouchId },
        UpdateExpression: 'SET #status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': 'EXPIRED' },
      }).promise();
      return res.status(410).json({ error: 'Vouch has expired' });
    }

    // Check user is part of this vouch
    const isUserA = vouch.userAId === userId;
    const isUserB = vouch.userBId === userId;

    if (!isUserA && !isUserB) {
      return res.status(403).json({ error: 'You are not part of this vouch' });
    }

    // Update response
    const responseField = isUserA ? 'userAResponse' : 'userBResponse';
    await dynamo.update({
      TableName: VOUCHES_TABLE,
      Key: { vouchId },
      UpdateExpression: `SET ${responseField} = :response`,
      ExpressionAttributeValues: { ':response': response },
    }).promise();

    // Re-fetch to check both responses
    const updated = await dynamo.get({
      TableName: VOUCHES_TABLE,
      Key: { vouchId },
    }).promise();

    const updatedVouch = updated.Item;
    const aResponse = isUserA ? response : updatedVouch.userAResponse;
    const bResponse = isUserB ? response : updatedVouch.userBResponse;

    // If either declined — mark as DECLINED silently
    if (aResponse === 'DECLINE' || bResponse === 'DECLINE') {
      await dynamo.update({
        TableName: VOUCHES_TABLE,
        Key: { vouchId },
        UpdateExpression: 'SET #status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': 'DECLINED' },
      }).promise();

      // Silent decline — don't reveal who declined
      return res.status(200).json({
        message: 'Response recorded',
        status: 'PENDING', // intentionally not revealing decline
        connected: false,
      });
    }

    // If both accepted — create connection!
    if (aResponse === 'ACCEPT' && bResponse === 'ACCEPT') {
      await dynamo.update({
        TableName: VOUCHES_TABLE,
        Key: { vouchId },
        UpdateExpression: 'SET #status = :status, connectedAt = :connectedAt',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'ACCEPTED',
          ':connectedAt': new Date().toISOString(),
        },
      }).promise();

      // Write CONNECTED_TO edge in Neptune
      try {
        const g = getGraphClient();

        // Bidirectional connection
        await g.V().has('User', 'userId', vouch.userAId)
          .coalesce(
            __.outE('CONNECTED_TO').where(__.inV().has('User', 'userId', vouch.userBId)),
            __.addE('CONNECTED_TO')
              .to(__.V().has('User', 'userId', vouch.userBId))
              .property('vouchedBy', vouch.fromUserId)
              .property('connectedAt', new Date().toISOString())
          )
          .next();

        await g.V().has('User', 'userId', vouch.userBId)
          .coalesce(
            __.outE('CONNECTED_TO').where(__.inV().has('User', 'userId', vouch.userAId)),
            __.addE('CONNECTED_TO')
              .to(__.V().has('User', 'userId', vouch.userAId))
              .property('vouchedBy', vouch.fromUserId)
              .property('connectedAt', new Date().toISOString())
          )
          .next();

        // Update VOUCHED_FOR edge status
        await g.E()
          .has('VOUCHED_FOR', 'vouchId', vouchId)
          .property('status', 'ACCEPTED')
          .next();

        // Increment connectorScore for the voucher
        await g.V().has('User', 'userId', vouch.fromUserId)
          .property('connectorScore',
            __.coalesce(
              __.values('connectorScore').math('_ + 1'),
              __.constant(1)
            )
          )
          .next();

      } catch (graphErr) {
        console.error('Neptune connection edge error:', graphErr.message);
      }

      // Increment connectorScore in DynamoDB too
      await dynamo.update({
        TableName: USERS_TABLE,
        Key: { userId: vouch.fromUserId },
        UpdateExpression: 'SET connectorScore = if_not_exists(connectorScore, :zero) + :inc',
        ExpressionAttributeValues: { ':zero': 0, ':inc': 1 },
      }).promise();

      return res.status(200).json({
        message: 'Both accepted — you are now connected!',
        status: 'ACCEPTED',
        connected: true,
        connectedAt: new Date().toISOString(),
        connection: {
          userA: { userId: vouch.userAId, displayName: vouch.userADisplayName },
          userB: { userId: vouch.userBId, displayName: vouch.userBDisplayName },
          vouchedBy: { userId: vouch.fromUserId, displayName: vouch.fromDisplayName },
        },
      });
    }

    // One has responded, waiting for the other
    return res.status(200).json({
      message: 'Response recorded, waiting for the other person',
      status: 'PENDING',
      connected: false,
    });

  } catch (err) {
    next(err);
  }
});

// ── GET /vouch/:userId/pending ───────────────────────────
router.get('/:userId/pending', verifyToken, async (req, res, next) => {
  const { userId } = req.params;

  try {
    // Get vouches sent by this user
    const sent = await dynamo.query({
      TableName: VOUCHES_TABLE,
      IndexName: 'fromUserId-index',
      KeyConditionExpression: 'fromUserId = :fromUserId',
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':fromUserId': userId,
        ':status': 'PENDING',
      },
    }).promise();

    // Get vouches received by this user (scan — acceptable at MVP scale)
    const received = await dynamo.scan({
      TableName: VOUCHES_TABLE,
      FilterExpression: '(userAId = :userId OR userBId = :userId) AND #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':userId': userId,
        ':status': 'PENDING',
      },
    }).promise();

    res.status(200).json({
      sent: sent.Items || [],
      received: received.Items || [],
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
