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
  Grid
} from '@mui/material';
import { transactionsAPI, accountsAPI, importAPI } from '../services/api';
import { format, subDays, startOfMonth, startOfYear, subMonths, subYears } from 'date-fns';

const Transactions = () => {
  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [statements, setStatements] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
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
  }, [selectedAccount, filterType, customStartDate, customEndDate]);

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

  const getDateRange = () => {
    const now = new Date();
    let startDate = null;
    let endDate = now;

    switch (filterType) {
      case 'last7days':
        startDate = subDays(now, 7);
        break;
      case 'mtd':
        startDate = startOfMonth(now);
        break;
      case 'lastMonth':
        startDate = startOfMonth(subMonths(now, 1));
        endDate = startOfMonth(now);
        break;
      case 'ytd':
        startDate = startOfYear(now);
        break;
      case 'lastYear':
        startDate = startOfYear(subYears(now, 1));
        endDate = startOfYear(now);
        break;
      case 'custom':
        startDate = customStartDate ? new Date(customStartDate) : null;
        endDate = customEndDate ? new Date(customEndDate) : null;
        break;
      case 'all':
      default:
        startDate = null;
        endDate = null;
    }

    return { startDate, endDate };
  };

  const fetchTransactions = async () => {
    setLoading(true);
    setError('');
    try {
      const { startDate, endDate } = getDateRange();
      const response = await transactionsAPI.getAll(
        selectedAccount || null,
        startDate ? startDate.toISOString() : null,
        endDate ? endDate.toISOString() : null
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
      const { endDate } = getDateRange();
      const response = await transactionsAPI.getBalance(
        selectedAccount || null,
        endDate ? endDate.toISOString() : null
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
        <Typography variant="h6" gutterBottom>
          Filters
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
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
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Period</InputLabel>
              <Select
                value={filterType}
                label="Period"
                onChange={(e) => setFilterType(e.target.value)}
              >
                <MenuItem value="all">All Time</MenuItem>
                <MenuItem value="last7days">Last 7 Days</MenuItem>
                <MenuItem value="mtd">Month to Date</MenuItem>
                <MenuItem value="lastMonth">Last Month</MenuItem>
                <MenuItem value="ytd">Year to Date</MenuItem>
                <MenuItem value="lastYear">Last Year</MenuItem>
                <MenuItem value="custom">Custom Period</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          {filterType === 'custom' && (
            <>
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth
                  label="Start Date"
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  InputLabelProps={{
                    shrink: true,
                  }}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth
                  label="End Date"
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  InputLabelProps={{
                    shrink: true,
                  }}
                />
              </Grid>
            </>
          )}
        </Grid>
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
