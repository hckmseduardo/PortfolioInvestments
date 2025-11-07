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
  MenuItem,
  Select,
  TextField,
  Stack,
  LinearProgress,
  Tooltip,
  CircularProgress
} from '@mui/material';
import { Refresh, ErrorOutline } from '@mui/icons-material';
import { positionsAPI, accountsAPI } from '../services/api';

const DATE_PRESETS = {
  CURRENT: 'current',
  LAST_MONTH: 'last_month',
  SPECIFIC_MONTH: 'specific_month',
  LAST_QUARTER: 'last_quarter',
  LAST_YEAR: 'last_year',
  END_OF_YEAR: 'end_of_year'
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
  const [positions, setPositions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [datePreset, setDatePreset] = useState(DATE_PRESETS.CURRENT);
  const [specificMonth, setSpecificMonth] = useState('');
  const [endOfYear, setEndOfYear] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetching, setFetching] = useState(false);
  const hasLoadedOnce = useRef(false);
  const priceRefreshTimer = useRef(null);

  const valuationDate = useMemo(
    () => computeValuationDate(datePreset, specificMonth, endOfYear),
    [datePreset, specificMonth, endOfYear]
  );

  const fetchPositions = useCallback(async () => {
    if (!hasLoadedOnce.current) {
      setLoading(true);
    } else {
      setFetching(true);
    }
    try {
      const response = await positionsAPI.getAggregated(
        selectedAccountId || undefined,
        valuationDate || undefined
      );
      const data = response.data || [];
      setPositions(data);

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
    } finally {
      hasLoadedOnce.current = true;
      setLoading(false);
      setFetching(false);
    }
  }, [selectedAccountId, valuationDate]);

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
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="portfolio-date-select">Valuation</InputLabel>
            <Select
              labelId="portfolio-date-select"
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
            <Button variant="text" size="small" onClick={() => {
              setDatePreset(DATE_PRESETS.CURRENT);
              setSpecificMonth('');
              setEndOfYear('');
            }}>
              Clear selection
            </Button>
          )}
        </Stack>
      </Paper>

      {valuationDate && (
        <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
          Showing positions as of {new Date(valuationDate).toLocaleDateString()}
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
    </Container>
  );
};

export default Portfolio;
