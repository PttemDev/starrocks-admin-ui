/** StarRocks column descriptions for tooltips */

export const backendColumnTooltips: Record<string, string> = {
  BackendId: 'Unique identifier for this Backend node',
  Host: 'IP address or hostname of the Backend node',
  HeartbeatPort: 'Port for heartbeat communication between FE and BE',
  BePort: 'Thrift RPC port used for internal data exchange',
  HttpPort: 'HTTP port for BE web UI and REST APIs',
  BrpcPort: 'BRPC port for high-performance RPC between nodes',
  StarletPort: 'Port used by the StarRocks Starlet module for shared-data mode',
  LastStartTime: 'Timestamp when this Backend node last started',
  LastHeartbeat: 'Timestamp of the most recent heartbeat from this node',
  Alive: 'Whether the node is currently reachable and responding to heartbeats',
  SystemDecommissioned: 'Whether this node has been decommissioned from the cluster',
  TabletNum: 'Total number of tablet replicas stored on this node',
  DataUsedCapacity: 'Disk space used by actual data (tables, indexes)',
  TrashUsedCapacity: 'Disk space used by data in trash (pending cleanup)',
  AvailCapacity: 'Available (free) disk space on this node',
  TotalCapacity: 'Total disk capacity of this node',
  UsedPct: 'Percentage of disk space used (Data + Trash + System)',
  MaxDiskUsedPct: 'Maximum disk usage percentage across all disks on this node',
  ErrMsg: 'Last error message reported by this node (empty if healthy)',
  Version: 'StarRocks software version running on this node',
  Status: 'JSON status info including last reported memory/CPU details',
  DataTotalCapacity: 'Total capacity designated for data storage',
  DataUsedPct: 'Percentage of data storage capacity used',
  CpuCores: 'Number of CPU cores available on this node',
  NumRunningQueries: 'Number of queries currently executing on this node',
  MemUsedPct: 'Percentage of memory currently in use',
  CpuUsedPct: 'Percentage of CPU currently in use',
};

export const frontendColumnTooltips: Record<string, string> = {
  Name: 'Unique name identifier for this Frontend node',
  Host: 'IP address or hostname of the Frontend node',
  EditLogPort: 'Port used for BDBJE edit log replication between FE nodes',
  HttpPort: 'HTTP port for FE web UI and REST APIs',
  QueryPort: 'MySQL protocol port for client connections (typically 9030)',
  RpcPort: 'Thrift RPC port for internal FE communication',
  Role: 'Role in the FE group: LEADER handles writes, FOLLOWER participates in elections, OBSERVER is read-only',
  IsMaster: 'Whether this is the current leader (master) FE node',
  ClusterId: 'Cluster identifier this FE belongs to',
  Join: 'Whether this FE has successfully joined the cluster',
  Alive: 'Whether the node is currently reachable and responding',
  ReplayedJournalId: 'Latest journal entry ID this FE has replayed (lag indicator)',
  LastHeartbeat: 'Timestamp of the most recent heartbeat',
  IsHelper: 'Whether this FE is a helper node for BDBJE replication',
  ErrMsg: 'Last error message (empty if healthy)',
  StartTime: 'Timestamp when this Frontend node started',
  Version: 'StarRocks software version running on this node',
};

export const ingestionColumnTooltips: Record<string, string> = {
  Id: 'Unique routine load job ID',
  Name: 'User-defined name of the routine load job',
  CreateTime: 'When the job was created',
  PauseTime: 'When the job was last paused (empty if running)',
  EndTime: 'When the job completed or was stopped',
  DbName: 'Target database for data loading',
  TableName: 'Target table for data loading',
  State: 'Current state: NEED_SCHEDULE (pending), RUNNING, PAUSED, STOPPED, CANCELLED',
  DataSourceType: 'Data source type (e.g., KAFKA)',
  CurrentTaskNum: 'Number of currently active load tasks',
  JobProperties: 'JSON configuration for the routine load job',
  DataSourceProperties: 'Connection details for the data source',
  CustomProperties: 'User-defined custom properties',
  Statistic: 'JSON statistics: received rows/bytes, error rows, loaded rows',
  Progress: 'Kafka offset progress per partition',
  Lag: 'Consumer lag per Kafka partition (how far behind)',
  ReasonOfStateChanged: 'Why the job state last changed (e.g., error details)',
  ErrorLogUrls: 'URLs to view detailed error logs',
  TrackingSQL: 'SQL to track the load job progress',
  OtherMsg: 'Additional status messages',
  LatestSourcePosition: 'Latest position read from data source',
};

export const routineColumnTooltips: Record<string, string> = {
  ...ingestionColumnTooltips,
};

/** Get tooltip for a column, trying multiple tooltip maps */
export function getColumnTooltip(
  column: string,
  type?: 'backend' | 'frontend' | 'ingestion' | 'routine',
): string | undefined {
  switch (type) {
    case 'backend':
      return backendColumnTooltips[column];
    case 'frontend':
      return frontendColumnTooltips[column];
    case 'ingestion':
      return ingestionColumnTooltips[column];
    case 'routine':
      return routineColumnTooltips[column];
    default:
      return (
        backendColumnTooltips[column] ||
        frontendColumnTooltips[column] ||
        ingestionColumnTooltips[column]
      );
  }
}

/** Format byte values to human-readable */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/** Format a duration string for display */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}
