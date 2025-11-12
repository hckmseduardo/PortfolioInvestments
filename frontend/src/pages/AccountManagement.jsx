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
import { Add, Edit, Delete, AccountBalance, Sync, LinkOff, AccountBalanceWallet, History } from '@mui/icons-material';
import { accountsAPI, transactionsAPI, plaidAPI } from '../services/api';
import { stickyTableHeadSx } from '../utils/tableStyles';
import ExportButtons from '../components/ExportButtons';
import PlaidLinkButton from '../components/PlaidLink';
import { useNotification } from '../context/NotificationContext';

const AccountManagement = () => {
  const { showJobProgress, updateJobStatus, clearJob, activeJobs } = useNotification();
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
  const [resyncDialogOpen, setResyncDialogOpen] = useState(false);
  const [resyncItem, setResyncItem] = useState(null);
  const [plaidDisconnectDialogOpen, setPlaidDisconnectDialogOpen] = useState(false);
  const [accountToDisconnect, setAccountToDisconnect] = useState(null);
  const [plaidItemInfo, setPlaidItemInfo] = useState(null);

  // Job tracking state
  const [syncJobIds, setSyncJobIds] = useState({});
  const [syncJobStatuses, setSyncJobStatuses] = useState({});
  const syncPollRefs = useRef({});
  const syncNotificationIds = useRef({});
  const JOB_TYPE_PLAID_SYNC = 'plaid-sync';

  useEffect(() => {
    loadAccounts();
    loadPlaidItems();

    // Clear any stale Plaid sync notifications on mount
    if (activeJobs && activeJobs[JOB_TYPE_PLAID_SYNC]) {
      clearJob(JOB_TYPE_PLAID_SYNC);
    }
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

      console.log(`[PLAID SYNC DEBUG] Job ${jobId} poll result:`);
      console.log(`  Status: ${data.status}`);
      console.log(`  Meta stage: ${data.meta?.stage}`);
      console.log(`  Meta progress:`, data.meta?.progress);
      console.log(`  Result:`, data.result);

      setSyncJobStatuses(prev => ({ ...prev, [itemId]: data.status }));

      // Check both status and meta.stage to detect completion
      const isFinished = data.status === 'finished' || data.meta?.stage === 'completed';
      const isFailed = data.status === 'failed' || data.meta?.stage === 'failed';

      console.log(`[PLAID SYNC DEBUG] isFinished: ${isFinished}, isFailed: ${isFailed}`);

      if (isFinished) {
        console.log(`[PLAID SYNC DEBUG] Job ${jobId} completed, stopping poll`);
        clearSyncPolling(itemId);
        const result = data.result || {};
        const message = `Synced ${institutionName}: ${result.added || 0} added, ${result.modified || 0} modified, ${result.removed || 0} removed`;

        console.log(`[PLAID SYNC DEBUG] Success message: ${message}`);

        const notifId = syncNotificationIds.current[itemId];
        console.log(`[PLAID SYNC DEBUG] Notification ID: ${notifId}`);

        if (notifId !== undefined && notifId !== null) {
          console.log(`[PLAID SYNC DEBUG] Calling updateJobStatus with notifId: ${notifId}`);
          updateJobStatus(notifId, message, 'success', JOB_TYPE_PLAID_SYNC);
        } else {
          console.warn(`[PLAID SYNC DEBUG] No notification ID found for itemId: ${itemId}`);
        }

        setSyncingItems(prev => ({ ...prev, [itemId]: false }));
        setSyncJobIds(prev => {
          const updated = { ...prev };
          delete updated[itemId];
          return updated;
        });

        console.log(`[PLAID SYNC DEBUG] Reloading Plaid items and accounts...`);
        await loadPlaidItems();
        await loadAccounts();
      } else if (isFailed) {
        console.log(`[PLAID SYNC DEBUG] Job ${jobId} failed, stopping poll`);
        clearSyncPolling(itemId);
        const errorMsg = data.error || 'Sync failed';
        const message = `Failed to sync ${institutionName}: ${errorMsg}`;

        const notifId = syncNotificationIds.current[itemId];
        if (notifId !== undefined && notifId !== null) {
          updateJobStatus(notifId, message, 'error', JOB_TYPE_PLAID_SYNC);
        }

        setSyncingItems(prev => ({ ...prev, [itemId]: false }));
        setSyncJobIds(prev => {
          const updated = { ...prev };
          delete updated[itemId];
          return updated;
        });
      } else {
        console.log(`[PLAID SYNC DEBUG] Job still running, continuing to poll...`);
      }
      // If still queued or started, the polling will continue
    } catch (error) {
      console.error('[PLAID SYNC DEBUG] Error polling sync job:', error);
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

  const handleFullResyncClick = (itemId, institutionName) => {
    setResyncItem({ id: itemId, name: institutionName });
    setResyncDialogOpen(true);
  };

  const handleFullResyncConfirm = async () => {
    if (!resyncItem) return;

    const { id: itemId, name: institutionName } = resyncItem;
    setResyncDialogOpen(false);
    setSyncingItems(prev => ({ ...prev, [itemId]: true }));
    setError('');

    try {
      const response = await plaidAPI.fullResync(itemId);
      const jobId = response.data.job_id;

      setSyncJobIds(prev => ({ ...prev, [itemId]: jobId }));
      setSyncJobStatuses(prev => ({ ...prev, [itemId]: 'queued' }));

      // Show notification with job progress
      const notifId = showJobProgress(
        `Full resync: importing all transaction history from ${institutionName}...`,
        jobId,
        JOB_TYPE_PLAID_SYNC
      );
      syncNotificationIds.current[itemId] = notifId;

      // Start polling for job status
      const pollInterval = setInterval(() => {
        pollSyncJob(itemId, jobId, institutionName);
      }, 4000);
      syncPollRefs.current[itemId] = pollInterval;

      // Do initial poll after 2 seconds
      setTimeout(() => pollSyncJob(itemId, jobId, institutionName), 2000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to start full resync');
      setSyncingItems(prev => ({ ...prev, [itemId]: false }));
    } finally {
      setResyncItem(null);
    }
  };

  const handleFullResyncCancel = () => {
    setResyncDialogOpen(false);
    setResyncItem(null);
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

  const handleAccountPlaidDisconnectClick = async (account) => {
    if (!account.is_plaid_linked) return;

    setAccountToDisconnect(account);
    setPlaidLoading(true);
    setError('');

    try {
      // Fetch Plaid item info to see all affected accounts
      const response = await accountsAPI.getAccountPlaidItem(account.id);
      setPlaidItemInfo(response.data);
      setPlaidDisconnectDialogOpen(true);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to fetch Plaid item details');
    } finally {
      setPlaidLoading(false);
    }
  };

  const handlePlaidDisconnectConfirm = async () => {
    if (!plaidItemInfo) return;

    setPlaidDisconnectDialogOpen(false);
    setPlaidLoading(true);
    setError('');

    try {
      await plaidAPI.disconnectItem(plaidItemInfo.item_id);
      setSuccess(`${plaidItemInfo.institution_name} disconnected successfully`);
      loadPlaidItems();
      loadAccounts();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to disconnect');
    } finally {
      setPlaidLoading(false);
      setAccountToDisconnect(null);
      setPlaidItemInfo(null);
    }
  };

  const handlePlaidDisconnectCancel = () => {
    setPlaidDisconnectDialogOpen(false);
    setAccountToDisconnect(null);
    setPlaidItemInfo(null);
  };

  const getAccountTypeColor = (type) => {
    // Depository accounts - green/success shades
    if (['checking', 'savings', 'money_market', 'cd', 'cash_management', 'prepaid', 'hsa', 'ebt'].includes(type)) {
      return 'success';
    }
    // Credit accounts - warning (orange/yellow)
    if (type === 'credit_card') {
      return 'warning';
    }
    // Loan accounts - error (red)
    if (['mortgage', 'auto_loan', 'student_loan', 'home_equity', 'personal_loan', 'business_loan', 'line_of_credit'].includes(type)) {
      return 'error';
    }
    // Investment & Retirement accounts - primary (blue)
    if (['investment', 'brokerage', '401k', '403b', '457b', '529', 'ira', 'roth_ira', 'sep_ira', 'simple_ira', 'pension', 'stock_plan', 'tfsa', 'rrsp', 'rrif', 'resp', 'rdsp', 'lira'].includes(type)) {
      return 'primary';
    }
    // Specialized accounts - secondary (purple)
    if (['crypto', 'mutual_fund', 'annuity', 'life_insurance', 'trust'].includes(type)) {
      return 'secondary';
    }
    // Default
    return 'default';
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
        <Box sx={{ display: 'flex', gap: 2 }}>
          <PlaidLinkButton
            onSuccess={handlePlaidSuccess}
            onError={handlePlaidError}
            buttonText="Connect Another Bank"
            variant="outlined"
          />
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => handleOpenDialog()}
          >
            Add Account
          </Button>
        </Box>
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

      {/* Plaid Bank Connection Section - Moved to main grid */}

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
                <TableCell align="center">Plaid</TableCell>
                <TableCell align="center">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center">
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
                        {account.is_plaid_linked && (
                          <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center', alignItems: 'center' }}>
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => handleSync(account.plaid_item_id, account.plaid_institution_name)}
                              disabled={syncingItems[account.plaid_item_id]}
                              title="Sync Now"
                            >
                              {syncingItems[account.plaid_item_id] ? <CircularProgress size={16} /> : <Sync />}
                            </IconButton>
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => handleFullResyncClick(account.plaid_item_id, account.plaid_institution_name)}
                              disabled={syncingItems[account.plaid_item_id]}
                              title="Full Resync - Import All History"
                            >
                              <History />
                            </IconButton>
                          </Box>
                        )}
                      </TableCell>
                      <TableCell align="center">
                        <IconButton
                          color="primary"
                          onClick={() => handleOpenDialog(account)}
                          size="small"
                        >
                          <Edit />
                        </IconButton>
                        {account.is_plaid_linked && (
                          <IconButton
                            color="warning"
                            onClick={() => handleAccountPlaidDisconnectClick(account)}
                            size="small"
                            title="Disconnect from Plaid"
                          >
                            <LinkOff />
                          </IconButton>
                        )}
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
              <MenuItem value="checking">Checking</MenuItem>
              <MenuItem value="savings">Savings</MenuItem>
              <MenuItem value="money_market">Money Market</MenuItem>
              <MenuItem value="cd">Certificate of Deposit (CD)</MenuItem>
              <MenuItem value="cash_management">Cash Management</MenuItem>
              <MenuItem value="prepaid">Prepaid</MenuItem>
              <MenuItem value="hsa">Health Savings Account (HSA)</MenuItem>
              <MenuItem value="credit_card">Credit Card</MenuItem>
              <MenuItem value="mortgage">Mortgage</MenuItem>
              <MenuItem value="auto_loan">Auto Loan</MenuItem>
              <MenuItem value="student_loan">Student Loan</MenuItem>
              <MenuItem value="home_equity">Home Equity</MenuItem>
              <MenuItem value="personal_loan">Personal Loan</MenuItem>
              <MenuItem value="business_loan">Business Loan</MenuItem>
              <MenuItem value="line_of_credit">Line of Credit</MenuItem>
              <MenuItem value="investment">Investment/Brokerage</MenuItem>
              <MenuItem value="401k">401(k)</MenuItem>
              <MenuItem value="403b">403(b)</MenuItem>
              <MenuItem value="457b">457(b)</MenuItem>
              <MenuItem value="529">529 Plan</MenuItem>
              <MenuItem value="ira">IRA</MenuItem>
              <MenuItem value="roth_ira">Roth IRA</MenuItem>
              <MenuItem value="sep_ira">SEP IRA</MenuItem>
              <MenuItem value="simple_ira">SIMPLE IRA</MenuItem>
              <MenuItem value="pension">Pension</MenuItem>
              <MenuItem value="tfsa">TFSA (Canadian)</MenuItem>
              <MenuItem value="rrsp">RRSP (Canadian)</MenuItem>
              <MenuItem value="rrif">RRIF (Canadian)</MenuItem>
              <MenuItem value="resp">RESP (Canadian)</MenuItem>
              <MenuItem value="crypto">Cryptocurrency</MenuItem>
              <MenuItem value="other">Other</MenuItem>
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

      <Dialog open={resyncDialogOpen} onClose={handleFullResyncCancel}>
        <DialogTitle>Full Resync - Import All Transaction History</DialogTitle>
        <DialogContent>
          <Typography paragraph>
            This will reimport all available transaction history from Plaid for{' '}
            <strong>{resyncItem?.name}</strong>.
          </Typography>
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2" fontWeight="medium" gutterBottom>
              Important Notes:
            </Typography>
            <Typography variant="body2" component="div">
              • This will delete the sync cursor and fetch all transactions from the beginning
              <br />
              • Plaid typically provides 2+ years of transaction history
              <br />
              • This may take longer than a regular sync
              <br />
              • Duplicate transactions will be handled automatically
            </Typography>
          </Alert>
          <Typography variant="body2" color="text.secondary">
            Are you sure you want to proceed with a full resync?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleFullResyncCancel}>Cancel</Button>
          <Button onClick={handleFullResyncConfirm} variant="contained" color="primary">
            Start Full Resync
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={plaidDisconnectDialogOpen} onClose={handlePlaidDisconnectCancel} maxWidth="sm" fullWidth>
        <DialogTitle>Disconnect from Plaid</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2" fontWeight="medium" gutterBottom>
              Important: Plaid connection is at the institution level
            </Typography>
            <Typography variant="body2">
              Plaid manages connections per financial institution, not per individual account.
              Disconnecting will affect ALL accounts linked to this institution.
            </Typography>
          </Alert>

          {plaidItemInfo && (
            <>
              <Typography paragraph>
                You are about to disconnect from <strong>{plaidItemInfo.institution_name}</strong>.
              </Typography>

              <Typography variant="body2" fontWeight="medium" gutterBottom>
                The following accounts will be disconnected:
              </Typography>

              <Box sx={{ mt: 2, mb: 2 }}>
                {plaidItemInfo.linked_accounts.map((acc) => (
                  <Box
                    key={acc.id}
                    sx={{
                      p: 2,
                      mb: 1,
                      bgcolor: 'grey.50',
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: acc.id === accountToDisconnect?.id ? 'primary.main' : 'grey.300'
                    }}
                  >
                    <Typography variant="body2">
                      <strong>{acc.label || acc.account_type}</strong>
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {acc.institution} - ...{acc.account_number.slice(-4)} - Balance: {formatCurrency(acc.balance)}
                    </Typography>
                  </Box>
                ))}
              </Box>

              <Alert severity="info" sx={{ mt: 2 }}>
                <Typography variant="body2">
                  Note: Your accounts and transaction history will NOT be deleted.
                  Only the automatic sync connection will be removed.
                </Typography>
              </Alert>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handlePlaidDisconnectCancel}>Cancel</Button>
          <Button onClick={handlePlaidDisconnectConfirm} variant="contained" color="error">
            Disconnect All {plaidItemInfo?.linked_accounts.length || 0} Account(s)
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default AccountManagement;
