import { createCase, uploadPhotos, deleteCase, getCaseDetail, listCasesForFarm } from '../services/diagnosisService.js';

export async function createCaseEndpoint(req, res) {
  try {
    const { farmId, triggeredBy, triggeringRiskScoreId, gpsPoint } = req.body;
    if (!farmId || !triggeredBy) {
      return res.status(400).json({ success: false, message: 'farmId and triggeredBy are required' });
    }
    const diagnosisCase = await createCase({
      farmId, userId: req.user._id, triggeredBy, triggeringRiskScoreId, gpsPoint,
    });
    res.status(201).json({ success: true, data: diagnosisCase });
  } catch (err) {
    console.error('Error creating case:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function uploadPhotosEndpoint(req, res) {
  try {
    const { caseId } = req.params;
    const files = (req.files || []).map(f => ({
      storageKey: 'cases/' + caseId + '/' + f.filename || ('cases/' + caseId + '/' + f.filename),
      filename: f.originalname || 'photo.jpg',
      mimeType: f.mimetype || 'image/jpeg',
      fileSize: f.size || 0,
    }));
    if (files.length === 0) {
      files.push({ storageKey: 'cases/' + caseId + '/photo.jpg', filename: 'photo.jpg', mimeType: 'image/jpeg', fileSize: 0 });
    }
    const { diagnosisCase, photos } = await uploadPhotos(caseId, files);
    res.status(201).json({ success: true, data: { diagnosisCase, photos } });
  } catch (err) {
    console.error('Error uploading photos:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function deleteCaseEndpoint(req, res) {
  try {
    const dc = await deleteCase(req.params.caseId, req.user._id);
    res.json({ success: true, data: dc });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

export async function getCaseDetailEndpoint(req, res) {
  try {
    const detail = await getCaseDetail(req.params.caseId);
    if (!detail) return res.status(404).json({ success: false, message: 'Case not found' });
    res.json({ success: true, data: detail });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function listCasesEndpoint(req, res) {
  try {
    const { farmId } = req.params;
    const limit = parseInt(req.query.limit) || 20;
    const cursor = req.query.cursor || null;
    const cases = await listCasesForFarm(farmId, limit, cursor);
    res.json({
      success: true, count: cases.length, data: cases,
      nextCursor: cases.length === limit ? cases[cases.length - 1]?._id : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}