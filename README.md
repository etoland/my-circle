# My Circle 🌐

> A global friendship app that matches people based on how they communicate — not just what they're into.

## Architecture Overview

```
my-circle/
├── user-service/        # Auth, registration, profiles (ECS Fargate)
├── match-service/       # Graph traversal, similarity scoring (ECS Fargate)
├── chat-service/        # WebSocket chat, message persistence (ECS Fargate)
├── speech-service/      # Comprehend pipeline, phrase fingerprinting (ECS Fargate)
├── infrastructure/      # Terraform — Neptune, ECS, VPC, SQS, etc.
└── .github/workflows/   # CI/CD — build, push to ECR, deploy to ECS
```

## Tech Stack

| Layer | Technology |
|---|---|
| Auth | Amazon Cognito |
| Containers | Docker → ECS Fargate |
| Container Registry | Amazon ECR |
| Graph Database | Amazon Neptune |
| Document Store | DynamoDB |
| Cache | ElastiCache (Redis) |
| Chat | API Gateway WebSocket + Lambda |
| Speech Pipeline | SQS → Lambda → Amazon Comprehend |
| Storage | S3 |
| IaC | Terraform |
| CI/CD | GitHub Actions |
| Frontend | React Native (Expo) |

## Getting Started

### Prerequisites
- Node.js 20+
- Docker Desktop
- AWS CLI configured (`aws configure`)
- Terraform 1.6+

### Run user-service locally

```bash
cd user-service
cp .env.example .env        # fill in your Cognito values
npm install
npm run dev                 # runs on http://localhost:3001
```

### Run with Docker

```bash
cd user-service
docker build -t my-circle-user-service .
docker run -p 3001:3001 --env-file .env my-circle-user-service
```

## MVP Milestones

- [x] Monorepo structure
- [x] user-service scaffold + Dockerfile
- [ ] Cognito user pool setup
- [ ] user-service deployed to ECS Fargate
- [ ] Neptune cluster + basic graph model
- [ ] match-service — basic interest matching
- [ ] chat-service — WebSocket MVP
- [ ] speech-service — Comprehend pipeline
- [ ] React Native frontend
