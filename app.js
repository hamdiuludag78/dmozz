// DMOZZ NEWS PRO v5.0 - Main Application
import { NewsApp } from './modules/app.js';
import { StorageManager } from './modules/storage.js';
import { RSSFeedManager } from './modules/rss.js';
import { UIManager } from './modules/ui.js';
import { NotificationManager } from './modules/notifications.js';
import { CommentManager } from './modules/comments.js';
import { AnalyticsManager } from './modules/analytics.js';

// Initialize Application
const app = new NewsApp();

// Global Error Handler
window.addEventListener('error', event => {
  console.error('Global Error:', event.error);
  UIManager.showToast('Bir hata oluştu. Lütfen sayfayı yenileyin.', 'error');
});

window.addEventListener('unhandledrejection', event => {
  console.error('Unhandled Promise Rejection:', event.reason);
  UIManager.showToast('Bir hata oluştu. Lütfen sayfayı yenileyin.', 'error');
});

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});

export { app, StorageManager, RSSFeedManager, UIManager, NotificationManager, CommentManager, AnalyticsManager };