import React, { useState } from 'react';
import {
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Box,
  Alert,
  Tab,
  Tabs
} from '@mui/material';
import { Security } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Login = () => {
  const [tab, setTab] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [requires2FA, setRequires2FA] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login, register, verify2FA } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = tab === 0
      ? await login(email, password)
      : await register(email, password);

    setLoading(false);

    if (result.success) {
      // Check if 2FA is required
      if (result.requires2FA && result.tempToken) {
        setRequires2FA(true);
        setTempToken(result.tempToken);
      } else {
        navigate('/');
      }
    } else {
      setError(result.error);
    }
  };

  const handle2FASubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!twoFactorCode || twoFactorCode.length !== 6) {
      setError('Please enter a valid 6-digit code');
      return;
    }

    setLoading(true);
    const result = await verify2FA(twoFactorCode, tempToken);
    setLoading(false);

    if (result.success) {
      navigate('/');
    } else {
      setError(result.error);
    }
  };

  const handleBackToLogin = () => {
    setRequires2FA(false);
    setTempToken('');
    setTwoFactorCode('');
    setError('');
  };

  return (
    <Container maxWidth="sm">
      <Box
        sx={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Paper elevation={3} sx={{ p: 4, width: '100%' }}>
          <Typography component="h1" variant="h4" align="center" gutterBottom>
            Investment Portfolio Manager
          </Typography>

          {requires2FA ? (
            // 2FA Verification Screen
            <>
              <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
                <Security sx={{ fontSize: 48, color: 'primary.main' }} />
              </Box>
              <Typography variant="h6" align="center" gutterBottom>
                Two-Factor Authentication
              </Typography>
              <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 3 }}>
                Enter the 6-digit code from your authenticator app
              </Typography>

              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}

              <Box component="form" onSubmit={handle2FASubmit}>
                <TextField
                  margin="normal"
                  required
                  fullWidth
                  label="Verification Code"
                  placeholder="000000"
                  autoFocus
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputProps={{
                    maxLength: 6,
                    style: { textAlign: 'center', fontSize: '24px', letterSpacing: '0.5em' }
                  }}
                />
                <Button
                  type="submit"
                  fullWidth
                  variant="contained"
                  sx={{ mt: 3, mb: 2 }}
                  disabled={loading || twoFactorCode.length !== 6}
                >
                  {loading ? 'Verifying...' : 'Verify'}
                </Button>
                <Button
                  fullWidth
                  variant="text"
                  onClick={handleBackToLogin}
                  disabled={loading}
                >
                  Back to Login
                </Button>
              </Box>
            </>
          ) : (
            // Standard Login/Register Screen
            <>
              <Tabs value={tab} onChange={(e, v) => setTab(v)} centered sx={{ mb: 3 }}>
                <Tab label="Login" />
                <Tab label="Register" />
              </Tabs>

              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}

              <Box component="form" onSubmit={handleSubmit}>
                <TextField
                  margin="normal"
                  required
                  fullWidth
                  label="Email Address"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <TextField
                  margin="normal"
                  required
                  fullWidth
                  label="Password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Button
                  type="submit"
                  fullWidth
                  variant="contained"
                  sx={{ mt: 3, mb: 2 }}
                  disabled={loading}
                >
                  {loading ? 'Please wait...' : (tab === 0 ? 'Login' : 'Register')}
                </Button>
              </Box>
            </>
          )}
        </Paper>
      </Box>
    </Container>
  );
};

export default Login;
