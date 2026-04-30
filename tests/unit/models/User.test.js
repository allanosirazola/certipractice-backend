/**
 * @fileoverview User Model Unit Tests
 */

const User = require('../../../src/models/User');
const { users } = require('../../fixtures');

describe('User Model', () => {
  describe('Constructor', () => {
    it('should create user with default values', () => {
      const user = new User({});

      expect(user.id).toBeNull();
      expect(user.username).toBe('');
      expect(user.email).toBe('');
      expect(user.role).toBe('student');
      expect(user.isActive).toBe(true);
      expect(user.isValidated).toBe(false);
    });

    it('should create user with provided data', () => {
      const data = {
        id: 1,
        username: 'testuser',
        email: 'test@test.com',
        first_name: 'Test',
        last_name: 'User',
        role: 'admin',
        is_active: true,
        is_validated: true,
      };

      const user = new User(data);

      expect(user.id).toBe(1);
      expect(user.username).toBe('testuser');
      expect(user.email).toBe('test@test.com');
      expect(user.firstName).toBe('Test');
      expect(user.lastName).toBe('User');
      expect(user.role).toBe('admin');
      expect(user.isActive).toBe(true);
      expect(user.isValidated).toBe(true);
    });

    it('should handle camelCase and snake_case', () => {
      const dataSnake = {
        first_name: 'Snake',
        last_name: 'Case',
        is_active: false,
      };

      const dataCamel = {
        firstName: 'Camel',
        lastName: 'Case',
        isActive: true,
      };

      const userSnake = new User(dataSnake);
      const userCamel = new User(dataCamel);

      expect(userSnake.firstName).toBe('Snake');
      expect(userSnake.isActive).toBe(false);
      expect(userCamel.firstName).toBe('Camel');
      expect(userCamel.isActive).toBe(true);
    });
  });

  describe('Static validate()', () => {
    it('should return empty array for valid user data', () => {
      const validData = {
        username: 'validuser',
        email: 'valid@email.com',
        password: 'SecurePass123!',
      };

      const errors = User.validate(validData);
      expect(errors).toEqual([]);
    });

    it('should validate required username', () => {
      const errors = User.validate({ email: 'test@test.com', password: '123456' });
      expect(errors).toContain('Username is required');
    });

    it('should validate required email', () => {
      const errors = User.validate({ username: 'test', password: '123456' });
      expect(errors).toContain('Email is required');
    });

    it('should validate required password', () => {
      const errors = User.validate({ username: 'test', email: 'test@test.com' });
      expect(errors).toContain('Password is required');
    });

    it('should validate email format', () => {
      const errors = User.validate({
        username: 'testuser',
        email: 'invalid-email',
        password: '12345678',
      });
      expect(errors.some((e) => e.toLowerCase().includes('email'))).toBe(true);
    });

    it('should validate minimum password length', () => {
      const errors = User.validate({
        username: 'testuser',
        email: 'test@test.com',
        password: '123',
      });
      expect(errors.some((e) => e.includes('8 characters'))).toBe(true);
    });

    it('should validate username format', () => {
      const errors = User.validate({
        username: 'test user!@#',
        email: 'test@test.com',
        password: '12345678',
      });
      expect(errors.some((e) => e.toLowerCase().includes('alphanumeric'))).toBe(true);
    });

    it('should validate minimum username length', () => {
      const errors = User.validate({
        username: 'ab',
        email: 'test@test.com',
        password: '123456',
      });
      expect(errors.some((e) => e.includes('3 characters'))).toBe(true);
    });

    it('should validate maximum username length', () => {
      const errors = User.validate({
        username: 'a'.repeat(51),
        email: 'test@test.com',
        password: '123456',
      });
      expect(errors.some((e) => e.includes('50 characters'))).toBe(true);
    });
  });

  describe('Role checks', () => {
    it('should correctly identify admin', () => {
      const admin = new User({ role: 'admin' });
      const student = new User({ role: 'student' });

      expect(admin.isAdmin).toBe(true);
      expect(student.isAdmin).toBe(false);
    });

    it('should correctly identify instructor', () => {
      const instructor = new User({ role: 'instructor' });
      const student = new User({ role: 'student' });
      const admin = new User({ role: 'admin' });

      expect(instructor.isInstructor).toBe(true);
      expect(admin.isInstructor).toBe(true); // Admin has instructor privileges
      expect(student.isInstructor).toBe(false);
    });

    it('should correctly identify student', () => {
      const student = new User({ role: 'student' });
      const admin = new User({ role: 'admin' });

      expect(student.isStudent).toBe(true);
      expect(admin.isStudent).toBe(false);
    });
  });

  describe('hasRole()', () => {
    it('should check single role', () => {
      const admin = new User({ role: 'admin' });

      expect(admin.hasRole('admin')).toBe(true);
      expect(admin.hasRole('student')).toBe(false);
    });

    it('should check multiple roles', () => {
      const instructor = new User({ role: 'instructor' });

      expect(instructor.hasRole('admin', 'instructor')).toBe(true);
      expect(instructor.hasRole('admin', 'student')).toBe(false);
    });
  });

  describe('getFullName()', () => {
    it('should return full name', () => {
      const user = new User({
        first_name: 'John',
        last_name: 'Doe',
      });

      expect(user.getFullName()).toBe('John Doe');
    });

    it('should handle missing first name', () => {
      const user = new User({ last_name: 'Doe' });

      expect(user.getFullName()).toBe('Doe');
    });

    it('should handle missing last name', () => {
      const user = new User({ first_name: 'John' });

      expect(user.getFullName()).toBe('John');
    });

    it('should return empty string when both names missing', () => {
      const user = new User({ username: 'testuser' });

      expect(user.getFullName()).toBe('');
    });
  });

  describe('getDisplayName()', () => {
    it('should prefer full name', () => {
      const user = new User({
        username: 'johnd',
        first_name: 'John',
        last_name: 'Doe',
      });

      expect(user.getDisplayName()).toBe('John Doe');
    });

    it('should fall back to username', () => {
      const user = new User({ username: 'johnd' });

      expect(user.getDisplayName()).toBe('johnd');
    });

    it('should fall back to email', () => {
      const user = new User({ email: 'john@test.com' });

      expect(user.getDisplayName()).toBe('john@test.com');
    });

    it('should handle empty user', () => {
      const user = new User({});

      expect(user.getDisplayName()).toBe('');
    });
  });

  describe('canAccessResource()', () => {
    it('should allow admin to access any resource', () => {
      const admin = new User({ id: 1, role: 'admin' });

      expect(admin.canAccessResource(1)).toBe(true);
      expect(admin.canAccessResource(999)).toBe(true);
    });

    it('should allow owner to access their resource', () => {
      const user = new User({ id: 5, role: 'student' });

      expect(user.canAccessResource(5)).toBe(true);
      expect(user.canAccessResource(6)).toBe(false);
    });
  });

  describe('toJSON()', () => {
    it('should return serializable object', () => {
      const user = new User({
        id: 1,
        username: 'testuser',
        email: 'test@test.com',
        first_name: 'Test',
        last_name: 'User',
        role: 'student',
        is_active: true,
        password_hash: 'secret-hash',
      });

      const json = user.toJSON();

      expect(json.id).toBe(1);
      expect(json.username).toBe('testuser');
      expect(json.email).toBe('test@test.com');
      expect(json.passwordHash).toBeUndefined();
      expect(json.password_hash).toBeUndefined();
    });

    it('should include computed properties', () => {
      const admin = new User({
        id: 1,
        role: 'admin',
        first_name: 'Admin',
        last_name: 'User',
      });

      const json = admin.toJSON();

      expect(json.fullName).toBe('Admin User');
      expect(json.isAdmin).toBe(true);
    });
  });

  describe('toPublicJSON()', () => {
    it('should return limited public data', () => {
      const user = new User({
        id: 1,
        username: 'testuser',
        email: 'test@test.com',
        first_name: 'Test',
        last_name: 'User',
        role: 'student',
      });

      const publicJson = user.toPublicJSON();

      expect(publicJson.id).toBe(1);
      expect(publicJson.username).toBe('testuser');
      expect(publicJson.displayName).toBe('Test User');
      expect(publicJson.email).toBeUndefined();
      expect(publicJson.role).toBeUndefined();
    });
  });

  describe('Role constants', () => {
    it('should have correct role values', () => {
      expect(User.Roles.ADMIN).toBe('admin');
      expect(User.Roles.INSTRUCTOR).toBe('instructor');
      expect(User.Roles.STUDENT).toBe('student');
    });

    it('should have all roles array', () => {
      expect(User.AllRoles).toContain('admin');
      expect(User.AllRoles).toContain('instructor');
      expect(User.AllRoles).toContain('student');
    });
  });

  describe('isValidRole()', () => {
    it('should validate known roles', () => {
      expect(User.isValidRole('admin')).toBe(true);
      expect(User.isValidRole('instructor')).toBe(true);
      expect(User.isValidRole('student')).toBe(true);
    });

    it('should reject unknown roles', () => {
      expect(User.isValidRole('superuser')).toBe(false);
      expect(User.isValidRole('')).toBe(false);
      expect(User.isValidRole(null)).toBe(false);
    });
  });
});
