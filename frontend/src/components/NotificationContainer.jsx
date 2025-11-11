import React from 'react';
import { Snackbar, Alert, IconButton, Button, CircularProgress, Box } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useNotification } from '../context/NotificationContext';

const NotificationContainer = () => {
  const { notifications, removeNotification } = useNotification();

  const handleClose = (id) => {
    removeNotification(id);
  };

  return (
    <>
      {notifications.map((notification, index) => {
        const isJobInProgress = notification.persistent && notification.severity === 'info';

        return (
          <Snackbar
            key={notification.id}
            open={true}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            style={{
              bottom: `${24 + index * 70}px`, // Stack notifications vertically
              zIndex: 1400 + index
            }}
          >
            <Alert
              severity={notification.severity}
              variant="filled"
              onClose={notification.persistent ? undefined : () => handleClose(notification.id)}
              action={
                <>
                  {isJobInProgress && (
                    <CircularProgress
                      size={20}
                      sx={{ color: 'white', mr: 1 }}
                    />
                  )}
                  {notification.action && (
                    <Button
                      color="inherit"
                      size="small"
                      onClick={() => {
                        notification.action.onClick();
                        if (!notification.persistent) {
                          handleClose(notification.id);
                        }
                      }}
                      sx={{ mr: 1 }}
                    >
                      {notification.action.label}
                    </Button>
                  )}
                  {notification.persistent && (
                    <IconButton
                      size="small"
                      aria-label="close"
                      color="inherit"
                      onClick={() => handleClose(notification.id)}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  )}
                </>
              }
              sx={{
                minWidth: '300px',
                maxWidth: '500px',
                boxShadow: 3,
                '& .MuiAlert-message': {
                  display: 'flex',
                  alignItems: 'center',
                  flexGrow: 1
                }
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {notification.message}
              </Box>
            </Alert>
          </Snackbar>
        );
      })}
    </>
  );
};

export default NotificationContainer;
