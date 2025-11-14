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
import { positionsAPI, accountsAPI, instrumentsAPI } from '../services/api';
import { alpha } from '@mui/material/styles';
import { stickyTableHeadSx, stickyFilterRowSx } from '../utils/tableStyles';
import ExportButtons from '../components/ExportButtons';
import { useMobileClick } from '../utils/useMobileClick';
import PositionCard from '../components/PositionCard';

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
  instrument_type_name: '',
  instrument_industry_name: '',
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
  const [instrumentTypes, setInstrumentTypes] = useState([]);
  const [instrumentIndustries, setInstrumentIndustries] = useState([]);
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
  const hasLoadedOnce = useRef(false);
  const priceRefreshTimer = useRef(null);

  const valuationDate = useMemo(
    () => computeValuationDate(datePreset, specificMonth, endOfYear),
    [datePreset, specificMonth, endOfYear]
  );
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
  }, [loadInstrumentMetadata]);

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

  const fetchPositions = useCallback(async () => {
    if (!hasLoadedOnce.current) {
      setLoading(true);
    } else {
      setFetching(true);
    }
    try {
      const classificationParams = {
        instrument_type_id: selectedTypeId || undefined,
        instrument_industry_id: selectedIndustryId || undefined
      };
      const [positionsRes, summaryRes, industryRes, typeRes] = await Promise.all([
        positionsAPI.getAggregated(
          selectedAccountId || undefined,
          valuationDate || undefined,
          classificationParams
        ),
        positionsAPI.getSummary(valuationDate || undefined, {
          account_id: selectedAccountId || undefined,
          ...classificationParams
        }),
        positionsAPI.getIndustryBreakdown({
          account_id: selectedAccountId || undefined,
          as_of_date: valuationDate || undefined,
          ...classificationParams
        }),
        positionsAPI.getTypeBreakdown({
          account_id: selectedAccountId || undefined,
          as_of_date: valuationDate || undefined,
          ...classificationParams
        })
      ]);
      const data = positionsRes.data || [];
      setPositions(data);
      setSummary(summaryRes.data || null);
      setIndustrySlices(industryRes.data || []);
      setTypeSlices(typeRes.data || []);

      const hasPending = data.some((position) => position.price_pending);
      if (hasPending) {
        if (!priceRefreshTimer.current) {
          priceRefreshTimer.current = setTimeout(() => {
            priceRefreshTimer.current = null;
            fetchPositions();
          }, 5000);
        }
      } else if (priceRefreshTimer.current) {
        clearTimeout(priceRefreshTimer.current);
        priceRefreshTimer.current = null;
      }
    } catch (error) {
      console.error('Error fetching positions:', error);
      setPositions([]);
      setSummary(null);
      setIndustrySlices([]);
      setTypeSlices([]);
    } finally {
      hasLoadedOnce.current = true;
      setLoading(false);
      setFetching(false);
    }
  }, [selectedAccountId, selectedTypeId, selectedIndustryId, valuationDate]);

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

  const resetColumnFilters = useCallback(() => {
    setColumnFilters({ ...COLUMN_FILTER_DEFAULTS });
  }, []);

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
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
          <Button
            variant="text"
            size="small"
            startIcon={<CategoryIcon />}
            onClick={() => openMetadataDialog('types')}
          >
            Manage types
          </Button>
          <Button
            variant="text"
            size="small"
            startIcon={<BusinessIcon />}
            onClick={() => openMetadataDialog('industries')}
          >
            Manage industries
          </Button>
          <Button
            variant="contained"
            startIcon={<Refresh />}
            onClick={handleRefreshPrices}
            disabled={refreshing || fetching}
          >
            {refreshing ? 'Refreshing...' : fetching ? 'Updating...' : 'Refresh Prices'}
          </Button>
        </Stack>
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
              {accounts.map((account) => (
                <MenuItem key={account.id} value={account.id}>
                  {account.institution && `${account.institution} - `}
                  {account.label}
                  {account.account_type && ` (${account.account_type.replace(/_/g, ' ')})`}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size={isMobile ? 'medium' : 'small'} sx={{ minWidth: isMobile ? '100%' : 200 }}>
            <InputLabel id="portfolio-date-select">Valuation</InputLabel>
            <Select
              labelId="portfolio-date-select"
              value={datePreset}
              label="Valuation"
              onChange={(event) => setDatePreset(event.target.value)}
              sx={isMobile ? {
                '& .MuiInputBase-root': {
                  minHeight: 48
                }
              } : {}}
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
              size={isMobile ? 'medium' : 'small'}
              value={specificMonth}
              onChange={(event) => setSpecificMonth(event.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth={isMobile}
              sx={isMobile ? {
                '& .MuiInputBase-root': {
                  minHeight: 48
                }
              } : {}}
            />
          )}
          {datePreset === DATE_PRESETS.END_OF_YEAR && (
            <TextField
              label="Year"
              type="number"
              size={isMobile ? 'medium' : 'small'}
              value={endOfYear}
              onChange={(event) => setEndOfYear(event.target.value)}
              InputProps={{ inputProps: { min: 1900, max: 9999 } }}
              fullWidth={isMobile}
              sx={isMobile ? {
                '& .MuiInputBase-root': {
                  minHeight: 48
                }
              } : {}}
            />
          )}
          {datePreset !== DATE_PRESETS.CURRENT && (
            <Button
              variant={isMobile ? 'outlined' : 'text'}
              size={isMobile ? 'medium' : 'small'}
              onClick={() => {
                setDatePreset(DATE_PRESETS.CURRENT);
                setSpecificMonth('');
                setEndOfYear('');
              }}
              fullWidth={isMobile}
              sx={isMobile ? {
                minHeight: 48,
                textTransform: 'none',
                fontWeight: 500
              } : {}}
            >
              Clear selection
            </Button>
          )}

          <FormControl size={isMobile ? 'medium' : 'small'} sx={{ minWidth: isMobile ? '100%' : 200 }}>
            <InputLabel id="portfolio-type-select">Type</InputLabel>
            <Select
              labelId="portfolio-type-select"
              value={selectedTypeId}
              label="Type"
              onChange={(event) => setSelectedTypeId(event.target.value)}
              sx={isMobile ? {
                '& .MuiInputBase-root': {
                  minHeight: 48
                }
              } : {}}
              renderValue={(value) => {
                if (!value) {
                  return <em>All types</em>;
                }
                if (value === UNCLASSIFIED_SENTINEL) {
                  return <em>Unclassified only</em>;
                }
                const info = typeLookup[value];
                return (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {renderColorSwatch(info?.color)}
                    <span>{info?.name || 'Unknown'}</span>
                  </Box>
                );
              }}
            >
              <MenuItem value="">
                <em>All types</em>
              </MenuItem>
              <MenuItem value={UNCLASSIFIED_SENTINEL}>
                <em>Unclassified only</em>
              </MenuItem>
              {instrumentTypes.map((type) => (
                <MenuItem key={type.id} value={type.id}>
                  {renderColorSwatch(type.color)}
                  {type.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size={isMobile ? 'medium' : 'small'} sx={{ minWidth: isMobile ? '100%' : 200 }}>
            <InputLabel id="portfolio-industry-select">Industry</InputLabel>
            <Select
              labelId="portfolio-industry-select"
              value={selectedIndustryId}
              label="Industry"
              onChange={(event) => setSelectedIndustryId(event.target.value)}
              sx={isMobile ? {
                '& .MuiInputBase-root': {
                  minHeight: 48
                }
              } : {}}
              renderValue={(value) => {
                if (!value) {
                  return <em>All industries</em>;
                }
                if (value === UNCLASSIFIED_SENTINEL) {
                  return <em>Unclassified only</em>;
                }
                const info = industryLookup[value];
                return (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {renderColorSwatch(info?.color)}
                    <span>{info?.name || 'Unknown'}</span>
                  </Box>
                );
              }}
            >
              <MenuItem value="">
                <em>All industries</em>
              </MenuItem>
              <MenuItem value={UNCLASSIFIED_SENTINEL}>
                <em>Unclassified only</em>
              </MenuItem>
              {instrumentIndustries.map((industry) => (
                <MenuItem key={industry.id} value={industry.id}>
                  {renderColorSwatch(industry.color)}
                  {industry.name}
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
          <Paper sx={{ p: 3, height: '100%' }}>
            <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
              <Box>
                <Typography variant="h6" gutterBottom>
                  Industry Allocation
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Market value distribution by industry
                </Typography>
              </Box>
              {selectedIndustryId && (
                <Tooltip title="Clear industry filter">
                  <IconButton
                    size="small"
                    onClick={clearIndustryFilter}
                    sx={{
                      bgcolor: 'primary.main',
                      color: 'white',
                      '&:hover': { bgcolor: 'primary.dark' }
                    }}
                  >
                    <FilterIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
            {industrySlices.length === 0 ? (
              <Typography color="textSecondary">
                Classify your positions to see the breakdown by industry.
              </Typography>
            ) : (
              <Box sx={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={industrySlices}
                      dataKey="market_value"
                      nameKey="industry_name"
                      cx="50%"
                      cy="50%"
                      innerRadius="45%"
                      outerRadius="80%"
                      paddingAngle={2}
                      labelLine={false}
                    >
                      {industrySlices.map((slice) => (
                        <Cell
                          key={slice.industry_id || 'unclassified'}
                          fill={slice.color || '#b0bec5'}
                          onClick={() => handleIndustrySliceClick(slice)}
                        />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      formatter={(value, name, payload) => [
                        formatCurrency(value),
                        payload?.payload?.industry_name || name
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </Box>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
              <Box>
                <Typography variant="h6" gutterBottom>
                  Asset Type Allocation
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Market value distribution by asset type
                </Typography>
              </Box>
              {selectedTypeId && (
                <Tooltip title="Clear type filter">
                  <IconButton
                    size="small"
                    onClick={clearTypeFilter}
                    sx={{
                      bgcolor: 'primary.main',
                      color: 'white',
                      '&:hover': { bgcolor: 'primary.dark' }
                    }}
                  >
                    <FilterIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
            {typeSlices.length === 0 ? (
              <Typography color="textSecondary">
                Assign instrument types to see this breakdown.
              </Typography>
            ) : (
              <Box sx={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={typeSlices}
                      dataKey="market_value"
                      nameKey="type_name"
                      cx="50%"
                      cy="50%"
                      innerRadius="45%"
                      outerRadius="80%"
                      paddingAngle={2}
                      labelLine={false}
                    >
                      {typeSlices.map((slice) => (
                        <Cell
                          key={slice.type_id || 'unclassified_type'}
                          fill={slice.color || '#b0bec5'}
                          onClick={() => handleTypeSliceClick(slice)}
                        />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      formatter={(value, name, payload) => [
                        formatCurrency(value),
                        payload?.payload?.type_name || name
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </Box>
            )}
          </Paper>
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
                    typeColor={position.instrument_type_id ? typeLookup[position.instrument_type_id]?.color : null}
                    industryColor={position.instrument_industry_id ? industryLookup[position.instrument_industry_id]?.color : null}
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
                  <TableCell sortDirection={orderBy === 'instrument_type_name' ? order : false}>
                    <TableSortLabel
                      active={orderBy === 'instrument_type_name'}
                      direction={orderBy === 'instrument_type_name' ? order : 'asc'}
                      onClick={() => handleRequestSort('instrument_type_name')}
                    >
                      <strong>Type</strong>
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={orderBy === 'instrument_industry_name' ? order : false}>
                    <TableSortLabel
                      active={orderBy === 'instrument_industry_name'}
                      direction={orderBy === 'instrument_industry_name' ? order : 'asc'}
                      onClick={() => handleRequestSort('instrument_industry_name')}
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
                  <TableCell>{renderFilterField('instrument_type_name', 'Type')}</TableCell>
                  <TableCell>{renderFilterField('instrument_industry_name', 'Industry')}</TableCell>
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
                  <TableRow key={position.ticker}>
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
                      <Stack direction="row" spacing={1} alignItems="center">
                        <ClassificationTag
                          value={position.instrument_type_id}
                          options={instrumentTypes}
                          disabled={classificationSaving[position.ticker]}
                          onChange={(nextValue) =>
                            handleClassificationUpdate(position, {
                              instrument_type_id: nextValue
                            })
                          }
                        />
                        {classificationSaving[position.ticker] && <CircularProgress size={16} />}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <ClassificationTag
                          value={position.instrument_industry_id}
                          options={instrumentIndustries}
                          disabled={classificationSaving[position.ticker]}
                          onChange={(nextValue) =>
                            handleClassificationUpdate(position, {
                              instrument_industry_id: nextValue
                            })
                          }
                        />
                      </Stack>
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
