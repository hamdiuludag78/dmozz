#!/usr/bin/env node
/**
 * sitemap.xml'i Supabase'teki GÜNCEL verilerle (kategoriler + sorular)
 * otomatik olarak yeniden üretir.
 *
 * Bu script tek başına da çalıştırılabilir:
 *   node scripts/generate-sitemap.js
 *
 * Normalde .github/workflows/update-sitemap.yml içindeki GitHub Actions
 * görevi tarafından zamanlanmış olarak (örn. her 6 saatte bir) çalıştırılır
 * ve değişiklik varsa sonucu otomatik olarak repoya commit'ler.
 *
 * ÖNEMLİ: OUT_PATH sabiti, sitemap.xml dosyasının repodaki gerçek konumuna
 * göre ayarlanmalıdır. Bu projede forum uygulaması "forum/" klasöründe
 * yayınlandığı için varsayılan olarak "forum/sitemap.xml" kullanılıyor.
 * Farklı bir klasör yapınız varsa SADECE bu satırı güncelleyin.
 */
const fs = require('fs');
const path = require('path');

const SITE_ORIGIN = 'https://dmozz.eu.cc';
const SUPABASE_URL = 'https://qfilqgbtubvafcnpwtqj.supabase.co';
// tema.js içindeki ile AYNI "anon public" anahtar (sadece herkese açık
// select politikası olan tablolara okuma erişimi verir, güvenlidir).
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmaWxxZ2J0dWJ2YWZjbnB3dHFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MjI4NDMsImV4cCI6MjA5ODM5ODg0M30.F72EjHi1Sr3bJy_tiXpJl3MD5RZqbLPhblvhzzvUDIY';

const OUT_PATH = path.join(__dirname, '..', 'forum', 'sitemap.xml');

// tema.js'teki slugify ile BİREBİR aynı olmalı, aksi halde sitemap'teki
// adresler gerçek soru sayfası adresleriyle eşleşmez.
function slugify(text) {
  const map = { ç:'c','ğ':'g','ı':'i','ö':'o','ş':'s','ü':'u','Ç':'c','Ğ':'g','İ':'i','Ö':'o','Ş':'s','Ü':'u' };
  return (text || '').toString().toLowerCase()
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, m => map[m] || m)
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
}

function escapeXml(s) {
  return (s || '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function sb(query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  if (!res.ok) {
    throw new Error(`Supabase isteği başarısız oldu (${res.status}): ${query}`);
  }
  return res.json();
}

function urlEntry(loc, { changefreq, priority, lastmod } = {}) {
  return [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : null,
    priority ? `    <priority>${priority}</priority>` : null,
    '  </url>'
  ].filter(Boolean).join('\n');
}

async function main() {
  const [categories, questions] = await Promise.all([
    sb('categories?select=slug&order=slug.asc'),
    sb('questions?select=id,category,title,created_at&order=created_at.desc&limit=5000')
  ]);

  const urls = [];

  urls.push(urlEntry(`${SITE_ORIGIN}/forum/`, { changefreq: 'hourly', priority: '1.0' }));

  for (const c of categories) {
    urls.push(urlEntry(
      `${SITE_ORIGIN}/forum/?category=${encodeURIComponent(c.slug)}`,
      { changefreq: 'daily', priority: '0.7' }
    ));
  }

  for (const q of questions) {
    const cat = q.category || 'genel';
    const slug = slugify(q.title) || 'soru';
    const lastmod = (q.created_at || '').slice(0, 10) || undefined;
    urls.push(urlEntry(
      `${SITE_ORIGIN}/forum/?s=${q.id}/${encodeURIComponent(cat)}/${slug}.html`,
      { changefreq: 'weekly', priority: '0.6', lastmod }
    ));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, xml, 'utf8');
  console.log(`sitemap.xml güncellendi -> ${OUT_PATH}`);
  console.log(`${categories.length} kategori, ${questions.length} soru işlendi.`);
}

main().catch(err => {
  console.error('[sitemap] Hata:', err);
  process.exit(1);
});
