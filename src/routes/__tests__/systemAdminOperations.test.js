const request = require('supertest');
const express = require('express');
jest.mock('../../services/systemAdminAuthService', () => ({ verifySystemAdminToken: jest.fn(token => ({ email: 'root@example.invalid', role: token === 'school-token' ? 'admin' : 'system_admin', crossSchoolAccess: token !== 'no-cross-school', iat: 1, exp: 9999999999 })) }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../services/authService', () => ({ logSystemAdminActivity: jest.fn().mockResolvedValue() }));
jest.mock('../../services/platformAuditService', () => ({ contextFromRequest: () => ({}) }));
jest.mock('../../middleware/rateLimiter', () => ({ createCustomLimiter: () => (req, res, next) => next() }));
jest.mock('../../controllers/systemAdminController', () => new Proxy({}, { get: () => (req, res) => res.json({ success: true }) }));
jest.mock('../../controllers/systemAdminSchoolController', () => new Proxy({}, { get: () => (req, res) => res.json({ success: true }) }));
jest.mock('../../services/systemAdminOperationsService', () => ({
  collections: { classes: {}, subjects: {}, attendance: {}, messages: {} },
  list: jest.fn().mockResolvedValue({ records: [], pagination: { total: 0, pages: 0 } }),
  summary: jest.fn().mockResolvedValue({ counts: {} }),
  configuration: jest.fn().mockResolvedValue({ limits: {} }),
  saveConfiguration: jest.fn().mockResolvedValue({ saved: true }),
  changeAcademic: jest.fn().mockResolvedValue({ record: {} }),
  messageAdmin: jest.fn().mockResolvedValue({ deliveryStatus: 'sent' }),
  statusCounts: jest.fn().mockResolvedValue({ counts: {} })
}));
const service = require('../../services/systemAdminOperationsService');
const routes = require('../systemAdmin');
const app = express(); app.use(express.json()); app.use('/api/system-admin', routes);
app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ success: false, code: err.code, message: err.message }));
const base = '/api/system-admin/schools/ABC1234';
const auth = test => test.set('Authorization', 'Bearer system-token');
const uuid = 'a9d8a29d-1a3c-4d91-9f6e-34232729e3ff';
beforeEach(() => jest.clearAllMocks());
it('requires a real system-admin role and cross-school permission for new routes', async () => {
  expect((await request(app).get(`${base}/operations/classes`)).status).toBe(401);
  expect((await request(app).get(`${base}/operations/classes`).set('Authorization', 'Bearer school-token')).status).toBe(403);
  expect((await request(app).get(`${base}/operations/classes`).set('Authorization', 'Bearer no-cross-school')).status).toBe(403);
  expect(service.list).not.toHaveBeenCalled();
});
it('passes the URL school code with bounded, validated filters to the service', async () => {
  expect((await auth(request(app).get(`${base}/operations/classes?page=2&limit=10&search=Primary`))).status).toBe(200);
  expect(service.list).toHaveBeenCalledWith('ABC1234', 'classes', expect.objectContaining({ page: '2', limit: '10', search: 'Primary' }));
});
it.each(['page=0','page=-1','limit=101','limit=nan','status=bad'])('rejects invalid list query %s', async query => {
  expect((await auth(request(app).get(`${base}/operations/classes?${query}`))).status).toBe(400);
  expect(service.list).not.toHaveBeenCalled();
});
it('validates generated school codes and refuses writes to read-only collections', async () => {
  expect((await auth(request(app).get('/api/system-admin/schools/bad/operations/classes'))).status).toBe(400);
  expect((await auth(request(app).post(`${base}/operations/attendance`).send({ name: 'Example', reason: 'A valid reason here' }))).status).toBe(400);
  expect(service.changeAcademic).not.toHaveBeenCalled();
});
it('requires a meaningful reason, strict boolean and valid record UUID for availability changes', async () => {
  for (const body of [{ reason: 'short', isActive: false }, { reason: 'A valid reason here', isActive: 'false' }]) {
    expect((await auth(request(app).put(`${base}/operations/classes/${uuid}`).send(body))).status).toBe(400);
  }
  expect((await auth(request(app).put(`${base}/operations/classes/${uuid}`).send({ reason: 'A valid reason here', isActive: false }))).status).toBe(200);
  expect(service.changeAcademic).toHaveBeenCalledTimes(1);
});
it('requires subject codes and rejects invalid feature/limit values', async () => {
  expect((await auth(request(app).post(`${base}/operations/subjects`).send({ name: 'Maths', reason: 'A valid reason here' }))).status).toBe(400);
  expect((await auth(request(app).put(`${base}/operations/configuration`).send({ subscriptionTier: 'basic', subscriptionStatus: 'trial', reason: 'A valid reason here', limits: { maxUsers: -10 } }))).status).toBe(400);
  expect((await auth(request(app).put(`${base}/operations/configuration`).send({ subscriptionTier: 'basic', subscriptionStatus: 'trial', reason: 'A valid reason here', limits: {}, features: [{ featureName: 'x', isEnabled: 'true' }] }))).status).toBe(400);
});
it('requires an idempotency reference and valid recipient for every email', async () => {
  const body = { requestId: uuid, userId: uuid, title: 'Review this', body: 'A valid message for the admin' };
  expect((await auth(request(app).post(`${base}/admin-messages`).send({ ...body, requestId: '' }))).status).toBe(400);
  expect((await auth(request(app).post(`${base}/admin-messages`).send({ ...body, title: 'Header\nInjection' }))).status).toBe(400);
  expect((await auth(request(app).post(`${base}/admin-messages`).send(body))).status).toBe(200);
  expect(service.messageAdmin).toHaveBeenCalledTimes(1);
});
