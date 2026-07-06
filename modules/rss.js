// RSS Feed Manager - Handle RSS Parsing and Updates
export class RSSFeedManager {
  static sources = [];
  static articles = [];
  static updateInterval = 600000; // 10 minutes

  static async init(sources) {
    this.sources = sources;
    await this.fetchAllFeeds();
    this.startAutoUpdate();
  }

  static async fetchAllFeeds() {
    const promises = this.sources.map(source => this.fetchFeed(source));
    const results = await Promise.allSettled(promises);
    
    this.articles = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);
    
    return this.articles;
  }

  static async fetchFeed(source) {
    try {
      const response = await fetch(source.url, {
        method: 'GET',
        headers: {
          'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml'
        }
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const text = await response.text();
      return this.parseFeed(text, source);
    } catch (err) {
      console.warn(`Failed to fetch ${source.url}:`, err);
      return [];
    }
  }

  static parseFeed(text, source) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, 'application/xml');

      // Check for parsing errors
      if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
        throw new Error('XML parsing error');
      }

      const items = xmlDoc.querySelectorAll('item, entry');
      const articles = [];

      items.forEach((item, index) => {
        if (index >= 50) return; // Limit 50 items per feed

        const isAtom = item.tagName === 'entry';
        const article = {
          guid: this.extractGuid(item, isAtom),
          title: this.extractText(item, isAtom ? 'title' : 'title'),
          link: this.extractLink(item, isAtom),
          description: this.extractText(item, isAtom ? 'summary' : 'description'),
          content: this.extractText(item, isAtom ? 'content' : 'content:encoded'),
          pubDate: this.extractDate(item, isAtom),
          image: this.extractImage(item),
          author: this.extractText(item, isAtom ? 'author' : 'creator'),
          category: source.category || 'dünya',
          source: source.name,
          sourceId: source.id,
          sourceUrl: source.siteUrl,
          timestamp: Date.now(),
          read: false
        };

        if (article.title && article.link) {
          articles.push(article);
        }
      });

      return articles;
    } catch (err) {
      console.error(`Feed parsing error for ${source.url}:`, err);
      return [];
    }
  }

  static extractGuid(item, isAtom) {
    const guid = item.querySelector('guid, id');
    return guid ? guid.textContent : item.querySelector('link').href || Math.random().toString();
  }

  static extractText(element, selector) {
    const el = element.querySelector(selector);
    return el ? el.textContent.trim() : '';
  }

  static extractLink(item, isAtom) {
    if (isAtom) {
      const link = item.querySelector('link[rel="alternate"]');
      return link ? link.getAttribute('href') : item.querySelector('link')?.getAttribute('href') || '';
    }
    return this.extractText(item, 'link');
  }

  static extractDate(item, isAtom) {
    const dateEl = item.querySelector(isAtom ? 'published' : 'pubDate');
    if (dateEl) {
      return new Date(dateEl.textContent).toISOString();
    }
    return new Date().toISOString();
  }

  static extractImage(item) {
    // Try media:content
    const mediaContent = item.querySelector('media\\:content, [type="image"]');
    if (mediaContent) return mediaContent.getAttribute('url') || mediaContent.getAttribute('src');

    // Try enclosure
    const enclosure = item.querySelector('enclosure[type^="image"]');
    if (enclosure) return enclosure.getAttribute('url');

    // Try image tag
    const imageTag = item.querySelector('image url');
    if (imageTag) return imageTag.textContent;

    // Try to extract from description
    const description = item.querySelector('description, summary');
    if (description) {
      const match = description.textContent.match(/<img[^>]+src="?([^\s>"]+)"?/i);
      if (match) return match[1];
    }

    return null;
  }

  static startAutoUpdate() {
    setInterval(() => this.fetchAllFeeds(), this.updateInterval);
  }

  static getArticlesByCategory(category) {
    return this.articles.filter(a => a.category.toLowerCase() === category.toLowerCase());
  }

  static getTrendingArticles(limit = 10) {
    return this.articles
      .slice(0, limit)
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  }

  static getLatestArticles(limit = 20) {
    return this.articles
      .slice(0, limit)
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  }
}

export default RSSFeedManager;