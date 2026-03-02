const express = require("express");
const router = express.Router();
const AWS = require("aws-sdk");
const { getGraphClient } = require("../graph/connection");
const { process: gprocess } = require("gremlin");
const __ = gprocess.statics;

const dynamo = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || "eu-north-1",
});

const TABLE = process.env.DYNAMO_USERS_TABLE || "my-circle-users";
const MATCH_LIMIT = parseInt(process.env.MATCH_LIMIT || "10");

function verifyToken(req, res, next) {
  const jwt = require("jsonwebtoken");
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.decode(token);
    if (!decoded) return res.status(401).json({ error: "Invalid token" });
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < now)
      return res.status(401).json({ error: "Token expired" });
    req.userId = decoded.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token invalid" });
  }
}

// ── Weighted match score ─────────────────────────────────
// Scoring breakdown:
//   Specific match    (e.g. Smashing Pumpkins)  → weight 3 per match
//   Subcategory match (e.g. Alternative Rock)   → weight 2 per match
//   Category match    (e.g. Music)              → weight 1 per match
//   Same school                                 → +5 bonus
//   Same city                                   → +8 bonus
//   Same country (different city)               → +3 bonus
// Normalised to 0-99

async function computeWeightedScore(g, userAId, userBId) {
  try {
    // Category level matches (weight 1)
    const categoryMatches = await g
      .V()
      .has("User", "userId", userAId)
      .outE("LIKES")
      .has("weight", gprocess.P.eq(1))
      .inV()
      .hasLabel("Category")
      .as("shared")
      .inE("LIKES")
      .has("weight", gprocess.P.eq(1))
      .outV()
      .has("User", "userId", userBId)
      .select("shared")
      .count()
      .next();

    // Subcategory level matches (weight 2)
    const subcategoryMatches = await g
      .V()
      .has("User", "userId", userAId)
      .outE("LIKES")
      .has("weight", gprocess.P.eq(2))
      .inV()
      .hasLabel("Subcategory")
      .as("shared")
      .inE("LIKES")
      .has("weight", gprocess.P.eq(2))
      .outV()
      .has("User", "userId", userBId)
      .select("shared")
      .count()
      .next();

    // Specific level matches (weight 3)
    const specificMatches = await g
      .V()
      .has("User", "userId", userAId)
      .outE("LIKES")
      .has("weight", gprocess.P.eq(3))
      .inV()
      .hasLabel("Specific")
      .as("shared")
      .inE("LIKES")
      .has("weight", gprocess.P.eq(3))
      .outV()
      .has("User", "userId", userBId)
      .select("shared")
      .count()
      .next();

    // School bonus
    const schoolMatch = await g
      .V()
      .has("User", "userId", userAId)
      .out("ATTENDED")
      .hasLabel("School")
      .as("school")
      .in_("ATTENDED")
      .has("User", "userId", userBId)
      .select("school")
      .count()
      .next();

    // Location bonus — get both users' city and country
    let locationBonus = 0;
    try {
      const userAProps = await g
        .V()
        .has("User", "userId", userAId)
        .valueMap("city", "country")
        .next();

      const userBProps = await g
        .V()
        .has("User", "userId", userBId)
        .valueMap("city", "country")
        .next();

      if (userAProps.value && userBProps.value) {
        const cityA = (
          userAProps.value instanceof Map
            ? userAProps.value.get("city")
            : userAProps.value.city
        )?.[0]?.toLowerCase();

        const cityB = (
          userBProps.value instanceof Map
            ? userBProps.value.get("city")
            : userBProps.value.city
        )?.[0]?.toLowerCase();

        const countryA = (
          userAProps.value instanceof Map
            ? userAProps.value.get("country")
            : userAProps.value.country
        )?.[0]?.toLowerCase();

        const countryB = (
          userBProps.value instanceof Map
            ? userBProps.value.get("country")
            : userBProps.value.country
        )?.[0]?.toLowerCase();

        if (cityA && cityB && cityA === cityB) {
          locationBonus = 8; // same city — strongest signal
        } else if (countryA && countryB && countryA === countryB) {
          locationBonus = 3; // same country, different city
        }
      }
    } catch (locErr) {
      console.error("Location scoring error:", locErr.message);
    }

    const categoryScore = (categoryMatches.value || 0) * 1;
    const subcategoryScore = (subcategoryMatches.value || 0) * 2;
    const specificScore = (specificMatches.value || 0) * 3;
    const schoolBonus = (schoolMatch.value || 0) > 0 ? 5 : 0;

    const rawScore =
      categoryScore +
      subcategoryScore +
      specificScore +
      schoolBonus +
      locationBonus;

    // Normalise — ~25 raw points = 99%
    const normalised = Math.min(Math.round((rawScore / 25) * 99), 99);

    // Floor at 30 if any match exists
    return rawScore > 0 ? Math.max(normalised, 30) : 0;
  } catch (err) {
    console.error("Score computation error:", err.message);
    return 0;
  }
}

// ── GET /matches/:userId ─────────────────────────────────
router.get("/:userId", verifyToken, async (req, res, next) => {
  const { userId } = req.params;

  try {
    const g = getGraphClient();

    // Find candidate users sharing ANY interest at ANY level
    const candidateResults = await g
      .V()
      .has("User", "userId", userId)
      .out("LIKES")
      .in_("LIKES")
      .hasLabel("User")
      .where(__.not(__.has("userId", userId)))
      .dedup()
      .limit(MATCH_LIMIT * 3)
      .valueMap("userId")
      .toList();

    if (!candidateResults || candidateResults.length === 0) {
      return res.status(200).json({ matches: [] });
    }

    // Extract userIds
    const candidateUserIds = candidateResults
      .map((r) => {
        if (r instanceof Map) return r.get("userId")[0];
        return r.userId?.[0] || r.userId;
      })
      .filter(Boolean);

    // Score and enrich each candidate
    const scoredMatches = await Promise.all(
      candidateUserIds.map(async (matchedUserId) => {
        try {
          const result = await dynamo
            .get({ TableName: TABLE, Key: { userId: matchedUserId } })
            .promise();

          if (!result.Item) return null;

          const profile = result.Item;

          const matchScore = await computeWeightedScore(
            g,
            userId,
            matchedUserId,
          );
          if (matchScore === 0) return null;

          return {
            userId: matchedUserId,
            displayName: profile.displayName,
            age: profile.age || null,
            location: profile.location || null,
            school: profile.school || null,
            bio: profile.bio || null,
            interests: profile.interests || [],
            vibe: profile.communicationFingerprint?.vibe || null,
            matchScore,
            voucher: null,
          };
        } catch (err) {
          console.error(`Error enriching match ${matchedUserId}:`, err.message);
          return null;
        }
      }),
    );

    const matches = scoredMatches
      .filter(Boolean)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, MATCH_LIMIT);

    res.status(200).json({ matches });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
