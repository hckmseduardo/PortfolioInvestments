import React from 'react';
import {
  Paper,
  Typography,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow
} from '@mui/material';

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
 * Portfolio Breakdown Card - Shows a table of portfolio breakdown
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
 * @param {Function} props.formatCurrency - Currency formatter function
 */
const PortfolioBreakdownCard = ({
  typeSlices = [],
  subtypeSlices = [],
  sectorSlices = [],
  industrySlices = [],
  securityTypeColors = {},
  securitySubtypeColors = {},
  sectorColors = {},
  industryColors = {},
  breakdownType = 'type',
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

  return (
    <Paper sx={{ p: 3, height: '100%' }}>
      <Typography variant="h6" gutterBottom>
        {breakdownData.label} Breakdown
      </Typography>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
        Market value distribution by {breakdownData.label.toLowerCase()}
      </Typography>
      {breakdownData.data.length === 0 ? (
        <Typography color="textSecondary" sx={{ textAlign: 'center', py: 4 }}>
          No data available
        </Typography>
      ) : (
        <TableContainer sx={{ maxHeight: 360 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell><strong>{breakdownData.label}</strong></TableCell>
                <TableCell align="right"><strong>Market Value</strong></TableCell>
                <TableCell align="right"><strong>Percentage</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {breakdownData.data
                .sort((a, b) => b.market_value - a.market_value)
                .map((item, index) => (
                  <TableRow key={item.name || `row-${index}`}>
                    <TableCell>
                      <Box display="flex" alignItems="center" gap={1}>
                        <Box
                          sx={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            bgcolor: breakdownData.colorMap[item.name] || COLOR_PALETTE[index % COLOR_PALETTE.length],
                            border: '1px solid rgba(0,0,0,0.12)'
                          }}
                        />
                        <Typography variant="body2">{item.name}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={500}>
                        {formatCurrency(item.market_value)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" color="textSecondary">
                        {item.percentage.toFixed(2)}%
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
};

export default PortfolioBreakdownCard;
