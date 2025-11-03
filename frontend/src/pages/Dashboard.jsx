import React, { useState, useEffect } from 'react';
import {
  Container,
  Grid,
  Paper,
  Typography,
  Box,
  Card,
  CardContent,
  Button
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  AccountBalance,
  AttachMoney
} from '@mui/icons-material';
import { accountsAPI, positionsAPI, dividendsAPI } from '../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const Dashboard = () => {
  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [dividendSummary, setDividendSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [summaryRes, accountsRes, dividendsRes] = await Promise.all([
        positionsAPI.getSummary(),
        accountsAPI.getAll(),
        dividendsAPI.getSummary()
      ]);

      setSummary(summaryRes.data);
      setAccounts(accountsRes.data);
      setDividendSummary(dividendsRes.data);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
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

  const StatCard = ({ title, value, icon, color, subtitle }) => (
    <Card>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography color="textSecondary" gutterBottom>
              {title}
            </Typography>
            <Typography variant="h4">
              {value}
            </Typography>
            {subtitle && (
              <Typography variant="body2" color={color}>
                {subtitle}
              </Typography>
            )}
          </Box>
          <Box sx={{ color: color || 'primary.main' }}>
            {icon}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <Container>
        <Typography>Loading...</Typography>
      </Container>
    );
  }

  const gainLossColor = summary?.total_gain_loss >= 0 ? 'success.main' : 'error.main';
  const gainLossIcon = summary?.total_gain_loss >= 0 ? <TrendingUp fontSize="large" /> : <TrendingDown fontSize="large" />;

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        Dashboard
      </Typography>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Portfolio Value"
            value={formatCurrency(summary?.total_market_value || 0)}
            icon={<AccountBalance fontSize="large" />}
            color="primary.main"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Gain/Loss"
            value={formatCurrency(summary?.total_gain_loss || 0)}
            icon={gainLossIcon}
            color={gainLossColor}
            subtitle={`${summary?.total_gain_loss_percent?.toFixed(2) || 0}%`}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Dividends"
            value={formatCurrency(dividendSummary?.total_dividends || 0)}
            icon={<AttachMoney fontSize="large" />}
            color="success.main"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Accounts"
            value={summary?.accounts_count || 0}
            icon={<AccountBalance fontSize="large" />}
            color="info.main"
            subtitle={`${summary?.positions_count || 0} positions`}
          />
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Portfolio Performance
            </Typography>
            <Box sx={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={[]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="value" stroke="#8884d8" name="Portfolio Value" />
                </LineChart>
              </ResponsiveContainer>
            </Box>
            <Typography variant="caption" color="textSecondary" sx={{ mt: 2 }}>
              Import statements to see historical performance
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Accounts
            </Typography>
            {accounts.length === 0 ? (
              <Typography color="textSecondary">
                No accounts yet. Import a statement to get started.
              </Typography>
            ) : (
              accounts.map((account) => (
                <Box key={account.id} sx={{ mb: 2, pb: 2, borderBottom: '1px solid #eee' }}>
                  <Typography variant="subtitle1">
                    {account.institution}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    {account.account_type} - {account.account_number}
                  </Typography>
                  <Typography variant="h6" color="primary">
                    {formatCurrency(account.balance)}
                  </Typography>
                </Box>
              ))
            )}
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
};

export default Dashboard;
