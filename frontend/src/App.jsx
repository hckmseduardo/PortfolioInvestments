import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Box } from '@mui/material';
import { AuthProvider } from './context/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Portfolio from './pages/Portfolio';
import Dividends from './pages/Dividends';
import Expenses from './pages/Expenses';
import Import from './pages/Import';
import AccountManagement from './pages/AccountManagement';

const theme = createTheme({
  palette: {
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
  },
});

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/*"
              element={
                <PrivateRoute>
                  <Box>
                    <Navbar />
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/portfolio" element={<Portfolio />} />
                      <Route path="/dividends" element={<Dividends />} />
                      <Route path="/expenses" element={<Expenses />} />
                      <Route path="/accounts" element={<AccountManagement />} />
                      <Route path="/import" element={<Import />} />
                      <Route path="*" element={<Navigate to="/" />} />
                    </Routes>
                  </Box>
                </PrivateRoute>
              }
            />
          </Routes>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;