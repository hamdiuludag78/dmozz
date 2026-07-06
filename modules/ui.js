// UI Manager - DOM Manipulation and Rendering
import { DOMPurify } from '../app.js';

export class UIManager {
  static toastContainer = null;
  static modals = new Map();
  static currentPage = 'home';

  static init() {
    this.createToastContainer();
    this.setupEventListeners();
  }

  static createToastContainer() {
    this.toastContainer = document.createElement('div');
    this.toastContainer.id = 'toast-container';
    this.toastContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;
    document.body.appendChild(this.toastContainer);
  }

  static showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    const bgColor = {
      success: '#27AE60',
      error: '#E74C3C',
      warning: '#F39C12',
      info: '#3498DB'
    }[type] || '#3498DB';

    toast.style.cssText = `
      background: ${bgColor};
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      animation: slideIn 0.3s ease-in-out;
      min-width: 250px;
    `;
    toast.textContent = message;

    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease-in-out';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  static renderArticleCard(article) {
    return `
      <article class="article-card" data-guid="${this.escapeHtml(article.guid)}" itemscope itemtype="https://schema.org/NewsArticle">
        ${article.image ? `<img src="${this.escapeHtml(article.image)}" alt="${this.escapeHtml(article.title)}" class="article-image" loading="lazy" itemprop="image">` : '<div class="article-image" style="background: #E8E8E8;"></div>'}
        <div class="article-content">
          <span class="article-category" itemprop="articleSection">${this.escapeHtml(article.category)}</span>
          <h3 class="article-title" itemprop="headline">${this.escapeHtml(article.title)}</h3>
          <p class="article-description" itemprop="description">${this.escapeHtml(article.description.substring(0, 150))}</p>
          <div class="article-meta">
            <span class="article-source" itemprop="publisher">${this.escapeHtml(article.source)}</span>
            <time itemprop="datePublished" datetime="${article.pubDate}">${this.formatDate(article.pubDate)}</time>
          </div>
        </div>
      </article>
    `;
  }

  static renderFeaturedArticle(article) {
    return `
      <div class="featured-image-container">
        <img id="featuredImage" class="featured-image" src="${this.escapeHtml(article.image || '')}" alt="${this.escapeHtml(article.title)}" loading="lazy" itemprop="image">
        <span class="featured-badge">Öne Çıkan</span>
      </div>
      <div class="featured-content">
        <span class="article-category" id="featuredCategory" itemprop="articleSection">${this.escapeHtml(article.category)}</span>
        <h1 id="featuredTitle" itemprop="headline">${this.escapeHtml(article.title)}</h1>
        <p id="featuredDescription" itemprop="description">${this.escapeHtml(article.description)}</p>
        <div class="article-meta">
          <span class="article-source" id="featuredSource" itemprop="publisher">${this.escapeHtml(article.source)}</span>
          <time id="featuredDate" itemprop="datePublished" datetime="${article.pubDate}">${this.formatDate(article.pubDate)}</time>
        </div>
        <button class="btn btn-primary featured-read-more">Devamını Oku</button>
      </div>
    `;
  }

  static renderTrendItem(article, index) {
    return `
      <div class="trend-item" data-guid="${this.escapeHtml(article.guid)}">
        <div class="trend-item-rank">${index + 1}</div>
        <div class="trend-item-title">${this.escapeHtml(article.title)}</div>
      </div>
    `;
  }

  static renderComment(comment) {
    return `
      <div class="comment-item-full">
        <div class="comment-author-full">${this.escapeHtml(comment.name)}</div>
        <div class="comment-date">${this.formatDate(comment.timestamp)}</div>
        <div class="comment-text-full">${this.escapeHtml(comment.text)}</div>
      </div>
    `;
  }

  static escapeHtml(text) {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  static formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Şu anda';
    if (diffMins < 60) return `${diffMins} dakika önce`;
    if (diffHours < 24) return `${diffHours} saat önce`;
    if (diffDays < 7) return `${diffDays} gün önce`;

    return date.toLocaleDateString('tr-TR');
  }

  static showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
    }
  }

  static hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
    }
  }

  static setupEventListeners() {
    // Modal close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', e => {
        e.target.closest('.modal').classList.remove('active');
      });
    });

    // Modal background click
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', e => {
        if (e.target === modal) modal.classList.remove('active');
      });
    });
  }
}

export default UIManager;