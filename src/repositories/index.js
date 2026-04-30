/**
 * @fileoverview Repository Index
 * Central export for all repositories
 */

const userRepository = require('./userRepository');
const questionRepository = require('./questionRepository');
const examRepository = require('./examRepository');

module.exports = {
  userRepository,
  questionRepository,
  examRepository,
};
