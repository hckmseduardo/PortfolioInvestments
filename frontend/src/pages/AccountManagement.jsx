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
  Divider,
  TableSortLabel,
  Tooltip,
  Menu,
  ListItemIcon,
  ListItemText
} from '@mui/material';
import { Add, Edit, Delete, AccountBalance, Sync, LinkOff, AccountBalanceWallet, History, FilterList, MoreVert, DeleteSweep, VpnKey, Replay, Error as ErrorIcon, Link as LinkIcon } from '@mui/icons-material';
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

  // Action menu state
  const [actionMenuAnchor, setActionMenuAnchor] = useState(null);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [deletePlaidDialogOpen, setDeletePlaidDialogOpen] = useState(false);
  const [deletingPlaidTransactions, setDeletingPlaidTransactions] = useState(false);

  // Job tracking state
  const [syncJobIds, setSyncJobIds] = useState({});
  const [syncJobStatuses, setSyncJobStatuses] = useState({});
  const syncPollRefs = useRef({});
  const syncNotificationIds = useRef({});
  const JOB_TYPE_PLAID_SYNC = 'plaid-sync';

  // Delete Plaid transactions job tracking
  const [deleteJobId, setDeleteJobId] = useState(null);
  const [deleteJobStatus, setDeleteJobStatus] = useState(null);
  const deletePollRef = useRef(null);
  const deleteNotificationIdRef = useRef(null);
  const JOB_TYPE_DELETE_PLAID = 'delete-plaid-transactions';

  // Sorting and filtering state
  const [orderBy, setOrderBy] = useState('label');
  const [order, setOrder] = useState('asc');
  const [filterValues, setFilterValues] = useState({
    label: '',
    account_type: '',
    institution: '',
    account_number: ''
  });

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
      clearDeletePolling();
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

  // Helper function to clear polling for delete job
  const clearDeletePolling = () => {
    if (deletePollRef.current) {
      clearInterval(deletePollRef.current);
      deletePollRef.current = null;
    }
  };

  // Poll job status for delete Plaid transactions job
  const pollDeleteJob = async (jobId, accountLabel) => {
    try {
      console.log(`[DELETE PLAID DEBUG] Polling job ${jobId}...`);
      const response = await plaidAPI.getSyncStatus(jobId);
      const data = response.data;

      console.log(`[DELETE PLAID DEBUG] Job ${jobId} poll result:`);
      console.log(`  Status: ${data.status}`);
      console.log(`  Meta stage: ${data.meta?.stage}`);
      console.log(`  Meta progress:`, data.meta?.progress);
      console.log(`  Result:`, data.result);

      setDeleteJobStatus(data.status);

      // Check both status and meta.stage to detect completion
      const isFinished = data.status === 'finished' || data.meta?.stage === 'completed';
      const isFailed = data.status === 'failed' || data.meta?.stage === 'failed';

      console.log(`[DELETE PLAID DEBUG] isFinished: ${isFinished}, isFailed: ${isFailed}`);

      if (isFinished) {
        console.log(`[DELETE PLAID DEBUG] Job ${jobId} completed, stopping poll`);
        clearDeletePolling();
        const result = data.result || {};
        const newBalance = result.new_balance != null ? formatCurrency(result.new_balance) : 'N/A';
        const message = `Successfully removed ${result.transactions_deleted || 0} transactions. New balance: ${newBalance}`;

        console.log(`[DELETE PLAID DEBUG] Success message: ${message}`);

        const notifId = deleteNotificationIdRef.current;
        console.log(`[DELETE PLAID DEBUG] Notification ID: ${notifId}`);

        if (notifId !== undefined && notifId !== null) {
          console.log(`[DELETE PLAID DEBUG] Calling updateJobStatus with notifId: ${notifId}`);
          updateJobStatus(notifId, message, 'success', JOB_TYPE_DELETE_PLAID);
        } else {
          console.warn(`[DELETE PLAID DEBUG] No notification ID found`);
        }

        setDeletingPlaidTransactions(false);
        setDeleteJobId(null);

        console.log(`[DELETE PLAID DEBUG] Reloading accounts...`);
        await loadAccounts();
      } else if (isFailed) {
        console.log(`[DELETE PLAID DEBUG] Job ${jobId} failed, stopping poll`);
        clearDeletePolling();
        const errorMsg = data.error || 'Delete failed';
        const message = `Failed to delete Plaid transactions: ${errorMsg}`;

        const notifId = deleteNotificationIdRef.current;
        if (notifId !== undefined && notifId !== null) {
          updateJobStatus(notifId, message, 'error', JOB_TYPE_DELETE_PLAID);
        }

        setDeletingPlaidTransactions(false);
        setDeleteJobId(null);
        setError(message);
      } else {
        console.log(`[DELETE PLAID DEBUG] Job still running, continuing to poll...`);
      }
    } catch (error) {
      console.error('[DELETE PLAID DEBUG] Error polling delete job:', error);
      clearDeletePolling();
      setDeletingPlaidTransactions(false);
      setDeleteJobId(null);
      setError('Error checking delete job status');
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

  const handleReplaySync = async () => {
    handleActionMenuClose();
    if (!selectedAccount || !selectedAccount.plaid_item_id) return;

    const itemId = selectedAccount.plaid_item_id;
    const institutionName = selectedAccount.plaid_institution_name;

    setSyncingItems(prev => ({ ...prev, [itemId]: true }));
    setError('');

    try {
      const response = await plaidAPI.replaySync(itemId);
      const jobId = response.data.job_id;

      setSyncJobIds(prev => ({ ...prev, [itemId]: jobId }));
      setSyncJobStatuses(prev => ({ ...prev, [itemId]: 'queued' }));

      // Show notification with job progress
      const notifId = showJobProgress(
        `Replaying sync from saved data for ${institutionName}...`,
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
      setError(err.response?.data?.detail || 'Failed to start replay sync. Make sure debug mode was enabled during the original sync.');
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

  // Action menu handlers
  const handleActionMenuOpen = (event, account) => {
    setActionMenuAnchor(event.currentTarget);
    setSelectedAccount(account);
  };

  const handleActionMenuClose = () => {
    setActionMenuAnchor(null);
    setSelectedAccount(null);
  };

  const handleEditFromMenu = () => {
    handleActionMenuClose();
    handleOpenDialog(selectedAccount);
  };

  const handleDisconnectFromMenu = () => {
    handleActionMenuClose();
    if (selectedAccount) {
      handleAccountPlaidDisconnectClick(selectedAccount);
    }
  };

  const handleDeleteFromMenu = () => {
    handleActionMenuClose();
    if (selectedAccount) {
      handleDeleteClick(selectedAccount);
    }
  };

  const handleUpdatePermissions = async () => {
    handleActionMenuClose();
    if (!selectedAccount || !selectedAccount.plaid_item_id) return;

    setPlaidLoading(true);
    setError('');

    try {
      // Get update link token from backend
      const response = await plaidAPI.createUpdateLinkToken(selectedAccount.plaid_item_id);
      const { link_token } = response.data;

      // Open Plaid Link in update mode
      const plaidHandler = window.Plaid.create({
        token: link_token,
        onSuccess: async (public_token, metadata) => {
          // No need to exchange token - same Item, just updated permissions
          setSuccess(`Permissions updated successfully for ${selectedAccount.institution}! Running sync...`);

          // Trigger a sync to fetch investment transactions
          try {
            await plaidAPI.syncTransactions(selectedAccount.plaid_item_id);
            setSuccess(`Permissions updated and sync started for ${selectedAccount.institution}`);
          } catch (syncErr) {
            setError('Permissions updated but sync failed to start. Please try manual sync.');
          }

          loadPlaidItems();
          loadAccounts();
        },
        onExit: (err, metadata) => {
          if (err != null) {
            setError(`Failed to update permissions: ${err.error_message}`);
          }
          setPlaidLoading(false);
        },
      });

      plaidHandler.open();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create update link token');
      setPlaidLoading(false);
    }
  };

  const handleEnableInvestments = async () => {
    handleActionMenuClose();
    if (!selectedAccount || !selectedAccount.plaid_item_id) return;

    const plaidItem = plaidItems.find(item => item.id === selectedAccount.plaid_item_id);
    if (!plaidItem) {
      setError('Could not find Plaid connection details');
      return;
    }

    if (!plaidItem.supports_investments) {
      setError(`${plaidItem.institution_name} does not support investment tracking via Plaid`);
      return;
    }

    if (plaidItem.investments_enabled) {
      setError('Investment tracking is already enabled for this connection');
      return;
    }

    setPlaidLoading(true);
    setError('');

    try {
      // Get update mode link token from backend
      const response = await plaidAPI.createUpdateLinkToken(selectedAccount.plaid_item_id);
      const { link_token } = response.data;

      // Open Plaid Link in update mode to add investments product
      const plaidHandler = window.Plaid.create({
        token: link_token,
        onSuccess: async (public_token, metadata) => {
          setSuccess(`Investment tracking enabled for ${plaidItem.institution_name}! Syncing holdings...`);

          try {
            // Mark investments as enabled
            await plaidAPI.enableInvestments(selectedAccount.plaid_item_id);

            // Trigger sync to fetch investment holdings
            await plaidAPI.syncTransactions(selectedAccount.plaid_item_id);
            setSuccess(`Investment tracking enabled and sync started for ${plaidItem.institution_name}`);
          } catch (err) {
            setError('Investment tracking enabled but sync failed. Please try manual sync.');
          }

          loadPlaidItems();
          loadAccounts();
        },
        onExit: (err, metadata) => {
          if (err != null) {
            setError(`Failed to enable investment tracking: ${err.error_message}`);
          }
          setPlaidLoading(false);
        },
      });

      plaidHandler.open();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to enable investment tracking');
      setPlaidLoading(false);
    }
  };

  const handleDeletePlaidTransactionsClick = () => {
    // Close menu but keep selectedAccount for the dialog
    setActionMenuAnchor(null);
    setDeletePlaidDialogOpen(true);
  };

  const handleDeletePlaidTransactionsConfirm = async () => {
    if (!selectedAccount) {
      return;
    }

    setDeletingPlaidTransactions(true);
    setError('');

    try {
      const accountLabel = selectedAccount.label || selectedAccount.account_number;
      const response = await accountsAPI.deletePlaidTransactions(selectedAccount.id);
      const jobId = response.data.job_id;

      console.log(`[DELETE PLAID] Starting delete job ${jobId} for account ${accountLabel}`);

      // Close dialog
      setDeletePlaidDialogOpen(false);
      setSelectedAccount(null);
      setDeleteJobId(jobId);
      setDeleteJobStatus('queued');

      // Show notification with job progress - appears in notification center
      const notifId = showJobProgress(
        `Removing Plaid transactions from ${accountLabel}...`,
        jobId,
        JOB_TYPE_DELETE_PLAID
      );
      deleteNotificationIdRef.current = notifId;

      console.log(`[DELETE PLAID] Created notification ${notifId} for job ${jobId}`);

      // Start polling for job status every 4 seconds
      const pollInterval = setInterval(() => {
        pollDeleteJob(jobId, accountLabel);
      }, 4000);
      deletePollRef.current = pollInterval;

      // Do initial poll after 2 seconds
      setTimeout(() => pollDeleteJob(jobId, accountLabel), 2000);
    } catch (err) {
      console.error('[DELETE PLAID] Error:', err);
      setError(err.response?.data?.detail || 'Failed to start delete job');
      setDeletingPlaidTransactions(false);
    }
  };

  const handleDeletePlaidTransactionsCancel = () => {
    setDeletePlaidDialogOpen(false);
    setSelectedAccount(null);
  };

  const handleRelink = async () => {
    handleActionMenuClose();
    if (!selectedAccount || !selectedAccount.plaid_item_id) return;

    const itemId = selectedAccount.plaid_item_id;
    const institutionName = selectedAccount.plaid_institution_name;

    console.log('[RELINK] Starting relink for:', institutionName, 'Item ID:', itemId);

    setPlaidLoading(true);
    setError('');

    try {
      // Get update mode link token from backend
      console.log('[RELINK] Requesting update link token...');
      const response = await plaidAPI.createUpdateLinkToken(itemId);
      const { link_token } = response.data;
      console.log('[RELINK] Got link token, opening Plaid Link...');

      // Open Plaid Link in update mode to relink
      const plaidHandler = window.Plaid.create({
        token: link_token,
        onSuccess: async (public_token, metadata) => {
          console.log('[RELINK] Plaid Link success, calling relink endpoint...');
          try {
            // Call relink endpoint to clear error status
            await plaidAPI.relink(itemId);
            console.log('[RELINK] Relink successful!');
            setSuccess(`Successfully relinked ${institutionName}! The connection is now active.`);

            // Reload data to show updated status
            loadPlaidItems();
            loadAccounts();
          } catch (relinkErr) {
            console.error('[RELINK] Error calling relink endpoint:', relinkErr);
            setError(`Relink completed but failed to update status: ${relinkErr.response?.data?.detail || relinkErr.message}`);
          }
          setPlaidLoading(false);
        },
        onExit: (err, metadata) => {
          console.log('[RELINK] Plaid Link exited', err ? `with error: ${err.error_message}` : 'by user');
          if (err != null) {
            // Provide helpful message with alternative solution
            setError(
              `Failed to relink: ${err.error_message || 'Connection error'}. ` +
              `Try disconnecting this account (via Actions menu → Disconnect from Plaid) and then linking it again.`
            );
          }
          setPlaidLoading(false);
        },
      });

      plaidHandler.open();
    } catch (err) {
      console.error('[RELINK] Error during relink:', err);
      setError(err.response?.data?.detail || err.message || 'Failed to create relink token');
      setPlaidLoading(false);
    }
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

  // Sorting and filtering functions
  const handleRequestSort = (property) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const handleFilterChange = (column, value) => {
    setFilterValues(prev => ({
      ...prev,
      [column]: value
    }));
  };

  const getComparator = (order, orderBy) => {
    return order === 'desc'
      ? (a, b) => descendingComparator(a, b, orderBy)
      : (a, b) => -descendingComparator(a, b, orderBy);
  };

  const descendingComparator = (a, b, orderBy) => {
    let aVal = a[orderBy];
    let bVal = b[orderBy];

    // Special handling for balance (use derived balance)
    if (orderBy === 'balance') {
      aVal = accountBalances[a.id] ?? a.balance ?? 0;
      bVal = accountBalances[b.id] ?? b.balance ?? 0;
    }

    // Convert to lowercase for string comparison
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();

    if (bVal < aVal) return -1;
    if (bVal > aVal) return 1;
    return 0;
  };

  const applyFiltersAndSort = (accountsList) => {
    // Apply filters
    let filtered = accountsList.filter(account => {
      return Object.keys(filterValues).every(key => {
        const filterValue = filterValues[key].toLowerCase();
        if (!filterValue) return true;

        const accountValue = (account[key] || '').toString().toLowerCase();
        return accountValue.includes(filterValue);
      });
    });

    // Apply sorting
    const comparator = getComparator(order, orderBy);
    return filtered.sort(comparator);
  };

  const formatLastSyncTime = (lastSynced) => {
    if (!lastSynced) return 'Never synced';

    const date = new Date(lastSynced);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
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
              {/* Header row with sort labels */}
              <TableRow>
                <TableCell sortDirection={orderBy === 'label' ? order : false}>
                  <TableSortLabel
                    active={orderBy === 'label'}
                    direction={orderBy === 'label' ? order : 'asc'}
                    onClick={() => handleRequestSort('label')}
                  >
                    Label
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={orderBy === 'account_type' ? order : false}>
                  <TableSortLabel
                    active={orderBy === 'account_type'}
                    direction={orderBy === 'account_type' ? order : 'asc'}
                    onClick={() => handleRequestSort('account_type')}
                  >
                    Type
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={orderBy === 'institution' ? order : false}>
                  <TableSortLabel
                    active={orderBy === 'institution'}
                    direction={orderBy === 'institution' ? order : 'asc'}
                    onClick={() => handleRequestSort('institution')}
                  >
                    Institution
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={orderBy === 'account_number' ? order : false}>
                  <TableSortLabel
                    active={orderBy === 'account_number'}
                    direction={orderBy === 'account_number' ? order : 'asc'}
                    onClick={() => handleRequestSort('account_number')}
                  >
                    Account Number
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right" sortDirection={orderBy === 'balance' ? order : false}>
                  <TableSortLabel
                    active={orderBy === 'balance'}
                    direction={orderBy === 'balance' ? order : 'asc'}
                    onClick={() => handleRequestSort('balance')}
                  >
                    Balance
                  </TableSortLabel>
                </TableCell>
                <TableCell align="center">Plaid</TableCell>
                <TableCell align="center">Actions</TableCell>
              </TableRow>
              {/* Filter row */}
              <TableRow>
                <TableCell>
                  <TextField
                    size="small"
                    placeholder="Filter..."
                    value={filterValues.label}
                    onChange={(e) => handleFilterChange('label', e.target.value)}
                    InputProps={{
                      startAdornment: <FilterList fontSize="small" sx={{ mr: 0.5, color: 'text.secondary' }} />
                    }}
                    fullWidth
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    placeholder="Filter..."
                    value={filterValues.account_type}
                    onChange={(e) => handleFilterChange('account_type', e.target.value)}
                    InputProps={{
                      startAdornment: <FilterList fontSize="small" sx={{ mr: 0.5, color: 'text.secondary' }} />
                    }}
                    fullWidth
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    placeholder="Filter..."
                    value={filterValues.institution}
                    onChange={(e) => handleFilterChange('institution', e.target.value)}
                    InputProps={{
                      startAdornment: <FilterList fontSize="small" sx={{ mr: 0.5, color: 'text.secondary' }} />
                    }}
                    fullWidth
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    placeholder="Filter..."
                    value={filterValues.account_number}
                    onChange={(e) => handleFilterChange('account_number', e.target.value)}
                    InputProps={{
                      startAdornment: <FilterList fontSize="small" sx={{ mr: 0.5, color: 'text.secondary' }} />
                    }}
                    fullWidth
                  />
                </TableCell>
                <TableCell />
                <TableCell />
                <TableCell />
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
                applyFiltersAndSort(accounts).map((account) => {
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
                        {account.is_plaid_linked && (() => {
                          const plaidItem = plaidItems.find(item => item.id === account.plaid_item_id);
                          const supportsInvestments = plaidItem?.supports_investments;
                          const investmentsEnabled = plaidItem?.investments_enabled;
                          const hasError = plaidItem?.status === 'login_required' || plaidItem?.status === 'error';

                          return (
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'center' }}>
                              {hasError ? (
                                // Show error state with relink option
                                <Tooltip
                                  title={
                                    <Box>
                                      <Typography variant="caption" display="block" color="error.light">
                                        Connection Error: {plaidItem?.error_message || 'Please relink your account'}
                                      </Typography>
                                    </Box>
                                  }
                                  arrow
                                >
                                  <Chip
                                    icon={<ErrorIcon />}
                                    label="Needs Relink"
                                    color="error"
                                    size="small"
                                    variant="outlined"
                                  />
                                </Tooltip>
                              ) : (
                                // Show normal sync buttons
                                <Tooltip
                                  title={
                                    <Box>
                                      <Typography variant="caption" display="block">
                                        Last Sync: {formatLastSyncTime(plaidItem?.last_synced)}
                                      </Typography>
                                      {supportsInvestments && (
                                        <Typography variant="caption" display="block">
                                          {investmentsEnabled ? '✓ Investment Tracking Enabled' : '○ Investment Tracking Available'}
                                        </Typography>
                                      )}
                                    </Box>
                                  }
                                  arrow
                                >
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
                                </Tooltip>
                              )}
                              {/* Investment Tracking Status Badge */}
                              {!hasError && supportsInvestments && (
                                <Chip
                                  label={investmentsEnabled ? "Investments" : "Inv. Available"}
                                  color={investmentsEnabled ? "success" : "default"}
                                  size="small"
                                  variant={investmentsEnabled ? "filled" : "outlined"}
                                  sx={{ fontSize: '0.7rem', height: '18px' }}
                                />
                              )}
                            </Box>
                          );
                        })()}
                      </TableCell>
                      <TableCell align="center">
                        <Tooltip title="Actions">
                          <IconButton
                            onClick={(e) => handleActionMenuOpen(e, account)}
                            size="small"
                          >
                            <MoreVert />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Action Menu */}
      <Menu
        anchorEl={actionMenuAnchor}
        open={Boolean(actionMenuAnchor)}
        onClose={handleActionMenuClose}
        PaperProps={{
          elevation: 3,
          sx: { width: 320 }
        }}
      >
        {/* Show Relink option first if account has error */}
        {selectedAccount?.is_plaid_linked && (() => {
          const plaidItem = plaidItems.find(item => item.id === selectedAccount.plaid_item_id);
          const hasError = plaidItem?.status === 'login_required' || plaidItem?.status === 'error';

          if (hasError) {
            return (
              <>
                <MenuItem onClick={handleRelink}>
                  <ListItemIcon>
                    <LinkIcon fontSize="small" color="error" />
                  </ListItemIcon>
                  <ListItemText
                    primary="Relink Account"
                    secondary="Reconnect with your bank. If this fails, try Disconnect from Plaid instead."
                    primaryTypographyProps={{ color: 'error' }}
                  />
                </MenuItem>
                <Divider />
              </>
            );
          }
          return null;
        })()}

        <MenuItem onClick={handleEditFromMenu}>
          <ListItemIcon>
            <Edit fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="Edit Account"
            secondary="Update account details and settings"
          />
        </MenuItem>

        {selectedAccount?.is_plaid_linked && (() => {
          const plaidItem = plaidItems.find(item => item.id === selectedAccount.plaid_item_id);
          const supportsInvestments = plaidItem?.supports_investments;
          const investmentsEnabled = plaidItem?.investments_enabled;

          // Debug logging
          console.log('Selected Account:', selectedAccount.label, selectedAccount.plaid_item_id);
          console.log('Found Plaid Item:', plaidItem);
          console.log('All Plaid Items:', plaidItems);
          console.log('Supports Investments:', supportsInvestments, 'Enabled:', investmentsEnabled);

          // Show "Enable Investment Tracking" if supported but not enabled
          if (supportsInvestments && !investmentsEnabled) {
            return (
              <MenuItem onClick={handleEnableInvestments}>
                <ListItemIcon>
                  <AccountBalanceWallet fontSize="small" color="success" />
                </ListItemIcon>
                <ListItemText
                  primary="Enable Investment Tracking"
                  secondary="Add access to holdings and investment transactions"
                />
              </MenuItem>
            );
          }

          // Otherwise show generic "Update Permissions"
          return (
            <MenuItem onClick={handleUpdatePermissions}>
              <ListItemIcon>
                <VpnKey fontSize="small" color="primary" />
              </ListItemIcon>
              <ListItemText
                primary="Update Permissions"
                secondary="Modify connection settings"
              />
            </MenuItem>
          );
        })()}

        {selectedAccount?.is_plaid_linked && (
          <MenuItem onClick={handleReplaySync}>
            <ListItemIcon>
              <Replay fontSize="small" color="secondary" />
            </ListItemIcon>
            <ListItemText
              primary="Replay Last Sync"
              secondary="Reprocess saved sync data without calling Plaid API"
            />
          </MenuItem>
        )}

        {selectedAccount?.is_plaid_linked && (
          <MenuItem onClick={handleDeletePlaidTransactionsClick}>
            <ListItemIcon>
              <DeleteSweep fontSize="small" color="warning" />
            </ListItemIcon>
            <ListItemText
              primary="Delete Plaid Transactions"
              secondary="Remove all Plaid-synced transactions. Statement imports will be preserved."
            />
          </MenuItem>
        )}

        {selectedAccount?.is_plaid_linked && (
          <MenuItem onClick={handleDisconnectFromMenu}>
            <ListItemIcon>
              <LinkOff fontSize="small" color="warning" />
            </ListItemIcon>
            <ListItemText
              primary="Disconnect from Plaid"
              secondary="Stop automatic sync. Transaction history will not be deleted."
            />
          </MenuItem>
        )}

        <Divider />

        <MenuItem onClick={handleDeleteFromMenu}>
          <ListItemIcon>
            <Delete fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText
            primary="Delete Account"
            secondary="Permanently delete this account and all its data"
          />
        </MenuItem>
      </Menu>

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

      <Dialog open={deletePlaidDialogOpen} onClose={handleDeletePlaidTransactionsCancel} maxWidth="sm" fullWidth>
        <DialogTitle>Delete Plaid Transactions</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2" fontWeight="medium" gutterBottom>
              This action will delete all Plaid-synced transactions
            </Typography>
            <Typography variant="body2">
              This removes all transactions that were automatically imported via Plaid sync.
              Statement-imported transactions will be preserved.
            </Typography>
          </Alert>

          {selectedAccount && (
            <>
              <Typography paragraph>
                You are about to delete all Plaid transactions for:
              </Typography>
              <Box sx={{ p: 2, bgcolor: 'grey.100', borderRadius: 1, mb: 2 }}>
                <Typography variant="body2">
                  <strong>Label:</strong> {selectedAccount.label || '-'}
                </Typography>
                <Typography variant="body2">
                  <strong>Institution:</strong> {selectedAccount.institution}
                </Typography>
                <Typography variant="body2">
                  <strong>Account Number:</strong> {selectedAccount.account_number}
                </Typography>
              </Box>

              <Alert severity="info">
                <Typography variant="body2">
                  <strong>What will be deleted:</strong>
                </Typography>
                <Typography variant="body2" component="div">
                  • All transactions with Plaid sync data
                  <br />
                  • Associated expense records
                  <br />
                  • Positions will be recalculated from remaining transactions
                </Typography>
              </Alert>

              <Alert severity="success" sx={{ mt: 2 }}>
                <Typography variant="body2">
                  <strong>What will be preserved:</strong>
                </Typography>
                <Typography variant="body2" component="div">
                  • Manual statement imports
                  <br />
                  • Account information
                  <br />
                  • Plaid connection (you can still sync)
                </Typography>
              </Alert>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeletePlaidTransactionsCancel} disabled={deletingPlaidTransactions}>
            Cancel
          </Button>
          <Button
            onClick={handleDeletePlaidTransactionsConfirm}
            variant="contained"
            color="warning"
            disabled={deletingPlaidTransactions}
            startIcon={deletingPlaidTransactions ? <CircularProgress size={16} /> : <DeleteSweep />}
          >
            {deletingPlaidTransactions ? 'Deleting...' : 'Delete Plaid Transactions'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default AccountManagement;
