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
  LinearProgress,
  Tabs,
  Tab,
  TableSortLabel
} from '@mui/material';
import { dividendsAPI, accountsAPI, instrumentsAPI } from '../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, Line, ComposedChart } from 'recharts';
import { stickyTableHeadSx } from '../utils/tableStyles';
import ExportButtons from '../components/ExportButtons';

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
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: 'thisMonth', label: 'This Mo' },
  { value: 'lastMonth', label: 'Last Mo' },
  { value: 'last3Months', label: '3M' },
  { value: 'last6Months', label: '6M' },
  { value: 'last12Months', label: '12M' },
  { value: 'thisYear', label: 'YTD' },
  { value: 'lastYear', label: 'Last Yr' },
  { value: 'all', label: 'All' }
];

const Dividends = () => {
  const [summary, setSummary] = useState(null);
  const [dividends, setDividends] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedTicker, setSelectedTicker] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [selectedIndustry, setSelectedIndustry] = useState('');
  const [instrumentTypes, setInstrumentTypes] = useState([]);
  const [instrumentIndustries, setInstrumentIndustries] = useState([]);
  const [instrumentMetadata, setInstrumentMetadata] = useState([]);
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [selectedIndustryId, setSelectedIndustryId] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [orderBy, setOrderBy] = useState('date');
  const [order, setOrder] = useState('desc');
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
      '30d': () => {
        const start = new Date(today);
        start.setDate(today.getDate() - 29);
        return { start: formatDateToInput(start), end: formatDateToInput(today) };
      },
      thisMonth: () => {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        return { start: formatDateToInput(start), end: formatDateToInput(today) };
      },
      lastMonth: () => {
        const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const end = new Date(today.getFullYear(), today.getMonth(), 0);
        return { start: formatDateToInput(start), end: formatDateToInput(end) };
      },
      last3Months: () => {
        const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
        return { start: formatDateToInput(start), end: formatDateToInput(today) };
      },
      last6Months: () => {
        const start = new Date(today.getFullYear(), today.getMonth() - 5, 1);
        return { start: formatDateToInput(start), end: formatDateToInput(today) };
      },
      last12Months: () => {
        const start = new Date(today.getFullYear(), today.getMonth() - 11, 1);
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

  const loadInstrumentMetadata = useCallback(async () => {
    try {
      const [typesRes, industriesRes, metadataRes] = await Promise.all([
        instrumentsAPI.getTypes(),
        instrumentsAPI.getIndustries(),
        instrumentsAPI.listClassifications()
      ]);
      setInstrumentTypes(typesRes.data || []);
      setInstrumentIndustries(industriesRes.data || []);
      setInstrumentMetadata(metadataRes.data || []);
    } catch (error) {
      console.error('Error loading instrument metadata:', error);
    }
  }, []);

  const fetchDividends = useCallback(async () => {
    if (!hasLoadedOnce.current) {
      setLoading(true);
    } else {
      setFetching(true);
    }

    try {
      const [summaryResponse, listResponse] = await Promise.all([
        dividendsAPI.getSummary(
          undefined,
          startDate || undefined,
          endDate || undefined,
          selectedTypeId || undefined,
          selectedIndustryId || undefined
        ),
        dividendsAPI.getAll(
          undefined,
          undefined,
          startDate || undefined,
          endDate || undefined,
          selectedTypeId || undefined,
          selectedIndustryId || undefined
        )
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
  }, [startDate, endDate, selectedTypeId, selectedIndustryId]);

  useEffect(() => {
    loadInstrumentMetadata();
  }, [loadInstrumentMetadata]);

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

    const sortedData = Object.entries(summary.dividends_by_month)
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

    // Calculate 12-month moving average
    return sortedData.map((item, index) => {
      // Get the last 12 months including current month
      const start = Math.max(0, index - 11);
      const last12Months = sortedData.slice(start, index + 1);
      const movingAvg = last12Months.reduce((sum, m) => sum + m.amount, 0) / last12Months.length;

      return {
        ...item,
        movingAverage: movingAvg
      };
    });
  }, [summary]);

  const typeLookup = useMemo(() => {
    const map = {};
    instrumentTypes.forEach((item) => {
      map[item.id] = item;
    });
    return map;
  }, [instrumentTypes]);

  const industryLookup = useMemo(() => {
    const map = {};
    instrumentIndustries.forEach((item) => {
      map[item.id] = item;
    });
    return map;
  }, [instrumentIndustries]);

  const tickerMetadataLookup = useMemo(() => {
    const map = {};
    instrumentMetadata.forEach((item) => {
      map[item.ticker] = {
        type: item.instrument_type_id ? typeLookup[item.instrument_type_id]?.name : null,
        industry: item.instrument_industry_id ? industryLookup[item.instrument_industry_id]?.name : null
      };
    });
    return map;
  }, [instrumentMetadata, typeLookup, industryLookup]);

  const tickerData = useMemo(() => {
    if (!summary?.dividends_by_ticker) return [];
    const entries = Object.entries(summary.dividends_by_ticker)
      .map(([ticker, amount]) => ({
        name: ticker,
        value: amount
      }))
      .sort((a, b) => b.value - a.value);

    return entries;
  }, [summary]);

  const typeData = useMemo(() => {
    if (!summary?.dividends_by_type) return [];
    const entries = Object.entries(summary.dividends_by_type)
      .map(([typeName, amount]) => {
        // Find the type object to get its color
        const typeObj = instrumentTypes.find(t => t.name === typeName);
        return {
          name: typeName,
          value: amount,
          color: typeObj?.color || '#8884d8'
        };
      })
      .sort((a, b) => b.value - a.value);

    return entries;
  }, [summary, instrumentTypes]);

  const industryData = useMemo(() => {
    if (!summary?.dividends_by_industry) return [];
    const entries = Object.entries(summary.dividends_by_industry)
      .map(([industryName, amount]) => {
        // Find the industry object to get its color
        const industryObj = instrumentIndustries.find(i => i.name === industryName);
        return {
          name: industryName,
          value: amount,
          color: industryObj?.color || '#82ca9d'
        };
      })
      .sort((a, b) => b.value - a.value);

    return entries;
  }, [summary, instrumentIndustries]);

  const handleBarDoubleClick = useCallback((data) => {
    if (!data || !data.activePayload || !data.activePayload[0]) return;
    const clickedMonth = data.activePayload[0].payload.month;
    setSelectedMonth((prev) => (prev === clickedMonth ? '' : clickedMonth));
  }, []);

  const handleTickerPieClick = useCallback((data) => {
    if (!data || !data.name) return;
    setSelectedTicker((prev) => (prev === data.name ? '' : data.name));
  }, []);

  const handleTypePieClick = useCallback((data) => {
    if (!data || !data.name) return;
    setSelectedType((prev) => (prev === data.name ? '' : data.name));
  }, []);

  const handleIndustryPieClick = useCallback((data) => {
    if (!data || !data.name) return;
    setSelectedIndustry((prev) => (prev === data.name ? '' : data.name));
  }, []);

  const statementRows = useMemo(() => {
    let filtered = dividends;

    // Filter by selected month from bar chart
    if (selectedMonth) {
      filtered = filtered.filter((dividend) => {
        if (!dividend.date) return false;
        try {
          const date = new Date(dividend.date);
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          return monthKey === selectedMonth;
        } catch {
          return false;
        }
      });
    }

    // Filter by selected ticker from pie chart
    if (selectedTicker) {
      filtered = filtered.filter((dividend) => dividend.ticker === selectedTicker);
    }

    // Filter by selected type from pie chart
    if (selectedType) {
      const typeObj = instrumentTypes.find(t => t.name === selectedType);
      if (typeObj) {
        // Get all tickers with this type
        const tickersWithType = instrumentMetadata
          .filter(m => m.instrument_type_id === typeObj.id)
          .map(m => m.ticker);
        filtered = filtered.filter((dividend) => tickersWithType.includes(dividend.ticker));
      }
    }

    // Filter by selected industry from pie chart
    if (selectedIndustry) {
      const industryObj = instrumentIndustries.find(i => i.name === selectedIndustry);
      if (industryObj) {
        // Get all tickers with this industry
        const tickersWithIndustry = instrumentMetadata
          .filter(m => m.instrument_industry_id === industryObj.id)
          .map(m => m.ticker);
        filtered = filtered.filter((dividend) => tickersWithIndustry.includes(dividend.ticker));
      }
    }

    return filtered.map((dividend, index) => {
      const metadata = tickerMetadataLookup[dividend.ticker] || {};
      return {
        ...dividend,
        rowKey: dividend.id || `${dividend.account_id || 'account'}-${dividend.ticker || 'ticker'}-${dividend.date || index}-${index}`,
        amount: dividend.amount,
        accountLabel: accountLookup[dividend.account_id]?.label ||
          (accountLookup[dividend.account_id]
            ? `${accountLookup[dividend.account_id].institution} - ${accountLookup[dividend.account_id].account_number}`
            : dividend.account_id),
        type: metadata.type || '-',
        industry: metadata.industry || '-'
      };
    });
  }, [dividends, accountLookup, selectedMonth, selectedTicker, selectedType, selectedIndustry, instrumentTypes, instrumentIndustries, instrumentMetadata, tickerMetadataLookup]);

  const handleRequestSort = useCallback((property) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  }, [orderBy, order]);

  const sortedStatementRows = useMemo(() => {
    const comparator = (a, b) => {
      let aValue = a[orderBy];
      let bValue = b[orderBy];

      // Handle null/undefined values
      if (aValue === null || aValue === undefined || aValue === '-') aValue = '';
      if (bValue === null || bValue === undefined || bValue === '-') bValue = '';

      // For date sorting, convert to Date objects
      if (orderBy === 'date') {
        aValue = new Date(aValue || 0);
        bValue = new Date(bValue || 0);
      }

      // For amount sorting, ensure numeric comparison
      if (orderBy === 'amount') {
        aValue = Number(aValue) || 0;
        bValue = Number(bValue) || 0;
      }

      // For string comparison, use localeCompare
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return order === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      // For numeric or date comparison
      if (order === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return bValue < aValue ? -1 : bValue > aValue ? 1 : 0;
      }
    };

    return [...statementRows].sort(comparator);
  }, [statementRows, orderBy, order]);

  // Export configuration
  const dividendExportColumns = useMemo(() => [
    { field: 'date', header: 'Date', type: 'date' },
    { field: 'ticker', header: 'Ticker' },
    { field: 'type', header: 'Type' },
    { field: 'industry', header: 'Industry' },
    { field: 'accountLabel', header: 'Account' },
    { field: 'amount', header: 'Amount', type: 'currency' },
    { field: 'currency', header: 'Currency' }
  ], []);

  const dividendExportData = useMemo(() => sortedStatementRows, [sortedStatementRows]);

  const activePeriodDescription = useMemo(() => {
    if (startDate || endDate) {
      const startSegment = startDate ? formatDisplayDate(startDate) : 'Beginning';
      const endSegment = endDate ? formatDisplayDate(endDate) : 'Today';
      return `${startSegment} – ${endSegment}`;
    }
    return 'All time';
  }, [startDate, endDate]);

  const renderColorSwatch = (color) => (
    <Box
      component="span"
      sx={{
        width: 12,
        height: 12,
        borderRadius: '50%',
        display: 'inline-flex',
        mr: 1,
        border: '1px solid rgba(0,0,0,0.12)',
        backgroundColor: color || '#b0bec5'
      }}
    />
  );

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

      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Paper sx={{ p: 3, position: 'sticky', top: 0, zIndex: 10, boxShadow: 3 }}>
            <Typography variant="h5" gutterBottom>
              Total Dividends: {formatCurrency(summary?.total_dividends || 0)}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Period: {activePeriodDescription}
            </Typography>
            {fetching && <LinearProgress sx={{ mt: 2 }} />}
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Stack spacing={2}>
              <Typography variant="subtitle1">
                Filter by period
              </Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ gap: 0.5 }}>
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
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Tabs
              value={activeTab}
              onChange={(e, newValue) => setActiveTab(newValue)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}
            >
              <Tab label="By Month" />
              <Tab label="By Ticker" />
              <Tab label="By Asset Type" />
              <Tab label="By Industry" />
            </Tabs>

            {activeTab === 0 && (
              <Box>
                <Typography variant="h6" gutterBottom>
                  Dividends by Month
                </Typography>
                {monthlyData.length > 0 ? (
                  <Box sx={{ height: 450 }}>
                    <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                      Click a bar to filter the statement table by that month
                    </Typography>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={monthlyData} onClick={handleBarDoubleClick}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" />
                        <YAxis />
                        <Tooltip formatter={(value) => formatCurrency(value)} />
                        <Legend />
                        <Bar dataKey="amount" name="Dividend Amount">
                          {monthlyData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={entry.month === selectedMonth ? '#4caf50' : '#8884d8'}
                            />
                          ))}
                        </Bar>
                        <Line
                          type="monotone"
                          dataKey="movingAverage"
                          name="12-Month Avg"
                          stroke="#ff7300"
                          strokeWidth={2}
                          dot={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </Box>
                ) : (
                  <Typography color="textSecondary">
                    No dividend data available
                  </Typography>
                )}
              </Box>
            )}

            {activeTab === 1 && (
              <Box>
                <Typography variant="h6" gutterBottom>
                  Dividends by Ticker
                </Typography>
                {tickerData.length > 0 ? (
                  <Grid container spacing={3}>
                    <Grid item xs={12} md={6}>
                      <Box sx={{ height: 400 }}>
                        <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                          Click a slice to filter the statement table
                        </Typography>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={tickerData}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                              outerRadius={120}
                              fill="#8884d8"
                              dataKey="value"
                              onClick={handleTickerPieClick}
                            >
                              {tickerData.map((entry, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={entry.name === selectedTicker ? '#4caf50' : PIE_COLORS[index % PIE_COLORS.length]}
                                  style={{ cursor: 'pointer' }}
                                />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value) => formatCurrency(value)} />
                          </PieChart>
                        </ResponsiveContainer>
                      </Box>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Box sx={{ maxHeight: 400, overflowY: 'auto' }}>
                        {tickerData.map((item, index) => (
                          <Box key={item.name} display="flex" justifyContent="space-between" mb={1}>
                            <Box display="flex" alignItems="center">
                              <Box
                                sx={{
                                  width: 12,
                                  height: 12,
                                  backgroundColor: PIE_COLORS[index % PIE_COLORS.length],
                                  mr: 1,
                                  borderRadius: '50%'
                                }}
                              />
                              <Typography variant="body2">{item.name}</Typography>
                            </Box>
                            <Typography variant="body2">{formatCurrency(item.value)}</Typography>
                          </Box>
                        ))}
                      </Box>
                    </Grid>
                  </Grid>
                ) : (
                  <Typography color="textSecondary">
                    No dividend data available
                  </Typography>
                )}
              </Box>
            )}

            {activeTab === 2 && (
              <Box>
                <Typography variant="h6" gutterBottom>
                  Dividends by Asset Type
                </Typography>
                {typeData.length > 0 ? (
                  <Grid container spacing={3}>
                    <Grid item xs={12} md={6}>
                      <Box sx={{ height: 400 }}>
                        <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                          Click a slice to filter the statement table
                        </Typography>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={typeData}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                              outerRadius={120}
                              fill="#8884d8"
                              dataKey="value"
                              onClick={handleTypePieClick}
                            >
                              {typeData.map((entry, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={entry.name === selectedType ? '#4caf50' : entry.color}
                                  style={{ cursor: 'pointer' }}
                                />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value) => formatCurrency(value)} />
                          </PieChart>
                        </ResponsiveContainer>
                      </Box>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Box sx={{ maxHeight: 400, overflowY: 'auto' }}>
                        {typeData.map((item, index) => (
                          <Box key={item.name} display="flex" justifyContent="space-between" mb={1}>
                            <Box display="flex" alignItems="center">
                              <Box
                                sx={{
                                  width: 12,
                                  height: 12,
                                  backgroundColor: item.color,
                                  mr: 1,
                                  borderRadius: '50%'
                                }}
                              />
                              <Typography variant="body2">{item.name}</Typography>
                            </Box>
                            <Typography variant="body2">{formatCurrency(item.value)}</Typography>
                          </Box>
                        ))}
                      </Box>
                    </Grid>
                  </Grid>
                ) : (
                  <Typography color="textSecondary">
                    Classify your dividend-paying instruments to see this breakdown.
                  </Typography>
                )}
              </Box>
            )}

            {activeTab === 3 && (
              <Box>
                <Typography variant="h6" gutterBottom>
                  Dividends by Industry
                </Typography>
                {industryData.length > 0 ? (
                  <Grid container spacing={3}>
                    <Grid item xs={12} md={6}>
                      <Box sx={{ height: 400 }}>
                        <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                          Click a slice to filter the statement table
                        </Typography>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={industryData}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                              outerRadius={120}
                              fill="#82ca9d"
                              dataKey="value"
                              onClick={handleIndustryPieClick}
                            >
                              {industryData.map((entry, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={entry.name === selectedIndustry ? '#4caf50' : entry.color}
                                  style={{ cursor: 'pointer' }}
                                />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value) => formatCurrency(value)} />
                          </PieChart>
                        </ResponsiveContainer>
                      </Box>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Box sx={{ maxHeight: 400, overflowY: 'auto' }}>
                        {industryData.map((item, index) => (
                          <Box key={item.name} display="flex" justifyContent="space-between" mb={1}>
                            <Box display="flex" alignItems="center">
                              <Box
                                sx={{
                                  width: 12,
                                  height: 12,
                                  backgroundColor: item.color,
                                  mr: 1,
                                  borderRadius: '50%'
                                }}
                              />
                              <Typography variant="body2">{item.name}</Typography>
                            </Box>
                            <Typography variant="body2">{formatCurrency(item.value)}</Typography>
                          </Box>
                        ))}
                      </Box>
                    </Grid>
                  </Grid>
                ) : (
                  <Typography color="textSecondary">
                    Classify your dividend-paying instruments to see this breakdown.
                  </Typography>
                )}
              </Box>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
              <Box>
                <Typography variant="h6">
                  Dividends Statement
                </Typography>
                {(selectedMonth || selectedTicker || selectedType || selectedIndustry) && (
                  <Box sx={{ mt: 0.5 }}>
                    {selectedMonth && (
                      <Typography variant="body2" color="primary" component="span" sx={{ mr: 2 }}>
                        Month: {monthlyData.find(m => m.month === selectedMonth)?.label || selectedMonth}
                        {' '}
                        <Button
                          variant="text"
                          size="small"
                          onClick={() => setSelectedMonth('')}
                          sx={{ minWidth: 'auto', p: 0 }}
                        >
                          (Clear)
                        </Button>
                      </Typography>
                    )}
                    {selectedTicker && (
                      <Typography variant="body2" color="primary" component="span" sx={{ mr: 2 }}>
                        Ticker: {selectedTicker}
                        {' '}
                        <Button
                          variant="text"
                          size="small"
                          onClick={() => setSelectedTicker('')}
                          sx={{ minWidth: 'auto', p: 0 }}
                        >
                          (Clear)
                        </Button>
                      </Typography>
                    )}
                    {selectedType && (
                      <Typography variant="body2" color="primary" component="span" sx={{ mr: 2 }}>
                        Type: {selectedType}
                        {' '}
                        <Button
                          variant="text"
                          size="small"
                          onClick={() => setSelectedType('')}
                          sx={{ minWidth: 'auto', p: 0 }}
                        >
                          (Clear)
                        </Button>
                      </Typography>
                    )}
                    {selectedIndustry && (
                      <Typography variant="body2" color="primary" component="span" sx={{ mr: 2 }}>
                        Industry: {selectedIndustry}
                        {' '}
                        <Button
                          variant="text"
                          size="small"
                          onClick={() => setSelectedIndustry('')}
                          sx={{ minWidth: 'auto', p: 0 }}
                        >
                          (Clear)
                        </Button>
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
              {fetching && <LinearProgress sx={{ width: 200 }} />}
            </Stack>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2, mt: 2 }}>
              <ExportButtons
                data={dividendExportData}
                columns={dividendExportColumns}
                filename="dividends"
                title="Dividends Report"
              />
            </Box>
            {statementRows.length === 0 ? (
              <Typography color="textSecondary">
                No dividend transactions for the selected period.
              </Typography>
            ) : (
              <TableContainer>
                <Table size="small" stickyHeader>
                  <TableHead sx={stickyTableHeadSx}>
                    <TableRow>
                      <TableCell>
                        <TableSortLabel
                          active={orderBy === 'date'}
                          direction={orderBy === 'date' ? order : 'asc'}
                          onClick={() => handleRequestSort('date')}
                        >
                          Date
                        </TableSortLabel>
                      </TableCell>
                      <TableCell>
                        <TableSortLabel
                          active={orderBy === 'ticker'}
                          direction={orderBy === 'ticker' ? order : 'asc'}
                          onClick={() => handleRequestSort('ticker')}
                        >
                          Ticker
                        </TableSortLabel>
                      </TableCell>
                      <TableCell>
                        <TableSortLabel
                          active={orderBy === 'type'}
                          direction={orderBy === 'type' ? order : 'asc'}
                          onClick={() => handleRequestSort('type')}
                        >
                          Type
                        </TableSortLabel>
                      </TableCell>
                      <TableCell>
                        <TableSortLabel
                          active={orderBy === 'industry'}
                          direction={orderBy === 'industry' ? order : 'asc'}
                          onClick={() => handleRequestSort('industry')}
                        >
                          Industry
                        </TableSortLabel>
                      </TableCell>
                      <TableCell>
                        <TableSortLabel
                          active={orderBy === 'accountLabel'}
                          direction={orderBy === 'accountLabel' ? order : 'asc'}
                          onClick={() => handleRequestSort('accountLabel')}
                        >
                          Account
                        </TableSortLabel>
                      </TableCell>
                      <TableCell align="right">
                        <TableSortLabel
                          active={orderBy === 'amount'}
                          direction={orderBy === 'amount' ? order : 'asc'}
                          onClick={() => handleRequestSort('amount')}
                        >
                          Amount
                        </TableSortLabel>
                      </TableCell>
                      <TableCell>
                        <TableSortLabel
                          active={orderBy === 'currency'}
                          direction={orderBy === 'currency' ? order : 'asc'}
                          onClick={() => handleRequestSort('currency')}
                        >
                          Currency
                        </TableSortLabel>
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sortedStatementRows.map((row) => (
                      <TableRow key={row.rowKey}>
                        <TableCell>{formatDateTime(row.date)}</TableCell>
                        <TableCell>{row.ticker}</TableCell>
                        <TableCell>{row.type}</TableCell>
                        <TableCell>{row.industry}</TableCell>
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
