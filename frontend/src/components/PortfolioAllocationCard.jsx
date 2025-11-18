import React from 'react';
import {
  Paper,
  Typography,
  Box,
  Chip,
  Tabs,
  Tab
} from '@mui/material';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';

const COLOR_PALETTE = [
  '#007bff',
  '#e91e63',
  '#4caf50',
  '#ff9800',
  '#9c27b0',
  '#00bcd4',
  '#8bc34a',
  '#ffc107',
  '#ff5722',
  '#3f51b5',
  '#009688',
  '#cddc39'
];

/**
 * Portfolio Allocation Card - Shows a pie chart of portfolio breakdown
 *
 * @param {Object} props
 * @param {Array} props.typeSlices - Array of type breakdown data
 * @param {Array} props.subtypeSlices - Array of subtype breakdown data
 * @param {Array} props.sectorSlices - Array of sector breakdown data
 * @param {Array} props.industrySlices - Array of industry breakdown data
 * @param {Object} props.securityTypeColors - Color map for security types
 * @param {Object} props.securitySubtypeColors - Color map for security subtypes
 * @param {Object} props.sectorColors - Color map for sectors
 * @param {Object} props.industryColors - Color map for industries
 * @param {string} props.breakdownType - Current breakdown type ('type', 'subtype', 'sector', 'industry')
 * @param {Function} props.onBreakdownTypeChange - Handler for breakdown type change
 * @param {boolean} props.carouselEnabled - Whether carousel is enabled
 * @param {Function} props.onCarouselToggle - Handler for carousel toggle
 * @param {Function} props.onSliceClick - Handler for pie slice click (optional)
 * @param {Function} props.formatCurrency - Currency formatter function
 */
const PortfolioAllocationCard = ({
  typeSlices = [],
  subtypeSlices = [],
  sectorSlices = [],
  industrySlices = [],
  securityTypeColors = {},
  securitySubtypeColors = {},
  sectorColors = {},
  industryColors = {},
  breakdownType = 'type',
  onBreakdownTypeChange,
  carouselEnabled = true,
  onCarouselToggle,
  onSliceClick,
  formatCurrency
}) => {
  // Get current breakdown data based on selected type
  const getCurrentBreakdownData = () => {
    const result = {
      data: [],
      label: 'Type',
      colorMap: {}
    };

    switch (breakdownType) {
      case 'type':
        result.data = typeSlices || [];
        result.label = 'Type';
        result.colorMap = securityTypeColors || {};
        break;
      case 'subtype':
        result.data = subtypeSlices || [];
        result.label = 'Subtype';
        result.colorMap = securitySubtypeColors || {};
        break;
      case 'sector':
        result.data = sectorSlices || [];
        result.label = 'Sector';
        result.colorMap = sectorColors || {};
        break;
      case 'industry':
        result.data = industrySlices || [];
        result.label = 'Industry';
        result.colorMap = industryColors || {};
        break;
      default:
        result.data = typeSlices || [];
        result.label = 'Type';
        result.colorMap = securityTypeColors || {};
    }

    return result;
  };

  const breakdownData = getCurrentBreakdownData();

  // Debug: Log the data
  console.log('PortfolioAllocationCard - breakdownType:', breakdownType);
  console.log('PortfolioAllocationCard - typeSlices:', typeSlices);
  console.log('PortfolioAllocationCard - breakdownData:', breakdownData);

  return (
    <Paper sx={{ p: 3, height: '100%' }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">
          Portfolio Allocation
        </Typography>
        {onCarouselToggle && (
          <Chip
            label={carouselEnabled ? 'Auto' : 'Manual'}
            size="small"
            color={carouselEnabled ? 'primary' : 'default'}
            onClick={onCarouselToggle}
            sx={{ cursor: 'pointer' }}
          />
        )}
      </Box>
      <Tabs
        value={breakdownType}
        onChange={onBreakdownTypeChange}
        variant="fullWidth"
        sx={{ mb: 2, minHeight: 36 }}
      >
        <Tab label="Type" value="type" sx={{ minHeight: 36, py: 1 }} />
        <Tab label="Subtype" value="subtype" sx={{ minHeight: 36, py: 1 }} />
        <Tab label="Sector" value="sector" sx={{ minHeight: 36, py: 1 }} />
        <Tab label="Industry" value="industry" sx={{ minHeight: 36, py: 1 }} />
      </Tabs>
      {breakdownData.data.length === 0 ? (
        <Typography color="textSecondary" sx={{ textAlign: 'center', py: 4 }}>
          No {breakdownData.label.toLowerCase()} data available. Sync from Plaid to see breakdown.
        </Typography>
      ) : (
        <Box sx={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={breakdownData.data}
                dataKey="market_value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius="45%"
                outerRadius="80%"
                paddingAngle={2}
                labelLine={false}
                onClick={(data) => {
                  if (onSliceClick && data && data.payload) {
                    onSliceClick(data.payload);
                  }
                }}
              >
                {breakdownData.data.map((slice, index) => (
                  <Cell
                    key={slice.name || `slice-${index}`}
                    fill={breakdownData.colorMap[slice.name] || COLOR_PALETTE[index % COLOR_PALETTE.length]}
                    style={{ cursor: onSliceClick ? 'pointer' : 'default' }}
                  />
                ))}
              </Pie>
              <RechartsTooltip
                formatter={(value, name, payload) => [
                  formatCurrency(value),
                  payload?.payload?.name || name
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
        </Box>
      )}
    </Paper>
  );
};

export default PortfolioAllocationCard;
