import FollowUp from '../models/FollowUp.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { createNotification } from './notificationService.js';

const FOLLOWUP_DAYS = 7; // Default follow-up schedule

export async function scheduleFollowUp(caseId, advisoryId) {
  const followUp = await FollowUp.create({
    caseId,
    advisoryId,
    farmId: null,
    userId: null,
    scheduledFor: new Date(Date.now() + FOLLOWUP_DAYS * 24 * 60 * 60 * 1000),
    status: 'pending',
    reminderCount: 0,
  });
  return followUp;
}

export async function completeFollowUp(followUpId, response) {
  const followUp = await FollowUp.findById(followUpId);
  if (!followUp) throw new Error('FollowUp not found');

  followUp.farmerResponse = {
    appliedRemedy: response.appliedRemedy || false,
    cropCondition: response.cropCondition,
    photoUploaded: response.photoUploaded || false,
  };
  followUp.completedAt = new Date();

  if (response.cropCondition === 'worse') {
    followUp.status = 'completed_unimproved';
    // Trigger escalation notification
    await createEscalationNotification(followUp);
  } else if (response.cropCondition === 'better' || response.cropCondition === 'same') {
    followUp.status = 'completed_improved';
  } else {
    followUp.status = 'completed_unimproved';
  }

  await followUp.save();
  return followUp;
}

export async function handleResponse(response) {
  if (response.cropCondition === 'worse') {
    // Auto-escalate to CROPSAP
    return { escalated: true, reason: 'Crop condition reported as worse' };
  }
  if (response.cropCondition === 'better') {
    return { escalated: false, status: 'resolved', reason: 'Crop improved' };
  }
  return { escalated: false, status: 'monitoring', reason: 'Pending observation' };
}

export async function getPendingFollowUps() {
  return await FollowUp.find({ status: 'pending' })
    .sort({ scheduledFor: 1 })
    .lean();
}

export async function updateReminderCount(followUpId) {
  const followUp = await FollowUp.findByIdAndUpdate(
    followUpId,
    { $inc: { reminderCount: 1 }, $set: { lastReminderSent: new Date() } },
    { new: true }
  );
  return followUp;
}

export async function markUnresponsive(followUpId) {
  return await FollowUp.findByIdAndUpdate(
    followUpId,
    { status: 'unresponsive' },
    { new: true }
  );
}

async function createEscalationNotification(followUp) {
  try {
    if (!followUp.userId) return { notified: false, reason: 'No userId on followUp' };

    await createNotification(followUp.userId, 'escalation_alert', {
      farmId: followUp.farmId,
      caseId: followUp.caseId,
      advisoryId: followUp.advisoryId,
      followUpId: followUp._id,
      deepLink: `/advisory?id=${followUp.advisoryId}`,
    });

    return { notified: true, escalationReason: 'Worse crop condition reported' };
  } catch (err) {
    console.error('Failed to create escalation notification:', err.message);
    return { notified: false, reason: err.message };
  }
}
