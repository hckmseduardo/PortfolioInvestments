import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Responsive, WidthProvider, utils as RGLUtils } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);
const { compact } = RGLUtils || {};
const ROW_HEIGHT = 120;
const GRID_MARGIN = [16, 16];

const LAYOUT_PROFILES = [
  'desktop',
  'tablet_landscape',
  'tablet_portrait',
  'mobile_landscape',
  'mobile_portrait'
];

const BREAKPOINTS = {
  desktop: 1600,
  tablet_landscape: 1200,
  tablet_portrait: 992,
  mobile_landscape: 768,
  mobile_portrait: 0
};

const COLS = {
  desktop: 12,
  tablet_landscape: 12,
  tablet_portrait: 8,
  mobile_landscape: 6,
  mobile_portrait: 4
};

const PROFILE_DEFAULT_LAYOUTS = {
  desktop: [
    { i: 'book_value', x: 0, y: 0, w: 3, h: 1 },
    { i: 'capital_gains', x: 3, y: 0, w: 3, h: 1 },
    { i: 'dividends', x: 6, y: 0, w: 3, h: 1 },
    { i: 'total_gains', x: 9, y: 0, w: 3, h: 1 },
    { i: 'accounts_summary', x: 0, y: 1, w: 4, h: 1 },
    { i: 'total_value', x: 4, y: 1, w: 4, h: 1 },
    { i: 'accounts_list', x: 0, y: 2, w: 12, h: 2 },
    { i: 'performance', x: 0, y: 4, w: 12, h: 3 },
    { i: 'type_breakdown', x: 0, y: 7, w: 6, h: 6, minH: 6 },
    { i: 'industry_breakdown', x: 6, y: 7, w: 6, h: 6, minH: 6 }
  ],
  tablet_landscape: [
    { i: 'book_value', x: 0, y: 0, w: 3, h: 1 },
    { i: 'capital_gains', x: 3, y: 0, w: 3, h: 1 },
    { i: 'dividends', x: 6, y: 0, w: 3, h: 1 },
    { i: 'total_gains', x: 9, y: 0, w: 3, h: 1 },
    { i: 'accounts_summary', x: 0, y: 1, w: 4, h: 1 },
    { i: 'total_value', x: 4, y: 1, w: 4, h: 1 },
    { i: 'accounts_list', x: 0, y: 2, w: 12, h: 2 },
    { i: 'performance', x: 0, y: 4, w: 12, h: 3 },
    { i: 'type_breakdown', x: 0, y: 7, w: 6, h: 6, minH: 6 },
    { i: 'industry_breakdown', x: 6, y: 7, w: 6, h: 6, minH: 6 }
  ],
  tablet_portrait: [
    { i: 'book_value', x: 0, y: 0, w: 4, h: 1 },
    { i: 'capital_gains', x: 4, y: 0, w: 4, h: 1 },
    { i: 'dividends', x: 0, y: 1, w: 4, h: 1 },
    { i: 'total_gains', x: 4, y: 1, w: 4, h: 1 },
    { i: 'accounts_summary', x: 0, y: 2, w: 4, h: 1 },
    { i: 'total_value', x: 4, y: 2, w: 4, h: 1 },
    { i: 'accounts_list', x: 0, y: 3, w: 8, h: 2 },
    { i: 'performance', x: 0, y: 5, w: 8, h: 3 },
    { i: 'type_breakdown', x: 0, y: 8, w: 4, h: 6, minH: 6 },
    { i: 'industry_breakdown', x: 4, y: 8, w: 4, h: 6, minH: 6 }
  ],
  mobile_landscape: [
    { i: 'book_value', x: 0, y: 0, w: 3, h: 1 },
    { i: 'capital_gains', x: 3, y: 0, w: 3, h: 1 },
    { i: 'dividends', x: 0, y: 1, w: 3, h: 1 },
    { i: 'total_gains', x: 3, y: 1, w: 3, h: 1 },
    { i: 'accounts_summary', x: 0, y: 2, w: 3, h: 1 },
    { i: 'total_value', x: 3, y: 2, w: 3, h: 1 },
    { i: 'accounts_list', x: 0, y: 3, w: 6, h: 2 },
    { i: 'performance', x: 0, y: 5, w: 6, h: 3 },
    { i: 'type_breakdown', x: 0, y: 8, w: 6, h: 6, minH: 6 },
    { i: 'industry_breakdown', x: 0, y: 14, w: 6, h: 6, minH: 6 }
  ],
  mobile_portrait: [
    { i: 'book_value', x: 0, y: 0, w: 4, h: 1 },
    { i: 'capital_gains', x: 0, y: 1, w: 4, h: 1 },
    { i: 'dividends', x: 0, y: 2, w: 4, h: 1 },
    { i: 'total_gains', x: 0, y: 3, w: 4, h: 1 },
    { i: 'accounts_summary', x: 0, y: 4, w: 4, h: 1 },
    { i: 'total_value', x: 0, y: 5, w: 4, h: 1 },
    { i: 'accounts_list', x: 0, y: 6, w: 4, h: 2 },
    { i: 'performance', x: 0, y: 8, w: 4, h: 3 },
    { i: 'type_breakdown', x: 0, y: 11, w: 4, h: 8, minH: 8 },
    { i: 'industry_breakdown', x: 0, y: 19, w: 4, h: 8, minH: 8 }
  ]
};

const LEGACY_TILE_MAP = {
  total_value: { i: 'total_value', x: 0, y: 0, w: 3, h: 1 }
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

const PERFORMANCE_PRESETS = {
  LAST_MONTH: 'last_month',
  LAST_3_MONTHS: 'last_3_months',
  LAST_6_MONTHS: 'last_6_months',
  LAST_YEAR: 'last_year',
  YEAR_TO_DATE: 'year_to_date',
  SPECIFIC_MONTH: 'specific_month',
  SPECIFIC_YEAR: 'specific_year'
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

const getDefaultLayout = (profile) =>
  (PROFILE_DEFAULT_LAYOUTS[profile] || PROFILE_DEFAULT_LAYOUTS.desktop).map((tile) => ({ ...tile }));

const sanitizeLayout = (layout, profile) => {
  const defaults = PROFILE_DEFAULT_LAYOUTS[profile] || PROFILE_DEFAULT_LAYOUTS.desktop;
  const defaultMap = defaults.reduce((acc, tile) => {
    acc[tile.i] = { ...tile };
    return acc;
  }, {});
  const allowedIds = new Set([...Object.keys(defaultMap), ...Object.keys(LEGACY_TILE_MAP)]);
  const sanitized = [];
  const seen = new Set();

  (layout || []).forEach((item) => {
    if (!item) return;
    const id = item.i || item.id;
    if (!id || !allowedIds.has(id) || seen.has(id)) {
      return;
    }
    const base = defaultMap[id] || LEGACY_TILE_MAP[id];
    if (!base) {
      return;
    }
    const normalized = {
      i: id,
      x: sanitizeNumber(item.x, base.x),
      y: sanitizeNumber(item.y, base.y),
      w: sanitizeNumber(item.w, base.w),
      h: sanitizeNumber(item.h, base.h),
      minW: sanitizeNumber(item.minW ?? base.minW, base.minW || 1),
      minH: sanitizeNumber(item.minH ?? base.minH, base.minH || 1)
    };
    normalized.w = Math.max(normalized.w, normalized.minW || 1);
    normalized.h = Math.max(normalized.h, normalized.minH || 1);
    sanitized.push(normalized);
    seen.add(id);
  });

  defaults.forEach((tile) => {
    if (!seen.has(tile.i)) {
      sanitized.push({ ...tile });
    }
  });

  return sanitized;
};

const normalizeLayoutForProfile = (layout, profile) => {
  if (!layout || layout.length === 0) {
    return getDefaultLayout(profile);
  }

  const cols = COLS[profile] || COLS.desktop;
  const workingLayout = layout.map((item) => ({ ...item }));
  const compacted = compact ? compact(workingLayout, 'vertical', cols) : workingLayout;
  return sanitizeLayout(compacted, profile);
};

const convertFromServerLayout = (serverLayout, profile) => {
  if (!Array.isArray(serverLayout)) {
    return getDefaultLayout(profile);
  }

  const parsed = serverLayout.map((tile) => ({
    i: tile?.i || tile?.id,
    x: tile?.x,
    y: tile?.y,
    w: tile?.w,
    h: tile?.h,
    minW: tile?.minW,
    minH: tile?.minH
  }));

  return normalizeLayoutForProfile(parsed, profile);
};

const serializeLayout = (layout = []) =>
  layout.map(({ i, x, y, w, h, minW, minH }) => ({
    id: i,
    x,
    y,
    w,
    h,
    ...(minW ? { minW } : {}),
    ...(minH ? { minH } : {})
  }));

const buildInitialLayouts = () => {
  const initial = {};
  LAYOUT_PROFILES.forEach((profile) => {
    initial[profile] = getDefaultLayout(profile);
  });
  return initial;
};

const getMonthDailyDates = (year, monthIndexZeroBased) => {
  const totalDays = new Date(year, monthIndexZeroBased + 1, 0).getDate();
  const dates = [];
  for (let day = 1; day <= totalDays; day += 1) {
    dates.push(formatISODate(new Date(year, monthIndexZeroBased, day)));
  }
  return dates;
};

const buildRecentMonthEnds = (months) => {
  const now = new Date();
  const dates = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const target = new Date(now.getFullYear(), now.getMonth() - offset + 1, 0);
    dates.push(formatISODate(target));
  }
  return dates;
};

const buildYearToDateSeries = () => {
  const now = new Date();
  const dates = [];
  for (let month = 0; month <= now.getMonth(); month += 1) {
    dates.push(getLastDayOfMonthDate(now.getFullYear(), month));
  }
  return dates;
};

const buildSpecificYearSeries = (year) => {
  const dates = [];
  for (let month = 0; month < 12; month += 1) {
    dates.push(getLastDayOfMonthDate(year, month));
  }
  return dates;
};

const computePerformanceDates = (range, specificMonthValue, specificYearValue) => {
  switch (range) {
    case PERFORMANCE_PRESETS.LAST_MONTH: {
      const now = new Date();
      const target = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return getMonthDailyDates(target.getFullYear(), target.getMonth());
    }
    case PERFORMANCE_PRESETS.LAST_3_MONTHS:
      return buildRecentMonthEnds(3);
    case PERFORMANCE_PRESETS.LAST_6_MONTHS:
      return buildRecentMonthEnds(6);
    case PERFORMANCE_PRESETS.LAST_YEAR:
      return buildRecentMonthEnds(12);
    case PERFORMANCE_PRESETS.YEAR_TO_DATE:
      return buildYearToDateSeries();
    case PERFORMANCE_PRESETS.SPECIFIC_MONTH: {
      if (!specificMonthValue) {
        return [];
      }
      const [year, month] = specificMonthValue.split('-').map(Number);
      if (!year || !month) {
        return [];
      }
      return getMonthDailyDates(year, month - 1);
    }
    case PERFORMANCE_PRESETS.SPECIFIC_YEAR: {
      if (!specificYearValue) {
        return [];
      }
      const parsedYear = parseInt(specificYearValue, 10);
      if (!parsedYear) {
        return [];
      }
      return buildSpecificYearSeries(parsedYear);
    }
    default:
      return buildRecentMonthEnds(6);
  }
};

const DEFAULT_LAYOUTS_STATE = buildInitialLayouts();

const renderColorSwatch = (color) => (
  <Box
    component="span"
    sx={{
      width: 12,
      height: 12,
      borderRadius: '50%',
      display: 'inline-flex',
      border: '1px solid rgba(0,0,0,0.12)',
      backgroundColor: color || '#b0bec5'
    }}
  />
);

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
      <Box display="flex" justifyContent="space-between" alignItems="center" mt={1} sx={{ gap: 2 }}>
        <Box>
          <Typography
            sx={{
              fontWeight: 600,
              fontSize: {
                xs: 'clamp(1.5rem, 6vw, 2.5rem)',
                sm: 'clamp(1.4rem, 4vw, 2.8rem)',
                lg: 'clamp(1.2rem, 2vw, 3rem)'
              },
              lineHeight: 1.1
            }}
          >
            {value}
          </Typography>
          {subtitle && (
            <Typography
              sx={{
                color: color || 'textSecondary',
                fontSize: {
                  xs: 'clamp(0.75rem, 3vw, 0.95rem)',
                  lg: 'clamp(0.8rem, 1vw, 1rem)'
                }
              }}
            >
              {subtitle}
            </Typography>
          )}
        </Box>
        <Box sx={{ color: color || 'primary.main', display: 'flex', alignItems: 'center' }}>
          {icon}
        </Box>
      </Box>
    </CardContent>
  </Card>
);

const Dashboard = () => {
  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [dividendSummary, setDividendSummary] = useState(null);
  const [industryBreakdown, setIndustryBreakdown] = useState([]);
  const [typeBreakdown, setTypeBreakdown] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [datePreset, setDatePreset] = useState(DATE_PRESETS.CURRENT);
  const [specificMonth, setSpecificMonth] = useState('');
  const [endOfYear, setEndOfYear] = useState('');
  const [layouts, setLayouts] = useState(DEFAULT_LAYOUTS_STATE);
  const [currentProfile, setCurrentProfile] = useState('desktop');
  const [layoutLoading, setLayoutLoading] = useState(true);
  const loadedProfiles = useRef(new Set());
  const isReadyToPersist = useRef(false);
  const [performanceRange, setPerformanceRange] = useState(PERFORMANCE_PRESETS.LAST_6_MONTHS);
  const [performanceMonth, setPerformanceMonth] = useState('');
  const [performanceYear, setPerformanceYear] = useState('');
  const [performanceData, setPerformanceData] = useState([]);
  const [performanceLoading, setPerformanceLoading] = useState(false);

  const valuationDate = useMemo(
    () => computeValuationDate(datePreset, specificMonth, endOfYear),
    [datePreset, specificMonth, endOfYear]
  );

  const fetchLayoutForProfile = useCallback(
    async (profile, markReady = false) => {
      try {
        const response = await dashboardAPI.getLayout(profile);
        const serverLayout = response.data?.layout;
        const converted = convertFromServerLayout(serverLayout, profile);
        setLayouts((prev) => ({ ...prev, [profile]: converted }));
      } catch (error) {
        console.error(`Error loading ${profile} dashboard layout:`, error);
        setLayouts((prev) => ({ ...prev, [profile]: getDefaultLayout(profile) }));
      } finally {
        loadedProfiles.current.add(profile);
        if (markReady) {
          setLayoutLoading(false);
          isReadyToPersist.current = true;
        }
      }
    },
    []
  );

  useEffect(() => {
    fetchLayoutForProfile('desktop', true);
  }, [fetchLayoutForProfile]);

  useEffect(() => {
    if (!currentProfile || currentProfile === 'desktop') {
      return;
    }
    if (loadedProfiles.current.has(currentProfile)) {
      return;
    }
    fetchLayoutForProfile(currentProfile);
  }, [currentProfile, fetchLayoutForProfile]);

  const fetchPerformanceSeries = useCallback(async () => {
    const dates = computePerformanceDates(performanceRange, performanceMonth, performanceYear);
    if (dates.length === 0) {
      setPerformanceData([]);
      return;
    }
    setPerformanceLoading(true);
    try {
      const series = await Promise.all(
        dates.map(async (date) => {
          const response = await positionsAPI.getSummary(date);
          const payload = response.data || {};
          return {
            date,
            label: new Date(date).toLocaleDateString(),
            market_value: payload.total_market_value || 0,
            book_value: payload.total_book_value || 0
          };
        })
      );
      setPerformanceData(series);
    } catch (error) {
      console.error('Error fetching performance data:', error);
      setPerformanceData([]);
    } finally {
      setPerformanceLoading(false);
    }
  }, [performanceRange, performanceMonth, performanceYear]);

  useEffect(() => {
    fetchPerformanceSeries();
  }, [fetchPerformanceSeries]);

  useEffect(() => {
    if (layoutLoading) {
      return;
    }

    const fetchData = async () => {
      setFetching(true);
      try {
        const asOfParam = valuationDate || undefined;
        const [summaryRes, accountsRes, dividendsRes, industryRes, typeRes] = await Promise.all([
          positionsAPI.getSummary(asOfParam),
          accountsAPI.getAll(),
          dividendsAPI.getSummary(undefined, undefined, asOfParam),
          positionsAPI.getIndustryBreakdown({ as_of_date: asOfParam }),
          positionsAPI.getTypeBreakdown({ as_of_date: asOfParam })
        ]);

        setSummary(summaryRes.data);
        setAccounts(accountsRes.data);
        setDividendSummary(dividendsRes.data);
        setIndustryBreakdown(industryRes.data || []);
        setTypeBreakdown(typeRes.data || []);
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

const formatPercent = (value) => `${(value ?? 0).toFixed(1)}%`;

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

  const persistLayout = useCallback(async (profile, layout) => {
    try {
      await dashboardAPI.saveLayout(profile, serializeLayout(layout));
    } catch (error) {
      console.error(`Error saving ${profile} dashboard layout:`, error);
    }
  }, []);

  const handleLayoutCommit = useCallback(
    (profile, nextLayout) => {
      if (!nextLayout) {
        return;
      }
      const sanitized = normalizeLayoutForProfile(nextLayout, profile);
      loadedProfiles.current.add(profile);
      setLayouts((prev) => ({ ...prev, [profile]: sanitized }));
      if (isReadyToPersist.current) {
        persistLayout(profile, sanitized);
      }
    },
    [persistLayout]
  );

  const handleResetLayout = async () => {
    try {
      const response = await dashboardAPI.resetLayout(currentProfile);
      const converted = convertFromServerLayout(response.data?.layout, currentProfile);
      loadedProfiles.current.add(currentProfile);
      setLayouts((prev) => ({ ...prev, [currentProfile]: converted }));
    } catch (error) {
      console.error(`Error resetting ${currentProfile} dashboard layout:`, error);
      setLayouts((prev) => ({ ...prev, [currentProfile]: getDefaultLayout(currentProfile) }));
    }
  };

  const handleRefreshPrices = async () => {
    setRefreshing(true);
    try {
      await positionsAPI.refreshPrices();
      // Refetch all data after refreshing prices
      const asOfParam = valuationDate || undefined;
      const [summaryRes, accountsRes, dividendsRes, industryRes, typeRes] = await Promise.all([
        positionsAPI.getSummary(asOfParam),
        accountsAPI.getAll(),
        dividendsAPI.getSummary(undefined, undefined, asOfParam),
        positionsAPI.getIndustryBreakdown({ as_of_date: asOfParam }),
        positionsAPI.getTypeBreakdown({ as_of_date: asOfParam })
      ]);

      setSummary(summaryRes.data);
      setAccounts(accountsRes.data);
      setDividendSummary(dividendsRes.data);
      setIndustryBreakdown(industryRes.data || []);
      setTypeBreakdown(typeRes.data || []);
      await fetchPerformanceSeries();
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
      case 'industry_breakdown':
        return (
          <Paper sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Typography
              variant="caption"
              color="textSecondary"
              className="dashboard-tile-handle"
              sx={{ letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'move', mb: 2 }}
            >
              Industry Breakdown
            </Typography>
            {industryBreakdown.length === 0 ? (
              <Typography color="textSecondary">Classify positions to view this chart.</Typography>
            ) : (
              <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <Box sx={{ height: Math.min(320, Math.max(220, ROW_HEIGHT * (layoutItem?.h || 2) - 260)) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={industryBreakdown}
                        dataKey="market_value"
                        nameKey="industry_name"
                        innerRadius="40%"
                        outerRadius="70%"
                        paddingAngle={2}
                      >
                        {industryBreakdown.map((slice) => (
                          <Cell
                            key={slice.industry_id || 'unclassified'}
                            fill={slice.color || '#b0bec5'}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, name, payload) => [
                          `${formatCurrency(value)} (${formatPercent(payload?.payload?.percentage || 0)})`,
                          payload?.payload?.industry_name || name
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </Box>
                <Stack
                  spacing={1}
                  sx={{
                    mt: 2,
                    flexGrow: 1,
                    overflowY: 'auto',
                    pr: 1,
                    minHeight: 0
                  }}
                >
                  {industryBreakdown.map((slice) => (
                    <Box
                      key={slice.industry_id || 'unclassified'}
                      sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {renderColorSwatch(slice.color)}
                        <Typography variant="body2">{slice.industry_name}</Typography>
                      </Box>
                      <Box textAlign="right">
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {formatCurrency(slice.market_value)}
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                          {formatPercent(slice.percentage)}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Stack>
              </Box>
            )}
          </Paper>
        );
      case 'type_breakdown':
        return (
          <Paper sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Typography
              variant="caption"
              color="textSecondary"
              className="dashboard-tile-handle"
              sx={{ letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'move', mb: 2 }}
            >
              Asset Types
            </Typography>
            {typeBreakdown.length === 0 ? (
              <Typography color="textSecondary">Assign instrument types to view this chart.</Typography>
            ) : (
              <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <Box sx={{ height: Math.min(320, Math.max(220, ROW_HEIGHT * (layoutItem?.h || 2) - 260)) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={typeBreakdown}
                        dataKey="market_value"
                        nameKey="type_name"
                        innerRadius="40%"
                        outerRadius="70%"
                        paddingAngle={2}
                      >
                        {typeBreakdown.map((slice) => (
                          <Cell
                            key={slice.type_id || 'unclassified'}
                            fill={slice.color || '#b0bec5'}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, name, payload) => [
                          `${formatCurrency(value)} (${formatPercent(payload?.payload?.percentage || 0)})`,
                          payload?.payload?.type_name || name
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </Box>
                <Stack
                  spacing={1}
                  sx={{
                    mt: 2,
                    flexGrow: 1,
                    overflowY: 'auto',
                    pr: 1,
                    minHeight: 0
                  }}
                >
                  {typeBreakdown.map((slice) => (
                    <Box
                      key={slice.type_id || 'unclassified'}
                      sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {renderColorSwatch(slice.color)}
                        <Typography variant="body2">{slice.type_name}</Typography>
                      </Box>
                      <Box textAlign="right">
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {formatCurrency(slice.market_value)}
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                          {formatPercent(slice.percentage)}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Stack>
              </Box>
            )}
          </Paper>
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
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              alignItems={{ xs: 'flex-start', md: 'center' }}
              sx={{ mb: 2 }}
            >
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel id="performance-range-label">Range</InputLabel>
                <Select
                  labelId="performance-range-label"
                  value={performanceRange}
                  label="Range"
                  onChange={(event) => setPerformanceRange(event.target.value)}
                >
                  <MenuItem value={PERFORMANCE_PRESETS.LAST_MONTH}>Last Month</MenuItem>
                  <MenuItem value={PERFORMANCE_PRESETS.LAST_3_MONTHS}>Last 3 Months</MenuItem>
                  <MenuItem value={PERFORMANCE_PRESETS.LAST_6_MONTHS}>Last 6 Months</MenuItem>
                  <MenuItem value={PERFORMANCE_PRESETS.LAST_YEAR}>Last Year</MenuItem>
                  <MenuItem value={PERFORMANCE_PRESETS.YEAR_TO_DATE}>Year to Date</MenuItem>
                  <MenuItem value={PERFORMANCE_PRESETS.SPECIFIC_MONTH}>Specific Month</MenuItem>
                  <MenuItem value={PERFORMANCE_PRESETS.SPECIFIC_YEAR}>Specific Year</MenuItem>
                </Select>
              </FormControl>
              {performanceRange === PERFORMANCE_PRESETS.SPECIFIC_MONTH && (
                <TextField
                  label="Month"
                  type="month"
                  size="small"
                  value={performanceMonth}
                  onChange={(event) => setPerformanceMonth(event.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              )}
              {performanceRange === PERFORMANCE_PRESETS.SPECIFIC_YEAR && (
                <TextField
                  label="Year"
                  type="number"
                  size="small"
                  value={performanceYear}
                  onChange={(event) => setPerformanceYear(event.target.value)}
                  InputProps={{ inputProps: { min: 1900, max: 9999 } }}
                />
              )}
            </Stack>
            <Box sx={{ flexGrow: 1, minHeight: ROW_HEIGHT * (layoutItem?.h || 2) - 80 }}>
              {performanceLoading ? (
                <Typography color="textSecondary">Loading performance…</Typography>
              ) : performanceData.length === 0 ? (
                <Typography color="textSecondary">
                  No performance data for the selected range.
                </Typography>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={performanceData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis />
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="market_value"
                      stroke="#1976d2"
                      name="Market Value"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="book_value"
                      stroke="#9c27b0"
                      name="Book Value"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Box>
            <Typography variant="caption" color="textSecondary" sx={{ mt: 2 }}>
              Values are sampled at closing balances for the selected period.
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

      <ResponsiveGridLayout
        className="dashboard-grid"
        layouts={layouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        margin={GRID_MARGIN}
        compactType={null}
        preventCollision={false}
        allowOverlap
        draggableHandle=".dashboard-tile-handle"
        onBreakpointChange={(newBreakpoint) => {
          if (LAYOUT_PROFILES.includes(newBreakpoint)) {
            setCurrentProfile(newBreakpoint);
          }
        }}
        onDragStop={(layout) => handleLayoutCommit(currentProfile, layout)}
        onResizeStop={(layout) => handleLayoutCommit(currentProfile, layout)}
      >
        {(layouts[currentProfile] || []).map((item) => (
          <div key={item.i}>
            {renderTile(item.i, item)}
          </div>
        ))}
      </ResponsiveGridLayout>
    </Container>
  );
};

export default Dashboard;
