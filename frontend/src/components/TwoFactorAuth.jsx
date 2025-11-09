import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  TextField,
  Typography,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Paper,
  List,
  ListItem,
  ListItemText,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment
} from '@mui/material';
import { Security, Lock, ContentCopy, Visibility, VisibilityOff } from '@mui/icons-material';
import { QRCodeSVG } from 'qrcode.react';
import { authAPI } from '../services/api';

const TwoFactorAuth = () => {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [setupDialogOpen, setSetupDialogOpen] = useState(false);
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [backupCodes, setBackupCodes] = useState([]);
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copiedIndex, setCopiedIndex] = useState(null);

  useEffect(() => {
    check2FAStatus();
  }, []);

  const check2FAStatus = async () => {
    setLoading(true);
    try {
      const response = await authAPI.get2FAStatus();
      setEnabled(response.data.enabled);
      setError('');
    } catch (err) {
      setError('Failed to check 2FA status');
    } finally {
      setLoading(false);
    }
  };

  const handleSetup2FA = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authAPI.setup2FA();
      setSecret(response.data.secret);
      setQrCodeUrl(response.data.qr_code_url);
      setBackupCodes(response.data.backup_codes);
      setSetupDialogOpen(true);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to setup 2FA');
    } finally {
      setLoading(false);
    }
  };

  const handleEnable2FA = async () => {
    if (!verificationCode || verificationCode.length !== 6) {
      setError('Please enter a valid 6-digit code');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await authAPI.enable2FA(verificationCode);
      setSuccess('2FA enabled successfully! Save your backup codes in a secure location.');
      setEnabled(true);
      setVerificationCode('');
      // Don't close the dialog immediately - let user save backup codes
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleDisable2FA = async () => {
    if (!password || !verificationCode) {
      setError('Password and verification code are required');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await authAPI.disable2FA(password, verificationCode);
      setSuccess('2FA disabled successfully');
      setEnabled(false);
      setDisableDialogOpen(false);
      setPassword('');
      setVerificationCode('');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to disable 2FA');
    } finally {
      setLoading(false);
    }
  };

  const handleCloseSetupDialog = () => {
    setSetupDialogOpen(false);
    setQrCodeUrl('');
    setSecret('');
    setBackupCodes([]);
    setVerificationCode('');
    setError('');
    setSuccess('');
  };

  const handleCloseDisableDialog = () => {
    setDisableDialogOpen(false);
    setPassword('');
    setVerificationCode('');
    setError('');
  };

  const copyToClipboard = (text, index) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const formatBackupCode = (code) => {
    // Format as XXXX-XXXX for better readability
    return `${code.slice(0, 4)}-${code.slice(4)}`;
  };

  if (loading && !setupDialogOpen && !disableDialogOpen) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Security sx={{ mr: 2, fontSize: 32, color: 'primary.main' }} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6">
              Two-Factor Authentication (2FA)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Add an extra layer of security to your account
            </Typography>
          </Box>
          <Chip
            label={enabled ? 'Enabled' : 'Disabled'}
            color={enabled ? 'success' : 'default'}
            icon={<Lock />}
          />
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

        <Typography variant="body2" sx={{ mb: 3 }}>
          Two-factor authentication adds an additional layer of security to your account by requiring
          more than just a password to sign in. You'll need to enter a code from an authenticator app
          (like Google Authenticator, Authy, or Microsoft Authenticator) each time you log in.
        </Typography>

        {!enabled ? (
          <Button
            variant="contained"
            startIcon={<Security />}
            onClick={handleSetup2FA}
            disabled={loading}
          >
            Enable 2FA
          </Button>
        ) : (
          <Button
            variant="outlined"
            color="error"
            onClick={() => setDisableDialogOpen(true)}
            disabled={loading}
          >
            Disable 2FA
          </Button>
        )}
      </Paper>

      {/* Setup Dialog */}
      <Dialog
        open={setupDialogOpen}
        onClose={enabled ? handleCloseSetupDialog : undefined}
        maxWidth="sm"
        fullWidth
        disableEscapeKeyDown={!enabled}
      >
        <DialogTitle>
          {enabled ? '2FA Enabled Successfully!' : 'Setup Two-Factor Authentication'}
        </DialogTitle>
        <DialogContent>
          {!enabled && (
            <>
              <Typography variant="body2" sx={{ mb: 2 }}>
                Scan this QR code with your authenticator app:
              </Typography>

              {qrCodeUrl && (
                <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
                  <QRCodeSVG value={qrCodeUrl} size={200} />
                </Box>
              )}

              <Typography variant="body2" sx={{ mb: 1 }}>
                Or enter this secret key manually:
              </Typography>
              <Paper sx={{ p: 2, mb: 3, bgcolor: 'grey.100', display: 'flex', alignItems: 'center' }}>
                <Typography
                  variant="body2"
                  sx={{ fontFamily: 'monospace', flex: 1, wordBreak: 'break-all' }}
                >
                  {secret}
                </Typography>
                <IconButton
                  size="small"
                  onClick={() => copyToClipboard(secret, 'secret')}
                  sx={{ ml: 1 }}
                >
                  <ContentCopy fontSize="small" />
                </IconButton>
              </Paper>

              <TextField
                label="Verification Code"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                fullWidth
                placeholder="Enter 6-digit code"
                helperText="Enter the 6-digit code from your authenticator app to confirm setup"
                sx={{ mb: 2 }}
              />
            </>
          )}

          {backupCodes.length > 0 && (
            <>
              <Alert severity="warning" sx={{ mb: 2 }}>
                <Typography variant="body2" fontWeight="bold" gutterBottom>
                  Save Your Backup Codes!
                </Typography>
                <Typography variant="body2">
                  Store these codes in a secure location. Each code can only be used once if you lose
                  access to your authenticator app.
                </Typography>
              </Alert>

              <List dense sx={{ bgcolor: 'grey.50', borderRadius: 1 }}>
                {backupCodes.map((code, index) => (
                  <ListItem
                    key={index}
                    secondaryAction={
                      <IconButton
                        edge="end"
                        onClick={() => copyToClipboard(code, index)}
                        size="small"
                      >
                        {copiedIndex === index ? (
                          <Typography variant="caption" color="success.main">
                            Copied!
                          </Typography>
                        ) : (
                          <ContentCopy fontSize="small" />
                        )}
                      </IconButton>
                    }
                  >
                    <ListItemText
                      primary={
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {formatBackupCode(code)}
                        </Typography>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            </>
          )}

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ mt: 2 }}>
              {success}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          {enabled ? (
            <Button onClick={handleCloseSetupDialog} variant="contained">
              Done
            </Button>
          ) : (
            <>
              <Button onClick={handleCloseSetupDialog}>Cancel</Button>
              <Button
                onClick={handleEnable2FA}
                variant="contained"
                disabled={loading || verificationCode.length !== 6}
              >
                Verify & Enable
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      {/* Disable Dialog */}
      <Dialog open={disableDialogOpen} onClose={handleCloseDisableDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Disable Two-Factor Authentication</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 3 }}>
            To disable 2FA, please enter your password and a current verification code from your
            authenticator app.
          </Typography>

          <TextField
            label="Password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            sx={{ mb: 2 }}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => setShowPassword(!showPassword)}
                    edge="end"
                  >
                    {showPassword ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              )
            }}
          />

          <TextField
            label="Verification Code"
            value={verificationCode}
            onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            fullWidth
            placeholder="Enter 6-digit code"
          />

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDisableDialog}>Cancel</Button>
          <Button
            onClick={handleDisable2FA}
            color="error"
            variant="contained"
            disabled={loading || !password || verificationCode.length !== 6}
          >
            Disable 2FA
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default TwoFactorAuth;
