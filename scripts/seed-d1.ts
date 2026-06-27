import { readFileSync, readdirSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';

const CONTENT_DIR = join(import.meta.dirname, '../src/content');
const SQL_FILE = join(import.meta.dirname, '../worker/.seed.sql');

function esc(s: unknown): string {
  if (s === null || s === undefined) return "NULL";
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function readFrontmatter(dir: string): Array<{ id: string; data: Record<string, unknown>; body: string }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
    const raw = readFileSync(join(dir, f), 'utf-8');
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) return null;
    const data: Record<string, unknown> = {};
    match[1].split(/\r?\n/).forEach(line => {
      const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
      if (m) {
        let val: unknown = m[2].replace(/^['"]|['"]$/g, '');
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (/^\d{4}-\d{2}-\d{2}$/.test(val as string)) val = val;
        else if (/^\d+$/.test(val as string)) val = Number(val);
        data[m[1]] = val;
      }
    });
    return { id: basename(f, '.md'), data, body: match[2].trim() };
  }).filter((x): x is NonNullable<typeof x> => x !== null);
}

const stmts: string[] = [];

// Articles
const articles = readFrontmatter(join(CONTENT_DIR, 'articles'));
for (const { id, data: f, body } of articles) {
  const date = f.date instanceof Date ? f.date.toISOString().split('T')[0] : String(f.date);
  stmts.push(`INSERT OR IGNORE INTO articles (id,title,title_ar,date,author,category,thumbnail,featured,lang,excerpt,excerpt_ar,body,body_ar) VALUES (${esc(id)},${esc(f.title)},${esc(f.titleAr||f.title)},${esc(date)},${esc(f.author||'')},${esc(f.category||'hospital-news')},${esc(f.thumbnail||'')},${f.featured?1:0},${esc(f.lang||'ar')},NULL,NULL,${esc(body)},'');`);
}
console.log(`Articles: ${articles.length}`);

// Doctors
const doctors = readFrontmatter(join(CONTENT_DIR, 'doctors'));
for (const { id, data: f, body } of doctors) {
  stmts.push(`INSERT OR IGNORE INTO doctors (id,name,name_ar,specialty,specialty_ar,photo,bio,bio_ar,certified,featured,role,role_ar,sort_order) VALUES (${esc(id)},${esc(f.name)},${esc(f.nameAr||f.name)},${esc(f.specialty)},${esc(f.specialtyAr||f.specialty)},${esc(f.photo||'')},${esc(f.bio||body)},${esc(f.bioAr||'')},${f.certified?1:0},${f.featured?1:0},${esc(f.role||null)},${esc(f.roleAr||null)},${esc(f.order??null)});`);
}
console.log(`Doctors: ${doctors.length}`);

// Departments
const departments = readFrontmatter(join(CONTENT_DIR, 'departments'));
for (const { id, data: f } of departments) {
  stmts.push(`INSERT OR IGNORE INTO departments (id,name,name_ar,description,description_ar,icon,center_of_excellence,featured,image) VALUES (${esc(id)},${esc(f.name)},${esc(f.nameAr||f.name)},${esc(f.description)},${esc(f.descriptionAr||f.description)},${esc(f.icon||'building')},${f.centerOfExcellence?1:0},${f.featured?1:0},${esc(f.image||null)});`);
}
console.log(`Departments: ${departments.length}`);

// Achievements
const achievements = readFrontmatter(join(CONTENT_DIR, 'achievements'));
for (const { id, data: f } of achievements) {
  stmts.push(`INSERT OR IGNORE INTO achievements (id,year,title,title_ar,description,description_ar,icon) VALUES (${esc(id)},${f.year},${esc(f.title)},${esc(f.titleAr||f.title)},${esc(f.description)},${esc(f.descriptionAr||f.description)},${esc(f.icon||null)});`);
}
console.log(`Achievements: ${achievements.length}`);

// Awards
const awards = readFrontmatter(join(CONTENT_DIR, 'awards'));
for (const { id, data: f } of awards) {
  stmts.push(`INSERT OR IGNORE INTO awards (id,name,name_ar,body,body_ar,year,badge_image) VALUES (${esc(id)},${esc(f.name)},${esc(f.nameAr||f.name)},${esc(f.body||'')},${esc(f.bodyAr||null)},${f.year},${esc(f.badgeImage||null)});`);
}
console.log(`Awards: ${awards.length}`);

// Write SQL file and execute
writeFileSync(SQL_FILE, stmts.join('\n'), 'utf-8');
console.log(`\nWrote ${stmts.length} statements to ${SQL_FILE}`);

execSync(`npx wrangler d1 execute hospital-cms --local --file="${SQL_FILE.replace(/\\/g, '/')}"`, {
  stdio: 'inherit',
  cwd: join(import.meta.dirname, '../worker'),
});

unlinkSync(SQL_FILE);
console.log('Seed complete!');
