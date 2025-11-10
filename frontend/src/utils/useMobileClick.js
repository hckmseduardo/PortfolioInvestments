import { useRef, useCallback } from 'react';
import { useMediaQuery, useTheme } from '@mui/material';

/**
 * Hook to handle click events on pie charts that require double-click on mobile
 * and single-click on desktop. This allows mobile users to see tooltips before filtering.
 *
 * @param {Function} callback - The function to call when the click condition is met
 * @param {number} delay - Delay in ms to wait for second click on mobile (default: 300)
 * @returns {Function} Click handler function
 */
export const useMobileClick = (callback, delay = 300) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const clickTimeoutRef = useRef(null);
  const clickCountRef = useRef(0);
  const lastClickDataRef = useRef(null);

  const handleClick = useCallback((...args) => {
    // On desktop, execute immediately on single click
    if (!isMobile) {
      callback(...args);
      return;
    }

    // On mobile, require double click
    clickCountRef.current += 1;
    lastClickDataRef.current = args;

    // Clear existing timeout
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
    }

    // If this is the second click, execute callback
    if (clickCountRef.current === 2) {
      callback(...args);
      clickCountRef.current = 0;
      lastClickDataRef.current = null;
      return;
    }

    // Set timeout to reset click count
    clickTimeoutRef.current = setTimeout(() => {
      clickCountRef.current = 0;
      lastClickDataRef.current = null;
      clickTimeoutRef.current = null;
    }, delay);
  }, [callback, delay, isMobile]);

  return handleClick;
};

/**
 * Hook specifically for Recharts Pie chart onClick handlers
 * Returns an object with the appropriate event handler property
 *
 * @param {Function} callback - The function to call when clicked/double-clicked
 * @returns {Object} Props object to spread onto Pie or Cell component
 */
export const usePieChartClick = (callback) => {
  const handleClick = useMobileClick(callback);

  return {
    onClick: handleClick,
    style: { cursor: 'pointer' }
  };
};
