import React, { useState, useEffect } from 'react';
import {
  Container,
  Paper,
  Typography,
  Button,
  Box,
  Alert,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Tooltip,
  Collapse,
  MenuItem,
  TextField
} from '@mui/material';
import { CloudUpload, Refresh, Delete, Description, PlayArrow, Error as ErrorIcon } from '@mui/icons-material';
import { importAPI, accountsAPI } from '../services/api';

const Import = () => {
  const [file, setFile] = useState(null);
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

  useEffect(() => {
    loadStatements();
    loadAccounts();
    const interval = setInterval(() => {
      loadStatements();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const loadAccounts = async () => {
    try {
      const response = await accountsAPI.getAll();
      setAccounts(response.data);
    } catch (err) {
      console.error('Failed to load accounts:', err);
    }
  };

  const loadStatements = async () => {
    try {
      const response = await importAPI.getStatements();
      setStatements(response.data);
    } catch (err) {
      console.error('Failed to load statements:', err);
    }
  };

  const handleFileChange = (event) => {
    const selectedFile = event.target.files[0];
    if (selectedFile) {
      const validTypes = [
        'application/pdf',
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ];

      if (validTypes.includes(selectedFile.type) ||
          selectedFile.name.match(/\.(pdf|csv|xlsx|xls)$/i)) {
        setFile(selectedFile);
        setError('');
        setResult(null);
      } else {
        setError('Invalid file type. Please upload PDF, CSV, or Excel files.');
        setFile(null);
      }
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file first');
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
      const response = await importAPI.uploadStatement(file, selectedAccountId);
      setResult({ message: 'File uploaded successfully. Click "Process" to import the data.' });
      setFile(null);
      setSelectedAccountId('');
      document.getElementById('file-input').value = '';
      loadStatements();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  const handleProcess = async (statementId) => {
    setProcessingStatements(prev => new Set(prev).add(statementId));
    setError('');
    setResult(null);
    try {
      const response = await importAPI.processStatement(statementId);
      setResult({
        message: 'Statement processed successfully!',
        ...response.data
      });
      loadStatements();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to process statement');
      loadStatements();
    } finally {
      setProcessingStatements(prev => {
        const newSet = new Set(prev);
        newSet.delete(statementId);
        return newSet;
      });
    }
  };

  const handleReprocess = async (statementId) => {
    setProcessingStatements(prev => new Set(prev).add(statementId));
    setError('');
    setResult(null);
    try {
      const response = await importAPI.reprocessStatement(statementId);
      setResult({
        message: 'Statement reprocessed successfully!',
        ...response.data
      });
      loadStatements();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to reprocess statement');
      loadStatements();
    } finally {
      setProcessingStatements(prev => {
        const newSet = new Set(prev);
        newSet.delete(statementId);
        return newSet;
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
    return new Date(dateString).toLocaleString();
  };

  const formatFileSize = (bytes) => {
    return (bytes / 1024).toFixed(2) + ' KB';
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'processing':
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
            {accounts.map((account) => (
              <MenuItem key={account.id} value={account.id}>
                {account.label || `${account.institution} - ${account.account_number}`} ({account.account_type})
              </MenuItem>
            ))}
          </TextField>

          <input
            accept=".pdf,.csv,.xlsx,.xls"
            style={{ display: 'none' }}
            id="file-input"
            type="file"
            onChange={handleFileChange}
          />
          <label htmlFor="file-input">
            <Button
              variant="outlined"
              component="span"
              startIcon={<CloudUpload />}
              fullWidth
              sx={{ mb: 2 }}
            >
              Choose File
            </Button>
          </label>

          {file && (
            <Typography variant="body2" color="textSecondary">
              Selected: {file.name} ({(file.size / 1024).toFixed(2)} KB)
            </Typography>
          )}
        </Box>

        {uploading && <LinearProgress sx={{ mb: 2 }} />}

        <Button
          variant="contained"
          fullWidth
          onClick={handleUpload}
          disabled={!file || uploading}
          size="large"
        >
          {uploading ? 'Uploading...' : 'Upload Statement'}
        </Button>
      </Paper>

      <Paper sx={{ p: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h5">
            Uploaded Statements
          </Typography>
          <Button
            startIcon={<Refresh />}
            onClick={loadStatements}
            disabled={loading}
          >
            Refresh
          </Button>
        </Box>

        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Filename</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Uploaded</TableCell>
                <TableCell>Size</TableCell>
                <TableCell>Positions</TableCell>
                <TableCell>Transactions</TableCell>
                <TableCell>Dividends</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {statements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center">
                    <Typography variant="body2" color="textSecondary">
                      No statements uploaded yet
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                statements.map((statement) => (
                  <React.Fragment key={statement.id}>
                    <TableRow>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Description sx={{ mr: 1, color: 'text.secondary' }} />
                          {statement.filename}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Chip
                            label={getStatusLabel(statement.status)}
                            color={getStatusColor(statement.status)}
                            size="small"
                          />
                          {statement.status === 'failed' && statement.error_message && (
                            <Tooltip title={statement.error_message}>
                              <ErrorIcon color="error" fontSize="small" />
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>{formatDate(statement.uploaded_at)}</TableCell>
                      <TableCell>{formatFileSize(statement.file_size)}</TableCell>
                      <TableCell>{statement.positions_count}</TableCell>
                      <TableCell>{statement.transactions_count}</TableCell>
                      <TableCell>{statement.dividends_count}</TableCell>
                      <TableCell align="right">
                        {statement.status === 'pending' && (
                          <Tooltip title="Process statement">
                            <IconButton
                              color="primary"
                              onClick={() => handleProcess(statement.id)}
                              disabled={processingStatements.has(statement.id)}
                            >
                              <PlayArrow />
                            </IconButton>
                          </Tooltip>
                        )}
                        {(statement.status === 'completed' || statement.status === 'failed') && (
                          <Tooltip title="Reprocess statement">
                            <IconButton
                              color="primary"
                              onClick={() => handleReprocess(statement.id)}
                              disabled={processingStatements.has(statement.id)}
                            >
                              <Refresh />
                            </IconButton>
                          </Tooltip>
                        )}
                        <Tooltip title="Delete statement">
                          <IconButton
                            color="error"
                            onClick={() => handleDeleteClick(statement)}
                            disabled={loading || processingStatements.has(statement.id)}
                          >
                            <Delete />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                    {statement.status === 'failed' && statement.error_message && (
                      <TableRow>
                        <TableCell colSpan={8} sx={{ py: 0, borderBottom: 'none' }}>
                          <Collapse in={true}>
                            <Alert severity="error" sx={{ my: 1 }}>
                              <Typography variant="caption">
                                <strong>Error:</strong> {statement.error_message}
                              </Typography>
                            </Alert>
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
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
