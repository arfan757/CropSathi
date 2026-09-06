/**
 * Notification Panel for CropSathi
 * Handles bell icon, notification list, read/unread, and actions
 */

class NotificationPanel {
  constructor() {
    this.api = window.CROPSATHI_API_URL || 'https://cropsathi-x5fe.onrender.com';
    this.pollingInterval = 30000; // 30 seconds
    this.isOpen = false;
    this.notifications = [];
    this.unreadCount = 0;
    this.panel = null;
    this.bellButton = null;
  }

  async init() {
    this.createPanel();
    this.attachBellListener();
    this.startPolling();
  }

  getToken() {
    return localStorage.getItem('token');
  }

  createPanel() {
    // Remove existing panel if any
    const existing = document.getElementById('cs-notification-panel');
    if (existing) existing.remove();

    // Create panel
    const panel = document.createElement('div');
    panel.id = 'cs-notification-panel';
    panel.className = 'cs-notification-panel';
    panel.innerHTML = `
      <div class="cs-np-header">
        <h3 class="cs-np-title">Notifications</h3>
        <button type="button" class="cs-np-mark-all" id="cs-mark-all-btn">Mark all read</button>
      </div>
      <div class="cs-np-list" id="cs-np-list">
        <div class="cs-np-empty">No notifications yet</div>
      </div>
      <div class="cs-np-footer">
        <a href="#" class="cs-np-view-all">View all notifications</a>
      </div>
    `;

    document.body.appendChild(panel);
    this.panel = panel;

    // Add mark all read listener
    document.getElementById('cs-mark-all-btn')?.addEventListener('click', () => this.markAllRead());

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (this.isOpen && !panel.contains(e.target) && !this.bellButton?.contains(e.target)) {
        this.close();
      }
    });
  }

  attachBellListener() {
    this.bellButton = document.querySelector('[aria-label="Notifications"]');
    if (this.bellButton) {
      this.bellButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle();
      });
    }
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  async open() {
    if (!this.panel) return;
    this.isOpen = true;
    this.panel.classList.add('cs-np-open');
    await this.fetchNotifications();
  }

  close() {
    if (!this.panel) return;
    this.isOpen = false;
    this.panel.classList.remove('cs-np-open');
  }

  async fetchNotifications() {
    const token = this.getToken();
    if (!token) return;

    try {
      const response = await fetch(`${this.api}/api/notifications?limit=20`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to fetch');

      const result = await response.json();
      this.notifications = result.notifications || [];
      this.unreadCount = result.unreadCount || 0;

      this.updateBellBadge();
      this.renderNotifications();
    } catch (err) {
      console.error('Notification fetch error:', err);
    }
  }

  updateBellBadge() {
    const bell = this.bellButton;
    if (!bell) return;

    // Remove existing badge
    const existingBadge = bell.querySelector('.cs-np-badge');
    if (existingBadge) existingBadge.remove();

    // Add badge if unread
    if (this.unreadCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'cs-np-badge';
      badge.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
      bell.appendChild(badge);
    }
  }

  renderNotifications() {
    const list = document.getElementById('cs-np-list');
    if (!list) return;

    if (this.notifications.length === 0) {
      list.innerHTML = '<div class="cs-np-empty">No notifications yet</div>';
      return;
    }

    list.innerHTML = this.notifications.map(n => this.renderNotificationItem(n)).join('');

    // Attach listeners
    list.querySelectorAll('.cs-np-item').forEach(item => {
      const id = item.dataset.id;
      item.addEventListener('click', () => this.handleItemClick(id));
    });
  }

  renderNotificationItem(n) {
    const isUnread = !n.read;
    const priorityClass = `cs-np-priority-${n.priority || 'medium'}`;
    const timeAgo = this.formatTimeAgo(new Date(n.createdAt));

    return `
      <div class="cs-np-item ${isUnread ? 'cs-np-unread' : ''} ${priorityClass}" data-id="${n._id}">
        <div class="cs-np-item-icon">
          <i data-lucide="${this.getIconForType(n.type)}"></i>
        </div>
        <div class="cs-np-item-content">
          <div class="cs-np-item-title">${this.escapeHtml(n.title)}</div>
          <div class="cs-np-item-body">${this.escapeHtml(n.body)}</div>
          <div class="cs-np-item-meta">
            <span class="cs-np-item-time">${timeAgo}</span>
            <span class="cs-np-priority-badge">${n.priority || 'medium'}</span>
          </div>
        </div>
      </div>
    `;
  }

  getIconForType(type) {
    const icons = {
      advisory_ready: 'lightbulb',
      remedy_reminder: 'pill',
      reapplication_reminder: 'repeat',
      follow_up_check: 'clipboard-check',
      harvest_safety_wait: 'alert-triangle',
      escalation_alert: 'alert-circle',
      weather_alert: 'cloud-rain',
    };
    return icons[type] || 'bell';
  }

  formatTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    const intervals = [
      { label: 'y', seconds: 31536000 },
      { label: 'mo', seconds: 2592000 },
      { label: 'd', seconds: 86400 },
      { label: 'h', seconds: 3600 },
      { label: 'm', seconds: 60 },
    ];

    for (const interval of intervals) {
      const count = Math.floor(seconds / interval.seconds);
      if (count >= 1) return `${count}${interval.label} ago`;
    }
    return 'Just now';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async handleItemClick(id) {
    // Mark as read
    await this.markAsRead(id);
    // Navigate to deep link if exists
    const notification = this.notifications.find(n => n._id === id);
    if (notification?.deepLink) {
      window.location.href = notification.deepLink + (notification.caseId ? `?caseId=${notification.caseId}` : '');
    }
    this.close();
  }

  async markAsRead(id) {
    const token = this.getToken();
    if (!token) return;

    try {
      await fetch(`${this.api}/api/notifications/${id}/read`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      // Update local state
      const notification = this.notifications.find(n => n._id === id);
      if (notification) {
        notification.read = true;
        this.unreadCount = Math.max(0, this.unreadCount - 1);
      }

      this.updateBellBadge();
      this.renderNotifications();
    } catch (err) {
      console.error('Mark as read error:', err);
    }
  }

  async markAllRead() {
    const token = this.getToken();
    if (!token) return;

    try {
      await fetch(`${this.api}/api/notifications/mark-all-read`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      // Update local state
      this.notifications.forEach(n => n.read = true);
      this.unreadCount = 0;

      this.updateBellBadge();
      this.renderNotifications();
    } catch (err) {
      console.error('Mark all read error:', err);
    }
  }

  startPolling() {
    // Initial fetch
    this.fetchNotifications();

    // Set up polling
    setInterval(() => {
      if (document.visibilityState === 'visible') {
        this.fetchNotifications();
      }
    }, this.pollingInterval);
  }
}

// Initialize on DOM ready
let notificationPanel;

document.addEventListener('DOMContentLoaded', () => {
  // Only initialize if user is logged in
  if (localStorage.getItem('token')) {
    notificationPanel = new NotificationPanel();
    notificationPanel.init();

    // Re-initialize lucide icons if needed
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }
});

// Export for external use
window.NotificationPanel = NotificationPanel;
