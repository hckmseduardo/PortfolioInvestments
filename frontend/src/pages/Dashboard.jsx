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
import { accountsAPI, positionsAPI, dividendsAPI, dashboardAPI, transactionsAPI, securityMetadataAPI } from '../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Responsive, WidthProvider, utils as RGLUtils } from 'react-grid-layout';
import PortfolioAllocationCard from '../components/PortfolioAllocationCard';
import PortfolioBreakdownCard from '../components/PortfolioBreakdownCard';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);
const { compact } = RGLUtils || {};
const ROW_HEIGHT = 120;
const GRID_MARGIN = [16, 16];
const DRAG_START_DELAY = 300;
const INSIGHT_TABS = [
  { id: 'performance', label: 'Performance', shortLabel: 'Performance' },
  { id: 'types', label: 'Breakdown by Security Types', shortLabel: 'Security Types' },
  { id: 'subtypes', label: 'Breakdown by Subtypes', shortLabel: 'Subtypes' },
  { id: 'sectors', label: 'Breakdown by Sectors', shortLabel: 'Sectors' },
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
    { i: 'checking_balance', x: 0, y: 2, w: 4, h: 1 },
    { i: 'mortgage_balance', x: 4, y: 2, w: 4, h: 1 },
    { i: 'credit_card_balance', x: 8, y: 2, w: 4, h: 1 },
    { i: 'portfolio_allocation', x: 0, y: 3, w: 6, h: 4, minH: 4 },
    { i: 'portfolio_breakdown', x: 6, y: 3, w: 6, h: 4, minH: 4 }
  ],
  tablet_landscape: [
    { i: 'book_value', x: 0, y: 0, w: 3, h: 1 },
    { i: 'capital_gains', x: 3, y: 0, w: 3, h: 1 },
    { i: 'dividends', x: 6, y: 0, w: 3, h: 1 },
    { i: 'total_gains', x: 9, y: 0, w: 3, h: 1 },
    { i: 'accounts_summary', x: 0, y: 1, w: 4, h: 1 },
    { i: 'total_value', x: 4, y: 1, w: 4, h: 1 },
    { i: 'checking_balance', x: 0, y: 2, w: 4, h: 1 },
    { i: 'mortgage_balance', x: 4, y: 2, w: 4, h: 1 },
    { i: 'credit_card_balance', x: 8, y: 2, w: 4, h: 1 },
    { i: 'portfolio_allocation', x: 0, y: 3, w: 6, h: 4, minH: 4 },
    { i: 'portfolio_breakdown', x: 6, y: 3, w: 6, h: 4, minH: 4 }
  ],
  tablet_portrait: [
    { i: 'book_value', x: 0, y: 0, w: 4, h: 1 },
    { i: 'capital_gains', x: 4, y: 0, w: 4, h: 1 },
    { i: 'dividends', x: 0, y: 1, w: 4, h: 1 },
    { i: 'total_gains', x: 4, y: 1, w: 4, h: 1 },
    { i: 'accounts_summary', x: 0, y: 2, w: 4, h: 1 },
    { i: 'total_value', x: 4, y: 2, w: 4, h: 1 },
    { i: 'checking_balance', x: 0, y: 3, w: 4, h: 1 },
    { i: 'mortgage_balance', x: 4, y: 3, w: 4, h: 1 },
    { i: 'credit_card_balance', x: 0, y: 4, w: 4, h: 1 },
    { i: 'portfolio_allocation', x: 0, y: 5, w: 4, h: 4, minH: 4 },
    { i: 'portfolio_breakdown', x: 4, y: 5, w: 4, h: 4, minH: 4 }
  ],
  mobile_landscape: [
    { i: 'book_value', x: 0, y: 0, w: 3, h: 1 },
    { i: 'capital_gains', x: 3, y: 0, w: 3, h: 1 },
    { i: 'dividends', x: 0, y: 1, w: 3, h: 1 },
    { i: 'total_gains', x: 3, y: 1, w: 3, h: 1 },
    { i: 'accounts_summary', x: 0, y: 2, w: 3, h: 1 },
    { i: 'total_value', x: 3, y: 2, w: 3, h: 1 },
    { i: 'checking_balance', x: 0, y: 3, w: 3, h: 1 },
    { i: 'mortgage_balance', x: 3, y: 3, w: 3, h: 1 },
    { i: 'credit_card_balance', x: 0, y: 4, w: 3, h: 1 },
    { i: 'portfolio_allocation', x: 0, y: 5, w: 3, h: 4, minH: 4 },
    { i: 'portfolio_breakdown', x: 3, y: 5, w: 3, h: 4, minH: 4 }
  ],
  mobile_portrait: [
    { i: 'book_value', x: 0, y: 0, w: 4, h: 1 },
    { i: 'capital_gains', x: 0, y: 1, w: 4, h: 1 },
    { i: 'dividends', x: 0, y: 2, w: 4, h: 1 },
    { i: 'total_gains', x: 0, y: 3, w: 4, h: 1 },
    { i: 'accounts_summary', x: 0, y: 4, w: 4, h: 1 },
    { i: 'total_value', x: 0, y: 5, w: 4, h: 1 },
    { i: 'checking_balance', x: 0, y: 6, w: 4, h: 1 },
    { i: 'mortgage_balance', x: 0, y: 7, w: 4, h: 1 },
    { i: 'credit_card_balance', x: 0, y: 8, w: 4, h: 1 },
    { i: 'portfolio_allocation', x: 0, y: 9, w: 4, h: 4, minH: 4 },
    { i: 'portfolio_breakdown', x: 0, y: 13, w: 4, h: 4, minH: 4 }
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
  const [checkingBalance, setCheckingBalance] = useState(0);
  const [mortgageBalance, setMortgageBalance] = useState(0);
  const [creditCardBalance, setCreditCardBalance] = useState(0);
  const [dividendSummary, setDividendSummary] = useState(null);
  const [industryBreakdown, setIndustryBreakdown] = useState([]);
  const [typeBreakdown, setTypeBreakdown] = useState([]);
  const [sectorBreakdown, setSectorBreakdown] = useState([]);
  const [subtypeBreakdown, setSubtypeBreakdown] = useState([]);
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

  // Portfolio breakdown state
  const [portfolioBreakdownType, setPortfolioBreakdownType] = useState('type');
  const [portfolioCarouselEnabled, setPortfolioCarouselEnabled] = useState(true);
  const [securityTypeColors, setSecurityTypeColors] = useState({});
  const [securitySubtypeColors, setSecuritySubtypeColors] = useState({});
  const [sectorColors, setSectorColors] = useState({});
  const [industryColors, setIndustryColors] = useState({});

  const valuationDate = useMemo(
    () => computeValuationDate(datePreset, specificMonth, endOfYear),
    [datePreset, specificMonth, endOfYear]
  );

  // Transform breakdown data for portfolio components
  const portfolioTypeSlices = useMemo(() => {
    console.log('Dashboard - typeBreakdown:', typeBreakdown);
    const transformed = typeBreakdown.map(item => ({ name: item.type_name, market_value: item.market_value, percentage: item.percentage }));
    console.log('Dashboard - portfolioTypeSlices:', transformed);
    return transformed;
  }, [typeBreakdown]);

  const portfolioSubtypeSlices = useMemo(() =>
    subtypeBreakdown.map(item => ({ name: item.subtype_name, market_value: item.market_value, percentage: item.percentage })),
    [subtypeBreakdown]
  );

  const portfolioSectorSlices = useMemo(() =>
    sectorBreakdown.map(item => ({ name: item.sector_name, market_value: item.market_value, percentage: item.percentage })),
    [sectorBreakdown]
  );

  const portfolioIndustrySlices = useMemo(() =>
    industryBreakdown.map(item => ({ name: item.industry_name, market_value: item.market_value, percentage: item.percentage })),
    [industryBreakdown]
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

  // Portfolio breakdown handlers
  const handlePortfolioBreakdownTypeChange = useCallback((event, newValue) => {
    setPortfolioCarouselEnabled(false);
    setPortfolioBreakdownType(newValue);
  }, []);

  const handlePortfolioCarouselToggle = useCallback(() => {
    setPortfolioCarouselEnabled(prev => !prev);
  }, []);

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
        const [summaryRes, accountsRes, dividendsRes, positionsRes] = await Promise.all([
          positionsAPI.getSummary(asOfParam),
          accountsAPI.getAll(),
          dividendsAPI.getSummary(undefined, undefined, asOfParam),
          positionsAPI.getAggregated(null, asOfParam) // Fetch positions to calculate breakdowns client-side
        ]);

        setSummary(summaryRes.data);
        setAccounts(accountsRes.data);
        setDividendSummary(dividendsRes.data);

        // Calculate breakdowns client-side from positions (same as Portfolio section)
        let positions = positionsRes.data || [];
        console.log('Dashboard fetchData - positions (first try):', positions);
        console.log('Dashboard fetchData - positions.length:', positions.length);

        // If no positions for the requested date and we're looking at current, fetch the last month-end positions
        if (positions.length === 0 && !valuationDate) {
          console.log('Dashboard fetchData - No current positions, fetching last month-end...');
          const now = new Date();
          const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
          const lastMonthEndDate = lastMonthEnd.toISOString().split('T')[0];
          console.log('Dashboard fetchData - Fetching for date:', lastMonthEndDate);
          const lastPositionsRes = await positionsAPI.getAggregated(null, lastMonthEndDate);
          positions = lastPositionsRes.data || [];
          console.log('Dashboard fetchData - last positions:', positions);
          console.log('Dashboard fetchData - last positions.length:', positions.length);
        }

        const totalMarketValue = positions.reduce((sum, pos) => sum + (pos.market_value || 0), 0);
        console.log('Dashboard fetchData - totalMarketValue:', totalMarketValue);

        // Calculate industry breakdown
        const industryMap = {};
        const typeMap = {};
        const subtypeMap = {};
        const sectorMap = {};

        positions.forEach(pos => {
          if (pos.industry) {
            if (!industryMap[pos.industry]) {
              industryMap[pos.industry] = { industry_name: pos.industry, market_value: 0, position_count: 0, color: null };
            }
            industryMap[pos.industry].market_value += pos.market_value || 0;
            industryMap[pos.industry].position_count += 1;
          }

          if (pos.security_type) {
            if (!typeMap[pos.security_type]) {
              typeMap[pos.security_type] = { type_name: pos.security_type, market_value: 0, position_count: 0, color: null };
            }
            typeMap[pos.security_type].market_value += pos.market_value || 0;
            typeMap[pos.security_type].position_count += 1;
          }

          if (pos.security_subtype) {
            if (!subtypeMap[pos.security_subtype]) {
              subtypeMap[pos.security_subtype] = { subtype_name: pos.security_subtype, market_value: 0, position_count: 0, color: null };
            }
            subtypeMap[pos.security_subtype].market_value += pos.market_value || 0;
            subtypeMap[pos.security_subtype].position_count += 1;
          }

          if (pos.sector) {
            if (!sectorMap[pos.sector]) {
              sectorMap[pos.sector] = { sector_name: pos.sector, market_value: 0, position_count: 0, color: null };
            }
            sectorMap[pos.sector].market_value += pos.market_value || 0;
            sectorMap[pos.sector].position_count += 1;
          }
        });

        // Convert to arrays with percentages
        const industryBreakdownData = Object.values(industryMap).map(item => ({
          ...item,
          percentage: totalMarketValue ? (item.market_value / totalMarketValue) * 100 : 0
        }));

        const typeBreakdownData = Object.values(typeMap).map(item => ({
          ...item,
          percentage: totalMarketValue ? (item.market_value / totalMarketValue) * 100 : 0
        }));

        const subtypeBreakdownData = Object.values(subtypeMap).map(item => ({
          ...item,
          percentage: totalMarketValue ? (item.market_value / totalMarketValue) * 100 : 0
        }));

        const sectorBreakdownData = Object.values(sectorMap).map(item => ({
          ...item,
          percentage: totalMarketValue ? (item.market_value / totalMarketValue) * 100 : 0
        }));

        console.log('Dashboard fetchData - typeBreakdownData:', typeBreakdownData);
        console.log('Dashboard fetchData - subtypeBreakdownData:', subtypeBreakdownData);
        console.log('Dashboard fetchData - sectorBreakdownData:', sectorBreakdownData);
        console.log('Dashboard fetchData - industryBreakdownData:', industryBreakdownData);

        setIndustryBreakdown(industryBreakdownData);
        setTypeBreakdown(typeBreakdownData);
        setSectorBreakdown(sectorBreakdownData);
        setSubtypeBreakdown(subtypeBreakdownData);
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setFetching(false);
        setLoading(false);
      }
    };

    fetchData();
  }, [valuationDate, layoutLoading]);

  // Load security metadata colors
  useEffect(() => {
    const loadSecurityMetadata = async () => {
      try {
        const [typesRes, subtypesRes, sectorsRes, industriesRes] = await Promise.all([
          securityMetadataAPI.getTypes(),
          securityMetadataAPI.getSubtypes(),
          securityMetadataAPI.getSectors(),
          securityMetadataAPI.getIndustries()
        ]);

        const typeColorMap = {};
        (typesRes.data || []).forEach(item => {
          typeColorMap[item.name] = item.color;
        });
        setSecurityTypeColors(typeColorMap);

        const subtypeColorMap = {};
        (subtypesRes.data || []).forEach(item => {
          subtypeColorMap[item.name] = item.color;
        });
        setSecuritySubtypeColors(subtypeColorMap);

        const sectorColorMap = {};
        (sectorsRes.data || []).forEach(item => {
          sectorColorMap[item.name] = item.color;
        });
        setSectorColors(sectorColorMap);

        const industryColorMap = {};
        (industriesRes.data || []).forEach(item => {
          industryColorMap[item.name] = item.color;
        });
        setIndustryColors(industryColorMap);
      } catch (error) {
        console.error('Error loading security metadata:', error);
      }
    };

    loadSecurityMetadata();
  }, []);

  // Portfolio carousel auto-advance effect
  useEffect(() => {
    if (!portfolioCarouselEnabled) return;

    const breakdownTypes = ['type', 'subtype', 'sector', 'industry'];
    const interval = setInterval(() => {
      setPortfolioBreakdownType(prev => {
        const currentIndex = breakdownTypes.indexOf(prev);
        const nextIndex = (currentIndex + 1) % breakdownTypes.length;
        return breakdownTypes[nextIndex];
      });
    }, 5000); // Change every 5 seconds

    return () => clearInterval(interval);
  }, [portfolioCarouselEnabled]);

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

  // Calculate aggregated balances by account type
  useEffect(() => {
    if (accounts.length === 0 || Object.keys(accountBalances).length === 0) {
      setCheckingBalance(0);
      setMortgageBalance(0);
      setCreditCardBalance(0);
      return;
    }

    let totalChecking = 0;
    let totalMortgage = 0;
    let totalCreditCard = 0;

    accounts.forEach((account) => {
      const balance = accountBalances[account.id] || 0;

      if (account.account_type === 'checking') {
        totalChecking += balance;
      } else if (account.account_type === 'mortgage') {
        totalMortgage += balance;
      } else if (account.account_type === 'credit_card') {
        totalCreditCard += balance;
      }
    });

    setCheckingBalance(totalChecking);
    setMortgageBalance(totalMortgage);
    setCreditCardBalance(totalCreditCard);
  }, [accounts, accountBalances]);

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
    // Exclude mortgage and loan accounts from available balance
    const loanAccountTypes = ['mortgage', 'auto_loan', 'student_loan', 'personal_loan', 'business_loan'];
    const filteredAccounts = accounts.filter(account => !loanAccountTypes.includes(account.account_type));
    return filteredAccounts.reduce((sum, account) => sum + (accountBalances[account.id] || 0), 0);
  }, [accountBalances, accounts]);

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
      const [summaryRes, accountsRes, dividendsRes, positionsRes] = await Promise.all([
        positionsAPI.getSummary(asOfParam),
        accountsAPI.getAll(),
        dividendsAPI.getSummary(undefined, undefined, asOfParam),
        positionsAPI.getAggregated(null, asOfParam)
      ]);

      setSummary(summaryRes.data);
      setAccounts(accountsRes.data);
      setDividendSummary(dividendsRes.data);

      // Calculate breakdowns client-side from positions
      const positions = positionsRes.data || [];
      const totalMarketValue = positions.reduce((sum, pos) => sum + (pos.market_value || 0), 0);

      const industryMap = {};
      const typeMap = {};
      const subtypeMap = {};
      const sectorMap = {};

      positions.forEach(pos => {
        if (pos.industry) {
          if (!industryMap[pos.industry]) {
            industryMap[pos.industry] = { industry_name: pos.industry, market_value: 0, position_count: 0, color: null };
          }
          industryMap[pos.industry].market_value += pos.market_value || 0;
          industryMap[pos.industry].position_count += 1;
        }

        if (pos.security_type) {
          if (!typeMap[pos.security_type]) {
            typeMap[pos.security_type] = { type_name: pos.security_type, market_value: 0, position_count: 0, color: null };
          }
          typeMap[pos.security_type].market_value += pos.market_value || 0;
          typeMap[pos.security_type].position_count += 1;
        }

        if (pos.security_subtype) {
          if (!subtypeMap[pos.security_subtype]) {
            subtypeMap[pos.security_subtype] = { subtype_name: pos.security_subtype, market_value: 0, position_count: 0, color: null };
          }
          subtypeMap[pos.security_subtype].market_value += pos.market_value || 0;
          subtypeMap[pos.security_subtype].position_count += 1;
        }

        if (pos.sector) {
          if (!sectorMap[pos.sector]) {
            sectorMap[pos.sector] = { sector_name: pos.sector, market_value: 0, position_count: 0, color: null };
          }
          sectorMap[pos.sector].market_value += pos.market_value || 0;
          sectorMap[pos.sector].position_count += 1;
        }
      });

      const industryBreakdownData = Object.values(industryMap).map(item => ({
        ...item,
        percentage: totalMarketValue ? (item.market_value / totalMarketValue) * 100 : 0
      }));

      const typeBreakdownData = Object.values(typeMap).map(item => ({
        ...item,
        percentage: totalMarketValue ? (item.market_value / totalMarketValue) * 100 : 0
      }));

      const subtypeBreakdownData = Object.values(subtypeMap).map(item => ({
        ...item,
        percentage: totalMarketValue ? (item.market_value / totalMarketValue) * 100 : 0
      }));

      const sectorBreakdownData = Object.values(sectorMap).map(item => ({
        ...item,
        percentage: totalMarketValue ? (item.market_value / totalMarketValue) * 100 : 0
      }));

      setIndustryBreakdown(industryBreakdownData);
      setTypeBreakdown(typeBreakdownData);
      setSectorBreakdown(sectorBreakdownData);
      setSubtypeBreakdown(subtypeBreakdownData);
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
      case 'checking_balance':
        return (
          <StatCard
            title="Checking Accounts"
            value={formatCurrency(checkingBalance)}
            icon={<AccountBalance fontSize="large" />}
            color={checkingBalance > 0 ? 'success.main' : checkingBalance < 0 ? 'error.main' : 'text.primary'}
            subtitle="Total of all checking accounts"
            sizeFactor={tileScale}
          />
        );
      case 'mortgage_balance':
        return (
          <StatCard
            title="Mortgage Balance"
            value={formatCurrency(mortgageBalance)}
            icon={<AccountBalance fontSize="large" />}
            color="error.main"
            subtitle="Total mortgage debt"
            sizeFactor={tileScale}
          />
        );
      case 'credit_card_balance':
        return (
          <StatCard
            title="Credit Card Balance"
            value={formatCurrency(creditCardBalance)}
            icon={<AttachMoney fontSize="large" />}
            color={creditCardBalance < 0 ? 'error.main' : 'success.main'}
            subtitle="Total credit card debt"
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
                Available Balance
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
                    {(() => {
                      const loanAccountTypes = ['mortgage', 'auto_loan', 'student_loan', 'personal_loan', 'business_loan'];
                      const filteredCount = accounts.filter(account => !loanAccountTypes.includes(account.account_type)).length;
                      return `${filteredCount} ${filteredCount === 1 ? 'account' : 'accounts'} (excl. loans)`;
                    })()}
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
      case 'portfolio_allocation':
        return (
          <PortfolioAllocationCard
            typeSlices={portfolioTypeSlices}
            subtypeSlices={portfolioSubtypeSlices}
            sectorSlices={portfolioSectorSlices}
            industrySlices={portfolioIndustrySlices}
            securityTypeColors={securityTypeColors}
            securitySubtypeColors={securitySubtypeColors}
            sectorColors={sectorColors}
            industryColors={industryColors}
            breakdownType={portfolioBreakdownType}
            onBreakdownTypeChange={handlePortfolioBreakdownTypeChange}
            carouselEnabled={portfolioCarouselEnabled}
            onCarouselToggle={handlePortfolioCarouselToggle}
            formatCurrency={formatCurrency}
          />
        );
      case 'portfolio_breakdown':
        return (
          <PortfolioBreakdownCard
            typeSlices={portfolioTypeSlices}
            subtypeSlices={portfolioSubtypeSlices}
            sectorSlices={portfolioSectorSlices}
            industrySlices={portfolioIndustrySlices}
            securityTypeColors={securityTypeColors}
            securitySubtypeColors={securitySubtypeColors}
            sectorColors={sectorColors}
            industryColors={industryColors}
            breakdownType={portfolioBreakdownType}
            formatCurrency={formatCurrency}
          />
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
