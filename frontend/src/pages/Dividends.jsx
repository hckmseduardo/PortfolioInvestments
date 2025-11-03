import React, { useState, useEffect } from 'react';
import {
  Container,
  Paper,
  Typography,
  Grid,
  Box
} from '@mui/material';
import { dividendsAPI } from '../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

const Dividends = () => {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDividends();
  }, []);

  const fetchDividends = async () => {
    try {
      const response = await dividendsAPI.getSummary();
      setSummary(response.data);
    } catch (error) {
      console.error('Error fetching dividends:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(value);
  };

  if (loading) {
    return (
      <Container>
        <Typography>Loading...</Typography>
      </Container>
    );
  }

  const monthlyData = Object.entries(summary?.dividends_by_month || {})
    .map(([month, amount]) => ({
      month,
      amount
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const tickerData = Object.entries(summary?.dividends_by_ticker || {})
    .map(([ticker, amount]) => ({
      name: ticker,
      value: amount
    }));

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        Dividend Income
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h5" gutterBottom>
              Total Dividends: {formatCurrency(summary?.total_dividends || 0)}
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Dividends by Month
            </Typography>
            {monthlyData.length > 0 ? (
              <Box sx={{ height: 400 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                    <Legend />
                    <Bar dataKey="amount" fill="#8884d8" name="Dividend Amount" />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            ) : (
              <Typography color="textSecondary">
                No dividend data available
              </Typography>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Dividends by Ticker
            </Typography>
            {tickerData.length > 0 ? (
              <Box sx={{ height: 400 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={tickerData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {tickerData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                  </PieChart>
                </ResponsiveContainer>
                <Box sx={{ mt: 2 }}>
                  {tickerData.map((item, index) => (
                    <Box key={item.name} display="flex" justifyContent="space-between" mb={1}>
                      <Box display="flex" alignItems="center">
                        <Box
                          sx={{
                            width: 12,
                            height: 12,
                            backgroundColor: COLORS[index % COLORS.length],
                            mr: 1
                          }}
                        />
                        <Typography variant="body2">{item.name}</Typography>
                      </Box>
                      <Typography variant="body2">{formatCurrency(item.value)}</Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            ) : (
              <Typography color="textSecondary">
                No dividend data available
              </Typography>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
};

export default Dividends;
