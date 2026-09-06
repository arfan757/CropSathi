import { Router } from 'express';
import {
  scheduleFollowUp,
  completeFollowUp,
  getPendingFollowUps,
} from '../services/followupService.js';
import FollowUp from '../models/FollowUp.js';
import { protect } from '../middleware/authMiddleware.js';

const router = Router();

router.use(protect);

router.get('/pending', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const followUps = await FollowUp.find({ userId, status: 'pending' })
      .sort({ scheduledFor: 1 })
      .lean();
    res.json({ followUps });
  } catch (err) {
    console.error('Error fetching pending follow-ups:', err.message);
    res.status(500).json({ error: 'Failed to fetch follow-ups' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const followUp = await FollowUp.findOne({ _id: req.params.id, userId }).lean();
    if (!followUp) {
      return res.status(404).json({ error: 'FollowUp not found' });
    }
    res.json({ followUp });
  } catch (err) {
    console.error('Error fetching follow-up:', err.message);
    res.status(500).json({ error: 'Failed to fetch follow-up' });
  }
});

router.post('/:id/complete', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const { appliedRemedy, cropCondition, notes, photoUrl } = req.body;

    if (!cropCondition || !['better', 'same', 'worse'].includes(cropCondition)) {
      return res.status(400).json({ error: 'cropCondition must be better, same, or worse' });
    }

    const followUp = await completeFollowUp(req.params.id, {
      appliedRemedy,
      cropCondition,
      photoUploaded: !!photoUrl,
    });

    res.json({ success: true, followUp });
  } catch (err) {
    console.error('Error completing follow-up:', err.message);
    if (err.message === 'FollowUp not found') {
      return res.status(404).json({ error: 'FollowUp not found' });
    }
    res.status(500).json({ error: 'Failed to complete follow-up' });
  }
});

router.post('/schedule', async (req, res) => {
  try {
    const { caseId, advisoryId } = req.body;
    if (!caseId || !advisoryId) {
      return res.status(400).json({ error: 'caseId and advisoryId required' });
    }

    const followUp = await scheduleFollowUp(caseId, advisoryId);
    res.json({ success: true, followUp });
  } catch (err) {
    console.error('Error scheduling follow-up:', err.message);
    res.status(500).json({ error: 'Failed to schedule follow-up' });
  }
});

export default router;
