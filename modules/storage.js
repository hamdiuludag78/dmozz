// Storage Manager - IndexedDB & LocalStorage Management
export class StorageManager {
  static dbName = 'dmozzNewsDB';
  static dbVersion = 1;
  static db = null;

  static async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = event => {
        const db = event.target.result;

        // Articles Store
        if (!db.objectStoreNames.contains('articles')) {
          const articleStore = db.createObjectStore('articles', { keyPath: 'guid' });
          articleStore.createIndex('timestamp', 'timestamp', { unique: false });
          articleStore.createIndex('category', 'category', { unique: false });
          articleStore.createIndex('sourceId', 'sourceId', { unique: false });
          articleStore.createIndex('read', 'read', { unique: false });
        }

        // RSS Sources Store
        if (!db.objectStoreNames.contains('rssSources')) {
          db.createObjectStore('rssSources', { keyPath: 'id', autoIncrement: true });
        }

        // Comments Store
        if (!db.objectStoreNames.contains('comments')) {
          const commentStore = db.createObjectStore('comments', { keyPath: 'id', autoIncrement: true });
          commentStore.createIndex('articleId', 'articleId', { unique: false });
          commentStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Cache Store
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache', { keyPath: 'key' });
        }
      };
    });
  }

  // Article Methods
  static async saveArticles(articles) {
    const transaction = this.db.transaction(['articles'], 'readwrite');
    const store = transaction.objectStore('articles');

    return new Promise((resolve, reject) => {
      articles.forEach(article => {
        store.put({ ...article, read: false, saved: Date.now() });
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  static async getArticles(filters = {}) {
    const transaction = this.db.transaction(['articles'], 'readonly');
    const store = transaction.objectStore('articles');

    return new Promise((resolve, reject) => {
      let request;

      if (filters.category) {
        const index = store.index('category');
        request = index.getAll(filters.category);
      } else if (filters.sourceId) {
        const index = store.index('sourceId');
        request = index.getAll(filters.sourceId);
      } else {
        request = store.getAll();
      }

      request.onsuccess = () => {
        let articles = request.result;

        // Sort by date
        articles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

        // Apply limit
        if (filters.limit) {
          articles = articles.slice(0, filters.limit);
        }

        resolve(articles);
      };

      request.onerror = () => reject(request.error);
    });
  }

  static async getArticleById(guid) {
    const transaction = this.db.transaction(['articles'], 'readonly');
    const store = transaction.objectStore('articles');

    return new Promise((resolve, reject) => {
      const request = store.get(guid);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  static async markArticleAsRead(guid) {
    const article = await this.getArticleById(guid);
    if (article) {
      article.read = true;
      const transaction = this.db.transaction(['articles'], 'readwrite');
      const store = transaction.objectStore('articles');
      return new Promise((resolve, reject) => {
        const request = store.put(article);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
  }

  static async searchArticles(query) {
    const allArticles = await this.getArticles();
    const lowerQuery = query.toLowerCase();

    return allArticles.filter(article =>
      article.title.toLowerCase().includes(lowerQuery) ||
      article.description.toLowerCase().includes(lowerQuery) ||
      article.category.toLowerCase().includes(lowerQuery)
    );
  }

  // RSS Sources Methods
  static async saveSources(sources) {
    const transaction = this.db.transaction(['rssSources'], 'readwrite');
    const store = transaction.objectStore('rssSources');

    return new Promise((resolve, reject) => {
      sources.forEach(source => store.put(source));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  static async getSources() {
    const transaction = this.db.transaction(['rssSources'], 'readonly');
    const store = transaction.objectStore('rssSources');

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // LocalStorage Methods
  static setLocalData(key, value) {
    try {
      localStorage.setItem(`dmozz_${key}`, JSON.stringify(value));
    } catch (err) {
      console.warn('LocalStorage error:', err);
    }
  }

  static getLocalData(key) {
    try {
      const data = localStorage.getItem(`dmozz_${key}`);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      console.warn('LocalStorage error:', err);
      return null;
    }
  }

  static removeLocalData(key) {
    try {
      localStorage.removeItem(`dmozz_${key}`);
    } catch (err) {
      console.warn('LocalStorage error:', err);
    }
  }

  // Cache Methods
  static async setCache(key, value, ttl = 3600000) {
    const transaction = this.db.transaction(['cache'], 'readwrite');
    const store = transaction.objectStore('cache');

    return new Promise((resolve, reject) => {
      const request = store.put({
        key,
        value,
        expires: Date.now() + ttl
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  static async getCache(key) {
    const transaction = this.db.transaction(['cache'], 'readonly');
    const store = transaction.objectStore('cache');

    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => {
        const data = request.result;
        if (data && data.expires > Date.now()) {
          resolve(data.value);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }
}

export default StorageManager;