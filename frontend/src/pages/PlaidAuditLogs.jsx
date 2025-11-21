import React, { useState, useEffect } from 'react';
import {
  Container,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Chip,
  Box,
  CircularProgress,
  Alert,
  IconButton,
  Collapse,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField
} from '@mui/material';
import {
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon
} from '@mui/icons-material';
import api from '../services/api';

// Row component with expandable details
function AuditLogRow({ log }) {
  const [open, setOpen] = useState(false);

  const getStatusColor = (statusCode) => {
    if (!statusCode) return 'default';
    if (statusCode >= 200 && statusCode < 300) return 'success';
    if (statusCode >= 400 && statusCode < 500) return 'warning';
    if (statusCode >= 500) return 'error';
    return 'default';
  };

  const getSyncTypeColor = (syncType) => {
    switch (syncType) {
      case 'full_resync':
        return 'primary';
      case 'incremental':
        return 'info';
      case 'initial':
        return 'secondary';
      case 'account_linking':
        return 'success';
      case 'link_initialization':
        return 'default';
      default:
        return 'default';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const formatDuration = (ms) => {
    if (!ms) return 'N/A';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <>
      <TableRow sx={{ '& > *': { borderBottom: 'unset' } }}>
        <TableCell>
          <IconButton
            aria-label="expand row"
            size="small"
            onClick={() => setOpen(!open)}
          >
            {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </TableCell>
        <TableCell>{formatDate(log.timestamp)}</TableCell>
        <TableCell>
          <Box sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
            {log.endpoint}
          </Box>
        </TableCell>
        <TableCell>
          {log.sync_type && (
            <Chip
              label={log.sync_type}
              size="small"
              color={getSyncTypeColor(log.sync_type)}
            />
          )}
        </TableCell>
        <TableCell>
          <Chip
            label={log.status_code || 'N/A'}
            size="small"
            color={getStatusColor(log.status_code)}
          />
        </TableCell>
        <TableCell>{formatDuration(log.duration_ms)}</TableCell>
      </TableRow>
      <TableRow>
        <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={6}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ margin: 2 }}>
              <Typography variant="h6" gutterBottom component="div">
                Details
              </Typography>

              {log.error_message && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {log.error_message}
                </Alert>
              )}

              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  Method: {log.method}
                </Typography>
                <Typography variant="subtitle2" color="text.secondary">
                  Log ID: {log.id}
                </Typography>
                {log.plaid_item_id && (
                  <Typography variant="subtitle2" color="text.secondary">
                    Plaid Item ID: {log.plaid_item_id}
                  </Typography>
                )}
              </Box>

              {log.request_params && Object.keys(log.request_params).length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Request Parameters:
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 1, bgcolor: 'background.default' }}>
                    <pre style={{ margin: 0, fontSize: '0.75rem', overflow: 'auto' }}>
                      {JSON.stringify(log.request_params, null, 2)}
                    </pre>
                  </Paper>
                </Box>
              )}

              {log.response_summary && Object.keys(log.response_summary).length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Response Summary:
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 1, bgcolor: 'background.default' }}>
                    <pre style={{ margin: 0, fontSize: '0.75rem', overflow: 'auto' }}>
                      {JSON.stringify(log.response_summary, null, 2)}
                    </pre>
                  </Paper>
                </Box>
              )}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

export default function PlaidAuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [totalLogs, setTotalLogs] = useState(0);
  const [plaidItems, setPlaidItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState('');
  const [endpointFilter, setEndpointFilter] = useState('');

  // Fetch Plaid items for filter
  useEffect(() => {
    const fetchPlaidItems = async () => {
      try {
        const response = await api.get('/plaid/items');
        setPlaidItems(response.data || []);
      } catch (err) {
        console.error('Error fetching Plaid items:', err);
      }
    };
    fetchPlaidItems();
  }, []);

  // Fetch audit logs
  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = {
          limit: rowsPerPage,
          offset: page * rowsPerPage
        };

        if (selectedItem) {
          params.plaid_item_id = selectedItem;
        }

        const response = await api.get('/plaid/audit-logs', { params });
        setLogs(response.data.logs || []);
        setTotalLogs(response.data.total || 0);
      } catch (err) {
        console.error('Error fetching audit logs:', err);
        setError('Failed to fetch audit logs. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, [page, rowsPerPage, selectedItem]);

  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleItemFilterChange = (event) => {
    setSelectedItem(event.target.value);
    setPage(0);
  };

  // Get unique endpoints for filtering
  const uniqueEndpoints = [...new Set(logs.map(log => log.endpoint))].filter(Boolean);

  // Filter logs by endpoint (client-side filter)
  const filteredLogs = endpointFilter
    ? logs.filter(log => log.endpoint === endpointFilter)
    : logs;

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        Plaid Audit Logs
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Complete audit trail of all Plaid API interactions, including transaction syncs,
        account linking, and data fetches.
      </Typography>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <FormControl sx={{ minWidth: 250 }} size="small">
          <InputLabel>Filter by Institution</InputLabel>
          <Select
            value={selectedItem}
            label="Filter by Institution"
            onChange={handleItemFilterChange}
          >
            <MenuItem value="">All Institutions</MenuItem>
            {plaidItems.map((item) => (
              <MenuItem key={item.id} value={item.id}>
                {item.institution_name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl sx={{ minWidth: 250 }} size="small">
          <InputLabel>Filter by Endpoint</InputLabel>
          <Select
            value={endpointFilter}
            label="Filter by Endpoint"
            onChange={(e) => setEndpointFilter(e.target.value)}
          >
            <MenuItem value="">All Endpoints</MenuItem>
            {uniqueEndpoints.map((endpoint) => (
              <MenuItem key={endpoint} value={endpoint}>
                {endpoint}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell />
                <TableCell>Timestamp</TableCell>
                <TableCell>Endpoint</TableCell>
                <TableCell>Sync Type</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Duration</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                    <CircularProgress />
                  </TableCell>
                </TableRow>
              ) : filteredLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      No audit logs found. Connect a Plaid account to start seeing logs.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filteredLogs.map((log) => (
                  <AuditLogRow key={log.id} log={log} />
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          rowsPerPageOptions={[10, 25, 50, 100]}
          component="div"
          count={totalLogs}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={handleChangePage}
          onRowsPerPageChange={handleChangeRowsPerPage}
        />
      </Paper>
    </Container>
  );
}
