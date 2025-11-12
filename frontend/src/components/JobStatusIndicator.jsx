import React, { useState, useEffect } from 'react';
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
  useMediaQuery,
  LinearProgress,
  Chip,
  Collapse,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper
} from '@mui/material';
import { PlayArrow as PlayArrowIcon, Close as CloseIcon, CheckCircle, Error as ErrorIcon, ExpandMore, ExpandLess, HourglassEmpty } from '@mui/icons-material';
import { useNotification } from '../context/NotificationContext';
import { importAPI } from '../services/api';

const JobStatusIndicator = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expandedJobs, setExpandedJobs] = useState({});
  const [jobDetails, setJobDetails] = useState({});
  const { activeJobs } = useNotification();

  const activeJobList = Object.entries(activeJobs).map(([jobType, jobInfo]) => ({
    jobType,
    ...jobInfo
  }));

  const jobCount = activeJobList.length;

  // Poll for job details when dialog is open
  useEffect(() => {
    if (!dialogOpen || jobCount === 0) return;

    const pollJobDetails = async () => {
      const promises = activeJobList.map(async (job) => {
        try {
          const response = await importAPI.getJobStatus(job.jobId);
          return { jobId: job.jobId, data: response.data };
        } catch (error) {
          console.error(`Failed to fetch job details for ${job.jobId}:`, error);
          return { jobId: job.jobId, data: null };
        }
      });

      const results = await Promise.all(promises);
      const detailsMap = {};
      results.forEach(({ jobId, data }) => {
        if (data) {
          detailsMap[jobId] = data;
        }
      });
      setJobDetails(detailsMap);
    };

    // Initial poll
    pollJobDetails();

    // Poll every 2 seconds while dialog is open
    const interval = setInterval(pollJobDetails, 2000);

    return () => clearInterval(interval);
  }, [dialogOpen, jobCount, activeJobList.map(j => j.jobId).join(',')]);

  const handleOpen = () => {
    setDialogOpen(true);
  };

  const handleClose = () => {
    setDialogOpen(false);
  };

  const toggleExpanded = (jobId) => {
    setExpandedJobs(prev => ({
      ...prev,
      [jobId]: !prev[jobId]
    }));
  };

  const formatJobType = (jobType) => {
    // Convert job type to readable format
    if (jobType === 'transaction-conversion') {
      return 'Transaction Conversion';
    }
    if (jobType === 'plaid-sync') {
      return 'Plaid Transaction Sync';
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

  const getFileStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle sx={{ color: 'success.main', fontSize: 16 }} />;
      case 'failed':
        return <ErrorIcon sx={{ color: 'error.main', fontSize: 16 }} />;
      case 'processing':
        return <CircularProgress size={16} />;
      default:
        return <HourglassEmpty sx={{ color: 'text.secondary', fontSize: 16 }} />;
    }
  };

  const renderJobProgress = (job, details) => {
    const meta = details?.meta || {};
    const progress = meta.progress || {};
    const currentFile = meta.current_file;
    const files = meta.files || [];
    const stage = meta.stage;

    const isReprocessAll = job.jobType === 'reprocess-all';
    const hasFiles = files.length > 0;

    return (
      <Box>
        {/* Progress bar for jobs with progress */}
        {progress.total > 0 && (
          <Box sx={{ mb: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Progress: {progress.current}/{progress.total}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                ✓ {progress.successful} | ✗ {progress.failed}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={(progress.current / progress.total) * 100}
              sx={{ height: 6, borderRadius: 1 }}
            />
          </Box>
        )}

        {/* Current file being processed */}
        {currentFile && (
          <Box sx={{ mb: 1, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="caption" fontWeight="bold" display="block">
              Currently Processing:
            </Typography>
            <Typography variant="caption" display="block">
              [{currentFile.index}/{progress.total}] {currentFile.filename}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {currentFile.account}
            </Typography>
          </Box>
        )}

        {/* Stage indicator */}
        {stage && stage !== 'processing' && stage !== 'completed' && (
          <Chip
            label={stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            size="small"
            sx={{ mb: 1 }}
          />
        )}

        {/* File list for reprocess-all jobs */}
        {isReprocessAll && hasFiles && (
          <Box>
            <Box
              onClick={() => toggleExpanded(job.jobId)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
                p: 0.5,
                borderRadius: 1
              }}
            >
              <Typography variant="caption" fontWeight="bold">
                Files ({files.length})
              </Typography>
              {expandedJobs[job.jobId] ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
            </Box>

            <Collapse in={expandedJobs[job.jobId]}>
              <TableContainer component={Paper} variant="outlined" sx={{ mt: 1, maxHeight: 300 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell width={40}></TableCell>
                      <TableCell>File</TableCell>
                      <TableCell>Account</TableCell>
                      <TableCell align="right">Txns</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {files.map((file) => (
                      <TableRow key={file.id} hover>
                        <TableCell>{getFileStatusIcon(file.status)}</TableCell>
                        <TableCell>
                          <Typography variant="caption" display="block">
                            {file.filename}
                          </Typography>
                          {file.error && (
                            <Typography variant="caption" color="error.main" display="block">
                              {file.error}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption">{file.account}</Typography>
                        </TableCell>
                        <TableCell align="right">
                          {file.transactions_created !== undefined && (
                            <Typography variant="caption">{file.transactions_created}</Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Collapse>
          </Box>
        )}
      </Box>
    );
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
        maxWidth="md"
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
                      secondary={`Job ID: ${jobId.substring(0, 8)}... | Running for: ${formatElapsedTime(startTime)}`}
                      primaryTypographyProps={{
                        fontWeight: 500
                      }}
                    />
                  </Box>

                  {/* Render job-specific progress */}
                  {jobDetails[jobId] && (
                    <Box sx={{ width: '100%', pl: 5 }}>
                      {renderJobProgress({ jobType, jobId }, jobDetails[jobId])}
                    </Box>
                  )}
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
