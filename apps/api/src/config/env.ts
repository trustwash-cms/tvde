import { loadEnvFile, getServerConfig } from '@tvde/shared/server';

loadEnvFile();

export const env = getServerConfig();
