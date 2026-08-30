/**
 * @jenova/ui — the ONLY UI import for dashboard-class apps (CLAUDE.md
 * rule 10). Apps never import @mui/* directly; anything they need surfaces
 * here — Jenova components first, then a curated re-export of MUI
 * primitives (extend the curated list here, never bypass it in an app).
 */

// Theme + tokens
export {
  jenovaPalettes,
  jenovaTypography,
  jenovaShadows,
  jenovaCardShadowIndex,
  jenovaShape,
  jenovaLayout,
  jenovaFontFamily,
  type ThemeMode,
  type JenovaPalette,
  type JenovaPaletteChannel,
} from "./theme/tokens";
export { createJenovaTheme, type CreateJenovaThemeOptions } from "./theme/createJenovaTheme";

// Direction infrastructure
export {
  DEFAULT_LOCALE,
  directionForLocale,
  resolveDirection,
  type UiDirection,
} from "./direction/direction";
export { directionCacheOptions, createDirectionCache } from "./direction/cache";
export {
  DirectionProvider,
  useDirection,
  useLocale,
  type DirectionProviderProps,
  type DirectionContextValue,
} from "./direction/DirectionProvider";

// Providers
export {
  JenovaThemeProvider,
  type JenovaThemeProviderProps,
} from "./providers/JenovaThemeProvider";

// Shell primitives
export {
  AppShell,
  useAppShell,
  type AppShellProps,
  type AppShellContextValue,
} from "./shell/AppShell";
export { NavSection, type NavSectionProps } from "./shell/NavSection";
export {
  filterNavByEntitlements,
  navBranchContains,
  type NavItem,
} from "./shell/navigation";
export { DataTable, type DataTableProps, type DataTableColumn } from "./shell/DataTable";
export {
  sortRows,
  toggleSort,
  type SortDirection,
  type TableSortState,
} from "./shell/tableSort";
export { FormField, type FormFieldProps } from "./shell/FormField";
export { ConfirmDialog, type ConfirmDialogProps } from "./shell/ConfirmDialog";
export { ToastProvider, useToast, type ToastApi, type ToastOptions } from "./shell/Toast";
export { PageHeader, type PageHeaderProps } from "./shell/PageHeader";
export {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingState,
  type StatusStateProps,
  type LoadingStateProps,
} from "./shell/StatusStates";

// Curated MUI re-exports — the wrapper surface for dashboard-class apps.
// Layout & structure
export {
  Box,
  Container,
  Stack,
  Grid,
  Divider,
  Paper,
  Card,
  CardContent,
  CardHeader,
  CardActions,
  Collapse,
} from "@mui/material";
// Typography & feedback
export {
  Typography,
  Alert,
  AlertTitle,
  Skeleton,
  CircularProgress,
  LinearProgress,
  Tooltip,
  Badge,
  Chip,
  Avatar,
} from "@mui/material";
// Inputs
export {
  Button,
  IconButton,
  TextField,
  Select,
  MenuItem,
  Checkbox,
  Radio,
  RadioGroup,
  Switch,
  FormControl,
  FormControlLabel,
  FormLabel,
  FormHelperText,
  InputAdornment,
  Autocomplete,
  Tabs,
  Tab,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
// Navigation & overlays
export {
  AppBar,
  Toolbar,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  Breadcrumbs,
  Link,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Snackbar,
  Pagination,
} from "@mui/material";
// Tables (DataTable covers most cases; raw parts for bespoke layouts)
export {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
} from "@mui/material";
export { useMediaQuery, useTheme } from "@mui/material";
export type { SxProps, Theme } from "@mui/material/styles";
