import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext(null);

// Inactivity timeout: 30 minutes (in milliseconds)
const INACTIVITY_TIMEOUT = 30 * 60 * 1000;

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const inactivityTimerRef = useRef(null);
  const lastActivityRef = useRef(Date.now());

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, []);

  // Reset inactivity timer
  const resetInactivityTimer = useCallback(() => {
    if (!token || !user) return;

    // Clear existing timer
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }

    // Update last activity timestamp
    lastActivityRef.current = Date.now();

    // Set new timer
    inactivityTimerRef.current = setTimeout(() => {
      console.log('Session expired due to inactivity');
      logout();
    }, INACTIVITY_TIMEOUT);
  }, [token, user, logout]);

  // Track user activity (throttled to avoid excessive timer resets)
  const lastResetRef = useRef(Date.now());
  const handleUserActivity = useCallback(() => {
    // Only reset timer if at least 1 minute has passed since last reset
    const now = Date.now();
    const timeSinceLastReset = now - lastResetRef.current;

    // Always update last activity timestamp
    lastActivityRef.current = now;

    // But only reset the timer every minute to reduce overhead
    if (timeSinceLastReset >= 60000) {
      lastResetRef.current = now;
      resetInactivityTimer();
    }
  }, [resetInactivityTimer]);

  useEffect(() => {
    if (token) {
      fetchUser();
    } else {
      setLoading(false);
    }
  }, [token]);

  // Set up activity listeners when user is authenticated
  useEffect(() => {
    if (!user || !token) {
      // Clean up timer if user logs out
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      return;
    }

    // Start the inactivity timer
    resetInactivityTimer();

    // Activity events to track
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];

    // Add event listeners
    events.forEach((event) => {
      window.addEventListener(event, handleUserActivity, true);
    });

    // Cleanup
    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleUserActivity, true);
      });
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [user, token, handleUserActivity, resetInactivityTimer]);

  const fetchUser = async () => {
    try {
      const response = await authAPI.getCurrentUser();
      setUser(response.data);
    } catch (error) {
      console.error('Failed to fetch user:', error);
      logout();
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    try {
      const response = await authAPI.login(email, password);
      const { access_token, requires_2fa, temp_token } = response.data;

      // Check if 2FA is required
      if (requires_2fa && temp_token) {
        return {
          success: true,
          requires2FA: true,
          tempToken: temp_token
        };
      }

      // Normal login without 2FA
      localStorage.setItem('token', access_token);
      setToken(access_token);
      await fetchUser();
      return { success: true, requires2FA: false };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.detail || 'Login failed'
      };
    }
  };

  const verify2FA = async (code, tempToken) => {
    try {
      const response = await authAPI.verify2FA(code, tempToken);
      const { access_token } = response.data;
      localStorage.setItem('token', access_token);
      setToken(access_token);
      await fetchUser();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.detail || 'Invalid verification code'
      };
    }
  };

  const register = async (email, password) => {
    try {
      await authAPI.register(email, password);
      return await login(email, password);
    } catch (error) {
      return { 
        success: false, 
        error: error.response?.data?.detail || 'Registration failed' 
      };
    }
  };

  const getLastActivity = useCallback(() => {
    return lastActivityRef.current;
  }, []);

  const isRecentlyActive = useCallback((thresholdMs = 60000) => {
    // Check if user was active within the last minute (or custom threshold)
    return Date.now() - lastActivityRef.current < thresholdMs;
  }, []);

  const value = {
    user,
    loading,
    login,
    register,
    verify2FA,
    logout,
    isAuthenticated: !!user,
    getLastActivity,
    isRecentlyActive,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
