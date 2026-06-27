import { Router } from './router';
import { authenticate, type Env } from './middleware/auth';
import { listArticles, getArticle, createArticle, updateArticle, deleteArticle } from './handlers/articles';
import { listDoctors, getDoctor, createDoctor, updateDoctor, deleteDoctor } from './handlers/doctors';
import { listDepartments, getDepartment, createDepartment, updateDepartment, deleteDepartment } from './handlers/departments';
import { listAchievements, getAchievement, createAchievement, updateAchievement, deleteAchievement } from './handlers/achievements';
import { listAwards, getAward, createAward, updateAward, deleteAward } from './handlers/awards';
import { listNews, getNewsItem, createNewsItem, updateNewsItem, deleteNewsItem } from './handlers/news';
import { exportDatabase, importDatabase, publishToGit } from './handlers/sync';

const router = new Router();

// Health check (no auth)
router.get('/api/health', async () => {
  return new Response(JSON.stringify({ status: 'ok' }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

// Articles
router.get('/api/articles', listArticles);
router.get('/api/articles/:id', getArticle);
router.post('/api/articles', createArticle);
router.put('/api/articles/:id', updateArticle);
router.delete('/api/articles/:id', deleteArticle);

// Doctors
router.get('/api/doctors', listDoctors);
router.get('/api/doctors/:id', getDoctor);
router.post('/api/doctors', createDoctor);
router.put('/api/doctors/:id', updateDoctor);
router.delete('/api/doctors/:id', deleteDoctor);

// Departments
router.get('/api/departments', listDepartments);
router.get('/api/departments/:id', getDepartment);
router.post('/api/departments', createDepartment);
router.put('/api/departments/:id', updateDepartment);
router.delete('/api/departments/:id', deleteDepartment);

// Achievements
router.get('/api/achievements', listAchievements);
router.get('/api/achievements/:id', getAchievement);
router.post('/api/achievements', createAchievement);
router.put('/api/achievements/:id', updateAchievement);
router.delete('/api/achievements/:id', deleteAchievement);

// Awards
router.get('/api/awards', listAwards);
router.get('/api/awards/:id', getAward);
router.post('/api/awards', createAward);
router.put('/api/awards/:id', updateAward);
router.delete('/api/awards/:id', deleteAward);

// News
router.get('/api/news', listNews);
router.get('/api/news/:id', getNewsItem);
router.post('/api/news', createNewsItem);
router.put('/api/news/:id', updateNewsItem);
router.delete('/api/news/:id', deleteNewsItem);

// Sync
router.get('/api/sync/export', exportDatabase);
router.post('/api/sync/import', importDatabase);
router.post('/api/sync/publish', publishToGit);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/health') {
      const authError = authenticate(request, env);
      if (authError) return authError;
    }

    const response = await router.handle(request, env);
    response.headers.set('Access-Control-Allow-Origin', '*');
    return response;
  },
} satisfies ExportedHandler<Env>;
