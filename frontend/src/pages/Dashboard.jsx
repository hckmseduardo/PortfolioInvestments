import React, { useState, useEffect, useMemo } from 'react';
import {
  Container,
  Grid,
  Paper,
  Typography,
  Box,
  Card,
  CardContent,
  TextField,
  Stack,
  Button
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  AccountBalance,
  AttachMoney
} from '@mui/icons-material';
import { accountsAPI, positionsAPI, dividendsAPI, dashboardAPI } from '../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const DEFAULT_LAYOUT = [
  'total_value',
  'book_value',
  'capital_gains',
  'dividends',
  'total_gains',
  'accounts_summary',
  'performance',
  'accounts_list'
];

const Dashboard = () => {
  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [dividendSummary, setDividendSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const [layoutLoading, setLayoutLoading] = useState(true);
  const [draggedId, setDraggedId] = useState(null);

  useEffect(() => {
    const loadLayout = async () => {
      try {
        const response = await dashboardAPI.getLayout();
        const serverLayout = response.data?.layout;
        if (Array.isArray(serverLayout) && serverLayout.length > 0) {
          const sanitized = serverLayout.filter((item) => DEFAULT_LAYOUT.includes(item));
          const unique = [...new Set(sanitized)];
          setLayout(unique.length ? unique : DEFAULT_LAYOUT);
        } else {
          setLayout(DEFAULT_LAYOUT);
        }
      } catch (error) {
        console.error('Error loading dashboard layout:', error);
        setLayout(DEFAULT_LAYOUT);
      } finally {
        setLayoutLoading(false);
      }
    };

    loadLayout();
  }, []);

  useEffect(() => {
    if (layoutLoading) {
      return;
    }
    const fetchData = async () => {
      setFetching(true);
      try {
        const asOfParam = selectedDate || undefined;
        const [summaryRes, accountsRes, dividendsRes] = await Promise.all([
          positionsAPI.getSummary(asOfParam),
          accountsAPI.getAll(),
          dividendsAPI.getSummary(undefined, undefined, asOfParam)
        ]);

        setSummary(summaryRes.data);
        setAccounts(accountsRes.data);
        setDividendSummary(dividendsRes.data);
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
        setFetching(false);
      }
    };

    fetchData();
  }, [selectedDate, layoutLoading]);

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(value || 0);
  };

  const capitalGains = useMemo(() => {
    try {
      const totalMarket = summary?.total_market_value || 0;
      const totalBook = summary?.total_book_value || 0;
      return totalMarket - totalBook;
    } catch {
      return 0;
    }
  }, [summary]);

  const totalDividends = dividendSummary?.total_dividends || 0;
  const totalGains = capitalGains + totalDividends;

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

  if (loading || layoutLoading) {
    return (
      <Container>
        <Typography>Loading...</Typography>
      </Container>
    );
  }

  const gainLossColor = capitalGains >= 0 ? 'success.main' : 'error.main';
  const gainLossIcon = capitalGains >= 0 ? <TrendingUp fontSize="large" /> : <TrendingDown fontSize="large" />;

  const asOfLabel = selectedDate
    ? new Date(selectedDate).toLocaleDateString()
    : new Date().toLocaleDateString();

  const persistLayout = async (nextLayout) => {
    setLayout(nextLayout);
    try {
      await dashboardAPI.saveLayout(nextLayout);
    } catch (error) {
      console.error('Error saving dashboard layout:', error);
    }
  };

  const handleResetLayout = async () => {
    try {
      await dashboardAPI.resetLayout();
    } catch (error) {
      console.error('Error resetting dashboard layout:', error);
    } finally {
      setLayout(DEFAULT_LAYOUT);
    }
  };

  const handleDragStart = (event, itemId) => {
    event.dataTransfer.setData('text/plain', itemId);
    event.dataTransfer.effectAllowed = 'move';
    setDraggedId(itemId);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const reorderLayout = (items, fromId, toId) => {
    if (fromId === toId) {
      return items;
    }
    const newItems = items.filter((item) => item !== fromId);
    const targetIndex = newItems.indexOf(toId);
    if (targetIndex === -1) {
      return items;
    }
    newItems.splice(targetIndex, 0, fromId);
    if (newItems.join(',') === items.join(',')) {
      return items;
    }
    return newItems;
  };

  const handleDrop = (event, targetId) => {
    event.preventDefault();
    const dragged = event.dataTransfer.getData('text/plain');
    if (!dragged) {
      setDraggedId(null);
      return;
    }
    const nextLayout = reorderLayout(layout, dragged, targetId);
    if (nextLayout !== layout) {
      persistLayout(nextLayout);
    }
    setDraggedId(null);
  };

  const handleDropOnContainer = (event) => {
    event.preventDefault();
    const dragged = event.dataTransfer.getData('text/plain');
    if (!dragged) {
      return;
    }
    if (layout[layout.length - 1] === dragged) {
      setDraggedId(null);
      return;
    }
    const filtered = layout.filter((item) => item !== dragged);
    const nextLayout = [...filtered, dragged];
    persistLayout(nextLayout);
    setDraggedId(null);
  };

  const layoutConfig = {
    total_value: {
      grid: { xs: 12, sm: 6, md: 3 },
      render: () => (
        <StatCard
          title="Total Portfolio Value"
          value={formatCurrency(summary?.total_market_value || 0)}
          icon={<AccountBalance fontSize="large" />}
          color="primary.main"
        />
      )
    },
    book_value: {
      grid: { xs: 12, sm: 6, md: 3 },
      render: () => (
        <StatCard
          title="Book Value"
          value={formatCurrency(summary?.total_book_value || 0)}
          icon={<AccountBalance fontSize="large" />}
          color="info.main"
        />
      )
    },
    capital_gains: {
      grid: { xs: 12, sm: 6, md: 3 },
      render: () => (
        <StatCard
          title="Total Gain/Loss"
          value={formatCurrency(capitalGains)}
          icon={gainLossIcon}
          color={gainLossColor}
          subtitle={`${summary?.total_gain_loss_percent?.toFixed(2) || 0}%`}
        />
      )
    },
    dividends: {
      grid: { xs: 12, sm: 6, md: 3 },
      render: () => (
        <StatCard
          title="Total Dividends"
          value={formatCurrency(totalDividends)}
          icon={<AttachMoney fontSize="large" />}
          color="success.main"
        />
      )
    },
    total_gains: {
      grid: { xs: 12, sm: 6, md: 3 },
      render: () => (
        <StatCard
          title="Total Gains"
          value={formatCurrency(totalGains)}
          icon={<TrendingUp fontSize="large" />}
          color={totalGains >= 0 ? 'success.main' : 'error.main'}
          subtitle="Capital gains + dividends"
        />
      )
    },
    accounts_summary: {
      grid: { xs: 12, sm: 6, md: 3 },
      render: () => (
        <StatCard
          title="Accounts"
          value={summary?.accounts_count || 0}
          icon={<AccountBalance fontSize="large" />}
          color="info.main"
          subtitle={`${summary?.positions_count || 0} positions`}
        />
      )
    },
    performance: {
      grid: { xs: 12, md: 8 },
      render: () => (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Portfolio Performance
          </Typography>
          {fetching && (
            <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
              Updating metrics…
            </Typography>
          )}
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
      )
    },
    accounts_list: {
      grid: { xs: 12, md: 4 },
      render: () => (
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
      )
    }
  };

  const renderedItems = layout
    .map((item) => ({ key: item, config: layoutConfig[item] }))
    .filter((entry) => entry.config);

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4" gutterBottom>
            Dashboard
          </Typography>
          <Typography variant="body2" color="textSecondary">
            As of {asOfLabel}
          </Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }}>
          <TextField
            label="As of date"
            type="date"
            size="small"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            InputLabelProps={{ shrink: true }}
            helperText="Select a past date to view historical metrics"
          />
          <Button variant="outlined" size="small" onClick={handleResetLayout}>
            Reset Layout
          </Button>
        </Stack>
      </Box>
      <Grid
        container
        spacing={3}
        onDragOver={handleDragOver}
        onDrop={handleDropOnContainer}
      >
        {renderedItems.map(({ key, config }) => (
          <Grid item key={key} {...config.grid}>
            <Box
              draggable
              onDragStart={(event) => handleDragStart(event, key)}
              onDragOver={handleDragOver}
              onDrop={(event) => handleDrop(event, key)}
              onDragEnd={handleDragEnd}
              sx={{
                cursor: 'grab',
                opacity: draggedId === key ? 0.55 : 1,
                transition: 'opacity 0.2s'
              }}
            >
              {config.render()}
            </Box>
          </Grid>
        ))}
      </Grid>
    </Container>
  );
};

export default Dashboard;
