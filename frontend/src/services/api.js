import axios from 'axios';

const isLocalHostname = (hostname) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

const normalizePath = (path) => {
  if (!path) {
    return '';
  }

  if (path === '/') {
    return '';
  }

  return path.startsWith('/') ? path : `/${path}`;
};

const buildUrl = (origin, path) => {
  const normalizedOrigin = origin.replace(/\/$/, '');
  const normalizedPath = normalizePath(path);
  return `${normalizedOrigin}${normalizedPath}`;
};

const API_BASE_URL = (() => {
  const envUrl = import.meta.env.VITE_API_URL?.trim();
  const localPort = import.meta.env.VITE_API_PORT?.trim() || '8000';
  const apiPath = normalizePath(import.meta.env.VITE_API_BASE_PATH?.trim() || '/api');

  const getEnvBase = (originFallback) => {
    if (!envUrl) {
      return null;
    }

    if (envUrl.startsWith('/')) {
      if (!originFallback) {
        return envUrl;
      }
      return buildUrl(originFallback, envUrl);
    }

    try {
      const parsed = new URL(envUrl, originFallback || `http://localhost:${localPort}`);
      const path = normalizePath(parsed.pathname) || apiPath;
      return buildUrl(parsed.origin, path);
    } catch {
      return envUrl;
    }
  };

  if (typeof window === 'undefined') {
    return getEnvBase() || buildUrl(`http://localhost:${localPort}`, apiPath);
  }

  const { origin, hostname } = window.location;

  if (isLocalHostname(hostname)) {
    return buildUrl(origin, apiPath);
  }

  return getEnvBase(origin) || buildUrl(origin, apiPath);
})();

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

  // 2FA Methods
  setup2FA: () => api.post('/auth/2fa/setup'),
  enable2FA: (code) => api.post('/auth/2fa/enable', { code }),
  verify2FA: (code, tempToken) => api.post(`/auth/2fa/verify?temp_token=${tempToken}`, { code }),
  disable2FA: (password, code) => api.post('/auth/2fa/disable', { password, code }),
  get2FAStatus: () => api.get('/auth/2fa/status'),
};

export const accountsAPI = {
  getAll: () => api.get('/accounts'),
  getById: (id) => api.get(`/accounts/${id}`),
  create: (data) => api.post('/accounts', data),
  update: (id, data) => api.put(`/accounts/${id}`, data),
  delete: (id) => api.delete(`/accounts/${id}`),
  getAccountPlaidItem: (id) => api.get(`/accounts/${id}/plaid-item`),
  deletePlaidTransactions: (id) => api.delete(`/accounts/${id}/plaid-transactions`),
};

export const positionsAPI = {
  getAll: (accountId) =>
    api.get('/positions', { params: accountId ? { account_id: accountId } : {} }),
  getAggregated: (accountId, asOfDate, options = {}) =>
    api.get('/positions/aggregated', {
      params: {
        ...(accountId ? { account_id: accountId } : {}),
        ...(asOfDate ? { as_of_date: asOfDate } : {}),
        ...(options.instrument_type_id ? { instrument_type_id: options.instrument_type_id } : {}),
        ...(options.instrument_industry_id ? { instrument_industry_id: options.instrument_industry_id } : {})
      }
    }),
  getSummary: (asOfDate, options = {}) =>
    api.get('/positions/summary', {
      params: {
        ...(options.account_id ? { account_id: options.account_id } : {}),
        ...(asOfDate ? { as_of_date: asOfDate } : {}),
        ...(options.instrument_type_id ? { instrument_type_id: options.instrument_type_id } : {}),
        ...(options.instrument_industry_id ? { instrument_industry_id: options.instrument_industry_id } : {})
      }
    }),
  create: (data) => api.post('/positions', data),
  update: (id, data) => api.put(`/positions/${id}`, data),
  delete: (id) => api.delete(`/positions/${id}`),
  refreshPrices: () => api.post('/positions/refresh-prices'),
  getIndustryBreakdown: (params = {}) =>
    api.get('/positions/industry-breakdown', {
      params: {
        ...(params.account_id ? { account_id: params.account_id } : {}),
        ...(params.as_of_date ? { as_of_date: params.as_of_date } : {}),
        ...(params.instrument_type_id ? { instrument_type_id: params.instrument_type_id } : {}),
        ...(params.instrument_industry_id ? { instrument_industry_id: params.instrument_industry_id } : {})
      }
    }),
  getTypeBreakdown: (params = {}) =>
    api.get('/positions/type-breakdown', {
      params: {
        ...(params.account_id ? { account_id: params.account_id } : {}),
        ...(params.as_of_date ? { as_of_date: params.as_of_date } : {}),
        ...(params.instrument_type_id ? { instrument_type_id: params.instrument_type_id } : {}),
        ...(params.instrument_industry_id ? { instrument_industry_id: params.instrument_industry_id } : {})
      }
    }),
  getSectorBreakdown: (params = {}) =>
    api.get('/positions/sector-breakdown', {
      params: {
        ...(params.account_id ? { account_id: params.account_id } : {}),
        ...(params.as_of_date ? { as_of_date: params.as_of_date } : {}),
        ...(params.instrument_type_id ? { instrument_type_id: params.instrument_type_id } : {}),
        ...(params.instrument_industry_id ? { instrument_industry_id: params.instrument_industry_id } : {})
      }
    }),
  getSubtypeBreakdown: (params = {}) =>
    api.get('/positions/subtype-breakdown', {
      params: {
        ...(params.account_id ? { account_id: params.account_id } : {}),
        ...(params.as_of_date ? { as_of_date: params.as_of_date } : {}),
        ...(params.instrument_type_id ? { instrument_type_id: params.instrument_type_id } : {}),
        ...(params.instrument_industry_id ? { instrument_industry_id: params.instrument_industry_id } : {})
      }
    }),
  getSnapshotDates: (accountId = null) =>
    api.get('/positions/snapshots/dates', {
      params: {
        ...(accountId && { account_id: accountId })
      }
    }),
  getBySnapshotDate: (snapshotDate, accountId = null) =>
    api.get('/positions/snapshots/by-date', {
      params: {
        snapshot_date: snapshotDate,
        ...(accountId && { account_id: accountId })
      }
    })
};

export const dashboardAPI = {
  getLayout: (profile = 'desktop') =>
    api.get('/dashboard/layout', { params: { profile } }),
  saveLayout: (profile, layout) =>
    api.put('/dashboard/layout', { profile, layout }),
  resetLayout: (profile) =>
    api.delete('/dashboard/layout', { params: profile ? { profile } : {} })
};

export const dividendsAPI = {
  getAll: (accountId, ticker, startDate, endDate, instrumentTypeId, instrumentIndustryId) =>
    api.get('/dividends', {
      params: {
        ...(accountId ? { account_id: accountId } : {}),
        ...(ticker ? { ticker } : {}),
        ...(startDate ? { start_date: startDate } : {}),
        ...(endDate ? { end_date: endDate } : {}),
        ...(instrumentTypeId ? { instrument_type_id: instrumentTypeId } : {}),
        ...(instrumentIndustryId ? { instrument_industry_id: instrumentIndustryId } : {})
      }
    }),
  getSummary: (accountId, startDate, endDate, instrumentTypeId, instrumentIndustryId) =>
    api.get('/dividends/summary', {
      params: {
        ...(accountId ? { account_id: accountId } : {}),
        ...(startDate ? { start_date: startDate } : {}),
        ...(endDate ? { end_date: endDate } : {}),
        ...(instrumentTypeId ? { instrument_type_id: instrumentTypeId } : {}),
        ...(instrumentIndustryId ? { instrument_industry_id: instrumentIndustryId } : {})
      }
    }),
  create: (data) => api.post('/dividends', data),
  delete: (id) => api.delete(`/dividends/${id}`),
};

export const expensesAPI = {
  getAll: (accountId, category, startDate, endDate) =>
    api.get('/cashflow', {
      params: {
        ...(accountId ? { account_id: accountId } : {}),
        ...(category ? { category } : {}),
        ...(startDate ? { start_date: startDate } : {}),
        ...(endDate ? { end_date: endDate } : {})
      }
    }),
  getSummary: (accountId) =>
    api.get('/cashflow/summary', { params: accountId ? { account_id: accountId } : {} }),
  getMonthlyComparison: (months = 6, accountId = null) =>
    api.get('/cashflow/monthly-comparison', {
      params: {
        months,
        ...(accountId ? { account_id: accountId } : {})
      }
    }),
  create: (data) => api.post('/cashflow', data),
  update: (id, data) => api.put(`/cashflow/${id}`, data),
  updateExpenseCategory: (id, category) => api.patch(`/cashflow/${id}/category`, null, { params: { category } }),
  delete: (id) => api.delete(`/cashflow/${id}`),
  getCategories: () => api.get('/cashflow/categories'),
  createCategory: (data) => api.post('/cashflow/categories', data),
  updateCategory: (id, data) => api.put(`/cashflow/categories/${id}`, data),
  deleteCategory: (id) => api.delete(`/cashflow/categories/${id}`),
  initDefaultCategories: (forceRefresh = false) => api.post('/cashflow/categories/init-defaults', null, {
    params: { force_refresh: forceRefresh }
  }),
  convertTransactions: (accountId = null) =>
    api.post('/cashflow/convert-transactions', null, {
      params: accountId ? { account_id: accountId } : {}
    }),
  getConversionJobStatus: (jobId) =>
    api.get(`/cashflow/convert-transactions/jobs/${jobId}`),
  recategorize: () =>
    api.post('/cashflow/recategorize'),
  getRecategorizeJobStatus: (jobId) =>
    api.get(`/cashflow/recategorize/jobs/${jobId}`),
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
  changeStatementAccount: (statementId, accountId) =>
    api.put(`/import/statements/${statementId}/account`, { account_id: accountId }),
  getJobStatus: (jobId) => api.get(`/import/jobs/${jobId}`),
};

export const instrumentsAPI = {
  getTypes: () => api.get('/instruments/types'),
  createType: (data) => api.post('/instruments/types', data),
  updateType: (id, data) => api.put(`/instruments/types/${id}`, data),
  deleteType: (id) => api.delete(`/instruments/types/${id}`),
  getIndustries: () => api.get('/instruments/industries'),
  createIndustry: (data) => api.post('/instruments/industries', data),
  updateIndustry: (id, data) => api.put(`/instruments/industries/${id}`, data),
  deleteIndustry: (id) => api.delete(`/instruments/industries/${id}`),
  listClassifications: () => api.get('/instruments/classifications'),
  updateClassification: (ticker, data) =>
    api.put(`/instruments/classifications/${encodeURIComponent(ticker)}`, data),
  deleteClassification: (ticker) => api.delete(`/instruments/classifications/${encodeURIComponent(ticker)}`)
};

export const transactionsAPI = {
  getAll: (accountId, startDate, endDate, includeBalance = false) =>
    api.get('/transactions', {
      params: {
        account_id: accountId,
        start_date: startDate,
        end_date: endDate,
        include_balance: includeBalance
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
  fixBalance: (id, data) => api.patch(`/transactions/${id}/fix-balance`, data),
};

export const securityMetadataAPI = {
  // Security Types
  getTypes: () => api.get('/security-metadata/types'),
  createType: (data) => api.post('/security-metadata/types', data),
  updateType: (id, data) => api.put(`/security-metadata/types/${id}`, data),
  deleteType: (id) => api.delete(`/security-metadata/types/${id}`),

  // Security Subtypes
  getSubtypes: () => api.get('/security-metadata/subtypes'),
  createSubtype: (data) => api.post('/security-metadata/subtypes', data),
  updateSubtype: (id, data) => api.put(`/security-metadata/subtypes/${id}`, data),
  deleteSubtype: (id) => api.delete(`/security-metadata/subtypes/${id}`),

  // Sectors
  getSectors: () => api.get('/security-metadata/sectors'),
  createSector: (data) => api.post('/security-metadata/sectors', data),
  updateSector: (id, data) => api.put(`/security-metadata/sectors/${id}`, data),
  deleteSector: (id) => api.delete(`/security-metadata/sectors/${id}`),

  // Industries
  getIndustries: () => api.get('/security-metadata/industries'),
  createIndustry: (data) => api.post('/security-metadata/industries', data),
  updateIndustry: (id, data) => api.put(`/security-metadata/industries/${id}`, data),
  deleteIndustry: (id) => api.delete(`/security-metadata/industries/${id}`),

  // Overrides
  setOverride: (data) => api.post('/security-metadata/overrides', data),
  getOverride: (ticker, securityName) => api.get(`/security-metadata/overrides/${encodeURIComponent(ticker)}/${encodeURIComponent(securityName)}`),
};

export const plaidAPI = {
  createLinkToken: () => api.post('/plaid/create-link-token'),
  createUpdateLinkToken: (itemId) => api.post(`/plaid/update-link-token/${itemId}`),
  exchangeToken: (publicToken, metadata) =>
    api.post('/plaid/exchange-token', { public_token: publicToken, metadata }),
  getItems: () => api.get('/plaid/items'),
  syncTransactions: (itemId) => api.post(`/plaid/sync/${itemId}`),
  fullResync: (itemId) => api.post(`/plaid/full-resync/${itemId}`),
  replaySync: (itemId) => api.post(`/plaid/replay-sync/${itemId}`),
  getSyncStatus: (jobId) => api.get(`/plaid/sync-status/${jobId}`),
  disconnectItem: (itemId) => api.delete(`/plaid/disconnect/${itemId}`),
};

// Export convenience methods for PlaidLink component
export const createPlaidLinkToken = () => plaidAPI.createLinkToken();
export const exchangePlaidToken = (publicToken, metadata) =>
  plaidAPI.exchangeToken(publicToken, metadata);

export default api;
