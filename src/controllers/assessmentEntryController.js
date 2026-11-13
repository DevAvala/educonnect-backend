const entryService = require('../services/assessmentEntryService');
const logger = require('../utils/logger');

const list = async (req, res) => {
  try {
    const { id: userId, schoolId } = req.user;
    const { className, subjectName, termId } = req.query;

    const entries = await entryService.listEntries(userId, schoolId, className, subjectName, termId);
    res.json({ success: true, data: { entries } });
  } catch (error) {
    logger.error('Error listing assessment entries:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to list entries' });
  }
};

const create = async (req, res) => {
  try {
    const { id: userId, schoolId } = req.user;

    const entry = await entryService.createEntry(userId, schoolId, req.body);
    res.status(201).json({ success: true, data: { entry } });
  } catch (error) {
    logger.error('Error creating assessment entry:', error);
    if (error.message.includes('not assigned')) {
      return res.status(403).json({ success: false, message: error.message });
    }
    if (error.message.includes('exceed component max') || error.message.includes('Contribution points exceed')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.message.includes('not found') || error.message.includes('No assessment policy') || error.message.includes('CA component not found')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Failed to create entry' });
  }
};

const update = async (req, res) => {
  try {
    const { id: userId, schoolId } = req.user;
    const { id } = req.params;

    const result = await entryService.updateEntry(id, userId, schoolId, req.body);
    if (result.notFound) {
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }
    if (result.cannotChange) {
      return res.status(400).json({ success: false, message: 'Cannot change policyComponentId, componentType, className, subjectName, or termId' });
    }

    res.json({ success: true, data: { entry: result } });
  } catch (error) {
    logger.error('Error updating assessment entry:', error);
    if (error.message.includes('exceed component max') || error.message.includes('other entries use')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Failed to update entry' });
  }
};

const remove = async (req, res) => {
  try {
    const { id: userId, schoolId } = req.user;
    const { id } = req.params;

    const result = await entryService.deleteEntry(id, userId, schoolId);
    if (result.notFound) {
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }

    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    logger.error('Error deleting assessment entry:', error);
    res.status(500).json({ success: false, message: 'Failed to delete entry' });
  }
};

const saveScores = async (req, res) => {
  try {
    const { id: userId, schoolId } = req.user;
    const { id } = req.params;
    const { scores } = req.body;

    const result = await entryService.saveScores(id, userId, schoolId, scores);
    if (result.notFound) {
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }
    if (result.validationError) {
      return res.status(400).json({ success: false, message: result.validationError });
    }

    res.json({ success: true, data: { entry: result } });
  } catch (error) {
    logger.error('Error saving scores:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to save scores' });
  }
};

const gradingActivity = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { className, armName, subjectName, termId } = req.query;

    const activity = await entryService.getGradingActivity(schoolId, className, armName, subjectName, termId);
    res.json({ success: true, data: activity });
  } catch (error) {
    logger.error('Error fetching grading activity:', error);
    if (error.message.includes('not found') || error.message.includes('No assessment policy')) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch grading activity' });
  }
};

const subjectScores = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { className, armName, subjectName, termId } = req.query;

    const data = await entryService.getSubjectScores(schoolId, className, armName, subjectName, termId);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('Error fetching subject scores:', error);
    if (error.message.includes('not found') || error.message.includes('No assessment policy')) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch subject scores' });
  }
};

module.exports = { list, create, update, remove, saveScores, gradingActivity, subjectScores };
