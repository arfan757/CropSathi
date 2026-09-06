import Notification from '../models/Notification.js';
import User from '../models/User.js';

export async function createNotification(userId, type, data = {}) {
  const user = await User.findById(userId).lean();
  const lang = user?.preferredLanguage || 'en';

  const template = getNotificationTemplate(type, lang);

  const notification = await Notification.create({
    userId,
    farmId: data.farmId || null,
    caseId: data.caseId || null,
    advisoryId: data.advisoryId || null,
    followUpId: data.followUpId || null,
    type,
    title: template.title || getDefaultTitle(type),
    body: template.body || getDefaultBody(type),
    priority: template.priority || 'medium',
    deepLink: data.deepLink || null,
    read: false,
  });

  return notification;
}

export async function getNotifications(userId, { limit = 20, cursor = null, status = null, type = null }) {
  const query = { userId };
  if (status) query.read = status === 'read';
  if (type) query.type = type;
  if (cursor) query._id = { $lt: cursor };

  const notifications = await Notification.find(query)
    .sort({ createdAt: -1 })
    .limit(parseInt(limit) || 20)
    .lean();

  const unreadCount = await Notification.countDocuments({ userId, read: false });

  return {
    notifications,
    unreadCount,
    nextCursor: notifications.length === (parseInt(limit) || 20) ? notifications[notifications.length - 1]._id : null,
  };
}

export async function getUnreadCount(userId) {
  return await Notification.countDocuments({ userId, read: false });
}

export async function markAsRead(notificationId, userId) {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, userId },
    { $set: { read: true, readAt: new Date() } },
    { new: true }
  );

  if (!notification) throw new Error('Notification not found');
  return notification;
}

export async function markAllAsRead(userId) {
  const result = await Notification.updateMany(
    { userId, read: false },
    { $set: { read: true, readAt: new Date() } }
  );
  return { updatedCount: result.modifiedCount };
}

export async function takeAction(notificationId, userId, action) {
  const updates = { actionTaken: action };
  if (action === 'snoozed') {
    updates.snoozedUntil = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6 hours
  }

  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, userId },
    { $set: updates },
    { new: true }
  );

  if (!notification) throw new Error('Notification not found');
  return notification;
}

function getNotificationTemplate(type, lang) {
  const templates = {
    advisory_ready: {
      en: { title: 'Treatment Advisory Ready', body: 'Your crop diagnosis is complete. View treatment recommendations.', priority: 'high', deepLink: '/advisory' },
      hi: { title: 'उपचार सलाह तैयार', body: 'आपकी फसल निदान पूर्ण हो गया है। उपचार सिफारिशें देखें।', priority: 'high', deepLink: '/advisory' },
      mr: { title: 'उपचार सल्ला तयार', body: 'तुमचे पीक निदान पूर्ण झाले. उपचार शिफारशी पहा.', priority: 'high', deepLink: '/advisory' },
    },
    remedy_reminder: {
      en: { title: 'Apply Treatment Reminder', body: 'Time to apply the recommended remedy to your crop.', priority: 'high', deepLink: '/advisory' },
      hi: { title: 'उपचार लागू करें', body: 'अपनी फसल पर अनुशंसित उपचार लागू करें।', priority: 'high', deepLink: '/advisory' },
      mr: { title: 'उपचार लावा', body: 'तुमच्या पीकवर शिफारशित उपचार लावा.', priority: 'high', deepLink: '/advisory' },
    },
    reapplication_reminder: {
      en: { title: 'Reapply Treatment', body: 'Next dose of your treatment is due. Please reapply.', priority: 'high', deepLink: '/advisory' },
      hi: { title: 'पुनः आवेदन करें', body: 'आपके उपचार की अगली खुरak या है।', priority: 'high', deepLink: '/advisory' },
      mr: { title: 'पुनः लावा', body: 'तुमच्या उपचाराची पुढील खुरak आहे.', priority: 'high', deepLink: '/advisory' },
    },
    follow_up_check: {
      en: { title: 'Follow-up Check Needed', body: 'Please check your crop and report how it looks.', priority: 'medium', deepLink: '/followup' },
      hi: { title: 'फॉलो-अप जांच', body: 'कृपया अपनी फसल की जांच करें और रिपोर्ट करें।', priority: 'medium', deepLink: '/followup' },
      mr: { title: 'फॉलो-अप तपासणी', body: 'कृपया तुमचे पीक तपासा आणि अहवाल द्या.', priority: 'medium', deepLink: '/followup' },
    },
    harvest_safety_wait: {
      en: { title: 'Pre-Harvest Safety Notice', body: 'Chemical treatment used. Wait before harvest for safety.', priority: 'urgent', deepLink: '/advisory' },
      hi: { title: 'कटाई सुरक्षा नोटिस', body: 'रसायन उपचार का उपयोग किया गया। सुरक्षा के लिए कटाई से पहले प्रतीक्षा करें।', priority: 'urgent', deepLink: '/advisory' },
      mr: { title: 'कापणी सुरक्षा सूचना', body: 'रासायनिक उपचार वापरला. सुरकीसाठी कापणीच्या पूर्वी प्रतीक्षा करा.', priority: 'urgent', deepLink: '/advisory' },
    },
    escalation_alert: {
      en: { title: 'Case Escalated to CROPSAP', body: 'Your case has been referred to CROPSAP for expert review.', priority: 'urgent', deepLink: '/advisory' },
      hi: { title: 'CROPSAP को भेजा गया', body: 'आपका मामला CROPSAP समीक्षा के लिए भेजा गया है।', priority: 'urgent', deepLink: '/advisory' },
      mr: { title: 'CROPSAP ला पाठवले', body: 'तुमचे प्रकरण CROPSAP पुनरावलोकनासाठी पाठवले गेले.', priority: 'urgent', deepLink: '/advisory' },
    },
    weather_alert: {
      en: { title: 'Weather Alert', body: 'Disease-conducive weather conditions detected for your farm.', priority: 'medium', deepLink: '/dashboard' },
      hi: { title: 'मौसम चेतावनी', body: 'आपके खेत में रोग अनुकूल मौसम की स्थिति पाई गई।', priority: 'medium', deepLink: '/dashboard' },
      mr: { title: 'हweather इशारा', body: 'तुमच्या शेतात रोग अनुकूल हवामानाची स्थिती आढळली.', priority: 'medium', deepLink: '/dashboard' },
    },
  };

  const t = templates[type];
  if (!t) return getDefaultTitle(type);
  const entry = t[lang] || t.en || { title: getDefaultTitle(type), body: getDefaultBody(type), priority: 'medium', deepLink: null };
  return entry;
}

function getDefaultTitle(type) {
  const titles = {
    advisory_ready: 'Advisory Ready',
    remedy_reminder: 'Remedy Reminder',
    reapplication_reminder: 'Reapplication Due',
    follow_up_check: 'Follow-up Check',
    harvest_safety_wait: 'Safety Notice',
    escalation_alert: 'Escalation Alert',
    weather_alert: 'Weather Alert',
  };
  return titles[type] || 'Notification';
}

function getDefaultBody(type) {
  const bodies = {
    advisory_ready: 'Your advisory is ready.',
    remedy_reminder: 'Time to apply the remedy.',
    reapplication_reminder: 'Next dose is due.',
    follow_up_check: 'Check your crop progress.',
    harvest_safety_wait: 'Wait before harvest for safety.',
    escalation_alert: 'Your case has been escalated.',
    weather_alert: 'Weather conditions detected.',
  };
  return bodies[type] || 'You have a new notification.';
}
