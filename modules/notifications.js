// Notification Manager - Push Notifications & Web Notifications
export class NotificationManager {
  static permission = 'default';
  static subscription = null;

  static async init() {
    if ('Notification' in window) {
      this.permission = Notification.permission;
      if (this.permission === 'default') {
        await this.requestPermission();
      }
    }
    this.setupServiceWorkerListeners();
  }

  static async requestPermission() {
    if ('Notification' in window) {
      this.permission = await Notification.requestPermission();
      return this.permission === 'granted';
    }
    return false;
  }

  static async showNotification(title, options = {}) {
    if (this.permission !== 'granted') return;

    const defaultOptions = {
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect fill="%231B7F3C" width="192" height="192"/><text x="96" y="110" font-size="120" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle" font-family="Arial">D</text></svg>',
      badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect fill="%231B7F3C" width="192" height="192"/><text x="96" y="110" font-size="120" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle" font-family="Arial">D</text></svg>',
      tag: 'dmozz-news-notification',
      requireInteraction: false,
      vibrate: [100, 50, 100],
      actions: [
        { action: 'open', title: 'Aç' },
        { action: 'close', title: 'Kapat' }
      ]
    };

    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SHOW_NOTIFICATION',
        title,
        options: { ...defaultOptions, ...options }
      });
    } else if ('Notification' in window) {
      new Notification(title, { ...defaultOptions, ...options });
    }
  }

  static setupServiceWorkerListeners() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data.type === 'FEEDS_UPDATED') {
          const badge = document.getElementById('notificationBadge');
          if (badge) {
            badge.textContent = event.data.newCount;
            this.showNotification('Yeni Haberler', {
              body: `${event.data.newCount} yeni haber yüklendi`,
              tag: 'new-articles',
              data: { newCount: event.data.newCount }
            });
          }
        }
      });
    }
  }

  static async subscribeToPushNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Push notifications not supported');
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      this.subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(process.env.REACT_APP_VAPID_KEY || '')
      });
      return true;
    } catch (err) {
      console.warn('Push subscription failed:', err);
      return false;
    }
  }

  static urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
}

export default NotificationManager;