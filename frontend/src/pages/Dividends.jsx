import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Container,
  Paper,
  Typography,
  Grid,
  Box,
  Stack,
  Button,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  LinearProgress
} from '@mui/material';
import { dividendsAPI, accountsAPI } from '../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const PIE_COLORS = [
  '#0088FE',
  '#00C49F',
  '#FFBB28',
  '#FF8042',
  '#8884D8',
  '#82CA9D',
  '#A569BD',
  '#C39BD3',
  '#5499C7',
  '#48C9B0',
  '#F5B041',
  '#DC7633'
];

const PRESET_OPTIONS = [
  { value: '7d', label: '7 Days' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'last3Months', label: 'Last 3 Months' },
  { value: 'thisYear', label: 'This Year' },
  { value: 'lastYear', label: 'Last Year' },
  { value: 'all', label: 'All Time' }
];

const Dividends = () => {
  const [summary, setSummary] = useState(null);
  const [dividends, setDividends] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('all');
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const hasLoadedOnce = useRef(false);

  const formatDateToInput = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const applyPreset = useCallback((presetValue) => {
    const today = new Date();
    const presets = {
      '7d': () => {
        const start = new Date(today);
        start.setDate(today.getDate() - 6);
        return { start: formatDateToInput(start), end: formatDateToInput(today) };
      },
      thisMonth: () => {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        return { start: formatDateToInput(start), end: formatDateToInput(today) };
      },
      last3Months: () => {
        const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
        return { start: formatDateToInput(start), end: formatDateToInput(today) };
      },
      thisYear: () => {
        const start = new Date(today.getFullYear(), 0, 1);
        return { start: formatDateToInput(start), end: formatDateToInput(today) };
      },
      lastYear: () => {
        const start = new Date(today.getFullYear() - 1, 0, 1);
        const end = new Date(today.getFullYear() - 1, 11, 31);
        return { start: formatDateToInput(start), end: formatDateToInput(end) };
      },
      all: () => ({ start: '', end: '' })
    };

    const range = presets[presetValue] ? presets[presetValue]() : presets.all();
    setSelectedPreset(presetValue);
    setStartDate(range.start);
    setEndDate(range.end);
  }, []);

  const handleStartDateChange = (event) => {
    const value = event.target.value;
    setSelectedPreset('custom');
    setStartDate(value);
    if (value && endDate && value > endDate) {
      setEndDate(value);
    }
  };

  const handleEndDateChange = (event) => {
    const value = event.target.value;
    setSelectedPreset('custom');
    setEndDate(value);
    if (value && startDate && value < startDate) {
      setStartDate(value);
    }
  };

  const fetchDividends = useCallback(async () => {
    if (!hasLoadedOnce.current) {
      setLoading(true);
    } else {
      setFetching(true);
    }

    try {
      const [summaryResponse, listResponse] = await Promise.all([
        dividendsAPI.getSummary(undefined, startDate || undefined, endDate || undefined),
        dividendsAPI.getAll(undefined, undefined, startDate || undefined, endDate || undefined)
      ]);
      setSummary(summaryResponse.data);
      setDividends(listResponse.data || []);
    } catch (error) {
      console.error('Error fetching dividends:', error);
      setSummary(null);
      setDividends([]);
    } finally {
      hasLoadedOnce.current = true;
      setLoading(false);
      setFetching(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    applyPreset('all');
  }, [applyPreset]);

  useEffect(() => {
    fetchDividends();
  }, [fetchDividends]);

  useEffect(() => {
    const loadAccounts = async () => {
      try {
        const response = await accountsAPI.getAll();
        setAccounts(response.data || []);
      } catch (error) {
        console.error('Error fetching accounts:', error);
      }
    };

    loadAccounts();
  }, []);

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(value);
  };

  const formatDisplayDate = (value) => {
    if (!value) return '';
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, (month || 1) - 1, day || 1);
    return date.toLocaleDateString();
  };

  const formatDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleDateString();
  };

  const accountLookup = useMemo(() => {
    return accounts.reduce((acc, account) => {
      acc[account.id] = account;
      return acc;
    }, {});
  }, [accounts]);

  const monthlyData = useMemo(() => {
    if (!summary?.dividends_by_month) return [];
    const formatter = new Intl.DateTimeFormat('en-CA', { month: 'short', year: 'numeric' });

    return Object.entries(summary.dividends_by_month)
      .map(([monthKey, amount]) => {
        const [year, month] = monthKey.split('-').map(Number);
        const date = new Date(year, (month || 1) - 1, 1);
        return {
          month: monthKey,
          label: formatter.format(date),
          amount
        };
      })
      .sort((a, b) => new Date(`${a.month}-01`) - new Date(`${b.month}-01`));
  }, [summary]);

  const tickerData = useMemo(() => {
    if (!summary?.dividends_by_ticker) return [];
    const entries = Object.entries(summary.dividends_by_ticker)
      .map(([ticker, amount]) => ({
        name: ticker,
        value: amount
      }))
      .sort((a, b) => b.value - a.value);

    if (entries.length <= 10) {
      return entries;
    }

    const topTen = entries.slice(0, 10);
    const othersTotal = entries.slice(10).reduce((acc, item) => acc + item.value, 0);

    return [...topTen, { name: 'Others', value: othersTotal }];
  }, [summary]);

  const statementRows = useMemo(() => {
    return dividends.map((dividend, index) => ({
      ...dividend,
      rowKey: dividend.id || `${dividend.account_id || 'account'}-${dividend.ticker || 'ticker'}-${dividend.date || index}-${index}`,
      amount: dividend.amount,
      accountLabel: accountLookup[dividend.account_id]?.label ||
        (accountLookup[dividend.account_id]
          ? `${accountLookup[dividend.account_id].institution} - ${accountLookup[dividend.account_id].account_number}`
          : dividend.account_id)
    }));
  }, [dividends, accountLookup]);

  const activePeriodDescription = useMemo(() => {
    if (startDate || endDate) {
      const startSegment = startDate ? formatDisplayDate(startDate) : 'Beginning';
      const endSegment = endDate ? formatDisplayDate(endDate) : 'Today';
      return `${startSegment} – ${endSegment}`;
    }
    return 'All time';
  }, [startDate, endDate]);

  if (loading && !summary) {
    return (
      <Container>
        <Box sx={{ py: 4 }}>
          <LinearProgress />
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        Dividend Income
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Stack spacing={2}>
          <Typography variant="subtitle1">
            Filter by period
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {PRESET_OPTIONS.map((preset) => (
              <Button
                key={preset.value}
                variant={selectedPreset === preset.value ? 'contained' : 'outlined'}
                size="small"
                onClick={() => applyPreset(preset.value)}
              >
                {preset.label}
              </Button>
            ))}
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }}>
            <TextField
              label="Start date"
              type="date"
              size="small"
              value={startDate}
              onChange={handleStartDateChange}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="End date"
              type="date"
              size="small"
              value={endDate}
              onChange={handleEndDateChange}
              InputLabelProps={{ shrink: true }}
            />
            <Button
              variant="text"
              size="small"
              onClick={() => applyPreset('all')}
            >
              Clear filters
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h5" gutterBottom>
              Total Dividends: {formatCurrency(summary?.total_dividends || 0)}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Period: {activePeriodDescription}
            </Typography>
            {fetching && <LinearProgress sx={{ mt: 2 }} />}
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Dividends by Month
            </Typography>
            {monthlyData.length > 0 ? (
              <Box sx={{ height: 400 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis />
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                    <Legend />
                    <Bar dataKey="amount" fill="#8884d8" name="Dividend Amount" />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            ) : (
              <Typography color="textSecondary">
                No dividend data available
              </Typography>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Dividends by Ticker
            </Typography>
            {tickerData.length > 0 ? (
              <Box sx={{ height: 400 }}>
                {fetching && <LinearProgress sx={{ mb: 2 }} />}
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={tickerData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {tickerData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                  </PieChart>
                </ResponsiveContainer>
                <Box sx={{ mt: 2 }}>
                  {tickerData.map((item, index) => (
                    <Box key={item.name} display="flex" justifyContent="space-between" mb={1}>
                      <Box display="flex" alignItems="center">
                        <Box
                          sx={{
                            width: 12,
                            height: 12,
                            backgroundColor: PIE_COLORS[index % PIE_COLORS.length],
                            mr: 1
                          }}
                        />
                        <Typography variant="body2">{item.name}</Typography>
                      </Box>
                      <Typography variant="body2">{formatCurrency(item.value)}</Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            ) : (
              <Typography color="textSecondary">
                No dividend data available
              </Typography>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
              <Typography variant="h6">
                Dividends Statement
              </Typography>
              {fetching && <LinearProgress sx={{ width: 200 }} />}
            </Stack>
            {statementRows.length === 0 ? (
              <Typography color="textSecondary">
                No dividend transactions for the selected period.
              </Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell>Ticker</TableCell>
                      <TableCell>Account</TableCell>
                      <TableCell align="right">Amount</TableCell>
                      <TableCell>Currency</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {statementRows.map((row) => (
                      <TableRow key={row.rowKey}>
                        <TableCell>{formatDateTime(row.date)}</TableCell>
                        <TableCell>{row.ticker}</TableCell>
                        <TableCell>{row.accountLabel || '—'}</TableCell>
                        <TableCell align="right">{formatCurrency(row.amount || 0)}</TableCell>
                        <TableCell>{row.currency || 'CAD'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
};

export default Dividends;
