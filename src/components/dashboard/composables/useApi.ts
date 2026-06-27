import { ref } from 'vue';

const BASE_URL = import.meta.env.PUBLIC_WORKER_URL || 'http://localhost:8787';
const TOKEN = import.meta.env.PUBLIC_ADMIN_TOKEN || 'change-me-in-production';

export function useApi() {
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    loading.value = true;
    error.value = null;
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...options.headers },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      }
      if (res.status === 204) return {} as T;
      return await res.json() as T;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Unknown error';
      throw e;
    } finally {
      loading.value = false;
    }
  }

  function get<T>(path: string) { return request<T>(path); }
  function post<T>(path: string, body: unknown) { return request<T>(path, { method: 'POST', body: JSON.stringify(body) }); }
  function put<T>(path: string, body: unknown) { return request<T>(path, { method: 'PUT', body: JSON.stringify(body) }); }
  function del<T>(path: string) { return request<T>(path, { method: 'DELETE' }); }

  return { loading, error, get, post, put, del };
}
