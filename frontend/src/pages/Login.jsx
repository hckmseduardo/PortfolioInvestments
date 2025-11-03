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
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Login = () => {
  const [tab, setTab] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login, register } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = tab === 0 
      ? await login(email, password)
      : await register(email, password);

    setLoading(false);

    if (result.success) {
      navigate('/');
    } else {
      setError(result.error);
    }
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
        </Paper>
      </Box>
    </Container>
  );
};

export default Login;
