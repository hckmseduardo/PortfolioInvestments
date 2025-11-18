import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Container,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Box,
  Chip,
  FormControl,
  InputLabel,
  Menu,
  MenuItem,
  Select,
  TextField,
  Stack,
  LinearProgress,
  Tooltip,
  CircularProgress,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Tabs,
  Tab,
  IconButton,
  Snackbar,
  Alert,
  TableSortLabel,
  useMediaQuery,
  useTheme
} from '@mui/material';
import {
  Refresh,
  ErrorOutline,
  Category as CategoryIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Business as BusinessIcon,
  FilterAlt as FilterIcon,
  Clear as ClearIcon
} from '@mui/icons-material';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { positionsAPI, accountsAPI, instrumentsAPI, securityMetadataAPI } from '../services/api';
import { alpha } from '@mui/material/styles';
import { stickyTableHeadSx, stickyFilterRowSx } from '../utils/tableStyles';
import ExportButtons from '../components/ExportButtons';
import { useMobileClick } from '../utils/useMobileClick';
import PositionCard from '../components/PositionCard';
import PortfolioAllocationCard from '../components/PortfolioAllocationCard';
import PortfolioBreakdownCard from '../components/PortfolioBreakdownCard';
import { useNavigate } from 'react-router-dom';

const DATE_PRESETS = {
  CURRENT: 'current',
  LAST_MONTH: 'last_month',
  SPECIFIC_MONTH: 'specific_month',
  LAST_QUARTER: 'last_quarter',
  LAST_YEAR: 'last_year',
  END_OF_YEAR: 'end_of_year'
};

const UNCLASSIFIED_SENTINEL = '__unclassified__';

const COLOR_PALETTE = [
  '#007bff',
  '#e91e63',
  '#4caf50',
  '#ff9800',
  '#9c27b0',
  '#00bcd4',
  '#8bc34a',
  '#ffc107',
  '#ff5722',
  '#3f51b5',
  '#009688',
  '#cddc39'
];

const COLUMN_FILTER_DEFAULTS = {
  ticker: '',
  name: '',
  security_type: '',
  security_subtype: '',
  sector: '',
  industry: '',
  price: '',
  quantity: '',
  book_value: '',
  market_value: '',
  gain_loss: '',
  gain_loss_percent: ''
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

const Portfolio = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  const [positions, setPositions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [datePreset, setDatePreset] = useState(DATE_PRESETS.CURRENT);
  const [specificMonth, setSpecificMonth] = useState('');
  const [endOfYear, setEndOfYear] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [summary, setSummary] = useState(null);
  const [industrySlices, setIndustrySlices] = useState([]);
  const [typeSlices, setTypeSlices] = useState([]);
  const [subtypeSlices, setSubtypeSlices] = useState([]);
  const [sectorSlices, setSectorSlices] = useState([]);
  const [instrumentTypes, setInstrumentTypes] = useState([]);
  const [instrumentIndustries, setInstrumentIndustries] = useState([]);
  const [breakdownType, setBreakdownType] = useState('type'); // 'type', 'subtype', 'sector', 'industry'
  const [carouselEnabled, setCarouselEnabled] = useState(true);
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [selectedIndustryId, setSelectedIndustryId] = useState('');
  const [metadataDialogOpen, setMetadataDialogOpen] = useState(false);
  const [metadataTab, setMetadataTab] = useState('types');
  const [editingType, setEditingType] = useState(null);
  const [editingIndustry, setEditingIndustry] = useState(null);
  const [newType, setNewType] = useState({ name: '', color: '#8884d8' });
  const [newIndustry, setNewIndustry] = useState({ name: '', color: '#82ca9d' });
  const [classificationSaving, setClassificationSaving] = useState({});
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [orderBy, setOrderBy] = useState('ticker');
  const [order, setOrder] = useState('asc');
  const [columnFilters, setColumnFilters] = useState({ ...COLUMN_FILTER_DEFAULTS });
  const [snapshotDates, setSnapshotDates] = useState([]);
  const [selectedSnapshotDate, setSelectedSnapshotDate] = useState(null);
  const hasLoadedOnce = useRef(false);
  const priceRefreshTimer = useRef(null);

  // Metadata editing dialog
  const [editMetadataDialog, setEditMetadataDialog] = useState({
    open: false,
    position: null,
    field: null // 'type', 'subtype', 'sector', or 'industry'
  });
  const [editMetadataValue, setEditMetadataValue] = useState('');
  const [savingMetadata, setSavingMetadata] = useState(false);

  // Security metadata with colors
  const [securityTypes, setSecurityTypes] = useState([]);
  const [securitySubtypes, setSecuritySubtypes] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [industries, setIndustries] = useState([]);

  const valuationDate = useMemo(
    () => computeValuationDate(datePreset, specificMonth, endOfYear),
    [datePreset, specificMonth, endOfYear]
  );

  // Load security metadata with colors
  const loadSecurityMetadata = useCallback(async () => {
    try {
      const [typesRes, subtypesRes, sectorsRes, industriesRes] = await Promise.all([
        securityMetadataAPI.getTypes(),
        securityMetadataAPI.getSubtypes(),
        securityMetadataAPI.getSectors(),
        securityMetadataAPI.getIndustries()
      ]);
      setSecurityTypes(typesRes.data || []);
      setSecuritySubtypes(subtypesRes.data || []);
      setSectors(sectorsRes.data || []);
      setIndustries(industriesRes.data || []);
    } catch (error) {
      console.error('Error loading security metadata:', error);
    }
  }, []);

  const loadInstrumentMetadata = useCallback(async () => {
    try {
      const [typesRes, industriesRes] = await Promise.all([
        instrumentsAPI.getTypes(),
        instrumentsAPI.getIndustries()
      ]);
      setInstrumentTypes(typesRes.data || []);
      setInstrumentIndustries(industriesRes.data || []);
    } catch (error) {
      console.error('Error loading instrument metadata:', error);
    }
  }, []);

  useEffect(() => {
    loadInstrumentMetadata();
    loadSecurityMetadata();
  }, [loadInstrumentMetadata, loadSecurityMetadata]);

  // Carousel auto-advance effect
  useEffect(() => {
    if (!carouselEnabled) return;

    const breakdownTypes = ['type', 'subtype', 'sector', 'industry'];
    const interval = setInterval(() => {
      setBreakdownType(prev => {
        const currentIndex = breakdownTypes.indexOf(prev);
        const nextIndex = (currentIndex + 1) % breakdownTypes.length;
        return breakdownTypes[nextIndex];
      });
    }, 5000); // Change every 5 seconds

    return () => clearInterval(interval);
  }, [carouselEnabled]);

  // Handler for tab change - stops carousel
  const handleBreakdownTypeChange = (event, newValue) => {
    setCarouselEnabled(false);
    setBreakdownType(newValue);
  };

  // Get current breakdown data based on selected type
  const getCurrentBreakdownData = () => {
    const result = {
      data: [],
      label: 'Type',
      colorMap: {}
    };

    switch (breakdownType) {
      case 'type':
        result.data = typeSlices || [];
        result.label = 'Type';
        result.colorMap = securityTypeColors || {};
        break;
      case 'subtype':
        result.data = subtypeSlices || [];
        result.label = 'Subtype';
        result.colorMap = securitySubtypeColors || {};
        break;
      case 'sector':
        result.data = sectorSlices || [];
        result.label = 'Sector';
        result.colorMap = sectorColors || {};
        break;
      case 'industry':
        result.data = industrySlices || [];
        result.label = 'Industry';
        result.colorMap = industryColors || {};
        break;
      default:
        result.data = typeSlices || [];
        result.label = 'Type';
        result.colorMap = securityTypeColors || {};
    }

    return result;
  };

  // Fetch available snapshot dates (refetch when account changes)
  useEffect(() => {
    const fetchSnapshotDates = async () => {
      try {
        const response = await positionsAPI.getSnapshotDates(selectedAccountId || null);
        const dates = response.data.snapshot_dates || [];
        setSnapshotDates(dates);

        // Reset to the latest snapshot when account changes or on initial load
        if (dates.length > 0) {
          setSelectedSnapshotDate(dates[0]);
        } else {
          setSelectedSnapshotDate(null);
        }

        console.log('Loaded snapshot dates for account:', selectedAccountId || 'all', '- found', dates.length, 'dates');
      } catch (error) {
        console.error('Error fetching snapshot dates:', error);
        console.error('Error details:', error.response);
        // If auth fails, snapshots just won't be available - that's ok
        setSnapshotDates([]);
        setSelectedSnapshotDate(null);
      }
    };
    fetchSnapshotDates();
  }, [selectedAccountId]);

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

  // Security metadata color lookups (indexed by name)
  const securityTypeColors = useMemo(() => {
    const map = {};
    securityTypes.forEach((item) => {
      map[item.name] = item.color;
    });
    return map;
  }, [securityTypes]);

  const securitySubtypeColors = useMemo(() => {
    const map = {};
    securitySubtypes.forEach((item) => {
      map[item.name] = item.color;
    });
    return map;
  }, [securitySubtypes]);

  const sectorColors = useMemo(() => {
    const map = {};
    sectors.forEach((item) => {
      map[item.name] = item.color;
    });
    return map;
  }, [sectors]);

  const industryColors = useMemo(() => {
    const map = {};
    industries.forEach((item) => {
      map[item.name] = item.color;
    });
    return map;
  }, [industries]);

  const fetchPositions = useCallback(async () => {
    if (!hasLoadedOnce.current) {
      setLoading(true);
    } else {
      setFetching(true);
    }
    try {
      // Always use snapshots API
      if (selectedSnapshotDate) {
        console.log('Fetching snapshot for date:', selectedSnapshotDate, 'account:', selectedAccountId || 'all');
        const positionsRes = await positionsAPI.getBySnapshotDate(
          selectedSnapshotDate,
          selectedAccountId || null
        );
        const data = positionsRes.data || [];
        console.log('Snapshot data received:', data.length, 'positions');

        // Aggregate positions by ticker when viewing all accounts
        let aggregatedData = data;
        if (!selectedAccountId && data.length > 0) {
          const tickerMap = new Map();

          data.forEach(pos => {
            const ticker = pos.ticker;
            if (tickerMap.has(ticker)) {
              // Aggregate existing position
              const existing = tickerMap.get(ticker);
              existing.quantity += pos.quantity || 0;
              existing.book_value += pos.book_value || 0;
              existing.market_value += pos.market_value || 0;
              // Recalculate average price
              existing.price = existing.quantity > 0 ? existing.market_value / existing.quantity : 0;
            } else {
              // Add new position (create a copy to avoid mutating original)
              tickerMap.set(ticker, {
                ...pos,
                account_id: 'aggregated', // Mark as aggregated
                account_name: 'All Accounts'
              });
            }
          });

          aggregatedData = Array.from(tickerMap.values());
          console.log('Aggregated positions:', aggregatedData.length, 'unique tickers');
        }

        // Calculate summary from snapshot data
        const totalMarketValue = aggregatedData.reduce((sum, pos) => sum + (pos.market_value || 0), 0);
        const totalBookValue = aggregatedData.reduce((sum, pos) => sum + (pos.book_value || 0), 0);
        const totalGainLoss = totalMarketValue - totalBookValue;
        const totalGainLossPercent = totalBookValue !== 0 ? (totalGainLoss / totalBookValue) * 100 : 0;

        setPositions(aggregatedData);
        setSummary({
          total_market_value: totalMarketValue,
          total_book_value: totalBookValue,
          total_gain_loss: totalGainLoss,
          total_gain_loss_percent: totalGainLossPercent,
          position_count: data.length
        });

        // Calculate breakdowns for all metadata types from snapshot data
        const industryMap = {};
        const typeMap = {};
        const subtypeMap = {};
        const sectorMap = {};

        aggregatedData.forEach(pos => {
          if (pos.industry) {
            if (!industryMap[pos.industry]) {
              industryMap[pos.industry] = {
                name: pos.industry,
                market_value: 0,
                position_count: 0
              };
            }
            industryMap[pos.industry].market_value += pos.market_value || 0;
            industryMap[pos.industry].position_count += 1;
          }

          if (pos.security_type) {
            if (!typeMap[pos.security_type]) {
              typeMap[pos.security_type] = {
                name: pos.security_type,
                market_value: 0,
                position_count: 0
              };
            }
            typeMap[pos.security_type].market_value += pos.market_value || 0;
            typeMap[pos.security_type].position_count += 1;
          }

          if (pos.security_subtype) {
            if (!subtypeMap[pos.security_subtype]) {
              subtypeMap[pos.security_subtype] = {
                name: pos.security_subtype,
                market_value: 0,
                position_count: 0
              };
            }
            subtypeMap[pos.security_subtype].market_value += pos.market_value || 0;
            subtypeMap[pos.security_subtype].position_count += 1;
          }

          if (pos.sector) {
            if (!sectorMap[pos.sector]) {
              sectorMap[pos.sector] = {
                name: pos.sector,
                market_value: 0,
                position_count: 0
              };
            }
            sectorMap[pos.sector].market_value += pos.market_value || 0;
            sectorMap[pos.sector].position_count += 1;
          }
        });

        const industrySlicesData = Object.values(industryMap).map(item => ({
          ...item,
          percentage: totalMarketValue ? (item.market_value / totalMarketValue) * 100 : 0
        }));

        const typeSlicesData = Object.values(typeMap).map(item => ({
          ...item,
          percentage: totalMarketValue ? (item.market_value / totalMarketValue) * 100 : 0
        }));

        const subtypeSlicesData = Object.values(subtypeMap).map(item => ({
          ...item,
          percentage: totalMarketValue ? (item.market_value / totalMarketValue) * 100 : 0
        }));

        const sectorSlicesData = Object.values(sectorMap).map(item => ({
          ...item,
          percentage: totalMarketValue ? (item.market_value / totalMarketValue) * 100 : 0
        }));

        setIndustrySlices(industrySlicesData);
        setTypeSlices(typeSlicesData);
        setSubtypeSlices(subtypeSlicesData);
        setSectorSlices(sectorSlicesData);
      }
    } catch (error) {
      console.error('Error fetching positions:', error);
      setPositions([]);
      setSummary(null);
      setIndustrySlices([]);
      setTypeSlices([]);
      setSubtypeSlices([]);
      setSectorSlices([]);
    } finally {
      hasLoadedOnce.current = true;
      setLoading(false);
      setFetching(false);
    }
  }, [selectedAccountId, selectedTypeId, selectedIndustryId, valuationDate, selectedSnapshotDate]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  useEffect(() => {
    return () => {
      if (priceRefreshTimer.current) {
        clearTimeout(priceRefreshTimer.current);
        priceRefreshTimer.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (priceRefreshTimer.current) {
      clearTimeout(priceRefreshTimer.current);
      priceRefreshTimer.current = null;
    }
  }, [selectedAccountId, valuationDate]);

  useEffect(() => {
    const loadAccounts = async () => {
      try {
        const response = await accountsAPI.getAll();
        setAccounts(response.data);
      } catch (error) {
        console.error('Error fetching accounts:', error);
      }
    };
    loadAccounts();
  }, []);

  const handleRefreshPrices = async () => {
    setRefreshing(true);
    try {
      await positionsAPI.refreshPrices();
      await fetchPositions();
    } catch (error) {
      console.error('Error refreshing prices:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(value ?? 0);
  };

  const formatNumber = (value, fractionDigits = 2) => {
    return new Intl.NumberFormat('en-CA', {
      minimumFractionDigits: 0,
      maximumFractionDigits: fractionDigits
    }).format(value);
  };

  const formatPercentage = (value) => {
    if (value == null || isNaN(value)) return '0.00%';
    return `${value >= 0 ? '+' : ''}${Number(value).toFixed(2)}%`;
  };

  const getAccountLabel = (accountId) => {
    if (!accountId) return 'Unknown';
    const account = accounts.find(acc => acc.id === accountId);
    if (!account) return 'Unknown';
    return account.label || `${account.institution || ''} ${account.account_number || ''}`.trim() || 'Unknown';
  };

  const formatPercent = (value = 0) => {
    if (!Number.isFinite(value)) {
      return '0.00%';
    }
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  const normalizeSource = (source) => (source || '').toLowerCase();
  const hasLivePrice = (position) => {
    const source = normalizeSource(position?.price_source);
    return Boolean(position?.has_live_price) || ['tradingview', 'yfinance', 'cash'].includes(source);
  };

  const getDisplayedMarketValue = (position) => {
    if (!hasLivePrice(position)) {
      return null;
    }
    return position.market_value;
  };

  const calculateGainLoss = (position) => {
    if (!hasLivePrice(position)) {
      return 0;
    }
    return (position.market_value || 0) - position.book_value;
  };

  const calculateGainLossPercent = (position) => {
    if (!hasLivePrice(position) || position.book_value === 0) return 0;
    return ((position.market_value - position.book_value) / position.book_value) * 100;
  };

  const formatPriceSourceLabel = (source) => {
    switch ((source || '').toLowerCase()) {
      case 'tradingview':
        return 'TradingView';
      case 'yfinance':
        return 'Yahoo Finance';
      case 'cash':
        return 'Cash Equivalent';
      default:
        return source || 'Unknown';
    }
  };

  const formatTimestamp = (isoString) => {
    if (!isoString) return 'Unknown time';
    try {
      return new Date(isoString).toLocaleString();
    } catch {
      return isoString;
    }
  };

  const summaryCards = useMemo(() => ([
    {
      title: 'Total Market Value',
      value: summary ? formatCurrency(summary.total_market_value || 0) : '—',
      subtitle: summary ? `${summary.positions_count} positions` : 'No data',
      color: 'primary.main'
    },
    {
      title: 'Total Book Value',
      value: summary ? formatCurrency(summary.total_book_value || 0) : '—',
      subtitle: summary ? `${summary.accounts_count} account(s)` : '',
      color: 'text.secondary'
    },
    {
      title: 'Total Gain / Loss',
      value: summary ? formatCurrency(summary.total_gain_loss || 0) : '—',
      subtitle: '',
      color: (summary?.total_gain_loss || 0) >= 0 ? 'success.main' : 'error.main'
    },
    {
      title: 'Gain / Loss %',
      value: summary ? formatPercent(summary.total_gain_loss_percent || 0) : '—',
      subtitle: '',
      color: (summary?.total_gain_loss_percent || 0) >= 0 ? 'success.main' : 'error.main'
    }
  ]), [summary]);

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

  const ClassificationTag = ({ value, options, placeholder = 'Unassigned', disabled, onChange }) => {
    const [anchorEl, setAnchorEl] = useState(null);
    const selectedOption = options.find((option) => option.id === value) || null;
    const selectedColor = selectedOption?.color || 'rgba(0,0,0,0.26)';

    const handleOpen = (event) => {
      if (disabled) return;
      setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
      setAnchorEl(null);
    };

    const handleSelect = (optionValue) => {
      if (disabled) return;
      onChange(optionValue ?? null);
      handleClose();
    };

    return (
      <>
        <Chip
          label={selectedOption?.name || placeholder}
          size="small"
          onClick={handleOpen}
          clickable={!disabled}
          sx={{
            borderRadius: '999px',
            bgcolor: selectedOption ? alpha(selectedColor, 0.15) : 'transparent',
            border: `1px solid ${selectedOption ? selectedColor : 'rgba(0,0,0,0.12)'}`,
            color: selectedOption ? selectedColor : 'text.secondary',
            fontWeight: 500,
            px: 0.5,
            cursor: disabled ? 'not-allowed' : 'pointer'
          }}
        />
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleClose}
          keepMounted
        >
          <MenuItem onClick={() => handleSelect(null)}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {renderColorSwatch(null)}
              <em>Unassigned</em>
            </Box>
          </MenuItem>
          {options.map((option) => (
            <MenuItem key={option.id} onClick={() => handleSelect(option.id)}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {renderColorSwatch(option.color)}
                <span>{option.name}</span>
              </Box>
            </MenuItem>
          ))}
        </Menu>
      </>
    );
  };

  const renderFilterField = (field, placeholder = 'Filter') => (
    <TextField
      size="small"
      variant="standard"
      fullWidth
      placeholder={placeholder}
      value={columnFilters[field]}
      onChange={(event) => handleColumnFilterChange(field, event.target.value)}
      InputProps={{
        disableUnderline: true,
        sx: {
          fontSize: 13,
          px: 1,
          py: 0.5,
          bgcolor: 'action.hover',
          borderRadius: 1
        }
      }}
    />
  );

  const showSnackbar = useCallback((message, severity = 'success') => {
    if (!message) return;
    setSnackbar({ open: true, message, severity });
  }, []);

  const openMetadataDialog = useCallback((tab) => {
    setMetadataTab(tab);
    setMetadataDialogOpen(true);
  }, []);

  const handleMetadataDialogClose = useCallback(() => {
    setMetadataDialogOpen(false);
    setEditingType(null);
    setEditingIndustry(null);
  }, []);

  const renderColorOptions = useCallback((selectedColor, onSelect) => (
    <Box>
      <Grid container spacing={1}>
        {COLOR_PALETTE.map((color) => (
          <Grid item key={color}>
            <Box
              onClick={() => onSelect(color)}
              sx={{
                width: 40,
                height: 40,
                bgcolor: color,
                borderRadius: 1,
                cursor: 'pointer',
                border: selectedColor === color ? '3px solid #000' : '1px solid #ddd',
                boxShadow: selectedColor === color ? 3 : 0,
                transition: 'transform 0.15s, box-shadow 0.15s',
                '&:hover': {
                  transform: 'scale(1.08)',
                  boxShadow: 2
                }
              }}
            />
          </Grid>
        ))}
      </Grid>
      <Box mt={1} display="flex" alignItems="center" gap={1}>
        <Box
          sx={{
            width: 48,
            height: 32,
            bgcolor: selectedColor,
            borderRadius: 1,
            border: '1px solid #ddd'
          }}
        />
        <Typography variant="body2" color="textSecondary">
          {selectedColor}
        </Typography>
      </Box>
    </Box>
  ), []);

  const handleClassificationUpdate = useCallback(async (position, changes) => {
    const ticker = position?.ticker;
    if (!ticker) return;
    setClassificationSaving((prev) => ({ ...prev, [ticker]: true }));
    try {
      const payload = {
        instrument_type_id: changes.instrument_type_id !== undefined
          ? changes.instrument_type_id || null
          : position.instrument_type_id || null,
        instrument_industry_id: changes.instrument_industry_id !== undefined
          ? changes.instrument_industry_id || null
          : position.instrument_industry_id || null
      };
      await instrumentsAPI.updateClassification(ticker, payload);
      setPositions((prev) =>
        prev.map((item) => {
          if (item.ticker !== ticker) {
            return item;
          }
          const next = { ...item };
          if (changes.instrument_type_id !== undefined) {
            const typeInfo = typeLookup[changes.instrument_type_id] || null;
            next.instrument_type_id = changes.instrument_type_id || null;
            next.instrument_type_name = typeInfo?.name || null;
            next.instrument_type_color = typeInfo?.color || null;
          }
          if (changes.instrument_industry_id !== undefined) {
            const industryInfo = industryLookup[changes.instrument_industry_id] || null;
            next.instrument_industry_id = changes.instrument_industry_id || null;
            next.instrument_industry_name = industryInfo?.name || null;
            next.instrument_industry_color = industryInfo?.color || null;
          }
          return next;
        })
      );
      fetchPositions();
    } catch (error) {
      console.error('Error updating classification:', error);
    } finally {
      setClassificationSaving((prev) => {
        const next = { ...prev };
        delete next[ticker];
        return next;
      });
    }
  }, [fetchPositions, industryLookup, typeLookup]);

  const handleCreateType = useCallback(async () => {
    const name = newType.name.trim();
    if (!name) {
      showSnackbar('Type name is required', 'error');
      return;
    }
    try {
      await instrumentsAPI.createType({
        name,
        color: newType.color || '#8884d8'
      });
      setNewType({ name: '', color: '#8884d8' });
      await loadInstrumentMetadata();
      showSnackbar('Type created successfully');
    } catch (error) {
      console.error('Error creating instrument type:', error);
      showSnackbar('Failed to create type', 'error');
    }
  }, [loadInstrumentMetadata, newType, showSnackbar]);

  const handleUpdateType = useCallback(async () => {
    if (!editingType?.id) return;
    const name = (editingType.name || '').trim();
    if (!name) {
      showSnackbar('Type name is required', 'error');
      return;
    }
    try {
      await instrumentsAPI.updateType(editingType.id, {
        name,
        color: editingType.color || '#8884d8'
      });
      setEditingType(null);
      await loadInstrumentMetadata();
      showSnackbar('Type updated successfully');
    } catch (error) {
      console.error('Error updating instrument type:', error);
      showSnackbar('Failed to update type', 'error');
    }
  }, [editingType, loadInstrumentMetadata, showSnackbar]);

  const handleDeleteType = useCallback(
    async (typeId) => {
      if (!typeId) return;
      if (!window.confirm('Delete this instrument type? Existing positions will become unassigned.')) {
        return;
      }
      try {
        await instrumentsAPI.deleteType(typeId);
        if (editingType?.id === typeId) {
          setEditingType(null);
        }
        await loadInstrumentMetadata();
        if (selectedTypeId === typeId) {
          setSelectedTypeId('');
        }
        showSnackbar('Type deleted');
      } catch (error) {
        console.error('Error deleting type:', error);
        showSnackbar('Failed to delete type', 'error');
      }
    },
    [editingType, loadInstrumentMetadata, selectedTypeId, showSnackbar]
  );

  const handleCreateIndustry = useCallback(async () => {
    const name = newIndustry.name.trim();
    if (!name) {
      showSnackbar('Industry name is required', 'error');
      return;
    }
    try {
      await instrumentsAPI.createIndustry({
        name,
        color: newIndustry.color || '#82ca9d'
      });
      setNewIndustry({ name: '', color: '#82ca9d' });
      await loadInstrumentMetadata();
      showSnackbar('Industry created successfully');
    } catch (error) {
      console.error('Error creating instrument industry:', error);
      showSnackbar('Failed to create industry', 'error');
    }
  }, [loadInstrumentMetadata, newIndustry, showSnackbar]);

  const handleEditType = useCallback((type) => {
    if (!type) return;
    setMetadataTab('types');
    setEditingType({
      id: type.id,
      name: type.name,
      color: type.color || '#8884d8'
    });
    setMetadataDialogOpen(true);
  }, []);

  const handleEditIndustry = useCallback((industry) => {
    if (!industry) return;
    setMetadataTab('industries');
    setEditingIndustry({
      id: industry.id,
      name: industry.name,
      color: industry.color || '#82ca9d'
    });
    setMetadataDialogOpen(true);
  }, []);

  const handleUpdateIndustry = useCallback(async () => {
    if (!editingIndustry?.id) return;
    const name = (editingIndustry.name || '').trim();
    if (!name) {
      showSnackbar('Industry name is required', 'error');
      return;
    }
    try {
      await instrumentsAPI.updateIndustry(editingIndustry.id, {
        name,
        color: editingIndustry.color || '#82ca9d'
      });
      setEditingIndustry(null);
      await loadInstrumentMetadata();
      showSnackbar('Industry updated successfully');
    } catch (error) {
      console.error('Error updating instrument industry:', error);
      showSnackbar('Failed to update industry', 'error');
    }
  }, [editingIndustry, loadInstrumentMetadata, showSnackbar]);

  const handleDeleteIndustry = useCallback(
    async (industryId) => {
      if (!industryId) return;
      if (!window.confirm('Delete this industry? Existing positions will become unassigned.')) {
        return;
      }
      try {
        await instrumentsAPI.deleteIndustry(industryId);
        if (editingIndustry?.id === industryId) {
          setEditingIndustry(null);
        }
        await loadInstrumentMetadata();
        if (selectedIndustryId === industryId) {
          setSelectedIndustryId('');
        }
        showSnackbar('Industry deleted');
      } catch (error) {
        console.error('Error deleting industry:', error);
        showSnackbar('Failed to delete industry', 'error');
      }
    },
    [editingIndustry, loadInstrumentMetadata, selectedIndustryId, showSnackbar]
  );

  const handleIndustrySliceClickBase = useCallback((slice) => {
    if (!slice) return;
    const sliceId = slice.industry_id ?? UNCLASSIFIED_SENTINEL;
    setSelectedIndustryId((prev) => (prev === sliceId ? '' : sliceId));
  }, []);

  const handleTypeSliceClickBase = useCallback((slice) => {
    if (!slice) return;
    const sliceId = slice.type_id ?? UNCLASSIFIED_SENTINEL;
    setSelectedTypeId((prev) => (prev === sliceId ? '' : sliceId));
  }, []);

  // Use mobile-aware click handlers (double-click on mobile, single-click on desktop)
  const handleIndustrySliceClick = useMobileClick(handleIndustrySliceClickBase);
  const handleTypeSliceClick = useMobileClick(handleTypeSliceClickBase);

  const clearIndustryFilter = useCallback(() => {
    setSelectedIndustryId('');
  }, []);

  const clearTypeFilter = useCallback(() => {
    setSelectedTypeId('');
  }, []);

  const handleColumnFilterChange = useCallback((field, value) => {
    setColumnFilters((prev) => ({
      ...prev,
      [field]: value
    }));
  }, []);

  // Handle pie chart slice click to filter positions grid
  const handlePieSliceClickBase = useCallback((slice) => {
    if (!slice || !slice.name) return;

    // Map breakdown type to column filter field
    const filterFieldMap = {
      type: 'security_type',
      subtype: 'security_subtype',
      sector: 'sector',
      industry: 'industry'
    };

    const filterField = filterFieldMap[breakdownType];
    if (!filterField) return;

    // Toggle filter: if already filtering this value, clear it; otherwise set it
    setColumnFilters((prev) => {
      const currentValue = prev[filterField];
      return {
        ...prev,
        [filterField]: currentValue === slice.name ? '' : slice.name
      };
    });
  }, [breakdownType]);

  // Use mobile-aware click handler (double-click on mobile, single-click on desktop)
  const handlePieSliceClick = useMobileClick(handlePieSliceClickBase);

  const resetColumnFilters = useCallback(() => {
    setColumnFilters({ ...COLUMN_FILTER_DEFAULTS });
  }, []);

  // Metadata editing handlers
  const handleOpenMetadataDialog = useCallback((position, field) => {
    const currentValue = position[field] || '';
    setEditMetadataDialog({
      open: true,
      position,
      field
    });
    setEditMetadataValue(currentValue);
  }, []);

  const handleCloseMetadataDialog = useCallback(() => {
    setEditMetadataDialog({
      open: false,
      position: null,
      field: null
    });
    setEditMetadataValue('');
  }, []);

  const handleSaveMetadataOverride = useCallback(async () => {
    const { position, field } = editMetadataDialog;
    if (!position || !field) return;

    setSavingMetadata(true);
    try {
      // Only send the field being edited; send undefined for others to avoid overwriting existing overrides
      // Empty string means "clear this field", null/undefined means "don't change this field"
      const overrideData = {
        ticker: position.ticker,
        security_name: position.name || position.ticker,
        custom_type: field === 'security_type' ? editMetadataValue : undefined,
        custom_subtype: field === 'security_subtype' ? editMetadataValue : undefined,
        custom_sector: field === 'sector' ? editMetadataValue : undefined,
        custom_industry: field === 'industry' ? editMetadataValue : undefined
      };

      // Remove undefined fields before sending
      Object.keys(overrideData).forEach(key => {
        if (overrideData[key] === undefined) {
          delete overrideData[key];
        }
      });

      console.log('Saving metadata override:', overrideData);
      const response = await securityMetadataAPI.setOverride(overrideData);
      console.log('Override saved successfully:', response.data);

      // Refresh positions to show the updated metadata
      await fetchPositions();

      showSnackbar('Metadata updated successfully');
      handleCloseMetadataDialog();
    } catch (error) {
      console.error('Error saving metadata override:', error);
      showSnackbar('Failed to save metadata override', 'error');
    } finally {
      setSavingMetadata(false);
    }
  }, [editMetadataDialog, editMetadataValue, fetchPositions, showSnackbar, handleCloseMetadataDialog]);

  const handleRequestSort = useCallback((property) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  }, [orderBy, order]);

  const hasColumnFilters = useMemo(
    () => Object.values(columnFilters).some((value) => String(value || '').trim().length > 0),
    [columnFilters]
  );

  const filteredPositions = useMemo(() => {
    const normalizedFilters = Object.fromEntries(
      Object.entries(columnFilters).map(([key, value]) => [key, String(value || '').trim().toLowerCase()])
    );

    const matchesFilter = (value, filterValue) => {
      if (!filterValue) return true;
      return String(value ?? '').toLowerCase().includes(filterValue);
    };

    const isFiltering = Object.values(normalizedFilters).some(Boolean);
    if (!isFiltering) {
      return positions;
    }

    return positions.filter((position) => {
      if (!matchesFilter(position.ticker, normalizedFilters.ticker)) return false;
      if (!matchesFilter(position.name, normalizedFilters.name)) return false;

      // Security metadata filters
      if (!matchesFilter(position.security_type, normalizedFilters.security_type)) return false;
      if (!matchesFilter(position.security_subtype, normalizedFilters.security_subtype)) return false;
      if (!matchesFilter(position.sector, normalizedFilters.sector)) return false;
      if (!matchesFilter(position.industry, normalizedFilters.industry)) return false;

      const typeLabel = position.instrument_type_name || 'Unassigned';
      if (!matchesFilter(typeLabel, normalizedFilters.instrument_type_name)) return false;

      const industryLabel = position.instrument_industry_name || 'Unassigned';
      if (!matchesFilter(industryLabel, normalizedFilters.instrument_industry_name)) return false;

      if (!matchesFilter(position.price, normalizedFilters.price)) return false;
      if (!matchesFilter(position.quantity, normalizedFilters.quantity)) return false;
      if (!matchesFilter(position.book_value, normalizedFilters.book_value)) return false;

      const marketValue = getDisplayedMarketValue(position) ?? position.market_value ?? position.book_value;
      if (!matchesFilter(marketValue, normalizedFilters.market_value)) return false;

      if (!matchesFilter(calculateGainLoss(position), normalizedFilters.gain_loss)) return false;
      if (!matchesFilter(calculateGainLossPercent(position), normalizedFilters.gain_loss_percent)) return false;

      return true;
    });
  }, [
    positions,
    columnFilters,
    calculateGainLoss,
    calculateGainLossPercent,
    getDisplayedMarketValue
  ]);

  const sortedPositions = useMemo(() => {
    const comparator = (a, b) => {
      let aValue = a[orderBy];
      let bValue = b[orderBy];

      // Handle null/undefined values
      if (aValue === null || aValue === undefined) aValue = '';
      if (bValue === null || bValue === undefined) bValue = '';

      // Special handling for different column types
      if (orderBy === 'ticker' || orderBy === 'name') {
        // String comparison
        return order === 'asc'
          ? String(aValue).localeCompare(String(bValue))
          : String(bValue).localeCompare(String(aValue));
      }

      if (orderBy === 'instrument_type_name' || orderBy === 'instrument_industry_name') {
        // Handle empty type/industry (treat as "ZZZ" to sort to end)
        const aStr = aValue || '\uFFFF';
        const bStr = bValue || '\uFFFF';
        return order === 'asc'
          ? aStr.localeCompare(bStr)
          : bStr.localeCompare(aStr);
      }

      if (orderBy === 'price' || orderBy === 'quantity' || orderBy === 'book_value' || orderBy === 'market_value') {
        // Numeric comparison
        const aNum = Number(aValue) || 0;
        const bNum = Number(bValue) || 0;
        return order === 'asc'
          ? aNum - bNum
          : bNum - aNum;
      }

      if (orderBy === 'gain_loss' || orderBy === 'gain_loss_percent') {
        // Calculate gain/loss for sorting
        const aGainLoss = orderBy === 'gain_loss'
          ? calculateGainLoss(a)
          : calculateGainLossPercent(a);
        const bGainLoss = orderBy === 'gain_loss'
          ? calculateGainLoss(b)
          : calculateGainLossPercent(b);
        return order === 'asc'
          ? aGainLoss - bGainLoss
          : bGainLoss - aGainLoss;
      }

      // Default string comparison
      return order === 'asc'
        ? String(aValue).localeCompare(String(bValue))
        : String(bValue).localeCompare(String(aValue));
    };

    return [...filteredPositions].sort(comparator);
  }, [filteredPositions, orderBy, order]);

  // Export configuration
  const portfolioExportColumns = useMemo(() => [
    { field: 'ticker', header: 'Ticker' },
    { field: 'name', header: 'Name' },
    { field: 'instrument_type_name', header: 'Type' },
    { field: 'instrument_industry_name', header: 'Industry' },
    { field: 'price', header: 'Price', type: 'currency' },
    { field: 'quantity', header: 'Quantity', type: 'number' },
    { field: 'book_value', header: 'Book Value', type: 'currency' },
    { field: 'market_value', header: 'Market Value', type: 'currency' },
    { field: 'gain_loss', header: 'Gain/Loss', type: 'currency' },
    { field: 'gain_loss_percent', header: 'Gain/Loss %' }
  ], []);

  const portfolioExportData = useMemo(() =>
    sortedPositions.map(pos => ({
      ...pos,
      gain_loss: pos.market_value - pos.book_value,
      gain_loss_percent: pos.book_value > 0
        ? `${(((pos.market_value - pos.book_value) / pos.book_value) * 100).toFixed(2)}%`
        : 'N/A'
    })),
    [sortedPositions]
  );

  const hasFilters = Boolean(
    selectedAccountId ||
    valuationDate ||
    selectedTypeId ||
    selectedIndustryId ||
    hasColumnFilters
  );

  if (loading && positions.length === 0) {
    return (
      <Container>
        <Typography>Loading...</Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Box
        display="flex"
        justifyContent="space-between"
        flexWrap="wrap"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        mb={3}
        gap={2}
      >
        <Typography variant="h4">
          Portfolio
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<CategoryIcon />}
            onClick={() => navigate('/security-metadata')}
          >
            Manage Metadata
          </Button>
          <Button
            variant="contained"
            startIcon={<Refresh />}
            onClick={handleRefreshPrices}
            disabled={refreshing || fetching}
          >
            {refreshing ? 'Refreshing...' : fetching ? 'Updating...' : 'Refresh Prices'}
          </Button>
        </Box>
      </Box>

      <Paper sx={{ p: isMobile ? 2 : 2, mb: 3 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={isMobile ? 1.5 : 2}
          useFlexGap
          flexWrap="wrap"
          alignItems={{ xs: 'stretch', md: 'center' }}
        >
          <FormControl size={isMobile ? 'medium' : 'small'} sx={{ minWidth: isMobile ? '100%' : 200 }}>
            <InputLabel id="portfolio-account-select">Account</InputLabel>
            <Select
              labelId="portfolio-account-select"
              value={selectedAccountId}
              label="Account"
              onChange={(event) => setSelectedAccountId(event.target.value)}
              sx={isMobile ? {
                '& .MuiInputBase-root': {
                  minHeight: 48
                }
              } : {}}
            >
              <MenuItem value="">
                All accounts
              </MenuItem>
              {[...accounts].sort((a, b) => {
                const aDisplay = `${a.institution || ''} ${a.label}`.trim();
                const bDisplay = `${b.institution || ''} ${b.label}`.trim();
                return aDisplay.localeCompare(bDisplay);
              }).map((account) => (
                <MenuItem key={account.id} value={account.id}>
                  {account.institution && `${account.institution} - `}
                  {account.label}
                  {account.account_type && ` (${account.account_type.replace(/_/g, ' ')})`}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size={isMobile ? 'medium' : 'small'} sx={{ minWidth: isMobile ? '100%' : 250 }}>
            <InputLabel id="portfolio-snapshot-select">Snapshot Date</InputLabel>
            <Select
              labelId="portfolio-snapshot-select"
              value={selectedSnapshotDate}
              label="Snapshot Date"
              onChange={(event) => setSelectedSnapshotDate(event.target.value)}
              renderValue={(value) => {
                if (!value) return <em>Select date</em>;
                return new Date(value).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                });
              }}
              sx={isMobile ? {
                '& .MuiInputBase-root': {
                  minHeight: 48
                }
              } : {}}
            >
              {snapshotDates.map((date) => (
                <MenuItem key={date} value={date}>
                  {new Date(date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {summaryCards.map((card) => (
          <Grid item xs={12} sm={6} md={3} key={card.title} sx={{ display: 'flex' }}>
            <Paper
              sx={{
                p: 2,
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: 1
              }}
            >
              <Typography
                variant="caption"
                color="textSecondary"
                sx={{ letterSpacing: '.08em', textTransform: 'uppercase' }}
              >
                {card.title}
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 600, color: card.color, mt: 1 }}>
                {card.value}
              </Typography>
              <Box sx={{ minHeight: 24 }}>
                {card.subtitle && (
                  <Typography variant="body2" color="textSecondary">
                    {card.subtitle}
                  </Typography>
                )}
              </Box>
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <PortfolioAllocationCard
            typeSlices={typeSlices}
            subtypeSlices={subtypeSlices}
            sectorSlices={sectorSlices}
            industrySlices={industrySlices}
            securityTypeColors={securityTypeColors}
            securitySubtypeColors={securitySubtypeColors}
            sectorColors={sectorColors}
            industryColors={industryColors}
            breakdownType={breakdownType}
            onBreakdownTypeChange={handleBreakdownTypeChange}
            carouselEnabled={carouselEnabled}
            onCarouselToggle={() => setCarouselEnabled(!carouselEnabled)}
            onSliceClick={handlePieSliceClick}
            formatCurrency={formatCurrency}
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <PortfolioBreakdownCard
            typeSlices={typeSlices}
            subtypeSlices={subtypeSlices}
            sectorSlices={sectorSlices}
            industrySlices={industrySlices}
            securityTypeColors={securityTypeColors}
            securitySubtypeColors={securitySubtypeColors}
            sectorColors={sectorColors}
            industryColors={industryColors}
            breakdownType={breakdownType}
            formatCurrency={formatCurrency}
          />
        </Grid>
      </Grid>

      {valuationDate && (
        <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
          Showing positions as of {new Date(valuationDate).toLocaleDateString()}
        </Typography>
      )}

      {sortedPositions.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" color="textSecondary">
            No positions found{hasFilters ? ' for the selected criteria' : ''}
          </Typography>
          <Typography color="textSecondary">
            {hasFilters
              ? 'Try adjusting the account, date, type, or industry filters.'
              : 'Import a statement to see your portfolio'}
          </Typography>
          {hasColumnFilters && (
            <Button
              size="small"
              variant="text"
              sx={{ mt: 2 }}
              onClick={resetColumnFilters}
            >
              Clear column filters
            </Button>
          )}
        </Paper>
      ) : (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            {hasColumnFilters && !isMobile && (
              <Button size="small" onClick={resetColumnFilters}>
                Clear column filters
              </Button>
            )}
            <Box sx={{ ml: 'auto' }}>
              <ExportButtons
                data={portfolioExportData}
                columns={portfolioExportColumns}
                filename="portfolio"
                title="Portfolio Report"
              />
            </Box>
          </Box>
          {isMobile ? (
            // Mobile Card View
            <Box>
              {fetching && <LinearProgress sx={{ mb: 2 }} />}
              {sortedPositions.length === 0 ? (
                <Paper sx={{ p: 3, textAlign: 'center' }}>
                  <Typography color="text.secondary">
                    No positions found
                  </Typography>
                </Paper>
              ) : (
                sortedPositions.map((position) => (
                  <PositionCard
                    key={`${position.ticker}-${position.account_id}`}
                    position={position}
                    formatCurrency={formatCurrency}
                    formatPercentage={formatPercentage}
                    getAccountLabel={getAccountLabel}
                    formatDate={(date) => new Date(date).toLocaleDateString()}
                    securityTypeColors={securityTypeColors}
                    securitySubtypeColors={securitySubtypeColors}
                    sectorColors={sectorColors}
                    industryColors={industryColors}
                    onTypeClick={() => handleOpenMetadataDialog(position, 'security_type')}
                    onSubtypeClick={() => handleOpenMetadataDialog(position, 'security_subtype')}
                    onSectorClick={() => handleOpenMetadataDialog(position, 'sector')}
                    onIndustryClick={() => handleOpenMetadataDialog(position, 'industry')}
                  />
                ))
              )}
            </Box>
          ) : (
            // Desktop Table View
            <TableContainer component={Paper}>
              {fetching && <LinearProgress />}
              <Table stickyHeader>
              <TableHead sx={stickyTableHeadSx}>
                <TableRow>
                  <TableCell sortDirection={orderBy === 'ticker' ? order : false}>
                    <TableSortLabel
                      active={orderBy === 'ticker'}
                      direction={orderBy === 'ticker' ? order : 'asc'}
                      onClick={() => handleRequestSort('ticker')}
                    >
                      <strong>Ticker</strong>
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={orderBy === 'name' ? order : false}>
                    <TableSortLabel
                      active={orderBy === 'name'}
                      direction={orderBy === 'name' ? order : 'asc'}
                      onClick={() => handleRequestSort('name')}
                    >
                      <strong>Name</strong>
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={orderBy === 'security_type' ? order : false}>
                    <TableSortLabel
                      active={orderBy === 'security_type'}
                      direction={orderBy === 'security_type' ? order : 'asc'}
                      onClick={() => handleRequestSort('security_type')}
                    >
                      <strong>Type</strong>
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={orderBy === 'security_subtype' ? order : false}>
                    <TableSortLabel
                      active={orderBy === 'security_subtype'}
                      direction={orderBy === 'security_subtype' ? order : 'asc'}
                      onClick={() => handleRequestSort('security_subtype')}
                    >
                      <strong>Subtype</strong>
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={orderBy === 'sector' ? order : false}>
                    <TableSortLabel
                      active={orderBy === 'sector'}
                      direction={orderBy === 'sector' ? order : 'asc'}
                      onClick={() => handleRequestSort('sector')}
                    >
                      <strong>Sector</strong>
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={orderBy === 'industry' ? order : false}>
                    <TableSortLabel
                      active={orderBy === 'industry'}
                      direction={orderBy === 'industry' ? order : 'asc'}
                      onClick={() => handleRequestSort('industry')}
                    >
                      <strong>Industry</strong>
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right" sortDirection={orderBy === 'price' ? order : false}>
                    <TableSortLabel
                      active={orderBy === 'price'}
                      direction={orderBy === 'price' ? order : 'asc'}
                      onClick={() => handleRequestSort('price')}
                    >
                      <strong>Price</strong>
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right" sortDirection={orderBy === 'quantity' ? order : false}>
                    <TableSortLabel
                      active={orderBy === 'quantity'}
                      direction={orderBy === 'quantity' ? order : 'asc'}
                      onClick={() => handleRequestSort('quantity')}
                    >
                      <strong>Quantity</strong>
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right" sortDirection={orderBy === 'book_value' ? order : false}>
                    <TableSortLabel
                      active={orderBy === 'book_value'}
                      direction={orderBy === 'book_value' ? order : 'asc'}
                      onClick={() => handleRequestSort('book_value')}
                    >
                      <strong>Book Value</strong>
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right" sortDirection={orderBy === 'market_value' ? order : false}>
                    <TableSortLabel
                      active={orderBy === 'market_value'}
                      direction={orderBy === 'market_value' ? order : 'asc'}
                      onClick={() => handleRequestSort('market_value')}
                    >
                      <strong>Market Value</strong>
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right" sortDirection={orderBy === 'gain_loss' ? order : false}>
                    <TableSortLabel
                      active={orderBy === 'gain_loss'}
                      direction={orderBy === 'gain_loss' ? order : 'asc'}
                      onClick={() => handleRequestSort('gain_loss')}
                    >
                      <strong>Gain/Loss</strong>
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right" sortDirection={orderBy === 'gain_loss_percent' ? order : false}>
                    <TableSortLabel
                      active={orderBy === 'gain_loss_percent'}
                      direction={orderBy === 'gain_loss_percent' ? order : 'asc'}
                      onClick={() => handleRequestSort('gain_loss_percent')}
                    >
                      <strong>Gain/Loss %</strong>
                    </TableSortLabel>
                  </TableCell>
                </TableRow>
                <TableRow sx={stickyFilterRowSx}>
                  <TableCell>{renderFilterField('ticker', 'Ticker')}</TableCell>
                  <TableCell>{renderFilterField('name', 'Name')}</TableCell>
                  <TableCell>{renderFilterField('security_type', 'Type')}</TableCell>
                  <TableCell>{renderFilterField('security_subtype', 'Subtype')}</TableCell>
                  <TableCell>{renderFilterField('sector', 'Sector')}</TableCell>
                  <TableCell>{renderFilterField('industry', 'Industry')}</TableCell>
                  <TableCell align="right">{renderFilterField('price', 'Price')}</TableCell>
                  <TableCell align="right">{renderFilterField('quantity', 'Qty')}</TableCell>
                  <TableCell align="right">{renderFilterField('book_value', 'Book')}</TableCell>
                  <TableCell align="right">{renderFilterField('market_value', 'Market')}</TableCell>
                  <TableCell align="right">{renderFilterField('gain_loss', 'Gain')}</TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                      {renderFilterField('gain_loss_percent', '%')}
                      {hasColumnFilters && isMobile && (
                        <Tooltip title="Clear all filters">
                          <IconButton size="small" onClick={resetColumnFilters} sx={{ p: 0.5 }}>
                            <ClearIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedPositions.map((position) => {
                  const gainLoss = calculateGainLoss(position);
                  const gainLossPercent = calculateGainLossPercent(position);
                  const isPositive = gainLoss >= 0;
                  const livePrice = hasLivePrice(position) && position.price != null ? position.price : null;
                  const displayMarketValue = getDisplayedMarketValue(position);
                  const pricePending = position.price_pending && position.ticker !== 'CASH';
                  const priceFailed = position.price_failed && position.ticker !== 'CASH';

                  return (
                  <TableRow key={`${position.ticker}-${position.account_id}`}>
                    <TableCell>
                      <Chip
                        label={position.ticker}
                        color={position.ticker === 'CASH' ? 'default' : 'primary'}
                        variant={position.ticker === 'CASH' ? 'outlined' : 'filled'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>{position.name}</TableCell>
                    <TableCell>
                      {position.security_type ? (
                        <Chip
                          label={position.security_type}
                          size="small"
                          clickable
                          onClick={() => handleOpenMetadataDialog(position, 'security_type')}
                          sx={{
                            textTransform: 'capitalize',
                            bgcolor: securityTypeColors[position.security_type] || '#808080',
                            color: '#fff',
                            fontWeight: 500,
                            cursor: 'pointer',
                            '&:hover': {
                              opacity: 0.8
                            }
                          }}
                        />
                      ) : (
                        <Chip
                          label="Set Type"
                          size="small"
                          clickable
                          onClick={() => handleOpenMetadataDialog(position, 'security_type')}
                          variant="outlined"
                          sx={{ cursor: 'pointer' }}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {position.security_subtype ? (
                        <Chip
                          label={position.security_subtype}
                          size="small"
                          clickable
                          onClick={() => handleOpenMetadataDialog(position, 'security_subtype')}
                          sx={{
                            textTransform: 'capitalize',
                            bgcolor: securitySubtypeColors[position.security_subtype] || '#808080',
                            color: '#fff',
                            fontWeight: 500,
                            cursor: 'pointer',
                            '&:hover': {
                              opacity: 0.8
                            }
                          }}
                        />
                      ) : (
                        <Chip
                          label="Set Subtype"
                          size="small"
                          clickable
                          onClick={() => handleOpenMetadataDialog(position, 'security_subtype')}
                          variant="outlined"
                          sx={{ cursor: 'pointer' }}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {position.sector ? (
                        <Chip
                          label={position.sector}
                          size="small"
                          clickable
                          onClick={() => handleOpenMetadataDialog(position, 'sector')}
                          sx={{
                            bgcolor: sectorColors[position.sector] || '#808080',
                            color: '#fff',
                            fontWeight: 500,
                            cursor: 'pointer',
                            '&:hover': {
                              opacity: 0.8
                            }
                          }}
                        />
                      ) : (
                        <Chip
                          label="Set Sector"
                          size="small"
                          clickable
                          onClick={() => handleOpenMetadataDialog(position, 'sector')}
                          variant="outlined"
                          sx={{ cursor: 'pointer' }}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {position.industry ? (
                        <Chip
                          label={position.industry}
                          size="small"
                          clickable
                          onClick={() => handleOpenMetadataDialog(position, 'industry')}
                          sx={{
                            bgcolor: industryColors[position.industry] || '#808080',
                            color: '#fff',
                            fontWeight: 500,
                            cursor: 'pointer',
                            '&:hover': {
                              opacity: 0.8
                            }
                          }}
                        />
                      ) : (
                        <Chip
                          label="Set Industry"
                          size="small"
                          clickable
                          onClick={() => handleOpenMetadataDialog(position, 'industry')}
                          variant="outlined"
                          sx={{ cursor: 'pointer' }}
                        />
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {livePrice ? (
                        <Tooltip
                          title={
                            <>
                              Source: {formatPriceSourceLabel(position.price_source)}
                              <br />
                              Updated: {formatTimestamp(position.price_fetched_at)}
                            </>
                          }
                        >
                          <span>{formatCurrency(livePrice)}</span>
                        </Tooltip>
                      ) : pricePending ? (
                        <Box display="flex" justifyContent="flex-end" alignItems="center">
                          <CircularProgress size={14} sx={{ mr: 1 }} />
                          <Typography variant="caption" color="textSecondary">
                            Fetching…
                          </Typography>
                        </Box>
                      ) : priceFailed ? (
                        <Tooltip title="Unable to fetch price after multiple attempts">
                          <Box display="flex" justifyContent="flex-end" alignItems="center" color="error.main">
                            <ErrorOutline fontSize="small" sx={{ mr: 0.5 }} />
                            <Typography variant="caption">Unavailable</Typography>
                          </Box>
                        </Tooltip>
                      ) : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {formatNumber(position.quantity, position.ticker === 'CASH' ? 2 : 4)}
                    </TableCell>
                    <TableCell align="right">{formatCurrency(position.book_value)}</TableCell>
                    <TableCell align="right">
                      {displayMarketValue != null ? (
                        formatCurrency(displayMarketValue)
                      ) : pricePending ? (
                        <Typography variant="caption" color="textSecondary">
                          Waiting for price…
                        </Typography>
                      ) : priceFailed ? (
                        <Typography variant="caption" color="error.main">
                          Price unavailable
                        </Typography>
                      ) : '—'}
                    </TableCell>
                    <TableCell 
                      align="right" 
                      sx={{ color: isPositive ? 'success.main' : 'error.main' }}
                    >
                      {hasLivePrice(position) ? formatCurrency(gainLoss) : formatCurrency(0)}
                    </TableCell>
                    <TableCell 
                      align="right"
                      sx={{ color: isPositive ? 'success.main' : 'error.main' }}
                    >
                      {hasLivePrice(position) ? formatPercent(gainLossPercent) : '0.00%'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
          )}
        </>
      )}

      {/* Security Metadata Editing Dialog */}
      <Dialog
        open={editMetadataDialog.open}
        onClose={handleCloseMetadataDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Edit {editMetadataDialog.field === 'security_type' ? 'Type' :
                editMetadataDialog.field === 'security_subtype' ? 'Subtype' :
                editMetadataDialog.field === 'sector' ? 'Sector' : 'Industry'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              Security: <strong>{editMetadataDialog.position?.ticker}</strong> - {editMetadataDialog.position?.name}
            </Typography>
            <FormControl fullWidth sx={{ mt: 2 }}>
              <InputLabel>
                {editMetadataDialog.field === 'security_type' ? 'Type' :
                 editMetadataDialog.field === 'security_subtype' ? 'Subtype' :
                 editMetadataDialog.field === 'sector' ? 'Sector' : 'Industry'}
              </InputLabel>
              <Select
                value={editMetadataValue}
                label={editMetadataDialog.field === 'security_type' ? 'Type' :
                       editMetadataDialog.field === 'security_subtype' ? 'Subtype' :
                       editMetadataDialog.field === 'sector' ? 'Sector' : 'Industry'}
                onChange={(e) => setEditMetadataValue(e.target.value)}
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {editMetadataDialog.field === 'security_type' && securityTypes.map((type) => (
                  <MenuItem key={type.id} value={type.name}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Box
                        sx={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          bgcolor: type.color,
                          border: '1px solid rgba(0,0,0,0.12)'
                        }}
                      />
                      {type.name}
                    </Box>
                  </MenuItem>
                ))}
                {editMetadataDialog.field === 'security_subtype' && securitySubtypes.map((subtype) => (
                  <MenuItem key={subtype.id} value={subtype.name}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Box
                        sx={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          bgcolor: subtype.color,
                          border: '1px solid rgba(0,0,0,0.12)'
                        }}
                      />
                      {subtype.name}
                    </Box>
                  </MenuItem>
                ))}
                {editMetadataDialog.field === 'sector' && sectors.map((sector) => (
                  <MenuItem key={sector.id} value={sector.name}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Box
                        sx={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          bgcolor: sector.color,
                          border: '1px solid rgba(0,0,0,0.12)'
                        }}
                      />
                      {sector.name}
                    </Box>
                  </MenuItem>
                ))}
                {editMetadataDialog.field === 'industry' && industries.map((industry) => (
                  <MenuItem key={industry.id} value={industry.name}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Box
                        sx={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          bgcolor: industry.color,
                          border: '1px solid rgba(0,0,0,0.12)'
                        }}
                      />
                      {industry.name}
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 2 }}>
              This change will persist across syncs and apply to all positions with this ticker.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseMetadataDialog} disabled={savingMetadata}>
            Cancel
          </Button>
          <Button
            onClick={handleSaveMetadataOverride}
            variant="contained"
            disabled={savingMetadata}
          >
            {savingMetadata ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={metadataDialogOpen} onClose={handleMetadataDialogClose} maxWidth="md" fullWidth>
        <DialogTitle>Manage Instrument Metadata</DialogTitle>
        <DialogContent dividers>
          <Tabs
            value={metadataTab}
            onChange={(_, value) => setMetadataTab(value)}
            variant="fullWidth"
            sx={{ mb: 2 }}
          >
            <Tab label="Types" value="types" />
            <Tab label="Industries" value="industries" />
          </Tabs>

          {metadataTab === 'types' && (
            <Stack spacing={3}>
              <Box>
                <Typography variant="subtitle1" gutterBottom>Existing Types</Typography>
                <Box display="flex" flexWrap="wrap" gap={1}>
                  {instrumentTypes.map((type) => (
                    <Box key={type.id} display="flex" alignItems="center" gap={0.5}>
                      <Chip
                        label={type.name}
                        sx={{ bgcolor: type.color, color: '#fff' }}
                      />
                      <IconButton size="small" onClick={() => handleEditType(type)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => handleDeleteType(type.id)} color="error">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                  {instrumentTypes.length === 0 && (
                    <Typography color="textSecondary">No types created yet.</Typography>
                  )}
                </Box>
              </Box>

              {editingType && (
                <Box p={2} sx={{ bgcolor: 'grey.100', borderRadius: 1 }}>
                  <Typography variant="subtitle1" gutterBottom>
                    Edit Type: {editingType.name}
                  </Typography>
                  <Stack spacing={2}>
                    <TextField
                      label="Name"
                      value={editingType.name}
                      onChange={(event) => setEditingType((prev) => ({ ...prev, name: event.target.value }))}
                      size="small"
                    />
                    <Box>
                      <Typography variant="body2" color="textSecondary" gutterBottom>
                        Select Color
                      </Typography>
                      {renderColorOptions(editingType.color, (color) =>
                        setEditingType((prev) => ({ ...prev, color }))
                      )}
                    </Box>
                    <Stack direction="row" spacing={1}>
                      <Button variant="contained" size="small" onClick={handleUpdateType}>
                        Save Changes
                      </Button>
                      <Button variant="outlined" size="small" onClick={() => setEditingType(null)}>
                        Cancel
                      </Button>
                    </Stack>
                  </Stack>
                </Box>
              )}

              <Box>
                <Typography variant="subtitle1" gutterBottom>Add New Type</Typography>
                <Stack spacing={2}>
                  <TextField
                    label="Name"
                    value={newType.name}
                    onChange={(event) => setNewType((prev) => ({ ...prev, name: event.target.value }))}
                    size="small"
                  />
                  <Box>
                    <Typography variant="body2" color="textSecondary" gutterBottom>
                      Select Color
                    </Typography>
                    {renderColorOptions(newType.color, (color) =>
                      setNewType((prev) => ({ ...prev, color }))
                    )}
                  </Box>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={handleCreateType}
                    disabled={!newType.name.trim()}
                  >
                    Create Type
                  </Button>
                </Stack>
              </Box>
            </Stack>
          )}

          {metadataTab === 'industries' && (
            <Stack spacing={3}>
              <Box>
                <Typography variant="subtitle1" gutterBottom>Existing Industries</Typography>
                <Box display="flex" flexWrap="wrap" gap={1}>
                  {instrumentIndustries.map((industry) => (
                    <Box key={industry.id} display="flex" alignItems="center" gap={0.5}>
                      <Chip
                        label={industry.name}
                        sx={{ bgcolor: industry.color, color: '#fff' }}
                      />
                      <IconButton size="small" onClick={() => handleEditIndustry(industry)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => handleDeleteIndustry(industry.id)} color="error">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                  {instrumentIndustries.length === 0 && (
                    <Typography color="textSecondary">No industries created yet.</Typography>
                  )}
                </Box>
              </Box>

              {editingIndustry && (
                <Box p={2} sx={{ bgcolor: 'grey.100', borderRadius: 1 }}>
                  <Typography variant="subtitle1" gutterBottom>
                    Edit Industry: {editingIndustry.name}
                  </Typography>
                  <Stack spacing={2}>
                    <TextField
                      label="Name"
                      value={editingIndustry.name}
                      onChange={(event) => setEditingIndustry((prev) => ({ ...prev, name: event.target.value }))}
                      size="small"
                    />
                    <Box>
                      <Typography variant="body2" color="textSecondary" gutterBottom>
                        Select Color
                      </Typography>
                      {renderColorOptions(editingIndustry.color, (color) =>
                        setEditingIndustry((prev) => ({ ...prev, color }))
                      )}
                    </Box>
                    <Stack direction="row" spacing={1}>
                      <Button variant="contained" size="small" onClick={handleUpdateIndustry}>
                        Save Changes
                      </Button>
                      <Button variant="outlined" size="small" onClick={() => setEditingIndustry(null)}>
                        Cancel
                      </Button>
                    </Stack>
                  </Stack>
                </Box>
              )}

              <Box>
                <Typography variant="subtitle1" gutterBottom>Add New Industry</Typography>
                <Stack spacing={2}>
                  <TextField
                    label="Name"
                    value={newIndustry.name}
                    onChange={(event) => setNewIndustry((prev) => ({ ...prev, name: event.target.value }))}
                    size="small"
                  />
                  <Box>
                    <Typography variant="body2" color="textSecondary" gutterBottom>
                      Select Color
                    </Typography>
                    {renderColorOptions(newIndustry.color, (color) =>
                      setNewIndustry((prev) => ({ ...prev, color }))
                    )}
                  </Box>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={handleCreateIndustry}
                    disabled={!newIndustry.name.trim()}
                  >
                    Create Industry
                  </Button>
                </Stack>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleMetadataDialogClose}>Close</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
      >
        <Alert
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default Portfolio;
