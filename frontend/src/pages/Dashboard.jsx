import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Container,
  Box,
  Stack,
  TextField,
  Button,
  Card,
  CardContent,
  Paper,
  Typography,
  FormControl,
  InputLabel,
  MenuItem,
  Select
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  AccountBalance,
  AttachMoney,
  Refresh
} from '@mui/icons-material';
import { accountsAPI, positionsAPI, dividendsAPI, dashboardAPI } from '../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import RGL, { WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const GridLayout = WidthProvider(RGL);
const GRID_COLS = 12;
const ROW_HEIGHT = 120;
const GRID_MARGIN = [16, 16];

const DEFAULT_TILE_LAYOUT = [
  { i: 'total_value', x: 0, y: 0, w: 3, h: 1 },
  { i: 'book_value', x: 3, y: 0, w: 3, h: 1 },
  { i: 'capital_gains', x: 6, y: 0, w: 3, h: 1 },
  { i: 'dividends', x: 9, y: 0, w: 3, h: 1 },
  { i: 'total_gains', x: 0, y: 1, w: 3, h: 1 },
  { i: 'accounts_summary', x: 3, y: 1, w: 3, h: 1 },
  { i: 'performance', x: 0, y: 2, w: 8, h: 3 },
  { i: 'accounts_list', x: 8, y: 2, w: 4, h: 3 }
];

const DEFAULT_TILE_MAP = DEFAULT_TILE_LAYOUT.reduce((acc, item) => {
  acc[item.i] = { ...item };
  return acc;
}, {});

const TILE_CONSTRAINTS = {
  total_value: { minW: 2, minH: 1 },
  book_value: { minW: 2, minH: 1 },
  capital_gains: { minW: 2, minH: 1 },
  dividends: { minW: 2, minH: 1 },
  total_gains: { minW: 2, minH: 1 },
  accounts_summary: { minW: 2, minH: 1 },
  performance: { minW: 6, minH: 2 },
  accounts_list: { minW: 4, minH: 2 }
};

const sanitizeNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const DATE_PRESETS = {
  CURRENT: 'current',
  LAST_MONTH: 'last_month',
  SPECIFIC_MONTH: 'specific_month',
  LAST_QUARTER: 'last_quarter',
  LAST_YEAR: 'last_year',
  END_OF_YEAR: 'end_of_year'
};

const formatISODate = (date) => date.toISOString().split('T')[0];
const getLastDayOfMonthDate = (year, monthIndexZeroBased) =>
  formatISODate(new Date(year, monthIndexZeroBased + 1, 0));

const computeValuationDate = (preset, specificMonthValue, endOfYearValue) => {
  const now = new Date();

  switch (preset) {
    case DATE_PRESETS.CURRENT:
      return '';
    case DATE_PRESETS.LAST_MONTH: {
      const date = new Date(now.getFullYear(), now.getMonth(), 0);
      return formatISODate(date);
    }
    case DATE_PRESETS.SPECIFIC_MONTH: {
      if (!specificMonthValue) return '';
      const [year, month] = specificMonthValue.split('-').map(Number);
      if (!year || !month) return '';
      return getLastDayOfMonthDate(year, month - 1);
    }
    case DATE_PRESETS.LAST_QUARTER: {
      const currentQuarter = Math.floor(now.getMonth() / 3);
      const targetQuarter = currentQuarter === 0 ? 3 : currentQuarter;
      const targetYear = currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear();
      const lastMonthIndex = targetQuarter * 3 - 1;
      return getLastDayOfMonthDate(targetYear, lastMonthIndex);
    }
    case DATE_PRESETS.LAST_YEAR: {
      const date = new Date(now.getFullYear() - 1, 12, 0);
      return formatISODate(date);
    }
    case DATE_PRESETS.END_OF_YEAR: {
      const year = parseInt(endOfYearValue, 10);
      if (!year) return '';
      return formatISODate(new Date(year, 12, 0));
    }
    default:
      return '';
  }
};

const applyConstraints = (layout) =>
  layout.map((item) => {
    const defaults = DEFAULT_TILE_MAP[item.i] || DEFAULT_TILE_LAYOUT[0];
    const meta = TILE_CONSTRAINTS[item.i] || {};

    return {
      ...defaults,
      ...item,
      x: sanitizeNumber(item.x, defaults.x),
      y: sanitizeNumber(item.y, defaults.y),
      w: sanitizeNumber(item.w, defaults.w),
      h: sanitizeNumber(item.h, defaults.h),
      minW: meta.minW || defaults.minW || 1,
      minH: meta.minH || defaults.minH || 1
    };
  });

const ensureCompleteLayout = (layout) => {
  const seen = new Set(layout.map((item) => item.i));
  const result = [...layout];

  DEFAULT_TILE_LAYOUT.forEach((defaultTile) => {
    if (!seen.has(defaultTile.i)) {
      result.push({ ...defaultTile });
    }
  });

  return applyConstraints(result);
};

const convertFromServerLayout = (serverLayout) => {
  if (!Array.isArray(serverLayout)) {
    return ensureCompleteLayout([]);
  }

  const parsed = [];
  const seen = new Set();

  serverLayout.forEach((tile) => {
    if (!tile) return;
    const id = tile.id || tile.i;
    if (!id || seen.has(id) || !DEFAULT_TILE_MAP[id]) return;

    parsed.push({
      i: id,
      x: sanitizeNumber(tile.x, DEFAULT_TILE_MAP[id].x),
      y: sanitizeNumber(tile.y, DEFAULT_TILE_MAP[id].y),
      w: sanitizeNumber(tile.w, DEFAULT_TILE_MAP[id].w),
      h: sanitizeNumber(tile.h, DEFAULT_TILE_MAP[id].h)
    });
    seen.add(id);
  });

  return ensureCompleteLayout(parsed);
};

const serializeLayout = (layout) =>
  layout.map(({ i, x, y, w, h, minW, minH }) => ({
    id: i,
    x,
    y,
    w,
    h,
    minW,
    minH
  }));

const StatCard = ({ title, value, icon, color, subtitle }) => (
  <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <CardContent sx={{ flexGrow: 1 }}>
      <Typography
        variant="caption"
        color="textSecondary"
        className="dashboard-tile-handle"
        sx={{ letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'move' }}
      >
        {title}
      </Typography>
      <Box display="flex" justifyContent="space-between" alignItems="center" mt={1}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 600 }}>
            {value}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color={color}>
              {subtitle}
            </Typography>
          )}
        </Box>
        <Box sx={{ color: color || 'primary.main' }}>{icon}</Box>
      </Box>
    </CardContent>
  </Card>
);

const Dashboard = () => {
  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [dividendSummary, setDividendSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [datePreset, setDatePreset] = useState(DATE_PRESETS.CURRENT);
  const [specificMonth, setSpecificMonth] = useState('');
  const [endOfYear, setEndOfYear] = useState('');
  const [gridLayout, setGridLayout] = useState(ensureCompleteLayout(DEFAULT_TILE_LAYOUT));
  const [layoutLoading, setLayoutLoading] = useState(true);
  const isReadyToPersist = useRef(false);

  const valuationDate = useMemo(
    () => computeValuationDate(datePreset, specificMonth, endOfYear),
    [datePreset, specificMonth, endOfYear]
  );

  useEffect(() => {
    const loadLayout = async () => {
      try {
        const response = await dashboardAPI.getLayout();
        const serverLayout = response.data?.layout;
        const converted = convertFromServerLayout(serverLayout);
        setGridLayout(converted);
      } catch (error) {
        console.error('Error loading dashboard layout:', error);
        setGridLayout(convertFromServerLayout(DEFAULT_TILE_LAYOUT));
      } finally {
        setLayoutLoading(false);
        isReadyToPersist.current = true;
      }
    };

    loadLayout();
  }, []);

  useEffect(() => {
    if (layoutLoading) {
      return;
    }

    const fetchData = async () => {
      setFetching(true);
      try {
        const asOfParam = valuationDate || undefined;
        const [summaryRes, accountsRes, dividendsRes] = await Promise.all([
          positionsAPI.getSummary(asOfParam),
          accountsAPI.getAll(),
          dividendsAPI.getSummary(undefined, undefined, asOfParam)
        ]);

        setSummary(summaryRes.data);
        setAccounts(accountsRes.data);
        setDividendSummary(dividendsRes.data);
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setFetching(false);
        setLoading(false);
      }
    };

    fetchData();
  }, [valuationDate, layoutLoading]);

  const formatCurrency = (value) =>
    new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(value || 0);

  const capitalGains = useMemo(() => {
    try {
      const totalMarket = summary?.total_market_value || 0;
      const totalBook = summary?.total_book_value || 0;
      return totalMarket - totalBook;
    } catch {
      return 0;
    }
  }, [summary]);

  const totalDividends = dividendSummary?.total_dividends || 0;
  const totalGains = capitalGains + totalDividends;

  const handleLayoutCommit = (nextLayout) => {
    const constrained = applyConstraints(nextLayout);
    setGridLayout(constrained);
    if (isReadyToPersist.current) {
      persistLayout(constrained);
    }
  };

  const persistLayout = async (layout) => {
    try {
      await dashboardAPI.saveLayout(serializeLayout(layout));
    } catch (error) {
      console.error('Error saving dashboard layout:', error);
    }
  };

  const handleResetLayout = async () => {
    try {
      const response = await dashboardAPI.resetLayout();
      const converted = convertFromServerLayout(response.data?.layout);
      setGridLayout(converted);
    } catch (error) {
      console.error('Error resetting dashboard layout:', error);
      setGridLayout(convertFromServerLayout(DEFAULT_TILE_LAYOUT));
    }
  };

  const handleRefreshPrices = async () => {
    setRefreshing(true);
    try {
      await positionsAPI.refreshPrices();
      // Refetch all data after refreshing prices
      const asOfParam = valuationDate || undefined;
      const [summaryRes, accountsRes, dividendsRes] = await Promise.all([
        positionsAPI.getSummary(asOfParam),
        accountsAPI.getAll(),
        dividendsAPI.getSummary(undefined, undefined, asOfParam)
      ]);

      setSummary(summaryRes.data);
      setAccounts(accountsRes.data);
      setDividendSummary(dividendsRes.data);
    } catch (error) {
      console.error('Error refreshing prices:', error);
    } finally {
      setRefreshing(false);
    }
  };

  if (loading || layoutLoading) {
    return (
      <Container>
        <Typography>Loading...</Typography>
      </Container>
    );
  }

  const gainLossColor = capitalGains >= 0 ? 'success.main' : 'error.main';
  const gainLossIcon = capitalGains >= 0 ? <TrendingUp fontSize="large" /> : <TrendingDown fontSize="large" />;

  const asOfLabel = valuationDate
    ? new Date(valuationDate).toLocaleDateString()
    : new Date().toLocaleDateString();

  const renderTile = (id, layoutItem) => {
    switch (id) {
      case 'total_value':
        return (
          <StatCard
            title="Total Portfolio Value"
            value={formatCurrency(summary?.total_market_value || 0)}
            icon={<AccountBalance fontSize="large" />}
            color="primary.main"
          />
        );
      case 'book_value':
        return (
          <StatCard
            title="Book Value"
            value={formatCurrency(summary?.total_book_value || 0)}
            icon={<AccountBalance fontSize="large" />}
            color="info.main"
          />
        );
      case 'capital_gains':
        return (
          <StatCard
            title="Total Gain/Loss"
            value={formatCurrency(capitalGains)}
            icon={gainLossIcon}
            color={gainLossColor}
            subtitle={`${summary?.total_gain_loss_percent?.toFixed(2) || 0}%`}
          />
        );
      case 'dividends':
        return (
          <StatCard
            title="Total Dividends"
            value={formatCurrency(totalDividends)}
            icon={<AttachMoney fontSize="large" />}
            color="success.main"
          />
        );
      case 'total_gains':
        return (
          <StatCard
            title="Total Gains"
            value={formatCurrency(totalGains)}
            icon={<TrendingUp fontSize="large" />}
            color={totalGains >= 0 ? 'success.main' : 'error.main'}
            subtitle="Capital gains + dividends"
          />
        );
      case 'accounts_summary':
        return (
          <StatCard
            title="Accounts"
            value={summary?.accounts_count || 0}
            icon={<AccountBalance fontSize="large" />}
            color="info.main"
            subtitle={`${summary?.positions_count || 0} positions`}
          />
        );
      case 'performance':
        return (
          <Paper sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Typography
              variant="caption"
              color="textSecondary"
              className="dashboard-tile-handle"
              sx={{ letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'move', mb: 2 }}
            >
              Portfolio Performance
            </Typography>
            {fetching && (
              <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                Updating metrics…
              </Typography>
            )}
            <Box sx={{ flexGrow: 1, minHeight: ROW_HEIGHT * layoutItem.h - 80 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={[]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="value" stroke="#8884d8" name="Portfolio Value" />
                </LineChart>
              </ResponsiveContainer>
            </Box>
            <Typography variant="caption" color="textSecondary" sx={{ mt: 2 }}>
              Import statements to see historical performance
            </Typography>
          </Paper>
        );
      case 'accounts_list':
        return (
          <Paper sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Typography
              variant="caption"
              color="textSecondary"
              className="dashboard-tile-handle"
              sx={{ letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'move', mb: 2 }}
            >
              Accounts
            </Typography>
            <Box sx={{ flexGrow: 1, overflowY: 'auto', pr: 1 }}>
              {accounts.length === 0 ? (
                <Typography color="textSecondary">
                  No accounts yet. Import a statement to get started.
                </Typography>
              ) : (
                accounts.map((account) => (
                  <Box key={account.id} sx={{ mb: 2, pb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="subtitle1">
                      {account.institution}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      {account.account_type} - {account.account_number}
                    </Typography>
                    <Typography variant="h6" color="primary">
                      {formatCurrency(account.balance)}
                    </Typography>
                  </Box>
                ))
              )}
            </Box>
          </Paper>
        );
      default:
        return null;
    }
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4" gutterBottom>
            Dashboard
          </Typography>
          <Typography variant="body2" color="textSecondary">
            As of {asOfLabel}
          </Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="dashboard-date-select">Valuation</InputLabel>
            <Select
              labelId="dashboard-date-select"
              value={datePreset}
              label="Valuation"
              onChange={(event) => setDatePreset(event.target.value)}
            >
              <MenuItem value={DATE_PRESETS.CURRENT}>Current Price</MenuItem>
              <MenuItem value={DATE_PRESETS.LAST_MONTH}>Last Month</MenuItem>
              <MenuItem value={DATE_PRESETS.SPECIFIC_MONTH}>Specific Month</MenuItem>
              <MenuItem value={DATE_PRESETS.LAST_QUARTER}>Last Quarter</MenuItem>
              <MenuItem value={DATE_PRESETS.LAST_YEAR}>Last Year</MenuItem>
              <MenuItem value={DATE_PRESETS.END_OF_YEAR}>End of Year</MenuItem>
            </Select>
          </FormControl>
          {datePreset === DATE_PRESETS.SPECIFIC_MONTH && (
            <TextField
              label="Month"
              type="month"
              size="small"
              value={specificMonth}
              onChange={(event) => setSpecificMonth(event.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          )}
          {datePreset === DATE_PRESETS.END_OF_YEAR && (
            <TextField
              label="Year"
              type="number"
              size="small"
              value={endOfYear}
              onChange={(event) => setEndOfYear(event.target.value)}
              InputProps={{ inputProps: { min: 1900, max: 9999 } }}
            />
          )}
          {datePreset !== DATE_PRESETS.CURRENT && (
            <Button
              variant="text"
              size="small"
              onClick={() => {
                setDatePreset(DATE_PRESETS.CURRENT);
                setSpecificMonth('');
                setEndOfYear('');
              }}
            >
              Clear selection
            </Button>
          )}
          <Button
            variant="contained"
            size="small"
            startIcon={<Refresh />}
            onClick={handleRefreshPrices}
            disabled={refreshing || fetching}
          >
            {refreshing ? 'Refreshing...' : 'Refresh Prices'}
          </Button>
          <Button variant="outlined" size="small" onClick={handleResetLayout}>
            Reset Layout
          </Button>
        </Stack>
      </Box>

      <GridLayout
        className="dashboard-grid"
        layout={gridLayout}
        cols={GRID_COLS}
        rowHeight={ROW_HEIGHT}
        margin={GRID_MARGIN}
        compactType={null}
        preventCollision={false}
        onDragStop={handleLayoutCommit}
        onResizeStop={handleLayoutCommit}
        draggableHandle=".dashboard-tile-handle"
      >
        {gridLayout.map((item) => (
          <div key={item.i}>
            {renderTile(item.i, item)}
          </div>
        ))}
      </GridLayout>
    </Container>
  );
};

export default Dashboard;
