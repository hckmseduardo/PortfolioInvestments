import React, { useMemo } from 'react';
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
import Transactions from './pages/Transactions';
import { ThemeModeProvider, useThemeMode } from './context/ThemeContext';

const AppShell = () => {
  const { mode } = useThemeMode();

  const theme = useMemo(() => createTheme({
    palette: {
      mode,
      primary: {
        main: '#1976d2'
      },
      secondary: {
        main: '#dc004e'
      },
      background: {
        default: mode === 'dark' ? '#101418' : '#f4f6f8',
        paper: mode === 'dark' ? '#161b21' : '#ffffff'
      }
    },
    components: {
      MuiCard: {
        styleOverrides: {
          root: {
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            '&:hover': {
              transform: 'translateY(-2px)',
              boxShadow: mode === 'dark' ? '0 8px 16px rgba(0,0,0,0.35)' : '0 8px 24px rgba(0,0,0,0.15)'
            }
          }
        }
      }
    }
  }), [mode]);

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
                      <Route path="/transactions" element={<Transactions />} />
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
};

function App() {
  return (
    <ThemeModeProvider>
      <AppShell />
    </ThemeModeProvider>
  );
}

export default App;
