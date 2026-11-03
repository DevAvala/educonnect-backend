const { prisma } = require('../config/database');
const { AppError } = require('../utils/AppError');
const audit = require('./platformAuditService');
const CacheService = require('./cacheService');

// Every collection is allowlisted and returns selected fields only. No tenant
// identifier supplied in a body or query can override the school in the URL.
const collections = {
  classes: { model: 'class', search: ['name'], select: { id: true, name: true, baseLevel: true, level: true, isActive: true, arms: { select: { id: true, name: true, isActive: true } }, _count: { select: { students: true, subjects: true } } } },
  subjects: { model: 'subject', search: ['name', 'code'], select: { id: true, name: true, code: true, category: true, description: true, isActive: true } },
  'academic-years': { model: 'academicYear', search: ['year', 'name'], select: { id: true, year: true, name: true, startDate: true, endDate: true, isCurrent: true, isActive: true, terms: { select: { id: true, name: true, isCurrent: true, startDate: true, endDate: true } } } },
  attendance: { model: 'attendanceSession', select: { id: true, date: true, sessionType: true, status: true, class: { select: { name: true } }, arm: { select: { name: true } }, _count: { select: { records: true } } } },
  'fee-structures': { model: 'feeStructure', search: ['name'], select: { id: true, name: true, totalAmount: true, dueDate: true, status: true, isActive: true } },
  invoices: { model: 'feeInvoice', search: ['invoiceNumber'], select: { id: true, invoiceNumber: true, amount: true, amountPaid: true, amountDue: true, dueDate: true, status: true } },
  payments: { model: 'feePayment', search: ['referenceNumber', 'receiptNumber'], select: { id: true, referenceNumber: true, receiptNumber: true, amount: true, paymentMethod: true, status: true, paidAt: true, needsReview: true } },
  'report-cards': { model: 'reportCardPublication', select: { id: true, armId: true, termId: true, signedOff: true, released: true, publishedCount: true, updatedAt: true } },
  timetables: { model: 'timetablePublished', select: { id: true, classId: true, armId: true, termId: true, publishedAt: true } },
  events: { model: 'event', search: ['name'], select: { id: true, name: true, type: true, date: true, endDate: true } },
  messages: { model: 'notification', search: ['title'], extra: { type: 'system_admin_message' }, select: { id: true, userId: true, title: true, body: true, isRead: true, meta: true, createdAt: true } }
};
const editable = ['classes', 'subjects'];
const findSchool = async (db, code, write = false) => {
  const school = await db.school.findUnique({ where: { schoolId: code }, select: { id: true, schoolId: true, schoolName: true, isActive: true, archivedAt: true, isDeleted: true, systemConfig: true, updatedAt: true } });
  if (!school) throw new AppError('School not found', 404, 'SCHOOL_NOT_FOUND');
  if (write && (!school.isActive || school.archivedAt || school.isDeleted)) throw new AppError('Restore and reactivate this school before changing its operations.', 409, 'SCHOOL_UNAVAILABLE');
  return school;
};
const schoolWhere = school => ({ schoolId: { in: [school.id, school.schoolId] } });
const pageArgs = query => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

async function list(code, collection, query) {
  const spec = Object.hasOwn(collections, collection) && collections[collection];
  if (!spec) throw new AppError('Unsupported collection', 404, 'COLLECTION_NOT_FOUND');
  const school = await findSchool(prisma, code);
  const { page, limit, skip } = pageArgs(query);
  const where = { ...schoolWhere(school), ...spec.extra };
  if (query.search && spec.search) where.OR = spec.search.map(field => ({ [field]: { contains: query.search, mode: 'insensitive' } }));
  if (editable.includes(collection) && query.status) where.isActive = query.status === 'active';
  const [records, total] = await prisma.$transaction([
    prisma[spec.model].findMany({ where, select: spec.select, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: limit, skip }),
    prisma[spec.model].count({ where })
  ]);
  if (['timetables', 'report-cards'].includes(collection) && records.length) {
    const [classes, arms, terms] = await Promise.all([
      prisma.class.findMany({ where: { ...schoolWhere(school), id: { in: records.map(r => r.classId).filter(Boolean) } }, select: { id: true, name: true } }),
      prisma.arm.findMany({ where: { ...schoolWhere(school), id: { in: records.map(r => r.armId).filter(Boolean) } }, select: { id: true, name: true } }),
      prisma.academicTerm.findMany({ where: { ...schoolWhere(school), id: { in: records.map(r => r.termId).filter(Boolean) } }, select: { id: true, name: true } })
    ]);
    for (const record of records) {
      record.className = classes.find(c => c.id === record.classId)?.name;
      record.armName = arms.find(a => a.id === record.armId)?.name;
      record.termName = terms.find(t => t.id === record.termId)?.name;
    }
  }
  return { records, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function summary(code) {
  const school = await findSchool(prisma, code);
  const counts = await Promise.all(Object.entries(collections).map(async ([key, spec]) => [key, await prisma[spec.model].count({ where: { ...schoolWhere(school), ...spec.extra, ...(editable.includes(key) ? { isActive: true } : {}) } })]));
  return { school: { schoolId: code, schoolName: school.schoolName }, counts: Object.fromEntries(counts), generatedAt: new Date().toISOString() };
}

async function statusCounts() {
  const [active, inactive, archived, deleted] = await prisma.$transaction([
    prisma.school.count({ where: { isActive: true, archivedAt: null, isDeleted: false } }),
    prisma.school.count({ where: { isActive: false, archivedAt: null, isDeleted: false } }),
    prisma.school.count({ where: { archivedAt: { not: null }, isDeleted: false } }),
    prisma.school.count({ where: { isDeleted: true } })
  ]);
  return { counts: { active, inactive, archived, deleted }, generatedAt: new Date().toISOString() };
}

async function configuration(code) {
  const school = await findSchool(prisma, code);
  const config = school.systemConfig || {};
  return { schoolId: code, version: school.updatedAt.toISOString(), subscriptionTier: config.subscriptionTier, subscriptionStatus: config.subscriptionStatus,
    features: Array.isArray(config.features) ? config.features : [], limits: config.limits || {} };
}

async function saveConfiguration(code, body, actor, context) {
  return prisma.$transaction(async tx => {
    const school = await findSchool(tx, code, true);
    if (school.updatedAt.toISOString() !== body.version) throw new AppError('School configuration changed. Reload before saving.', 409, 'CONFIG_CONFLICT');
    const before = school.systemConfig || {};
    const limits = Object.fromEntries(['maxUsers', 'maxStudents', 'maxStorage'].filter(key => body.limits[key] !== undefined).map(key => [key, Number(body.limits[key])]));
    const config = { ...before, subscriptionTier: body.subscriptionTier, subscriptionStatus: body.subscriptionStatus,
      limits: { ...before.limits, ...limits } };
    // Only existing feature names may be toggled. A UI cannot invent an
    // entitlement which other applications do not implement.
    if (body.features) {
      const existing = Array.isArray(before.features) ? before.features : [];
      if (body.features.some(f => !existing.some(e => e.featureName === f.featureName))) throw new AppError('Unknown school feature', 400, 'UNKNOWN_FEATURE');
      config.features = existing.map(f => ({ ...f, isEnabled: body.features.find(e => e.featureName === f.featureName)?.isEnabled ?? f.isEnabled }));
    }
    await tx.school.update({ where: { id: school.id }, data: { systemConfig: config } });
    await audit.recordInTransaction(tx, { action: 'school.config_update', entityType: 'school', entityId: code, schoolId: school.id, actor, context,
      details: { schoolCode: code, reason: body.reason, before: { subscriptionTier: before.subscriptionTier, subscriptionStatus: before.subscriptionStatus, limits: before.limits || {} }, after: { subscriptionTier: config.subscriptionTier, subscriptionStatus: config.subscriptionStatus, limits: config.limits, features: config.features || [] } } });
    return { saved: true };
  }, { isolationLevel: 'Serializable' });
}

async function changeAcademic(code, collection, id, body, actor, context) {
  if (!editable.includes(collection)) throw new AppError('Unsupported operation', 404, 'COLLECTION_NOT_FOUND');
  try {
    const result = await prisma.$transaction(async tx => {
      const school = await findSchool(tx, code, true);
      const model = collections[collection].model;
      let record;
      if (id) {
        const existing = await tx[model].findFirst({ where: { id, ...schoolWhere(school) }, select: { id: true, isActive: true } });
        if (!existing) throw new AppError('Record not found in this school', 404, 'RECORD_NOT_FOUND');
        record = await tx[model].update({ where: { id: existing.id }, data: { isActive: body.isActive }, select: { id: true, name: true, isActive: true } });
      } else {
        const data = collection === 'classes' ? { name: body.name, baseLevel: body.baseLevel || null, level: body.level ?? null }
          : { name: body.name, code: body.code, category: body.category || 'core', description: body.description || null };
        record = await tx[model].create({ data: { ...data, schoolId: school.id }, select: { id: true, name: true, isActive: true } });
      }
      await audit.recordInTransaction(tx, { action: `${collection === 'classes' ? 'class' : 'subject'}.${id ? (body.isActive ? 'reactivate' : 'deactivate') : 'create'}`, entityType: model, entityId: record.id, schoolId: school.id, actor, context,
        details: { schoolCode: code, name: record.name, reason: body.reason } });
      return { record };
    }, { isolationLevel: 'Serializable' });
    await CacheService.invalidatePlatformCachesForSchool(code).catch(() => {});
    return result;
  } catch (error) {
    if (error.code === 'P2002') throw new AppError('A record with that name or code already exists in this school.', 409, 'RECORD_EXISTS');
    if (error.code === 'P2034') throw new AppError('Another change was made at the same time. Reload and try again.', 409, 'WRITE_CONFLICT');
    throw error;
  }
}

// A durable request ID reserves delivery before contacting the email provider.
// Repeating a request returns its existing result and never sends twice. If a
// process dies after reservation, pending means delivery is uncertain: inspect
// provider logs rather than automatically replaying it.
async function messageAdmin(code, body, actor, context) {
  const reservation = await prisma.$transaction(async tx => {
    const school = await findSchool(tx, code, true);
    const previous = await tx.notification.findUnique({ where: { id: body.requestId } });
    if (previous) {
      if (previous.schoolId !== school.id || previous.userId !== body.userId || previous.meta?.actor !== actor || previous.title !== body.title || previous.body !== body.body)
        throw new AppError('Message request ID has already been used.', 409, 'MESSAGE_CONFLICT');
      return { existing: previous };
    }
    const admin = await tx.user.findFirst({ where: { id: body.userId, schoolId: school.id, role: 'admin', isActive: true, isDeleted: false }, select: { id: true, email: true } });
    if (!admin) throw new AppError('Active school admin not found in this school', 404, 'ADMIN_NOT_FOUND');
    const message = await tx.notification.create({ data: { id: body.requestId, schoolId: school.id, userId: admin.id, type: 'system_admin_message', title: body.title, body: body.body, meta: { actor, channel: 'email', deliveryStatus: 'pending' } } });
    await audit.recordInTransaction(tx, { action: 'admin.message_requested', entityType: 'notification', entityId: message.id, schoolId: school.id, actor, context,
      details: { schoolCode: code, recipientId: admin.id, channel: 'email' } });
    return { message, admin, school };
  }, { isolationLevel: 'Serializable' });
  if (reservation.existing) return { messageId: reservation.existing.id, deliveryStatus: reservation.existing.meta.deliveryStatus, repeated: true };
  const { message, admin, school } = reservation;
  let deliveryStatus = 'unknown';
  try {
    const email = require('../config/email');
    const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const result = await email.sendEmail({ to: admin.email, subject: body.title, text: body.body,
      html: `<p>${escape(body.body).replace(/\n/g, '<br>')}</p>` }, Number.MAX_SAFE_INTEGER);
    deliveryStatus = result.success && result.messageId ? 'sent' : 'unknown';
  } catch (_) { /* Delivery cannot safely be inferred after provider errors. */ }
  await prisma.$transaction(async tx => {
    await tx.notification.update({ where: { id: message.id }, data: { meta: { ...message.meta, deliveryStatus } } });
    await audit.recordInTransaction(tx, { action: 'admin.message_result', entityType: 'notification', entityId: message.id, schoolId: school.id, actor, context,
      details: { schoolCode: code, recipientId: admin.id, deliveryStatus } });
  });
  return { messageId: message.id, deliveryStatus };
}

module.exports = { collections, list, summary, statusCounts, configuration, saveConfiguration, changeAcademic, messageAdmin };
