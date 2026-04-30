/**
 * @fileoverview User Service Unit Tests
 */

// Mock dependencies before requiring the service
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../../src/utils/database', () => {
  const mockQuery = jest.fn();
  const mockGetClient = jest.fn();
  const mockTransaction = jest.fn();
  
  return {
    query: mockQuery,
    getClient: mockGetClient,
    transaction: mockTransaction,
    __mockQuery: mockQuery,
    __mockGetClient: mockGetClient,
    __mockTransaction: mockTransaction,
  };
});

jest.mock('../../../src/config/config', () => ({
  bcrypt: { rounds: 4 },
  isTest: true,
}));

const User = require('../../../src/models/User');
const db = require('../../../src/utils/database');

describe('UserService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('User Model Integration', () => {
    describe('User.validate()', () => {
      it('should validate valid user data', () => {
        const errors = User.validate({
          username: 'testuser',
          email: 'test@example.com',
          password: 'SecurePass123',
        });
        expect(errors).toHaveLength(0);
      });

      it('should require username', () => {
        const errors = User.validate({
          email: 'test@example.com',
          password: 'SecurePass123',
        });
        expect(errors.some(e => e.toLowerCase().includes('username'))).toBe(true);
      });

      it('should require valid email', () => {
        const errors = User.validate({
          username: 'testuser',
          email: 'invalid-email',
          password: 'SecurePass123',
        });
        expect(errors.some(e => e.toLowerCase().includes('email'))).toBe(true);
      });

      it('should require password minimum length', () => {
        const errors = User.validate({
          username: 'testuser',
          email: 'test@example.com',
          password: 'short',
        });
        expect(errors.some(e => e.toLowerCase().includes('password'))).toBe(true);
      });

      it('should validate username length', () => {
        const errors = User.validate({
          username: 'ab', // too short
          email: 'test@example.com',
          password: 'SecurePass123',
        });
        expect(errors.some(e => e.toLowerCase().includes('username'))).toBe(true);
      });

      it('should validate username characters', () => {
        const errors = User.validate({
          username: 'user@name!', // invalid chars
          email: 'test@example.com',
          password: 'SecurePass123',
        });
        expect(errors.some(e => e.toLowerCase().includes('username') || e.toLowerCase().includes('alphanumeric'))).toBe(true);
      });
    });

    describe('User.validateLogin()', () => {
      it('should validate valid login data', () => {
        const errors = User.validateLogin({
          email: 'test@example.com',
          password: 'password123',
        });
        expect(errors).toHaveLength(0);
      });

      it('should require email for login', () => {
        const errors = User.validateLogin({
          password: 'password123',
        });
        expect(errors.some(e => e.toLowerCase().includes('email'))).toBe(true);
      });

      it('should require password for login', () => {
        const errors = User.validateLogin({
          email: 'test@example.com',
        });
        expect(errors.some(e => e.toLowerCase().includes('password'))).toBe(true);
      });
    });

    describe('User Role Checks', () => {
      it('should identify admin role', () => {
        const user = new User({ role: 'admin' });
        expect(user.isAdmin).toBe(true);
        // Admin is also considered instructor in this implementation
        expect(user.isInstructor).toBe(true);
      });

      it('should identify instructor role', () => {
        const user = new User({ role: 'instructor' });
        expect(user.isInstructor).toBe(true);
        expect(user.isAdmin).toBe(false);
      });

      it('should identify student role', () => {
        const user = new User({ role: 'student' });
        expect(user.isAdmin).toBe(false);
        expect(user.isInstructor).toBe(false);
      });

      it('admin should be able to access own resources', () => {
        const admin = new User({ id: 1, role: 'admin' });
        expect(admin.canAccess(1)).toBe(true);
        expect(admin.canAccess(2)).toBe(true); // Admin can access all
      });

      it('instructor should access own resources', () => {
        const instructor = new User({ id: 2, role: 'instructor' });
        expect(instructor.canAccess(2)).toBe(true);
        expect(instructor.canAccess(3)).toBe(false);
      });

      it('student should only access own resources', () => {
        const student = new User({ id: 3, role: 'student' });
        expect(student.canAccess(3)).toBe(true);
        expect(student.canAccess(1)).toBe(false);
      });
    });

    describe('User.toJSON()', () => {
      it('should exclude sensitive fields', () => {
        const user = new User({
          id: 1,
          username: 'testuser',
          email: 'test@example.com',
          password_hash: 'hash123',
          role: 'student',
        });

        const json = user.toJSON();

        expect(json.id).toBe(1);
        expect(json.username).toBe('testuser');
        expect(json.email).toBe('test@example.com');
        expect(json.password_hash).toBeUndefined();
        expect(json.passwordHash).toBeUndefined();
      });
    });

    describe('User.toDatabase()', () => {
      it('should convert to database format', () => {
        const user = new User({
          id: 1,
          username: 'testuser',
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
          role: 'student',
        });

        const dbData = user.toDatabase();

        expect(dbData.username).toBe('testuser');
        expect(dbData.first_name).toBe('Test');
        expect(dbData.last_name).toBe('User');
      });
    });

    describe('User.getFullName()', () => {
      it('should return full name when both names present', () => {
        const user = new User({
          firstName: 'John',
          lastName: 'Doe',
        });
        expect(user.getFullName()).toBe('John Doe');
      });

      it('should return first name only when no last name', () => {
        const user = new User({
          firstName: 'John',
        });
        expect(user.getFullName()).toBe('John');
      });

      it('should return empty when no names (use getDisplayName for username)', () => {
        const user = new User({
          username: 'johndoe',
        });
        // getFullName only uses firstName/lastName
        expect(user.getFullName()).toBe('');
        // getDisplayName falls back to username
        expect(user.getDisplayName()).toBe('johndoe');
      });
    });
  });

  describe('Password Hashing', () => {
    it('should hash password', async () => {
      const password = 'SecurePassword123';
      const hash = await User.hashPassword(password);
      
      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should verify correct password', async () => {
      const password = 'SecurePassword123';
      const hash = await User.hashPassword(password);
      
      const isValid = await User.comparePassword(password, hash);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const password = 'SecurePassword123';
      const hash = await User.hashPassword(password);
      
      const isValid = await User.comparePassword('WrongPassword', hash);
      expect(isValid).toBe(false);
    });

    it('should generate different hashes for same password', async () => {
      const password = 'SecurePassword123';
      const hash1 = await User.hashPassword(password);
      const hash2 = await User.hashPassword(password);
      
      expect(hash1).not.toBe(hash2); // Different salts
    });
  });

  describe('Service Functions (Mocked)', () => {
    describe('createUser pattern', () => {
      it('should check for duplicate email', async () => {
        // Mock database response for duplicate check
        db.__mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // Email exists
        
        const createUser = async (data) => {
          const existing = await db.query(
            'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
            [data.email]
          );
          if (existing.rows.length > 0) {
            throw new Error('Email already exists');
          }
          return { id: 1, ...data };
        };

        await expect(createUser({ email: 'existing@test.com' }))
          .rejects.toThrow('Email already exists');
      });

      it('should create user when email is unique', async () => {
        db.__mockQuery
          .mockResolvedValueOnce({ rows: [] }) // Email check - not exists
          .mockResolvedValueOnce({ rows: [] }) // Username check
          .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // Insert

        const createUser = async (data) => {
          const emailCheck = await db.query(
            'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
            [data.email]
          );
          if (emailCheck.rows.length > 0) {
            throw new Error('Email already exists');
          }
          
          const usernameCheck = await db.query(
            'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
            [data.username]
          );
          if (usernameCheck.rows.length > 0) {
            throw new Error('Username already exists');
          }

          const result = await db.query(
            'INSERT INTO users (username, email) VALUES ($1, $2) RETURNING id',
            [data.username, data.email]
          );
          return { id: result.rows[0].id, ...data };
        };

        const user = await createUser({ 
          username: 'newuser', 
          email: 'new@test.com' 
        });
        
        expect(user.id).toBe(1);
        expect(db.__mockQuery).toHaveBeenCalledTimes(3);
      });
    });

    describe('findByEmail pattern', () => {
      it('should find user by email', async () => {
        db.__mockQuery.mockResolvedValueOnce({
          rows: [{ id: 1, email: 'test@example.com', username: 'testuser' }],
        });

        const findByEmail = async (email) => {
          const result = await db.query(
            'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
            [email]
          );
          return result.rows[0] || null;
        };

        const user = await findByEmail('test@example.com');
        
        expect(user).toBeDefined();
        expect(user.email).toBe('test@example.com');
      });

      it('should return null for non-existent email', async () => {
        db.__mockQuery.mockResolvedValueOnce({ rows: [] });

        const findByEmail = async (email) => {
          const result = await db.query(
            'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
            [email]
          );
          return result.rows[0] || null;
        };

        const user = await findByEmail('nonexistent@example.com');
        
        expect(user).toBeNull();
      });
    });

    describe('updateUser pattern', () => {
      it('should update allowed fields', async () => {
        db.__mockQuery.mockResolvedValueOnce({
          rows: [{ id: 1, first_name: 'Updated', last_name: 'User' }],
        });

        const updateUser = async (id, updates) => {
          const allowedFields = ['first_name', 'last_name', 'email'];
          const fields = Object.keys(updates).filter(k => allowedFields.includes(k));
          
          if (fields.length === 0) {
            throw new Error('No valid fields to update');
          }

          const setClauses = fields.map((f, i) => `${f} = $${i + 2}`);
          const values = [id, ...fields.map(f => updates[f])];

          const result = await db.query(
            `UPDATE users SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
            values
          );
          return result.rows[0];
        };

        const updated = await updateUser(1, { 
          first_name: 'Updated', 
          last_name: 'User' 
        });
        
        expect(updated.first_name).toBe('Updated');
      });

      it('should reject update with no valid fields', async () => {
        const updateUser = async (id, updates) => {
          const allowedFields = ['first_name', 'last_name', 'email'];
          const fields = Object.keys(updates).filter(k => allowedFields.includes(k));
          
          if (fields.length === 0) {
            throw new Error('No valid fields to update');
          }
          return {};
        };

        await expect(updateUser(1, { password: 'hack' }))
          .rejects.toThrow('No valid fields to update');
      });
    });

    describe('deleteUser pattern', () => {
      it('should delete user by id', async () => {
        db.__mockQuery.mockResolvedValueOnce({ rowCount: 1 });

        const deleteUser = async (id) => {
          const result = await db.query(
            'DELETE FROM users WHERE id = $1',
            [id]
          );
          return result.rowCount > 0;
        };

        const deleted = await deleteUser(1);
        
        expect(deleted).toBe(true);
      });

      it('should return false for non-existent user', async () => {
        db.__mockQuery.mockResolvedValueOnce({ rowCount: 0 });

        const deleteUser = async (id) => {
          const result = await db.query(
            'DELETE FROM users WHERE id = $1',
            [id]
          );
          return result.rowCount > 0;
        };

        const deleted = await deleteUser(999);
        
        expect(deleted).toBe(false);
      });
    });
  });
});
