import React, { useState, useEffect } from 'react';
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
  Chip
} from '@mui/material';
import { Refresh } from '@mui/icons-material';
import { positionsAPI } from '../services/api';

const Portfolio = () => {
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchPositions();
  }, []);

  const fetchPositions = async () => {
    try {
      const response = await positionsAPI.getAll();
      setPositions(response.data);
    } catch (error) {
      console.error('Error fetching positions:', error);
    } finally {
      setLoading(false);
    }
  };

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

  if (loading) {
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
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing...' : 'Refresh Prices'}
        </Button>
      </Box>

      {positions.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" color="textSecondary">
            No positions found
          </Typography>
          <Typography color="textSecondary">
            Import a statement to see your portfolio
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell><strong>Ticker</strong></TableCell>
                <TableCell><strong>Name</strong></TableCell>
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
                  <TableRow key={position.id}>
                    <TableCell>
                      <Chip label={position.ticker} color="primary" size="small" />
                    </TableCell>
                    <TableCell>{position.name}</TableCell>
                    <TableCell align="right">{position.quantity}</TableCell>
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
