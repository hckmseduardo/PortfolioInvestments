import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Container,
  Paper,
  Typography,
  Grid,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  Alert,
  Tabs,
  Tab,
  CircularProgress,
  Stack,
  TableSortLabel,
  Checkbox,
  useMediaQuery,
  useTheme,
  Card,
  CardContent
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Refresh as RefreshIcon,
  Category as CategoryIcon,
  FilterAlt as FilterAltIcon,
  Clear as ClearIcon
} from '@mui/icons-material';
import { expensesAPI, accountsAPI } from '../services/api';
import { useNotification } from '../context/NotificationContext';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, LineChart, Line } from 'recharts';
import { stickyTableHeadSx, stickyFilterRowSx } from '../utils/tableStyles';
import ExportButtons from '../components/ExportButtons';
import { useMobileClick } from '../utils/useMobileClick';
import ExpenseCard from '../components/ExpenseCard';

const CHART_COLORS = ['#4CAF50', '#FF9800', '#2196F3', '#9C27B0', '#E91E63', '#00BCD4', '#F44336', '#795548', '#607D8B', '#9E9E9E', '#FF5722', '#757575'];

const COLOR_PALETTE = [
  '#4CAF50', '#8BC34A', '#CDDC39', '#FFEB3B', '#FFC107', '#FF9800',
  '#FF5722', '#F44336', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5',
  '#2196F3', '#03A9F4', '#00BCD4', '#009688', '#4DB6AC', '#80CBC4',
  '#607D8B', '#795548', '#9E9E9E', '#757575', '#424242', '#212121'
];

// Account types that appear in Cashflow section
// Only checking and credit card accounts are tracked for cashflow/expense management
const ALLOWED_EXPENSE_ACCOUNT_TYPES = ['checking', 'credit_card'];

// Special categories that can only have their color changed
const SPECIAL_CATEGORIES = ['Uncategorized', 'Dividend', 'Transfer'];

const isAllowedExpenseAccount = (account = {}) =>
  ALLOWED_EXPENSE_ACCOUNT_TYPES.includes(String(account.account_type || '').toLowerCase());

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

const DEFAULT_PRESET = 'thisMonth';

const TABLE_FILTER_DEFAULTS = {
  date: '',
  description: '',
  account: '',
  category: '',
  amountMin: '',
  amountMax: '',
  notes: ''
};

const formatDateToInput = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const Cashflow = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [tabValue, setTabValue] = useState(0);
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState(null);
  const [monthlyComparison, setMonthlyComparison] = useState(null);
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedPreset, setSelectedPreset] = useState(DEFAULT_PRESET);
  const [loading, setLoading] = useState(true);
  const [editingExpense, setEditingExpense] = useState(null);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [categoryTabValue, setCategoryTabValue] = useState(0);
  const [editingCategory, setEditingCategory] = useState(null);
  const [newCategory, setNewCategory] = useState({ name: '', type: 'money_out', color: '#4CAF50', budget_limit: '' });
  const [conversionJobId, setConversionJobId] = useState(null);
  const [conversionJobStatus, setConversionJobStatus] = useState(null);
  const [conversionStage, setConversionStage] = useState(null);
  const [isConversionRunning, setIsConversionRunning] = useState(false);

  // Separate filter states for Money Out tab
  const [moneyOutCategory, setMoneyOutCategory] = useState('');
  const [moneyOutSortConfig, setMoneyOutSortConfig] = useState({ field: 'date', direction: 'desc' });
  const [moneyOutFilters, setMoneyOutFilters] = useState(() => ({ ...TABLE_FILTER_DEFAULTS }));
  const [selectedExpenseIds, setSelectedExpenseIds] = useState([]);
  const [bulkCategory, setBulkCategory] = useState('');
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);

  // Separate filter states for Money In tab
  const [moneyInCategory, setMoneyInCategory] = useState('');
  const [moneyInSortConfig, setMoneyInSortConfig] = useState({ field: 'date', direction: 'desc' });
  const [moneyInFilters, setMoneyInFilters] = useState(() => ({ ...TABLE_FILTER_DEFAULTS }));
  // State for Incomes List
  const [selectedIncomeIds, setSelectedIncomeIds] = useState([]);
  const [bulkIncomeCategory, setBulkIncomeCategory] = useState('');

  // Separate filter states for Transfers tab
  const [transfersSortConfig, setTransfersSortConfig] = useState({ field: 'date', direction: 'desc' });
  const [transfersFilters, setTransfersFilters] = useState(() => ({ ...TABLE_FILTER_DEFAULTS }));

  // State for Investments List
  const [selectedInvestmentIds, setSelectedInvestmentIds] = useState([]);
  const [bulkInvestmentCategory, setBulkInvestmentCategory] = useState('');
  // State for Transfers List
  const [selectedTransferIds, setSelectedTransferIds] = useState([]);
  const [bulkTransferCategory, setBulkTransferCategory] = useState('');
  const conversionPollRef = useRef(null);
  const conversionJobIdRef = useRef(null);
  const conversionNotificationIdRef = useRef(null);
  const { showSuccess, showError, showWarning, showInfo, showJobProgress, updateJobStatus, isJobRunning, getActiveJob } = useNotification();

  const JOB_TYPE_CONVERSION = 'transaction-conversion';

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

  const handleTableSort = (field) => {
    // Sort for Money Out tab (tabValue === 1)
    if (tabValue === 1) {
      setMoneyOutSortConfig((prev) => {
        if (prev.field === field) {
          return { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
        }
        return { field, direction: 'asc' };
      });
    }
    // Sort for Money In tab (tabValue === 2)
    else if (tabValue === 2) {
      setMoneyInSortConfig((prev) => {
        if (prev.field === field) {
          return { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
        }
        return { field, direction: 'asc' };
      });
    }
    // Sort for Transfers tab (tabValue === 3)
    else if (tabValue === 3) {
      setTransfersSortConfig((prev) => {
        if (prev.field === field) {
          return { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
        }
        return { field, direction: 'asc' };
      });
    }
  };

  const handleTableFilterChange = (field, value) => {
    // Filter for Money Out tab (tabValue === 1)
    if (tabValue === 1) {
      setMoneyOutFilters((prev) => ({
        ...prev,
        [field]: value
      }));
    }
    // Filter for Money In tab (tabValue === 2)
    else if (tabValue === 2) {
      setMoneyInFilters((prev) => ({
        ...prev,
        [field]: value
      }));
    }
    // Filter for Transfers tab (tabValue === 3)
    else if (tabValue === 3) {
      setTransfersFilters((prev) => ({
        ...prev,
        [field]: value
      }));
    }
  };

  const resetTableFilters = () => {
    // Reset for Money Out tab (tabValue === 1)
    if (tabValue === 1) {
      setMoneyOutFilters({ ...TABLE_FILTER_DEFAULTS });
    }
    // Reset for Money In tab (tabValue === 2)
    else if (tabValue === 2) {
      setMoneyInFilters({ ...TABLE_FILTER_DEFAULTS });
    }
    // Reset for Transfers tab (tabValue === 3)
    else if (tabValue === 3) {
      setTransfersFilters({ ...TABLE_FILTER_DEFAULTS });
    }
  };

  const handleFilterByDescription = (description) => {
    // Set the filter
    handleTableFilterChange('description', description || '');

    // Auto-select all matching expenses
    const matchingExpenses = expenses.filter(expense =>
      String(expense.description || '').toLowerCase() === String(description || '').toLowerCase()
    );
    const matchingIds = matchingExpenses.map(exp => exp.id);
    setSelectedExpenseIds(matchingIds);
  };

  const handleFilterByAmount = (amount) => {
    // Filter by amount +/- 10%
    const amountNum = Number(amount) || 0;
    const minAmount = amountNum * 0.9;
    const maxAmount = amountNum * 1.1;

    handleTableFilterChange('amountMin', minAmount.toFixed(2));
    handleTableFilterChange('amountMax', maxAmount.toFixed(2));

    // Auto-select all matching expenses
    const matchingExpenses = expenses.filter(expense => {
      const expAmount = Number(expense.amount) || 0;
      return expAmount >= minAmount && expAmount <= maxAmount;
    });
    const matchingIds = matchingExpenses.map(exp => exp.id);
    setSelectedExpenseIds(matchingIds);
  };

  const clearColumnFilter = (column) => {
    // Clear filter for Money Out tab (tabValue === 1)
    if (tabValue === 1) {
      const updates = { ...moneyOutFilters };
      switch (column) {
        case 'date':
          updates.date = '';
          break;
        case 'description':
          updates.description = '';
          break;
        case 'account':
          updates.account = '';
          break;
        case 'amount':
          updates.amountMin = '';
          updates.amountMax = '';
          break;
        case 'notes':
          updates.notes = '';
          break;
        default:
          break;
      }
      setMoneyOutFilters(updates);
    }
    // Clear filter for Money In tab (tabValue === 2)
    else if (tabValue === 2) {
      const updates = { ...moneyInFilters };
      switch (column) {
        case 'date':
          updates.date = '';
          break;
        case 'description':
          updates.description = '';
          break;
        case 'account':
          updates.account = '';
          break;
        case 'amount':
          updates.amountMin = '';
          updates.amountMax = '';
          break;
        case 'notes':
          updates.notes = '';
          break;
        default:
          break;
      }
      setMoneyInFilters(updates);
    }
  };

  const hasActiveFilters = () => {
    // Check filters for Money Out tab (tabValue === 1)
    if (tabValue === 1) {
      return moneyOutCategory ||
             moneyOutFilters.date ||
             moneyOutFilters.description ||
             moneyOutFilters.account ||
             moneyOutFilters.amountMin ||
             moneyOutFilters.amountMax ||
             moneyOutFilters.notes;
    }
    // Check filters for Money In tab (tabValue === 2)
    else if (tabValue === 2) {
      return moneyInCategory ||
             moneyInFilters.date ||
             moneyInFilters.description ||
             moneyInFilters.account ||
             moneyInFilters.amountMin ||
             moneyInFilters.amountMax ||
             moneyInFilters.notes;
    }
    return false;
  };

  const clearAllFilters = () => {
    // Clear filters for Money Out tab (tabValue === 1)
    if (tabValue === 1) {
      setMoneyOutCategory('');
      setMoneyOutFilters({ ...TABLE_FILTER_DEFAULTS });
    }
    // Clear filters for Money In tab (tabValue === 2)
    else if (tabValue === 2) {
      setMoneyInCategory('');
      setMoneyInFilters({ ...TABLE_FILTER_DEFAULTS });
    }
  };

  const toggleExpenseSelection = (expenseId) => {
    setSelectedExpenseIds((prev) =>
      prev.includes(expenseId) ? prev.filter((id) => id !== expenseId) : [...prev, expenseId]
    );
  };

  const handleSelectAllExpenses = (checked, expensesSource) => {
    if (!checked) {
      setSelectedExpenseIds([]);
      return;
    }
    const ids = expensesSource.map((expense) => expense.id);
    setSelectedExpenseIds(ids);
  };

  const handleBulkCategoryApply = async () => {
    if (!bulkCategory || selectedExpenseIds.length === 0) {
      return;
    }
    setIsBulkUpdating(true);
    try {
      await Promise.all(selectedExpenseIds.map((expenseId) => expensesAPI.updateExpenseCategory(expenseId, bulkCategory)));
      showSuccess(`Updated ${selectedExpenseIds.length} expenses`);
      setSelectedExpenseIds([]);
      setBulkCategory('');
      await fetchExpenses();
      await fetchSummary();
      await fetchMonthlyComparison();
    } catch (error) {
      console.error('Error applying bulk category:', error);
      showError('Error applying bulk category');
    } finally {
      setIsBulkUpdating(false);
    }
  };

  // Income selection and bulk category functions
  const toggleIncomeSelection = (incomeId) => {
    setSelectedIncomeIds((prev) =>
      prev.includes(incomeId) ? prev.filter((id) => id !== incomeId) : [...prev, incomeId]
    );
  };

  const handleSelectAllIncomes = (checked, incomesSource) => {
    if (!checked) {
      setSelectedIncomeIds([]);
      return;
    }
    const ids = incomesSource.map((income) => income.id);
    setSelectedIncomeIds(ids);
  };

  const handleBulkIncomeCategoryApply = async () => {
    if (!bulkIncomeCategory || selectedIncomeIds.length === 0) {
      return;
    }
    setIsBulkUpdating(true);
    try {
      await Promise.all(selectedIncomeIds.map((incomeId) => expensesAPI.updateExpenseCategory(incomeId, bulkIncomeCategory)));
      showSuccess(`Updated ${selectedIncomeIds.length} incomes`);
      setSelectedIncomeIds([]);
      setBulkIncomeCategory('');
      await fetchExpenses();
      await fetchSummary();
      await fetchMonthlyComparison();
    } catch (error) {
      console.error('Error applying bulk category:', error);
      showError('Error applying bulk category');
    } finally {
      setIsBulkUpdating(false);
    }
  };

  // Investment selection and bulk category functions
  const toggleInvestmentSelection = (investmentId) => {
    setSelectedInvestmentIds((prev) =>
      prev.includes(investmentId) ? prev.filter((id) => id !== investmentId) : [...prev, investmentId]
    );
  };

  const handleSelectAllInvestments = (checked, investmentsSource) => {
    if (!checked) {
      setSelectedInvestmentIds([]);
      return;
    }
    const ids = investmentsSource.map((investment) => investment.id);
    setSelectedInvestmentIds(ids);
  };

  const handleBulkInvestmentCategoryApply = async () => {
    if (!bulkInvestmentCategory || selectedInvestmentIds.length === 0) {
      return;
    }
    setIsBulkUpdating(true);
    try {
      await Promise.all(selectedInvestmentIds.map((investmentId) => expensesAPI.updateExpenseCategory(investmentId, bulkInvestmentCategory)));
      showSuccess(`Updated ${selectedInvestmentIds.length} investments`);
      setSelectedInvestmentIds([]);
      setBulkInvestmentCategory('');
      await fetchExpenses();
      await fetchSummary();
      await fetchMonthlyComparison();
    } catch (error) {
      console.error('Error applying bulk category:', error);
      showError('Error applying bulk category');
    } finally {
      setIsBulkUpdating(false);
    }
  };

  // Transfer selection and bulk category functions
  const toggleTransferSelection = (transferId) => {
    setSelectedTransferIds((prev) =>
      prev.includes(transferId) ? prev.filter((id) => id !== transferId) : [...prev, transferId]
    );
  };

  const handleSelectAllTransfers = (checked, transfersSource) => {
    if (!checked) {
      setSelectedTransferIds([]);
      return;
    }
    const ids = transfersSource.map((transfer) => transfer.id);
    setSelectedTransferIds(ids);
  };

  const handleBulkTransferCategoryApply = async () => {
    if (!bulkTransferCategory || selectedTransferIds.length === 0) {
      return;
    }
    setIsBulkUpdating(true);
    try {
      await Promise.all(selectedTransferIds.map((transferId) => expensesAPI.updateExpenseCategory(transferId, bulkTransferCategory)));
      showSuccess(`Updated ${selectedTransferIds.length} transfers`);
      setSelectedTransferIds([]);
      setBulkTransferCategory('');
      await fetchExpenses();
      await fetchSummary();
      await fetchMonthlyComparison();
    } catch (error) {
      console.error('Error applying bulk category:', error);
      showError('Error applying bulk category');
    } finally {
      setIsBulkUpdating(false);
    }
  };

  useEffect(() => {
    fetchInitialData();

    // Check if there's an active conversion job on mount
    const activeJob = getActiveJob(JOB_TYPE_CONVERSION);
    if (activeJob && activeJob.jobId) {
      // Resume the job polling
      setConversionJobId(activeJob.jobId);
      conversionNotificationIdRef.current = activeJob.notificationId;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    applyPreset(DEFAULT_PRESET);
  }, [applyPreset]);

  useEffect(() => {
    if (!loading) {
      fetchExpenses();
      fetchSummary();
    }
  }, [selectedAccount, startDate, endDate, loading]);

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      await Promise.all([
        fetchCategories(),
        fetchAccounts(),
        fetchExpenses(),
        fetchSummary(),
        fetchMonthlyComparison()
      ]);
    } catch (error) {
      console.error('Error fetching initial data:', error);
      showError('Error loading data');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await expensesAPI.getCategories();
      setCategories(response.data);

      // If no categories exist, initialize defaults
      if (response.data.length === 0) {
        const initResponse = await expensesAPI.initDefaultCategories();
        setCategories(initResponse.data.categories);
        showSuccess('Default categories initialized');
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const getDateRangeFilter = () => {
    const parsedStart = startDate ? new Date(startDate) : null;
    const parsedEnd = endDate ? new Date(endDate) : null;

    if (parsedStart) {
      parsedStart.setHours(0, 0, 0, 0);
    }

    if (parsedEnd) {
      parsedEnd.setHours(23, 59, 59, 999);
    }

    return { startDate: parsedStart, endDate: parsedEnd };
  };

  const fetchAccounts = async () => {
    try {
      const response = await accountsAPI.getAll();
      const filteredAccounts = (response.data || []).filter(isAllowedExpenseAccount);
      setAccounts(filteredAccounts);

      if (selectedAccount && !filteredAccounts.some(account => account.id === selectedAccount)) {
        setSelectedAccount('');
      }

      return filteredAccounts;
    } catch (error) {
      console.error('Error fetching accounts:', error);
      return [];
    }
  };

  const fetchExpenses = async () => {
    try {
      // Get date range filter for backend
      const { startDate: filterStart, endDate: filterEnd } = getDateRangeFilter();
      const startDateStr = filterStart ? formatDateToInput(filterStart) : null;
      const endDateStr = filterEnd ? formatDateToInput(filterEnd) : null;

      // Fetch expenses with date filtering done on backend for performance
      const response = await expensesAPI.getAll(
        selectedAccount || null,
        null,
        startDateStr,
        endDateStr
      );

      setExpenses(response.data);
    } catch (error) {
      console.error('Error fetching expenses:', error);
    }
  };

  const fetchSummary = async () => {
    try {
      const response = await expensesAPI.getSummary(selectedAccount || null);
      const { startDate: filterStart, endDate: filterEnd } = getDateRangeFilter();

      // Filter summary by date range if needed
      if (filterStart || filterEnd) {
        // Recalculate summary for the filtered date range
        const allExpenses = await expensesAPI.getAll(selectedAccount || null, null);
        const filteredExpenses = allExpenses.data.filter(expense => {
          const expenseDate = new Date(expense.date);
          const isAfterStart = filterStart ? expenseDate >= filterStart : true;
          const isBeforeEnd = filterEnd ? expenseDate <= filterEnd : true;
          return isAfterStart && isBeforeEnd;
        });

        const totalExpenses = filteredExpenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
        const byCategory = {};
        filteredExpenses.forEach(exp => {
          const cat = exp.category || 'Uncategorized';
          byCategory[cat] = (byCategory[cat] || 0) + (exp.amount || 0);
        });

        setSummary({
          total_expenses: totalExpenses,
          by_category: byCategory,
          expense_count: filteredExpenses.length
        });
      } else {
        setSummary(response.data);
      }
    } catch (error) {
      console.error('Error fetching summary:', error);
    }
  };

  const fetchMonthlyComparison = async () => {
    try {
      const response = await expensesAPI.getMonthlyComparison(6, selectedAccount || null);
      setMonthlyComparison(response.data);
    } catch (error) {
      console.error('Error fetching monthly comparison:', error);
    }
  };

  const formatStageLabel = (stage) => {
    if (!stage) return '';
    return stage
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const clearConversionPolling = () => {
    if (conversionPollRef.current) {
      clearInterval(conversionPollRef.current);
      conversionPollRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearConversionPolling();
  }, []);

  useEffect(() => {
    if (!conversionJobId) {
      conversionJobIdRef.current = null;
      setConversionJobStatus(null);
      setConversionStage(null);
      setIsConversionRunning(false);
      clearConversionPolling();
      conversionNotificationIdRef.current = null;
      return;
    }

    setIsConversionRunning(true);
    conversionJobIdRef.current = conversionJobId;

    const pollJob = async (jobId) => {
      try {
        if (!jobId) return;
        const response = await expensesAPI.getConversionJobStatus(jobId);
        const data = response.data;
        setConversionJobStatus(data.status);
        setConversionStage(data.meta?.stage || data.status);

        if (data.status === 'finished') {
          clearConversionPolling();
          setConversionJobId(null);
          setIsConversionRunning(false);

          // Update notification to success
          const notifId = conversionNotificationIdRef.current;
          if (notifId !== undefined) {
            updateJobStatus(notifId, data.result?.message || 'Transactions converted successfully', 'success', JOB_TYPE_CONVERSION);
          }
          conversionNotificationIdRef.current = null;

          await fetchInitialData();
        } else if (data.status === 'failed') {
          clearConversionPolling();
          setConversionJobId(null);
          setIsConversionRunning(false);

          // Update notification to error
          const notifId = conversionNotificationIdRef.current;
          const errorMessage = data.error?.split('\n').slice(-2, -1)[0] || 'Conversion job failed';
          if (notifId !== undefined) {
            updateJobStatus(notifId, errorMessage, 'error', JOB_TYPE_CONVERSION);
          }
          conversionNotificationIdRef.current = null;
        }
      } catch (error) {
        if (conversionJobIdRef.current !== jobId) {
          // Stale poll result from previous job; ignore.
          return;
        }

        if (error.response?.status === 404) {
          clearConversionPolling();
          setConversionJobId(null);
          setIsConversionRunning(false);

          // Update notification to warning
          const notifId = conversionNotificationIdRef.current;
          if (notifId !== undefined) {
            updateJobStatus(notifId, 'Conversion job expired or was removed. Please try again.', 'warning', JOB_TYPE_CONVERSION);
          }
          conversionNotificationIdRef.current = null;
          return;
        }

        console.error('Error polling conversion job:', error);
        clearConversionPolling();
        setConversionJobId(null);
        setIsConversionRunning(false);

        // Update notification to error
        const notifId = conversionNotificationIdRef.current;
        if (notifId !== undefined) {
          updateJobStatus(notifId, 'Error monitoring conversion job', 'error', JOB_TYPE_CONVERSION);
        }
        conversionNotificationIdRef.current = null;
      }
    };

    pollJob(conversionJobId);
    conversionPollRef.current = setInterval(() => pollJob(conversionJobIdRef.current), 4000);

    return () => clearConversionPolling();
  }, [conversionJobId, updateJobStatus, fetchInitialData]);

  const handleConvertTransactions = async () => {
    // Check if a conversion job is already running
    if (isConversionRunning || isJobRunning(JOB_TYPE_CONVERSION)) {
      showWarning('A conversion job is already running. Please wait for it to complete.');
      return;
    }

    try {
      const response = await expensesAPI.convertTransactions(selectedAccount || null);
      const { job_id: jobId, status, meta } = response.data || {};

      if (!jobId) {
        showError('Unable to start conversion job');
        return;
      }

      setConversionJobId(jobId);
      setConversionJobStatus(status);
      setConversionStage(meta?.stage || 'queued');

      // Show persistent notification for background job with jobType
      const notificationId = showJobProgress('Converting transactions to cashflow', jobId, JOB_TYPE_CONVERSION);
      conversionNotificationIdRef.current = notificationId;
    } catch (error) {
      console.error('Error converting transactions:', error);
      showError('Error starting conversion job');
    }
  };

  const handleRecategorize = async () => {
    if (!window.confirm('This will reset all cashflow records to "Uncategorized". Are you sure?')) {
      return;
    }

    try {
      const response = await expensesAPI.recategorize();
      showSuccess(response.data.message || 'All records reset to Uncategorized');
      await fetchExpenses();
      await fetchSummary();
      await fetchMonthlyComparison();
    } catch (error) {
      console.error('Error recategorizing:', error);
      showError('Error resetting categories');
    }
  };

  const handleCategoryChange = async (expenseId, newCategory) => {
    try {
      await expensesAPI.updateExpenseCategory(expenseId, newCategory);
      showSuccess('Category updated successfully');
      await fetchExpenses();
      await fetchSummary();
      await fetchMonthlyComparison();
    } catch (error) {
      console.error('Error updating category:', error);
      showError('Error updating category');
    }
  };

  const handleDeleteExpense = async (expenseId) => {
    if (window.confirm('Are you sure you want to delete this expense?')) {
      try {
        await expensesAPI.delete(expenseId);
        showSuccess('Expense deleted successfully');
        await fetchExpenses();
        await fetchSummary();
        await fetchMonthlyComparison();
      } catch (error) {
        console.error('Error deleting expense:', error);
        showError('Error deleting expense');
      }
    }
  };

  const handleCreateCategory = async () => {
    try {
      const categoryData = {
        ...newCategory,
        budget_limit: newCategory.budget_limit ? parseFloat(newCategory.budget_limit) : null
      };
      await expensesAPI.createCategory(categoryData);
      showSuccess('Category created successfully');
      setCategoryDialogOpen(false);
      setNewCategory({ name: '', type: 'money_out', color: '#4CAF50', budget_limit: '' });
      await fetchCategories();
    } catch (error) {
      console.error('Error creating category:', error);
      showError('Error creating category');
    }
  };

  const handleEditCategory = (category) => {
    setEditingCategory({
      id: category.id,
      name: category.name,
      type: category.type || 'expense',
      color: category.color,
      budget_limit: category.budget_limit || ''
    });
  };

  const handleUpdateCategory = async () => {
    try {
      const categoryData = {
        name: editingCategory.name,
        type: editingCategory.type,
        color: editingCategory.color,
        budget_limit: editingCategory.budget_limit ? parseFloat(editingCategory.budget_limit) : null
      };
      await expensesAPI.updateCategory(editingCategory.id, categoryData);
      showSuccess('Category updated successfully');
      setEditingCategory(null);
      await fetchCategories();
    } catch (error) {
      console.error('Error updating category:', error);
      showError('Error updating category');
    }
  };

  const handleDeleteCategory = async (categoryId) => {
    if (window.confirm('Are you sure you want to delete this category?')) {
      try {
        await expensesAPI.deleteCategory(categoryId);
        showSuccess('Category deleted successfully');
        await fetchCategories();
      } catch (error) {
        console.error('Error deleting category:', error);
        showError('Error deleting category');
      }
    }
  };

  const handleRefreshToDefaults = async () => {
    if (window.confirm('This will reset all categories to defaults. Your current categories will be replaced. Are you sure?')) {
      try {
        await expensesAPI.initDefaultCategories(true);
        showSuccess('Categories refreshed to defaults successfully');
        setEditingCategory(null);
        await fetchCategories();
      } catch (error) {
        console.error('Error refreshing categories:', error);
        showError('Error refreshing categories');
      }
    }
  };

  // Category tab helpers
  const getCategoryTypeFromTab = (tabIndex) => {
    const types = ['money_out', 'money_in'];
    return types[tabIndex] || 'money_out';
  };

  const getTabFromCategoryType = (type) => {
    const types = ['money_out', 'money_in'];
    return types.indexOf(type);
  };

  const handleCategoryTabChange = (event, newValue) => {
    setCategoryTabValue(newValue);
    setEditingCategory(null);
    const newType = getCategoryTypeFromTab(newValue);
    setNewCategory({ name: '', type: newType, color: '#4CAF50', budget_limit: '' });
  };

  const getFilteredCategories = () => {
    const currentType = getCategoryTypeFromTab(categoryTabValue);
    return categories.filter(cat => cat.type === currentType);
  };

  const handleOpenCategoryDialog = () => {
    setCategoryTabValue(0);
    setEditingCategory(null);
    setNewCategory({ name: '', type: 'money_out', color: '#4CAF50', budget_limit: '' });
    setCategoryDialogOpen(true);
  };


  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(value);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-CA');
  };

  const getCategoryColor = (categoryName) => {
    const category = categories.find(c => c.name === categoryName);
    return category?.color || '#757575';
  };

  const getAccountLabel = (accountId) => {
    const account = accounts.find(a => a.id === accountId);
    return account?.label || 'Unknown';
  };

  const renderCategoryLabel = (label, fallbackLabel = 'All Categories') => {
    if (!label) {
      return <Typography variant="body2">{fallbackLabel}</Typography>;
    }

    return (
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box
          sx={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            bgcolor: getCategoryColor(label),
            border: '1px solid rgba(0,0,0,0.1)'
          }}
        />
        <Typography variant="body2">{label}</Typography>
      </Stack>
    );
  };

  const getSortableValue = (expense, field) => {
    switch (field) {
      case 'date':
        return new Date(expense.date).getTime();
      case 'description':
        return String(expense.description || '').toLowerCase();
      case 'account':
        return getAccountLabel(expense.account_id).toLowerCase();
      case 'category':
        return String(expense.category || 'Uncategorized').toLowerCase();
      case 'amount':
        return Number(expense.amount) || 0;
      case 'notes':
        return String(expense.notes || '').toLowerCase();
      default:
        return expense[field] ?? '';
    }
  };

  // Prepare chart data
  const categoryData = Object.entries(summary?.by_category || {})
    .map(([category, amount]) => ({
      name: category,
      value: amount,
      color: getCategoryColor(category)
    }));

  // Separate data by type (money_in, money_out)
  const getCategoryType = (categoryName) => {
    const category = categories.find(c => c.name === categoryName);
    return category?.type || 'money_out';
  };

  // Prepare Money In and Money Out pie chart data
  // Exclude transfer categories from the charts
  const transferCategories = ['Transfer', 'Credit Card Payment', 'Investment In', 'Investment Out'];
  const moneyInData = categoryData.filter(item =>
    getCategoryType(item.name) === 'money_in' && !transferCategories.includes(item.name)
  );
  const moneyOutData = categoryData.filter(item =>
    getCategoryType(item.name) === 'money_out' && !transferCategories.includes(item.name)
  );

  const totalMoneyIn = moneyInData.reduce((sum, item) => sum + item.value, 0);
  const totalMoneyOut = moneyOutData.reduce((sum, item) => sum + item.value, 0);

  // Mobile-aware click handler for money out pie chart (double-click on mobile, single-click on desktop)
  const handleMoneyOutPieClickBase = useCallback((_, index) => {
    const selected = moneyOutData[index];
    if (selected) {
      setMoneyOutCategory(selected.name);
      setTabValue(1); // Money Out tab is now at index 1
    }
  }, [moneyOutData, setMoneyOutCategory, setTabValue]);

  const handleMoneyOutPieClick = useMobileClick(handleMoneyOutPieClickBase);

  // Mobile-aware click handler for money in pie chart (double-click on mobile, single-click on desktop)
  const handleMoneyInPieClickBase = useCallback((_, index) => {
    const selected = moneyInData[index];
    if (selected) {
      setMoneyInCategory(selected.name);
      setTabValue(2); // Money In tab is at index 2
    }
  }, [moneyInData, setMoneyInCategory, setTabValue]);

  const handleMoneyInPieClick = useMobileClick(handleMoneyInPieClickBase);

  const monthlyTrendData = monthlyComparison?.months || [];

  // Prepare stacked bar chart data for monthly comparison by category
  const prepareMonthlyByCategoryData = () => {
    if (!monthlyComparison?.months) return [];

    return monthlyComparison.months.map(month => {
      const data = { month: month.month };
      Object.entries(month.by_category).forEach(([category, amount]) => {
        data[category] = amount;
      });
      return data;
    });
  };

  const monthlyByCategoryData = prepareMonthlyByCategoryData();
  const allCategories = [...new Set(monthlyByCategoryData.flatMap(m => Object.keys(m).filter(k => k !== 'month')))];

  const displayedExpenses = useMemo(() => {
    // Define transfer categories to exclude from Money In/Out tabs
    const transferCategories = ['Transfer', 'Credit Card Payment', 'Investment In', 'Investment Out'];

    // Determine which filters and sort config to use based on active tab
    const activeFilters = tabValue === 1 ? moneyOutFilters : moneyInFilters;
    const activeSortConfig = tabValue === 1 ? moneyOutSortConfig : moneyInSortConfig;
    const activeCategory = tabValue === 1 ? moneyOutCategory : moneyInCategory;

    const normalizedFilters = {
      description: activeFilters.description.trim().toLowerCase(),
      account: activeFilters.account.trim().toLowerCase(),
      notes: activeFilters.notes.trim().toLowerCase()
    };

    const filtered = expenses.filter((expense) => {
      const expenseDate = formatDateToInput(new Date(expense.date));

      // Filter by transaction type based on active tab (not for Transfers tab)
      if (tabValue === 1) {
        // Money Out tab: show only Money Out transactions, exclude transfers
        if (expense.type !== 'Money Out' || transferCategories.includes(expense.category)) {
          return false;
        }
      } else if (tabValue === 2) {
        // Money In tab: show only Money In transactions, exclude transfers
        if (expense.type !== 'Money In' || transferCategories.includes(expense.category)) {
          return false;
        }
      }
      // Note: For Transfers tab (tabValue === 3), filtering is handled separately in the Transfers tab code

      // Filter by selected category (if any)
      if (activeCategory && (expense.category || 'Uncategorized') !== activeCategory) {
        return false;
      }

      if (activeFilters.date && expenseDate !== activeFilters.date) {
        return false;
      }

      if (normalizedFilters.description) {
        const description = String(expense.description || '').toLowerCase();
        if (!description.includes(normalizedFilters.description)) {
          return false;
        }
      }

      if (normalizedFilters.account) {
        const accountLabel = getAccountLabel(expense.account_id).toLowerCase();
        if (!accountLabel.includes(normalizedFilters.account)) {
          return false;
        }
      }

      if (activeFilters.amountMin && Number(expense.amount) < Number(activeFilters.amountMin)) {
        return false;
      }

      if (activeFilters.amountMax && Number(expense.amount) > Number(activeFilters.amountMax)) {
        return false;
      }

      if (normalizedFilters.notes) {
        const notes = String(expense.notes || '').toLowerCase();
        if (!notes.includes(normalizedFilters.notes)) {
          return false;
        }
      }

      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      const valueA = getSortableValue(a, activeSortConfig.field);
      const valueB = getSortableValue(b, activeSortConfig.field);

      if (valueA < valueB) {
        return activeSortConfig.direction === 'asc' ? -1 : 1;
      }

      if (valueA > valueB) {
        return activeSortConfig.direction === 'asc' ? 1 : -1;
      }

      return 0;
    });

    return sorted;
  }, [expenses, moneyOutFilters, moneyInFilters, moneyOutSortConfig, moneyInSortConfig, moneyOutCategory, moneyInCategory, accounts, tabValue]);

  // Calculate filtered transaction statistics
  const transactionStats = useMemo(() => {
    // Define transfer categories to exclude from Money In/Out
    const transferCategories = ['Transfer', 'Credit Card Payment', 'Investment In', 'Investment Out'];

    // Money In: exclude transfer categories
    const moneyInCount = expenses.filter(expense =>
      expense.type === 'Money In' && !transferCategories.includes(expense.category)
    ).length;

    // Money Out: exclude transfer categories
    const moneyOutCount = expenses.filter(expense =>
      expense.type === 'Money Out' && !transferCategories.includes(expense.category)
    ).length;

    // Transfers: only transfer categories
    const transferCount = expenses.filter(expense =>
      transferCategories.includes(expense.category)
    ).length;

    return { moneyInCount, moneyOutCount, transferCount };
  }, [expenses]);

  useEffect(() => {
    setSelectedExpenseIds((prev) =>
      prev.filter((id) => displayedExpenses.some((expense) => expense.id === id))
    );
  }, [displayedExpenses]);

  // Export configuration
  const expenseExportColumns = useMemo(() => [
    { field: 'date', header: 'Date', type: 'date' },
    { field: 'description', header: 'Description' },
    { field: 'account_label', header: 'Account' },
    { field: 'category', header: 'Category' },
    { field: 'amount', header: 'Amount', type: 'currency' },
    { field: 'notes', header: 'Notes' }
  ], []);

  const expenseExportData = useMemo(() =>
    displayedExpenses.map(expense => ({
      ...expense,
      account_label: getAccountLabel(expense.account_id),
      category: expense.category || 'Uncategorized'
    })),
    [displayedExpenses, accounts]
  );

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <CircularProgress />
      </Container>
    );
  }

  const allDisplayedSelected = displayedExpenses.length > 0 && selectedExpenseIds.length === displayedExpenses.length;
  const isIndeterminateSelection = selectedExpenseIds.length > 0 && !allDisplayedSelected;

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Cash Flow</Typography>
        <Box>
          <Button
            variant="outlined"
            startIcon={<CategoryIcon />}
            onClick={handleOpenCategoryDialog}
            sx={{ mr: 1 }}
          >
            Manage Categories
          </Button>
          <Button
            variant="outlined"
            onClick={handleRecategorize}
            sx={{ mr: 1 }}
          >
            Recategorize
          </Button>
          <Button
            variant="contained"
            startIcon={<RefreshIcon />}
            onClick={handleConvertTransactions}
            disabled={isConversionRunning}
          >
            {isConversionRunning ? 'Import in Progress' : 'Import from Transactions'}
          </Button>
          {isConversionRunning && (
            <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
              Running job ({conversionJobStatus || 'queued'}{conversionStage ? ` - ${formatStageLabel(conversionStage)}` : ''})...
            </Typography>
          )}
        </Box>
      </Box>

      {/* Filter Cards */}
      <Grid container spacing={isMobile ? 2 : 3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={3}>
          <Paper sx={{ p: isMobile ? 2 : 3 }}>
            <Typography
              color="textSecondary"
              gutterBottom
              sx={{
                fontWeight: 600,
                fontSize: isMobile ? '0.875rem' : '0.875rem',
                mb: 1
              }}
            >
              Account
            </Typography>
            <FormControl fullWidth size={isMobile ? 'medium' : 'small'}>
              <Select
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(e.target.value)}
                displayEmpty
                sx={isMobile ? {
                  '& .MuiInputBase-root': {
                    minHeight: 48
                  }
                } : {}}
              >
                <MenuItem value="">All Accounts</MenuItem>
                {[...accounts].sort((a, b) => {
                  const aDisplay = `${a.institution || ''} ${a.label}`.trim();
                  const bDisplay = `${b.institution || ''} ${b.label}`.trim();
                  return aDisplay.localeCompare(bDisplay);
                }).map(account => (
                  <MenuItem key={account.id} value={account.id}>
                    {account.institution && `${account.institution} - `}
                    {account.label}
                    {account.account_type && ` (${account.account_type.replace(/_/g, ' ')})`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Paper>
        </Grid>
        <Grid item xs={12} md={3}>
          <Paper sx={{ p: isMobile ? 2 : 3, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography
              color="textSecondary"
              sx={{
                fontWeight: 600,
                fontSize: isMobile ? '0.75rem' : '0.75rem',
                mb: 0.5
              }}
            >
              Money In
            </Typography>
            <Typography variant={isMobile ? 'h5' : 'h4'} sx={{ color: '#4CAF50', fontWeight: 600 }}>
              {transactionStats.moneyInCount.toLocaleString()}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} md={3}>
          <Paper sx={{ p: isMobile ? 2 : 3, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography
              color="textSecondary"
              sx={{
                fontWeight: 600,
                fontSize: isMobile ? '0.75rem' : '0.75rem',
                mb: 0.5
              }}
            >
              Money Out
            </Typography>
            <Typography variant={isMobile ? 'h5' : 'h4'} sx={{ color: '#F44336', fontWeight: 600 }}>
              {transactionStats.moneyOutCount.toLocaleString()}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} md={3}>
          <Paper sx={{ p: isMobile ? 2 : 3, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography
              color="textSecondary"
              sx={{
                fontWeight: 600,
                fontSize: isMobile ? '0.75rem' : '0.75rem',
                mb: 0.5
              }}
            >
              Transfers
            </Typography>
            <Typography variant={isMobile ? 'h5' : 'h4'} sx={{ color: '#2196F3', fontWeight: 600 }}>
              {transactionStats.transferCount.toLocaleString()}
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* Filter by Period */}
      <Paper sx={{ p: isMobile ? 2 : 3, mb: 3 }}>
        <Stack spacing={isMobile ? 1.5 : 2}>
          <Box>
            <Typography variant={isMobile ? 'body1' : 'subtitle1'} sx={{ mb: isMobile ? 1 : 1, fontWeight: 600 }}>
              Filter by period
            </Typography>

            {/* Mobile: Grid layout for better touch targets */}
            {isMobile ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 1,
                  mb: 1
                }}
              >
                {PRESET_OPTIONS.map((preset) => (
                  <Button
                    key={preset.value}
                    variant={selectedPreset === preset.value ? 'contained' : 'outlined'}
                    size="medium"
                    onClick={() => applyPreset(preset.value)}
                    sx={{
                      minHeight: 44,
                      fontSize: '0.875rem',
                      fontWeight: selectedPreset === preset.value ? 600 : 500,
                      boxShadow: selectedPreset === preset.value ? 2 : 0,
                      textTransform: 'none'
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}
              </Box>
            ) : (
              /* Desktop: Row layout */
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
            )}
          </Box>

          {/* Custom Date Range */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={isMobile ? 1.5 : 2} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <TextField
              label="Start date"
              type="date"
              size={isMobile ? 'medium' : 'small'}
              value={startDate}
              onChange={handleStartDateChange}
              InputLabelProps={{ shrink: true }}
              fullWidth={isMobile}
              sx={isMobile ? {
                '& .MuiInputBase-root': {
                  minHeight: 48
                }
              } : {}}
            />
            <TextField
              label="End date"
              type="date"
              size={isMobile ? 'medium' : 'small'}
              value={endDate}
              onChange={handleEndDateChange}
              InputLabelProps={{ shrink: true }}
              fullWidth={isMobile}
              sx={isMobile ? {
                '& .MuiInputBase-root': {
                  minHeight: 48
                }
              } : {}}
            />
            <Button
              variant={isMobile ? 'outlined' : 'text'}
              size={isMobile ? 'medium' : 'small'}
              onClick={() => applyPreset('all')}
              fullWidth={isMobile}
              sx={isMobile ? {
                minHeight: 48,
                textTransform: 'none',
                fontWeight: 500
              } : {}}
            >
              Clear filters
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Tabs value={tabValue} onChange={(e, newValue) => setTabValue(newValue)} sx={{ mb: 3 }}>
        <Tab label="Overview" />
        <Tab label="Money Out" />
        <Tab label="Money In" />
        <Tab label="Transfers" />
      </Tabs>

      {/* Tab 0: Overview */}
      {tabValue === 0 && (
        <Grid container spacing={3}>
          {/* Money Out Breakdown */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Money Out by Category
              </Typography>
              {moneyOutData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={moneyOutData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={(entry) => `${entry.name}: ${formatCurrency(entry.value)}`}
                      onClick={handleMoneyOutPieClick}
                      style={{ cursor: 'pointer' }}
                    >
                      {moneyOutData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography color="textSecondary">No money out data available</Typography>
                </Box>
              )}
              <Box sx={{ mt: 2, textAlign: 'center' }}>
                <Typography variant="h5" color="error">
                  Total: {formatCurrency(totalMoneyOut)}
                </Typography>
              </Box>
            </Paper>
          </Grid>

          {/* Money In Breakdown */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Money In by Category
              </Typography>
              {moneyInData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={moneyInData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={(entry) => `${entry.name}: ${formatCurrency(entry.value)}`}
                      onClick={handleMoneyInPieClick}
                      style={{ cursor: 'pointer' }}
                    >
                      {moneyInData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography color="textSecondary">No money in data available</Typography>
                </Box>
              )}
              <Box sx={{ mt: 2, textAlign: 'center' }}>
                <Typography variant="h5" color="success.main">
                  Total: {formatCurrency(totalMoneyIn)}
                </Typography>
              </Box>
            </Paper>
          </Grid>

          {/* 6 Month Evolution */}
          <Grid item xs={12}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Last 6 Months Evolution
              </Typography>
              {monthlyTrendData.length > 0 ? (
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={monthlyTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis tickFormatter={(value) => formatCurrency(value)} />
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                    <Legend />
                    <Bar dataKey="money_in" name="Money In" fill="#4CAF50" />
                    <Bar dataKey="money_out" name="Money Out" fill="#F44336" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography color="textSecondary">No monthly data available</Typography>
                </Box>
              )}
            </Paper>
          </Grid>

          {/* Net Cash Flow */}
          <Grid item xs={12}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Net Cash Flow
              </Typography>
              <Box sx={{ textAlign: 'center', py: 2 }}>
                <Typography variant="h4" color={totalMoneyIn - totalMoneyOut >= 0 ? 'success.main' : 'error'}>
                  {formatCurrency(totalMoneyIn - totalMoneyOut)}
                </Typography>
                <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                  {totalMoneyIn - totalMoneyOut >= 0 ? 'Positive' : 'Negative'} cash flow for selected period
                </Typography>
              </Box>
            </Paper>
          </Grid>
        </Grid>
      )}

      {/* Tab 1: Money Out List */}
      {tabValue === 1 && (
        <Paper sx={{ p: isMobile ? 1 : 2, pb: selectedExpenseIds.length > 0 ? 10 : 2 }}>
          {/* Export and Filter Controls */}
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            {isMobile && (
              <Button
                variant="outlined"
                size="small"
                startIcon={<FilterAltIcon />}
                onClick={() => setMoneyOutCategory('')}
              >
                {moneyOutCategory || 'All Categories'}
              </Button>
            )}
            <ExportButtons
              data={displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'money_out').map(expense => ({
                ...expense,
                account_label: getAccountLabel(expense.account_id),
                category: expense.category || 'Uncategorized'
              }))}
              columns={expenseExportColumns}
              filename="expenses"
              title="Expenses Report"
            />
          </Box>

          {/* Mobile Card View */}
          {isMobile ? (
            <Box>
              {/* Mobile Select All */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  mb: 2,
                  p: 1.5,
                  bgcolor: 'action.hover',
                  borderRadius: 1
                }}
              >
                <Checkbox
                  color="primary"
                  indeterminate={isIndeterminateSelection}
                  checked={allDisplayedSelected && displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'money_out').length > 0}
                  onChange={(event) => handleSelectAllExpenses(event.target.checked, displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'money_out'))}
                  sx={{ mr: 1 }}
                />
                <Typography variant="body2">
                  {selectedExpenseIds.length > 0
                    ? `${selectedExpenseIds.length} selected`
                    : 'Select all'}
                </Typography>
              </Box>

              {/* Active Filters on Mobile - Sticky */}
              {hasActiveFilters() && (
                <Box
                  sx={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                    bgcolor: 'background.paper',
                    pb: 2,
                    mb: 2,
                    borderBottom: '1px solid',
                    borderColor: 'divider'
                  }}
                >
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {moneyOutCategory && (
                      <Chip
                        label={`Category: ${moneyOutCategory}`}
                        onDelete={() => setMoneyOutCategory('')}
                        color="primary"
                        size="small"
                      />
                    )}
                    {moneyOutFilters.date && (
                      <Chip
                        label={`Date: ${moneyOutFilters.date}`}
                        onDelete={() => clearColumnFilter('date')}
                        color="primary"
                        size="small"
                      />
                    )}
                    {moneyOutFilters.description && (
                      <Chip
                        label={`Description: ${moneyOutFilters.description}`}
                        onDelete={() => clearColumnFilter('description')}
                        color="primary"
                        size="small"
                      />
                    )}
                    {moneyOutFilters.account && (
                      <Chip
                        label={`Account: ${moneyOutFilters.account}`}
                        onDelete={() => clearColumnFilter('account')}
                        color="primary"
                        size="small"
                      />
                    )}
                    {(moneyOutFilters.amountMin || moneyOutFilters.amountMax) && (
                      <Chip
                        label={`Amount: ${moneyOutFilters.amountMin || '0'} - ${moneyOutFilters.amountMax || '∞'}`}
                        onDelete={() => clearColumnFilter('amount')}
                        color="primary"
                        size="small"
                      />
                    )}
                    {moneyOutFilters.notes && (
                      <Chip
                        label={`Notes: ${moneyOutFilters.notes}`}
                        onDelete={() => clearColumnFilter('notes')}
                        color="primary"
                        size="small"
                      />
                    )}
                    <Chip
                      label="Clear All"
                      onClick={clearAllFilters}
                      color="secondary"
                      size="small"
                      variant="outlined"
                    />
                  </Stack>
                </Box>
              )}

              {/* Expense Cards */}
              {displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'money_out').length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography color="textSecondary">
                    No expenses match the selected filters. Try adjusting them or click "Import from Transactions".
                  </Typography>
                </Box>
              ) : (
                displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'money_out').map((expense) => (
                  <ExpenseCard
                    key={expense.id}
                    expense={expense}
                    isSelected={selectedExpenseIds.includes(expense.id)}
                    onToggleSelection={toggleExpenseSelection}
                    onDelete={handleDeleteExpense}
                    onCategoryChange={handleCategoryChange}
                    onFilterByDescription={handleFilterByDescription}
                    onFilterByAmount={handleFilterByAmount}
                    formatDate={formatDate}
                    formatCurrency={formatCurrency}
                    getAccountLabel={getAccountLabel}
                    getCategoryColor={getCategoryColor}
                    renderCategoryLabel={renderCategoryLabel}
                    categories={categories.filter(cat => cat.type === 'money_out')}
                  />
                ))
              )}
            </Box>
          ) : (
            /* Desktop Table View */
            <TableContainer>
            <Table stickyHeader>
              <TableHead sx={stickyTableHeadSx}>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      color="primary"
                      indeterminate={isIndeterminateSelection}
                      checked={allDisplayedSelected && displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'money_out').length > 0}
                      onChange={(event) => handleSelectAllExpenses(event.target.checked, displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'money_out'))}
                      inputProps={{ 'aria-label': 'Select all expenses' }}
                    />
                  </TableCell>
                  <TableCell sortDirection={moneyOutSortConfig.field === 'date' ? moneyOutSortConfig.direction : false}>
                    <TableSortLabel
                      active={moneyOutSortConfig.field === 'date'}
                      direction={moneyOutSortConfig.field === 'date' ? moneyOutSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('date')}
                    >
                      Date
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={moneyOutSortConfig.field === 'description' ? moneyOutSortConfig.direction : false}>
                    <TableSortLabel
                      active={moneyOutSortConfig.field === 'description'}
                      direction={moneyOutSortConfig.field === 'description' ? moneyOutSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('description')}
                    >
                      Description
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={moneyOutSortConfig.field === 'account' ? moneyOutSortConfig.direction : false}>
                    <TableSortLabel
                      active={moneyOutSortConfig.field === 'account'}
                      direction={moneyOutSortConfig.field === 'account' ? moneyOutSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('account')}
                    >
                      Account
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={moneyOutSortConfig.field === 'category' ? moneyOutSortConfig.direction : false}>
                    <TableSortLabel
                      active={moneyOutSortConfig.field === 'category'}
                      direction={moneyOutSortConfig.field === 'category' ? moneyOutSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('category')}
                    >
                      Category
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right" sortDirection={moneyOutSortConfig.field === 'amount' ? moneyOutSortConfig.direction : false}>
                    <TableSortLabel
                      active={moneyOutSortConfig.field === 'amount'}
                      direction={moneyOutSortConfig.field === 'amount' ? moneyOutSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('amount')}
                    >
                      Amount
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={moneyOutSortConfig.field === 'notes' ? moneyOutSortConfig.direction : false}>
                    <TableSortLabel
                      active={moneyOutSortConfig.field === 'notes'}
                      direction={moneyOutSortConfig.field === 'notes' ? moneyOutSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('notes')}
                    >
                      Notes
                    </TableSortLabel>
                  </TableCell>
                </TableRow>
                <TableRow sx={stickyFilterRowSx}>
                  <TableCell />
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <TextField
                        type="date"
                        size="small"
                        value={moneyOutFilters.date}
                        onChange={(e) => handleTableFilterChange('date', e.target.value)}
                        fullWidth
                      />
                      {moneyOutFilters.date && (
                        <IconButton size="small" onClick={() => clearColumnFilter('date')} title="Clear date filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <TextField
                        size="small"
                        placeholder="Search description"
                        value={moneyOutFilters.description}
                        onChange={(e) => handleTableFilterChange('description', e.target.value)}
                        fullWidth
                      />
                      {moneyOutFilters.description && (
                        <IconButton size="small" onClick={() => clearColumnFilter('description')} title="Clear description filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <TextField
                        size="small"
                        placeholder="Search account"
                        value={moneyOutFilters.account}
                        onChange={(e) => handleTableFilterChange('account', e.target.value)}
                        fullWidth
                      />
                      {moneyOutFilters.account && (
                        <IconButton size="small" onClick={() => clearColumnFilter('account')} title="Clear account filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <FormControl size="small" fullWidth>
                        <Select
                          value={moneyOutCategory}
                          onChange={(e) => setMoneyOutCategory(e.target.value)}
                          displayEmpty
                          renderValue={(value) => renderCategoryLabel(value, 'All Categories')}
                        >
                          <MenuItem key="all-categories" value="">
                            <em>All Categories</em>
                          </MenuItem>
                          <MenuItem key="uncategorized" value="Uncategorized">
                            {renderCategoryLabel('Uncategorized', 'Uncategorized')}
                          </MenuItem>
                          {categories.filter(cat => cat.type === 'money_out').map((category) => (
                            <MenuItem key={category.id} value={category.name}>
                              {renderCategoryLabel(category.name, category.name)}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      {moneyOutCategory && (
                        <IconButton size="small" onClick={() => setMoneyOutCategory('')} title="Clear category filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
                      <TextField
                        size="small"
                        type="number"
                        placeholder="Min"
                        value={moneyOutFilters.amountMin}
                        onChange={(e) => handleTableFilterChange('amountMin', e.target.value)}
                        sx={{ width: 100 }}
                      />
                      <TextField
                        size="small"
                        type="number"
                        placeholder="Max"
                        value={moneyOutFilters.amountMax}
                        onChange={(e) => handleTableFilterChange('amountMax', e.target.value)}
                        sx={{ width: 100 }}
                      />
                      {(moneyOutFilters.amountMin || moneyOutFilters.amountMax) && (
                        <IconButton size="small" onClick={() => clearColumnFilter('amount')} title="Clear amount filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <TextField
                        size="small"
                        placeholder="Search notes"
                        value={moneyOutFilters.notes}
                        onChange={(e) => handleTableFilterChange('notes', e.target.value)}
                        fullWidth
                      />
                      {moneyOutFilters.notes && (
                        <IconButton size="small" onClick={() => clearColumnFilter('notes')} title="Clear notes filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="text"
                      size="small"
                      startIcon={<ClearIcon />}
                      onClick={() => {
                        resetTableFilters();
                        setMoneyOutCategory('');
                      }}
                    >
                      Clear All
                    </Button>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {displayedExpenses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center">
                      <Typography color="textSecondary" py={3}>
                        No expenses match the selected filters. Try adjusting them or click "Import from Transactions".
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  displayedExpenses.map((expense) => {
                    const accountLabel = getAccountLabel(expense.account_id);
                    const isSelected = selectedExpenseIds.includes(expense.id);
                    return (
                      <TableRow key={expense.id} selected={isSelected}>
                        <TableCell padding="checkbox">
                          <Checkbox
                            color="primary"
                            checked={isSelected}
                            onChange={() => toggleExpenseSelection(expense.id)}
                          />
                        </TableCell>
                        <TableCell>{formatDate(expense.date)}</TableCell>
                        <TableCell>
                          <Box display="flex" alignItems="center" gap={0.5}>
                            {expense.description}
                            <IconButton
                              size="small"
                              onClick={() => handleFilterByDescription(expense.description)}
                              title="Filter and select all with this description"
                              sx={{ ml: 0.5 }}
                            >
                              <FilterAltIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        </TableCell>
                        <TableCell>{accountLabel}</TableCell>
                        <TableCell>
                          <FormControl size="small" fullWidth>
                            <Select
                              value={expense.category || 'Uncategorized'}
                              onChange={(e) => handleCategoryChange(expense.id, e.target.value)}
                              sx={{
                                bgcolor: getCategoryColor(expense.category),
                                color: 'white',
                                '& .MuiOutlinedInput-notchedOutline': {
                                  borderColor: 'transparent'
                                },
                                '&:hover .MuiOutlinedInput-notchedOutline': {
                                  borderColor: 'rgba(255,255,255,0.5)'
                                }
                              }}
                              renderValue={(value) => renderCategoryLabel(value, 'Uncategorized')}
                            >
                              <MenuItem key="uncategorized-category" value="Uncategorized">
                                {renderCategoryLabel('Uncategorized', 'Uncategorized')}
                              </MenuItem>
                              {categories.filter(cat => cat.type === 'money_out').map(cat => (
                                <MenuItem key={cat.id} value={cat.name}>
                                  {renderCategoryLabel(cat.name, cat.name)}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </TableCell>
                        <TableCell align="right">
                          <Box display="flex" alignItems="center" justifyContent="flex-end" gap={0.5}>
                            {formatCurrency(expense.amount)}
                            <IconButton
                              size="small"
                              onClick={() => handleFilterByAmount(expense.amount)}
                              title="Filter and select similar amounts (±10%)"
                              sx={{ ml: 0.5 }}
                            >
                              <FilterAltIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        </TableCell>
                        <TableCell>{expense.notes || '-'}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
          )}

          {/* Fixed Bottom Bar for Bulk Category Selection */}
          {selectedExpenseIds.length > 0 && (
            <Box
              sx={{
                position: 'fixed',
                bottom: 0,
                left: 0,
                right: 0,
                bgcolor: 'primary.main',
                color: 'white',
                p: { xs: 1.5, md: 2 },
                boxShadow: 3,
                zIndex: 1000,
                display: 'flex',
                flexDirection: { xs: 'column', md: 'row' },
                gap: { xs: 1, md: 2 },
                alignItems: { xs: 'stretch', md: 'center' },
                justifyContent: 'center'
              }}
            >
              <Typography variant={isMobile ? 'body1' : 'h6'} sx={{ fontWeight: 600 }}>
                {selectedExpenseIds.length} expense{selectedExpenseIds.length !== 1 ? 's' : ''} selected
              </Typography>
              <FormControl size="small" sx={{ minWidth: { xs: '100%', md: 250 }, bgcolor: 'white', borderRadius: 1 }}>
                <InputLabel id="bulk-category-bottom-bar-label">Category</InputLabel>
                <Select
                  labelId="bulk-category-bottom-bar-label"
                  value={bulkCategory}
                  label="Category"
                  onChange={(event) => setBulkCategory(event.target.value)}
                  renderValue={(value) => renderCategoryLabel(value, 'Choose category')}
                >
                  <MenuItem value="">
                    <em>Select category</em>
                  </MenuItem>
                  {categories.filter(cat => cat.type === 'money_out').map((category) => (
                    <MenuItem key={category.id} value={category.name}>
                      {renderCategoryLabel(category.name, category.name)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  size={isMobile ? 'medium' : 'large'}
                  onClick={handleBulkCategoryApply}
                  disabled={!bulkCategory || isBulkUpdating}
                  sx={{ bgcolor: 'success.main', '&:hover': { bgcolor: 'success.dark' }, flex: 1 }}
                >
                  {isBulkUpdating ? 'Applying...' : isMobile ? 'Apply' : 'Apply Category'}
                </Button>
                <Button
                  variant="outlined"
                  size={isMobile ? 'medium' : 'large'}
                  onClick={() => {
                    setSelectedExpenseIds([]);
                    setBulkCategory('');
                  }}
                  sx={{ borderColor: 'white', color: 'white', '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.1)' }, flex: 1 }}
                >
                  {isMobile ? 'Clear' : 'Clear Selection'}
                </Button>
              </Stack>
            </Box>
          )}
        </Paper>
      )}

      {/* Tab 2: Money In List */}
      {tabValue === 2 && (
        <Paper sx={{ p: 2, pb: selectedIncomeIds.length > 0 ? 10 : 2 }}>
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <ExportButtons
              data={displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'money_in').map(expense => ({
                ...expense,
                account_label: getAccountLabel(expense.account_id),
                category: expense.category || 'Uncategorized'
              }))}
              columns={expenseExportColumns}
              filename="incomes"
              title="Incomes Report"
            />
          </Box>
          <TableContainer>
            <Table stickyHeader>
              <TableHead sx={stickyTableHeadSx}>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      color="primary"
                      indeterminate={selectedIncomeIds.length > 0 && selectedIncomeIds.length < displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'money_in').length}
                      checked={selectedIncomeIds.length > 0 && selectedIncomeIds.length === displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'money_in').length && displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'money_in').length > 0}
                      onChange={(event) => handleSelectAllIncomes(event.target.checked, displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'money_in'))}
                      inputProps={{ 'aria-label': 'Select all incomes' }}
                    />
                  </TableCell>
                  <TableCell sortDirection={moneyInSortConfig.field === 'date' ? moneyInSortConfig.direction : false}>
                    <TableSortLabel
                      active={moneyInSortConfig.field === 'date'}
                      direction={moneyInSortConfig.field === 'date' ? moneyInSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('date')}
                    >
                      Date
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={moneyInSortConfig.field === 'description' ? moneyInSortConfig.direction : false}>
                    <TableSortLabel
                      active={moneyInSortConfig.field === 'description'}
                      direction={moneyInSortConfig.field === 'description' ? moneyInSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('description')}
                    >
                      Description
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={moneyInSortConfig.field === 'account' ? moneyInSortConfig.direction : false}>
                    <TableSortLabel
                      active={moneyInSortConfig.field === 'account'}
                      direction={moneyInSortConfig.field === 'account' ? moneyInSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('account')}
                    >
                      Account
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={moneyInSortConfig.field === 'category' ? moneyInSortConfig.direction : false}>
                    <TableSortLabel
                      active={moneyInSortConfig.field === 'category'}
                      direction={moneyInSortConfig.field === 'category' ? moneyInSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('category')}
                    >
                      Category
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right" sortDirection={moneyInSortConfig.field === 'amount' ? moneyInSortConfig.direction : false}>
                    <TableSortLabel
                      active={moneyInSortConfig.field === 'amount'}
                      direction={moneyInSortConfig.field === 'amount' ? moneyInSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('amount')}
                    >
                      Amount
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={moneyInSortConfig.field === 'notes' ? moneyInSortConfig.direction : false}>
                    <TableSortLabel
                      active={moneyInSortConfig.field === 'notes'}
                      direction={moneyInSortConfig.field === 'notes' ? moneyInSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('notes')}
                    >
                      Notes
                    </TableSortLabel>
                  </TableCell>
                </TableRow>
                <TableRow sx={stickyFilterRowSx}>
                  <TableCell />
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <TextField
                        type="date"
                        size="small"
                        value={moneyOutFilters.date}
                        onChange={(e) => handleTableFilterChange('date', e.target.value)}
                        fullWidth
                      />
                      {moneyInFilters.date && (
                        <IconButton size="small" onClick={() => clearColumnFilter('date')} title="Clear date filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <TextField
                        size="small"
                        placeholder="Search description"
                        value={moneyInFilters.description}
                        onChange={(e) => handleTableFilterChange('description', e.target.value)}
                        fullWidth
                      />
                      {moneyInFilters.description && (
                        <IconButton size="small" onClick={() => clearColumnFilter('description')} title="Clear description filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <TextField
                        size="small"
                        placeholder="Search account"
                        value={moneyInFilters.account}
                        onChange={(e) => handleTableFilterChange('account', e.target.value)}
                        fullWidth
                      />
                      {moneyInFilters.account && (
                        <IconButton size="small" onClick={() => clearColumnFilter('account')} title="Clear account filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <FormControl size="small" fullWidth>
                        <Select
                          value={moneyInCategory}
                          onChange={(e) => setMoneyInCategory(e.target.value)}
                          displayEmpty
                          renderValue={(value) => renderCategoryLabel(value, 'All Categories')}
                        >
                          <MenuItem key="all-categories" value="">
                            <em>All Categories</em>
                          </MenuItem>
                          <MenuItem key="uncategorized" value="Uncategorized">
                            {renderCategoryLabel('Uncategorized', 'Uncategorized')}
                          </MenuItem>
                          {categories.filter(cat => cat.type === 'money_in').map((category) => (
                            <MenuItem key={category.id} value={category.name}>
                              {renderCategoryLabel(category.name, category.name)}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      {moneyInCategory && (
                        <IconButton size="small" onClick={() => setMoneyInCategory('')} title="Clear category filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
                      <TextField
                        size="small"
                        type="number"
                        placeholder="Min"
                        value={moneyInFilters.amountMin}
                        onChange={(e) => handleTableFilterChange('amountMin', e.target.value)}
                        sx={{ width: 100 }}
                      />
                      <TextField
                        size="small"
                        type="number"
                        placeholder="Max"
                        value={moneyInFilters.amountMax}
                        onChange={(e) => handleTableFilterChange('amountMax', e.target.value)}
                        sx={{ width: 100 }}
                      />
                      {(moneyInFilters.amountMin || moneyInFilters.amountMax) && (
                        <IconButton size="small" onClick={() => clearColumnFilter('amount')} title="Clear amount filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <TextField
                        size="small"
                        placeholder="Search notes"
                        value={moneyInFilters.notes}
                        onChange={(e) => handleTableFilterChange('notes', e.target.value)}
                        fullWidth
                      />
                      {moneyInFilters.notes && (
                        <IconButton size="small" onClick={() => clearColumnFilter('notes')} title="Clear notes filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="text"
                      size="small"
                      startIcon={<ClearIcon />}
                      onClick={() => {
                        resetTableFilters();
                        setMoneyInCategory('');
                      }}
                    >
                      Clear All
                    </Button>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {displayedExpenses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center">
                      <Typography color="textSecondary" py={3}>
                        No income transactions found. Import transactions to see income data.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  displayedExpenses.map((expense) => {
                    const accountLabel = getAccountLabel(expense.account_id);
                    const isSelected = selectedIncomeIds.includes(expense.id);
                    return (
                      <TableRow key={expense.id} selected={isSelected}>
                        <TableCell padding="checkbox">
                          <Checkbox
                            color="primary"
                            checked={isSelected}
                            onChange={() => toggleIncomeSelection(expense.id)}
                          />
                        </TableCell>
                        <TableCell>{formatDate(expense.date)}</TableCell>
                        <TableCell>
                          <Box display="flex" alignItems="center" gap={0.5}>
                            {expense.description}
                            <IconButton
                              size="small"
                              onClick={() => handleFilterByDescription(expense.description)}
                              title="Filter and select all with this description"
                              sx={{ ml: 0.5 }}
                            >
                              <FilterAltIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        </TableCell>
                        <TableCell>{accountLabel}</TableCell>
                        <TableCell>
                          <FormControl size="small" fullWidth>
                            <Select
                              value={expense.category || 'Uncategorized'}
                              onChange={(e) => handleCategoryChange(expense.id, e.target.value)}
                              sx={{
                                bgcolor: getCategoryColor(expense.category),
                                color: 'white',
                                '& .MuiOutlinedInput-notchedOutline': {
                                  borderColor: 'transparent'
                                },
                                '&:hover .MuiOutlinedInput-notchedOutline': {
                                  borderColor: 'rgba(255,255,255,0.5)'
                                }
                              }}
                              renderValue={(value) => renderCategoryLabel(value, 'Uncategorized')}
                            >
                              <MenuItem key="uncategorized-category" value="Uncategorized">
                                {renderCategoryLabel('Uncategorized', 'Uncategorized')}
                              </MenuItem>
                              {categories.filter(cat => cat.type === 'money_in').map(cat => (
                                <MenuItem key={cat.id} value={cat.name}>
                                  {renderCategoryLabel(cat.name, cat.name)}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </TableCell>
                        <TableCell align="right">
                          <Box display="flex" alignItems="center" justifyContent="flex-end" gap={0.5}>
                            {formatCurrency(expense.amount)}
                            <IconButton
                              size="small"
                              onClick={() => handleFilterByAmount(expense.amount)}
                              title="Filter and select similar amounts (±10%)"
                              sx={{ ml: 0.5 }}
                            >
                              <FilterAltIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        </TableCell>
                        <TableCell>{expense.notes || '-'}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Fixed Bottom Bar for Bulk Category Selection */}
          {selectedIncomeIds.length > 0 && (
            <Box
              sx={{
                position: 'fixed',
                bottom: 0,
                left: 0,
                right: 0,
                bgcolor: 'primary.main',
                color: 'white',
                p: { xs: 1.5, md: 2 },
                boxShadow: 3,
                zIndex: 1000,
                display: 'flex',
                flexDirection: { xs: 'column', md: 'row' },
                gap: { xs: 1, md: 2 },
                alignItems: { xs: 'stretch', md: 'center' },
                justifyContent: 'center'
              }}
            >
              <Typography variant={isMobile ? 'body1' : 'h6'} sx={{ fontWeight: 600 }}>
                {selectedIncomeIds.length} income{selectedIncomeIds.length !== 1 ? 's' : ''} selected
              </Typography>
              <FormControl size="small" sx={{ minWidth: { xs: '100%', md: 250 }, bgcolor: 'white', borderRadius: 1 }}>
                <InputLabel id="bulk-income-category-label">Category</InputLabel>
                <Select
                  labelId="bulk-income-category-label"
                  value={bulkIncomeCategory}
                  label="Category"
                  onChange={(event) => setBulkIncomeCategory(event.target.value)}
                  renderValue={(value) => renderCategoryLabel(value, 'Choose category')}
                >
                  <MenuItem value="">
                    <em>Select category</em>
                  </MenuItem>
                  {categories.filter(cat => cat.type === 'money_in').map((category) => (
                    <MenuItem key={category.id} value={category.name}>
                      {renderCategoryLabel(category.name, category.name)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  size={isMobile ? 'medium' : 'large'}
                  onClick={handleBulkIncomeCategoryApply}
                  disabled={!bulkIncomeCategory || isBulkUpdating}
                  sx={{ bgcolor: 'success.main', '&:hover': { bgcolor: 'success.dark' }, flex: 1 }}
                >
                  {isBulkUpdating ? 'Applying...' : isMobile ? 'Apply' : 'Apply Category'}
                </Button>
                <Button
                  variant="outlined"
                  size={isMobile ? 'medium' : 'large'}
                  onClick={() => {
                    setSelectedIncomeIds([]);
                    setBulkIncomeCategory('');
                  }}
                  sx={{ borderColor: 'white', color: 'white', '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.1)' }, flex: 1 }}
                >
                  {isMobile ? 'Clear' : 'Clear Selection'}
                </Button>
              </Stack>
            </Box>
          )}
        </Paper>
      )}

      {/* Tab 3: Transfers */}
      {tabValue === 3 && (
        <Paper sx={{ p: { xs: 2, md: 3 } }}>
          <Typography variant="h5" gutterBottom>
            Transfers
          </Typography>
          <Typography variant="body2" color="textSecondary" gutterBottom sx={{ mb: 3 }}>
            All transfer transactions (Transfer, Credit Card Payment, Investment In, Investment Out).
          </Typography>

          <TableContainer>
            <Table size="small">
              <TableHead>
                {/* Header Row with Sorting */}
                <TableRow>
                  <TableCell>
                    <TableSortLabel
                      active={transfersSortConfig.field === 'date'}
                      direction={transfersSortConfig.field === 'date' ? transfersSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('date')}
                    >
                      Date
                    </TableSortLabel>
                  </TableCell>
                  <TableCell>
                    <TableSortLabel
                      active={transfersSortConfig.field === 'description'}
                      direction={transfersSortConfig.field === 'description' ? transfersSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('description')}
                    >
                      Description
                    </TableSortLabel>
                  </TableCell>
                  <TableCell>
                    <TableSortLabel
                      active={transfersSortConfig.field === 'account'}
                      direction={transfersSortConfig.field === 'account' ? transfersSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('account')}
                    >
                      Source Account
                    </TableSortLabel>
                  </TableCell>
                  <TableCell>Destination Account</TableCell>
                  <TableCell>
                    <TableSortLabel
                      active={transfersSortConfig.field === 'category'}
                      direction={transfersSortConfig.field === 'category' ? transfersSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('category')}
                    >
                      Category
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right">
                    <TableSortLabel
                      active={transfersSortConfig.field === 'amount'}
                      direction={transfersSortConfig.field === 'amount' ? transfersSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('amount')}
                    >
                      Amount
                    </TableSortLabel>
                  </TableCell>
                  <TableCell>Notes</TableCell>
                </TableRow>

                {/* Filter Row */}
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <TextField
                        type="date"
                        size="small"
                        value={transfersFilters.date}
                        onChange={(e) => handleTableFilterChange('date', e.target.value)}
                        fullWidth
                        InputLabelProps={{ shrink: true }}
                      />
                      {transfersFilters.date && (
                        <IconButton size="small" onClick={() => handleTableFilterChange('date', '')} title="Clear date filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <TextField
                        size="small"
                        placeholder="Search description"
                        value={transfersFilters.description}
                        onChange={(e) => handleTableFilterChange('description', e.target.value)}
                        fullWidth
                      />
                      {transfersFilters.description && (
                        <IconButton size="small" onClick={() => handleTableFilterChange('description', '')} title="Clear description filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <TextField
                        size="small"
                        placeholder="Search source"
                        value={transfersFilters.account}
                        onChange={(e) => handleTableFilterChange('account', e.target.value)}
                        fullWidth
                      />
                      {transfersFilters.account && (
                        <IconButton size="small" onClick={() => handleTableFilterChange('account', '')} title="Clear account filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell />
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <TextField
                        size="small"
                        placeholder="Search category"
                        value={transfersFilters.category}
                        onChange={(e) => handleTableFilterChange('category', e.target.value)}
                        fullWidth
                      />
                      {transfersFilters.category && (
                        <IconButton size="small" onClick={() => handleTableFilterChange('category', '')} title="Clear category filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end">
                      <TextField
                        size="small"
                        type="number"
                        placeholder="Min"
                        value={transfersFilters.amountMin}
                        onChange={(e) => handleTableFilterChange('amountMin', e.target.value)}
                        sx={{ width: 80 }}
                      />
                      <TextField
                        size="small"
                        type="number"
                        placeholder="Max"
                        value={transfersFilters.amountMax}
                        onChange={(e) => handleTableFilterChange('amountMax', e.target.value)}
                        sx={{ width: 80 }}
                      />
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <TextField
                        size="small"
                        placeholder="Search notes"
                        value={transfersFilters.notes}
                        onChange={(e) => handleTableFilterChange('notes', e.target.value)}
                        fullWidth
                      />
                      {transfersFilters.notes && (
                        <IconButton size="small" onClick={() => handleTableFilterChange('notes', '')} title="Clear notes filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="text"
                      size="small"
                      startIcon={<ClearIcon />}
                      onClick={resetTableFilters}
                    >
                      Clear All
                    </Button>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(() => {
                  // Define transfer categories
                  const transferCategories = ['Transfer', 'Credit Card Payment', 'Investment In', 'Investment Out'];

                  // Get all transactions with transfer categories
                  let displayTransfers = expenses
                    .filter(exp => transferCategories.includes(exp.category))
                    .map(t => ({
                      id: t.id,
                      date: t.date,
                      description: t.description,
                      account_id: t.account_id,
                      paired_account_id: t.paired_account_id, // The other account in the transfer
                      category: t.category,
                      type: t.type, // Money In or Money Out
                      amount: t.transaction_amount != null ? t.transaction_amount : 0,
                      notes: t.notes || ''
                    }));

                  // Apply filters
                  const normalizedFilters = {
                    description: transfersFilters.description.trim().toLowerCase(),
                    account: transfersFilters.account.trim().toLowerCase(),
                    category: transfersFilters.category.trim().toLowerCase(),
                    notes: transfersFilters.notes.trim().toLowerCase()
                  };

                  displayTransfers = displayTransfers.filter((transfer) => {
                    const transferDate = formatDateToInput(new Date(transfer.date));

                    if (transfersFilters.date && transferDate !== transfersFilters.date) {
                      return false;
                    }

                    if (normalizedFilters.description) {
                      const description = String(transfer.description || '').toLowerCase();
                      if (!description.includes(normalizedFilters.description)) {
                        return false;
                      }
                    }

                    if (normalizedFilters.account) {
                      const accountLabel = getAccountLabel(transfer.account_id).toLowerCase();
                      if (!accountLabel.includes(normalizedFilters.account)) {
                        return false;
                      }
                    }

                    if (normalizedFilters.category) {
                      const category = String(transfer.category || 'Uncategorized').toLowerCase();
                      if (!category.includes(normalizedFilters.category)) {
                        return false;
                      }
                    }

                    if (transfersFilters.amountMin && Math.abs(Number(transfer.amount)) < Number(transfersFilters.amountMin)) {
                      return false;
                    }

                    if (transfersFilters.amountMax && Math.abs(Number(transfer.amount)) > Number(transfersFilters.amountMax)) {
                      return false;
                    }

                    if (normalizedFilters.notes) {
                      const notes = String(transfer.notes || '').toLowerCase();
                      if (!notes.includes(normalizedFilters.notes)) {
                        return false;
                      }
                    }

                    return true;
                  });

                  // Apply sorting
                  displayTransfers.sort((a, b) => {
                    let valueA, valueB;

                    switch (transfersSortConfig.field) {
                      case 'date':
                        valueA = new Date(a.date);
                        valueB = new Date(b.date);
                        break;
                      case 'description':
                        valueA = String(a.description || '').toLowerCase();
                        valueB = String(b.description || '').toLowerCase();
                        break;
                      case 'account':
                        valueA = getAccountLabel(a.account_id).toLowerCase();
                        valueB = getAccountLabel(b.account_id).toLowerCase();
                        break;
                      case 'category':
                        valueA = String(a.category || 'Uncategorized').toLowerCase();
                        valueB = String(b.category || 'Uncategorized').toLowerCase();
                        break;
                      case 'amount':
                        valueA = Number(a.amount);
                        valueB = Number(b.amount);
                        break;
                      default:
                        return 0;
                    }

                    if (valueA < valueB) {
                      return transfersSortConfig.direction === 'asc' ? -1 : 1;
                    }
                    if (valueA > valueB) {
                      return transfersSortConfig.direction === 'asc' ? 1 : -1;
                    }
                    return 0;
                  });

                  if (displayTransfers.length === 0) {
                    return (
                      <TableRow>
                        <TableCell colSpan={8} align="center">
                          <Typography color="textSecondary" py={3}>
                            No transfer transactions found. Transactions categorized as "Transfer" in Money In or Money Out tabs will appear here.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    );
                  }

                  return displayTransfers.map((transfer) => {
                    // For transfers:
                    // - Money Out: current account is source, paired account is destination
                    // - Money In: paired account is source, current account is destination
                    const isMoneyOut = transfer.type === 'Money Out';

                    // Determine which category type to show based on transfer type
                    const categoryType = transfer.type === 'Money In' ? 'money_in' : 'money_out';

                    // Determine source and destination accounts
                    const sourceAccount = isMoneyOut
                      ? getAccountLabel(transfer.account_id)
                      : (transfer.paired_account_id ? getAccountLabel(transfer.paired_account_id) : 'Unknown');

                    const destinationAccount = isMoneyOut
                      ? (transfer.paired_account_id ? getAccountLabel(transfer.paired_account_id) : 'Unknown')
                      : getAccountLabel(transfer.account_id);

                    return (
                      <TableRow key={transfer.id}>
                        <TableCell>{formatDate(transfer.date)}</TableCell>
                        <TableCell>{transfer.description}</TableCell>
                        <TableCell>{sourceAccount}</TableCell>
                        <TableCell>{destinationAccount}</TableCell>
                        <TableCell>
                          <FormControl size="small" fullWidth>
                            <Select
                              value={transfer.category || 'Uncategorized'}
                              onChange={(e) => handleCategoryChange(transfer.id, e.target.value)}
                              sx={{
                                bgcolor: getCategoryColor(transfer.category),
                                color: 'white',
                                '& .MuiOutlinedInput-notchedOutline': {
                                  borderColor: 'transparent'
                                },
                                '&:hover .MuiOutlinedInput-notchedOutline': {
                                  borderColor: 'rgba(255,255,255,0.5)'
                                }
                              }}
                              renderValue={(value) => renderCategoryLabel(value, 'Uncategorized')}
                            >
                              <MenuItem key="uncategorized-category" value="Uncategorized">
                                {renderCategoryLabel('Uncategorized', 'Uncategorized')}
                              </MenuItem>
                              {categories.filter(cat => cat.type === categoryType).map(cat => (
                                <MenuItem key={cat.id} value={cat.name}>
                                  {renderCategoryLabel(cat.name, cat.name)}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </TableCell>
                        <TableCell align="right" sx={{ color: transfer.amount < 0 ? 'error.main' : 'success.main', fontWeight: 600 }}>
                          {formatCurrency(transfer.amount)}
                        </TableCell>
                        <TableCell>{transfer.notes}</TableCell>
                      </TableRow>
                    );
                  });
                })()}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Category Management Dialog */}
      <Dialog open={categoryDialogOpen} onClose={() => setCategoryDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Manage Categories</DialogTitle>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
          <Tabs value={categoryTabValue} onChange={handleCategoryTabChange}>
            <Tab label="Money Out" />
            <Tab label="Money In" />
          </Tabs>
        </Box>
        <DialogContent>
          <Box mb={3}>
            <Typography variant="subtitle1" gutterBottom>
              {getCategoryTypeFromTab(categoryTabValue).charAt(0).toUpperCase() + getCategoryTypeFromTab(categoryTabValue).slice(1)} Categories
            </Typography>
            {getFilteredCategories().length > 0 ? (
              <Box display="flex" flexWrap="wrap" gap={1}>
                {getFilteredCategories().map(category => (
                  <Box key={category.id} display="flex" alignItems="center">
                    <Chip
                      label={category.name}
                      sx={{
                        bgcolor: category.color,
                        color: 'white'
                      }}
                    />
                    <IconButton
                      size="small"
                      onClick={() => handleEditCategory(category)}
                      sx={{ ml: 0.5 }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                    {!SPECIAL_CATEGORIES.includes(category.name) && (
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteCategory(category.id)}
                        sx={{ ml: 0.5 }}
                        color="error"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Box>
                ))}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', py: 2 }}>
                No {getCategoryTypeFromTab(categoryTabValue)} categories yet. Add one below.
              </Typography>
            )}
          </Box>

          {editingCategory && (
            <Box mb={3} p={2} sx={{ bgcolor: 'grey.100', borderRadius: 1 }}>
              <Typography variant="subtitle1" gutterBottom>
                Edit Category: {editingCategory.name}
              </Typography>
              {SPECIAL_CATEGORIES.includes(editingCategory.name) && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  This is a special category. You can only change its color.
                </Alert>
              )}
              <TextField
                fullWidth
                label="Category Name"
                value={editingCategory.name}
                onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                margin="normal"
                size="small"
                disabled={SPECIAL_CATEGORIES.includes(editingCategory.name)}
              />
              <FormControl fullWidth margin="normal" size="small">
                <InputLabel>Type</InputLabel>
                <Select
                  value={editingCategory.type}
                  onChange={(e) => setEditingCategory({ ...editingCategory, type: e.target.value })}
                  label="Type"
                  disabled={SPECIAL_CATEGORIES.includes(editingCategory.name)}
                >
                  <MenuItem value="money_out">Money Out</MenuItem>
                  <MenuItem value="money_in">Money In</MenuItem>
                </Select>
              </FormControl>
              <Box mt={2} mb={2}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Select Color
                </Typography>
                <Grid container spacing={1}>
                  {COLOR_PALETTE.map((color) => (
                    <Grid item key={color}>
                      <Box
                        onClick={() => setEditingCategory({ ...editingCategory, color })}
                        sx={{
                          width: 36,
                          height: 36,
                          bgcolor: color,
                          borderRadius: 1,
                          cursor: 'pointer',
                          border: editingCategory.color === color ? '3px solid #000' : '1px solid #ddd',
                          boxShadow: editingCategory.color === color ? 2 : 0,
                          transition: 'all 0.2s',
                          '&:hover': {
                            transform: 'scale(1.1)',
                            boxShadow: 2
                          }
                        }}
                      />
                    </Grid>
                  ))}
                </Grid>
                <Box mt={1} display="flex" alignItems="center" gap={2}>
                  <Box
                    sx={{
                      width: 50,
                      height: 36,
                      bgcolor: editingCategory.color,
                      borderRadius: 1,
                      border: '1px solid #ddd'
                    }}
                  />
                  <Typography variant="body2" color="text.secondary">
                    {editingCategory.color}
                  </Typography>
                </Box>
              </Box>
              <TextField
                fullWidth
                label="Budget Limit (optional)"
                type="number"
                value={editingCategory.budget_limit}
                onChange={(e) => setEditingCategory({ ...editingCategory, budget_limit: e.target.value })}
                margin="normal"
                size="small"
                disabled={SPECIAL_CATEGORIES.includes(editingCategory.name)}
              />
              <Box display="flex" gap={1} mt={2}>
                <Button onClick={handleUpdateCategory} variant="contained" size="small">
                  Save Changes
                </Button>
                <Button onClick={() => setEditingCategory(null)} variant="outlined" size="small">
                  Cancel
                </Button>
              </Box>
            </Box>
          )}

          <Typography variant="subtitle1" gutterBottom>
            Add New {getCategoryTypeFromTab(categoryTabValue).charAt(0).toUpperCase() + getCategoryTypeFromTab(categoryTabValue).slice(1)} Category
          </Typography>
          <TextField
            fullWidth
            label="Category Name"
            value={newCategory.name}
            onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
            margin="normal"
          />
          <Box mt={2} mb={2}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Select Color
            </Typography>
            <Grid container spacing={1}>
              {COLOR_PALETTE.map((color) => (
                <Grid item key={color}>
                  <Box
                    onClick={() => setNewCategory({ ...newCategory, color })}
                    sx={{
                      width: 40,
                      height: 40,
                      bgcolor: color,
                      borderRadius: 1,
                      cursor: 'pointer',
                      border: newCategory.color === color ? '3px solid #000' : '1px solid #ddd',
                      boxShadow: newCategory.color === color ? 2 : 0,
                      transition: 'all 0.2s',
                      '&:hover': {
                        transform: 'scale(1.1)',
                        boxShadow: 2
                      }
                    }}
                  />
                </Grid>
              ))}
            </Grid>
            <Box mt={2} display="flex" alignItems="center" gap={2}>
              <Box
                sx={{
                  width: 60,
                  height: 40,
                  bgcolor: newCategory.color,
                  borderRadius: 1,
                  border: '1px solid #ddd'
                }}
              />
              <Typography variant="body2" color="text.secondary">
                Selected: {newCategory.color}
              </Typography>
            </Box>
          </Box>
          <TextField
            fullWidth
            label="Budget Limit (optional)"
            type="number"
            value={newCategory.budget_limit}
            onChange={(e) => setNewCategory({ ...newCategory, budget_limit: e.target.value })}
            margin="normal"
          />
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
          <Button
            onClick={handleRefreshToDefaults}
            variant="outlined"
            color="warning"
            startIcon={<RefreshIcon />}
          >
            Refresh to Defaults
          </Button>
          <Box display="flex" gap={1}>
            <Button onClick={() => setCategoryDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateCategory} variant="contained" disabled={!newCategory.name}>
              Create Category
            </Button>
          </Box>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default Cashflow;
