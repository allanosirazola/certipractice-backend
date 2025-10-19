const fs = require('fs').promises;
const path = require('path');

// Setup test environment
beforeAll(async () => {
  // Ensure test data directories exist
  await fs.mkdir(path.join(__dirname, '../../data/users'), { recursive: true });
  await fs.mkdir(path.join(__dirname, '../../data/questions'), { recursive: true });
  await fs.mkdir(path.join(__dirname, '../../data/exams'), { recursive: true });
  
  // Clear test data files
  await fs.writeFile(path.join(__dirname, '../../data/users/users.json'), '[]');
  await fs.writeFile(path.join(__dirname, '../../data/questions/questions.json'), '[]');
  await fs.writeFile(path.join(__dirname, '../../data/exams/exams.json'), '[]');
});

afterAll(async () => {
  // Cleanup test data
  await fs.writeFile(path.join(__dirname, '../../data/users/users.json'), '[]');
  await fs.writeFile(path.join(__dirname, '../../data/questions/questions.json'), '[]');
  await fs.writeFile(path.join(__dirname, '../../data/exams/exams.json'), '[]');
});
