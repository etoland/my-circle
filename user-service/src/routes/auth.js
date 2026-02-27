const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const AWS = require('aws-sdk');
const crypto = require('crypto');

// Cognito Identity Service Provider
const cognito = new AWS.CognitoIdentityServiceProvider({
  region: process.env.AWS_REGION || 'eu-north-1',
});

const CLIENT_ID = process.env.COGNITO_CLIENT_ID;
const CLIENT_SECRET = process.env.COGNITO_CLIENT_SECRET;

// Cognito requires a SECRET_HASH when the app client has a secret configured
// It's an HMAC of the username + clientId, signed with the client secret
function computeSecretHash(username) {
  return crypto
    .createHmac('sha256', CLIENT_SECRET)
    .update(username + CLIENT_ID)
    .digest('base64');
}

// ── POST /auth/register ─────────────────────────────────
router.post(
  '/register',
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
    body('displayName')
      .notEmpty()
      .withMessage('Display name required'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, displayName } = req.body;

    try {
      const params = {
        ClientId: CLIENT_ID,
        Username: email,
        Password: password,
        SecretHash: computeSecretHash(email),
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'name', Value: displayName },
        ],
      };

      const result = await cognito.signUp(params).promise();

      res.status(201).json({
        message: 'Registration successful. Check your email to verify your account.',
        userId: result.UserSub,
        userConfirmed: result.UserConfirmed,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /auth/verify ───────────────────────────────────
router.post(
  '/verify',
  [
    body('email').isEmail(),
    body('code').notEmpty().withMessage('Verification code required'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, code } = req.body;

    try {
      await cognito
        .confirmSignUp({
          ClientId: CLIENT_ID,
          Username: email,
          ConfirmationCode: code,
          SecretHash: computeSecretHash(email),
        })
        .promise();

      res.status(200).json({ message: 'Account verified. You can now log in.' });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /auth/login ────────────────────────────────────
router.post(
  '/login',
  [
    body('email').isEmail(),
    body('password').notEmpty(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      const params = {
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: CLIENT_ID,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password,
          SECRET_HASH: computeSecretHash(email),
        },
      };

      const result = await cognito.initiateAuth(params).promise();
      const tokens = result.AuthenticationResult;

      res.status(200).json({
        message: 'Login successful',
        idToken: tokens.IdToken,
        accessToken: tokens.AccessToken,
        refreshToken: tokens.RefreshToken,
        expiresIn: tokens.ExpiresIn,
      });
    } catch (err) {
      if (err.code === 'NotAuthorizedException') {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      next(err);
    }
  }
);

module.exports = router;