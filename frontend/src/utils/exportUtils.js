import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// Ensure autoTable is loaded and extends jsPDF prototype
// This import is necessary for doc.autoTable() to work
if (autoTable) {
  // Reference to prevent tree-shaking
}

/**
 * Export data to Excel file
 * @param {Array} data - Array of objects to export
 * @param {Array} columns - Array of column definitions {field, header}
 * @param {string} filename - Name of the file (without extension)
 */
export const exportToExcel = (data, columns, filename = 'export') => {
  try {
    // Create worksheet data with headers
    const wsData = [];

    // Add header row
    const headers = columns.map(col => col.header || col.field);
    wsData.push(headers);

    // Add data rows
    data.forEach(row => {
      const rowData = columns.map(col => {
        const value = row[col.field];
        // Handle null/undefined
        if (value === null || value === undefined) return '';
        // Handle dates
        if (col.type === 'date' && value) {
          return new Date(value).toLocaleDateString();
        }
        // Handle numbers
        if (col.type === 'number' && typeof value === 'number') {
          return value;
        }
        // Handle currency
        if (col.type === 'currency' && typeof value === 'number') {
          return value;
        }
        return value;
      });
      wsData.push(rowData);
    });

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Auto-size columns
    const colWidths = columns.map((col, i) => {
      const headerLength = (col.header || col.field).length;
      const maxDataLength = Math.max(
        ...data.map(row => {
          const value = row[col.field];
          return value ? String(value).length : 0;
        })
      );
      return { wch: Math.max(headerLength, maxDataLength, 10) };
    });
    ws['!cols'] = colWidths;

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Data');

    // Generate Excel file
    XLSX.writeFile(wb, `${filename}.xlsx`);

    return true;
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    return false;
  }
};

/**
 * Export data to PDF file
 * @param {Array} data - Array of objects to export
 * @param {Array} columns - Array of column definitions {field, header, width}
 * @param {string} filename - Name of the file (without extension)
 * @param {string} title - Title to display on the PDF
 */
export const exportToPDF = (data, columns, filename = 'export', title = 'Data Export') => {
  try {
    // Create new PDF document (landscape for better table fit)
    const doc = new jsPDF({
      orientation: columns.length > 6 ? 'landscape' : 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // Verify autoTable is available
    if (typeof doc.autoTable !== 'function') {
      console.error('autoTable is not available on jsPDF instance');
      alert('PDF export feature is not properly configured. Please contact support.');
      return false;
    }

    // Add title
    doc.setFontSize(16);
    doc.text(title, 14, 15);

    // Add export date
    doc.setFontSize(10);
    doc.text(`Exported on: ${new Date().toLocaleString()}`, 14, 22);

    // Prepare table data
    const headers = columns.map(col => col.header || col.field);
    const rows = data.map(row =>
      columns.map(col => {
        const value = row[col.field];
        // Handle null/undefined
        if (value === null || value === undefined) return '';
        // Handle dates
        if (col.type === 'date' && value) {
          return new Date(value).toLocaleDateString();
        }
        // Handle numbers and currency
        if ((col.type === 'number' || col.type === 'currency') && typeof value === 'number') {
          return col.type === 'currency'
            ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : value.toLocaleString();
        }
        return String(value);
      })
    );

    // Add table
    doc.autoTable({
      head: [headers],
      body: rows,
      startY: 28,
      styles: {
        fontSize: 8,
        cellPadding: 2
      },
      headStyles: {
        fillColor: [66, 66, 66],
        textColor: 255,
        fontStyle: 'bold'
      },
      alternateRowStyles: {
        fillColor: [245, 245, 245]
      },
      margin: { top: 28, right: 14, bottom: 14, left: 14 },
      // Adjust column widths if specified
      columnStyles: columns.reduce((acc, col, idx) => {
        if (col.width) {
          acc[idx] = { cellWidth: col.width };
        }
        return acc;
      }, {})
    });

    // Save the PDF
    doc.save(`${filename}.pdf`);

    return true;
  } catch (error) {
    console.error('Error exporting to PDF:', error);
    alert(`Error exporting to PDF: ${error.message}`);
    return false;
  }
};

/**
 * Format currency value for export
 * @param {number} value - Numeric value
 * @param {string} currency - Currency code (default: USD)
 */
export const formatCurrencyForExport = (value, currency = 'USD') => {
  if (value === null || value === undefined) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency
  }).format(value);
};

/**
 * Format date for export
 * @param {string|Date} value - Date value
 * @param {string} format - Format type ('short', 'long', 'iso')
 */
export const formatDateForExport = (value, format = 'short') => {
  if (!value) return '';
  const date = new Date(value);

  switch (format) {
    case 'long':
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    case 'iso':
      return date.toISOString().split('T')[0];
    case 'short':
    default:
      return date.toLocaleDateString();
  }
};

/**
 * Format percentage for export
 * @param {number} value - Numeric value (e.g., 0.15 for 15%)
 * @param {number} decimals - Number of decimal places
 */
export const formatPercentageForExport = (value, decimals = 2) => {
  if (value === null || value === undefined) return '';
  return `${(value * 100).toFixed(decimals)}%`;
};
