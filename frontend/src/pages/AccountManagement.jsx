import React, { useState, useEffect, useRef } from 'react';
import {
  Container,
  Paper,
  Typography,
  Button,
  Box,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Chip,
  CircularProgress,
  Divider
} from '@mui/material';
import { Add, Edit, Delete, AccountBalance, Sync, LinkOff } from '@mui/icons-material';
import { accountsAPI, transactionsAPI, plaidAPI } from '../services/api';
import { stickyTableHeadSx } from '../utils/tableStyles';
import ExportButtons from '../components/ExportButtons';
import PlaidLinkButton from '../components/PlaidLink';
import { useNotification } from '../context/NotificationContext';

const AccountManagement = () => {
  const { showJobProgress, updateJobStatus } = useNotification();
  const [accounts, setAccounts] = useState([]);
  const [accountBalances, setAccountBalances] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [currentAccount, setCurrentAccount] = useState(null);
  const [formData, setFormData] = useState({
    account_type: 'investment',
    account_number: '',
    institution: '',
    balance: 0,
    label: ''
  });

  // Plaid-specific state
  const [plaidItems, setPlaidItems] = useState([]);
  const [plaidLoading, setPlaidLoading] = useState(false);
  const [syncingItems, setSyncingItems] = useState({});

  // Job tracking state
  const [syncJobIds, setSyncJobIds] = useState({});
  const [syncJobStatuses, setSyncJobStatuses] = useState({});
  const syncPollRefs = useRef({});
  const syncNotificationIds = useRef({});
  const JOB_TYPE_PLAID_SYNC = 'plaid-sync';

  useEffect(() => {
    loadAccounts();
    loadPlaidItems();
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      Object.values(syncPollRefs.current).forEach(intervalId => {
        if (intervalId) clearInterval(intervalId);
      });
    };
  }, []);

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const response = await accountsAPI.getAll();
      setAccounts(response.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isCancelled = false;

    const loadBalances = async () => {
      if (accounts.length === 0) {
        if (!isCancelled) {
          setAccountBalances({});
        }
        return;
      }

      const results = await Promise.all(
        accounts.map(async (account) => {
          try {
            const response = await transactionsAPI.getBalance(account.id);
            const value = response.data?.balance ?? account.balance ?? 0;
            return [account.id, value];
          } catch (error) {
            console.error(`Error fetching balance for account ${account.id}:`, error);
            return [account.id, account.balance ?? 0];
          }
        })
      );

      if (!isCancelled) {
        setAccountBalances(Object.fromEntries(results));
      }
    };

    loadBalances();

    return () => {
      isCancelled = true;
    };
  }, [accounts]);

  const handleOpenDialog = (account = null) => {
    if (account) {
      setEditMode(true);
      setCurrentAccount(account);
      setFormData({
        account_type: account.account_type,
        account_number: account.account_number,
        institution: account.institution,
        balance: account.balance,
        label: account.label || ''
      });
    } else {
      setEditMode(false);
      setCurrentAccount(null);
      setFormData({
        account_type: 'investment',
        account_number: '',
        institution: '',
        balance: 0,
        label: ''
      });
    }
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditMode(false);
    setCurrentAccount(null);
    setFormData({
      account_type: 'investment',
      account_number: '',
      institution: '',
      balance: 0,
      label: ''
    });
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'balance' ? parseFloat(value) || 0 : value
    }));
  };

  const handleSubmit = async () => {
    setError('');
    setSuccess('');
    
    if (!formData.account_number || !formData.institution) {
      setError('Account number and institution are required');
      return;
    }

    setLoading(true);
    try {
      if (editMode && currentAccount) {
        await accountsAPI.update(currentAccount.id, formData);
        setSuccess('Account updated successfully');
      } else {
        await accountsAPI.create(formData);
        setSuccess('Account created successfully');
      }
      handleCloseDialog();
      loadAccounts();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save account');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (account) => {
    setCurrentAccount(account);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!currentAccount) return;

    setLoading(true);
    setError('');
    try {
      await accountsAPI.delete(currentAccount.id);
      setSuccess('Account deleted successfully');
      setDeleteDialogOpen(false);
      setCurrentAccount(null);
      loadAccounts();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete account');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setCurrentAccount(null);
  };

  // Plaid functions
  const loadPlaidItems = async () => {
    setPlaidLoading(true);
    try {
      const response = await plaidAPI.getItems();
      setPlaidItems(response.data);
    } catch (err) {
      console.error('Error loading Plaid items:', err);
      // Silently fail if Plaid is not configured
    } finally {
      setPlaidLoading(false);
    }
  };

  const handlePlaidSuccess = (data) => {
    setSuccess(`Successfully connected ${data.institution_name}! ${data.accounts.length} account(s) linked.`);
    loadAccounts();
    loadPlaidItems();
  };

  const handlePlaidError = (errorMessage) => {
    setError(errorMessage);
  };

  // Helper function to clear polling for a specific item
  const clearSyncPolling = (itemId) => {
    if (syncPollRefs.current[itemId]) {
      clearInterval(syncPollRefs.current[itemId]);
      syncPollRefs.current[itemId] = null;
    }
  };

  // Poll job status for a specific sync job
  const pollSyncJob = async (itemId, jobId, institutionName) => {
    try {
      const response = await plaidAPI.getSyncStatus(jobId);
      const data = response.data;

      setSyncJobStatuses(prev => ({ ...prev, [itemId]: data.status }));

      if (data.status === 'finished') {
        clearSyncPolling(itemId);
        const result = data.result || {};
        const message = `Synced ${institutionName}: ${result.added || 0} added, ${result.modified || 0} modified, ${result.removed || 0} removed`;

        const notifId = syncNotificationIds.current[itemId];
        if (notifId) {
          updateJobStatus(notifId, message, 'success', JOB_TYPE_PLAID_SYNC);
        }

        setSyncingItems(prev => ({ ...prev, [itemId]: false }));
        setSyncJobIds(prev => {
          const updated = { ...prev };
          delete updated[itemId];
          return updated;
        });

        await loadPlaidItems();
        await loadAccounts();
      } else if (data.status === 'failed') {
        clearSyncPolling(itemId);
        const errorMsg = data.error || 'Sync failed';
        const message = `Failed to sync ${institutionName}: ${errorMsg}`;

        const notifId = syncNotificationIds.current[itemId];
        if (notifId) {
          updateJobStatus(notifId, message, 'error', JOB_TYPE_PLAID_SYNC);
        }

        setSyncingItems(prev => ({ ...prev, [itemId]: false }));
        setSyncJobIds(prev => {
          const updated = { ...prev };
          delete updated[itemId];
          return updated;
        });
      }
      // If still queued or started, the polling will continue
    } catch (error) {
      console.error('Error polling sync job:', error);
      clearSyncPolling(itemId);
      setSyncingItems(prev => ({ ...prev, [itemId]: false }));
    }
  };

  const handleSync = async (itemId, institutionName) => {
    setSyncingItems(prev => ({ ...prev, [itemId]: true }));
    setError('');

    try {
      const response = await plaidAPI.syncTransactions(itemId);
      const jobId = response.data.job_id;

      setSyncJobIds(prev => ({ ...prev, [itemId]: jobId }));
      setSyncJobStatuses(prev => ({ ...prev, [itemId]: 'queued' }));

      // Show notification with job progress - appears in notification center
      const notifId = showJobProgress(
        `Syncing transactions from ${institutionName}...`,
        jobId,
        JOB_TYPE_PLAID_SYNC
      );
      syncNotificationIds.current[itemId] = notifId;

      // Start polling for job status every 4 seconds
      const pollInterval = setInterval(() => {
        pollSyncJob(itemId, jobId, institutionName);
      }, 4000);
      syncPollRefs.current[itemId] = pollInterval;

      // Do initial poll after 2 seconds
      setTimeout(() => pollSyncJob(itemId, jobId, institutionName), 2000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to start sync');
      setSyncingItems(prev => ({ ...prev, [itemId]: false }));
    }
  };

  const handleDisconnect = async (itemId, institutionName) => {
    if (!window.confirm(`Are you sure you want to disconnect ${institutionName}? This will not delete your accounts or transactions.`)) {
      return;
    }

    setPlaidLoading(true);
    setError('');

    try {
      await plaidAPI.disconnectItem(itemId);
      setSuccess(`${institutionName} disconnected successfully`);
      loadPlaidItems();
      loadAccounts();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to disconnect');
    } finally {
      setPlaidLoading(false);
    }
  };

  const getAccountTypeColor = (type) => {
    switch (type) {
      case 'investment':
        return 'primary';
      case 'checking':
        return 'success';
      case 'savings':
        return 'info';
      case 'credit_card':
        return 'warning';
      default:
        return 'default';
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(amount);
  };

  // Export configuration
  const accountExportColumns = [
    { field: 'label', header: 'Label' },
    { field: 'account_type', header: 'Type' },
    { field: 'institution', header: 'Institution' },
    { field: 'account_number', header: 'Account Number' },
    { field: 'balance', header: 'Balance', type: 'currency' }
  ];

  const accountExportData = accounts.map(account => ({
    ...account,
    label: account.label || '-',
    balance: accountBalances[account.id] ?? account.balance ?? 0
  }));

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">
          Account Management
        </Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => handleOpenDialog()}
        >
          Add Account
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      {/* Plaid Bank Connection Section */}
      {plaidItems.length > 0 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">
              Connected Banks via Plaid
            </Typography>
            <PlaidLinkButton
              onSuccess={handlePlaidSuccess}
              onError={handlePlaidError}
              buttonText="Connect Another Bank"
              variant="outlined"
            />
          </Box>
          <Divider sx={{ mb: 2 }} />
          {plaidItems.map((item) => (
            <Box key={item.id} sx={{ mb: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle1" fontWeight="medium">
                  {item.institution_name}
                </Typography>
                <Box>
                  <Button
                    size="small"
                    startIcon={syncingItems[item.id] ? <CircularProgress size={16} /> : <Sync />}
                    onClick={() => handleSync(item.id, item.institution_name)}
                    disabled={syncingItems[item.id]}
                    sx={{ mr: 1 }}
                  >
                    {syncingItems[item.id] ? 'Syncing...' : 'Sync Now'}
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    startIcon={<LinkOff />}
                    onClick={() => handleDisconnect(item.id, item.institution_name)}
                    disabled={plaidLoading}
                  >
                    Disconnect
                  </Button>
                </Box>
              </Box>
              <Typography variant="caption" color="text.secondary">
                Last synced: {item.last_synced ? new Date(item.last_synced).toLocaleString() : 'Never'}
              </Typography>
              <Box sx={{ mt: 1 }}>
                {item.accounts.map((acc) => (
                  <Chip
                    key={acc.id}
                    label={`${acc.name} (...${acc.mask || 'XXXX'})`}
                    size="small"
                    sx={{ mr: 1, mt: 0.5 }}
                  />
                ))}
              </Box>
            </Box>
          ))}
        </Paper>
      )}

      {/* Add Plaid Connect Button if no items connected */}
      {plaidItems.length === 0 && !plaidLoading && (
        <Paper sx={{ p: 3, mb: 3, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>
            Automatic Bank Sync with Plaid
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            Connect your bank accounts to automatically sync transactions
          </Typography>
          <PlaidLinkButton
            onSuccess={handlePlaidSuccess}
            onError={handlePlaidError}
          />
        </Paper>
      )}

      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <ExportButtons
            data={accountExportData}
            columns={accountExportColumns}
            filename="accounts"
            title="Accounts Report"
          />
        </Box>
        <TableContainer>
          <Table stickyHeader>
            <TableHead sx={stickyTableHeadSx}>
              <TableRow>
                <TableCell>Label</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Institution</TableCell>
                <TableCell>Account Number</TableCell>
                <TableCell align="right">Balance</TableCell>
                <TableCell align="center">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Box sx={{ py: 4 }}>
                      <AccountBalance sx={{ fontSize: 60, color: 'text.secondary', mb: 2 }} />
                      <Typography variant="body1" color="text.secondary">
                        No accounts found. Create your first account to get started.
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              ) : (
                accounts.map((account) => {
                  const derivedBalance = accountBalances[account.id] ?? account.balance ?? 0;
                  return (
                    <TableRow key={account.id}>
                      <TableCell>
                        <Typography variant="body1" fontWeight="medium">
                          {account.label || '-'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={account.account_type}
                          color={getAccountTypeColor(account.account_type)}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>{account.institution}</TableCell>
                      <TableCell>{account.account_number}</TableCell>
                      <TableCell align="right">{formatCurrency(derivedBalance)}</TableCell>
                      <TableCell align="center">
                        <IconButton
                          color="primary"
                          onClick={() => handleOpenDialog(account)}
                          size="small"
                        >
                          <Edit />
                        </IconButton>
                        <IconButton
                          color="error"
                          onClick={() => handleDeleteClick(account)}
                          size="small"
                        >
                          <Delete />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editMode ? 'Edit Account' : 'Create New Account'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
            <TextField
              label="Label"
              name="label"
              value={formData.label}
              onChange={handleInputChange}
              fullWidth
              helperText="Optional: Give your account a friendly name (e.g., 'My TFSA', 'RRSP Account')"
            />
            <TextField
              select
              label="Account Type"
              name="account_type"
              value={formData.account_type}
              onChange={handleInputChange}
              fullWidth
              required
            >
              <MenuItem value="investment">Investment</MenuItem>
              <MenuItem value="checking">Checking</MenuItem>
              <MenuItem value="savings">Savings</MenuItem>
              <MenuItem value="credit_card">Credit Card</MenuItem>
            </TextField>
            <TextField
              label="Institution"
              name="institution"
              value={formData.institution}
              onChange={handleInputChange}
              fullWidth
              required
            />
            <TextField
              label="Account Number"
              name="account_number"
              value={formData.account_number}
              onChange={handleInputChange}
              fullWidth
              required
            />
            <TextField
              label="Balance"
              name="balance"
              type="number"
              value={formData.balance}
              onChange={handleInputChange}
              fullWidth
              inputProps={{ step: '0.01' }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button onClick={handleSubmit} variant="contained" disabled={loading}>
            {editMode ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteDialogOpen} onClose={handleDeleteCancel}>
        <DialogTitle>Delete Account</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this account? This will also delete all associated positions, transactions, dividends, and expenses.
          </Typography>
          {currentAccount && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
              <Typography variant="body2">
                <strong>Label:</strong> {currentAccount.label || '-'}
              </Typography>
              <Typography variant="body2">
                <strong>Institution:</strong> {currentAccount.institution}
              </Typography>
              <Typography variant="body2">
                <strong>Account Number:</strong> {currentAccount.account_number}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained" disabled={loading}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default AccountManagement;
