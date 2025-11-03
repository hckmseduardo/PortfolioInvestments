import React, { useState, useEffect } from 'react';
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
  Chip
} from '@mui/material';
import { Add, Edit, Delete, AccountBalance } from '@mui/icons-material';
import { accountsAPI } from '../services/api';

const AccountManagement = () => {
  const [accounts, setAccounts] = useState([]);
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

  useEffect(() => {
    loadAccounts();
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

  const getAccountTypeColor = (type) => {
    switch (type) {
      case 'investment':
        return 'primary';
      case 'checking':
        return 'success';
      case 'savings':
        return 'info';
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

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
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
                accounts.map((account) => (
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
                    <TableCell align="right">{formatCurrency(account.balance)}</TableCell>
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
                ))
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
