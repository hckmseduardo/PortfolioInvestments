const HEADER_ROW_HEIGHT_SPACING = 7; // equals 56px with default MUI spacing

export const stickyTableHeadSx = (theme) => ({
  '& .MuiTableCell-stickyHeader': {
    backgroundColor: theme.palette.background.paper,
    zIndex: theme.zIndex.appBar,
    boxShadow:
      theme.palette.mode === 'dark'
        ? '0 1px 0 rgba(255, 255, 255, 0.12)'
        : '0 1px 0 rgba(0, 0, 0, 0.08)'
  }
});

export const stickyFilterRowSx = (theme) => ({
  '& .MuiTableCell-root': {
    position: 'sticky',
    top: theme.spacing(HEADER_ROW_HEIGHT_SPACING),
    backgroundColor: theme.palette.background.paper,
    zIndex: theme.zIndex.appBar - 1,
    boxShadow:
      theme.palette.mode === 'dark'
        ? '0 1px 0 rgba(255, 255, 255, 0.06)'
        : '0 1px 0 rgba(0, 0, 0, 0.04)'
  }
});
