import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  MenuItem,
  Select,
  TextField,
  Stack,
  LinearProgress
} from '@mui/material';
import { Refresh } from '@mui/icons-material';
import { positionsAPI, accountsAPI } from '../services/api';

const Portfolio = () => {
  const [positions, setPositions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetching, setFetching] = useState(false);
  const hasLoadedOnce = useRef(false);

  const fetchPositions = useCallback(async () => {
    if (!hasLoadedOnce.current) {
      setLoading(true);
    } else {
      setFetching(true);
    }
    try {
      const response = await positionsAPI.getAggregated(
        selectedAccountId || undefined,
        selectedDate || undefined
      );
      setPositions(response.data);
    } catch (error) {
      console.error('Error fetching positions:', error);
      setPositions([]);
    } finally {
      hasLoadedOnce.current = true;
      setLoading(false);
      setFetching(false);
    }
  }, [selectedAccountId, selectedDate]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

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
    }).format(value);
  };

  const formatNumber = (value, fractionDigits = 2) => {
    return new Intl.NumberFormat('en-CA', {
      minimumFractionDigits: 0,
      maximumFractionDigits: fractionDigits
    }).format(value);
  };

  const formatPercent = (value) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  const calculateGainLoss = (position) => {
    return position.market_value - position.book_value;
  };

  const calculateGainLossPercent = (position) => {
    if (position.book_value === 0) return 0;
    return ((position.market_value - position.book_value) / position.book_value) * 100;
  };

  if (loading && positions.length === 0) {
    return (
      <Container>
        <Typography>Loading...</Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">
          Portfolio
        </Typography>
        <Button
          variant="contained"
          startIcon={<Refresh />}
          onClick={handleRefreshPrices}
          disabled={refreshing || fetching}
        >
          {refreshing ? 'Refreshing...' : fetching ? 'Updating...' : 'Refresh Prices'}
        </Button>
      </Box>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="portfolio-account-select">Account</InputLabel>
            <Select
              labelId="portfolio-account-select"
              value={selectedAccountId}
              label="Account"
              onChange={(event) => setSelectedAccountId(event.target.value)}
            >
              <MenuItem value="">
                All accounts
              </MenuItem>
              {accounts.map((account) => (
                <MenuItem key={account.id} value={account.id}>
                  {account.label || `${account.institution} - ${account.account_number}`} ({account.account_type})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="As of date"
            type="date"
            size="small"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          {selectedDate && (
            <Button variant="text" size="small" onClick={() => setSelectedDate('')}>
              Clear date
            </Button>
          )}
        </Stack>
      </Paper>

      {selectedDate && (
        <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
          Showing positions as of {new Date(selectedDate).toLocaleDateString()}
        </Typography>
      )}

      {positions.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" color="textSecondary">
            No positions found{(selectedAccountId || selectedDate) ? ' for the selected criteria' : ''}
          </Typography>
          <Typography color="textSecondary">
            {(selectedAccountId || selectedDate)
              ? 'Try adjusting the account or date filters.'
              : 'Import a statement to see your portfolio'}
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          {fetching && <LinearProgress />}
          <Table>
            <TableHead>
              <TableRow>
                <TableCell><strong>Ticker</strong></TableCell>
                <TableCell><strong>Name</strong></TableCell>
                <TableCell align="right"><strong>Price</strong></TableCell>
                <TableCell align="right"><strong>Quantity</strong></TableCell>
                <TableCell align="right"><strong>Book Value</strong></TableCell>
                <TableCell align="right"><strong>Market Value</strong></TableCell>
                <TableCell align="right"><strong>Gain/Loss</strong></TableCell>
                <TableCell align="right"><strong>Gain/Loss %</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {positions.map((position) => {
                const gainLoss = calculateGainLoss(position);
                const gainLossPercent = calculateGainLossPercent(position);
                const isPositive = gainLoss >= 0;

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
                    <TableCell align="right">
                      {position.ticker === 'CASH'
                        ? '—'
                        : (position.price != null ? formatCurrency(position.price) : '—')}
                    </TableCell>
                    <TableCell align="right">
                      {formatNumber(position.quantity, position.ticker === 'CASH' ? 2 : 4)}
                    </TableCell>
                    <TableCell align="right">{formatCurrency(position.book_value)}</TableCell>
                    <TableCell align="right">{formatCurrency(position.market_value)}</TableCell>
                    <TableCell 
                      align="right" 
                      sx={{ color: isPositive ? 'success.main' : 'error.main' }}
                    >
                      {formatCurrency(gainLoss)}
                    </TableCell>
                    <TableCell 
                      align="right"
                      sx={{ color: isPositive ? 'success.main' : 'error.main' }}
                    >
                      {formatPercent(gainLossPercent)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Container>
  );
};

export default Portfolio;
