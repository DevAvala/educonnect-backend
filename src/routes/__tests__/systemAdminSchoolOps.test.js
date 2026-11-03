/**
 * HTTP-level checks for the system admin school operations: request
 * validation, the typed confirmations, CSV upload rules and error formatting.
 * Controllers are stubbed, so these tests are about what reaches them.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

jest.mock('../../services/authService', () => ({ logSystemAdminActivity: jest.fn().mockResolvedValue(undefined) }));

// The system admin session itself is covered elsewhere; here the caller is one.
jest.mock('../../middleware/systemAdminAuth', () => ({
  requireSystemAdmin: (req, res, next) => {
    req.user = { email: 'root@educonnect.test', role: 'system_admin', crossSchoolAccess: true };
    next();
  },
  validateCrossSchoolAccess: (req, res, next) => next(),
  completeAuditLog: (req, res, next) => next(),
  auditSystemOperation: () => (req, res, next) => next()
}));

jest.mock('../../middleware/rateLimiter', () => ({
  createCustomLimiter: () => (req, res, next) => next()
}));

jest.mock('../../controllers/systemAdminController', () => {
  const ok = (req, res) => res.status(200).json({ success: true });
  return new Proxy({}, { get: () => ok });
});

jest.mock('../../controllers/systemAdminSchoolController', () => {
  const handler = (name) => (req, res) => res.status(200).json({
    success: true,
    handler: name,
    params: req.params,
    query: req.query,
    body: req.body,
    csvBytes: req.csvBuffer ? req.csvBuffer.length : null
  });
  return new Proxy({}, { get: (_, name) => handler(String(name)) });
});

const { globalErrorHandler } = require('../../middleware/errorHandler');
const systemAdminRoutes = require('../systemAdmin');

const app = express();
app.use(express.json());
app.use('/api/system-admin', systemAdminRoutes);
app.use(globalErrorHandler);

const BASE = '/api/system-admin';
const UUID = '8f14e45f-ceea-4b6b-9b6a-2f1c3d4e5f60';
const REASON = 'Contract ended in July';

describe('system admin school operations - routing and validation', () => {
  describe('route order', () => {
    it('should keep /schools/management from being read as a school ID', async () => {
      const response = await request(app).get(`${BASE}/schools/management`);

      expect(response.status).toBe(200);
      expect(response.body.handler).toBeUndefined(); // the original controller, not getSchoolDetail
    });

    it('should route a real school code to the detail handler', async () => {
      const response = await request(app).get(`${BASE}/schools/ABC1234`);

      expect(response.body.handler).toBe('getSchoolDetail');
      expect(response.body.params.schoolId).toBe('ABC1234');
    });
  });

  describe('school ID', () => {
    it.each(['abc1234', 'AB1234', 'ABCD123', 'ABC12345', '..%2F..'])('should reject %s', async (code) => {
      const response = await request(app).get(`${BASE}/schools/${code}`);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('create school', () => {
    const valid = { schoolName: 'Greenfield Academy', email: 'head@greenfield.test' };

    it('should accept the minimum, with no password (one is generated)', async () => {
      expect((await request(app).post(`${BASE}/schools`).send(valid)).status).toBe(200);
    });

    it.each([
      [{ ...valid, schoolName: 'X' }, 'schoolName'],
      [{ ...valid, email: 'nope' }, 'email'],
      [{ ...valid, password: 'short' }, 'password'],
      [{ ...valid, subscriptionTier: 'platinum' }, 'subscriptionTier'],
      [{ ...valid, website: 'not a url' }, 'website'],
      [{}, 'schoolName']
    ])('should reject %j', async (body, field) => {
      const response = await request(app).post(`${BASE}/schools`).send(body);

      expect(response.status).toBe(400);
      expect(response.body.errors.map((error) => error.field)).toContain(field);
    });
  });

  describe('deactivate, reactivate and restore need a real reason', () => {
    it.each([
      ['put', '/schools/ABC1234/deactivate'],
      ['put', '/schools/ABC1234/reactivate'],
      ['post', '/schools/ABC1234/restore']
    ])('%s %s', async (method, path) => {
      expect((await request(app)[method](`${BASE}${path}`).send({})).status).toBe(400);
      expect((await request(app)[method](`${BASE}${path}`).send({ reason: 'too short' })).status).toBe(400);
      expect((await request(app)[method](`${BASE}${path}`).send({ reason: REASON })).status).toBe(200);
    });
  });

  describe('archive and delete need the school name typed back', () => {
    it.each([
      ['post', '/schools/ABC1234/archive'],
      ['delete', '/schools/ABC1234']
    ])('%s %s', async (method, path) => {
      const noName = await request(app)[method](`${BASE}${path}`).send({ reason: REASON });
      expect(noName.status).toBe(400);
      expect(noName.body.errors.map((error) => error.field)).toContain('confirmSchoolName');

      const noReason = await request(app)[method](`${BASE}${path}`).send({ confirmSchoolName: 'Greenfield Academy' });
      expect(noReason.body.errors.map((error) => error.field)).toContain('reason');

      const ok = await request(app)[method](`${BASE}${path}`).send({ reason: REASON, confirmSchoolName: 'Greenfield Academy' });
      expect(ok.status).toBe(200);
      expect(ok.body.body).toEqual({ reason: REASON, confirmSchoolName: 'Greenfield Academy' });
    });
  });

  describe('remove people', () => {
    it('should need a UUID and a reason', async () => {
      expect((await request(app).delete(`${BASE}/schools/ABC1234/users/not-a-uuid`).send({ reason: REASON })).status).toBe(400);
      expect((await request(app).delete(`${BASE}/schools/ABC1234/users/${UUID}`).send({})).status).toBe(400);
      expect((await request(app).delete(`${BASE}/schools/ABC1234/users/${UUID}`).send({ reason: REASON })).status).toBe(200);

      expect((await request(app).delete(`${BASE}/schools/ABC1234/students/${UUID}`).send({})).status).toBe(400);
      expect((await request(app).delete(`${BASE}/schools/ABC1234/students/${UUID}`).send({ reason: REASON })).status).toBe(200);
    });
  });

  describe('lists', () => {
    it('should validate paging and filters', async () => {
      expect((await request(app).get(`${BASE}/schools/ABC1234/students?limit=500`)).status).toBe(400);
      expect((await request(app).get(`${BASE}/schools/ABC1234/students?status=weird`)).status).toBe(400);
      expect((await request(app).get(`${BASE}/schools/ABC1234/staff?status=not_invited&role=teacher`)).status).toBe(200);
      expect((await request(app).get(`${BASE}/schools/ABC1234/staff?role=parent`)).status).toBe(400);
    });

    it('should validate audit log filters', async () => {
      expect((await request(app).get(`${BASE}/audit-logs?schoolId=bad`)).status).toBe(400);
      expect((await request(app).get(`${BASE}/audit-logs?limit=999`)).status).toBe(400);
      expect((await request(app).get(`${BASE}/audit-logs?schoolId=ABC1234&action=school.delete`)).status).toBe(200);
    });
  });

  describe('CSV import', () => {
    const csvFile = Buffer.from('firstName,lastName\nAda,Obi\n');

    it('should hand the uploaded bytes to the importer', async () => {
      const response = await request(app)
        .post(`${BASE}/schools/ABC1234/import/students?dryRun=true`)
        .attach('file', csvFile, { filename: 'students.csv', contentType: 'text/csv' });

      expect(response.status).toBe(200);
      expect(response.body.handler).toBe('importStudents');
      expect(response.body.csvBytes).toBe(csvFile.length);
      expect(response.body.query.dryRun).toBe('true');
    });

    it('should accept the MIME type Windows gives a .csv', async () => {
      const response = await request(app)
        .post(`${BASE}/schools/ABC1234/import/staff`)
        .attach('file', csvFile, { filename: 'staff.csv', contentType: 'application/vnd.ms-excel' });

      expect(response.status).toBe(200);
      expect(response.body.handler).toBe('importStaff');
    });

    it('should refuse a request with no file', async () => {
      const response = await request(app).post(`${BASE}/schools/ABC1234/import/students`).send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('CSV_FILE_REQUIRED');
    });

    it.each([
      ['students.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['students.csv.exe', 'application/octet-stream'],
      ['students.csv', 'image/png'],
      ['students.txt', 'text/plain']
    ])('should refuse %s (%s)', async (filename, contentType) => {
      const response = await request(app)
        .post(`${BASE}/schools/ABC1234/import/students`)
        .attach('file', csvFile, { filename, contentType });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('CSV_FILE_REQUIRED');
    });

    it('should refuse a file over the size limit', async () => {
      const big = Buffer.alloc(5 * 1024 * 1024 + 10, 'a');
      const response = await request(app)
        .post(`${BASE}/schools/ABC1234/import/students`)
        .attach('file', big, { filename: 'big.csv', contentType: 'text/csv' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('FILE_TOO_LARGE');
    });

    it('should check the school ID and dryRun before reading the file', async () => {
      const badSchool = await request(app)
        .post(`${BASE}/schools/nope/import/students`)
        .attach('file', csvFile, { filename: 'students.csv', contentType: 'text/csv' });
      expect(badSchool.status).toBe(400);

      const badFlag = await request(app)
        .post(`${BASE}/schools/ABC1234/import/students?dryRun=maybe`)
        .attach('file', csvFile, { filename: 'students.csv', contentType: 'text/csv' });
      expect(badFlag.status).toBe(400);
    });

    it('should serve the CSV templates', async () => {
      expect((await request(app).get(`${BASE}/import/templates/students`)).status).toBe(200);
      expect((await request(app).get(`${BASE}/import/templates/staff`)).status).toBe(200);
    });
  });

  describe('invite imported staff', () => {
    it('should accept no body, or a short list of user IDs', async () => {
      expect((await request(app).post(`${BASE}/schools/ABC1234/staff/invite`).send({})).status).toBe(200);
      expect((await request(app).post(`${BASE}/schools/ABC1234/staff/invite`).send({ userIds: [UUID] })).status).toBe(200);
    });

    it('should refuse bad IDs and oversized lists', async () => {
      expect((await request(app).post(`${BASE}/schools/ABC1234/staff/invite`).send({ userIds: ['nope'] })).status).toBe(400);
      const tooMany = Array.from({ length: 101 }, () => UUID);
      expect((await request(app).post(`${BASE}/schools/ABC1234/staff/invite`).send({ userIds: tooMany })).status).toBe(400);
    });
  });
});
