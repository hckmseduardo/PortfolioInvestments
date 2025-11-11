import React, { useState } from 'react';
import {
  IconButton,
  Badge,
  Dialog,
  DialogTitle,
  DialogContent,
  List,
  ListItem,
  ListItemText,
  Box,
  Typography,
  CircularProgress,
  Tooltip,
  useTheme,
  useMediaQuery
} from '@mui/material';
import { PlayArrow as PlayArrowIcon, Close as CloseIcon } from '@mui/icons-material';
import { useNotification } from '../context/NotificationContext';

const JobStatusIndicator = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [dialogOpen, setDialogOpen] = useState(false);
  const { activeJobs } = useNotification();

  const activeJobList = Object.entries(activeJobs).map(([jobType, jobInfo]) => ({
    jobType,
    ...jobInfo
  }));

  const jobCount = activeJobList.length;

  const handleOpen = () => {
    setDialogOpen(true);
  };

  const handleClose = () => {
    setDialogOpen(false);
  };

  const formatJobType = (jobType) => {
    // Convert job type to readable format
    if (jobType === 'transaction-conversion') {
      return 'Transaction Conversion';
    }
    if (jobType === 'reprocess-all') {
      return 'Reprocess All Statements';
    }
    if (jobType.startsWith('statement-process-')) {
      return 'Processing Statement';
    }
    if (jobType.startsWith('statement-reprocess-')) {
      return 'Reprocessing Statement';
    }
    if (jobType.startsWith('statement-account-change-')) {
      return 'Updating Statement Account';
    }
    return jobType.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  const formatElapsedTime = (startTime) => {
    const elapsed = Date.now() - startTime;
    const seconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  // Don't show indicator if no jobs are running
  if (jobCount === 0) {
    return null;
  }

  return (
    <>
      <Tooltip title={`${jobCount} job${jobCount > 1 ? 's' : ''} running`}>
        <IconButton
          color="primary"
          onClick={handleOpen}
          sx={{
            animation: 'pulse 2s ease-in-out infinite',
            '@keyframes pulse': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.6 }
            }
          }}
        >
          <Badge badgeContent={jobCount} color="secondary">
            <PlayArrowIcon />
          </Badge>
        </IconButton>
      </Tooltip>

      <Dialog
        open={dialogOpen}
        onClose={handleClose}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            pb: 1
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PlayArrowIcon color="primary" />
            <Typography variant="h6">
              Running Jobs ({jobCount})
            </Typography>
          </Box>
          <IconButton
            edge="end"
            color="inherit"
            onClick={handleClose}
            aria-label="close"
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {jobCount === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">
                No jobs currently running
              </Typography>
            </Box>
          ) : (
            <List>
              {activeJobList.map(({ jobType, jobId, startTime }, index) => (
                <ListItem
                  key={jobType}
                  divider={index < activeJobList.length - 1}
                  sx={{
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    py: 2
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      width: '100%',
                      gap: 2,
                      mb: 1
                    }}
                  >
                    <CircularProgress size={24} />
                    <ListItemText
                      primary={formatJobType(jobType)}
                      secondary={`Job ID: ${jobId.substring(0, 8)}...`}
                      primaryTypographyProps={{
                        fontWeight: 500
                      }}
                    />
                  </Box>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      width: '100%',
                      pl: 5
                    }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      Running for: {formatElapsedTime(startTime)}
                    </Typography>
                  </Box>
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default JobStatusIndicator;
