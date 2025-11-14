import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Container,
  Paper,
  Typography,
  Button,
  Box,
  Alert,
  LinearProgress,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  MenuItem,
  TextField,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Select,
  CircularProgress,
  Grid,
  Card,
  CardContent,
  CardHeader,
  CardActions,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup
} from '@mui/material';
import {
  CloudUpload,
  Refresh,
  Delete,
  Description,
  PlayArrow,
  Close,
  RefreshOutlined,
  ArrowUpward,
  ArrowDownward,
  ViewModule,
  TableRows
} from '@mui/icons-material';
import { importAPI, accountsAPI } from '../services/api';
import { stickyTableHeadSx } from '../utils/tableStyles';
import { useNotification } from '../context/NotificationContext';

const STATEMENT_COLUMNS = [
  { id: 'filename', label: 'File', numeric: false },
  { id: 'account_label', label: 'Account', numeric: false },
  { id: 'status', label: 'Status', numeric: false },
  { id: 'uploaded_at', label: 'Uploaded', numeric: false },
  { id: 'transaction_first_date', label: 'First Transaction', numeric: false },
  { id: 'transaction_last_date', label: 'Last Transaction', numeric: false },
  { id: 'file_size', label: 'Size', numeric: true },
  { id: 'positions_count', label: 'Positions', numeric: true },
  { id: 'transactions_count', label: 'Transactions', numeric: true },
  { id: 'dividends_count', label: 'Dividends', numeric: true },
  { id: 'credit_volume', label: 'Credits', numeric: true },
  { id: 'debit_volume', label: 'Debits', numeric: true }
];

const Import = () => {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [statements, setStatements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [statementToDelete, setStatementToDelete] = useState(null);
  const [processingStatements, setProcessingStatements] = useState(new Set());
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [reprocessingAll, setReprocessingAll] = useState(false);
  const [sortConfig, setSortConfig] = useState({ column: 'uploaded_at', direction: 'desc' });
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('cards');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const jobPollers = useRef({});
  const jobNotifications = useRef({});
  const previousStatusesRef = useRef({});
  const hasLoadedOnceRef = useRef(false);
  const { showSuccess, showError, showJobProgress, updateJobStatus, isJobRunning, clearJob } = useNotification();

  const clearProcessingFlag = useCallback((statementId) => {
    setProcessingStatements((prev) => {
      if (!prev.has(statementId)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(statementId);
      return next;
    });
  }, []);

  const trackStatusTransitions = useCallback((nextStatements) => {
    if (!Array.isArray(nextStatements)) {
      return;
    }

    if (!hasLoadedOnceRef.current) {
      previousStatusesRef.current = nextStatements.reduce((acc, stmt) => {
        acc[stmt.id] = stmt.status;
        return acc;
      }, {});
      hasLoadedOnceRef.current = true;
      return;
    }

    const prevStatuses = previousStatusesRef.current;

    nextStatements.forEach((stmt) => {
      const prevStatus = prevStatuses[stmt.id];
      if (!prevStatus) {
        return;
      }

      if (prevStatus !== 'completed' && stmt.status === 'completed') {
        showSuccess(`${stmt.filename} processed successfully.`);
        clearProcessingFlag(stmt.id);
      } else if (prevStatus !== 'failed' && stmt.status === 'failed') {
        const message = stmt.error_message
          ? `${stmt.filename} failed: ${stmt.error_message}`
          : `${stmt.filename} failed to process.`;
        showError(message);
        clearProcessingFlag(stmt.id);
      }
    });

    previousStatusesRef.current = nextStatements.reduce((acc, stmt) => {
      acc[stmt.id] = stmt.status;
      return acc;
    }, {});
  }, [showSuccess, showError, clearProcessingFlag]);

  const loadStatements = useCallback(async () => {
    try {
      const response = await importAPI.getStatements();
      setStatements(response.data);
      trackStatusTransitions(response.data);
      setProcessingStatements((prev) => {
        const activeIds = new Set(response.data.map((statement) => statement.id));
        let mutated = false;
        const next = new Set();
        prev.forEach((id) => {
          if (activeIds.has(id)) {
            next.add(id);
          } else {
            mutated = true;
          }
        });
        return mutated ? next : prev;
      });
    } catch (err) {
      console.error('Failed to load statements:', err);
    }
  }, [trackStatusTransitions]);

  const loadAccounts = useCallback(async () => {
    try {
      const response = await accountsAPI.getAll();
      setAccounts(response.data);
    } catch (err) {
      console.error('Failed to load accounts:', err);
    }
  }, []);

  useEffect(() => {
    loadStatements();
    loadAccounts();
    const interval = setInterval(() => {
      loadStatements();
    }, 3000);
    return () => clearInterval(interval);
  }, [loadStatements, loadAccounts]);

  useEffect(() => {
    return () => {
      Object.values(jobPollers.current).forEach((timer) => clearInterval(timer));
      jobPollers.current = {};
      jobNotifications.current = {};
    };
  }, []);

  const clearJobPoller = useCallback((jobId) => {
    const timer = jobPollers.current[jobId];
    if (timer) {
      clearInterval(timer);
      delete jobPollers.current[jobId];
    }
    delete jobNotifications.current[jobId];
  }, []);

  const startJobPolling = useCallback(
    (jobId, { statementIds = [], onComplete, jobDescription = 'Processing statement', jobType } = {}) => {
      if (!jobId) return;

      // Check if this job type is already running (for batch operations)
      if (jobType && isJobRunning(jobType)) {
        showError(`A ${jobDescription} job is already running. Please wait for it to complete.`);
        return;
      }

      // Show initial notification for background job
      const notificationId = showJobProgress(`${jobDescription}...`, jobId, jobType);
      jobNotifications.current[jobId] = notificationId;

      const poll = async () => {
        try {
          const response = await importAPI.getJobStatus(jobId);
          const status = response.data.status;
          const meta = response.data.meta || {};

          console.log(`[JOB POLL] JobID: ${jobId}, JobType: ${jobType}, Status: ${status}`, {
            stage: meta.stage,
            progress: meta.progress,
            hasNotification: jobNotifications.current[jobId] !== undefined
          });

          if (status === 'finished') {
            console.log(`[JOB COMPLETE] Job ${jobId} (${jobType}) finished. Clearing...`);

            // Get notification ID BEFORE clearing the poller
            const notifId = jobNotifications.current[jobId];
            console.log(`[JOB COMPLETE] Notification ID: ${notifId}, updating status...`);

            // Clear the poller (this deletes jobNotifications.current[jobId])
            clearJobPoller(jobId);
            console.log(`[JOB COMPLETE] Poller cleared for job ${jobId}`);

            setProcessingStatements((prev) => {
              const next = new Set(prev);
              statementIds.forEach((id) => next.delete(id));
              return next;
            });
            setReprocessingAll(false);

            // Update notification to success using the saved notifId
            if (notifId !== undefined) {
              updateJobStatus(notifId, `${jobDescription} completed successfully`, 'success', jobType);
              console.log(`[JOB COMPLETE] updateJobStatus called with jobType: ${jobType}`);
            } else {
              console.warn(`[JOB COMPLETE] No notification ID found for job ${jobId}`);
            }

            // Explicitly clear the job from activeJobs as a backup
            if (jobType) {
              console.log(`[JOB COMPLETE] Calling clearJob for jobType: ${jobType}`);
              clearJob(jobType);
            } else {
              console.warn(`[JOB COMPLETE] No jobType provided, cannot clear from activeJobs`);
            }

            onComplete?.(response.data.result);
            await loadStatements();
            console.log(`[JOB COMPLETE] Job ${jobId} cleanup complete`);
          } else if (status === 'failed') {
            console.log(`[JOB FAILED] Job ${jobId} (${jobType}) failed. Clearing...`);

            // Get notification ID BEFORE clearing the poller
            const notifId = jobNotifications.current[jobId];

            // Clear the poller (this deletes jobNotifications.current[jobId])
            clearJobPoller(jobId);

            setProcessingStatements((prev) => {
              const next = new Set(prev);
              statementIds.forEach((id) => next.delete(id));
              return next;
            });
            setReprocessingAll(false);

            // Update notification to error using the saved notifId
            if (notifId !== undefined) {
              updateJobStatus(notifId, `${jobDescription} failed`, 'error', jobType);
              console.log(`[JOB FAILED] updateJobStatus called with jobType: ${jobType}`);
            }

            // Explicitly clear the job from activeJobs as a backup
            if (jobType) {
              console.log(`[JOB FAILED] Calling clearJob for jobType: ${jobType}`);
              clearJob(jobType);
            }

            setError('Statement job failed. Check statement status for details.');
            await loadStatements();
          }
        } catch (err) {
          console.error('[JOB POLL ERROR] Error polling statement job:', err);
        }
      };

      poll();
      jobPollers.current[jobId] = setInterval(poll, 4000);
    },
    [clearJobPoller, loadStatements, showJobProgress, updateJobStatus, isJobRunning, showError, clearJob]
  );

  const accountMap = useMemo(() => {
    const map = {};
    accounts.forEach((account) => {
      map[account.id] = account;
    });
    return map;
  }, [accounts]);

  const getAccountDisplayName = useCallback(
    (statement) => {
      if (statement.account_label) {
        return statement.account_label;
      }
      const account = accountMap[statement.account_id];
      if (!account) {
        return statement.account_id ? 'Unknown account' : 'Unassigned';
      }
      return (
        account.label ||
        `${account.institution || ''} ${account.account_number || ''}`.trim()
      );
    },
    [accountMap]
  );

  const getColumnValue = useCallback(
    (statement, columnId) => {
      switch (columnId) {
        case 'account_label':
          return getAccountDisplayName(statement);
        case 'uploaded_at':
          return statement.uploaded_at;
        case 'transaction_first_date':
          return statement.transaction_first_date;
        case 'transaction_last_date':
          return statement.transaction_last_date;
        case 'file_size':
          return statement.file_size || 0;
        case 'positions_count':
        case 'transactions_count':
        case 'dividends_count':
        case 'credit_volume':
        case 'debit_volume':
          return statement[columnId] || 0;
        case 'status':
          return statement.status || '';
        default:
          return statement[columnId] || '';
      }
    },
    [getAccountDisplayName]
  );

  const intersectsSelectedPeriod = useCallback((statement) => {
    if (!periodStart && !periodEnd) {
      return true;
    }

    const firstDate = statement.transaction_first_date ? new Date(statement.transaction_first_date) : null;
    const lastDate = statement.transaction_last_date ? new Date(statement.transaction_last_date) : null;

    if (!firstDate && !lastDate) {
      return false;
    }

    const statementStart = firstDate || lastDate;
    const statementEnd = lastDate || firstDate;

    let rangeStart = periodStart ? new Date(periodStart) : null;
    let rangeEnd = periodEnd ? new Date(periodEnd) : null;

    if (rangeStart && rangeEnd && rangeStart > rangeEnd) {
      const temp = rangeStart;
      rangeStart = rangeEnd;
      rangeEnd = temp;
    }

    if (rangeStart && statementEnd < rangeStart) {
      return false;
    }

    if (rangeEnd && statementStart > rangeEnd) {
      return false;
    }

    return true;
  }, [periodStart, periodEnd]);

  const sortedFilteredStatements = useMemo(() => {
    let data = [...statements];

    if (selectedAccountId) {
      data = data.filter((statement) => statement.account_id === selectedAccountId);
    }

    if (periodStart || periodEnd) {
      data = data.filter(intersectsSelectedPeriod);
    }

    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (normalizedQuery) {
      data = data.filter((statement) => {
        const valuesToCheck = [
          statement.filename,
          getAccountDisplayName(statement),
          statement.status,
          statement.uploaded_at,
          statement.file_size,
          statement.positions_count,
          statement.transactions_count,
          statement.dividends_count,
          statement.transaction_first_date,
          statement.transaction_last_date,
          statement.credit_volume,
          statement.debit_volume
        ];

        return valuesToCheck
          .some((value) =>
            String(value ?? '')
              .toLowerCase()
              .includes(normalizedQuery)
          );
      });
    }

    data.sort((a, b) => {
      const direction = sortConfig.direction === 'asc' ? 1 : -1;
      const valueA = getColumnValue(a, sortConfig.column);
      const valueB = getColumnValue(b, sortConfig.column);

      if (['uploaded_at', 'transaction_first_date', 'transaction_last_date'].includes(sortConfig.column)) {
        const dateA = valueA ? new Date(valueA).getTime() : 0;
        const dateB = valueB ? new Date(valueB).getTime() : 0;
        if (dateA === dateB) return 0;
        return dateA > dateB ? direction : -direction;
      }

      if (typeof valueA === 'number' && typeof valueB === 'number') {
        if (valueA === valueB) return 0;
        return valueA > valueB ? direction : -direction;
      }

      return String(valueA).localeCompare(String(valueB)) * direction;
    });

    return data;
  }, [statements, selectedAccountId, periodStart, periodEnd, intersectsSelectedPeriod, searchQuery, sortConfig, getColumnValue, getAccountDisplayName]);

  const validateFile = (file) => {
    const validTypes = [
      'application/pdf',
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];

    return validTypes.includes(file.type) || file.name.match(/\.(pdf|csv|xlsx|xls)$/i);
  };

  const handleFileChange = (event) => {
    const selectedFiles = Array.from(event.target.files);
    const validFiles = selectedFiles.filter(validateFile);

    if (validFiles.length !== selectedFiles.length) {
      setError('Some files were skipped. Only PDF, CSV, and Excel files are allowed.');
    } else {
      setError('');
    }

    if (validFiles.length > 0) {
      setFiles(prevFiles => [...prevFiles, ...validFiles]);
      setResult(null);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      const validFiles = droppedFiles.filter(validateFile);

      if (validFiles.length !== droppedFiles.length) {
        setError('Some files were skipped. Only PDF, CSV, and Excel files are allowed.');
      } else {
        setError('');
      }

      if (validFiles.length > 0) {
        setFiles(prevFiles => [...prevFiles, ...validFiles]);
        setResult(null);
      }
    }
  };

  const removeFile = (index) => {
    setFiles(prevFiles => prevFiles.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      setError('Please select at least one file');
      return;
    }

    if (!selectedAccountId) {
      setError('Please select an account');
      return;
    }

    setUploading(true);
    setError('');
    setResult(null);

    try {
      const uploadPromises = files.map(file =>
        importAPI.uploadStatement(file, selectedAccountId)
      );

      const responses = await Promise.all(uploadPromises);

      // Start job polling for each uploaded file
      responses.forEach((response, index) => {
        const jobId = response.data?.job_id;
        const statementId = response.data?.statement_id;
        const filename = files[index].name;
        const jobType = `statement-upload-${statementId}`;

        if (jobId) {
          startJobPolling(jobId, {
            statementIds: [statementId],
            onComplete: () => loadStatements(),
            jobDescription: `Processing ${filename}`,
            jobType
          });
        }
      });

      setResult({ message: `${files.length} file(s) uploaded. Processing started.` });
      setFiles([]);
      document.getElementById('file-input').value = '';
      loadStatements();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to upload files');
    } finally {
      setUploading(false);
    }
  };

  const handleProcess = async (statementId) => {
    const statement = statements.find(s => s.id === statementId);
    const filename = statement?.filename || 'statement';
    const jobType = `statement-process-${statementId}`;

    // Check if already processing
    if (isJobRunning(jobType)) {
      showError(`${filename} is already being processed`);
      return;
    }

    setProcessingStatements(prev => new Set(prev).add(statementId));
    setError('');
    setResult(null);
    try {
      const response = await importAPI.processStatement(statementId);
      const jobId = response.data?.job_id;
      if (jobId) {
        startJobPolling(jobId, {
          statementIds: [statementId],
          onComplete: () => setResult({ message: 'Statement processed successfully!' }),
          jobDescription: `Processing ${filename}`,
          jobType
        });
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to process statement');
      setProcessingStatements(prev => {
        const next = new Set(prev);
        next.delete(statementId);
        return next;
      });
    }
  };

  const handleReprocess = async (statementId) => {
    const statement = statements.find(s => s.id === statementId);
    const filename = statement?.filename || 'statement';
    const jobType = `statement-reprocess-${statementId}`;

    // Check if already processing
    if (isJobRunning(jobType)) {
      showError(`${filename} is already being reprocessed`);
      return;
    }

    setProcessingStatements(prev => new Set(prev).add(statementId));
    setError('');
    setResult(null);
    try {
      const response = await importAPI.reprocessStatement(statementId);
      const jobId = response.data?.job_id;
      if (jobId) {
        startJobPolling(jobId, {
          statementIds: [statementId],
          onComplete: () => setResult({ message: 'Statement reprocessed successfully!' }),
          jobDescription: `Reprocessing ${filename}`,
          jobType
        });
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to reprocess statement');
      setProcessingStatements(prev => {
        const next = new Set(prev);
        next.delete(statementId);
        return next;
      });
    }
  };

  const handleReprocessAll = async () => {
    const scopeText = selectedAccountId ? ' for the selected account' : ''
    if (!window.confirm(`This will delete all existing transactions, dividends, and positions${scopeText}, then reprocess the statements from oldest to latest. Are you sure?`)) {
      return;
    }

    const statementsInScope = statements.filter((statement) =>
      selectedAccountId ? statement.account_id === selectedAccountId : true
    );
    if (statementsInScope.length === 0) {
      setError('No statements available for the selected account.');
      return;
    }

    const scopedIds = statementsInScope.map((statement) => statement.id);
    setReprocessingAll(true);
    setError('');
    setResult(null);
    setProcessingStatements((prev) => {
      const next = new Set(prev);
      scopedIds.forEach((id) => next.add(id));
      return next;
    });

    const jobType = 'reprocess-all';

    // Check if reprocess all is already running
    if (isJobRunning(jobType)) {
      showError('A reprocess all job is already running. Please wait for it to complete.');
      setReprocessingAll(false);
      setProcessingStatements((prev) => {
        const next = new Set(prev);
        scopedIds.forEach((id) => next.delete(id));
        return next;
      });
      return;
    }

    try {
      const response = await importAPI.reprocessAllStatements(selectedAccountId || null);
      const jobId = response.data?.job_id;
      const accountText = selectedAccountId ? 'account statements' : 'all statements';
      if (jobId) {
        startJobPolling(jobId, {
          statementIds: scopedIds,
          onComplete: (result) => {
            if (result) {
              setResult({
                message: response.data.message,
                details: `Successfully processed: ${result.successful}, Failed: ${result.failed}`
              });
            } else {
              setResult({ message: response.data.message });
            }
          },
          jobDescription: `Reprocessing ${accountText}`,
          jobType
        });
      } else {
        setReprocessingAll(false);
        setProcessingStatements((prev) => {
          const next = new Set(prev);
          scopedIds.forEach((id) => next.delete(id));
          return next;
        });
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to reprocess all statements');
      setReprocessingAll(false);
      setProcessingStatements((prev) => {
        const next = new Set(prev);
        scopedIds.forEach((id) => next.delete(id));
        return next;
      });
    } finally {
      // Actual reset handled when job completes
    }
  };

  const handleSortColumnChange = (columnId) => {
    setSortConfig((prev) => ({
      column: columnId,
      direction: prev.column === columnId ? prev.direction : 'asc'
    }));
  };

  const toggleSortDirection = () => {
    setSortConfig((prev) => ({
      ...prev,
      direction: prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleSearchChange = (value) => {
    setSearchQuery(value);
  };

  const handleViewModeChange = (event, nextView) => {
    if (nextView) {
      setViewMode(nextView);
    }
  };

  const handleAccountChange = async (statementId, newAccountId) => {
    if (!newAccountId) return;

    const statement = statements.find(s => s.id === statementId);
    const filename = statement?.filename || 'statement';
    const jobType = `statement-account-change-${statementId}`;

    // Check if already processing
    if (isJobRunning(jobType)) {
      showError(`Account change for ${filename} is already in progress`);
      return;
    }

    setProcessingStatements(prev => new Set(prev).add(statementId));
    setError('');
    setResult(null);

    try {
      const response = await importAPI.changeStatementAccount(statementId, newAccountId);
      const jobId = response.data?.job_id;
      if (jobId) {
        startJobPolling(jobId, {
          statementIds: [statementId],
          onComplete: () => setResult({ message: 'Account updated and statement queued for reprocessing.' }),
          jobDescription: `Updating account for ${filename}`,
          jobType
        });
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to change statement account');
      setProcessingStatements(prev => {
        const next = new Set(prev);
        next.delete(statementId);
        return next;
      });
    }
  };

  const handleDeleteClick = (statement) => {
    setStatementToDelete(statement);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!statementToDelete) return;

    setLoading(true);
    setError('');
    try {
      await importAPI.deleteStatement(statementToDelete.id);
      setDeleteDialogOpen(false);
      setStatementToDelete(null);
      loadStatements();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete statement');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setStatementToDelete(null);
  };

  const formatDate = (dateString) => {
    if (!dateString) {
      return '—';
    }
    return new Date(dateString).toLocaleString();
  };

  const formatDateOnly = (dateString) => {
    if (!dateString) {
      return '—';
    }
    return new Date(dateString).toLocaleDateString();
  };

  const formatFileSize = (bytes) => {
    if (!bytes) {
      return '0 KB';
    }
    return `${(bytes / 1024).toFixed(2)} KB`;
  };

  const formatCurrency = (value) => {
    if (value === null || value === undefined) {
      return '—';
    }
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'processing':
      case 'queued':
        return 'info';
      case 'pending':
        return 'warning';
      case 'failed':
        return 'error';
      default:
        return 'default';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'completed':
        return 'Processed';
      case 'processing':
        return 'Processing...';
      case 'queued':
        return 'Queued';
      case 'pending':
        return 'Pending';
      case 'failed':
        return 'Failed';
      default:
        return status;
    }
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        Import Statement
      </Typography>

      <Paper sx={{ p: 4, mb: 4 }}>
        <Typography variant="body1" paragraph>
          Upload your Wealthsimple statement to automatically import your portfolio data.
          Supported formats: PDF, CSV, Excel (.xlsx, .xls)
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {result && (
          <Alert severity="success" sx={{ mb: 2 }}>
            <Typography variant="subtitle2">{result.message}</Typography>
            {result.details && (
              <Typography variant="body2">{result.details}</Typography>
            )}
            {result.account_id && (
              <>
                <Typography variant="body2">
                  • Account ID: {result.account_id}
                </Typography>
                <Typography variant="body2">
                  • Positions created: {result.positions_created}
                </Typography>
                <Typography variant="body2">
                  • Transactions created: {result.transactions_created}
                </Typography>
                <Typography variant="body2">
                  • Dividends created: {result.dividends_created}
                </Typography>
              </>
            )}
          </Alert>
        )}

        <Box sx={{ mb: 3 }}>
          <TextField
            select
            label="Select Account"
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            fullWidth
            required
            sx={{ mb: 2 }}
            helperText={accounts.length === 0 ? "No accounts found. Please create an account first." : "Choose which account to import this statement into"}
          >
            <MenuItem value="">
              All accounts
            </MenuItem>
            {accounts.map((account) => (
              <MenuItem key={account.id} value={account.id}>
                {account.institution && `${account.institution} - `}
                {account.label}
                {account.account_type && ` (${account.account_type.replace(/_/g, ' ')})`}
              </MenuItem>
            ))}
          </TextField>

          <Box
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            sx={{
              border: dragActive ? '2px dashed #1976d2' : '2px dashed #ccc',
              borderRadius: 2,
              p: 4,
              textAlign: 'center',
              backgroundColor: dragActive ? 'rgba(25, 118, 210, 0.08)' : 'transparent',
              transition: 'all 0.3s ease',
              mb: 2
            }}
          >
            <CloudUpload sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              Drag and drop files here
            </Typography>
            <Typography variant="body2" color="textSecondary" paragraph>
              or
            </Typography>
            <input
              accept=".pdf,.csv,.xlsx,.xls"
              style={{ display: 'none' }}
              id="file-input"
              type="file"
              multiple
              onChange={handleFileChange}
            />
            <label htmlFor="file-input">
              <Button
                variant="outlined"
                component="span"
                startIcon={<CloudUpload />}
              >
                Choose Files
              </Button>
            </label>
          </Box>

          {files.length > 0 && (
            <Paper variant="outlined" sx={{ mb: 2 }}>
              <List>
                {files.map((file, index) => (
                  <ListItem key={index}>
                    <Description sx={{ mr: 2, color: 'text.secondary' }} />
                    <ListItemText
                      primary={file.name}
                      secondary={`${(file.size / 1024).toFixed(2)} KB`}
                    />
                    <ListItemSecondaryAction>
                      <IconButton edge="end" onClick={() => removeFile(index)}>
                        <Close />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            </Paper>
          )}
        </Box>

        {uploading && <LinearProgress sx={{ mb: 2 }} />}

        <Button
          variant="contained"
          fullWidth
          onClick={handleUpload}
          disabled={files.length === 0 || uploading || !selectedAccountId}
          size="large"
        >
          {uploading ? 'Uploading...' : `Upload ${files.length} File(s)`}
        </Button>
      </Paper>

      <Paper sx={{ p: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h5">
            Uploaded Statements
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              startIcon={<RefreshOutlined />}
              onClick={handleReprocessAll}
              disabled={loading || reprocessingAll || statements.length === 0}
              variant="outlined"
              color="warning"
            >
              {reprocessingAll ? 'Reprocessing All...' : 'Reprocess All'}
            </Button>
            <Button
              startIcon={<Refresh />}
              onClick={loadStatements}
              disabled={loading}
            >
              Refresh
            </Button>
          </Box>
        </Box>

        <Stack spacing={2} sx={{ mb: 3 }}>
          <Stack
            direction={{ xs: 'column', lg: 'row' }}
            spacing={2}
            alignItems={{ xs: 'stretch', lg: 'center' }}
          >
            <TextField
              select
              label="Sort by"
              value={sortConfig.column}
              onChange={(event) => handleSortColumnChange(event.target.value)}
              sx={{ minWidth: { xs: '100%', md: 200 } }}
            >
              {STATEMENT_COLUMNS.map((column) => (
                <MenuItem key={column.id} value={column.id}>
                  {column.label}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="outlined"
              startIcon={sortConfig.direction === 'asc' ? <ArrowUpward /> : <ArrowDownward />}
              onClick={toggleSortDirection}
              sx={{ alignSelf: { xs: 'stretch', md: 'center' } }}
            >
              {sortConfig.direction === 'asc' ? 'Ascending' : 'Descending'}
            </Button>
            <ToggleButtonGroup
              value={viewMode}
              exclusive
              onChange={handleViewModeChange}
              size="small"
              sx={{ alignSelf: { xs: 'stretch', md: 'center' } }}
            >
              <ToggleButton value="cards" aria-label="Card view">
                <ViewModule fontSize="small" sx={{ mr: 1 }} />
                Cards
              </ToggleButton>
              <ToggleButton value="table" aria-label="Table view">
                <TableRows fontSize="small" sx={{ mr: 1 }} />
                Table
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          <Stack
            direction={{ xs: 'column', lg: 'row' }}
            spacing={2}
            alignItems={{ xs: 'stretch', lg: 'center' }}
          >
            <TextField
              label="Search statements"
              placeholder="Filter by filename, status, totals, dates..."
              value={searchQuery}
              onChange={(event) => handleSearchChange(event.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="Period start"
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
              InputLabelProps={{ shrink: true }}
              size="small"
              sx={{ minWidth: { xs: '100%', md: 200 } }}
            />
            <TextField
              label="Period end"
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
              InputLabelProps={{ shrink: true }}
              size="small"
              sx={{ minWidth: { xs: '100%', md: 200 } }}
            />
          </Stack>
        </Stack>

        {statements.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <Typography variant="body2" color="textSecondary">
              No statements uploaded yet
            </Typography>
          </Box>
        ) : sortedFilteredStatements.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <Typography variant="body2" color="textSecondary">
              No statements match the selected filters
            </Typography>
          </Box>
        ) : viewMode === 'cards' ? (
          <Grid container spacing={3}>
            {sortedFilteredStatements.map((statement) => {
              const isProcessing = processingStatements.has(statement.id);
              return (
                <Grid item xs={12} sm={6} lg={4} key={statement.id}>
                  <Card
                    variant="outlined"
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      height: '100%'
                    }}
                  >
                    <CardHeader
                      avatar={<Description color="action" />}
                      title={statement.filename}
                      subheader={`Uploaded ${formatDate(statement.uploaded_at)}`}
                      action={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Chip
                            label={getStatusLabel(statement.status)}
                            color={getStatusColor(statement.status)}
                            size="small"
                          />
                          {isProcessing && <CircularProgress size={16} />}
                        </Box>
                      }
                    />
                    <Divider />
                    <CardContent>
                      <Stack spacing={2}>
                        <Box>
                          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                            Account
                          </Typography>
                          <Select
                            size="small"
                            fullWidth
                            value={statement.account_id || ''}
                            displayEmpty
                            onChange={(event) => handleAccountChange(statement.id, event.target.value)}
                            disabled={isProcessing || reprocessingAll}
                          >
                            <MenuItem value="">
                              <em>Unassigned</em>
                            </MenuItem>
                            {accounts.map((account) => (
                              <MenuItem key={account.id} value={account.id}>
                                {account.institution && `${account.institution} - `}
                                {account.label}
                                {account.account_type && ` (${account.account_type.replace(/_/g, ' ')})`}
                              </MenuItem>
                            ))}
                          </Select>
                        </Box>

                        <Grid container spacing={2}>
                          <Grid item xs={6}>
                            <Typography variant="caption" color="text.secondary">
                              File Size
                            </Typography>
                            <Typography variant="subtitle1">{formatFileSize(statement.file_size)}</Typography>
                          </Grid>
                          <Grid item xs={6}>
                            <Typography variant="caption" color="text.secondary">
                              Positions Imported
                            </Typography>
                            <Typography variant="subtitle1">{statement.positions_count || 0}</Typography>
                          </Grid>
                          <Grid item xs={6}>
                            <Typography variant="caption" color="text.secondary">
                              Transactions Imported
                            </Typography>
                            <Typography variant="subtitle1">{statement.transactions_count || 0}</Typography>
                          </Grid>
                          <Grid item xs={6}>
                            <Typography variant="caption" color="text.secondary">
                              Dividends Imported
                            </Typography>
                            <Typography variant="subtitle1">{statement.dividends_count || 0}</Typography>
                          </Grid>
                          <Grid item xs={6}>
                            <Typography variant="caption" color="text.secondary">
                              First Transaction
                            </Typography>
                            <Typography variant="subtitle1">
                              {formatDateOnly(statement.transaction_first_date)}
                            </Typography>
                          </Grid>
                          <Grid item xs={6}>
                            <Typography variant="caption" color="text.secondary">
                              Last Transaction
                            </Typography>
                            <Typography variant="subtitle1">
                              {formatDateOnly(statement.transaction_last_date)}
                            </Typography>
                          </Grid>
                          <Grid item xs={6}>
                            <Typography variant="caption" color="text.secondary">
                              Credit Volume
                            </Typography>
                            <Typography variant="subtitle1">{formatCurrency(statement.credit_volume)}</Typography>
                          </Grid>
                          <Grid item xs={6}>
                            <Typography variant="caption" color="text.secondary">
                              Debit Volume
                            </Typography>
                            <Typography variant="subtitle1">{formatCurrency(statement.debit_volume)}</Typography>
                          </Grid>
                        </Grid>
                      </Stack>
                    </CardContent>
                    {statement.status === 'failed' && statement.error_message && (
                      <Box sx={{ px: 2, pb: 1 }}>
                        <Alert severity="error" sx={{ mb: 1 }}>
                          <Typography variant="caption">
                            <strong>Error:</strong> {statement.error_message}
                          </Typography>
                        </Alert>
                      </Box>
                    )}
                    <CardActions sx={{ mt: 'auto', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {statement.status === 'pending' ? (
                          <Button
                            startIcon={<PlayArrow />}
                            size="small"
                            variant="contained"
                            onClick={() => handleProcess(statement.id)}
                            disabled={isProcessing || reprocessingAll}
                          >
                            Process
                          </Button>
                        ) : (
                          <Button
                            startIcon={<Refresh />}
                            size="small"
                            variant="outlined"
                            onClick={() => handleReprocess(statement.id)}
                            disabled={isProcessing || reprocessingAll}
                          >
                            Reprocess
                          </Button>
                        )}
                        <Button
                          startIcon={<Delete />}
                          size="small"
                          color="error"
                          variant="text"
                          onClick={() => handleDeleteClick(statement)}
                          disabled={loading || isProcessing || reprocessingAll}
                        >
                          Delete
                        </Button>
                      </Box>
                    </CardActions>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        ) : (
          <TableContainer>
            <Table size="small" stickyHeader>
              <TableHead sx={stickyTableHeadSx}>
                <TableRow>
                  {STATEMENT_COLUMNS.map((column) => (
                    <TableCell key={column.id} align={column.numeric ? 'right' : 'left'}>
                      {column.label}
                    </TableCell>
                  ))}
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedFilteredStatements.map((statement) => {
                  const isProcessing = processingStatements.has(statement.id);
                  return (
                    <React.Fragment key={statement.id}>
                      <TableRow hover>
                        {STATEMENT_COLUMNS.map((column) => {
                          const { id, numeric } = column;
                          let content = statement[id] || '';

                          switch (id) {
                            case 'filename':
                              content = (
                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                  <Description sx={{ mr: 1, color: 'text.secondary' }} />
                                  {statement.filename}
                                </Box>
                              );
                              break;
                            case 'account_label':
                              content = (
                                <Select
                                  size="small"
                                  fullWidth
                                  value={statement.account_id || ''}
                                  displayEmpty
                                  onChange={(event) => handleAccountChange(statement.id, event.target.value)}
                                  disabled={isProcessing || reprocessingAll}
                                >
                                  <MenuItem value="">
                                    <em>Unassigned</em>
                                  </MenuItem>
                                  {accounts.map((account) => (
                                    <MenuItem key={account.id} value={account.id}>
                                      {account.institution && `${account.institution} - `}
                                      {account.label}
                                      {account.account_type && ` (${account.account_type.replace(/_/g, ' ')})`}
                                    </MenuItem>
                                  ))}
                                </Select>
                              );
                              break;
                            case 'status':
                              content = (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Chip
                                    label={getStatusLabel(statement.status)}
                                    color={getStatusColor(statement.status)}
                                    size="small"
                                  />
                                  {isProcessing && <CircularProgress size={14} />}
                                </Box>
                              );
                              break;
                            case 'uploaded_at':
                              content = formatDate(statement.uploaded_at);
                              break;
                            case 'transaction_first_date':
                              content = formatDateOnly(statement.transaction_first_date);
                              break;
                            case 'transaction_last_date':
                              content = formatDateOnly(statement.transaction_last_date);
                              break;
                            case 'file_size':
                              content = formatFileSize(statement.file_size);
                              break;
                            case 'positions_count':
                            case 'transactions_count':
                            case 'dividends_count':
                              content = statement[id] || 0;
                              break;
                            case 'credit_volume':
                            case 'debit_volume':
                              content = formatCurrency(statement[id]);
                              break;
                            default:
                              content = statement[id] || '';
                          }

                          return (
                            <TableCell key={id} align={numeric ? 'right' : 'left'}>
                              {content}
                            </TableCell>
                          );
                        })}
                        <TableCell align="right">
                          {statement.status === 'pending' ? (
                            <IconButton
                              color="primary"
                              size="small"
                              onClick={() => handleProcess(statement.id)}
                              disabled={isProcessing || reprocessingAll}
                            >
                              <PlayArrow fontSize="small" />
                            </IconButton>
                          ) : (
                            <IconButton
                              color="primary"
                              size="small"
                              onClick={() => handleReprocess(statement.id)}
                              disabled={isProcessing || reprocessingAll}
                            >
                              <Refresh fontSize="small" />
                            </IconButton>
                          )}
                          <IconButton
                            color="error"
                            size="small"
                            onClick={() => handleDeleteClick(statement)}
                            disabled={loading || isProcessing || reprocessingAll}
                          >
                            <Delete fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                      {statement.status === 'failed' && statement.error_message && (
                        <TableRow>
                          <TableCell colSpan={STATEMENT_COLUMNS.length + 1} sx={{ py: 0, borderBottom: 'none' }}>
                            <Alert severity="error" sx={{ my: 1 }}>
                              <Typography variant="caption">
                                <strong>Error:</strong> {statement.error_message}
                              </Typography>
                            </Alert>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
      >
        <DialogTitle>Delete Statement</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete "{statementToDelete?.filename}"?
            This will also delete all associated transactions, dividends, and positions.
            This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>

    </Container>
  );
};

export default Import;
