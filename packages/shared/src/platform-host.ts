export interface PlatformHostStats {
  cpu: {
    count: number;
    usagePercent: number;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    usagePercent: number;
  };
  storage: {
    totalBytes: number;
    usedBytes: number;
    usagePercent: number;
    mountPath: string;
  };
  sampledAt: string;
}
