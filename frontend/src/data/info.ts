/** What kind of data the app runs on (set once by the data source at load). */
export interface DataInfo {
  status: 'sample' | 'production';
  pipelineVersion: string;
  generatedAt?: string;
  sources?: Record<string, string>;
  method?: Record<string, string>;
}

export const dataInfo: DataInfo = { status: 'sample', pipelineVersion: '0.1.0 (sample data)' };

export function setDataInfo(m: Partial<DataInfo> & { dataStatus?: string }): void {
  dataInfo.status = m.dataStatus === 'production' ? 'production' : 'sample';
  if (m.pipelineVersion) dataInfo.pipelineVersion = m.pipelineVersion;
  dataInfo.generatedAt = m.generatedAt;
  dataInfo.sources = m.sources;
  dataInfo.method = m.method;
}

export const isReal = (): boolean => dataInfo.status === 'production';
