export interface BoltApiEnvelope<T = unknown> {
  code: number;
  message: string;
  data: T;
}

export function unwrapBoltResponse<T>(path: string, json: unknown): T {
  if (typeof json === 'object' && json !== null && 'code' in json && 'data' in json) {
    const envelope = json as BoltApiEnvelope<T>;
    if (envelope.code !== 0) {
      throw new Error(`Bolt API ${path} (${envelope.code}): ${envelope.message}`);
    }
    return envelope.data;
  }
  return json as T;
}
