import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

const NotificationContext = createContext();

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);
  const [activeJobs, setActiveJobs] = useState({}); // Track running jobs by jobType
  const notificationIdCounter = useRef(0);

  const addNotification = useCallback((message, severity = 'info', options = {}) => {
    const id = notificationIdCounter.current++;
    const notification = {
      id,
      message,
      severity, // 'success', 'error', 'warning', 'info'
      timestamp: Date.now(),
      duration: options.duration || 5000, // auto-hide duration
      persistent: options.persistent || false, // if true, requires manual close
      action: options.action || null, // optional action button config { label, onClick }
      jobType: options.jobType || null, // identifier for job type (e.g., 'conversion', 'import')
      ...options
    };

    setNotifications(prev => [...prev, notification]);

    // Auto-remove after duration if not persistent
    if (!notification.persistent && notification.duration > 0) {
      setTimeout(() => {
        removeNotification(id);
      }, notification.duration);
    }

    return id;
  }, []);

  const removeNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  // Convenience methods for different severity levels
  const showSuccess = useCallback((message, options) => {
    return addNotification(message, 'success', options);
  }, [addNotification]);

  const showError = useCallback((message, options) => {
    return addNotification(message, 'error', { duration: 7000, ...options });
  }, [addNotification]);

  const showWarning = useCallback((message, options) => {
    return addNotification(message, 'warning', options);
  }, [addNotification]);

  const showInfo = useCallback((message, options) => {
    return addNotification(message, 'info', options);
  }, [addNotification]);

  // For tracking background jobs that persist across navigation
  const showJobProgress = useCallback((message, jobId, jobType) => {
    const notificationId = addNotification(message, 'info', {
      persistent: true,
      jobId,
      jobType,
      action: null
    });

    // Register active job
    if (jobType) {
      setActiveJobs(prev => ({
        ...prev,
        [jobType]: { jobId, notificationId, startTime: Date.now() }
      }));
    }

    return notificationId;
  }, [addNotification]);

  const updateJobStatus = useCallback((notificationId, message, severity, jobType) => {
    setNotifications(prev =>
      prev.map(n =>
        n.id === notificationId
          ? { ...n, message, severity, persistent: false, duration: 5000 }
          : n
      )
    );

    // Remove from active jobs
    if (jobType) {
      setActiveJobs(prev => {
        const next = { ...prev };
        delete next[jobType];
        return next;
      });
    }

    // Auto-remove after updating status
    setTimeout(() => {
      removeNotification(notificationId);
    }, 5000);
  }, [removeNotification]);

  // Check if a job type is currently running
  const isJobRunning = useCallback((jobType) => {
    return activeJobs[jobType] !== undefined;
  }, [activeJobs]);

  // Get active job info for a job type
  const getActiveJob = useCallback((jobType) => {
    return activeJobs[jobType] || null;
  }, [activeJobs]);

  // Cancel/clear a running job (removes notification but doesn't stop the actual job)
  const clearJob = useCallback((jobType) => {
    const job = activeJobs[jobType];
    if (job) {
      removeNotification(job.notificationId);
      setActiveJobs(prev => {
        const next = { ...prev };
        delete next[jobType];
        return next;
      });
    }
  }, [activeJobs, removeNotification]);

  const value = {
    notifications,
    addNotification,
    removeNotification,
    clearAll,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    showJobProgress,
    updateJobStatus,
    isJobRunning,
    getActiveJob,
    clearJob,
    activeJobs
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};
