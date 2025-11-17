import React, { useState, useEffect, useMemo } from 'react';
import {
  Container,
  Paper,
  Typography,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  FormControl,
  Select,
  MenuItem,
  TextField,
  Chip,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  Grid,
  Button,
  Stack,
  TableSortLabel,
  Checkbox,
  FormControlLabel,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import { Warning as WarningIcon } from '@mui/icons-material';
import { transactionsAPI, accountsAPI, importAPI } from '../services/api';
import { format, subDays, startOfMonth, startOfYear, subMonths, subYears } from 'date-fns';
import { stickyTableHeadSx, stickyFilterRowSx } from '../utils/tableStyles';
import ExportButtons from '../components/ExportButtons';

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

const formatDateToInput = (date) => {
  return format(date, 'yyyy-MM-dd');
};

const TRANSACTION_FILTER_DEFAULTS = {
  date: '',
  account: '',
  type: '',
  totalMin: '',
  totalMax: '',
  balanceMin: '',
  balanceMax: '',
  description: '',
  source: '',
  showOnlyInconsistent: false
};

const Transactions = () => {
  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [statements, setStatements] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortConfig, setSortConfig] = useState({ field: 'date', direction: 'desc' });
  const [filters, setFilters] = useState({ ...TRANSACTION_FILTER_DEFAULTS });
  const [balanceFixDialog, setBalanceFixDialog] = useState({ open: false, transaction: null, correctedBalance: '' });

  useEffect(() => {
    fetchAccounts();
    fetchStatements();
  }, []);

  useEffect(() => {
    fetchTransactions();
    fetchBalance();
  }, [selectedAccount, startDate, endDate]);

  const fetchAccounts = async () => {
    try {
      const response = await accountsAPI.getAll();
      setAccounts(response.data);
    } catch (err) {
      console.error('Error fetching accounts:', err);
    }
  };

  const fetchStatements = async () => {
    try {
      const response = await importAPI.getStatements();
      setStatements(response.data);
    } catch (err) {
      console.error('Error fetching statements:', err);
    }
  };

  const applyPreset = (presetValue) => {
    const today = new Date();
    const presets = {
      '7d': () => {
        const start = subDays(today, 6);
        return { start: formatDateToInput(start), end: formatDateToInput(today) };
      },
      '30d': () => {
        const start = subDays(today, 29);
        return { start: formatDateToInput(start), end: formatDateToInput(today) };
      },
      thisMonth: () => {
        const start = startOfMonth(today);
        return { start: formatDateToInput(start), end: formatDateToInput(today) };
      },
      lastMonth: () => {
        const start = startOfMonth(subMonths(today, 1));
        const end = new Date(today.getFullYear(), today.getMonth(), 0);
        return { start: formatDateToInput(start), end: formatDateToInput(end) };
      },
      last3Months: () => {
        const start = startOfMonth(subMonths(today, 2));
        return { start: formatDateToInput(start), end: formatDateToInput(today) };
      },
      last6Months: () => {
        const start = startOfMonth(subMonths(today, 5));
        return { start: formatDateToInput(start), end: formatDateToInput(today) };
      },
      last12Months: () => {
        const start = startOfMonth(subMonths(today, 11));
        return { start: formatDateToInput(start), end: formatDateToInput(today) };
      },
      thisYear: () => {
        const start = startOfYear(today);
        return { start: formatDateToInput(start), end: formatDateToInput(today) };
      },
      lastYear: () => {
        const start = startOfYear(subYears(today, 1));
        const end = new Date(today.getFullYear() - 1, 11, 31);
        return { start: formatDateToInput(start), end: formatDateToInput(end) };
      },
      all: () => ({ start: '', end: '' })
    };

    const range = presets[presetValue] ? presets[presetValue]() : presets.all();
    setSelectedPreset(presetValue);
    setStartDate(range.start);
    setEndDate(range.end);
  };

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

  const fetchTransactions = async () => {
    setLoading(true);
    setError('');
    try {
      const start = startDate ? new Date(startDate).toISOString() : null;
      const end = endDate ? new Date(endDate).toISOString() : null;
      const response = await transactionsAPI.getAll(
        selectedAccount || null,
        start,
        end,
        true  // includeBalance
      );
      setTransactions(response.data);
    } catch (err) {
      setError('Failed to fetch transactions');
      console.error('Error fetching transactions:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchBalance = async () => {
    try {
      const end = endDate ? new Date(endDate).toISOString() : null;
      const response = await transactionsAPI.getBalance(
        selectedAccount || null,
        end
      );
      setBalance(response.data);
    } catch (err) {
      console.error('Error fetching balance:', err);
    }
  };

  const handleFixBalanceClick = (transaction) => {
    setBalanceFixDialog({
      open: true,
      transaction,
      correctedBalance: transaction.expected_balance || ''
    });
  };

  const handleFixBalanceSubmit = async () => {
    try {
      const { transaction, correctedBalance } = balanceFixDialog;
      await transactionsAPI.fixBalance(transaction.id, {
        corrected_balance: parseFloat(correctedBalance)
      });

      // Close dialog
      setBalanceFixDialog({ open: false, transaction: null, correctedBalance: '' });

      // Refresh transactions
      await fetchTransactions();
    } catch (err) {
      console.error('Error fixing balance:', err);
      alert('Failed to fix balance: ' + (err.response?.data?.detail || err.message));
    }
  };

  const getTransactionTypeColor = (type) => {
    const colors = {
      buy: 'error',
      sell: 'success',
      dividend: 'success',
      deposit: 'success',
      withdrawal: 'warning',
      fee: 'error',
      bonus: 'success',
      transfer: 'info',
      tax: 'error'
    };
    return colors[type] || 'default';
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(amount);
  };

  const getAccountName = (accountId) => {
    const account = accounts.find(acc => acc.id === accountId);
    return account ? `${account.institution} - ${account.account_number}` : accountId;
  };

  const getStatementCount = () => {
    if (!selectedAccount) {
      return statements.length;
    }
    return statements.filter(s => s.account_id === selectedAccount).length;
  };

  const handleSort = (field) => {
    setSortConfig((prev) => {
      if (prev.field === field) {
        return { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { field, direction: 'asc' };
    });
  };

  const handleFilterChange = (field, value) => {
    setFilters((prev) => ({
      ...prev,
      [field]: value
    }));
  };

  const resetFilters = () => {
    setFilters({ ...TRANSACTION_FILTER_DEFAULTS });
  };

  const transactionTypes = useMemo(() => {
    const uniqueTypes = new Set(
      transactions
        .map((tx) => tx.type)
        .filter(Boolean)
    );
    return Array.from(uniqueTypes).sort();
  }, [transactions]);

  const getSortableValue = (transaction, field) => {
    switch (field) {
      case 'date':
        return new Date(transaction.date).getTime();
      case 'account':
        return getAccountName(transaction.account_id).toLowerCase();
      case 'type':
        return (transaction.type || '').toLowerCase();
      case 'total':
        return Number(transaction.total ?? Number.NEGATIVE_INFINITY);
      case 'running_balance':
        return Number(transaction.running_balance ?? Number.NEGATIVE_INFINITY);
      case 'description':
        return (transaction.description || '').toLowerCase();
      case 'source':
        return (transaction.source || 'manual').toLowerCase();
      default:
        return transaction[field];
    }
  };

  const processedTransactions = useMemo(() => {
    const normalizedTextFilters = {
      account: filters.account.trim().toLowerCase(),
      description: filters.description.trim().toLowerCase(),
      source: filters.source.trim().toLowerCase()
    };

    const passesRangeFilter = (value, min, max) => {
      if (min !== '' && (value == null || Number(value) < Number(min))) {
        return false;
      }
      if (max !== '' && (value == null || Number(value) > Number(max))) {
        return false;
      }
      return true;
    };

    const filtered = transactions.filter((tx) => {
      if (filters.date) {
        const txDate = formatDateToInput(new Date(tx.date));
        if (txDate !== filters.date) {
          return false;
        }
      }

      if (normalizedTextFilters.account) {
        const accountName = getAccountName(tx.account_id).toLowerCase();
        if (!accountName.includes(normalizedTextFilters.account)) {
          return false;
        }
      }

      if (filters.type && tx.type !== filters.type) {
        return false;
      }

      if (!passesRangeFilter(tx.total, filters.totalMin, filters.totalMax)) {
        return false;
      }

      if (!passesRangeFilter(tx.running_balance, filters.balanceMin, filters.balanceMax)) {
        return false;
      }

      if (normalizedTextFilters.description) {
        const description = (tx.description || '').toLowerCase();
        if (!description.includes(normalizedTextFilters.description)) {
          return false;
        }
      }

      if (normalizedTextFilters.source) {
        const source = (tx.source || 'manual').toLowerCase();
        if (source !== normalizedTextFilters.source) {
          return false;
        }
      }

      if (filters.showOnlyInconsistent && !tx.has_balance_inconsistency) {
        return false;
      }

      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      const valueA = getSortableValue(a, sortConfig.field);
      const valueB = getSortableValue(b, sortConfig.field);

      if (valueA < valueB) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (valueA > valueB) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }

      // Tie-breaker: when primary sort values are equal, use secondary sorting
      // For date sorting, use total (value) ASC to show debits before credits within the same day
      if (sortConfig.field === 'date') {
        const totalA = a.total ?? 0;
        const totalB = b.total ?? 0;

        if (totalA !== totalB) {
          // Always sort by total ASC (debits before credits for display)
          // This shows smallest debits first, then larger debits, then credits
          return totalA - totalB;  // ASC: debits (negative) first, then credits (positive)
        }
      }

      return 0;
    });

    return sorted;
  }, [transactions, filters, sortConfig, accounts]);

  // Export configuration
  const transactionExportColumns = useMemo(() => [
    { field: 'date', header: 'Date', type: 'date' },
    { field: 'account_name', header: 'Account' },
    { field: 'type', header: 'Type' },
    { field: 'description', header: 'Description' },
    { field: 'total', header: 'Amount', type: 'currency' },
    { field: 'running_balance', header: 'Balance', type: 'currency' }
  ], []);

  const transactionExportData = useMemo(() =>
    processedTransactions.map(tx => ({
      ...tx,
      account_name: getAccountName(tx.account_id),
      type: tx.type?.toUpperCase() || ''
    })),
    [processedTransactions, accounts]
  );

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        Account Transactions
      </Typography>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={3}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Account
              </Typography>
              <FormControl fullWidth size="small">
                <Select
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  displayEmpty
                >
                  <MenuItem value="">All Accounts</MenuItem>
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
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={3}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Total Transactions
              </Typography>
              <Typography variant="h4">
                {transactions.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={3}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Imported Statements
              </Typography>
              <Typography variant="h4">
                {getStatementCount()}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={3}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Account Balance
              </Typography>
              <Typography variant="h4" sx={{
                color: balance?.balance > 0
                  ? 'success.main'
                  : balance?.balance < 0
                    ? 'error.main'
                    : 'text.primary'
              }}>
                {balance?.balance !== null && balance?.balance !== undefined
                  ? formatCurrency(balance.balance)
                  : '-'}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                {selectedAccount
                  ? `Balance for selected account`
                  : 'Select an account to view balance'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
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
          </Box>
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
            <Button variant="text" size="small" onClick={() => applyPreset('all')}>
              Clear filters
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 2 }}>
        <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
          <ExportButtons
            data={transactionExportData}
            columns={transactionExportColumns}
            filename="transactions"
            title="Transactions Report"
          />
        </Box>
        <TableContainer>
          <Table stickyHeader>
            <TableHead sx={stickyTableHeadSx}>
              <TableRow>
                <TableCell sortDirection={sortConfig.field === 'date' ? sortConfig.direction : false}>
                  <TableSortLabel
                    active={sortConfig.field === 'date'}
                    direction={sortConfig.field === 'date' ? sortConfig.direction : 'asc'}
                    onClick={() => handleSort('date')}
                  >
                    Date
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortConfig.field === 'account' ? sortConfig.direction : false}>
                  <TableSortLabel
                    active={sortConfig.field === 'account'}
                    direction={sortConfig.field === 'account' ? sortConfig.direction : 'asc'}
                    onClick={() => handleSort('account')}
                  >
                    Account
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortConfig.field === 'type' ? sortConfig.direction : false}>
                  <TableSortLabel
                    active={sortConfig.field === 'type'}
                    direction={sortConfig.field === 'type' ? sortConfig.direction : 'asc'}
                    onClick={() => handleSort('type')}
                  >
                    Type
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortConfig.field === 'description' ? sortConfig.direction : false}>
                  <TableSortLabel
                    active={sortConfig.field === 'description'}
                    direction={sortConfig.field === 'description' ? sortConfig.direction : 'asc'}
                    onClick={() => handleSort('description')}
                  >
                    Description
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right" sortDirection={sortConfig.field === 'total' ? sortConfig.direction : false}>
                  <TableSortLabel
                    active={sortConfig.field === 'total'}
                    direction={sortConfig.field === 'total' ? sortConfig.direction : 'asc'}
                    onClick={() => handleSort('total')}
                  >
                    Amount
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right" sortDirection={sortConfig.field === 'running_balance' ? sortConfig.direction : false}>
                  <TableSortLabel
                    active={sortConfig.field === 'running_balance'}
                    direction={sortConfig.field === 'running_balance' ? sortConfig.direction : 'asc'}
                    onClick={() => handleSort('running_balance')}
                  >
                    Balance
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortConfig.field === 'source' ? sortConfig.direction : false}>
                  <TableSortLabel
                    active={sortConfig.field === 'source'}
                    direction={sortConfig.field === 'source' ? sortConfig.direction : 'asc'}
                    onClick={() => handleSort('source')}
                  >
                    Source
                  </TableSortLabel>
                </TableCell>
              </TableRow>
              <TableRow sx={stickyFilterRowSx}>
                <TableCell>
                  <TextField
                    type="date"
                    size="small"
                    value={filters.date}
                    onChange={(e) => handleFilterChange('date', e.target.value)}
                    fullWidth
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    placeholder="Search account"
                    value={filters.account}
                    onChange={(e) => handleFilterChange('account', e.target.value)}
                    fullWidth
                  />
                </TableCell>
                <TableCell>
                  <FormControl size="small" fullWidth>
                    <Select
                      value={filters.type}
                      onChange={(e) => handleFilterChange('type', e.target.value)}
                      displayEmpty
                    >
                      <MenuItem value="">
                        <em>All Types</em>
                      </MenuItem>
                      {transactionTypes.map((type) => (
                        <MenuItem key={type} value={type}>
                          {type.toUpperCase()}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    placeholder="Search description"
                    value={filters.description}
                    onChange={(e) => handleFilterChange('description', e.target.value)}
                    fullWidth
                  />
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    <TextField
                      size="small"
                      type="number"
                      placeholder="Min"
                      value={filters.totalMin}
                      onChange={(e) => handleFilterChange('totalMin', e.target.value)}
                      sx={{ width: 90 }}
                    />
                    <TextField
                      size="small"
                      type="number"
                      placeholder="Max"
                      value={filters.totalMax}
                      onChange={(e) => handleFilterChange('totalMax', e.target.value)}
                      sx={{ width: 90 }}
                    />
                  </Stack>
                </TableCell>
                <TableCell align="right">
                  <Stack direction="column" spacing={0.5} alignItems="flex-end">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <TextField
                        size="small"
                        type="number"
                        placeholder="Min"
                        value={filters.balanceMin}
                        onChange={(e) => handleFilterChange('balanceMin', e.target.value)}
                        sx={{ width: 90 }}
                      />
                      <TextField
                        size="small"
                        type="number"
                        placeholder="Max"
                        value={filters.balanceMax}
                        onChange={(e) => handleFilterChange('balanceMax', e.target.value)}
                        sx={{ width: 90 }}
                      />
                    </Stack>
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={filters.showOnlyInconsistent}
                          onChange={(e) => handleFilterChange('showOnlyInconsistent', e.target.checked)}
                        />
                      }
                      label={
                        <Typography variant="caption">
                          Inconsistent only
                        </Typography>
                      }
                      sx={{ mr: 0 }}
                    />
                  </Stack>
                </TableCell>
                <TableCell>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
                    <Select
                      size="small"
                      value={filters.source}
                      onChange={(e) => handleFilterChange('source', e.target.value)}
                      displayEmpty
                      fullWidth
                    >
                      <MenuItem value="">All</MenuItem>
                      <MenuItem value="manual">Manual</MenuItem>
                      <MenuItem value="plaid">Plaid</MenuItem>
                      <MenuItem value="import">Import</MenuItem>
                    </Select>
                    <Button variant="text" size="small" onClick={resetFilters}>
                      Reset
                    </Button>
                  </Stack>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    <CircularProgress />
                  </TableCell>
                </TableRow>
              ) : transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    No transactions found
                  </TableCell>
                </TableRow>
              ) : processedTransactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    No transactions match the selected filters
                  </TableCell>
                </TableRow>
              ) : (
                processedTransactions.map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell>
                      {format(new Date(transaction.date), 'MMM dd, yyyy')}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                        {getAccountName(transaction.account_id)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={transaction.type.toUpperCase()}
                        color={getTransactionTypeColor(transaction.type)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                        {transaction.description || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 'bold',
                          color: transaction.total >= 0
                            ? 'success.main'
                            : 'error.main'
                        }}
                      >
                        {formatCurrency(transaction.total)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end">
                        {transaction.running_balance !== null && transaction.running_balance !== undefined ? (
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: 'medium',
                              color: transaction.running_balance > 0
                                ? 'success.main'
                                : transaction.running_balance < 0
                                  ? 'error.main'
                                  : 'text.secondary'
                            }}
                          >
                            {formatCurrency(transaction.running_balance)}
                          </Typography>
                        ) : (
                          <Typography variant="body2" color="text.secondary">-</Typography>
                        )}
                        {transaction.has_balance_inconsistency && (
                          <Tooltip
                            title={
                              <Box>
                                <Typography variant="caption" display="block">
                                  <strong>Balance Inconsistency Detected</strong>
                                </Typography>
                                <Typography variant="caption" display="block">
                                  Expected: {formatCurrency(transaction.expected_balance || 0)}
                                </Typography>
                                {transaction.actual_balance !== null && transaction.actual_balance !== undefined && (
                                  <Typography variant="caption" display="block">
                                    Actual: {formatCurrency(transaction.actual_balance)}
                                  </Typography>
                                )}
                                {transaction.balance_discrepancy !== null && transaction.balance_discrepancy !== undefined && (
                                  <Typography variant="caption" display="block">
                                    Discrepancy: {formatCurrency(transaction.balance_discrepancy)}
                                  </Typography>
                                )}
                                <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                                  Click to fix this balance
                                </Typography>
                              </Box>
                            }
                          >
                            <IconButton
                              size="small"
                              color="warning"
                              onClick={() => handleFixBalanceClick(transaction)}
                              sx={{ p: 0.5 }}
                            >
                              <WarningIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={transaction.source || 'manual'}
                        size="small"
                        color={
                          transaction.source === 'plaid' ? 'primary' :
                          transaction.source === 'import' ? 'secondary' :
                          'default'
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Balance Correction Dialog */}
      <Dialog
        open={balanceFixDialog.open}
        onClose={() => setBalanceFixDialog({ open: false, transaction: null, correctedBalance: '' })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Fix Balance Inconsistency</DialogTitle>
        <DialogContent>
          {balanceFixDialog.transaction && (
            <Box sx={{ pt: 1 }}>
              <Typography variant="body2" gutterBottom>
                <strong>Transaction:</strong> {balanceFixDialog.transaction.description || balanceFixDialog.transaction.type}
              </Typography>
              <Typography variant="body2" gutterBottom>
                <strong>Date:</strong> {format(new Date(balanceFixDialog.transaction.date), 'MMM dd, yyyy')}
              </Typography>
              <Typography variant="body2" gutterBottom>
                <strong>Expected Balance:</strong> {formatCurrency(balanceFixDialog.transaction.expected_balance || 0)}
              </Typography>
              {balanceFixDialog.transaction.actual_balance !== null && balanceFixDialog.transaction.actual_balance !== undefined && (
                <Typography variant="body2" gutterBottom>
                  <strong>Current Actual Balance:</strong> {formatCurrency(balanceFixDialog.transaction.actual_balance)}
                </Typography>
              )}
              {balanceFixDialog.transaction.balance_discrepancy !== null && balanceFixDialog.transaction.balance_discrepancy !== undefined && (
                <Typography variant="body2" gutterBottom color="error">
                  <strong>Discrepancy:</strong> {formatCurrency(balanceFixDialog.transaction.balance_discrepancy)}
                </Typography>
              )}
              <TextField
                autoFocus
                margin="dense"
                label="Corrected Balance After This Transaction"
                type="number"
                fullWidth
                value={balanceFixDialog.correctedBalance}
                onChange={(e) => setBalanceFixDialog(prev => ({ ...prev, correctedBalance: e.target.value }))}
                sx={{ mt: 2 }}
                helperText="Enter the correct account balance after this transaction"
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBalanceFixDialog({ open: false, transaction: null, correctedBalance: '' })}>
            Cancel
          </Button>
          <Button onClick={handleFixBalanceSubmit} variant="contained" color="primary">
            Fix Balance
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default Transactions;
