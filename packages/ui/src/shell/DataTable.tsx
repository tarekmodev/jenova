"use client";

/**
 * DataTable — the dense, sortable table every dashboard list uses.
 *
 * Empty/loading/error states are built in (pass the localized nodes);
 * money columns get `tabular-nums` and end alignment via logical CSS
 * (`textAlign: "end"`), never physical `align` props. Sorting is
 * controlled (server) or, when a column provides `sortValue`,
 * uncontrolled client-side.
 */

import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import type { SxProps, Theme } from "@mui/material/styles";
import { useMemo, useState, type ReactNode } from "react";
import { useLocale } from "../direction/DirectionProvider";
import { sortRows, toggleSort, type TableSortState } from "./tableSort";

export interface DataTableColumn<Row> {
  readonly id: string;
  /** Localized header content (apps own catalogs). */
  readonly header: ReactNode;
  readonly cell: (row: Row) => ReactNode;
  /** End-aligned numeric column. */
  readonly numeric?: boolean;
  /** Money column: implies numeric alignment + tabular-nums digits. */
  readonly money?: boolean;
  readonly sortable?: boolean;
  /** Enables client-side sorting for this column. */
  readonly sortValue?: (row: Row) => string | number | null | undefined;
  readonly width?: number | string;
}

export interface DataTableProps<Row> {
  readonly columns: readonly DataTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly getRowId: (row: Row) => string;
  readonly loading?: boolean;
  /** Truthy = show `errorState` instead of rows. */
  readonly error?: boolean;
  /** Localized <EmptyState/> (or any node) when there are no rows. */
  readonly emptyState?: ReactNode;
  /** Localized <ErrorState/> (or any node) when `error` is set. */
  readonly errorState?: ReactNode;
  /** Controlled sort; omit for uncontrolled client sorting. */
  readonly sort?: TableSortState | null;
  readonly onSortChange?: (sort: TableSortState) => void;
  readonly defaultSort?: TableSortState;
  readonly onRowClick?: (row: Row) => void;
  /** Skeleton rows shown while loading. */
  readonly loadingRowCount?: number;
  /** Table aria-label (i18n via props). */
  readonly label?: string;
}

function cellSx<Row>(column: DataTableColumn<Row>): SxProps<Theme> {
  return {
    textAlign: column.numeric === true || column.money === true ? "end" : "start",
    ...(column.money === true ? { fontVariantNumeric: "tabular-nums" } : {}),
    ...(column.width !== undefined ? { width: column.width } : {}),
  };
}

export function DataTable<Row>(props: DataTableProps<Row>): ReactNode {
  const locale = useLocale();
  const [uncontrolledSort, setUncontrolledSort] = useState<TableSortState | null>(
    props.defaultSort ?? null,
  );
  const sort = props.sort !== undefined ? props.sort : uncontrolledSort;

  const handleSort = (columnId: string): void => {
    const next = toggleSort(sort, columnId);
    setUncontrolledSort(next);
    props.onSortChange?.(next);
  };

  const sortColumn =
    sort === null ? undefined : props.columns.find((column) => column.id === sort.columnId);
  const rows = useMemo(() => {
    if (sort === null || sortColumn?.sortValue === undefined) return props.rows;
    return sortRows(props.rows, sortColumn.sortValue, sort.direction, locale);
  }, [props.rows, sort, sortColumn, locale]);

  const columnCount = props.columns.length;
  const showState = props.error === true || (!props.loading && rows.length === 0);

  return (
    <TableContainer component={Paper}>
      <Table size="small" {...(props.label !== undefined ? { "aria-label": props.label } : {})}>
        <TableHead>
          <TableRow>
            {props.columns.map((column) => (
              <TableCell key={column.id} sx={cellSx(column)}>
                {column.sortable === true ? (
                  <TableSortLabel
                    active={sort?.columnId === column.id}
                    direction={sort?.columnId === column.id ? sort.direction : "asc"}
                    onClick={() => handleSort(column.id)}
                  >
                    {column.header}
                  </TableSortLabel>
                ) : (
                  column.header
                )}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {props.loading === true &&
            Array.from({ length: props.loadingRowCount ?? 5 }, (_, index) => (
              <TableRow key={`loading-${index}`}>
                {props.columns.map((column) => (
                  <TableCell key={column.id} sx={cellSx(column)}>
                    <Skeleton />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          {!props.loading && showState && (
            <TableRow>
              <TableCell colSpan={columnCount} sx={{ borderBlockEnd: 0 }}>
                {props.error === true ? props.errorState : props.emptyState}
              </TableCell>
            </TableRow>
          )}
          {!props.loading &&
            props.error !== true &&
            rows.map((row) => (
              <TableRow
                key={props.getRowId(row)}
                hover={props.onRowClick !== undefined}
                {...(props.onRowClick !== undefined
                  ? { onClick: () => props.onRowClick?.(row), sx: { cursor: "pointer" } }
                  : {})}
              >
                {props.columns.map((column) => (
                  <TableCell key={column.id} sx={cellSx(column)}>
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
