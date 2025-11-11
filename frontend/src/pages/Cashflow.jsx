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
  useTheme
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

const ALLOWED_EXPENSE_ACCOUNT_TYPES = ['checking', 'credit_card'];

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
  const [selectedCategory, setSelectedCategory] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedPreset, setSelectedPreset] = useState(DEFAULT_PRESET);
  const [loading, setLoading] = useState(true);
  const [editingExpense, setEditingExpense] = useState(null);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [newCategory, setNewCategory] = useState({ name: '', type: 'expense', color: '#4CAF50', budget_limit: '' });
  const [conversionJobId, setConversionJobId] = useState(null);
  const [conversionJobStatus, setConversionJobStatus] = useState(null);
  const [conversionStage, setConversionStage] = useState(null);
  const [isConversionRunning, setIsConversionRunning] = useState(false);
  const [tableSortConfig, setTableSortConfig] = useState({ field: 'date', direction: 'desc' });
  const [tableFilters, setTableFilters] = useState(() => ({ ...TABLE_FILTER_DEFAULTS }));
  const [selectedExpenseIds, setSelectedExpenseIds] = useState([]);
  const [bulkCategory, setBulkCategory] = useState('');
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
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
    setTableSortConfig((prev) => {
      if (prev.field === field) {
        return { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { field, direction: 'asc' };
    });
  };

  const handleTableFilterChange = (field, value) => {
    setTableFilters((prev) => ({
      ...prev,
      [field]: value
    }));
  };

  const resetTableFilters = () => {
    setTableFilters({ ...TABLE_FILTER_DEFAULTS });
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
    const updates = { ...tableFilters };
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
    setTableFilters(updates);
  };

  const hasActiveFilters = () => {
    return selectedCategory ||
           tableFilters.date ||
           tableFilters.description ||
           tableFilters.account ||
           tableFilters.amountMin ||
           tableFilters.amountMax ||
           tableFilters.notes;
  };

  const clearAllFilters = () => {
    setSelectedCategory('');
    setTableFilters({ ...TABLE_FILTER_DEFAULTS });
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
  }, [selectedAccount, selectedCategory, startDate, endDate, loading]);

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
      const response = await expensesAPI.getAll(selectedAccount || null, selectedCategory || null);
      const { startDate: filterStart, endDate: filterEnd } = getDateRangeFilter();

      // Filter expenses by date range
      let filteredExpenses = response.data;
      if (filterStart || filterEnd) {
        filteredExpenses = response.data.filter(expense => {
          const expenseDate = new Date(expense.date);
          const isAfterStart = filterStart ? expenseDate >= filterStart : true;
          const isBeforeEnd = filterEnd ? expenseDate <= filterEnd : true;
          return isAfterStart && isBeforeEnd;
        });
      }

      setExpenses(filteredExpenses);
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
      const notificationId = showJobProgress('Converting transactions to expenses', jobId, JOB_TYPE_CONVERSION);
      conversionNotificationIdRef.current = notificationId;
    } catch (error) {
      console.error('Error converting transactions:', error);
      showError('Error starting conversion job');
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
      setNewCategory({ name: '', type: 'expense', color: '#4CAF50', budget_limit: '' });
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

  // Separate data by type (income, expense, investment)
  const getCategoryType = (categoryName) => {
    const category = categories.find(c => c.name === categoryName);
    return category?.type || 'expense';
  };

  const incomeData = categoryData.filter(item => getCategoryType(item.name) === 'income');
  const expenseData = categoryData.filter(item => getCategoryType(item.name) === 'expense');
  const investmentData = categoryData.filter(item => getCategoryType(item.name) === 'investment');

  const totalIncome = incomeData.reduce((sum, item) => sum + item.value, 0);
  const totalExpenses = expenseData.reduce((sum, item) => sum + item.value, 0);
  const totalInvestments = investmentData.reduce((sum, item) => sum + item.value, 0);

  // Mobile-aware click handler for expense pie chart (double-click on mobile, single-click on desktop)
  const handleExpensePieClickBase = useCallback((_, index) => {
    const selected = expenseData[index];
    if (selected) {
      setSelectedCategory(selected.name);
      setTabValue(1);
    }
  }, [expenseData, setSelectedCategory, setTabValue]);

  const handleExpensePieClick = useMobileClick(handleExpensePieClickBase);

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
    const normalizedFilters = {
      description: tableFilters.description.trim().toLowerCase(),
      account: tableFilters.account.trim().toLowerCase(),
      notes: tableFilters.notes.trim().toLowerCase()
    };

    const filtered = expenses.filter((expense) => {
      const expenseDate = formatDateToInput(new Date(expense.date));

      if (tableFilters.date && expenseDate !== tableFilters.date) {
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

      if (tableFilters.amountMin && Number(expense.amount) < Number(tableFilters.amountMin)) {
        return false;
      }

      if (tableFilters.amountMax && Number(expense.amount) > Number(tableFilters.amountMax)) {
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
      const valueA = getSortableValue(a, tableSortConfig.field);
      const valueB = getSortableValue(b, tableSortConfig.field);

      if (valueA < valueB) {
        return tableSortConfig.direction === 'asc' ? -1 : 1;
      }

      if (valueA > valueB) {
        return tableSortConfig.direction === 'asc' ? 1 : -1;
      }

      return 0;
    });

    return sorted;
  }, [expenses, tableFilters, tableSortConfig, accounts]);

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
            onClick={() => setCategoryDialogOpen(true)}
            sx={{ mr: 1 }}
          >
            Manage Categories
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
        <Grid item xs={12}>
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
                {accounts.map(account => (
                  <MenuItem key={account.id} value={account.id}>
                    {account.label} ({account.institution})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
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
        <Tab label="Expense List" />
        <Tab label="Incomes List" />
        <Tab label="Investments List" />
        <Tab label="Transfers List" />
        <Tab label="Monthly Comparison" />
      </Tabs>

      {/* Tab 0: Overview */}
      {tabValue === 0 && (
        <Grid container spacing={3}>
          {/* Summary Cards */}
          <Grid item xs={12} md={4}>
            <Paper sx={{ p: 3, bgcolor: 'success.light', color: 'success.contrastText' }}>
              <Typography variant="h6" gutterBottom>
                Total Income
              </Typography>
              <Typography variant="h4">
                {formatCurrency(totalIncome)}
              </Typography>
              <Typography variant="body2">
                {incomeData.length} categories
              </Typography>
            </Paper>
          </Grid>

          <Grid item xs={12} md={4}>
            <Paper sx={{ p: 3, bgcolor: 'error.light', color: 'error.contrastText' }}>
              <Typography variant="h6" gutterBottom>
                Total Expenses
              </Typography>
              <Typography variant="h4">
                {formatCurrency(totalExpenses)}
              </Typography>
              <Typography variant="body2">
                {expenseData.length} categories
              </Typography>
            </Paper>
          </Grid>

          <Grid item xs={12} md={4}>
            <Paper sx={{ p: 3, bgcolor: 'info.light', color: 'info.contrastText' }}>
              <Typography variant="h6" gutterBottom>
                Total Investments
              </Typography>
              <Typography variant="h4">
                {formatCurrency(totalInvestments)}
              </Typography>
              <Typography variant="body2">
                {investmentData.length} categories
              </Typography>
            </Paper>
          </Grid>

          {/* Income Chart */}
          {incomeData.length > 0 && (
            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom color="success.main">
                  Income by Category
                </Typography>
                <Box sx={{ height: 250 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={incomeData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={70}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {incomeData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => formatCurrency(value)} />
                    </PieChart>
                  </ResponsiveContainer>
                </Box>
                <Box sx={{ mt: 2 }}>
                  {incomeData.map((item) => (
                    <Box key={item.name} display="flex" justifyContent="space-between" mb={1}>
                      <Box display="flex" alignItems="center">
                        <Box sx={{ width: 12, height: 12, backgroundColor: item.color, mr: 1 }} />
                        <Typography variant="body2">{item.name}</Typography>
                      </Box>
                      <Typography variant="body2">{formatCurrency(item.value)}</Typography>
                    </Box>
                  ))}
                </Box>
              </Paper>
            </Grid>
          )}

          {/* Expenses & Monthly Trend */}
          {(expenseData.length > 0 || monthlyTrendData.length > 0) && (
            <Grid item xs={12}>
              <Grid container spacing={3} alignItems="stretch">
                {expenseData.length > 0 && (
                  <Grid item xs={12} md={4}>
                    <Paper sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
                      <Typography variant="h6" gutterBottom color="error.main">
                        Expenses by Category
                      </Typography>
                      <Box sx={{ flexGrow: 1, minHeight: 250 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={expenseData}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                              outerRadius={70}
                              fill="#8884d8"
                              dataKey="value"
                              onClick={handleExpensePieClick}
                            >
                              {expenseData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value) => formatCurrency(value)} />
                          </PieChart>
                        </ResponsiveContainer>
                      </Box>
                      <Box sx={{ mt: 2 }}>
                        {expenseData.map((item) => (
                          <Box key={item.name} display="flex" justifyContent="space-between" mb={1}>
                            <Box display="flex" alignItems="center">
                              <Box sx={{ width: 12, height: 12, backgroundColor: item.color, mr: 1 }} />
                              <Typography variant="body2">{item.name}</Typography>
                            </Box>
                            <Typography variant="body2">{formatCurrency(item.value)}</Typography>
                          </Box>
                        ))}
                      </Box>
                    </Paper>
                  </Grid>
                )}
                <Grid item xs={12} md={expenseData.length > 0 ? 8 : 12}>
                  <Paper sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="h6" gutterBottom>
                      Monthly Cashflow Trend
                    </Typography>
                    {monthlyTrendData.length > 0 ? (
                      <Box sx={{ flexGrow: 1, minHeight: 250 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={monthlyTrendData}
                            onClick={(e) => {
                              if (!e?.activeLabel) return;
                              const [year, month] = String(e.activeLabel).split('-').map(Number);
                              if (!year || !month) return;
                              const start = formatDateToInput(new Date(year, month - 1, 1));
                              const end = formatDateToInput(new Date(year, month, 0));
                              setSelectedPreset('custom');
                              setStartDate(start);
                              setEndDate(end);
                              setTabValue(0);
                            }}
                          >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="month" />
                            <YAxis />
                            <Tooltip formatter={(value) => formatCurrency(value)} />
                            <Legend />
                            <Bar dataKey="income" fill="#4CAF50" name="Income" />
                            <Bar dataKey="expenses" stackId="outflow" fill="#f44336" name="Expenses" />
                            <Bar dataKey="investments" stackId="outflow" fill="#2196F3" name="Investments" />
                          </BarChart>
                        </ResponsiveContainer>
                      </Box>
                    ) : (
                      <Typography color="textSecondary" sx={{ mt: 2 }}>
                        No cashflow data available
                      </Typography>
                    )}
                  </Paper>
                </Grid>
              </Grid>
            </Grid>
          )}

          {/* Investments Chart */}
          {investmentData.length > 0 && (
            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom color="info.main">
                  Investments by Category
                </Typography>
                <Box sx={{ height: 250 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={investmentData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={70}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {investmentData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => formatCurrency(value)} />
                    </PieChart>
                  </ResponsiveContainer>
                </Box>
                <Box sx={{ mt: 2 }}>
                  {investmentData.map((item) => (
                    <Box key={item.name} display="flex" justifyContent="space-between" mb={1}>
                      <Box display="flex" alignItems="center">
                        <Box sx={{ width: 12, height: 12, backgroundColor: item.color, mr: 1 }} />
                        <Typography variant="body2">{item.name}</Typography>
                      </Box>
                      <Typography variant="body2">{formatCurrency(item.value)}</Typography>
                    </Box>
                  ))}
                </Box>
              </Paper>
            </Grid>
          )}

          {/* Show message if no data */}
          {incomeData.length === 0 && expenseData.length === 0 && investmentData.length === 0 && (
            <Grid item xs={12}>
              <Alert severity="info">
                No cash flow data available. Click "Import from Transactions" to convert your transactions.
              </Alert>
            </Grid>
          )}

        </Grid>
      )}

      {/* Tab 1: Expense List */}
      {tabValue === 1 && (
        <Paper sx={{ p: isMobile ? 1 : 2, pb: selectedExpenseIds.length > 0 ? 10 : 2 }}>
          {/* Export and Filter Controls */}
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            {isMobile && (
              <Button
                variant="outlined"
                size="small"
                startIcon={<FilterAltIcon />}
                onClick={() => setSelectedCategory('')}
              >
                {selectedCategory || 'All Categories'}
              </Button>
            )}
            <ExportButtons
              data={displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'expense').map(expense => ({
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
                  checked={allDisplayedSelected && displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'expense').length > 0}
                  onChange={(event) => handleSelectAllExpenses(event.target.checked, displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'expense'))}
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
                    {selectedCategory && (
                      <Chip
                        label={`Category: ${selectedCategory}`}
                        onDelete={() => setSelectedCategory('')}
                        color="primary"
                        size="small"
                      />
                    )}
                    {tableFilters.date && (
                      <Chip
                        label={`Date: ${tableFilters.date}`}
                        onDelete={() => clearColumnFilter('date')}
                        color="primary"
                        size="small"
                      />
                    )}
                    {tableFilters.description && (
                      <Chip
                        label={`Description: ${tableFilters.description}`}
                        onDelete={() => clearColumnFilter('description')}
                        color="primary"
                        size="small"
                      />
                    )}
                    {tableFilters.account && (
                      <Chip
                        label={`Account: ${tableFilters.account}`}
                        onDelete={() => clearColumnFilter('account')}
                        color="primary"
                        size="small"
                      />
                    )}
                    {(tableFilters.amountMin || tableFilters.amountMax) && (
                      <Chip
                        label={`Amount: ${tableFilters.amountMin || '0'} - ${tableFilters.amountMax || '∞'}`}
                        onDelete={() => clearColumnFilter('amount')}
                        color="primary"
                        size="small"
                      />
                    )}
                    {tableFilters.notes && (
                      <Chip
                        label={`Notes: ${tableFilters.notes}`}
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
              {displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'expense').length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography color="textSecondary">
                    No expenses match the selected filters. Try adjusting them or click "Import from Transactions".
                  </Typography>
                </Box>
              ) : (
                displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'expense').map((expense) => (
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
                    categories={categories.filter(cat => cat.type === 'expense')}
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
                      checked={allDisplayedSelected && displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'expense').length > 0}
                      onChange={(event) => handleSelectAllExpenses(event.target.checked, displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'expense'))}
                      inputProps={{ 'aria-label': 'Select all expenses' }}
                    />
                  </TableCell>
                  <TableCell sortDirection={tableSortConfig.field === 'date' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'date'}
                      direction={tableSortConfig.field === 'date' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('date')}
                    >
                      Date
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={tableSortConfig.field === 'description' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'description'}
                      direction={tableSortConfig.field === 'description' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('description')}
                    >
                      Description
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={tableSortConfig.field === 'account' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'account'}
                      direction={tableSortConfig.field === 'account' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('account')}
                    >
                      Account
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={tableSortConfig.field === 'category' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'category'}
                      direction={tableSortConfig.field === 'category' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('category')}
                    >
                      Category
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right" sortDirection={tableSortConfig.field === 'amount' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'amount'}
                      direction={tableSortConfig.field === 'amount' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('amount')}
                    >
                      Amount
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={tableSortConfig.field === 'notes' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'notes'}
                      direction={tableSortConfig.field === 'notes' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('notes')}
                    >
                      Notes
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
                <TableRow sx={stickyFilterRowSx}>
                  <TableCell />
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <TextField
                        type="date"
                        size="small"
                        value={tableFilters.date}
                        onChange={(e) => handleTableFilterChange('date', e.target.value)}
                        fullWidth
                      />
                      {tableFilters.date && (
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
                        value={tableFilters.description}
                        onChange={(e) => handleTableFilterChange('description', e.target.value)}
                        fullWidth
                      />
                      {tableFilters.description && (
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
                        value={tableFilters.account}
                        onChange={(e) => handleTableFilterChange('account', e.target.value)}
                        fullWidth
                      />
                      {tableFilters.account && (
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
                          value={selectedCategory}
                          onChange={(e) => setSelectedCategory(e.target.value)}
                          displayEmpty
                          renderValue={(value) => renderCategoryLabel(value, 'All Categories')}
                        >
                          <MenuItem key="all-categories" value="">
                            <em>All Categories</em>
                          </MenuItem>
                          {categories.filter(cat => cat.type === 'expense').map((category) => (
                            <MenuItem key={category.id} value={category.name}>
                              {renderCategoryLabel(category.name, category.name)}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      {selectedCategory && (
                        <IconButton size="small" onClick={() => setSelectedCategory('')} title="Clear category filter">
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
                        value={tableFilters.amountMin}
                        onChange={(e) => handleTableFilterChange('amountMin', e.target.value)}
                        sx={{ width: 100 }}
                      />
                      <TextField
                        size="small"
                        type="number"
                        placeholder="Max"
                        value={tableFilters.amountMax}
                        onChange={(e) => handleTableFilterChange('amountMax', e.target.value)}
                        sx={{ width: 100 }}
                      />
                      {(tableFilters.amountMin || tableFilters.amountMax) && (
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
                        value={tableFilters.notes}
                        onChange={(e) => handleTableFilterChange('notes', e.target.value)}
                        fullWidth
                      />
                      {tableFilters.notes && (
                        <IconButton size="small" onClick={() => clearColumnFilter('notes')} title="Clear notes filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="center">
                    <Button
                      variant="text"
                      size="small"
                      startIcon={<ClearIcon />}
                      onClick={() => {
                        resetTableFilters();
                        setSelectedCategory('');
                      }}
                    >
                      Clear All
                    </Button>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'expense').length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center">
                      <Typography color="textSecondary" py={3}>
                        No expenses match the selected filters. Try adjusting them or click "Import from Transactions".
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'expense').map((expense) => {
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
                              {categories.filter(cat => cat.type === 'expense').map(cat => (
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
                        <TableCell align="center">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteExpense(expense.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
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
                  {categories.filter(cat => cat.type === 'expense').map((category) => (
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

      {/* Tab 2: Incomes List */}
      {tabValue === 2 && (
        <Paper sx={{ p: 2 }}>
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <ExportButtons
              data={displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'income').map(expense => ({
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
                  <TableCell sortDirection={tableSortConfig.field === 'date' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'date'}
                      direction={tableSortConfig.field === 'date' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('date')}
                    >
                      Date
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={tableSortConfig.field === 'description' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'description'}
                      direction={tableSortConfig.field === 'description' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('description')}
                    >
                      Description
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={tableSortConfig.field === 'account' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'account'}
                      direction={tableSortConfig.field === 'account' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('account')}
                    >
                      Account
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={tableSortConfig.field === 'category' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'category'}
                      direction={tableSortConfig.field === 'category' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('category')}
                    >
                      Category
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right" sortDirection={tableSortConfig.field === 'amount' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'amount'}
                      direction={tableSortConfig.field === 'amount' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('amount')}
                    >
                      Amount
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={tableSortConfig.field === 'notes' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'notes'}
                      direction={tableSortConfig.field === 'notes' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('notes')}
                    >
                      Notes
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'income').length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center">
                      <Typography color="textSecondary" py={3}>
                        No income transactions found. Import transactions to see income data.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'income').map((expense) => {
                    const accountLabel = getAccountLabel(expense.account_id);
                    return (
                      <TableRow key={expense.id}>
                        <TableCell>{formatDate(expense.date)}</TableCell>
                        <TableCell>{expense.description}</TableCell>
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
                              {categories.filter(cat => cat.type === 'income').map(cat => (
                                <MenuItem key={cat.id} value={cat.name}>
                                  {renderCategoryLabel(cat.name, cat.name)}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </TableCell>
                        <TableCell align="right">{formatCurrency(expense.amount)}</TableCell>
                        <TableCell>{expense.notes || '-'}</TableCell>
                        <TableCell align="center">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteExpense(expense.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Tab 3: Investments List */}
      {tabValue === 3 && (
        <Paper sx={{ p: 2 }}>
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <ExportButtons
              data={displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'investment').map(expense => {
                const sourceAccount = getAccountLabel(expense.account_id);
                const targetAccount = expense.paired_account_id ? getAccountLabel(expense.paired_account_id) : null;
                const transferRoute = targetAccount ? `${sourceAccount} → ${targetAccount}` : sourceAccount;
                return {
                  ...expense,
                  account_label: transferRoute,
                  category: expense.category || 'Uncategorized'
                };
              })}
              columns={expenseExportColumns}
              filename="investments"
              title="Investments Report"
            />
          </Box>
          <TableContainer>
            <Table stickyHeader>
              <TableHead sx={stickyTableHeadSx}>
                <TableRow>
                  <TableCell sortDirection={tableSortConfig.field === 'date' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'date'}
                      direction={tableSortConfig.field === 'date' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('date')}
                    >
                      Date
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={tableSortConfig.field === 'description' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'description'}
                      direction={tableSortConfig.field === 'description' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('description')}
                    >
                      Description
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={tableSortConfig.field === 'account' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'account'}
                      direction={tableSortConfig.field === 'account' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('account')}
                    >
                      From/To Account
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={tableSortConfig.field === 'category' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'category'}
                      direction={tableSortConfig.field === 'category' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('category')}
                    >
                      Type
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right" sortDirection={tableSortConfig.field === 'amount' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'amount'}
                      direction={tableSortConfig.field === 'amount' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('amount')}
                    >
                      Amount
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={tableSortConfig.field === 'notes' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'notes'}
                      direction={tableSortConfig.field === 'notes' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('notes')}
                    >
                      Notes
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'investment').length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center">
                      <Typography color="textSecondary" py={3}>
                        No investment movements found. Import transactions to see investment data.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'investment').map((expense) => {
                    const sourceAccount = getAccountLabel(expense.account_id);
                    const targetAccount = expense.paired_account_id ? getAccountLabel(expense.paired_account_id) : null;
                    const transferRoute = targetAccount ? `${sourceAccount} → ${targetAccount}` : sourceAccount;
                    return (
                      <TableRow key={expense.id}>
                        <TableCell>{formatDate(expense.date)}</TableCell>
                        <TableCell>{expense.description}</TableCell>
                        <TableCell>{transferRoute}</TableCell>
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
                              {categories.filter(cat => cat.type === 'investment').map(cat => (
                                <MenuItem key={cat.id} value={cat.name}>
                                  {renderCategoryLabel(cat.name, cat.name)}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </TableCell>
                        <TableCell align="right">{formatCurrency(expense.amount)}</TableCell>
                        <TableCell>{expense.notes || '-'}</TableCell>
                        <TableCell align="center">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteExpense(expense.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Tab 4: Transfers List */}
      {tabValue === 4 && (
        <Paper sx={{ p: 2 }}>
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <ExportButtons
              data={displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'transfer').map(expense => {
                const sourceAccount = getAccountLabel(expense.account_id);
                const targetAccount = expense.paired_account_id ? getAccountLabel(expense.paired_account_id) : null;
                const transferRoute = targetAccount ? `${sourceAccount} → ${targetAccount}` : sourceAccount;
                return {
                  ...expense,
                  account_label: transferRoute,
                  category: expense.category || 'Uncategorized'
                };
              })}
              columns={expenseExportColumns}
              filename="transfers"
              title="Transfers Report"
            />
          </Box>
          <TableContainer>
            <Table stickyHeader>
              <TableHead sx={stickyTableHeadSx}>
                <TableRow>
                  <TableCell sortDirection={tableSortConfig.field === 'date' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'date'}
                      direction={tableSortConfig.field === 'date' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('date')}
                    >
                      Date
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={tableSortConfig.field === 'description' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'description'}
                      direction={tableSortConfig.field === 'description' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('description')}
                    >
                      Description
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={tableSortConfig.field === 'account' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'account'}
                      direction={tableSortConfig.field === 'account' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('account')}
                    >
                      Transfer Route
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={tableSortConfig.field === 'category' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'category'}
                      direction={tableSortConfig.field === 'category' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('category')}
                    >
                      Category
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right" sortDirection={tableSortConfig.field === 'amount' ? tableSortConfig.direction : false}>
                    <TableSortLabel
                      active={tableSortConfig.field === 'amount'}
                      direction={tableSortConfig.field === 'amount' ? tableSortConfig.direction : 'asc'}
                      onClick={() => handleTableSort('amount')}
                    >
                      Amount
                    </TableSortLabel>
                  </TableCell>
                  <TableCell>Notes</TableCell>
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'transfer').length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center">
                      <Typography color="textSecondary" py={3}>
                        No transfer transactions found. Import transactions to see transfer data.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  displayedExpenses.filter(exp => getCategoryType(exp.category || 'Uncategorized') === 'transfer').map((expense) => {
                    const sourceAccount = getAccountLabel(expense.account_id);
                    const targetAccount = expense.paired_account_id ? getAccountLabel(expense.paired_account_id) : null;
                    const transferRoute = targetAccount ? `${sourceAccount} → ${targetAccount}` : sourceAccount;
                    return (
                      <TableRow key={expense.id}>
                        <TableCell>{formatDate(expense.date)}</TableCell>
                        <TableCell>{expense.description}</TableCell>
                        <TableCell>{transferRoute}</TableCell>
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
                              {categories.filter(cat => cat.type === 'transfer').map(cat => (
                                <MenuItem key={cat.id} value={cat.name}>
                                  {renderCategoryLabel(cat.name, cat.name)}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </TableCell>
                        <TableCell align="right">{formatCurrency(expense.amount)}</TableCell>
                        <TableCell>{expense.notes || '-'}</TableCell>
                        <TableCell align="center">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteExpense(expense.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Tab 5: Monthly Comparison */}
      {tabValue === 5 && (
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Monthly Expenses by Category (Last 6 Months)
              </Typography>
              {monthlyByCategoryData.length > 0 ? (
                <Box sx={{ height: 400 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyByCategoryData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip formatter={(value) => formatCurrency(value)} />
                      <Legend />
                      {allCategories.map((category, index) => (
                        <Bar
                          key={category}
                          dataKey={category}
                          stackId="a"
                          fill={getCategoryColor(category)}
                          name={category}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              ) : (
                <Typography color="textSecondary">
                  No monthly data available
                </Typography>
              )}
            </Paper>
          </Grid>

          <Grid item xs={12}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Category Trends Over Time
              </Typography>
              {monthlyByCategoryData.length > 0 ? (
                <Box sx={{ height: 400 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={monthlyByCategoryData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip formatter={(value) => formatCurrency(value)} />
                      <Legend />
                      {allCategories.map((category) => (
                        <Line
                          key={category}
                          type="monotone"
                          dataKey={category}
                          stroke={getCategoryColor(category)}
                          name={category}
                          strokeWidth={2}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </Box>
              ) : (
                <Typography color="textSecondary">
                  No trend data available
                </Typography>
              )}
            </Paper>
          </Grid>
        </Grid>
      )}

      {/* Category Management Dialog */}
      <Dialog open={categoryDialogOpen} onClose={() => setCategoryDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Manage Categories</DialogTitle>
        <DialogContent>
          <Box mb={3}>
            <Typography variant="subtitle1" gutterBottom>Existing Categories</Typography>
            <Box display="flex" flexWrap="wrap" gap={1}>
              {categories.map(category => (
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
                  <IconButton
                    size="small"
                    onClick={() => handleDeleteCategory(category.id)}
                    sx={{ ml: 0.5 }}
                    color="error"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Box>
          </Box>

          {editingCategory && (
            <Box mb={3} p={2} sx={{ bgcolor: 'grey.100', borderRadius: 1 }}>
              <Typography variant="subtitle1" gutterBottom>
                Edit Category: {editingCategory.name}
              </Typography>
              <TextField
                fullWidth
                label="Category Name"
                value={editingCategory.name}
                onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                margin="normal"
                size="small"
              />
              <FormControl fullWidth margin="normal" size="small">
                <InputLabel>Type</InputLabel>
                <Select
                  value={editingCategory.type}
                  onChange={(e) => setEditingCategory({ ...editingCategory, type: e.target.value })}
                  label="Type"
                >
                  <MenuItem value="expense">Expense</MenuItem>
                  <MenuItem value="income">Income</MenuItem>
                  <MenuItem value="investment">Investment</MenuItem>
                  <MenuItem value="transfer">Transfer</MenuItem>
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

          <Typography variant="subtitle1" gutterBottom>Add New Category</Typography>
          <TextField
            fullWidth
            label="Category Name"
            value={newCategory.name}
            onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
            margin="normal"
          />
          <FormControl fullWidth margin="normal">
            <InputLabel>Type</InputLabel>
            <Select
              value={newCategory.type}
              onChange={(e) => setNewCategory({ ...newCategory, type: e.target.value })}
              label="Type"
            >
              <MenuItem value="expense">Expense</MenuItem>
              <MenuItem value="income">Income</MenuItem>
              <MenuItem value="investment">Investment</MenuItem>
              <MenuItem value="transfer">Transfer</MenuItem>
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
        <DialogActions>
          <Button onClick={() => setCategoryDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateCategory} variant="contained" disabled={!newCategory.name}>
            Create Category
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default Cashflow;
