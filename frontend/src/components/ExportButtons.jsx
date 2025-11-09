import React from 'react';
import { Box, Button, ButtonGroup } from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { exportToExcel, exportToPDF } from '../utils/exportUtils';

/**
 * Reusable export buttons component for grids
 * @param {Array} data - Data to export
 * @param {Array} columns - Column definitions for export
 * @param {string} filename - Base filename for exports
 * @param {string} title - Title for PDF export
 */
const ExportButtons = ({ data, columns, filename = 'export', title = 'Data Export' }) => {
  const handleExportExcel = () => {
    const success = exportToExcel(data, columns, filename);
    if (!success) {
      alert('Error exporting to Excel. Please try again.');
    }
  };

  const handleExportPDF = () => {
    const success = exportToPDF(data, columns, filename, title);
    if (!success) {
      alert('Error exporting to PDF. Please try again.');
    }
  };

  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <ButtonGroup variant="outlined" size="small">
        <Button
          startIcon={<FileDownloadIcon />}
          onClick={handleExportExcel}
          disabled={!data || data.length === 0}
        >
          Export to Excel
        </Button>
        <Button
          startIcon={<PictureAsPdfIcon />}
          onClick={handleExportPDF}
          disabled={!data || data.length === 0}
        >
          Export to PDF
        </Button>
      </ButtonGroup>
    </Box>
  );
};

export default ExportButtons;
