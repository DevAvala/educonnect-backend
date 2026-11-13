const mockFindPublication = jest.fn();
const mockFindJob = jest.fn();
jest.mock('../../config/database', () => ({ prisma: { reportCardPublication: { findUnique: mockFindPublication }, pdfJob: { findFirst: mockFindJob } } }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));
jest.mock('../pdfRenderer', () => ({}));
jest.mock('../reportCardHtmlBuilder', () => ({}));
jest.mock('../supabaseStorageService', () => ({}));
const { getReportCardStatus } = require('../reportCardService');

test('status reads publication and latest job for the selected school, arm and term', async () => {
  mockFindPublication.mockResolvedValue({ signedOff: true, released: false });
  mockFindJob.mockResolvedValue({ id: 'job', status: 'completed', progress: 100, downloadUrl: 'url' });
  expect(await getReportCardStatus('school', 'arm', 'term')).toEqual({ signedOff: true, released: false, job: { jobId: 'job', status: 'completed', progress: 100, downloadUrl: 'url' } });
  expect(mockFindPublication).toHaveBeenCalledWith({ where: { schoolId_armId_termId: { schoolId: 'school', armId: 'arm', termId: 'term' } } });
  expect(mockFindJob.mock.calls[0][0].where).toEqual({ schoolId: 'school', type: 'report_card', AND: [{ metadata: { path: ['armId'], equals: 'arm' } }, { metadata: { path: ['termId'], equals: 'term' } }] });
});
