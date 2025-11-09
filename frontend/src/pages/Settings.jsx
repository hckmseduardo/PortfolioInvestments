import React from 'react';
import { Container, Typography, Box } from '@mui/material';
import TwoFactorAuth from '../components/TwoFactorAuth';

const Settings = () => {
  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        Settings
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        Manage your account settings and security preferences
      </Typography>

      <TwoFactorAuth />
    </Container>
  );
};

export default Settings;
