# speech-service

Consumes messages from SQS, runs them through Amazon Comprehend, and builds
a communication fingerprint per user stored in DynamoDB + Neptune.

## Phase 3 — not yet implemented

### Pipeline

```
SQS Queue (new messages)
    ↓
Lambda trigger
    ↓
Amazon Comprehend
  - Key phrase extraction
  - Sentiment analysis
  - Entity recognition
    ↓
DynamoDB (update user fingerprint)
    ↓
Neptune (update USES_PHRASE edges with frequency weights)
```

### Fingerprint schema (DynamoDB)

```json
{
  "userId": "uuid",
  "topPhrases": ["no cap", "to be fair", "honestly"],
  "sentimentProfile": {
    "positive": 0.72,
    "neutral": 0.21,
    "negative": 0.07
  },
  "messageCount": 142,
  "lastUpdated": "ISO8601"
}
```
