/**
 * @fileoverview Test Fixtures - Sample data for testing
 */

const { v4: uuidv4 } = require('uuid');

/**
 * User fixtures
 */
const users = {
  admin: {
    id: 1,
    username: 'admin_user',
    email: 'admin@test.com',
    password_hash: '$2a$04$test.hash.for.admin.user',
    first_name: 'Admin',
    last_name: 'User',
    role: 'admin',
    is_active: true,
    is_validated: true,
    last_login: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },

  instructor: {
    id: 2,
    username: 'instructor_user',
    email: 'instructor@test.com',
    password_hash: '$2a$04$test.hash.for.instructor',
    first_name: 'Instructor',
    last_name: 'User',
    role: 'instructor',
    is_active: true,
    is_validated: true,
    last_login: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },

  student: {
    id: 3,
    username: 'student_user',
    email: 'student@test.com',
    password_hash: '$2a$04$test.hash.for.student',
    first_name: 'Student',
    last_name: 'User',
    role: 'student',
    is_active: true,
    is_validated: true,
    last_login: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },

  inactive: {
    id: 4,
    username: 'inactive_user',
    email: 'inactive@test.com',
    password_hash: '$2a$04$test.hash.for.inactive',
    first_name: 'Inactive',
    last_name: 'User',
    role: 'student',
    is_active: false,
    is_validated: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },

  unvalidated: {
    id: 5,
    username: 'unvalidated_user',
    email: 'unvalidated@test.com',
    password_hash: '$2a$04$test.hash.for.unvalidated',
    first_name: 'Unvalidated',
    last_name: 'User',
    role: 'student',
    is_active: true,
    is_validated: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
};

/**
 * Provider fixtures
 */
const providers = {
  aws: {
    id: 1,
    name: 'Amazon Web Services',
    code: 'AWS',
    description: 'AWS Cloud Certifications',
    is_active: true,
  },
  azure: {
    id: 2,
    name: 'Microsoft Azure',
    code: 'AZURE',
    description: 'Microsoft Azure Certifications',
    is_active: true,
  },
  gcp: {
    id: 3,
    name: 'Google Cloud Platform',
    code: 'GCP',
    description: 'GCP Certifications',
    is_active: true,
  },
};

/**
 * Certification fixtures
 */
const certifications = {
  awsSaa: {
    id: 1,
    provider_id: 1,
    name: 'Solutions Architect Associate',
    code: 'SAA-C03',
    description: 'AWS Solutions Architect Associate',
    duration_minutes: 130,
    passing_score: 72,
    total_questions: 65,
    is_active: true,
    provider_name: 'Amazon Web Services',
  },
  awsDev: {
    id: 2,
    provider_id: 1,
    name: 'Developer Associate',
    code: 'DVA-C02',
    description: 'AWS Developer Associate',
    duration_minutes: 130,
    passing_score: 72,
    total_questions: 65,
    is_active: true,
    provider_name: 'Amazon Web Services',
  },
  azureFund: {
    id: 3,
    provider_id: 2,
    name: 'Azure Fundamentals',
    code: 'AZ-900',
    description: 'Microsoft Azure Fundamentals',
    duration_minutes: 60,
    passing_score: 70,
    total_questions: 40,
    is_active: true,
    provider_name: 'Microsoft Azure',
  },
};

/**
 * Question fixtures
 */
const questions = {
  singleChoice: {
    id: 1,
    external_id: 'Q001',
    question_text: 'What is the maximum size of an S3 object?',
    explanation: 'The maximum size of a single object in S3 is 5 TB.',
    difficulty_level: 'medium',
    expected_answers_count: 1,
    points: 1.0,
    is_active: true,
    review_status: 'approved',
    topic_name: 'Storage',
    certification_name: 'Solutions Architect Associate',
    certification_code: 'SAA-C03',
    provider_name: 'Amazon Web Services',
    question_type: 'multiple_choice',
    question_type_display: 'Multiple Choice',
    options: [
      { label: 'A', text: '5 GB' },
      { label: 'B', text: '5 TB' },
      { label: 'C', text: '50 GB' },
      { label: 'D', text: 'Unlimited' },
    ],
    correct_answer_indices: [1], // 0-based: B
  },

  multipleChoice: {
    id: 2,
    external_id: 'Q002',
    question_text: 'Which AWS services can be used for caching? (Select TWO)',
    explanation: 'ElastiCache and CloudFront are both caching services.',
    difficulty_level: 'medium',
    expected_answers_count: 2,
    points: 2.0,
    is_active: true,
    review_status: 'approved',
    topic_name: 'Performance',
    certification_name: 'Solutions Architect Associate',
    certification_code: 'SAA-C03',
    provider_name: 'Amazon Web Services',
    question_type: 'multiple_answer',
    question_type_display: 'Multiple Answer',
    options: [
      { label: 'A', text: 'ElastiCache' },
      { label: 'B', text: 'RDS' },
      { label: 'C', text: 'CloudFront' },
      { label: 'D', text: 'SNS' },
    ],
    correct_answer_indices: [0, 2], // A and C
  },

  hardQuestion: {
    id: 3,
    external_id: 'Q003',
    question_text: 'You need to design a highly available architecture...',
    explanation: 'Multi-AZ deployment with Auto Scaling provides HA.',
    difficulty_level: 'hard',
    expected_answers_count: 1,
    points: 1.5,
    is_active: true,
    review_status: 'approved',
    topic_name: 'High Availability',
    certification_name: 'Solutions Architect Associate',
    certification_code: 'SAA-C03',
    provider_name: 'Amazon Web Services',
    question_type: 'multiple_choice',
    options: [
      { label: 'A', text: 'Single AZ with backup' },
      { label: 'B', text: 'Multi-AZ with Auto Scaling' },
      { label: 'C', text: 'Single instance with EBS' },
      { label: 'D', text: 'Lambda with reserved concurrency' },
    ],
    correct_answer_indices: [1],
  },

  pendingQuestion: {
    id: 4,
    external_id: 'Q004',
    question_text: 'Pending review question...',
    explanation: 'Explanation pending.',
    difficulty_level: 'easy',
    expected_answers_count: 1,
    points: 1.0,
    is_active: true,
    review_status: 'pending',
    topic_name: 'General',
    certification_name: 'Solutions Architect Associate',
    certification_code: 'SAA-C03',
    provider_name: 'Amazon Web Services',
    question_type: 'multiple_choice',
    options: [
      { label: 'A', text: 'Option A' },
      { label: 'B', text: 'Option B' },
    ],
    correct_answer_indices: [0],
  },
};

/**
 * Exam fixtures
 */
const exams = {
  pending: {
    id: uuidv4(),
    user_id: users.student.id,
    session_id: null,
    certification_id: certifications.awsSaa.id,
    exam_mode: 'practice',
    status: 'pending',
    total_questions: 10,
    time_limit_minutes: 20,
    time_spent_minutes: 0,
    percentage_score: null,
    passing_status: null,
    correct_answers: 0,
    incorrect_answers: 0,
    started_at: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },

  inProgress: {
    id: uuidv4(),
    user_id: users.student.id,
    session_id: null,
    certification_id: certifications.awsSaa.id,
    exam_mode: 'practice',
    status: 'active',
    total_questions: 10,
    time_limit_minutes: 20,
    time_spent_minutes: 5,
    percentage_score: null,
    passing_status: null,
    correct_answers: 0,
    incorrect_answers: 0,
    started_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },

  completed: {
    id: uuidv4(),
    user_id: users.student.id,
    session_id: null,
    certification_id: certifications.awsSaa.id,
    exam_mode: 'practice',
    status: 'completed',
    total_questions: 10,
    time_limit_minutes: 20,
    time_spent_minutes: 15,
    percentage_score: 80,
    passing_status: 'passed',
    correct_answers: 8,
    incorrect_answers: 2,
    started_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    completed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },

  anonymous: {
    id: uuidv4(),
    user_id: null,
    session_id: uuidv4(),
    certification_id: certifications.awsSaa.id,
    exam_mode: 'practice',
    status: 'pending',
    total_questions: 10,
    time_limit_minutes: 20,
    created_at: new Date().toISOString(),
  },

  expired: {
    id: uuidv4(),
    user_id: users.student.id,
    session_id: null,
    certification_id: certifications.awsSaa.id,
    exam_mode: 'exam',
    status: 'active',
    total_questions: 10,
    time_limit_minutes: 20,
    started_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // Started 30 min ago
    created_at: new Date().toISOString(),
  },
};

/**
 * JWT Token fixtures
 */
const tokens = {
  admin: {
    id: users.admin.id,
    email: users.admin.email,
    role: users.admin.role,
  },
  instructor: {
    id: users.instructor.id,
    email: users.instructor.email,
    role: users.instructor.role,
  },
  student: {
    id: users.student.id,
    email: users.student.email,
    role: users.student.role,
  },
};

/**
 * Request body fixtures
 */
const requestBodies = {
  validRegistration: {
    username: 'newuser',
    email: 'newuser@test.com',
    password: 'SecurePass123!',
    firstName: 'New',
    lastName: 'User',
  },

  validLogin: {
    email: 'student@test.com',
    password: 'password123',
  },

  validExamConfig: {
    provider: 1,
    certification: 1,
    mode: 'practice',
    questionCount: 10,
    timeLimit: 20,
    settings: {
      randomizeQuestions: true,
      randomizeAnswers: false,
    },
  },

  validQuestion: {
    text: 'What is the capital of France?',
    options: [
      { label: 'A', text: 'London' },
      { label: 'B', text: 'Paris' },
      { label: 'C', text: 'Berlin' },
      { label: 'D', text: 'Madrid' },
    ],
    correctAnswers: [1],
    category: 'Geography',
    provider: 'General',
    explanation: 'Paris is the capital of France.',
  },

  invalidExamConfig: {
    provider: null,
    certification: null,
    mode: 'invalid_mode',
    questionCount: 1000,
  },
};

/**
 * Generate a random user
 */
const generateUser = (overrides = {}) => ({
  id: Math.floor(Math.random() * 10000),
  username: `user_${Math.random().toString(36).substring(7)}`,
  email: `${Math.random().toString(36).substring(7)}@test.com`,
  password_hash: '$2a$04$random.hash.here',
  first_name: 'Test',
  last_name: 'User',
  role: 'student',
  is_active: true,
  is_validated: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

/**
 * Generate a random question
 */
const generateQuestion = (overrides = {}) => ({
  id: Math.floor(Math.random() * 10000),
  external_id: `Q${Math.random().toString(36).substring(7)}`,
  question_text: `Test question ${Math.random()}?`,
  explanation: 'Test explanation',
  difficulty_level: 'medium',
  expected_answers_count: 1,
  points: 1.0,
  is_active: true,
  review_status: 'approved',
  topic_name: 'Test Topic',
  certification_name: 'Test Certification',
  provider_name: 'Test Provider',
  question_type: 'multiple_choice',
  options: [
    { label: 'A', text: 'Option A' },
    { label: 'B', text: 'Option B' },
    { label: 'C', text: 'Option C' },
    { label: 'D', text: 'Option D' },
  ],
  correct_answer_indices: [0],
  ...overrides,
});

/**
 * Generate multiple questions
 */
const generateQuestions = (count, overrides = {}) => {
  return Array.from({ length: count }, (_, i) =>
    generateQuestion({ id: i + 1, ...overrides })
  );
};

module.exports = {
  users,
  providers,
  certifications,
  questions,
  exams,
  tokens,
  requestBodies,
  generateUser,
  generateQuestion,
  generateQuestions,
};
