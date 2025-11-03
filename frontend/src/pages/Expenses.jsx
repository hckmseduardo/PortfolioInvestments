import React, { useState, useEffect } from 'react';
import {
  Container,
  Paper,
  Typography,
  Grid,
  Box
} from '@mui/material';
import { expensesAPI } from '../services/api';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D', '#FFC658', '#FF6B9D'];

const Expenses = () => {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchExpenses();
  }, []);

  const fetchExpenses = async () => {
    try {
      const response = await expensesAPI.getSummary();
      setSummary(response.data);
    } catch (error) {
      console.error('Error fetching expenses:', error);
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

  const categoryData = Object.entries(summary?.by_category || {})
    .map(([category, amount]) => ({
      name: category,
      value: amount
    }));

  const monthlyData = Object.entries(summary?.by_month || {})
    .map(([month, amount]) => ({
      month,
      amount
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        Expense Management
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h5" gutterBottom>
              Total Expenses: {formatCurrency(summary?.total_expenses || 0)}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {summary?.expense_count || 0} transactions
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Expenses by Category
            </Typography>
            {categoryData.length > 0 ? (
              <>
                <Box sx={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {categoryData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => formatCurrency(value)} />
                    </PieChart>
                  </ResponsiveContainer>
                </Box>
                <Box sx={{ mt: 2 }}>
                  {categoryData.map((item, index) => (
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
              </>
            ) : (
              <Typography color="textSecondary">
                No expense data available
              </Typography>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Monthly Spending Trend
            </Typography>
            {monthlyData.length > 0 ? (
              <Box sx={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                    <Legend />
                    <Bar dataKey="amount" fill="#82ca9d" name="Expenses" />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            ) : (
              <Typography color="textSecondary">
                No expense data available
              </Typography>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
};

export default Expenses;
