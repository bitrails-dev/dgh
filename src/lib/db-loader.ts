import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../../data/hospital.db');

function getDb() {
  return new Database(DB_PATH, { readonly: true });
}

export interface Article {
  id: string; title: string; title_ar: string; date: string; author: string;
  category: string; thumbnail: string; featured: number; lang: string;
  excerpt: string | null; excerpt_ar: string | null; body: string; body_ar: string;
}

export interface Doctor {
  id: string; name: string; name_ar: string; specialty: string; specialty_ar: string;
  photo: string; bio: string; bio_ar: string; certified: number; featured: number;
  role: string | null; role_ar: string | null; sort_order: number | null;
}

export interface Department {
  id: string; name: string; name_ar: string; description: string; description_ar: string;
  icon: string; center_of_excellence: number; featured: number; image: string | null;
}

export interface Achievement {
  id: string; year: number; title: string; title_ar: string;
  description: string; description_ar: string; icon: string | null;
}

export interface Award {
  id: string; name: string; name_ar: string; body: string;
  body_ar: string | null; year: number; badge_image: string | null;
}

export interface NewsItem {
  id: string; title: string; title_ar: string; date: string; category: string;
  thumbnail: string; excerpt: string; excerpt_ar: string; featured: number;
  author: string | null; body: string; body_ar: string;
}

export function getArticles(): Article[] {
  const db = getDb();
  try { return db.prepare('SELECT * FROM articles ORDER BY date DESC').all() as Article[]; }
  finally { db.close(); }
}

export function getArticleById(id: string): Article | undefined {
  const db = getDb();
  try { return db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as Article | undefined; }
  finally { db.close(); }
}

export function getDoctors(): Doctor[] {
  const db = getDb();
  try { return db.prepare('SELECT * FROM doctors ORDER BY sort_order ASC, name ASC').all() as Doctor[]; }
  finally { db.close(); }
}

export function getDepartments(): Department[] {
  const db = getDb();
  try { return db.prepare('SELECT * FROM departments ORDER BY name ASC').all() as Department[]; }
  finally { db.close(); }
}

export function getAchievements(): Achievement[] {
  const db = getDb();
  try { return db.prepare('SELECT * FROM achievements ORDER BY year DESC').all() as Achievement[]; }
  finally { db.close(); }
}

export function getAwards(): Award[] {
  const db = getDb();
  try { return db.prepare('SELECT * FROM awards ORDER BY year DESC').all() as Award[]; }
  finally { db.close(); }
}

export function getNews(): NewsItem[] {
  const db = getDb();
  try { return db.prepare('SELECT * FROM news ORDER BY date DESC').all() as NewsItem[]; }
  finally { db.close(); }
}
