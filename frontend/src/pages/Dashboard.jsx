import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Grid,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  IconButton,
  Menu,
  useTheme,
  useMediaQuery,
  Tooltip,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  AccountBalance,
  AttachMoney,
  Refresh,
  Lock,
  LockOpen,
  Menu as MenuIcon,
  Fullscreen,
  FullscreenExit,
  Close
} from '@mui/icons-material';
import { accountsAPI, positionsAPI, dividendsAPI, dashboardAPI, transactionsAPI } from '../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Responsive, WidthProvider, utils as RGLUtils } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);
const { compact } = RGLUtils || {};
const ROW_HEIGHT = 120;
const GRID_MARGIN = [16, 16];
const DRAG_START_DELAY = 300;
const INSIGHT_TABS = [
  { id: 'performance', label: 'Performance', shortLabel: 'Performance' },
  { id: 'types', label: 'Breakdown by Asset Types', shortLabel: 'Asset Types' },
  { id: 'industries', label: 'Breakdown by Industries', shortLabel: 'Industries' }
];
const INSIGHT_AUTO_INTERVAL = 10000;
const INSIGHT_INTERACTION_TIMEOUT = 20000;

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
    { i: 'performance', x: 0, y: 2, w: 12, h: 4, minH: 4 }
  ],
  tablet_landscape: [
    { i: 'book_value', x: 0, y: 0, w: 3, h: 1 },
    { i: 'capital_gains', x: 3, y: 0, w: 3, h: 1 },
    { i: 'dividends', x: 6, y: 0, w: 3, h: 1 },
    { i: 'total_gains', x: 9, y: 0, w: 3, h: 1 },
    { i: 'accounts_summary', x: 0, y: 1, w: 4, h: 1 },
    { i: 'total_value', x: 4, y: 1, w: 4, h: 1 },
    { i: 'performance', x: 0, y: 2, w: 12, h: 4, minH: 4 }
  ],
  tablet_portrait: [
    { i: 'book_value', x: 0, y: 0, w: 4, h: 1 },
    { i: 'capital_gains', x: 4, y: 0, w: 4, h: 1 },
    { i: 'dividends', x: 0, y: 1, w: 4, h: 1 },
    { i: 'total_gains', x: 4, y: 1, w: 4, h: 1 },
    { i: 'accounts_summary', x: 0, y: 2, w: 4, h: 1 },
    { i: 'total_value', x: 4, y: 2, w: 4, h: 1 },
    { i: 'performance', x: 0, y: 3, w: 8, h: 4, minH: 4 }
  ],
  mobile_landscape: [
    { i: 'book_value', x: 0, y: 0, w: 3, h: 1 },
    { i: 'capital_gains', x: 3, y: 0, w: 3, h: 1 },
    { i: 'dividends', x: 0, y: 1, w: 3, h: 1 },
    { i: 'total_gains', x: 3, y: 1, w: 3, h: 1 },
    { i: 'accounts_summary', x: 0, y: 2, w: 3, h: 1 },
    { i: 'total_value', x: 3, y: 2, w: 3, h: 1 },
    { i: 'performance', x: 0, y: 3, w: 6, h: 4, minH: 4 }
  ],
  mobile_portrait: [
    { i: 'book_value', x: 0, y: 0, w: 4, h: 1 },
    { i: 'capital_gains', x: 0, y: 1, w: 4, h: 1 },
    { i: 'dividends', x: 0, y: 2, w: 4, h: 1 },
    { i: 'total_gains', x: 0, y: 3, w: 4, h: 1 },
    { i: 'accounts_summary', x: 0, y: 4, w: 4, h: 1 },
    { i: 'total_value', x: 0, y: 5, w: 4, h: 1 },
    { i: 'performance', x: 0, y: 6, w: 4, h: 5, minH: 5 }
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

const getTileScale = (layoutItem) => {
  if (!layoutItem) {
    return 1;
  }
  const widthFactor = (layoutItem.w || 3) / 3;
  const heightFactor = Math.max(layoutItem.h || 1, 1) / 1.2;
  const combined = (widthFactor + heightFactor) / 2;
  return Math.max(0.75, Math.min(combined, 2));
};

const StatCard = ({ title, value, icon, color, subtitle, sizeFactor = 1 }) => (
  <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <CardContent sx={{
      flexGrow: 1,
      p: { xs: 1, sm: 1.5, md: 2 },
      '&:last-child': { pb: { xs: 1, sm: 1.5, md: 2 } }
    }}>
      <Typography
        variant="caption"
        color="textSecondary"
        className="dashboard-tile-handle"
        sx={{
          letterSpacing: '.05em',
          textTransform: 'uppercase',
          cursor: 'move',
          fontSize: `clamp(${0.5 * sizeFactor}rem, ${2 * sizeFactor}vw, ${0.75 * sizeFactor}rem)`,
          display: 'block',
          mb: 0.5
        }}
      >
        {title}
      </Typography>
      <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ gap: 0.5 }}>
        <Box sx={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
          <Typography
            sx={{
              fontWeight: 600,
              fontSize: `clamp(${0.75 * sizeFactor}rem, ${5 * sizeFactor}vw, ${2.5 * sizeFactor}rem)`,
              lineHeight: 1.1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {value}
          </Typography>
          {subtitle && (
            <Typography
              sx={{
                color: color || 'textSecondary',
                fontSize: `clamp(${0.5 * sizeFactor}rem, ${2.5 * sizeFactor}vw, ${1 * sizeFactor}rem)`,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                lineHeight: 1.2
              }}
            >
              {subtitle}
            </Typography>
          )}
        </Box>
        <Box sx={{
          color: color || 'primary.main',
          display: 'flex',
          alignItems: 'center',
          fontSize: `clamp(${1 * sizeFactor}rem, ${4 * sizeFactor}vw, ${2.5 * sizeFactor}rem)`,
          flexShrink: 0,
          '& > svg': {
            fontSize: 'inherit'
          }
        }}>
          {icon}
        </Box>
      </Box>
    </CardContent>
  </Card>
);

const Dashboard = () => {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [accountBalances, setAccountBalances] = useState({});
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
  const [insightActiveTab, setInsightActiveTab] = useState(INSIGHT_TABS[0].id);
  const [isInsightInteracting, setIsInsightInteracting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const theme = useTheme();
  const isCompactToolbar = useMediaQuery(theme.breakpoints.down('sm'));
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [toolbarMenuAnchor, setToolbarMenuAnchor] = useState(null);
  const isToolbarMenuOpen = Boolean(toolbarMenuAnchor);
  const [isLayoutLocked, setIsLayoutLocked] = useState(true);
  const insightInteractionTimeoutRef = useRef(null);

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

  const clearInsightTimeout = useCallback(() => {
    if (insightInteractionTimeoutRef.current) {
      clearTimeout(insightInteractionTimeoutRef.current);
      insightInteractionTimeoutRef.current = null;
    }
  }, []);

  const pauseInsights = useCallback(() => {
    setIsInsightInteracting(true);
    clearInsightTimeout();
  }, [clearInsightTimeout]);

  const resumeInsightsAfter = useCallback(
    (delay = INSIGHT_INTERACTION_TIMEOUT) => {
      clearInsightTimeout();
      insightInteractionTimeoutRef.current = setTimeout(() => {
        setIsInsightInteracting(false);
      }, delay);
    },
    [clearInsightTimeout]
  );

  const advanceInsightTab = useCallback(() => {
    setInsightActiveTab((prev) => {
      const currentIndex = INSIGHT_TABS.findIndex((tab) => tab.id === prev);
      if (currentIndex === -1) {
        return INSIGHT_TABS[0].id;
      }
      return INSIGHT_TABS[(currentIndex + 1) % INSIGHT_TABS.length].id;
    });
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (isInsightInteracting) {
        return;
      }
      advanceInsightTab();
    }, INSIGHT_AUTO_INTERVAL);

    return () => clearInterval(interval);
  }, [advanceInsightTab, isInsightInteracting]);

  useEffect(
    () => () => {
      clearInsightTimeout();
    },
    [clearInsightTimeout]
  );

  useEffect(() => {
    if (!currentProfile || currentProfile === 'desktop') {
      return;
    }
    if (loadedProfiles.current.has(currentProfile)) {
      return;
    }
    fetchLayoutForProfile(currentProfile);
  }, [currentProfile, fetchLayoutForProfile]);

  const handleToolbarMenuOpen = useCallback((event) => {
    setToolbarMenuAnchor(event.currentTarget);
  }, []);

  const handleToolbarMenuClose = useCallback(() => {
    setToolbarMenuAnchor(null);
  }, []);

  const handleInsightTabChange = useCallback(
    (event, newValue) => {
      if (!newValue) {
        return;
      }
      setInsightActiveTab(newValue);
      pauseInsights();
      resumeInsightsAfter(INSIGHT_INTERACTION_TIMEOUT);
    },
    [pauseInsights, resumeInsightsAfter]
  );

  const handleInsightHover = useCallback(
    (isHovering) => {
      if (isHovering) {
        pauseInsights();
      } else {
        resumeInsightsAfter(2000);
      }
    },
    [pauseInsights, resumeInsightsAfter]
  );

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

  useEffect(() => {
    let isCancelled = false;

    const loadBalances = async () => {
      if (accounts.length === 0) {
        if (!isCancelled) {
          setAccountBalances({});
        }
        return;
      }

      const results = await Promise.all(
        accounts.map(async (account) => {
          try {
            const response = await transactionsAPI.getBalance(account.id);
            const value = response.data?.balance ?? account.balance ?? 0;
            return [account.id, value];
          } catch (error) {
            console.error(`Error fetching balance for account ${account.id}:`, error);
            return [account.id, account.balance ?? 0];
          }
        })
      );

      if (!isCancelled) {
        setAccountBalances(Object.fromEntries(results));
      }
    };

    loadBalances();

    return () => {
      isCancelled = true;
    };
  }, [accounts]);

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

  const totalAccountsBalance = useMemo(() => {
    return Object.values(accountBalances).reduce((sum, balance) => sum + balance, 0);
  }, [accountBalances]);

  const persistLayout = useCallback(async (profile, layout) => {
    try {
      await dashboardAPI.saveLayout(profile, serializeLayout(layout));
    } catch (error) {
      console.error(`Error saving ${profile} dashboard layout:`, error);
    }
  }, []);

  const dragTimeout = useRef(null);

  const commitLayout = useCallback(
    (profile, layout) => {
      const sanitized = normalizeLayoutForProfile(layout, profile);
      loadedProfiles.current.add(profile);
      setLayouts((prev) => ({ ...prev, [profile]: sanitized }));
      if (isReadyToPersist.current) {
        persistLayout(profile, sanitized);
      }
    },
    [persistLayout]
  );

  const handleDragStart = useCallback(() => {
    if (isLayoutLocked) {
      return;
    }
    if (dragTimeout.current) {
      clearTimeout(dragTimeout.current);
    }
    dragTimeout.current = setTimeout(() => {
      dragTimeout.current = null;
    }, DRAG_START_DELAY);
  }, [isLayoutLocked]);

  const handleDragStopCommit = useCallback(
    (profile, layout) => {
      if (isLayoutLocked) {
        return;
      }
      if (dragTimeout.current) {
        clearTimeout(dragTimeout.current);
        dragTimeout.current = null;
        return;
      }
      commitLayout(profile, layout);
    },
    [commitLayout, isLayoutLocked]
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

  const handleRefreshClick = useCallback(() => {
    if (isCompactToolbar) {
      handleToolbarMenuClose();
    }
    handleRefreshPrices();
  }, [isCompactToolbar, handleRefreshPrices, handleToolbarMenuClose]);

  const handleResetClick = useCallback(() => {
    if (isCompactToolbar) {
      handleToolbarMenuClose();
    }
    handleResetLayout();
  }, [isCompactToolbar, handleToolbarMenuClose, handleResetLayout]);

  const handleToggleLock = useCallback(() => {
    if (isCompactToolbar) {
      handleToolbarMenuClose();
    }
    setIsLayoutLocked((prev) => !prev);
  }, [isCompactToolbar, handleToolbarMenuClose]);

  const toolbarControls = (
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
        onClick={handleRefreshClick}
        disabled={refreshing || fetching}
      >
        {refreshing ? 'Refreshing...' : fetching ? 'Updating...' : 'Refresh Prices'}
      </Button>
      <Button variant="outlined" size="small" onClick={handleResetClick}>
        Reset Layout
      </Button>
      <Tooltip title={isLayoutLocked ? 'Unlock layout editing' : 'Lock layout editing'}>
        <IconButton size="small" onClick={handleToggleLock} color={isLayoutLocked ? 'default' : 'primary'}>
          {isLayoutLocked ? <Lock /> : <LockOpen />}
        </IconButton>
      </Tooltip>
    </Stack>
  );

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
    const tileScale = getTileScale(layoutItem);
    switch (id) {
      case 'total_value':
        return (
          <StatCard
            title="Total Portfolio Value"
            value={formatCurrency(summary?.total_market_value || 0)}
            icon={<AccountBalance fontSize="large" />}
            color="primary.main"
            sizeFactor={tileScale}
          />
        );
      case 'book_value':
        return (
          <StatCard
            title="Book Value"
            value={formatCurrency(summary?.total_book_value || 0)}
            icon={<AccountBalance fontSize="large" />}
            color="info.main"
            sizeFactor={tileScale}
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
            sizeFactor={tileScale}
          />
        );
      case 'dividends':
        return (
          <StatCard
            title="Total Dividends"
            value={formatCurrency(totalDividends)}
            icon={<AttachMoney fontSize="large" />}
            color="success.main"
            sizeFactor={tileScale}
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
            sizeFactor={tileScale}
          />
        );
      case 'accounts_summary':
        return (
          <Card
            sx={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              cursor: 'pointer',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: 6
              }
            }}
            onClick={() => navigate('/accounts')}
          >
            <CardContent sx={{
              flexGrow: 1,
              p: { xs: 1, sm: 1.5, md: 2 },
              '&:last-child': { pb: { xs: 1, sm: 1.5, md: 2 } }
            }}>
              <Typography
                variant="caption"
                color="textSecondary"
                className="dashboard-tile-handle"
                sx={{
                  letterSpacing: '.05em',
                  textTransform: 'uppercase',
                  cursor: 'move',
                  fontSize: `clamp(${0.5 * tileScale}rem, ${2 * tileScale}vw, ${0.75 * tileScale}rem)`,
                  display: 'block',
                  mb: 0.5
                }}
              >
                Total Accounts Balance
              </Typography>
              <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ gap: 0.5 }}>
                <Box sx={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                  <Typography
                    sx={{
                      fontWeight: 600,
                      fontSize: `clamp(${0.75 * tileScale}rem, ${5 * tileScale}vw, ${2.5 * tileScale}rem)`,
                      lineHeight: 1.1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {formatCurrency(totalAccountsBalance)}
                  </Typography>
                  <Typography
                    sx={{
                      color: 'textSecondary',
                      fontSize: `clamp(${0.5 * tileScale}rem, ${2.5 * tileScale}vw, ${1 * tileScale}rem)`,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      lineHeight: 1.2
                    }}
                  >
                    {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
                  </Typography>
                </Box>
                <Box sx={{
                  color: 'info.main',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: `clamp(${1 * tileScale}rem, ${4 * tileScale}vw, ${2.5 * tileScale}rem)`,
                  flexShrink: 0,
                  '& > svg': {
                    fontSize: 'inherit'
                  }
                }}>
                  <AccountBalance fontSize="large" />
                </Box>
              </Box>
            </CardContent>
          </Card>
        );
      case 'performance': {
        const chartHeight = Math.max(ROW_HEIGHT * (layoutItem?.h || 2) - 140, 220);

        const renderPieChart = (data, valueKey, nameKey, idKey, emptyMessage) => {
          if (data.length === 0) {
            return <Typography color="textSecondary">{emptyMessage}</Typography>;
          }
          return (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey={valueKey}
                  nameKey={nameKey}
                  innerRadius="25%"
                  outerRadius="90%"
                  paddingAngle={1}
                  cx="50%"
                  cy="50%"
                >
                  {data.map((slice, index) => {
                    const sliceKey = slice[idKey] || slice.id || slice[nameKey] || `${nameKey}-${index}`;
                    return <Cell key={sliceKey} fill={slice.color || '#b0bec5'} />;
                  })}
                </Pie>
                <RechartsTooltip
                  formatter={(value, name, payload) => [
                    `${formatCurrency(value)} (${formatPercent(payload?.payload?.percentage || 0)})`,
                    payload?.payload?.[nameKey] || name
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          );
        };

        let insightBody;
        if (insightActiveTab === 'performance') {
          insightBody = performanceLoading ? (
            <Box display="flex" alignItems="center" justifyContent="center" height="100%" minHeight={200}>
              <Typography color="textSecondary">Loading performance…</Typography>
            </Box>
          ) : performanceData.length === 0 ? (
            <Box display="flex" alignItems="center" justifyContent="center" height="100%" minHeight={200}>
              <Typography color="textSecondary">No performance data for the selected range.</Typography>
            </Box>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={performanceData}
                margin={{
                  top: isMobile ? 5 : 10,
                  right: isMobile ? 5 : 20,
                  left: isMobile ? -20 : 0,
                  bottom: isMobile ? 5 : 10
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: isMobile ? 10 : 12 }}
                  tickMargin={isMobile ? 5 : 10}
                />
                <YAxis
                  tick={{ fontSize: isMobile ? 10 : 12 }}
                  tickFormatter={(value) => {
                    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
                    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
                    return `$${value}`;
                  }}
                />
                <RechartsTooltip
                  formatter={(value) => formatCurrency(value)}
                  contentStyle={{
                    fontSize: isMobile ? 12 : 14,
                    borderRadius: 8,
                    border: '1px solid #e0e0e0'
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: isMobile ? 12 : 14 }}
                  iconSize={isMobile ? 10 : 14}
                />
                <Line
                  type="monotone"
                  dataKey="market_value"
                  stroke="#1976d2"
                  strokeWidth={isMobile ? 2 : 3}
                  name="Market Value"
                  dot={false}
                  activeDot={{ r: isMobile ? 4 : 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="book_value"
                  stroke="#9c27b0"
                  strokeWidth={isMobile ? 2 : 3}
                  name="Book Value"
                  dot={false}
                  activeDot={{ r: isMobile ? 4 : 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          );
        } else if (insightActiveTab === 'types') {
          insightBody = typeBreakdown.length === 0 ? (
            <Box display="flex" alignItems="center" justifyContent="center" height="100%" minHeight={200}>
              <Typography color="textSecondary">Assign instrument types to view this breakdown.</Typography>
            </Box>
          ) : (
            <Grid container spacing={{ xs: 2, sm: 3 }} sx={{ height: '100%' }}>
              <Grid item xs={12} md={6} sx={{ height: { xs: 280, sm: 320, md: '100%' }, minWidth: 0 }}>
                <Box sx={{ height: '100%', minHeight: { xs: 250, sm: 280 } }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={typeBreakdown}
                        dataKey="market_value"
                        nameKey="type_name"
                        innerRadius={isMobile ? "35%" : "25%"}
                        outerRadius={isMobile ? "75%" : "90%"}
                        paddingAngle={1}
                        cx="50%"
                        cy="50%"
                      >
                        {typeBreakdown.map((slice) => (
                          <Cell
                            key={slice.type_id || 'unclassified'}
                            fill={slice.color || '#b0bec5'}
                          />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        formatter={(value, name, payload) => [
                          `${formatCurrency(value)} (${formatPercent(payload?.payload?.percentage || 0)})`,
                          payload?.payload?.type_name || name
                        ]}
                        contentStyle={{
                          fontSize: isMobile ? 12 : 14,
                          borderRadius: 8,
                          border: '1px solid #e0e0e0'
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </Box>
              </Grid>
              <Grid item xs={12} md={6} sx={{ minWidth: 0, height: { xs: 'auto', md: '100%' } }}>
                <Box sx={{
                  height: { xs: 'auto', md: '100%' },
                  maxHeight: { xs: 400, md: '100%' },
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  p: { xs: 1.5, sm: 2 },
                  bgcolor: 'background.default',
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider'
                }}>
                  <Typography variant="subtitle2" sx={{ mb: { xs: 1.5, sm: 2 }, fontWeight: 600, flexShrink: 0, fontSize: { xs: '0.875rem', sm: '1rem' } }}>
                    Asset Types Breakdown
                  </Typography>
                  <Stack spacing={{ xs: 1, sm: 1.5 }} sx={{
                    flexGrow: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    pr: 1,
                    minHeight: 0,
                    maxHeight: { xs: 350, md: 'none' }
                  }}>
                    {typeBreakdown.map((slice) => (
                      <Box
                        key={slice.type_id || 'unclassified'}
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexShrink: 0,
                          p: { xs: 1, sm: 1.5 },
                          bgcolor: 'background.paper',
                          borderRadius: 1,
                          '&:hover': {
                            bgcolor: 'action.hover'
                          }
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 }, minWidth: 0, flexShrink: 1 }}>
                          {renderColorSwatch(slice.color)}
                          <Typography
                            variant="body2"
                            noWrap
                            sx={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              fontSize: { xs: '0.8125rem', sm: '0.875rem' },
                              fontWeight: 500
                            }}
                          >
                            {slice.type_name}
                          </Typography>
                        </Box>
                        <Box textAlign="right" sx={{ flexShrink: 0, ml: 2 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap', fontSize: { xs: '0.8125rem', sm: '0.875rem' } }}>
                            {formatCurrency(slice.market_value)}
                          </Typography>
                          <Typography variant="caption" color="textSecondary" sx={{ fontSize: { xs: '0.6875rem', sm: '0.75rem' } }}>
                            {formatPercent(slice.percentage)}
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              </Grid>
            </Grid>
          );
        } else {
          insightBody = industryBreakdown.length === 0 ? (
            <Box display="flex" alignItems="center" justifyContent="center" height="100%" minHeight={200}>
              <Typography color="textSecondary">Classify positions to view this breakdown.</Typography>
            </Box>
          ) : (
            <Grid container spacing={{ xs: 2, sm: 3 }} sx={{ height: '100%' }}>
              <Grid item xs={12} md={6} sx={{ height: { xs: 280, sm: 320, md: '100%' }, minWidth: 0 }}>
                <Box sx={{ height: '100%', minHeight: { xs: 250, sm: 280 } }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={industryBreakdown}
                        dataKey="market_value"
                        nameKey="industry_name"
                        innerRadius={isMobile ? "35%" : "25%"}
                        outerRadius={isMobile ? "75%" : "90%"}
                        paddingAngle={1}
                        cx="50%"
                        cy="50%"
                      >
                        {industryBreakdown.map((slice) => (
                          <Cell
                            key={slice.industry_id || 'unclassified'}
                            fill={slice.color || '#b0bec5'}
                          />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        formatter={(value, name, payload) => [
                          `${formatCurrency(value)} (${formatPercent(payload?.payload?.percentage || 0)})`,
                          payload?.payload?.industry_name || name
                        ]}
                        contentStyle={{
                          fontSize: isMobile ? 12 : 14,
                          borderRadius: 8,
                          border: '1px solid #e0e0e0'
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </Box>
              </Grid>
              <Grid item xs={12} md={6} sx={{ minWidth: 0, height: { xs: 'auto', md: '100%' } }}>
                <Box sx={{
                  height: { xs: 'auto', md: '100%' },
                  maxHeight: { xs: 400, md: '100%' },
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  p: { xs: 1.5, sm: 2 },
                  bgcolor: 'background.default',
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider'
                }}>
                  <Typography variant="subtitle2" sx={{ mb: { xs: 1.5, sm: 2 }, fontWeight: 600, flexShrink: 0, fontSize: { xs: '0.875rem', sm: '1rem' } }}>
                    Industry Breakdown
                  </Typography>
                  <Stack spacing={{ xs: 1, sm: 1.5 }} sx={{
                    flexGrow: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    pr: 1,
                    minHeight: 0,
                    maxHeight: { xs: 350, md: 'none' }
                  }}>
                    {industryBreakdown.map((slice) => (
                      <Box
                        key={slice.industry_id || 'unclassified'}
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexShrink: 0,
                          p: { xs: 1, sm: 1.5 },
                          bgcolor: 'background.paper',
                          borderRadius: 1,
                          '&:hover': {
                            bgcolor: 'action.hover'
                          }
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 }, minWidth: 0, flexShrink: 1 }}>
                          {renderColorSwatch(slice.color)}
                          <Typography
                            variant="body2"
                            noWrap
                            sx={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              fontSize: { xs: '0.8125rem', sm: '0.875rem' },
                              fontWeight: 500
                            }}
                          >
                            {slice.industry_name}
                          </Typography>
                        </Box>
                        <Box textAlign="right" sx={{ flexShrink: 0, ml: 2 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap', fontSize: { xs: '0.8125rem', sm: '0.875rem' } }}>
                            {formatCurrency(slice.market_value)}
                          </Typography>
                          <Typography variant="caption" color="textSecondary" sx={{ fontSize: { xs: '0.6875rem', sm: '0.75rem' } }}>
                            {formatPercent(slice.percentage)}
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              </Grid>
            </Grid>
          );
        }

        const footerText =
          insightActiveTab === 'performance'
            ? 'Values are sampled at closing balances for the selected period.'
            : insightActiveTab === 'types'
              ? 'Allocation based on the instrument type assigned to each position.'
              : 'Breakdown based on industry classifications.';

        return (
          <Paper
            sx={{
              p: { xs: 2, sm: 2.5, md: 3 },
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: { xs: 1, sm: 2 }
            }}
            onMouseEnter={() => handleInsightHover(true)}
            onMouseLeave={() => handleInsightHover(false)}
          >
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', md: 'center' }}
              flexWrap="wrap"
              gap={{ xs: 1, sm: 1.5 }}
              className="dashboard-tile-handle"
              sx={{ cursor: 'move' }}
            >
              <Box>
                <Typography
                  variant="caption"
                  color="textSecondary"
                  sx={{
                    letterSpacing: '.05em',
                    textTransform: 'uppercase',
                    fontSize: { xs: '0.625rem', sm: '0.6875rem', md: '0.75rem' },
                    fontWeight: 600
                  }}
                >
                  Portfolio Insights
                </Typography>
                <Typography
                  variant="body2"
                  color="textSecondary"
                  sx={{ fontSize: { xs: '0.75rem', sm: '0.8125rem', md: '0.875rem' }, mt: 0.5 }}
                >
                  {insightActiveTab === 'performance' ? `As of ${asOfLabel}` : 'Auto rotating highlights'}
                </Typography>
              </Box>
              <Box display="flex" alignItems="center" gap={1}>
                <Tooltip title="View fullscreen">
                  <IconButton
                    size="small"
                    onClick={() => setIsFullscreen(true)}
                    sx={{
                      color: 'primary.main',
                      '&:hover': {
                        bgcolor: 'primary.light',
                        color: 'primary.dark'
                      }
                    }}
                  >
                    <Fullscreen />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
            <Box sx={{ width: '100%', mt: { xs: 1, sm: 1.5 } }}>
              <Tabs
                value={insightActiveTab}
                onChange={handleInsightTabChange}
                variant={isMobile ? "fullWidth" : "standard"}
                scrollButtons="auto"
                textColor="primary"
                indicatorColor="primary"
                sx={{
                  minHeight: 'auto',
                  borderBottom: 1,
                  borderColor: 'divider',
                  '& .MuiTabs-flexContainer': {
                    gap: { xs: 0, sm: 0.5 }
                  },
                  '& .MuiTab-root': {
                    fontSize: { xs: '0.75rem', sm: '0.875rem', md: '0.9375rem' },
                    minHeight: { xs: 44, sm: 48 },
                    minWidth: { xs: 'auto', sm: 120 },
                    px: { xs: 1, sm: 2, md: 3 },
                    py: { xs: 1, sm: 1.5 },
                    fontWeight: 500,
                    textTransform: 'none',
                    color: 'text.secondary',
                    '&.Mui-selected': {
                      color: 'primary.main',
                      fontWeight: 600
                    },
                    '& .MuiTouchRipple-root': {
                      borderRadius: 1
                    }
                  },
                  '& .MuiTabs-indicator': {
                    height: 3,
                    borderRadius: '3px 3px 0 0'
                  }
                }}
              >
                {INSIGHT_TABS.map((tab) => (
                  <Tab
                    key={tab.id}
                    label={isMobile ? tab.shortLabel : tab.label}
                    value={tab.id}
                  />
                ))}
              </Tabs>
            </Box>

            {insightActiveTab === 'performance' && (
              <Box
                sx={{
                  mt: { xs: 1.5, sm: 2 },
                  mb: { xs: 1, sm: 1.5 },
                  p: { xs: 1.5, sm: 2 },
                  bgcolor: 'background.default',
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider'
                }}
              >
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={{ xs: 1.5, sm: 2 }}
                  alignItems={{ xs: 'stretch', sm: 'flex-end' }}
                >
                  <FormControl
                    size="small"
                    sx={{
                      flex: { xs: 1, sm: '0 0 auto' },
                      minWidth: { xs: '100%', sm: 200 }
                    }}
                  >
                    <InputLabel id="performance-range-label">Time Range</InputLabel>
                    <Select
                      labelId="performance-range-label"
                      value={performanceRange}
                      label="Time Range"
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
                      label="Select Month"
                      type="month"
                      size="small"
                      value={performanceMonth}
                      onChange={(event) => setPerformanceMonth(event.target.value)}
                      InputLabelProps={{ shrink: true }}
                      sx={{
                        flex: { xs: 1, sm: '0 0 auto' },
                        minWidth: { xs: '100%', sm: 180 }
                      }}
                    />
                  )}
                  {performanceRange === PERFORMANCE_PRESETS.SPECIFIC_YEAR && (
                    <TextField
                      label="Select Year"
                      type="number"
                      size="small"
                      value={performanceYear}
                      onChange={(event) => setPerformanceYear(event.target.value)}
                      InputProps={{ inputProps: { min: 1900, max: 9999 } }}
                      sx={{
                        flex: { xs: 1, sm: '0 0 auto' },
                        minWidth: { xs: '100%', sm: 150 }
                      }}
                    />
                  )}
                </Stack>
              </Box>
            )}

            <Box sx={{ flexGrow: 1, minHeight: chartHeight, mt: { xs: 1.5, sm: 2 } }}>{insightBody}</Box>

            <Typography
              variant="caption"
              color="textSecondary"
              sx={{
                mt: { xs: 1.5, sm: 2 },
                fontSize: { xs: '0.6875rem', sm: '0.75rem' },
                fontStyle: 'italic',
                display: 'block',
                p: { xs: 1, sm: 1.5 },
                bgcolor: 'action.hover',
                borderRadius: 1,
                borderLeft: 3,
                borderColor: 'primary.main'
              }}
            >
              {footerText}
            </Typography>

            {/* Fullscreen Dialog */}
            <Dialog
              fullScreen
              open={isFullscreen}
              onClose={() => setIsFullscreen(false)}
              TransitionProps={{
                onEntered: () => {
                  // Prevent interaction timeout when in fullscreen
                  setIsInsightInteracting(true);
                },
                onExited: () => {
                  setIsInsightInteracting(false);
                }
              }}
            >
              <DialogTitle
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  bgcolor: 'background.paper',
                  borderBottom: 1,
                  borderColor: 'divider',
                  p: { xs: 2, sm: 3 }
                }}
              >
                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 600, fontSize: { xs: '1.125rem', sm: '1.25rem' } }}>
                    Portfolio Insights - {INSIGHT_TABS.find(tab => tab.id === insightActiveTab)?.label}
                  </Typography>
                  <Typography variant="body2" color="textSecondary" sx={{ mt: 0.5, fontSize: { xs: '0.8125rem', sm: '0.875rem' } }}>
                    {insightActiveTab === 'performance' ? `As of ${asOfLabel}` : 'Auto rotating highlights'}
                  </Typography>
                </Box>
                <IconButton
                  edge="end"
                  color="inherit"
                  onClick={() => setIsFullscreen(false)}
                  aria-label="close fullscreen"
                  sx={{
                    color: 'text.secondary',
                    '&:hover': {
                      bgcolor: 'action.hover'
                    }
                  }}
                >
                  <Close />
                </IconButton>
              </DialogTitle>

              <DialogContent
                sx={{
                  p: { xs: 2, sm: 3, md: 4 },
                  bgcolor: 'background.default',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: { xs: 2, sm: 3 }
                }}
              >
                {/* Tabs in fullscreen */}
                <Box>
                  <Tabs
                    value={insightActiveTab}
                    onChange={handleInsightTabChange}
                    variant={isMobile ? "fullWidth" : "standard"}
                    textColor="primary"
                    indicatorColor="primary"
                    sx={{
                      borderBottom: 1,
                      borderColor: 'divider',
                      '& .MuiTab-root': {
                        fontSize: { xs: '0.875rem', sm: '1rem' },
                        minHeight: 48,
                        px: { xs: 2, sm: 3 },
                        fontWeight: 500,
                        textTransform: 'none',
                        '&.Mui-selected': {
                          fontWeight: 600
                        }
                      },
                      '& .MuiTabs-indicator': {
                        height: 3
                      }
                    }}
                  >
                    {INSIGHT_TABS.map((tab) => (
                      <Tab
                        key={tab.id}
                        label={tab.label}
                        value={tab.id}
                      />
                    ))}
                  </Tabs>
                </Box>

                {/* Performance controls in fullscreen */}
                {insightActiveTab === 'performance' && (
                  <Box
                    sx={{
                      p: { xs: 2, sm: 3 },
                      bgcolor: 'background.paper',
                      borderRadius: 2,
                      border: 1,
                      borderColor: 'divider'
                    }}
                  >
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={{ xs: 2, sm: 3 }}
                      alignItems={{ xs: 'stretch', sm: 'flex-end' }}
                    >
                      <FormControl
                        size="medium"
                        sx={{
                          flex: { xs: 1, sm: '0 0 auto' },
                          minWidth: { xs: '100%', sm: 200 }
                        }}
                      >
                        <InputLabel id="fullscreen-performance-range-label">Time Range</InputLabel>
                        <Select
                          labelId="fullscreen-performance-range-label"
                          value={performanceRange}
                          label="Time Range"
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
                          label="Select Month"
                          type="month"
                          size="medium"
                          value={performanceMonth}
                          onChange={(event) => setPerformanceMonth(event.target.value)}
                          InputLabelProps={{ shrink: true }}
                          sx={{
                            flex: { xs: 1, sm: '0 0 auto' },
                            minWidth: { xs: '100%', sm: 180 }
                          }}
                        />
                      )}
                      {performanceRange === PERFORMANCE_PRESETS.SPECIFIC_YEAR && (
                        <TextField
                          label="Select Year"
                          type="number"
                          size="medium"
                          value={performanceYear}
                          onChange={(event) => setPerformanceYear(event.target.value)}
                          InputProps={{ inputProps: { min: 1900, max: 9999 } }}
                          sx={{
                            flex: { xs: 1, sm: '0 0 auto' },
                            minWidth: { xs: '100%', sm: 150 }
                          }}
                        />
                      )}
                    </Stack>
                  </Box>
                )}

                {/* Chart content in fullscreen */}
                <Box
                  sx={{
                    flexGrow: 1,
                    minHeight: { xs: 400, sm: 500, md: 600 },
                    bgcolor: 'background.paper',
                    borderRadius: 2,
                    p: { xs: 2, sm: 3 },
                    border: 1,
                    borderColor: 'divider'
                  }}
                >
                  {insightBody}
                </Box>

                {/* Footer info in fullscreen */}
                <Typography
                  variant="body2"
                  color="textSecondary"
                  sx={{
                    fontStyle: 'italic',
                    p: { xs: 1.5, sm: 2 },
                    bgcolor: 'info.lighter',
                    borderRadius: 1,
                    borderLeft: 3,
                    borderColor: 'primary.main'
                  }}
                >
                  {footerText}
                </Typography>
              </DialogContent>
            </Dialog>
          </Paper>
        );
      }
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
        {isCompactToolbar ? (
          <>
            <IconButton size="small" onClick={handleToolbarMenuOpen}>
              <MenuIcon />
            </IconButton>
            <Menu
              anchorEl={toolbarMenuAnchor}
              open={isToolbarMenuOpen}
              onClose={handleToolbarMenuClose}
              keepMounted
            >
              <Box sx={{ p: 2, maxWidth: 300 }}>{toolbarControls}</Box>
            </Menu>
          </>
        ) : (
          toolbarControls
        )}
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
        isDraggable={!isLayoutLocked}
        isResizable={!isLayoutLocked}
        draggableHandle=".dashboard-tile-handle"
        onBreakpointChange={(newBreakpoint) => {
          if (LAYOUT_PROFILES.includes(newBreakpoint)) {
            setCurrentProfile(newBreakpoint);
          }
        }}
        onDragStart={!isLayoutLocked ? () => handleDragStart() : undefined}
        onDragStop={!isLayoutLocked ? (layout) => handleDragStopCommit(currentProfile, layout) : undefined}
        onResizeStop={!isLayoutLocked ? (layout) => commitLayout(currentProfile, layout) : undefined}
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
