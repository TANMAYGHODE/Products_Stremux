import { defineFunction } from '@aws-amplify/backend';

export const apiFunction = defineFunction({
  name: 'api',
  entry: './handler.ts',
  timeoutSeconds: 90,
  memoryMB: 512,
  environment: {
    MONGODB_DB_NAME: 'stremux_insurance',
    AWS_REGION: 'us-east-1',
    BEDROCK_MODEL_ID: 'google.gemma-3-27b-it',
    BEDROCK_FALLBACK_MODEL_ID: 'amazon.nova-pro-v1:0',
  },
});
