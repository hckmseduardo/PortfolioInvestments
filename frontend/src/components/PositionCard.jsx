import React from 'react';
import {
  Card,
  CardContent,
  Box,
  Typography,
  Chip,
  Stack,
  Divider,
  alpha
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  AccountBalance as AccountIcon,
  Category as CategoryIcon,
  Business as BusinessIcon
} from '@mui/icons-material';

/**
 * Mobile-friendly card component for displaying portfolio positions
 * Follows the same design pattern as ExpenseCard for consistency
 */
const PositionCard = ({
  position,
  formatCurrency,
  formatPercentage,
  getAccountLabel,
  formatDate,
  typeColor,
  industryColor
}) => {
  const isGain = position.gain_loss >= 0;
  const gainLossColor = isGain ? '#4caf50' : '#f44336';
  const borderColor = isGain ? '#4caf50' : '#f44336';

  return (
    <Card
      sx={{
        mb: 1.5,
        position: 'relative',
        overflow: 'visible',
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        boxShadow: 1,
        transition: 'all 0.2s ease-in-out',
        '&:active': {
          transform: 'scale(0.98)',
          boxShadow: 2
        }
      }}
    >
      {/* Gain/Loss Color Bar */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          bgcolor: gainLossColor,
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8
        }}
      />

      <CardContent sx={{ pt: 2, pb: 2, px: 2, '&:last-child': { pb: 2 } }}>
        {/* Top Row: Ticker + Gain/Loss */}
        <Box display="flex" alignItems="flex-start" justifyContent="space-between" mb={1}>
          {/* Left: Ticker Symbol */}
          <Box>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                fontSize: '1.25rem',
                lineHeight: 1.2,
                color: 'text.primary',
                letterSpacing: '0.5px'
              }}
            >
              {position.ticker}
            </Typography>
            {position.name && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  display: 'block',
                  fontSize: '0.75rem',
                  lineHeight: 1.3,
                  mt: 0.25
                }}
              >
                {position.name}
              </Typography>
            )}
          </Box>

          {/* Right: Gain/Loss */}
          <Box textAlign="right">
            <Box display="flex" alignItems="center" justifyContent="flex-end" gap={0.5}>
              {isGain ? (
                <TrendingUpIcon sx={{ fontSize: 18, color: gainLossColor }} />
              ) : (
                <TrendingDownIcon sx={{ fontSize: 18, color: gainLossColor }} />
              )}
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 700,
                  color: gainLossColor,
                  fontSize: '1.15rem',
                  lineHeight: 1
                }}
              >
                {formatCurrency(position.gain_loss)}
              </Typography>
            </Box>
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                color: gainLossColor,
                fontWeight: 600,
                fontSize: '0.75rem',
                mt: 0.25
              }}
            >
              {formatPercentage(position.gain_loss_percent)}
            </Typography>
          </Box>
        </Box>

        {/* Price + Quantity Row */}
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          mb={1.5}
          px={1.5}
          py={1}
          sx={{
            bgcolor: alpha('#000', 0.03),
            borderRadius: 1
          }}
        >
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block' }}>
              Price
            </Typography>
            <Typography variant="body2" fontWeight={600} sx={{ fontSize: '0.875rem' }}>
              {formatCurrency(position.price)}
            </Typography>
          </Box>
          <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block' }}>
              Quantity
            </Typography>
            <Typography variant="body2" fontWeight={600} sx={{ fontSize: '0.875rem' }}>
              {Number(position.quantity).toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 4
              })}
            </Typography>
          </Box>
          <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
          <Box textAlign="right">
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block' }}>
              Market Value
            </Typography>
            <Typography variant="body2" fontWeight={700} color="primary" sx={{ fontSize: '0.875rem' }}>
              {formatCurrency(position.market_value)}
            </Typography>
          </Box>
        </Box>

        {/* Book Value */}
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={1.5}>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.813rem' }}>
            Book Value
          </Typography>
          <Typography variant="body2" fontWeight={600} sx={{ fontSize: '0.875rem' }}>
            {formatCurrency(position.book_value)}
          </Typography>
        </Box>

        {/* Chips Row: Type + Industry */}
        <Stack direction="row" spacing={1} mb={1} flexWrap="wrap" useFlexGap>
          {position.instrument_type_name && (
            <Chip
              icon={<CategoryIcon sx={{ fontSize: 14, color: typeColor || undefined }} />}
              label={position.instrument_type_name}
              size="small"
              variant="outlined"
              sx={{
                height: 24,
                fontSize: '0.75rem',
                fontWeight: 500,
                borderRadius: 1.5,
                ...(typeColor && {
                  borderColor: typeColor,
                  color: typeColor,
                  bgcolor: alpha(typeColor, 0.08),
                  '&:hover': {
                    bgcolor: alpha(typeColor, 0.12)
                  }
                }),
                '& .MuiChip-icon': {
                  marginLeft: 0.5
                }
              }}
            />
          )}
          {position.instrument_industry_name && (
            <Chip
              icon={<BusinessIcon sx={{ fontSize: 14, color: industryColor || undefined }} />}
              label={position.instrument_industry_name}
              size="small"
              variant="outlined"
              sx={{
                height: 24,
                fontSize: '0.75rem',
                fontWeight: 500,
                borderRadius: 1.5,
                ...(industryColor && {
                  borderColor: industryColor,
                  color: industryColor,
                  bgcolor: alpha(industryColor, 0.08),
                  '&:hover': {
                    bgcolor: alpha(industryColor, 0.12)
                  }
                }),
                '& .MuiChip-icon': {
                  marginLeft: 0.5
                }
              }}
            />
          )}
        </Stack>

        {/* Account Info */}
        <Box
          display="flex"
          alignItems="center"
          gap={0.75}
          pt={1}
          sx={{
            borderTop: 1,
            borderColor: 'divider'
          }}
        >
          <AccountIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
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
            {getAccountLabel(position.account_id)}
          </Typography>
          {position.snapshot_date && (
            <>
              <Typography variant="caption" color="text.secondary" sx={{ mx: 0.5 }}>
                •
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontSize: '0.75rem' }}
              >
                {formatDate(position.snapshot_date)}
              </Typography>
            </>
          )}
        </Box>
      </CardContent>
    </Card>
  );
};

export default PositionCard;
