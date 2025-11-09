import React, { useState, useEffect } from 'react';
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
  InputLabel,
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
  Stack
} from '@mui/material';
import { transactionsAPI, accountsAPI, importAPI } from '../services/api';
import { format, subDays, startOfMonth, startOfYear, subMonths, subYears } from 'date-fns';

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
        end
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

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        Account Transactions
      </Typography>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Account Balance
              </Typography>
              <Typography variant="h4">
                {balance ? formatCurrency(balance.balance) : formatCurrency(0)}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                {balance && balance.as_of_date ? `As of ${format(new Date(balance.as_of_date), 'MMM dd, yyyy')}` : 'No transactions'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card>
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
        <Grid item xs={12} md={4}>
          <Card>
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
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Account</InputLabel>
                <Select
                  value={selectedAccount}
                  label="Account"
                  onChange={(e) => setSelectedAccount(e.target.value)}
                >
                  <MenuItem value="">All Accounts</MenuItem>
                  {accounts.map((account) => (
                    <MenuItem key={account.id} value={account.id}>
                      {account.institution} - {account.account_number}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Stack>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Account</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Ticker</TableCell>
                <TableCell align="right">Quantity</TableCell>
                <TableCell align="right">Price</TableCell>
                <TableCell align="right">Fees</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell>Description</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} align="center">
                    <CircularProgress />
                  </TableCell>
                </TableRow>
              ) : transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} align="center">
                    No transactions found
                  </TableCell>
                </TableRow>
              ) : (
                transactions.map((transaction) => (
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
                    <TableCell>{transaction.ticker || '-'}</TableCell>
                    <TableCell align="right">
                      {transaction.quantity ? transaction.quantity.toFixed(4) : '-'}
                    </TableCell>
                    <TableCell align="right">
                      {transaction.price ? formatCurrency(transaction.price) : '-'}
                    </TableCell>
                    <TableCell align="right">
                      {formatCurrency(transaction.fees)}
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 'bold',
                          color: ['deposit', 'dividend', 'sell', 'bonus'].includes(transaction.type)
                            ? 'success.main'
                            : 'error.main'
                        }}
                      >
                        {formatCurrency(transaction.total)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                        {transaction.description || '-'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Container>
  );
};

export default Transactions;
