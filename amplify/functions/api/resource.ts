import { defineFunction } from '@aws-amplify/backend';

export const apiFunction = defineFunction({
  name: 'api',
  entry: './handler.ts',
  timeoutSeconds: 90,
  memoryMB: 1024,
  environment: {
    BEDROCK_API_KEY: process.env.BEDROCK_API_KEY || '',
    MONGODB_URI: process.env.MONGODB_URI || '',
    MONGODB_DB_NAME: 'stremux_insurance',
    BEDROCK_REGION: 'us-east-1',
    BEDROCK_MODEL_ID: 'amazon.nova-lite-v1:0',
    BEDROCK_FALLBACK_MODEL_ID: 'amazon.nova-pro-v1:0',
  },
});
