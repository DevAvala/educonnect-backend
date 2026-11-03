jest.mock('../../config/database', () => {
  const models = ['school','class','subject','arm','academicYear','academicTerm','attendanceSession','feeStructure','feeInvoice','feePayment','reportCardPublication','timetablePublished','event','notification','user'];
  return { prisma: Object.fromEntries(models.map(name => [name, Object.fromEntries(['findUnique','findFirst','findMany','count','create','update'].map(m => [m, jest.fn()]))])) };
});
jest.mock('../cacheService', () => ({ invalidatePlatformCachesForSchool: jest.fn().mockResolvedValue() }));
jest.mock('../platformAuditService', () => ({ recordInTransaction: jest.fn().mockResolvedValue() }));
jest.mock('../../config/email', () => ({ sendEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'provider-receipt' }) }));
const { prisma } = require('../../config/database');
const audit = require('../platformAuditService');
const email = require('../../config/email');
const service = require('../systemAdminOperationsService');
const school = { id: 'school-a', schoolId: 'ABC1234', schoolName: 'School A', isActive: true, isDeleted: false, updatedAt: new Date('2026-11-03T09:00:00Z'), systemConfig: { subscriptionTier: 'basic', limits: { maxUsers: 10 }, features: [{ featureName: 'existing_feature', isEnabled: true }] } };
const reason = 'Reviewed with school staff';
const message = { requestId: 'a9d8a29d-1a3c-4d91-9f6e-34232729e3ff', userId: 'admin-a', title: 'School review', body: 'Hello <script>unsafe</script>\nPlease review this.' };
beforeEach(() => {
  jest.clearAllMocks();
  prisma.school.findUnique.mockReset().mockResolvedValue(school);
  prisma.$transaction = jest.fn(async arg => Array.isArray(arg) ? Promise.all(arg) : arg(prisma));
  for (const spec of Object.values(service.collections)) {
    prisma[spec.model].findMany.mockReset().mockResolvedValue([]);
    prisma[spec.model].count.mockReset().mockResolvedValue(0);
  }
  prisma.notification.findUnique.mockReset().mockResolvedValue(null);
  prisma.notification.create.mockReset().mockImplementation(async ({ data }) => data);
  prisma.user.findFirst.mockReset().mockResolvedValue({ id: 'admin-a', email: 'admin@example.invalid' });
  prisma.class.findFirst.mockReset().mockResolvedValue(null);
  prisma.class.create.mockReset().mockResolvedValue({ id: 'class-a', name: 'Primary 1', isActive: true });
  audit.recordInTransaction.mockReset().mockResolvedValue();
  email.sendEmail.mockReset().mockResolvedValue({ success: true, messageId: 'provider-receipt' });
});
it.each(Object.keys(service.collections))('scopes %s reads to the selected school, selects safe fields and caps pagination', async key => {
  const spec = service.collections[key];
  prisma[spec.model].count.mockResolvedValue(101);
  const data = await service.list('ABC1234', key, { page: 2, limit: 500, search: 'find me' });
  expect(prisma[spec.model].findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ schoolId: { in: ['school-a','ABC1234'] } }), select: spec.select, take: 100, skip: 100 }));
  expect(data.pagination).toEqual({ total: 101, page: 2, limit: 100, pages: 2 });
});
it('refuses unknown collections and missing schools', async () => {
  await expect(service.list('ABC1234', '__proto__', {})).rejects.toMatchObject({ code: 'COLLECTION_NOT_FOUND' });
  prisma.school.findUnique.mockResolvedValue(null);
  await expect(service.summary('ABC1234')).rejects.toMatchObject({ code: 'SCHOOL_NOT_FOUND' });
});
it('cannot mutate a class belonging to another school', async () => {
  await expect(service.changeAcademic('ABC1234', 'classes', 'foreign-class', { isActive: false, reason }, 'root')).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  expect(prisma.class.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'foreign-class', schoolId: { in: ['school-a','ABC1234'] } } }));
  expect(prisma.class.update).not.toHaveBeenCalled();
});
it.each([{ isActive: false }, { archivedAt: new Date() }, { isDeleted: true }])('blocks writes to an unavailable school: %s', async flags => {
  prisma.school.findUnique.mockResolvedValue({ ...school, ...flags });
  await expect(service.changeAcademic('ABC1234', 'classes', null, { name: 'Primary 1', reason }, 'root')).rejects.toMatchObject({ code: 'SCHOOL_UNAVAILABLE' });
  expect(prisma.class.create).not.toHaveBeenCalled();
});
it('writes a class and its audit record in the same serializable transaction', async () => {
  await service.changeAcademic('ABC1234', 'classes', null, { name: 'Primary 1', reason, schoolId: 'school-b' }, 'root');
  expect(prisma.class.create.mock.calls[0][0].data.schoolId).toBe('school-a');
  expect(audit.recordInTransaction).toHaveBeenCalledWith(prisma, expect.objectContaining({ schoolId: 'school-a', actor: 'root', action: 'class.create', details: expect.objectContaining({ reason }) }));
  expect(prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
  audit.recordInTransaction.mockRejectedValue(new Error('audit failed'));
  await expect(service.changeAcademic('ABC1234', 'classes', null, { name: 'Primary 2', reason }, 'root')).rejects.toThrow('audit failed');
});
it('returns a conflict for duplicate academic names rather than overwriting', async () => {
  prisma.class.create.mockRejectedValue({ code: 'P2002' });
  await expect(service.changeAcademic('ABC1234', 'classes', null, { name: 'Primary 1', reason }, 'root')).rejects.toMatchObject({ code: 'RECORD_EXISTS', statusCode: 409 });
});
it('configuration preserves unrelated values and cannot change the generated school identity', async () => {
  const body = { version: school.updatedAt.toISOString(), subscriptionTier: 'premium', subscriptionStatus: 'active', reason, schoolId: 'XYZ9999', limits: { maxStudents: 50, injected: true }, features: [{ featureName: 'existing_feature', isEnabled: false }] };
  await service.saveConfiguration('ABC1234', body, 'root');
  const data = prisma.school.update.mock.calls[0][0].data;
  expect(Object.keys(data)).toEqual(['systemConfig']);
  expect(data.systemConfig.limits).toEqual({ maxUsers: 10, maxStudents: 50 });
  expect(data.systemConfig.features[0].isEnabled).toBe(false);
  await expect(service.saveConfiguration('ABC1234', { ...body, features: [{ featureName: 'invented', isEnabled: true }] }, 'root')).rejects.toMatchObject({ code: 'UNKNOWN_FEATURE' });
  await expect(service.saveConfiguration('ABC1234', { ...body, version: '2025-01-01T00:00:00.000Z' }, 'root')).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
});
it('reserves email and audits before sending, escapes HTML, and returns provider acceptance only with a receipt', async () => {
  const result = await service.messageAdmin('ABC1234', message, 'root');
  expect(result.deliveryStatus).toBe('sent');
  expect(audit.recordInTransaction.mock.invocationCallOrder[0]).toBeLessThan(email.sendEmail.mock.invocationCallOrder[0]);
  expect(email.sendEmail.mock.calls[0][0].html).toContain('&lt;script&gt;');
  expect(email.sendEmail.mock.calls[0][1]).toBe(Number.MAX_SAFE_INTEGER);
  email.sendEmail.mockResolvedValue({ success: true });
  expect((await service.messageAdmin('ABC1234', message, 'root')).deliveryStatus).toBe('unknown');
});
it('does not send if the audit reservation fails or the recipient is in another school', async () => {
  audit.recordInTransaction.mockRejectedValue(new Error('audit failed'));
  await expect(service.messageAdmin('ABC1234', message, 'root')).rejects.toThrow('audit failed');
  expect(email.sendEmail).not.toHaveBeenCalled();
  audit.recordInTransaction.mockResolvedValue(); prisma.user.findFirst.mockResolvedValue(null);
  await expect(service.messageAdmin('ABC1234', message, 'root')).rejects.toMatchObject({ code: 'ADMIN_NOT_FOUND' });
  expect(email.sendEmail).not.toHaveBeenCalled();
});
it('does not resend a repeated request, or allow another recipient/school/actor to reuse it', async () => {
  const existing = { id: message.requestId, title: message.title, body: message.body, userId: message.userId, schoolId: school.id, meta: { actor: 'root', deliveryStatus: 'pending' } };
  prisma.notification.findUnique.mockResolvedValue(existing);
  expect(await service.messageAdmin('ABC1234', message, 'root')).toMatchObject({ repeated: true, deliveryStatus: 'pending' });
  await expect(service.messageAdmin('ABC1234', message, 'other-actor')).rejects.toMatchObject({ code: 'MESSAGE_CONFLICT' });
  expect(email.sendEmail).not.toHaveBeenCalled();
});
