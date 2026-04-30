# CertiPractice Backend

🎓 **Backend API for certification exam practice platform**

A robust Node.js/Express backend with PostgreSQL database, Prisma ORM, and comprehensive test coverage.

## 🚀 Features

- 🔐 **Authentication**: JWT-based auth with refresh tokens
- 📝 **Exams**: Create, take, and review practice exams
- ❓ **Questions**: CRUD operations with support for multiple question types
- 📊 **Statistics**: Track user progress and exam analytics
- 🔄 **Session Support**: Anonymous exam sessions with session persistence
- 💾 **Caching**: In-memory caching for improved performance
- 📋 **Validation**: Centralized request validation with Joi
- 🛡️ **Security**: Helmet, CORS, rate limiting, input sanitization

## 🛠️ Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Authentication**: JWT (jsonwebtoken)
- **Validation**: Joi
- **Testing**: Jest + Supertest
- **Logging**: Winston
- **Caching**: node-cache

## 📋 Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/allanosirazola/certipractice-backend.git
cd certipractice-backend

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your database credentials

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Seed database (optional)
npm run db:seed

# Start development server
npm run dev
```

### Environment Variables

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/certification_db"

# Server
PORT=3000
NODE_ENV=development

# JWT
JWT_SECRET=your-super-secret-key-min-32-chars
JWT_EXPIRE=7d

# Features
USE_PRISMA=true  # Enable Prisma-based services
```

## 📚 API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login user |
| POST | `/api/auth/logout` | Logout user |
| POST | `/api/auth/refresh` | Refresh token |
| GET | `/api/auth/me` | Get current user |

### Exams
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/exams` | Create new exam |
| GET | `/api/exams` | List user's exams |
| GET | `/api/exams/:id` | Get exam details |
| POST | `/api/exams/:id/start` | Start exam |
| POST | `/api/exams/:id/answer` | Submit answer |
| POST | `/api/exams/:id/complete` | Complete exam |
| POST | `/api/exams/:id/pause` | Pause exam |
| POST | `/api/exams/:id/resume` | Resume exam |
| GET | `/api/exams/:id/results` | Get exam results |
| DELETE | `/api/exams/:id` | Delete exam |

### Questions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/questions` | List questions |
| GET | `/api/questions/:id` | Get question |
| POST | `/api/questions` | Create question (instructor+) |
| PUT | `/api/questions/:id` | Update question (instructor+) |
| DELETE | `/api/questions/:id` | Delete question (admin) |
| GET | `/api/questions/random` | Get random questions |
| GET | `/api/questions/categories` | Get categories |
| GET | `/api/questions/providers` | Get providers |

### Health Checks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Basic health check |
| GET | `/health/detailed` | Detailed system info |
| GET | `/health/ready` | Readiness probe (K8s) |
| GET | `/health/live` | Liveness probe (K8s) |

## 🏗️ Project Structure

```
src/
├── config/           # Configuration files
├── controllers/      # Route controllers
├── lib/              # External libraries setup
│   └── prisma.js     # Prisma client singleton
├── middleware/       # Express middleware
│   ├── auth.js       # Authentication middleware
│   ├── errorHandler.js
│   ├── rateLimit.js
│   └── validation.js
├── models/           # Business logic models
│   ├── User.js
│   ├── Exam.js
│   └── Question.js
├── repositories/     # Data access layer (Prisma)
│   ├── userRepository.js
│   ├── questionRepository.js
│   └── examRepository.js
├── routes/           # Express routes
├── services/         # Business logic services
│   ├── examService.js
│   ├── examServicePrisma.js
│   └── index.js
├── utils/            # Utility functions
│   ├── cache.js      # Caching service
│   ├── errors.js     # Custom error classes
│   ├── logger.js     # Winston logger
│   └── validators.js # Joi schemas
├── app.js            # Express app setup
└── server.js         # Server entry point

prisma/
├── schema.prisma     # Database schema
└── migrations/       # Database migrations

tests/
├── unit/             # Unit tests
├── integration/      # Integration tests
├── fixtures/         # Test data
└── mocks/            # Mock implementations
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration

# Watch mode
npm run test:watch

# Coverage report
npm test -- --coverage
```

## 🗄️ Database

### Prisma Commands

```bash
# Generate client
npx prisma generate

# Create migration
npx prisma migrate dev --name migration_name

# Apply migrations (production)
npx prisma migrate deploy

# Open Prisma Studio
npx prisma studio

# Reset database
npx prisma migrate reset
```

### Schema Models

- **User**: User accounts with roles (admin, instructor, student)
- **Provider**: Certification providers (AWS, Azure, etc.)
- **Certification**: Exam certifications
- **Topic**: Question topics/categories
- **Question**: Exam questions with options
- **Exam**: User exam sessions
- **ExamAnswer**: User answers to questions

## 🐳 Deployment

### Docker

```bash
# Build image
docker build -t certipractice-backend .

# Run container
docker run -p 3000:3000 --env-file .env certipractice-backend
```

### Docker Compose

```bash
docker-compose up -d
```

## 🔐 Security

- **JWT Authentication** with configurable expiration
- **Bcrypt** password hashing
- **Helmet** security headers
- **Rate limiting** to prevent abuse
- **CORS** configured
- **Input validation** with Joi
- **SQL injection prevention** with Prisma

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

Made with ❤️ by the CertiPractice Team
