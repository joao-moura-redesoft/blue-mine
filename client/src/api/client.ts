import axios, { type AxiosInstance } from 'axios';

// Cliente axios com baseURL /api configurado para enviar cookies HttpOnly
export function createAuthedClient(): AxiosInstance {
  const api = axios.create({
    baseURL: '/api',
    withCredentials: true,
  });

  api.interceptors.response.use(
    (res) => res,
    (err) => {
      if (err.response?.status === 401) {
        window.dispatchEvent(new Event('auth-expired'));
      }
      return Promise.reject(err);
    },
  );

  return api;
}
