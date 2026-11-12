export interface Environment {
  name: string;
  display_name: string;
  read_only: boolean;
  default_replication_num: number;
}

export interface QueryRequest {
  sql: string;
}

export interface ExportRequest {
  sql: string;
  format: 'csv' | 'excel' | 'json';
}

export interface StreamMetadata {
  type: 'metadata';
  columns: string[];
  types: string[];
}

export interface StreamError {
  type: 'error';
  error: string;
  row?: number;
}

export type StreamLine = StreamMetadata | StreamError | Record<string, unknown>;

export interface NodeGroup {
  type: 'backend' | 'frontend';
  data: Record<string, unknown>[];
}

export interface ApiError {
  error: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: string;
  comment: string;
}

export interface RoutineLoadExecResult {
  success: boolean;
  rows_affected: number;
  message: string;
}

export interface RoutineLoadAlterRequest {
  database: string;
  name: string;
  columns?: string;
  where?: string;
  job_properties?: Record<string, string>;
  data_source_properties?: Record<string, string>;
  /** Omit to resume only if the job was active before the call. */
  resume?: boolean;
}

export interface RoutineLoadAlterResult {
  success: boolean;
  message: string;
  statements: string[];
  resumed: boolean;
  warning?: string;
}

export interface TableDetail {
  name: string;
  type: string;
  engine: string | null;
  rows: number | null;
  avg_row_length: number | null;
  data_length: number | null;
  create_time: string | null;
  update_time: string | null;
  comment: string | null;
}

export interface AdminExecResult {
  success: boolean;
  message: string;
}
