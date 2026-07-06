// Service Worker Cron - Periodical RSS Feed Update
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'UPDATE_FEEDS') {
    updateFeeds();
  }
});

self.addEventListener('periodicsync', event => {
  if (event.tag === 'update-feeds') {
    event.waitUntil(updateFeeds());
  }
});

async function updateFeeds() {
  try {
    // Get RSS sources from IndexedDB
    const db = await getDatabase();
    const sources = await getAllSources(db);
    
    // Fetch and parse feeds
    for (const source of sources) {
      try {
        const feed = await fetchAndParseFeed(source.url);
        await saveFeedData(db, source.id, feed);
      } catch (err) {
        console.warn(`Failed to update feed: ${source.url}`, err);
      }
    }

    // Send notification to client
    const newCount = await getNewArticlesCount(db);
    if (newCount > 0) {
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'FEEDS_UPDATED',
            newCount: newCount
          });
        });
      });
    }
  } catch (err) {
    console.error('Feed update error:', err);
  }
}

async function getDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('dmozzNewsDB', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllSources(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['rssSources'], 'readonly');
    const store = transaction.objectStore('rssSources');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function fetchAndParseFeed(url) {
  const response = await fetch(url);
  const text = await response.text();
  
  // Parse XML/RSS
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(text, 'application/xml');
  
  const items = xmlDoc.querySelectorAll('item, entry');
  const articles = Array.from(items).map(item => {
    const isAtom = item.tagName === 'entry';
    return {
      title: getTextContent(item, isAtom ? 'title' : 'title'),
      link: isAtom ? item.querySelector('link')?.getAttribute('href') : getTextContent(item, 'link'),
      description: getTextContent(item, isAtom ? 'summary' : 'description'),
      pubDate: isAtom ? getTextContent(item, 'published') : getTextContent(item, 'pubDate'),
      image: extractImage(item),
      author: getTextContent(item, 'creator'),
      category: getTextContent(item, 'category'),
      guid: isAtom ? getTextContent(item, 'id') : getTextContent(item, 'guid'),
      timestamp: Date.now()
    };
  });

  return articles;
}

function getTextContent(element, selector) {
  const el = element.querySelector(selector);
  return el ? el.textContent.trim() : '';
}

function extractImage(item) {
  const mediaContent = item.querySelector('media\\:content, media\\:thumbnail');
  if (mediaContent) return mediaContent.getAttribute('url');
  
  const enclosure = item.querySelector('enclosure[type^="image"]');
  if (enclosure) return enclosure.getAttribute('url');
  
  const description = item.querySelector('description, summary');
  if (description) {
    const match = description.textContent.match(/<img[^>]+src="([^"]+)"/i);
    if (match) return match[1];
  }
  
  return null;
}

async function saveFeedData(db, sourceId, articles) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['articles'], 'readwrite');
    const store = transaction.objectStore('articles');
    
    articles.forEach(article => {
      store.put({
        ...article,
        sourceId: sourceId,
        read: false
      });
    });
    
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getNewArticlesCount(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['articles'], 'readonly');
    const store = transaction.objectStore('articles');
    const index = store.index('read');
    const request = index.count(false);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}