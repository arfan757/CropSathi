import { Router } from 'express';
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  takeAction,
} from '../services/notificationService.js';
import { protect } from '../middleware/authMiddleware.js';

const router = Router();

router.use(protect);

router.get('/', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const { limit = 20, cursor, status, type } = req.query;
    const result = await getNotifications(userId, { limit, cursor, status, type });

    res.json(result);
  } catch (err) {
    console.error('Error fetching notifications:', err.message);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

router.get('/unread-count', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const count = await getUnreadCount(userId);
    res.json({ unreadCount: count });
  } catch (err) {
    console.error('Error getting unread count:', err.message);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

router.patch('/:id/read', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const { id } = req.params;
    const notification = await markAsRead(id, userId);
    res.json({ success: true, notification });
  } catch (err) {
    console.error('Error marking notification read:', err.message);
    if (err.message === 'Notification not found') {
      return res.status(404).json({ error: 'Notification not found' });
    }
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

router.post('/mark-all-read', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const result = await markAllAsRead(userId);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Error marking all notifications read:', err.message);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

router.post('/:id/action', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const { id } = req.params;
    const { action, snoozeHours = 6 } = req.body;

    if (!['done', 'snooze', 'dismiss'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Must be done, snooze, or dismiss' });
    }

    const notification = await takeAction(id, userId, action);
    res.json({ success: true, notification });
  } catch (err) {
    console.error('Error taking action on notification:', err.message);
    if (err.message === 'Notification not found') {
      return res.status(404).json({ error: 'Notification not found' });
    }
    res.status(500).json({ error: 'Failed to take action' });
  }
});

export default router;
