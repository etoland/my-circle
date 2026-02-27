# chat-service

Handles real-time WebSocket chat via API Gateway + Lambda, with messages persisted to DynamoDB.

## Phase 2 — not yet implemented

### Architecture

```
Client → API Gateway (WebSocket) → Lambda (connect/disconnect/message)
                                        ↓
                                   DynamoDB (messages table)
                                        ↓
                                   SQS → speech-service pipeline
```

### DynamoDB message schema

```json
{
  "conversationId": "user1#user2",
  "timestamp": "ISO8601",
  "senderId": "userId",
  "content": "message text",
  "analyzed": false
}
```
