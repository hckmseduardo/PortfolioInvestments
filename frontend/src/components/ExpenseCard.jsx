import React from 'react';
import {
  Card,
  CardContent,
  Box,
  Typography,
  IconButton,
  FormControl,
  Select,
  MenuItem,
  Checkbox,
  Chip,
  Stack,
  alpha
} from '@mui/material';
import {
  Delete as DeleteIcon,
  FilterAlt as FilterAltIcon,
  AccountBalance as AccountIcon,
  CalendarToday as CalendarIcon,
  MoreVert as MoreVertIcon
} from '@mui/icons-material';

/**
 * Mobile-friendly card component for displaying expense items
 * Redesigned for better mobile UX with intuitive information hierarchy
 */
const ExpenseCard = ({
  expense,
  isSelected,
  onToggleSelection,
  onDelete,
  onCategoryChange,
  onFilterByDescription,
  onFilterByAmount,
  formatDate,
  formatCurrency,
  getAccountLabel,
  getCategoryColor,
  renderCategoryLabel,
  categories
}) => {
  const categoryColor = getCategoryColor(expense.category);

  return (
    <Card
      sx={{
        mb: 1.5,
        position: 'relative',
        overflow: 'visible',
        bgcolor: isSelected ? alpha('#1976d2', 0.08) : 'background.paper',
        border: isSelected ? 2 : 1,
        borderColor: isSelected ? 'primary.main' : 'divider',
        borderRadius: 2,
        boxShadow: isSelected ? 3 : 1,
        transition: 'all 0.2s ease-in-out'
      }}
      onClick={(e) => {
        // Only toggle selection if clicking on the card background, not on interactive elements
        if (e.target === e.currentTarget) {
          onToggleSelection(expense.id);
        }
      }}
    >
      {/* Category Color Bar */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          bgcolor: categoryColor,
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8
        }}
      />

      <CardContent sx={{ pt: 2, pb: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
        {/* Top Row: Checkbox, Date, Amount */}
        <Box display="flex" alignItems="flex-start" justifyContent="space-between" mb={1.5}>
          {/* Left: Checkbox + Date */}
          <Box display="flex" alignItems="center" gap={1} flex={1}>
            <Checkbox
              color="primary"
              checked={isSelected}
              onChange={() => onToggleSelection(expense.id)}
              sx={{
                p: 0,
                '& .MuiSvgIcon-root': { fontSize: 24 }
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <Box display="flex" alignItems="center" gap={0.5}>
              <CalendarIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.875rem' }}>
                {formatDate(expense.date)}
              </Typography>
            </Box>
          </Box>

          {/* Right: Amount */}
          <Box display="flex" alignItems="center" gap={0.5}>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                color: 'error.main',
                fontSize: '1.25rem',
                lineHeight: 1
              }}
            >
              {formatCurrency(expense.amount)}
            </Typography>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onFilterByAmount(expense.amount);
              }}
              sx={{
                p: 0.5,
                ml: 0.5,
                bgcolor: alpha('#000', 0.04),
                '&:hover': { bgcolor: alpha('#000', 0.08) }
              }}
            >
              <FilterAltIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        </Box>

        {/* Description Row */}
        <Box display="flex" alignItems="flex-start" gap={1} mb={1.5}>
          <Typography
            variant="body1"
            sx={{
              fontWeight: 600,
              flex: 1,
              fontSize: '1rem',
              lineHeight: 1.4,
              color: 'text.primary'
            }}
          >
            {expense.description}
          </Typography>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onFilterByDescription(expense.description);
            }}
            sx={{
              p: 0.5,
              mt: -0.5,
              bgcolor: alpha('#000', 0.04),
              '&:hover': { bgcolor: alpha('#000', 0.08) }
            }}
          >
            <FilterAltIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>

        {/* Account + Category Row */}
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={1} gap={1}>
          {/* Account */}
          <Box display="flex" alignItems="center" gap={0.75} flex={1} minWidth={0}>
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
              {getAccountLabel(expense.account_id)}
            </Typography>
          </Box>

          {/* Category Selector */}
          <FormControl size="small" sx={{ minWidth: 140, maxWidth: '50%' }}>
            <Select
              value={expense.category || 'Uncategorized'}
              onChange={(e) => {
                e.stopPropagation();
                onCategoryChange(expense.id, e.target.value);
              }}
              sx={{
                bgcolor: categoryColor,
                color: 'white',
                fontSize: '0.813rem',
                fontWeight: 500,
                borderRadius: 1.5,
                height: 32,
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'transparent'
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: alpha('#fff', 0.3)
                },
                '& .MuiSelect-icon': {
                  color: 'white'
                },
                '& .MuiSelect-select': {
                  py: 0.75,
                  display: 'flex',
                  alignItems: 'center'
                }
              }}
              renderValue={(value) => (
                <Box component="span" sx={{ fontSize: '0.813rem' }}>
                  {value || 'Uncategorized'}
                </Box>
              )}
              MenuProps={{
                PaperProps: {
                  sx: {
                    maxHeight: 300,
                    '& .MuiMenuItem-root': {
                      fontSize: '0.875rem'
                    }
                  }
                }
              }}
            >
              <MenuItem value="Uncategorized">
                <Typography variant="body2">Uncategorized</Typography>
              </MenuItem>
              {categories.map(cat => (
                <MenuItem key={cat.id} value={cat.name}>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        bgcolor: getCategoryColor(cat.name),
                        border: '1px solid rgba(0,0,0,0.1)'
                      }}
                    />
                    <Typography variant="body2">{cat.name}</Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        {/* Notes (if exists) */}
        {expense.notes && (
          <Box
            mt={1.5}
            pt={1.5}
            sx={{
              borderTop: 1,
              borderColor: 'divider',
              bgcolor: alpha('#000', 0.02),
              mx: -2,
              px: 2,
              pb: 0.5,
              borderBottomLeftRadius: 8,
              borderBottomRightRadius: 8
            }}
          >
            <Typography variant="caption" color="text.secondary" display="block" mb={0.5} sx={{ fontWeight: 600 }}>
              Notes
            </Typography>
            <Typography variant="body2" color="text.primary" sx={{ fontSize: '0.875rem', lineHeight: 1.4 }}>
              {expense.notes}
            </Typography>
          </Box>
        )}

        {/* Delete Button (Bottom Right Corner) */}
        <IconButton
          size="small"
          color="error"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(expense.id);
          }}
          sx={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            bgcolor: alpha('#d32f2f', 0.08),
            '&:hover': {
              bgcolor: alpha('#d32f2f', 0.15)
            },
            width: 32,
            height: 32
          }}
        >
          <DeleteIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </CardContent>
    </Card>
  );
};

export default ExpenseCard;
