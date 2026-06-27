import Database from 'better-sqlite3';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../data/hospital.db');
const CONTENT_DIR = join(__dirname, '../src/content');
const SCHEMA_PATH = join(__dirname, '../worker/src/db/schema.sql');

const schema = readFileSync(SCHEMA_PATH, 'utf-8')
  .split('\n').filter(line => !line.includes('fts5') && !line.includes('_fts')).join('\n');

const dataDir = dirname(DB_PATH);
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.exec(schema);

function readMarkdownFiles(collection: string): Array<{ id: string; frontmatter: Record<string, unknown>; body: string }> {
  const dir = join(CONTENT_DIR, collection);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
    const raw = readFileSync(join(dir, f), 'utf-8');
    const { data, content } = matter(raw);
    return { id: basename(f, '.md'), frontmatter: data, body: content.trim() };
  });
}

// Migrate articles
const articles = readMarkdownFiles('articles');
const insertArticle = db.prepare(`INSERT INTO articles (id, title, title_ar, date, author, category, thumbnail, featured, lang, excerpt, excerpt_ar, body, body_ar) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
for (const { id, frontmatter: f, body } of articles) {
  const date = f.date instanceof Date ? f.date.toISOString().split('T')[0] : String(f.date);
  insertArticle.run(id, f.title, f.titleAr || f.title, date, f.author || '', f.category || 'hospital-news', f.thumbnail || '', f.featured ? 1 : 0, f.lang || 'ar', f.excerpt || null, f.excerptAr || null, body, '');
}

// Migrate doctors
const doctors = readMarkdownFiles('doctors');
const insertDoctor = db.prepare(`INSERT INTO doctors (id, name, name_ar, specialty, specialty_ar, photo, bio, bio_ar, certified, featured, role, role_ar, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
for (const { id, frontmatter: f, body } of doctors) {
  insertDoctor.run(id, f.name, f.nameAr || f.name, f.specialty, f.specialtyAr || f.specialty, f.photo || '', f.bio || body, f.bioAr || '', f.certified ? 1 : 0, f.featured ? 1 : 0, f.role || null, f.roleAr || null, f.order ?? null);
}

// Migrate departments
const departments = readMarkdownFiles('departments');
const insertDept = db.prepare(`INSERT INTO departments (id, name, name_ar, description, description_ar, icon, center_of_excellence, featured, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
for (const { id, frontmatter: f } of departments) {
  insertDept.run(id, f.name, f.nameAr || f.name, f.description, f.descriptionAr || f.description, f.icon || 'building', f.centerOfExcellence ? 1 : 0, f.featured ? 1 : 0, f.image || null);
}

// Migrate achievements
const achievements = readMarkdownFiles('achievements');
const insertAch = db.prepare(`INSERT INTO achievements (id, year, title, title_ar, description, description_ar, icon) VALUES (?, ?, ?, ?, ?, ?, ?)`);
for (const { id, frontmatter: f } of achievements) {
  insertAch.run(id, f.year, f.title, f.titleAr || f.title, f.description, f.descriptionAr || f.description, f.icon || null);
}

// Migrate awards
const awards = readMarkdownFiles('awards');
const insertAward = db.prepare(`INSERT INTO awards (id, name, name_ar, body, body_ar, year, badge_image) VALUES (?, ?, ?, ?, ?, ?, ?)`);
for (const { id, frontmatter: f } of awards) {
  insertAward.run(id, f.name, f.nameAr || f.name, f.body || '', f.bodyAr || null, f.year, f.badgeImage || null);
}

// Migrate news (if collection exists)
const newsItems = readMarkdownFiles('news');
if (newsItems.length) {
  const insertNews = db.prepare(`INSERT INTO news (id, title, title_ar, date, category, thumbnail, excerpt, excerpt_ar, featured, author, body, body_ar) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const { id, frontmatter: f, body } of newsItems) {
    const date = f.date instanceof Date ? f.date.toISOString().split('T')[0] : String(f.date);
    insertNews.run(id, f.title, f.titleAr || f.title, date, f.category || 'hospital-news', f.thumbnail || '', f.excerpt || '', f.excerptAr || '', f.featured ? 1 : 0, f.author || null, body, '');
  }
}

db.close();
console.log('Migration complete!');
console.log(`  Articles: ${articles.length}`);
console.log(`  Doctors: ${doctors.length}`);
console.log(`  Departments: ${departments.length}`);
console.log(`  Achievements: ${achievements.length}`);
console.log(`  Awards: ${awards.length}`);
console.log(`  News: ${newsItems.length}`);
console.log(`\nDatabase: ${DB_PATH}`);
