import React from 'react';
import {
  Card,
  CardContent,
  Box,
  Typography,
  Chip,
  alpha
} from '@mui/material';
import {
  AccountBalance as AccountIcon,
  CalendarToday as CalendarIcon,
  TrendingUp as StockIcon,
  Category as CategoryIcon
} from '@mui/icons-material';

/**
 * Mobile-friendly card component for displaying dividend items
 * Redesigned for better mobile UX with intuitive information hierarchy
 */
const DividendCard = ({
  row,
  formatDateTime,
  formatCurrency
}) => {
  // Determine color based on type
  const getTypeColor = (type) => {
    const colors = {
      'Stocks': '#2196F3',
      'ETF': '#4CAF50',
      'REIT': '#FF9800',
      'Bond': '#9C27B0',
      'Mutual Fund': '#00BCD4'
    };
    return colors[type] || '#757575';
  };

  const typeColor = getTypeColor(row.type);

  return (
    <Card
      sx={{
        mb: 1.5,
        position: 'relative',
        overflow: 'visible',
        borderRadius: 2,
        boxShadow: 1,
        border: 1,
        borderColor: 'divider',
        transition: 'all 0.2s ease-in-out',
        '&:active': {
          boxShadow: 3,
          transform: 'scale(0.98)'
        }
      }}
    >
      {/* Type Color Bar */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          bgcolor: typeColor,
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8
        }}
      />

      <CardContent sx={{ pt: 2, pb: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
        {/* Top Row: Date and Amount */}
        <Box display="flex" alignItems="flex-start" justifyContent="space-between" mb={1.5}>
          {/* Left: Date */}
          <Box display="flex" alignItems="center" gap={0.5}>
            <CalendarIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.875rem' }}>
              {formatDateTime(row.date)}
            </Typography>
          </Box>

          {/* Right: Amount */}
          <Typography
            variant="h6"
            sx={{
              fontWeight: 700,
              color: 'success.main',
              fontSize: '1.25rem',
              lineHeight: 1
            }}
          >
            {formatCurrency(row.amount || 0)}
          </Typography>
        </Box>

        {/* Ticker Row */}
        <Box display="flex" alignItems="center" gap={1} mb={1.5}>
          <StockIcon sx={{ fontSize: 20, color: 'primary.main' }} />
          <Typography
            variant="h6"
            sx={{
              fontWeight: 700,
              fontSize: '1.125rem',
              color: 'text.primary',
              flex: 1
            }}
          >
            {row.ticker}
          </Typography>
          {row.currency && row.currency !== 'CAD' && (
            <Chip
              label={row.currency}
              size="small"
              sx={{
                height: 24,
                fontSize: '0.75rem',
                fontWeight: 600,
                bgcolor: alpha('#FFC107', 0.15),
                color: '#F57C00'
              }}
            />
          )}
        </Box>

        {/* Type and Industry Row */}
        <Box display="flex" alignItems="center" gap={1} mb={1}>
          <CategoryIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
          <Box display="flex" flexWrap="wrap" gap={0.75} flex={1}>
            <Chip
              label={row.type || 'Unknown'}
              size="small"
              sx={{
                height: 28,
                fontSize: '0.813rem',
                fontWeight: 500,
                bgcolor: alpha(typeColor, 0.15),
                color: typeColor,
                border: `1px solid ${alpha(typeColor, 0.3)}`
              }}
            />
            {row.industry && (
              <Chip
                label={row.industry}
                size="small"
                variant="outlined"
                sx={{
                  height: 28,
                  fontSize: '0.813rem',
                  fontWeight: 500,
                  borderColor: alpha('#000', 0.23),
                  color: 'text.secondary'
                }}
              />
            )}
          </Box>
        </Box>

        {/* Account Row */}
        {row.accountLabel && (
          <Box display="flex" alignItems="center" gap={0.75} mt={1} pt={1} sx={{ borderTop: 1, borderColor: 'divider' }}>
            <AccountIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                fontSize: '0.75rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {row.accountLabel}
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default DividendCard;
