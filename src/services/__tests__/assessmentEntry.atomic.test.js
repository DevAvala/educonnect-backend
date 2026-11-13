let mockRows;
let mockEntries;
let mockDb;

jest.mock('../../config/database', () => ({ get prisma() { return mockDb; } }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));
let service;

beforeEach(() => {
  mockRows = [{ entryId: 'e1', studentId: 's1', scoreObtained: 4 }];
  mockEntries = [{ id: 'e1', createdBy: 't1', schoolId: 'school', policyComponentId: 'c1', componentType: 'ca', className: 'A', subjectName: 'Math', termId: 'term', maxObtainableScore: 10, contributionPoints: 10, title: 'Test' }];
  mockDb = {
    user: { findUnique: async () => ({ schoolId: 'school', classes: ['A'], subjects: ['Math'] }) },
    class: { findFirst: async () => ({ id: 'class1' }) },
    subject: { findFirst: async () => ({ id: 'subject1' }) },
    assessmentPolicy: { findFirst: async () => ({ components: [{ id: 'c1', maxScore: 100 }] }) },
    assessmentEntry: {
      findFirst: async ({ where }) => mockEntries.find(e => e.id === where.id && e.createdBy === where.createdBy && e.schoolId === where.schoolId) || null,
      findMany: async () => mockEntries.map(e => ({ contributionPoints: e.contributionPoints })),
      findUnique: async ({ where }) => ({ ...mockEntries.find(e => e.id === where.id), scores: mockRows.filter(r => r.entryId === where.id) }),
      create: async ({ data }) => { const entry = { id: 'new', ...data, scores: [] }; mockEntries.push(entry); return entry; },
      update: async ({ where, data }) => { const entry = mockEntries.find(e => e.id === where.id); Object.assign(entry, data); return { ...entry, scores: mockRows.filter(r => r.entryId === entry.id) }; },
    },
    assessmentScore: {
      deleteMany: async ({ where }) => { mockRows = mockRows.filter(r => r.entryId !== where.entryId); },
      createMany: async ({ data }) => { if (data.some(r => r.studentId === 'broken')) throw new Error('write failure'); mockRows.push(...data); },
    },
  };
  mockDb.$transaction = async fn => {
    const rows = structuredClone(mockRows), entries = structuredClone(mockEntries);
    try { return await fn(mockDb); } catch (error) { mockRows = rows; mockEntries = entries; throw error; }
  };
  jest.resetModules();
  service = require('../assessmentEntryService');
});

test('invalid score and failed score write preserve saved marks', async () => {
  expect((await service.saveScores('e1', 't1', 'school', [{ studentId: 's1', scoreObtained: 11 }])).validationError).toBeTruthy();
  expect(mockRows[0].scoreObtained).toBe(4);
  await expect(service.saveScores('e1', 't1', 'school', [{ studentId: 'broken', scoreObtained: 0 }])).rejects.toThrow();
  expect(mockRows[0].scoreObtained).toBe(4);
  await service.saveScores('e1', 't1', 'school', [{ studentId: 's1', scoreObtained: 0 }]);
  expect(mockRows[0].scoreObtained).toBe(0);
});

test('metadata and scores roll back together when a write fails', async () => {
  await expect(service.saveEntryWithScores('t1', 'school', { title: 'Changed' }, [{ studentId: 'broken', scoreObtained: 1 }], 'e1')).rejects.toThrow();
  expect(mockEntries[0].title).toBe('Test');
  expect(mockRows[0].scoreObtained).toBe(4);
  const data = { policyComponentId: 'c1', componentType: 'ca', title: 'New', assessmentType: 'test', className: 'A', subjectName: 'Math', termId: 'term', maxObtainableScore: 10, contributionPoints: 10 };
  await expect(service.saveEntryWithScores('t1', 'school', data, [{ studentId: 'broken', scoreObtained: 1 }])).rejects.toThrow();
  expect(mockEntries).toHaveLength(1);
  const saved = await service.saveEntryWithScores('t1', 'school', data, [{ studentId: 's1', scoreObtained: 0 }]);
  expect(saved.scores[0].scoreObtained).toBe(0);
});
