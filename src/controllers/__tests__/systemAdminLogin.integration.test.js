const request = require('supertest');
const express = require('express');

jest.mock('bcrypt', () => ({ compare: jest.fn(), hash: jest.fn() }));
jest.mock('jsonwebtoken', () => ({ sign: jest.fn(), verify: jest.fn() }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../utils/cookieHelper', () => ({ setRefreshTokenCookie: jest.fn(), clearRefreshTokenCookie: jest.fn(), getRefreshTokenFromCookie: jest.fn() }));

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const controller = require('../systemAdminAuthController');
const { validateLogin, createSystemAdminValidationChain } = require('../../middleware/systemAdminAuthValidation');
const { isSystemAdminConfigured } = require('../../services/systemAdminAuthService');

const app = express();
app.use(express.json());
app.post('/login', ...createSystemAdminValidationChain(validateLogin), controller.login);

const keys = ['SYSTEM_ADMIN_EMAIL', 'SYSTEM_ADMIN_PASSWORD_HASH', 'SYSTEM_ADMIN_JWT_SECRET', 'JWT_SECRET'];
let previous;
beforeEach(() => {
  previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.SYSTEM_ADMIN_EMAIL = 'first.last+owner@gmail.com';
  process.env.SYSTEM_ADMIN_PASSWORD_HASH = 'test-hash-not-a-real-secret';
  process.env.SYSTEM_ADMIN_JWT_SECRET = 'test-signing-key-not-for-deployment';
  bcrypt.compare.mockResolvedValue(true);
  jwt.sign.mockReturnValue('test-only-token');
});
afterEach(() => {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
  jest.resetAllMocks();
});
const login = (email = 'first.last+owner@gmail.com') => request(app).post('/login').set('User-Agent', 'EduConnect integration test').send({ email, password: 'CorrectTest123!' });

test('a configured Gmail address keeps its dots and plus suffix through validation', async () => {
  const res = await login();
  expect(res.status).toBe(200);
  expect(res.body.data.user.email).toBe('first.last+owner@gmail.com');
  expect(bcrypt.compare).toHaveBeenCalledWith('CorrectTest123!', 'test-hash-not-a-real-secret');
});
test('trims email and handles case consistently on both sides of comparison', async () => {
  process.env.SYSTEM_ADMIN_EMAIL = '  First.Last+Owner@Gmail.com  ';
  const res = await login(' First.Last+Owner@Gmail.com ');
  expect(res.status).toBe(200);
});
test('an alias different from the configured address is still refused', async () => {
  const res = await login('first.last+someoneelse@gmail.com');
  expect(res.status).toBe(401);
  expect(res.body.code).toBe('INVALID_CREDENTIALS');
});
test('wrong password still returns the generic invalid-credentials response', async () => {
  bcrypt.compare.mockResolvedValue(false);
  const res = await login();
  expect(res.status).toBe(401);
  expect(res.body.code).toBe('INVALID_CREDENTIALS');
});
test('a token signing failure is a service error, not a wrong-password error', async () => {
  // A simple address also reaches token signing before the normalization fix.
  process.env.SYSTEM_ADMIN_EMAIL = 'owner@example.com';
  jwt.sign.mockImplementation(() => { throw new Error('internal signing failure'); });
  const res = await login('owner@example.com');
  expect(res.status).toBe(503);
  expect(res.body.code).toBe('SYSTEM_ADMIN_AUTH_UNAVAILABLE');
  expect(JSON.stringify(res.body)).not.toContain('internal signing failure');
});
test('missing signing configuration is reported before attempting login', async () => {
  delete process.env.SYSTEM_ADMIN_JWT_SECRET;
  delete process.env.JWT_SECRET;
  expect(isSystemAdminConfigured()).toBe(false);
  const res = await login();
  expect(res.status).toBe(503);
  expect(res.body.code).toBe('SYSTEM_ADMIN_NOT_CONFIGURED');
});
test('credential-check operational failures are not labeled as invalid passwords', async () => {
  process.env.SYSTEM_ADMIN_EMAIL = 'owner@example.com';
  bcrypt.compare.mockRejectedValue(new Error('internal hash failure'));
  const res = await login('owner@example.com');
  expect(res.status).toBe(503);
  expect(res.body.code).toBe('SYSTEM_ADMIN_AUTH_UNAVAILABLE');
  expect(JSON.stringify(res.body)).not.toContain('internal hash failure');
});
