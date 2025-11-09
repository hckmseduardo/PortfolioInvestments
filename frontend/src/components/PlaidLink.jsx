import React, { useState, useCallback, useEffect } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { Button, CircularProgress, Alert } from '@mui/material';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import { createPlaidLinkToken, exchangePlaidToken } from '../services/api';

const PlaidLinkButton = ({ onSuccess, onError, buttonText = "Connect Bank Account", variant = "contained" }) => {
  const [linkToken, setLinkToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch link token from backend on mount
  useEffect(() => {
    const fetchLinkToken = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await createPlaidLinkToken();
        setLinkToken(response.data.link_token);
      } catch (err) {
        console.error('Error fetching link token:', err);
        setError(err.response?.data?.detail || 'Failed to initialize Plaid Link');
      } finally {
        setLoading(false);
      }
    };

    fetchLinkToken();
  }, []);

  // Handle successful Plaid Link flow
  const handleSuccess = useCallback(async (publicToken, metadata) => {
    try {
      // Send public token to backend
      const response = await exchangePlaidToken(publicToken, metadata);

      // Call parent success handler
      if (onSuccess) {
        onSuccess(response.data);
      }
    } catch (err) {
      console.error('Error exchanging public token:', err);
      const errorMessage = err.response?.data?.detail || 'Failed to connect bank account';

      if (onError) {
        onError(errorMessage);
      }
    }
  }, [onSuccess, onError]);

  // Handle user exit
  const handleExit = useCallback((err, metadata) => {
    if (err) {
      console.error('Plaid Link error:', err);
      const errorMessage = err.error_message || 'An error occurred';

      if (onError) {
        onError(errorMessage);
      }
    }
    // User closed Link without completing, no error needed
  }, [onError]);

  // Handle events (for analytics if needed)
  const handleEvent = useCallback((eventName, metadata) => {
    console.log('Plaid Link event:', eventName, metadata);
  }, []);

  // Configure Plaid Link
  const config = {
    token: linkToken,
    onSuccess: handleSuccess,
    onExit: handleExit,
    onEvent: handleEvent,
  };

  const { open, ready, error: plaidError } = usePlaidLink(config);

  // Handle Plaid Link errors
  useEffect(() => {
    if (plaidError) {
      console.error('Plaid Link initialization error:', plaidError);
      setError('Failed to initialize Plaid Link');
    }
  }, [plaidError]);

  if (loading) {
    return (
      <Button
        variant={variant}
        disabled
        startIcon={<CircularProgress size={20} />}
      >
        Loading...
      </Button>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }

  return (
    <Button
      variant={variant}
      color="primary"
      onClick={() => open()}
      disabled={!ready || !linkToken}
      startIcon={<AccountBalanceIcon />}
    >
      {buttonText}
    </Button>
  );
};

export default PlaidLinkButton;
