import React, { useState, useEffect } from 'react';
import {
  Container,
  Paper,
  Typography,
  Box,
  Button,
  TextField,
  Chip,
  IconButton,
  Grid,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon
} from '@mui/icons-material';
import { securityMetadataAPI } from '../services/api';
import { useNotification } from '../context/NotificationContext';

const COLOR_PALETTE = [
  '#4CAF50', '#8BC34A', '#CDDC39', '#FFEB3B', '#FFC107', '#FF9800',
  '#FF5722', '#F44336', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5',
  '#2196F3', '#03A9F4', '#00BCD4', '#009688', '#4DB6AC', '#80CBC4',
  '#607D8B', '#795548', '#9E9E9E', '#757575', '#424242', '#212121'
];

function SecurityMetadata() {
  const { showNotification } = useNotification();
  const [tabValue, setTabValue] = useState(0);

  // Data states
  const [types, setTypes] = useState([]);
  const [subtypes, setSubtypes] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [industries, setIndustries] = useState([]);

  // Form states
  const [editingItem, setEditingItem] = useState(null);
  const [newItem, setNewItem] = useState({ name: '', color: '#4CAF50' });
  const [loading, setLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null);

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [typesRes, subtypesRes, sectorsRes, industriesRes] = await Promise.all([
        securityMetadataAPI.getTypes(),
        securityMetadataAPI.getSubtypes(),
        securityMetadataAPI.getSectors(),
        securityMetadataAPI.getIndustries()
      ]);
      setTypes(typesRes.data || []);
      setSubtypes(subtypesRes.data || []);
      setSectors(sectorsRes.data || []);
      setIndustries(industriesRes.data || []);
    } catch (error) {
      console.error('Error loading metadata:', error);
      showNotification('Error loading metadata', 'error');
    } finally {
      setLoading(false);
    }
  };

  const getCurrentData = () => {
    switch (tabValue) {
      case 0: return types;
      case 1: return subtypes;
      case 2: return sectors;
      case 3: return industries;
      default: return [];
    }
  };

  const getCurrentLabel = () => {
    switch (tabValue) {
      case 0: return 'Type';
      case 1: return 'Subtype';
      case 2: return 'Sector';
      case 3: return 'Industry';
      default: return '';
    }
  };

  const getCurrentAPI = () => {
    switch (tabValue) {
      case 0: return {
        create: securityMetadataAPI.createType,
        update: securityMetadataAPI.updateType,
        delete: securityMetadataAPI.deleteType
      };
      case 1: return {
        create: securityMetadataAPI.createSubtype,
        update: securityMetadataAPI.updateSubtype,
        delete: securityMetadataAPI.deleteSubtype
      };
      case 2: return {
        create: securityMetadataAPI.createSector,
        update: securityMetadataAPI.updateSector,
        delete: securityMetadataAPI.deleteSector
      };
      case 3: return {
        create: securityMetadataAPI.createIndustry,
        update: securityMetadataAPI.updateIndustry,
        delete: securityMetadataAPI.deleteIndustry
      };
      default: return {};
    }
  };

  const setCurrentData = (data) => {
    switch (tabValue) {
      case 0: setTypes(data); break;
      case 1: setSubtypes(data); break;
      case 2: setSectors(data); break;
      case 3: setIndustries(data); break;
    }
  };

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
    setEditingItem(null);
    setNewItem({ name: '', color: '#4CAF50' });
  };

  const handleEdit = (item) => {
    setEditingItem({ ...item });
  };

  const handleUpdate = async () => {
    if (!editingItem.name.trim()) {
      showNotification('Name cannot be empty', 'error');
      return;
    }

    try {
      const api = getCurrentAPI();
      await api.update(editingItem.id, {
        name: editingItem.name,
        color: editingItem.color
      });

      const currentData = getCurrentData();
      const updated = currentData.map(item =>
        item.id === editingItem.id ? editingItem : item
      );
      setCurrentData(updated);

      setEditingItem(null);
      showNotification(`${getCurrentLabel()} updated successfully`, 'success');
    } catch (error) {
      console.error('Error updating:', error);
      showNotification(
        error.response?.data?.detail || `Error updating ${getCurrentLabel().toLowerCase()}`,
        'error'
      );
    }
  };

  const handleCreate = async () => {
    if (!newItem.name.trim()) {
      showNotification('Name cannot be empty', 'error');
      return;
    }

    try {
      const api = getCurrentAPI();
      const response = await api.create(newItem);

      const currentData = getCurrentData();
      setCurrentData([...currentData, response.data]);

      setNewItem({ name: '', color: '#4CAF50' });
      showNotification(`${getCurrentLabel()} created successfully`, 'success');
    } catch (error) {
      console.error('Error creating:', error);
      showNotification(
        error.response?.data?.detail || `Error creating ${getCurrentLabel().toLowerCase()}`,
        'error'
      );
    }
  };

  const handleDeleteClick = (item) => {
    setItemToDelete(item);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    try {
      const api = getCurrentAPI();
      await api.delete(itemToDelete.id);

      const currentData = getCurrentData();
      const filtered = currentData.filter(item => item.id !== itemToDelete.id);
      setCurrentData(filtered);

      showNotification(`${getCurrentLabel()} deleted successfully`, 'success');
    } catch (error) {
      console.error('Error deleting:', error);
      showNotification(
        error.response?.data?.detail || `Error deleting ${getCurrentLabel().toLowerCase()}`,
        'error'
      );
    } finally {
      setDeleteDialogOpen(false);
      setItemToDelete(null);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>
          Security Metadata Management
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          Manage types, subtypes, sectors, and industries for your portfolio positions.
          New values from Plaid are automatically added to these lists.
        </Typography>

        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
          <Tabs value={tabValue} onChange={handleTabChange}>
            <Tab label="Types" />
            <Tab label="Subtypes" />
            <Tab label="Sectors" />
            <Tab label="Industries" />
          </Tabs>
        </Box>

        {/* Existing Items */}
        <Box mb={4}>
          <Typography variant="h6" gutterBottom>
            Existing {getCurrentLabel()}s
          </Typography>
          {getCurrentData().length > 0 ? (
            <Box display="flex" flexWrap="wrap" gap={1}>
              {getCurrentData().map(item => (
                <Box key={item.id} display="flex" alignItems="center">
                  <Chip
                    label={item.name}
                    sx={{
                      bgcolor: item.color,
                      color: '#fff',
                      fontWeight: 500
                    }}
                  />
                  <IconButton
                    size="small"
                    onClick={() => handleEdit(item)}
                    sx={{ ml: 0.5 }}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => handleDeleteClick(item)}
                    sx={{ ml: 0.5 }}
                    color="error"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', py: 2 }}>
              No {getCurrentLabel().toLowerCase()}s yet. Add one below or sync from Plaid.
            </Typography>
          )}
        </Box>

        {/* Edit Form */}
        {editingItem && (
          <Box mb={4} p={3} sx={{ bgcolor: 'grey.100', borderRadius: 2 }}>
            <Typography variant="h6" gutterBottom>
              Edit {getCurrentLabel()}: {editingItem.name}
            </Typography>
            <TextField
              fullWidth
              label={`${getCurrentLabel()} Name`}
              value={editingItem.name}
              onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
              margin="normal"
              size="small"
            />
            <Box mt={2} mb={2}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Select Color
              </Typography>
              <Grid container spacing={1}>
                {COLOR_PALETTE.map((color) => (
                  <Grid item key={color}>
                    <Box
                      onClick={() => setEditingItem({ ...editingItem, color })}
                      sx={{
                        width: 36,
                        height: 36,
                        bgcolor: color,
                        borderRadius: 1,
                        cursor: 'pointer',
                        border: editingItem.color === color ? '3px solid #000' : '1px solid #ddd',
                        boxShadow: editingItem.color === color ? 2 : 0,
                        transition: 'all 0.2s',
                        '&:hover': {
                          transform: 'scale(1.1)',
                          boxShadow: 2
                        }
                      }}
                    />
                  </Grid>
                ))}
              </Grid>
              <Box mt={1} display="flex" alignItems="center" gap={2}>
                <Box
                  sx={{
                    width: 50,
                    height: 36,
                    bgcolor: editingItem.color,
                    borderRadius: 1,
                    border: '1px solid #ddd'
                  }}
                />
                <Typography variant="body2" color="text.secondary">
                  {editingItem.color}
                </Typography>
              </Box>
            </Box>
            <Box display="flex" gap={1} mt={2}>
              <Button onClick={handleUpdate} variant="contained" size="small">
                Save Changes
              </Button>
              <Button onClick={() => setEditingItem(null)} variant="outlined" size="small">
                Cancel
              </Button>
            </Box>
          </Box>
        )}

        {/* Add New Form */}
        <Box p={3} sx={{ bgcolor: 'primary.50', borderRadius: 2 }}>
          <Typography variant="h6" gutterBottom>
            Add New {getCurrentLabel()}
          </Typography>
          <TextField
            fullWidth
            label={`${getCurrentLabel()} Name`}
            value={newItem.name}
            onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
            margin="normal"
            size="small"
          />
          <Box mt={2} mb={2}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Select Color
            </Typography>
            <Grid container spacing={1}>
              {COLOR_PALETTE.map((color) => (
                <Grid item key={color}>
                  <Box
                    onClick={() => setNewItem({ ...newItem, color })}
                    sx={{
                      width: 36,
                      height: 36,
                      bgcolor: color,
                      borderRadius: 1,
                      cursor: 'pointer',
                      border: newItem.color === color ? '3px solid #000' : '1px solid #ddd',
                      boxShadow: newItem.color === color ? 2 : 0,
                      transition: 'all 0.2s',
                      '&:hover': {
                        transform: 'scale(1.1)',
                        boxShadow: 2
                      }
                    }}
                  />
                </Grid>
              ))}
            </Grid>
            <Box mt={1} display="flex" alignItems="center" gap={2}>
              <Box
                sx={{
                  width: 50,
                  height: 36,
                  bgcolor: newItem.color,
                  borderRadius: 1,
                  border: '1px solid #ddd'
                }}
              />
              <Typography variant="body2" color="text.secondary">
                {newItem.color}
              </Typography>
            </Box>
          </Box>
          <Button
            onClick={handleCreate}
            variant="contained"
            startIcon={<AddIcon />}
            sx={{ mt: 2 }}
          >
            Add {getCurrentLabel()}
          </Button>
        </Box>
      </Paper>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete "{itemToDelete?.name}"?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default SecurityMetadata;
