import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authAPI = {
  register: (email, password) =>
    api.post('/auth/register', { email, password }),

  login: (email, password) => {
    const formData = new FormData();
    formData.append('username', email);
    formData.append('password', password);
    return api.post('/auth/login', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },

  getCurrentUser: () => api.get('/auth/me'),
};

export const accountsAPI = {
  getAll: () => api.get('/accounts'),
  getById: (id) => api.get(`/accounts/${id}`),
  create: (data) => api.post('/accounts', data),
  update: (id, data) => api.put(`/accounts/${id}`, data),
  delete: (id) => api.delete(`/accounts/${id}`),
};

export const positionsAPI = {
  getAll: (accountId) =>
    api.get('/positions', { params: accountId ? { account_id: accountId } : {} }),
  getAggregated: (accountId, asOfDate) =>
    api.get('/positions/aggregated', {
      params: {
        ...(accountId ? { account_id: accountId } : {}),
        ...(asOfDate ? { as_of_date: asOfDate } : {})
      }
    }),
  getSummary: () => api.get('/positions/summary'),
  create: (data) => api.post('/positions', data),
  update: (id, data) => api.put(`/positions/${id}`, data),
  delete: (id) => api.delete(`/positions/${id}`),
  refreshPrices: () => api.post('/positions/refresh-prices'),
};

export const dividendsAPI = {
  getAll: (accountId, ticker) =>
    api.get('/dividends', { params: { account_id: accountId, ticker } }),
  getSummary: (accountId) =>
    api.get('/dividends/summary', { params: accountId ? { account_id: accountId } : {} }),
  create: (data) => api.post('/dividends', data),
  delete: (id) => api.delete(`/dividends/${id}`),
};

export const expensesAPI = {
  getAll: (accountId, category) =>
    api.get('/expenses', { params: { account_id: accountId, category } }),
  getSummary: (accountId) =>
    api.get('/expenses/summary', { params: accountId ? { account_id: accountId } : {} }),
  create: (data) => api.post('/expenses', data),
  update: (id, data) => api.put(`/expenses/${id}`, data),
  delete: (id) => api.delete(`/expenses/${id}`),
  getCategories: () => api.get('/expenses/categories'),
  createCategory: (data) => api.post('/expenses/categories', data),
};

export const importAPI = {
  uploadStatement: (file, accountId) => {
    const formData = new FormData();
    formData.append('file', file);
    if (accountId) {
      formData.append('account_id', accountId);
    }
    return api.post('/import/statement', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  getStatements: () => api.get('/import/statements'),
  processStatement: (statementId) => api.post(`/import/statements/${statementId}/process`),
  reprocessStatement: (statementId) => api.post(`/import/statements/${statementId}/reprocess`),
  reprocessAllStatements: (accountId) =>
    api.post('/import/statements/reprocess-all', accountId ? { account_id: accountId } : {}),
  deleteStatement: (statementId) => api.delete(`/import/statements/${statementId}`),
};

export const transactionsAPI = {
  getAll: (accountId, startDate, endDate) =>
    api.get('/transactions', {
      params: {
        account_id: accountId,
        start_date: startDate,
        end_date: endDate
      }
    }),
  getBalance: (accountId, asOfDate) =>
    api.get('/transactions/balance', {
      params: {
        account_id: accountId,
        as_of_date: asOfDate
      }
    }),
  create: (data) => api.post('/transactions', data),
  delete: (id) => api.delete(`/transactions/${id}`),
};

export default api;
